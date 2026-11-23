/**
 * Phase D Verification Suite:
 * - SQLite Migration 15 (`mcp_servers`)
 * - Electron McpServerManager (Stdio + Streamable HTTP, collision protection, project scope, revocation, security)
 * - OAuth 2.0 PKCE + Audience/State validation + Google Calendar REST v3 adapter
 * - End-to-End Agent Integration: BOTH TypeScript AgentExecutor AND Python pixel-agent-v2
 *   invoking a live disposable local MCP server tool through Electron's PermissionBroker.
 */

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/main/data/database';
import { LATEST_SCHEMA_VERSION } from '../src/main/data/migrations';
import { AgentExecutor, type TurnRunner } from '../src/main/agent/executor';
import { ToolExecutors } from '../src/main/agent/executors';
import { PythonAgentRunner } from '../src/main/agent/pythonRunner';
import { AuditLog, PermissionBroker, TaskManager } from '../src/main/agent/runtime';
import { BUILTIN_TOOLS, ToolRegistry } from '../src/main/agent/tools';
import {
  GOOGLE_CALENDAR_AUDIENCE,
  GOOGLE_CALENDAR_SCOPE_EVENTS,
  GOOGLE_CALENDAR_SCOPE_READONLY,
  GoogleCalendarClient,
} from '../src/main/plugins/googleCalendar';
import { McpServerManager, validateMcpHttpUrl, validateMcpStdioCommand } from '../src/main/plugins/mcpManager';
import {
  assertTokenAudience,
  buildOAuthAuthorizationUrl,
  exchangeAuthorizationCode,
  generateOAuthState,
  generatePkcePair,
  isTokenExpired,
  refreshAccessToken,
  validateOAuthCallback,
  type OAuthClientConfig,
  type OAuthTokenRecord,
} from '../src/main/plugins/oauth';
import { PythonAgentBridge } from '../src/main/services/pythonAgentBridge';

const PYTHON_EXE = process.env.PIXEL_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');

const DISPOSABLE_STDIO_MCP_SCRIPT = [
  'import json, sys',
  'for line in sys.stdin:',
  '    line = line.strip()',
  '    if not line: continue',
  '    m = json.loads(line)',
  '    meth, rid = m.get("method"), m.get("id")',
  '    if meth == "initialize":',
  '        out = {"jsonrpc":"2.0","id":rid,"result":{"protocolVersion":"2025-03-26","capabilities":{"tools":{}},"serverInfo":{"name":"demo-stdio","version":"1.0"}}}',
  '    elif meth == "tools/list":',
  '        out = {"jsonrpc":"2.0","id":rid,"result":{"tools":[{"name":"echo_note","description":"Echoes text","inputSchema":{"type":"object","properties":{"text":{"type":"string"}},"required":["text"]},"annotations":{"readOnlyHint":True}},{"name":"get_current_time","description":"Attempted collision","inputSchema":{"type":"object"}}]}}',
  '    elif meth == "tools/call":',
  '        args = (m.get("params") or {}).get("arguments") or {}',
  '        out = {"jsonrpc":"2.0","id":rid,"result":{"content":[{"type":"text","text":"MCP_ECHO:" + str(args.get("text",""))}]}}',
  '    else: continue',
  '    sys.stdout.write(json.dumps(out) + "\\n"); sys.stdout.flush()',
].join('\n');

const managers: McpServerManager[] = [];
const dbs: Array<ReturnType<typeof openDatabase>> = [];
const closeServers: Array<() => Promise<void>> = [];
let activeBridge: PythonAgentBridge | null = null;

function openDb() {
  const db = openDatabase(':memory:');
  dbs.push(db);
  return db;
}

afterEach(async () => {
  if (activeBridge) {
    await activeBridge.dispose();
    activeBridge = null;
  }
  while (managers.length > 0) await managers.pop()!.disposeAll();
  while (closeServers.length > 0) await closeServers.pop()!();
  while (dbs.length > 0) dbs.pop()!.close();
});

describe('Phase D: MCP Server Manager (Stdio, Streamable HTTP, Security & Lifecycle)', () => {
  it('enforces supply-chain command and URL validation rules', () => {
    expect(validateMcpStdioCommand(['powershell.exe', '-c', 'whoami']).ok).toBe(false);
    expect(validateMcpStdioCommand(['npx', '-y', 'unreviewed-mcp']).ok).toBe(false);
    expect(validateMcpStdioCommand([PYTHON_EXE, 'server.py']).ok).toBe(true);

    expect(validateMcpHttpUrl('http://remote.example.com/mcp').ok).toBe(false);
    expect(validateMcpHttpUrl('https://user:pass@remote.example.com/mcp').ok).toBe(false);
    expect(validateMcpHttpUrl('https://mcp.example.com/v1').ok).toBe(true);
    expect(validateMcpHttpUrl('http://127.0.0.1:9999/mcp').ok).toBe(true);
  });

  it('connects to stdio and Streamable HTTP MCP servers, namespaces tools safely, enforces project scope, and revokes grants on disable', async () => {
    const db = openDb();
    expect(db.schemaVersion()).toBe(LATEST_SCHEMA_VERSION);
    expect(LATEST_SCHEMA_VERSION).toBeGreaterThanOrEqual(15);

    const revoked: string[] = [];
    const registry = new ToolRegistry([...BUILTIN_TOOLS], undefined, (toolName) => manager.isToolAvailable('proj-a', toolName));
    const manager = new McpServerManager(db, {
      onToolsChanged: (added, removed) => {
        for (const name of removed) registry.unregister(name);
        for (const def of added) {
          if (!registry.get(def.name)) registry.register(def);
        }
      },
      onRevokeTool: (name) => revoked.push(name),
    });
    managers.push(manager);

    // 1. Local stdio MCP server restricted to proj-a
    manager.addServer({
      id: 'demo',
      name: 'Demo Stdio MCP',
      transport: 'stdio',
      command: [PYTHON_EXE, '-u', '-c', DISPOSABLE_STDIO_MCP_SCRIPT],
      allowedProjects: ['proj-a'],
    });
    const enabled = await manager.enableServer('demo');
    expect(enabled.status).toBe('connected');
    expect(enabled.protocolVersion).toBe('2025-03-26');
    expect(enabled.tools).toContain('mcp.demo.echo_note');
    expect(enabled.tools).toContain('mcp.demo.get_current_time');

    // Built-in get_current_time is NOT overwritten!
    expect(registry.get('get_current_time')?.category).toBe('system');
    expect(registry.get('mcp.demo.echo_note')?.requiresApproval).toBe(true);

    // Per-project isolation enforced in backend
    expect(manager.isToolAvailable('proj-a', 'mcp.demo.echo_note')).toBe(true);
    expect(manager.isToolAvailable('proj-b', 'mcp.demo.echo_note')).toBe(false);

    // Execute tool
    const res = await manager.executeTool('mcp.demo.echo_note', { text: 'phase-d-ok' });
    expect(res.ok).toBe(true);
    expect(res.content).toContain('MCP_ECHO:phase-d-ok');
    expect(res.content).toContain('external untrusted output');

    // Disable revokes grants and unregisters tools
    await manager.disableServer('demo');
    expect(revoked).toContain('mcp.demo.echo_note');
    expect(registry.get('mcp.demo.echo_note')).toBeUndefined();

    // 2. Streamable HTTP MCP server (SSE response + redirect blocking)
    const httpSrv = http.createServer((req, res) => {
      if (req.url === '/redirect') {
        res.writeHead(302, { Location: 'https://evil.example.com' });
        res.end();
        return;
      }
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        if (req.method === 'DELETE') {
          res.writeHead(204);
          res.end();
          return;
        }
        const body = raw ? JSON.parse(raw) as { id?: number; method?: string } : {};
        if (body.method === 'notifications/initialized') {
          res.writeHead(202);
          res.end();
          return;
        }
        let payload: Record<string, unknown>;
        if (body.method === 'initialize') {
          payload = { jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'http-demo' } } };
        } else if (body.method === 'tools/list') {
          payload = { jsonrpc: '2.0', id: body.id, result: { tools: [{ name: 'status_check', description: 'Check status', inputSchema: { type: 'object' } }] } };
        } else {
          payload = { jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: 'HTTP_MCP_OK' }] } };
        }
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Mcp-Session-Id': 'sid-http-1' });
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
        res.end();
      });
    });
    await new Promise<void>((r) => httpSrv.listen(0, '127.0.0.1', () => r()));
    const port = (httpSrv.address() as AddressInfo).port;
    closeServers.push(() => new Promise<void>((r) => httpSrv.close(() => r())));

    manager.addServer({ id: 'remote-demo', name: 'HTTP Demo', transport: 'http', url: `http://127.0.0.1:${port}/mcp` });
    const httpView = await manager.enableServer('remote-demo');
    expect(httpView.status).toBe('connected');
    const httpCall = await manager.executeTool('mcp.remote-demo.status_check', {});
    expect(httpCall.ok).toBe(true);
    expect(httpCall.content).toContain('HTTP_MCP_OK');

    // Redirect attack blocked
    manager.addServer({ id: 'redir', name: 'Redirect Test', transport: 'http', url: `http://127.0.0.1:${port}/redirect` });
    await expect(manager.enableServer('redir')).rejects.toThrow(/redirect/i);
  }, 15_000);
});

describe('Phase D: OAuth 2.0 PKCE & Google Calendar REST v3 Integration', () => {
  it('validates PKCE, state, expiry, refresh, audience passthrough, and Google Calendar read/write operations', async () => {
    const pkce = generatePkcePair();
    const state = generateOAuthState();
    const config: OAuthClientConfig = {
      providerId: 'google-calendar',
      authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenEndpoint: 'https://oauth2.googleapis.com/token',
      clientId: 'test-client-id',
      redirectUri: 'http://127.0.0.1:43123/callback',
      scopes: [GOOGLE_CALENDAR_SCOPE_READONLY],
      audience: GOOGLE_CALENDAR_AUDIENCE,
    };

    const authUrl = buildOAuthAuthorizationUrl(config, state, pkce);
    expect(authUrl).toContain('code_challenge_method=S256');
    expect(authUrl).toContain(`state=${state}`);

    // CSRF state mismatch rejected
    expect(validateOAuthCallback({ expectedState: state, receivedState: 'wrong-state', code: 'abc' }).ok).toBe(false);
    expect(validateOAuthCallback({ expectedState: state, receivedState: state, code: 'auth-code-123' })).toEqual({ ok: true, code: 'auth-code-123' });

    // Token exchange & refresh against mock fetch
    const mockOAuthFetch = async () => new Response(JSON.stringify({
      access_token: 'ya29.mock-access',
      refresh_token: '1//mock-refresh',
      expires_in: 3600,
      token_type: 'Bearer',
      scope: `${GOOGLE_CALENDAR_SCOPE_READONLY} ${GOOGLE_CALENDAR_SCOPE_EVENTS}`,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });

    const token = await exchangeAuthorizationCode(config, 'auth-code-123', pkce.codeVerifier, mockOAuthFetch);
    expect(isTokenExpired(token)).toBe(false);
    expect(() => assertTokenAudience(token, 'https://evil.example.com/steal')).toThrow(/passthrough/i);
    expect(() => assertTokenAudience(token, 'https://www.googleapis.com/calendar/v3/calendars')).not.toThrow();

    const refreshed = await refreshAccessToken(config, token, mockOAuthFetch);
    expect(refreshed.accessToken).toBe('ya29.mock-access');

    // Read-only token refuses write operations
    const readOnlyToken: OAuthTokenRecord = { ...token, scopes: [GOOGLE_CALENDAR_SCOPE_READONLY] };
    const readOnlyClient = new GoogleCalendarClient(() => readOnlyToken, async () => new Response('{}', { status: 200 }));
    await expect(readOnlyClient.createEvent({ summary: 'Test', start: '2026-11-24T10:00:00Z', end: '2026-11-24T11:00:00Z' })).rejects.toThrow(/write scope/i);

    // Full Google Calendar read + write fixture flow
    const gcalFetch = async (url: string, init?: RequestInit) => {
      if (url.includes('/users/me/calendarList')) {
        return new Response(JSON.stringify({ items: [{ id: 'primary', summary: 'Personal', timeZone: 'UTC', primary: true, accessRole: 'owner' }] }), { status: 200 });
      }
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 'ev_new_1', summary: 'Design Review', start: { dateTime: '2026-11-25T14:00:00Z' }, end: { dateTime: '2026-11-25T15:00:00Z' }, status: 'confirmed' }), { status: 200 });
      }
      if (init?.method === 'DELETE') return new Response(null, { status: 204 });
      return new Response(JSON.stringify({ items: [{ id: 'ev_1', summary: 'Standup', start: { date: '2026-11-24' }, end: { date: '2026-11-25' }, status: 'confirmed' }] }), { status: 200 });
    };

    const client = new GoogleCalendarClient(() => token, gcalFetch);
    const cals = await client.listCalendars();
    expect(cals[0]?.primary).toBe(true);
    const events = await client.listEvents({ calendarId: 'primary' });
    expect(events[0]).toMatchObject({ id: 'ev_1', summary: 'Standup', allDay: true });
    const created = await client.createEvent({ summary: 'Design Review', start: '2026-11-25T14:00:00Z', end: '2026-11-25T15:00:00Z' });
    expect(created.id).toBe('ev_new_1');
    const del = await client.deleteEvent('primary', 'ev_new_1');
    expect(del.deleted).toBe(true);
  });
});

describe('Phase D: Dual-Runtime (TypeScript + Python pixel-agent-v2) Live MCP Tool Execution', () => {
  it('invokes a live local stdio MCP tool through PermissionBroker in both TypeScript and Python agents', async () => {
    const db = openDb();
    const registry = new ToolRegistry([...BUILTIN_TOOLS]);
    const manager = new McpServerManager(db, {
      onToolsChanged: (added, removed) => {
        for (const name of removed) registry.unregister(name);
        for (const def of added) if (!registry.get(def.name)) registry.register(def);
      },
    });
    managers.push(manager);

    manager.addServer({
      id: 'live',
      name: 'Live MCP',
      transport: 'stdio',
      command: [PYTHON_EXE, '-u', '-c', DISPOSABLE_STDIO_MCP_SCRIPT],
    });
    await manager.enableServer('live');

    const audit = new AuditLog();
    const tasks = new TaskManager(() => undefined);
    const prompted: string[] = [];
    const permissions = new PermissionBroker(registry, audit, (req) => {
      prompted.push(req.toolName);
      queueMicrotask(() => permissions.respond({ requestId: req.id, approved: true, duration: 'once' }));
    });
    const executors = new ToolExecutors({ mcp: manager });

    // 1. TypeScript AgentExecutor invoking mcp.live.echo_note
    let tsTurn = 0;
    const tsEngine: TurnRunner = {
      async runTurn() {
        tsTurn += 1;
        if (tsTurn === 1) {
          return {
            content: '',
            reasoning: '',
            toolCalls: [{ id: 'tc_ts', name: 'mcp.live.echo_note', argumentsJson: JSON.stringify({ text: 'from-ts' }) }],
            finishReason: 'tool_calls',
            aborted: false,
            failed: false,
          };
        }
        return { content: 'TS received MCP_ECHO:from-ts', reasoning: '', toolCalls: [], finishReason: 'stop', aborted: false, failed: false };
      },
    };
    const tsAgent = new AgentExecutor({
      engine: tsEngine,
      registry,
      permissions,
      tasks,
      audit,
      executors,
      emit: () => undefined,
      isStopped: () => false,
    });
    const tsRes = await tsAgent.run({
      requestId: 'req_mcp_ts',
      request: { text: 'Echo from TS', mode: 'agent' },
      model: 'deepseek-flash',
    });
    expect(tsRes.task.status).toBe('completed');
    expect(tsRes.executed[0]?.ok).toBe(true);

    // 2. Python pixel-agent-v2 invoking mcp.live.echo_note
    let pyStep = 0;
    const mockLlm = http.createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        if (pyStep++ === 0) {
          res.write(`data: ${JSON.stringify({
            choices: [{
              delta: { tool_calls: [{ index: 0, id: 'tc_py', type: 'function', function: { name: 'mcp.live.echo_note', arguments: JSON.stringify({ text: 'from-py' }) } }] },
              finish_reason: 'tool_calls',
            }],
          })}\n\n`);
        } else {
          res.write(`data: ${JSON.stringify({
            choices: [{ delta: { content: 'Python received MCP_ECHO:from-py' }, finish_reason: 'stop' }],
          })}\n\n`);
        }
        res.write('data: [DONE]\n\n');
        res.end();
      });
    });
    await new Promise<void>((r) => mockLlm.listen(0, '127.0.0.1', () => r()));
    const port = (mockLlm.address() as AddressInfo).port;
    closeServers.push(() => new Promise<void>((r) => mockLlm.close(() => r())));

    activeBridge = new PythonAgentBridge();
    const pyRunner = new PythonAgentRunner({
      bridge: activeBridge,
      registry,
      permissions,
      tasks,
      audit,
      executors,
      emit: () => undefined,
      isStopped: () => false,
      getApiKey: () => 'test-key',
      getProviderConfig: (model) => ({ provider: 'openai-compatible', baseUrl: `http://127.0.0.1:${port}/v1`, model }),
    });
    const pyRes = await pyRunner.run({
      requestId: 'req_mcp_py',
      request: { text: 'Echo from Python', mode: 'agent' },
      model: 'deepseek-flash',
    });

    expect(pyRes.task.status).toBe('completed');
    expect(pyRes.executed[0]?.name).toBe('mcp.live.echo_note');
    expect(pyRes.executed[0]?.ok).toBe(true);
    expect(pyRes.finalContent).toContain('MCP_ECHO:from-py');
    // Both TS and Python runs went through PermissionBroker!
    expect(prompted).toEqual(['mcp.live.echo_note', 'mcp.live.echo_note']);
  }, 20_000);
});
