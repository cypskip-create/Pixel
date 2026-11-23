/**
 * Electron main-process Model Context Protocol (MCP) Server Manager.
 *
 * Security & architecture invariants:
 * - Supports both official MCP transports:
 *     1. `stdio`: argument-vector spawn (`shell: false`), restricted environment
 *        (never leaks parent API keys), clean termination on disable/shutdown.
 *     2. `http` (Streamable HTTP, 2025-03-26 / 2024-11-05): HTTPS-only for
 *        remote endpoints, blocks redirects carrying credentials, tracks
 *        `Mcp-Session-Id`, parses JSON and SSE responses.
 * - Collision-safe tool names: `mcp.<serverId>.<toolName>` — can NEVER
 *   overwrite built-in Pixel tools.
 * - Untrusted metadata: remote descriptions and annotations are framed as
 *   untrusted data and NEVER lower Pixel's `PermissionBroker` approval rules.
 * - Per-project availability enforced in the backend; disabling, removing, or
 *   restricting a server revokes all active grants for its tools immediately.
 * - Zero raw credentials stored in SQLite (`mcp_servers` stores config only).
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { basename } from 'node:path';
import type { ToolDefinition } from '../../shared/types';
import type { Database } from '../data/database';
import type { ToolResult } from '../agent/executors';
import { isPrivateHost } from '../agent/netGuard';
import { redactTaskText } from '../tasks/schema';

export const SUPPORTED_MCP_VERSIONS = new Set(['2025-03-26', '2024-11-05']);
export const DEFAULT_MCP_VERSION = '2025-03-26';
const MAX_FRAME_BYTES = 2 * 1024 * 1024;
const DISALLOWED_SHELLS = new Set([
  'cmd', 'cmd.exe', 'powershell', 'powershell.exe', 'pwsh', 'pwsh.exe',
  'sh', 'bash', 'zsh', 'wscript', 'cscript', 'mshta',
]);
const AUTO_INSTALLERS = new Set(['npx', 'npx.cmd', 'uvx', 'pipx']);
const SAFE_ENV_KEYS = ['PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'COMSPEC', 'PYTHONUTF8', 'HOME', 'USERPROFILE'];

export type McpServerStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'degraded'
  | 'disabled'
  | 'auth_required'
  | 'error';

export interface McpDiscoveredTool {
  qualifiedName: string;
  serverId: string;
  originalName: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnlyHint: boolean;
}

export interface McpServerView {
  id: string;
  name: string;
  transport: 'stdio' | 'http';
  command?: string[];
  url?: string;
  trustTier: 'bundled' | 'external_untrusted';
  enabled: boolean;
  allowedProjects: string[];
  status: McpServerStatus;
  protocolVersion?: string;
  toolCount: number;
  tools: string[];
  lastHealthAt?: number;
  lastError?: string;
}

export interface McpServerCreateInput {
  id: string;
  name: string;
  transport: 'stdio' | 'http';
  command?: string[];
  url?: string;
  trustTier?: 'bundled' | 'external_untrusted';
  allowedProjects?: string[];
}

interface PendingRpc {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface LiveConnection {
  serverId: string;
  transport: 'stdio' | 'http';
  protocolVersion: string;
  sessionId?: string;
  proc?: ChildProcessWithoutNullStreams;
  buffer: string;
  nextId: number;
  pending: Map<number, PendingRpc>;
  tools: McpDiscoveredTool[];
}

export function isValidMcpServerId(id: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{1,39}$/.test(id);
}

export function validateMcpStdioCommand(command: string[]): { ok: true } | { ok: false; reason: string } {
  if (!Array.isArray(command) || command.length === 0 || !command.every((a) => typeof a === 'string' && a.trim().length > 0)) {
    return { ok: false, reason: 'Stdio MCP server requires a non-empty argument array.' };
  }
  const exe = basename(command[0].trim()).toLowerCase();
  if (DISALLOWED_SHELLS.has(exe)) {
    return { ok: false, reason: `Shell interpreter "${exe}" is not permitted as an MCP server entrypoint.` };
  }
  if (AUTO_INSTALLERS.has(exe)) {
    return { ok: false, reason: `Unpinned auto-installer "${exe}" is blocked; install a pinned package explicitly.` };
  }
  return { ok: true };
}

export function validateMcpHttpUrl(rawUrl: string): { ok: true; url: URL } | { ok: false; reason: string } {
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return { ok: false, reason: 'MCP HTTP server URL must use https:// (or http://localhost for local development).' };
    }
    if (parsed.username || parsed.password) {
      return { ok: false, reason: 'Do not embed credentials inside the MCP server URL.' };
    }
    const host = parsed.hostname.toLowerCase();
    const isLoopback = host === '127.0.0.1' || host === 'localhost' || host === '::1';
    if (parsed.protocol === 'http:' && !isLoopback) {
      return { ok: false, reason: 'Remote MCP servers must use https://; plaintext http:// is only allowed on localhost.' };
    }
    return { ok: true, url: parsed };
  } catch {
    return { ok: false, reason: 'Invalid MCP server URL.' };
  }
}

function buildRestrictedChildEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { PYTHONUTF8: '1' };
  for (const key of SAFE_ENV_KEYS) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
}

export class McpServerManager {
  private readonly connections = new Map<string, LiveConnection>();
  private readonly toolIndex = new Map<string, McpDiscoveredTool>();

  constructor(
    private readonly db: Database,
    private readonly hooks: {
      onToolsChanged?: (added: ToolDefinition[], removedNames: string[]) => void;
      onRevokeTool?: (toolName: string) => void;
      getBearerToken?: (serverId: string) => string | null;
    } = {},
  ) {}

  /** Adds a new MCP server configuration (disabled by default until explicitly enabled). */
  addServer(input: McpServerCreateInput): McpServerView {
    const id = input.id.trim().toLowerCase();
    if (!isValidMcpServerId(id)) {
      throw new Error('MCP server id must be 2–40 lowercase letters, digits, hyphens, or underscores.');
    }
    const name = input.name.trim().slice(0, 80);
    if (!name) throw new Error('MCP server display name is required.');

    let commandJson: string | null = null;
    let url: string | null = null;
    if (input.transport === 'stdio') {
      const check = validateMcpStdioCommand(input.command ?? []);
      if (!check.ok) throw new Error(check.reason);
      commandJson = JSON.stringify(input.command);
    } else if (input.transport === 'http') {
      const check = validateMcpHttpUrl(input.url ?? '');
      if (!check.ok) throw new Error(check.reason);
      url = check.url.toString();
    } else {
      throw new Error('Transport must be "stdio" or "http".');
    }

    const allowedProjects = Array.isArray(input.allowedProjects) && input.allowedProjects.length > 0
      ? [...new Set(input.allowedProjects.map((p) => String(p).trim()).filter(Boolean))]
      : ['*'];
    const now = Date.now();

    this.db.execute(
      `INSERT INTO mcp_servers
        (id, name, transport, command_json, url, trust_tier, enabled, allowed_projects_json, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'disabled', ?, ?)`,
      [
        id,
        name,
        input.transport,
        commandJson,
        url,
        input.trustTier === 'bundled' ? 'bundled' : 'external_untrusted',
        JSON.stringify(allowedProjects),
        now,
        now,
      ],
    );
    return this.getServer(id)!;
  }

  listServers(): McpServerView[] {
    const rows = this.db.query<Record<string, unknown>>('SELECT * FROM mcp_servers ORDER BY updated_at DESC');
    return rows.map((row) => this.toView(row));
  }

  getServer(id: string): McpServerView | null {
    const row = this.db.queryOne<Record<string, unknown>>('SELECT * FROM mcp_servers WHERE id = ?', [id]);
    return row ? this.toView(row) : null;
  }

  setAllowedProjects(id: string, allowedProjects: string[]): McpServerView {
    const server = this.getServer(id);
    if (!server) throw new Error(`Unknown MCP server "${id}".`);
    const cleaned = [...new Set(allowedProjects.map((p) => String(p).trim()).filter(Boolean))];
    const finalList = cleaned.length > 0 ? cleaned : ['*'];
    this.db.execute(
      'UPDATE mcp_servers SET allowed_projects_json = ?, updated_at = ? WHERE id = ?',
      [JSON.stringify(finalList), Date.now(), id],
    );
    // Revoke existing grants so narrowed project permissions take effect immediately.
    const live = this.connections.get(id);
    if (live) {
      for (const tool of live.tools) this.hooks.onRevokeTool?.(tool.qualifiedName);
    }
    return this.getServer(id)!;
  }

  /** Enables a server and immediately performs MCP handshake + tool discovery. */
  async enableServer(id: string): Promise<McpServerView> {
    const server = this.getServer(id);
    if (!server) throw new Error(`Unknown MCP server "${id}".`);
    this.db.execute(`UPDATE mcp_servers SET enabled = 1, status = 'connecting', last_error = NULL, updated_at = ? WHERE id = ?`, [Date.now(), id]);
    try {
      await this.connectAndDiscover(id);
      return this.getServer(id)!;
    } catch (error) {
      const msg = redactTaskText(error instanceof Error ? error.message : String(error)).slice(0, 300);
      this.db.execute(`UPDATE mcp_servers SET status = 'error', last_error = ?, updated_at = ? WHERE id = ?`, [msg, Date.now(), id]);
      throw error;
    }
  }

  /** Disables a server, closes its process/session, unregisters its tools, and revokes all grants. */
  async disableServer(id: string): Promise<McpServerView> {
    const server = this.getServer(id);
    if (!server) throw new Error(`Unknown MCP server "${id}".`);
    await this.disconnectServer(id);
    this.db.execute(`UPDATE mcp_servers SET enabled = 0, status = 'disabled', updated_at = ? WHERE id = ?`, [Date.now(), id]);
    return this.getServer(id)!;
  }

  async removeServer(id: string): Promise<boolean> {
    await this.disconnectServer(id);
    return this.db.execute('DELETE FROM mcp_servers WHERE id = ?', [id]) > 0;
  }

  /** Backend project-scope enforcement for ToolRegistry. */
  isToolAvailable(projectId: string, qualifiedToolName: string): boolean {
    const tool = this.toolIndex.get(qualifiedToolName);
    if (!tool) return true; // Not an MCP tool
    const server = this.getServer(tool.serverId);
    if (!server || !server.enabled || server.status !== 'connected') return false;
    return server.allowedProjects.includes('*') || server.allowedProjects.includes(projectId);
  }

  handles(toolName: string): boolean {
    return this.toolIndex.has(toolName);
  }

  /** Executes an already-authorized MCP tool call (called by ToolExecutors AFTER PermissionBroker). */
  async executeTool(
    qualifiedToolName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<ToolResult> {
    const tool = this.toolIndex.get(qualifiedToolName);
    if (!tool) {
      return { ok: false, content: `Unknown MCP tool "${qualifiedToolName}".`, errorCode: 'NOT_FOUND' };
    }
    const conn = this.connections.get(tool.serverId);
    if (!conn) {
      return { ok: false, content: `MCP server "${tool.serverId}" is not connected.`, errorCode: 'UNAVAILABLE' };
    }
    try {
      const resp = await this.sendRpc(conn, 'tools/call', { name: tool.originalName, arguments: args }, 30_000, signal);
      if (resp.error) {
        const msg = typeof resp.error === 'object' && resp.error !== null && 'message' in resp.error
          ? String((resp.error as { message: unknown }).message)
          : String(resp.error);
        return { ok: false, content: `MCP tool error: ${redactTaskText(msg).slice(0, 1_500)}`, errorCode: 'FAILED' };
      }
      const result = (resp.result && typeof resp.result === 'object' ? resp.result : {}) as Record<string, unknown>;
      const contentArr = Array.isArray(result.content) ? result.content : [];
      const textParts = contentArr
        .map((c) => (c && typeof c === 'object' && 'text' in c ? String((c as { text: unknown }).text) : JSON.stringify(c)))
        .join('\n')
        .slice(0, 16_000);
      const isErr = result.isError === true;
      this.db.execute('UPDATE mcp_servers SET last_health_at = ?, last_error = NULL WHERE id = ?', [Date.now(), tool.serverId]);
      return {
        ok: !isErr,
        content: `[MCP ${tool.serverId}/${tool.originalName} — external untrusted output]\n${redactTaskText(textParts || '(empty response)')}`,
        detail: { serverId: tool.serverId, tool: tool.originalName },
        ...(isErr ? { errorCode: 'FAILED' as const } : {}),
      };
    } catch (error) {
      const msg = redactTaskText(error instanceof Error ? error.message : String(error)).slice(0, 400);
      const isCancelled = error instanceof Error && /cancel/i.test(error.message);
      if (!isCancelled) {
        this.db.execute(`UPDATE mcp_servers SET status = 'degraded', last_error = ?, updated_at = ? WHERE id = ?`, [msg, Date.now(), tool.serverId]);
      }
      return { ok: false, content: msg, errorCode: isCancelled ? 'CANCELLED' : 'FAILED' };
    }
  }

  /** Cleanly terminates every managed MCP child process and HTTP session on app shutdown. */
  async disposeAll(): Promise<void> {
    for (const id of [...this.connections.keys()]) {
      await this.disconnectServer(id);
    }
  }

  /* --------------------------- internals --------------------------- */

  private async connectAndDiscover(serverId: string): Promise<void> {
    await this.disconnectServer(serverId);
    const server = this.getServer(serverId);
    if (!server) throw new Error(`Unknown MCP server "${serverId}".`);

    const conn: LiveConnection = {
      serverId,
      transport: server.transport,
      protocolVersion: DEFAULT_MCP_VERSION,
      buffer: '',
      nextId: 0,
      pending: new Map(),
      tools: [],
    };

    if (server.transport === 'stdio') {
      if (!server.command || server.command.length === 0) throw new Error('Missing stdio command.');
      const child = spawn(server.command[0], server.command.slice(1), {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true,
        env: buildRestrictedChildEnv(),
      });
      conn.proc = child;
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        if (conn.buffer.length + chunk.length > MAX_FRAME_BYTES) {
          conn.buffer = '';
          return;
        }
        conn.buffer += chunk;
        let idx = conn.buffer.indexOf('\n');
        while (idx !== -1) {
          const line = conn.buffer.slice(0, idx).trim();
          conn.buffer = conn.buffer.slice(idx + 1);
          if (line) this.handleStdioLine(conn, line);
          idx = conn.buffer.indexOf('\n');
        }
      });
      const onGone = (reason: string) => {
        for (const [reqId, p] of conn.pending) {
          clearTimeout(p.timer);
          p.reject(new Error(reason));
          conn.pending.delete(reqId);
        }
        if (this.connections.get(serverId) === conn) {
          this.connections.delete(serverId);
          this.db.execute(`UPDATE mcp_servers SET status = 'error', last_error = ?, updated_at = ? WHERE id = ?`, [reason.slice(0, 300), Date.now(), serverId]);
        }
      };
      child.on('error', (err) => onGone(`MCP stdio spawn failed: ${err.message}`));
      child.on('exit', (code, sig) => onGone(`MCP stdio server exited (code=${String(code)}, signal=${String(sig)}).`));
    } else if (server.url) {
      // SSRF protection for non-localhost remote URLs
      const parsed = new URL(server.url);
      const host = parsed.hostname.toLowerCase();
      if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
        const addrs = await lookup(host, { all: true, verbatim: true });
        if (addrs.length === 0 || addrs.some((a) => isPrivateHost(a.address))) {
          throw new Error('MCP remote server DNS resolved to a private or unsafe address; blocked by SSRF guard.');
        }
      }
    }

    this.connections.set(serverId, conn);

    // 1. Initialize handshake + protocol negotiation
    const initResp = await this.sendRpc(conn, 'initialize', {
      protocolVersion: DEFAULT_MCP_VERSION,
      capabilities: { tools: {} },
      clientInfo: { name: 'Pixel', version: '0.2.1' },
    }, 10_000);
    if (initResp.error) {
      await this.disconnectServer(serverId);
      throw new Error(`MCP initialize failed: ${JSON.stringify(initResp.error)}`);
    }
    const initResult = (initResp.result && typeof initResp.result === 'object' ? initResp.result : {}) as Record<string, unknown>;
    const negotiated = String(initResult.protocolVersion ?? '');
    if (!SUPPORTED_MCP_VERSIONS.has(negotiated)) {
      await this.disconnectServer(serverId);
      throw new Error(`Unsupported MCP protocol version "${negotiated}".`);
    }
    conn.protocolVersion = negotiated;
    await this.sendNotification(conn, 'notifications/initialized', {});

    // 2. Discover tools
    const listResp = await this.sendRpc(conn, 'tools/list', {}, 10_000);
    const listResult = (listResp.result && typeof listResp.result === 'object' ? listResp.result : {}) as Record<string, unknown>;
    const rawTools = Array.isArray(listResult.tools) ? listResult.tools : [];

    const registeredDefs: ToolDefinition[] = [];
    for (const raw of rawTools) {
      if (!raw || typeof raw !== 'object') continue;
      const rec = raw as Record<string, unknown>;
      const origName = String(rec.name ?? '').trim();
      if (!origName || !/^[A-Za-z0-9_.-]{1,80}$/.test(origName)) continue;
      const qualifiedName = `mcp.${serverId}.${origName}`;
      const annotations = (rec.annotations && typeof rec.annotations === 'object' ? rec.annotations : {}) as Record<string, unknown>;
      const readOnlyHint = annotations.readOnlyHint === true;
      const schema = (rec.inputSchema && typeof rec.inputSchema === 'object' ? rec.inputSchema : { type: 'object', properties: {} }) as Record<string, unknown>;
      const desc = `[External MCP: ${server.name}] ${redactTaskText(String(rec.description ?? 'External MCP tool')).slice(0, 320)}`;

      const discovered: McpDiscoveredTool = {
        qualifiedName,
        serverId,
        originalName: origName,
        description: desc,
        inputSchema: schema,
        readOnlyHint,
      };
      conn.tools.push(discovered);
      this.toolIndex.set(qualifiedName, discovered);

      // Never trust remote annotations to bypass approval: external MCP tools always require approval.
      registeredDefs.push({
        name: qualifiedName,
        description: desc,
        category: 'code',
        risk: readOnlyHint ? 'medium' : 'high',
        requiresApproval: true,
        changesState: !readOnlyHint,
        parameters: schema,
      });
    }

    this.db.execute(
      `UPDATE mcp_servers SET status = 'connected', last_health_at = ?, last_error = NULL, updated_at = ? WHERE id = ?`,
      [Date.now(), Date.now(), serverId],
    );
    if (registeredDefs.length > 0) {
      this.hooks.onToolsChanged?.(registeredDefs, []);
    }
  }

  private async disconnectServer(serverId: string): Promise<void> {
    const conn = this.connections.get(serverId);
    if (!conn) return;
    this.connections.delete(serverId);

    const removedNames = conn.tools.map((t) => t.qualifiedName);
    for (const name of removedNames) {
      this.toolIndex.delete(name);
      this.hooks.onRevokeTool?.(name);
    }
    if (removedNames.length > 0) {
      this.hooks.onToolsChanged?.([], removedNames);
    }

    for (const [id, p] of conn.pending) {
      clearTimeout(p.timer);
      p.reject(new Error('MCP server disconnected.'));
      conn.pending.delete(id);
    }

    if (conn.proc) {
      const child = conn.proc;
      conn.proc = undefined;
      try { child.stdin.end(); } catch { /* ignore */ }
      if (child.exitCode === null && !child.killed) {
        try { child.kill(); } catch { /* ignore */ }
      }
    } else if (conn.transport === 'http' && conn.sessionId) {
      const server = this.getServer(serverId);
      if (server?.url) {
        await this.httpRequest(server.url, 'DELETE', null, conn, 2_000).catch(() => undefined);
      }
    }
  }

  private handleStdioLine(conn: LiveConnection, line: string): void {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      const id = parsed.id;
      if (typeof id === 'number') {
        const slot = conn.pending.get(id);
        if (slot) {
          clearTimeout(slot.timer);
          conn.pending.delete(id);
          slot.resolve(parsed);
        }
      }
    } catch {
      // Ignore malformed stdout lines safely
    }
  }

  private async sendNotification(conn: LiveConnection, method: string, params: Record<string, unknown>): Promise<void> {
    const frame = { jsonrpc: '2.0', method, params };
    if (conn.transport === 'stdio' && conn.proc) {
      conn.proc.stdin.write(`${JSON.stringify(frame)}\n`);
    } else if (conn.transport === 'http') {
      const server = this.getServer(conn.serverId);
      if (server?.url) {
        await this.httpRequest(server.url, 'POST', frame, conn, 5_000).catch(() => undefined);
      }
    }
  }

  private async sendRpc(
    conn: LiveConnection,
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    if (signal?.aborted) throw new Error('MCP request cancelled.');
    const id = ++conn.nextId;
    const frame = { jsonrpc: '2.0', id, method, params };

    if (conn.transport === 'stdio') {
      if (!conn.proc || conn.proc.killed || conn.proc.exitCode !== null) {
        throw new Error('MCP stdio server is not running.');
      }
      return new Promise<Record<string, unknown>>((resolve, reject) => {
        const onAbort = () => {
          const slot = conn.pending.get(id);
          if (slot) {
            clearTimeout(slot.timer);
            conn.pending.delete(id);
            void this.sendNotification(conn, 'notifications/cancelled', { requestId: id, reason: 'Cancelled by user' });
            reject(new Error('MCP request cancelled.'));
          }
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        const timer = setTimeout(() => {
          conn.pending.delete(id);
          signal?.removeEventListener('abort', onAbort);
          reject(new Error(`MCP request "${method}" timed out after ${timeoutMs}ms.`));
        }, timeoutMs);
        conn.pending.set(id, {
          resolve: (val) => { signal?.removeEventListener('abort', onAbort); resolve(val); },
          reject: (err) => { signal?.removeEventListener('abort', onAbort); reject(err); },
          timer,
        });
        conn.proc!.stdin.write(`${JSON.stringify(frame)}\n`);
      });
    }

    const server = this.getServer(conn.serverId);
    if (!server?.url) throw new Error('Missing MCP HTTP URL.');
    return this.httpRequest(server.url, 'POST', frame, conn, timeoutMs, signal);
  }

  private httpRequest(
    rawUrl: string,
    method: 'POST' | 'DELETE',
    body: Record<string, unknown> | null,
    conn: LiveConnection,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const parsed = new URL(rawUrl);
    const mod = parsed.protocol === 'https:' ? https : http;
    const serialized = body ? JSON.stringify(body) : null;
    const token = this.hooks.getBearerToken?.(conn.serverId) ?? null;

    const headers: Record<string, string> = {
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': conn.protocolVersion,
      'User-Agent': 'Pixel-MCP/1.0',
    };
    if (conn.sessionId) headers['Mcp-Session-Id'] = conn.sessionId;
    if (token) headers.Authorization = `Bearer ${token}`;
    if (serialized !== null) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = String(Buffer.byteLength(serialized, 'utf8'));
    }

    return new Promise((resolve, reject) => {
      const req = mod.request(
        {
          hostname: parsed.hostname,
          port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
          path: `${parsed.pathname}${parsed.search}`,
          method,
          headers,
          timeout: timeoutMs,
        },
        (res) => {
          const status = res.statusCode ?? 0;
          if (status >= 300 && status < 400) {
            res.resume();
            return reject(new Error(`Blocked HTTP ${status} redirect on MCP server to prevent credential leakage.`));
          }
          const sid = res.headers['mcp-session-id'];
          if (typeof sid === 'string' && sid.trim()) conn.sessionId = sid.trim();

          let raw = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            raw += chunk;
            if (raw.length > MAX_FRAME_BYTES) req.destroy(new Error('MCP HTTP response exceeded 2 MiB limit.'));
          });
          res.on('end', () => {
            if (status === 401) return reject(new Error('MCP server returned HTTP 401 (authentication required).'));
            if (status === 202 || status === 204 || !raw.trim()) return resolve({});
            if (status < 200 || status >= 300) return reject(new Error(`MCP server returned HTTP ${status}.`));
            const ctype = String(res.headers['content-type'] ?? '').toLowerCase();
            if (ctype.includes('text/event-stream')) {
              const lines = raw.split(/\r?\n/);
              for (const line of lines) {
                if (!line.startsWith('data:')) continue;
                const d = line.slice(5).trim();
                if (!d || d === '[DONE]') continue;
                try {
                  const obj = JSON.parse(d) as Record<string, unknown>;
                  if (obj && typeof obj === 'object') return resolve(obj);
                } catch { /* keep scanning */ }
              }
              return reject(new Error('No JSON-RPC payload found in MCP SSE stream.'));
            }
            try {
              resolve(JSON.parse(raw) as Record<string, unknown>);
            } catch {
              reject(new Error('MCP server returned invalid JSON.'));
            }
          });
        },
      );
      const onAbort = () => req.destroy(new Error('MCP request cancelled.'));
      signal?.addEventListener('abort', onAbort, { once: true });
      req.on('close', () => signal?.removeEventListener('abort', onAbort));
      req.on('timeout', () => req.destroy(new Error('MCP HTTP request timed out.')));
      req.on('error', reject);
      if (serialized !== null) req.write(serialized);
      req.end();
    });
  }

  private toView(row: Record<string, unknown>): McpServerView {
    const id = String(row.id);
    const live = this.connections.get(id);
    let command: string[] | undefined;
    if (typeof row.command_json === 'string' && row.command_json) {
      try { command = JSON.parse(row.command_json) as string[]; } catch { /* ignore */ }
    }
    let allowedProjects = ['*'];
    try {
      const parsed = JSON.parse(String(row.allowed_projects_json ?? '["*"]'));
      if (Array.isArray(parsed)) allowedProjects = parsed.map(String);
    } catch { /* ignore */ }

    return {
      id,
      name: String(row.name),
      transport: row.transport === 'http' ? 'http' : 'stdio',
      ...(command ? { command } : {}),
      ...(typeof row.url === 'string' && row.url ? { url: row.url } : {}),
      trustTier: row.trust_tier === 'bundled' ? 'bundled' : 'external_untrusted',
      enabled: Number(row.enabled) === 1,
      allowedProjects,
      status: (String(row.status || 'disconnected') as McpServerStatus),
      ...(live ? { protocolVersion: live.protocolVersion } : {}),
      toolCount: live ? live.tools.length : 0,
      tools: live ? live.tools.map((t) => t.qualifiedName) : [],
      ...(typeof row.last_health_at === 'number' ? { lastHealthAt: row.last_health_at } : {}),
      ...(typeof row.last_error === 'string' && row.last_error ? { lastError: row.last_error } : {}),
    };
  }
}
