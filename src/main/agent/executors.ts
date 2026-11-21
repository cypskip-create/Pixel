/**
 * Real tool implementations.
 *
 * Every handler here performs the action for real and reports what actually
 * happened. Nothing is simulated: if a tool cannot run, it returns an error
 * result that the model sees, rather than a plausible-looking success.
 *
 * Families:
 *  - read-only probes (time, system info) that cannot affect the machine;
 *  - state-changing actions (launch an app, type text) that the registry gates
 *    behind an explicit approval and that Guide mode cannot reach at all;
 *  - browser automation through Playwright, sharing one page across calls.
 *
 * Child processes are tracked so the emergency stop can terminate anything that
 * is still running.
 */

import { execFile } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { arch, cpus, freemem, networkInterfaces, platform, release, totalmem } from 'node:os';
import type { CaptureResult, ImageAttachment, ScreenWindowTarget, SearchProvider, VisualGuidanceShape } from '../../shared/types';
import { createSearchUrl, MAX_SEARCH_QUERY_LENGTH } from '../../shared/browserSearch';
import { BrowserSession } from './browser';
import { DesktopInputLease } from './inputLease';
import type { MemoryTools } from '../memory/toolset';
import type { DocumentTools } from '../documents/toolset';
import type { FileTools } from '../files/toolset';
import { terminateProcessTree } from '../services/process';
import { NativeHelperError } from '../services/nativeHelper';
import type { FindElementsQuery, LastExternalWindowResult, NativeHelper, UiElement, WindowInfo } from '../services/nativeHelper';
import { randomUUID } from 'node:crypto';
import { BOARD_HEIGHT, BOARD_WIDTH, wrapBoardText } from '../../shared/drawingBoard';
import type { BoardDiagramEdge, BoardObject, BoardOperation, BoardSnapshot } from '../../shared/drawingBoard';
import type { BoardFileFormat, PixelBoardService } from '../board/service';
import { isBoardTool } from '../board/tools';
import type { ProductivityTools } from '../productivity/toolset';

const sharedDesktopInputLease = new DesktopInputLease();

export interface ToolResult {
  ok: boolean;
  /** Text fed back to the model as the tool message. */
  content: string;
  /** Structured detail kept for the audit trail and the task rail. */
  detail?: Record<string, unknown>;
  /** Present when the tool failed, for classification in the UI. */
  errorCode?: 'TIMEOUT' | 'CANCELLED' | 'CRASHED' | 'DENIED' | 'NOT_FOUND' | 'UNAVAILABLE' | 'FAILED';
  verification?: { summary: string; source: string };
}

/** Applications Pixel is willing to launch. Anything else is refused. */
export const APPLICATION_ALLOWLIST: Record<string, string> = {
  notepad: 'notepad.exe',
  'notepad.exe': 'notepad.exe',
  calculator: 'calc.exe',
  calc: 'calc.exe',
  'calc.exe': 'calc.exe',
  paint: 'mspaint.exe',
  mspaint: 'mspaint.exe',
  explorer: 'explorer.exe',
  'file explorer': 'explorer.exe',
  settings: 'ms-settings:',
  'windows settings': 'ms-settings:',
  edge: 'msedge.exe',
  'microsoft edge': 'msedge.exe',
  chrome: 'chrome.exe',
  'google chrome': 'chrome.exe',
  code: 'code.cmd',
  'vs code': 'code.cmd',
  'visual studio code': 'code.cmd',
};

/** Per-tool wall clock limit. */
export const DEFAULT_TOOL_TIMEOUT_MS = 30_000;

export interface ExecutorDeps {
  /** Main-process text clipboard access. Never exposed to renderer code. */
  clipboard?: { readText(): string | Promise<string>; writeText(text: string): void | Promise<void> };
  /** Opens only paths independently validated by the home-scoped FileTools service. */
  openPath?: (path: string) => Promise<string>;
  /** Uses the operating system Recycle Bin after FileTools validates the path. */
  trashPath?: (path: string) => Promise<void>;
  /**
   * Capture access. Only called for `analyze_screen`, and only after the
   * permission flow has approved that specific call.
   */
  captureScreen?: (target: 'active_window' | 'last_external' | 'selected_window' | 'display', selected?: ScreenWindowTarget, displayId?: string) => Promise<CaptureResult>;
  /** Vision analysis of a captured image. */
  describeImage?: (image: ImageAttachment, question: string, signal?: AbortSignal) => Promise<string>;
  showVisualGuidance?: (request: {
    target: ScreenWindowTarget;
    selector: string;
    role?: string;
    shape: VisualGuidanceShape;
    label?: string;
    step?: number;
    durationMs: number;
    bounds: { x: number; y: number; width: number; height: number };
  }) => Promise<'visible' | 'waiting_foreground' | 'unavailable'>;
  clearVisualGuidance?: (selector?: string) => void;
  /** Shared browser session, created lazily on first use. */
  browser?: BrowserSession;
  /** Wave 3 memory tools, scoped to the active project. */
  memory?: MemoryTools;
  /** Wave 3 document tools. */
  documents?: DocumentTools;
  /** Project-scoped notes and personal task planning tools. */
  productivity?: ProductivityTools;
  /** Bounded, user-approved local file tools. */
  files?: FileTools;
  /** Isolated desktop-input lease for integration tests; production shares one lease. */
  inputLease?: DesktopInputLease;
  /** Wait for an explicit user handoff acknowledgement without granting authority. */
  requestHumanTakeover?: (taskId: string, reason: string, signal?: AbortSignal) => Promise<boolean>;
  /** Read-only Windows UI Automation helper. */
  nativeHelper?: NativeHelper;
  /** Convert the helper's physical pixel bounds to Electron DIP coordinates. */
  toDipRect?: (rect: WindowInfo['rect']) => WindowInfo['rect'];
  /** Opens only a validated HTTPS URL in the user's default browser. */
  openExternal?: (url: string) => Promise<void>;
  searchProvider?: () => SearchProvider;
  /** Main-process Board service and user-mediated file picker. */
  board?: PixelBoardService;
  chooseBoardFile?: (action: 'open' | 'save', format: BoardFileFormat, title: string) => Promise<{ path: string; overwrite?: boolean; replace?: boolean } | null>;
  /** Navigate the trusted Workspace to the Board after an agent edit. */
  focusBoard?: () => void;
}

export class ToolExecutors {
  private readonly children = new Set<ChildProcess>();
  private readonly deps: ExecutorDeps;
  private readonly inputLease: DesktopInputLease;
  private readonly clipboardSnapshots = new Map<string, { previous: string; written: string; expiresAt: number }>();
  private clipboardSnapshotTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(deps: ExecutorDeps = {}) {
    this.deps = deps;
    this.inputLease = deps.inputLease ?? sharedDesktopInputLease;
  }

  /** Terminate every child process and close the browser. Returns kill count. */
  killAll(): number {
    let killed = 0;
    for (const child of this.children) {
      try {
        if (child.exitCode === null) {
          terminateProcessTree(child);
          killed += 1;
        }
      } catch {
        // The process may already be gone.
      }
    }
    this.children.clear();
    this.clipboardSnapshots.clear();
    if (this.clipboardSnapshotTimer) clearTimeout(this.clipboardSnapshotTimer);
    this.clipboardSnapshotTimer = null;
    if (this.deps.browser) void this.deps.browser.close();
    this.deps.nativeHelper?.dispose();
    return killed;
  }

  /** Dispatch one call. Never throws: failures become ToolResult. */
  async run(name: string, args: Record<string, unknown>, signal?: AbortSignal, context?: { taskId: string }): Promise<ToolResult> {
    if (signal?.aborted) return cancelledResult(name);

    let releaseInput: (() => void) | null = null;
    if (name === 'type_text' || name === 'clipboard_paste' || name === 'invoke_ui_element' || name === 'control_ui_element') {
      releaseInput = await this.inputLease.acquire(signal);
      if (!releaseInput || signal?.aborted) {
        releaseInput?.();
        return cancelledResult(name);
      }
    }

    // Anything this call starts is killed if the signal fires. Tools run one at
    // a time, so "children that did not exist before this call" is exactly the
    // set that belongs to it.
    const before = new Set(this.children);
    const isBrowserTool = name.startsWith('browser_') && name !== 'browser_open_search';
    const onAbort = (): void => {
      this.killChildrenSince(before);
      // An in-flight page operation can only be interrupted by closing the
      // session; it is recreated on the next browser tool call.
      if (isBrowserTool && this.deps.browser) void this.deps.browser.close();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const result = await this.dispatch(name, args, signal, context?.taskId);
      if (signal?.aborted && isBrowserTool && this.deps.browser) await this.deps.browser.close();
      // The OS browser launch cannot be undone once accepted. Report the real
      // result if cancellation races with the short external-launch call.
      return signal?.aborted && name !== 'browser_open_search' ? cancelledResult(name) : result;
    } finally {
      signal?.removeEventListener('abort', onAbort);
      if (releaseInput && this.deps.nativeHelper?.terminating) {
        await this.deps.nativeHelper.whenStopped();
      }
      releaseInput?.();
    }
  }

  private killChildrenSince(before: Set<ChildProcess>): void {
    for (const child of this.children) {
      if (before.has(child)) continue;
      try {
        if (child.exitCode === null) terminateProcessTree(child);
      } catch {
        /* already gone */
      }
    }
  }

  private async dispatch(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
    taskId?: string,
  ): Promise<ToolResult> {
    try {
      // Wave 3 tool sets own their own dispatch; they are composed here so the
      // agent loop keeps a single execution entry point.
      if (this.deps.memory?.handles(name)) {
        return this.deps.memory.run(name, args);
      }
      if (this.deps.documents?.handles(name)) {
        return await this.deps.documents.run(name, args, signal);
      }
      if (this.deps.productivity?.handles(name)) {
        return this.deps.productivity.run(name, args);
      }
      if (name === 'file_open' && this.deps.files?.handles(name)) {
        return await this.deps.files.open(args, this.deps.openPath);
      }
      if (name === 'file_trash' && this.deps.files?.handles(name)) {
        return await this.deps.files.trash(args, this.deps.trashPath, signal);
      }
      if (this.deps.files?.handles(name)) {
        return this.deps.files.run(name, args);
      }
      if (isBoardTool(name)) return await this.runBoardTool(name, args, signal);

      switch (name) {
        case 'get_current_time':
          return this.getCurrentTime();
        case 'clipboard_read':
          return await this.readClipboard();
        case 'clipboard_copy':
          return await this.copyClipboard(args);
        case 'clipboard_restore':
          return await this.restoreClipboard(args);
        case 'clipboard_paste':
          return await this.pasteClipboard(args, signal);
        case 'request_human_takeover': {
          const reason = typeof args.reason === 'string' ? args.reason.trim() : '';
          if (!this.deps.requestHumanTakeover || !taskId) {
            return { ok: false, content: 'Human takeover is unavailable in this task context.', errorCode: 'UNAVAILABLE' };
          }
          const continued = await this.deps.requestHumanTakeover(taskId, reason, signal);
          if (!continued) return signal?.aborted
            ? cancelledResult(name)
            : { ok: false, content: 'The task was not continued. Stop or leave it paused for the user.', errorCode: 'CANCELLED' };
          return {
            ok: true,
            content: 'The user indicated that the handoff is complete. Re-observe the current environment before any further action; the acknowledgement is not proof that the requested change succeeded.',
            detail: { handoffAcknowledged: true },
          };
        }
        case 'get_system_info':
          return this.getSystemInfo();
        case 'analyze_screen':
          return await this.analyzeScreen(args, signal);
        case 'screen_highlight_control':
          return await this.highlightControl(args, signal);
        case 'screen_draw_arrow':
          return await this.highlightControl({ ...args, shape: 'arrow' }, signal);
        case 'screen_clear_annotations':
          this.deps.clearVisualGuidance?.(typeof args.selector === 'string' ? args.selector : undefined);
          return { ok: true, content: 'Pixel visual guidance annotations were cleared.', detail: { cleared: true } };
        case 'get_foreground_window':
          return await this.getForegroundWindow(signal);
        case 'get_last_external_foreground_window':
          return await this.getLastExternalForegroundWindow(signal);
        case 'list_external_windows':
          return await this.listExternalWindows(signal);
        case 'find_ui_elements':
          return await this.findUiElements(args, signal);
        case 'verify_ui_state':
          return await this.verifyUiState(args, signal);
        case 'invoke_ui_element':
          return await this.invokeUiElement(args, signal);
        case 'control_ui_element':
          return await this.controlUiElement(args, signal);
        case 'open_application':
          return await this.openApplication(args, signal);
        case 'type_text':
          return await this.typeText(args, signal);
        case 'browser_navigate':
          return await this.browserNavigate(args);
        case 'browser_new_tab':
          return await this.browserNewTab(args);
        case 'browser_list_tabs':
          return await this.browserListTabs();
        case 'browser_switch_tab':
          return await this.browserSwitchTab(args);
        case 'browser_close_tab':
          return await this.browserCloseTab(args);
        case 'browser_open_search':
          return await this.browserOpenSearch(args, signal);
        case 'browser_inspect':
          return await this.browserInspect();
        case 'browser_click':
          return await this.browserClick(args);
        case 'browser_type':
          return await this.browserType(args);
        case 'browser_scroll':
          return await this.browserScroll(args);
        case 'browser_screenshot':
          return await this.browserScreenshot();
        case 'browser_verify':
          return await this.browserVerify(args);
        default:
          return {
            ok: false,
            content: `Pixel has no implementation for the tool "${name}".`,
            errorCode: 'NOT_FOUND',
          };
      }
    } catch (error) {
      if (error instanceof NativeHelperError) {
        const errorCode = error.code === 'UNAVAILABLE' ? 'UNAVAILABLE'
          : error.code === 'TIMEOUT' ? 'TIMEOUT'
            : error.code === 'CANCELLED' ? 'CANCELLED'
              : error.code === 'CRASHED' ? 'CRASHED' : 'FAILED';
        return { ok: false, content: `The tool "${name}" failed: ${error.message}`, errorCode };
      }
      return {
        ok: false,
        content: `The tool "${name}" failed: ${message(error)}`,
        errorCode: 'FAILED',
      };
    }
  }

  private async readClipboard(): Promise<ToolResult> {
    if (!this.deps.clipboard) return { ok: false, content: 'Windows text clipboard access is unavailable.', errorCode: 'UNAVAILABLE' };
    const text = await this.deps.clipboard.readText();
    if (!text) return { ok: true, content: 'The text clipboard is empty or contains a non-text item.', detail: { characters: 0 }, verification: { summary: 'The main-process text clipboard read returned no text.', source: 'Electron clipboard text read' } };
    if (looksLikeClipboardSecret(text)) return { ok: false, content: 'Pixel did not read clipboard content because it matches a common credential or bearer-token pattern. Clear or replace the clipboard before asking again.', errorCode: 'DENIED' };
    const bounded = text.slice(0, 20_000);
    return {
      ok: true,
      content: `Clipboard text (${text.length > bounded.length ? `first ${bounded.length} of ${text.length} characters` : `${bounded.length} characters`}):\n${bounded}`,
      detail: { characters: bounded.length, truncated: text.length > bounded.length },
      verification: { summary: `Read ${bounded.length} characters from the current text clipboard; clipboard contents are not recorded in the audit detail.`, source: 'Electron clipboard text read' },
    };
  }

  private async copyClipboard(args: Record<string, unknown>): Promise<ToolResult> {
    if (!this.deps.clipboard) return { ok: false, content: 'Windows text clipboard access is unavailable.', errorCode: 'UNAVAILABLE' };
    const text = typeof args.text === 'string' ? args.text : '';
    if (!text.trim()) return { ok: false, content: 'Provide non-empty text to copy.', errorCode: 'FAILED' };
    if (text.length > 20_000) return { ok: false, content: 'Clipboard text exceeds the 20,000 character limit.', errorCode: 'FAILED' };
    this.expireClipboardSnapshots();
    const previous = await this.deps.clipboard.readText();
    await this.deps.clipboard.writeText(text);
    if (await this.deps.clipboard.readText() !== text) return { ok: false, content: 'Pixel wrote to the clipboard but could not verify the copied text.', errorCode: 'FAILED' };
    // A restore snapshot is optional. Do not retain credential-like or large
    // prior values in memory just to offer undo for an otherwise valid copy.
    if (previous.length > 20_000 || looksLikeClipboardSecret(previous)) {
      return {
        ok: true,
        content: `Copied ${text.length} characters to the Windows text clipboard and verified the write. The prior clipboard value was not retained for restoration because it was sensitive or exceeded the 20,000 character snapshot limit.`,
        detail: { characters: text.length, verified: true, restorable: false },
        verification: { summary: `The text clipboard read-back matched all ${text.length} approved characters.`, source: 'Electron clipboard text read-back' },
      };
    }
    const restoreToken = randomUUID();
    this.clipboardSnapshots.set(restoreToken, { previous, written: text, expiresAt: Date.now() + 5 * 60_000 });
    this.scheduleClipboardSnapshotExpiry();
    return {
      ok: true,
      content: `Copied ${text.length} characters to the Windows text clipboard and verified the write. The previous text snapshot can be restored for five minutes with restore token ${restoreToken}.`,
      detail: { characters: text.length, restoreToken, verified: true },
      verification: { summary: `The text clipboard read-back matched all ${text.length} approved characters.`, source: 'Electron clipboard text read-back' },
    };
  }

  private async restoreClipboard(args: Record<string, unknown>): Promise<ToolResult> {
    if (!this.deps.clipboard) return { ok: false, content: 'Windows text clipboard access is unavailable.', errorCode: 'UNAVAILABLE' };
    this.expireClipboardSnapshots();
    const token = typeof args.restoreToken === 'string' ? args.restoreToken : '';
    const snapshot = this.clipboardSnapshots.get(token);
    if (!snapshot) return { ok: false, content: 'That clipboard restore snapshot is missing or expired.', errorCode: 'NOT_FOUND' };
    if (await this.deps.clipboard.readText() !== snapshot.written) {
      this.clipboardSnapshots.delete(token);
      return { ok: false, content: 'Pixel left the clipboard unchanged because another application or user changed it after Pixel copied text.', errorCode: 'DENIED' };
    }
    await this.deps.clipboard.writeText(snapshot.previous);
    this.clipboardSnapshots.delete(token);
    if (await this.deps.clipboard.readText() !== snapshot.previous) return { ok: false, content: 'Pixel attempted to restore the prior text clipboard, but read-back did not match.', errorCode: 'FAILED' };
    return { ok: true, content: 'Restored the previous text clipboard and verified it without returning or logging its contents.', detail: { restored: true }, verification: { summary: 'The prior text clipboard was restored after confirming Pixel still owned the current clipboard contents.', source: 'Electron clipboard text read-back' } };
  }

  private async pasteClipboard(args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> {
    if (!this.deps.clipboard) return { ok: false, content: 'Windows text clipboard access is unavailable.', errorCode: 'UNAVAILABLE' };
    const text = await this.deps.clipboard.readText();
    if (!text) return { ok: false, content: 'The text clipboard is empty or contains a non-text item.', errorCode: 'NOT_FOUND' };
    if (looksLikeClipboardSecret(text)) return { ok: false, content: 'Pixel refused to place credential-like clipboard text into an application field.', errorCode: 'DENIED' };
    if (text.length > 2_000) return { ok: false, content: 'Clipboard text is longer than the 2,000 character safe field limit.', errorCode: 'FAILED' };
    return this.typeText({ ...args, text }, signal);
  }

  private expireClipboardSnapshots(): void {
    const now = Date.now();
    for (const [token, snapshot] of this.clipboardSnapshots) if (snapshot.expiresAt <= now) this.clipboardSnapshots.delete(token);
    while (this.clipboardSnapshots.size > 8) {
      const first = this.clipboardSnapshots.keys().next().value as string | undefined;
      if (!first) break;
      this.clipboardSnapshots.delete(first);
    }
  }

  private scheduleClipboardSnapshotExpiry(): void {
    if (this.clipboardSnapshotTimer) clearTimeout(this.clipboardSnapshotTimer);
    const nextExpiry = Math.min(...[...this.clipboardSnapshots.values()].map((snapshot) => snapshot.expiresAt));
    if (!Number.isFinite(nextExpiry)) {
      this.clipboardSnapshotTimer = null;
      return;
    }
    this.clipboardSnapshotTimer = setTimeout(() => {
      this.clipboardSnapshotTimer = null;
      this.expireClipboardSnapshots();
      if (this.clipboardSnapshots.size) this.scheduleClipboardSnapshotExpiry();
    }, Math.max(0, nextExpiry - Date.now()));
    this.clipboardSnapshotTimer.unref?.();
  }

  private async runBoardTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> {
    const board = this.deps.board;
    if (!board) return { ok: false, content: 'Pixel Board is unavailable in this application session.', errorCode: 'UNAVAILABLE' };
    if (signal?.aborted) return cancelledResult(name);
    let snapshot: BoardSnapshot;
    let operation = name;

    switch (name) {
      case 'board_get_state': {
        snapshot = board.getSnapshot();
        const items = snapshot.document.objects.slice(0, 100).map((item) => ({ id: item.id, kind: item.kind, text: item.text?.slice(0, 180), points: item.points.slice(0, 6) }));
        return {
          ok: true,
          content: `Pixel Board “${snapshot.document.title}” revision ${snapshot.revision} has ${snapshot.document.objects.length} editable objects.${snapshot.document.objects.length > items.length ? ` First ${items.length} shown; ask for a specific object if needed.` : ''}\n${items.map((item, index) => `${index + 1}. ${item.kind} ${item.id}${item.text ? `: ${item.text.replace(/\n/g, ' / ')}` : ''}`).join('\n')}`,
          detail: { title: snapshot.document.title, revision: snapshot.revision, objectCount: snapshot.document.objects.length, objects: items },
          verification: { summary: `Main-process Board revision ${snapshot.revision} returned ${snapshot.document.objects.length} editable objects.`, source: 'Pixel Board service snapshot' },
        };
      }
      case 'board_create':
        snapshot = board.create(String(args.title ?? 'Untitled board'));
        break;
      case 'board_add_text': {
        const current = board.getSnapshot();
        const rawText = typeof args.text === 'string' ? args.text.trim() : '';
        if (!rawText) throw new Error('Provide text to add to the Board.');
        const text = wrapBoardText(rawText);
        const x = numberArgument(args.x, 48);
        const y = args.y === undefined ? findBoardTextBaseline(current.document.objects, x, text, 4) : numberArgument(args.y, NaN);
        if (!Number.isFinite(x) || x < 0 || x > BOARD_WIDTH || !Number.isFinite(y) || y < 20 || y > BOARD_HEIGHT) throw new Error('The text block is outside Pixel Board bounds.');
        if (textOverlapsObjects(current.document.objects, x, y, text, 4)) throw new Error('That text would overlap existing Board content. Choose another position or a shorter note.');
        const object: BoardObject = { id: randomUUID(), kind: 'text', points: [{ x, y }], text: text.slice(0, 2_000), color: validColor(args.color) ?? '#F3F3F3', width: 4 };
        snapshot = board.apply([{ type: 'add', object }]);
        operation = `added text object ${object.id}`;
        break;
      }
      case 'board_add_shape': {
        const shape = args.shape;
        if (!['line', 'arrow', 'rectangle', 'circle'].includes(String(shape))) throw new Error('Choose a line, arrow, rectangle, or circle.');
        const x = numberArgument(args.x, NaN); const y = numberArgument(args.y, NaN);
        const width = numberArgument(args.width, NaN); const height = numberArgument(args.height, NaN);
        const endX = x + width; const endY = y + height;
        if (![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0 || endX > BOARD_WIDTH || endY > BOARD_HEIGHT) throw new Error('The requested shape is outside Pixel Board bounds.');
        const object: BoardObject = { id: randomUUID(), kind: shape as BoardObject['kind'], points: [{ x, y }, { x: endX, y: endY }], color: validColor(args.color) ?? '#4299F5', width: 3 };
        snapshot = board.apply([{ type: 'add', object }]);
        operation = `added ${object.kind} object ${object.id}`;
        break;
      }
      case 'board_add_stroke': {
        if (args.kind !== 'pen' && args.kind !== 'highlighter') throw new Error('Choose pen or highlighter.');
        const points = Array.isArray(args.points) ? args.points as BoardObject['points'] : [];
        if (points.length < 2 || points.length > 500) throw new Error('A stroke requires 2 to 500 points.');
        const object: BoardObject = { id: randomUUID(), kind: args.kind, points, color: validColor(args.color) ?? '#4299F5', width: numberArgument(args.width, 5) };
        snapshot = board.apply([{ type: 'add', object }]);
        operation = `added ${object.kind} stroke ${object.id}`;
        break;
      }
      case 'board_add_marker': {
        const stepCount = board.getSnapshot().document.objects.filter((item) => item.kind === 'marker').length;
        const step = Number.isInteger(args.step) ? Number(args.step) : stepCount + 1;
        const object: BoardObject = { id: randomUUID(), kind: 'marker', points: [{ x: numberArgument(args.x, NaN), y: numberArgument(args.y, NaN) }], step, color: '#4299F5', width: 3 };
        snapshot = board.apply([{ type: 'add', object }]);
        operation = `added step marker ${object.id}`;
        break;
      }
      case 'board_create_diagram': {
        const nodes = Array.isArray(args.nodes) ? args.nodes as string[] : [];
        const edges = Array.isArray(args.edges) ? args.edges as BoardDiagramEdge[] : [];
        snapshot = board.createDiagram(String(args.title ?? ''), nodes, edges);
        operation = `created a diagram with ${nodes.length} nodes and ${edges.length} connectors`;
        break;
      }
      case 'board_update_object': {
        const id = String(args.id ?? '');
        const patch: Partial<Pick<BoardObject, 'text' | 'color' | 'width'>> = {};
        if (typeof args.text === 'string') patch.text = args.text.slice(0, 2_000);
        if (typeof args.color === 'string') patch.color = args.color;
        if (args.width !== undefined) patch.width = numberArgument(args.width, NaN);
        const operations: BoardOperation[] = [];
        if (Object.keys(patch).length) operations.push({ type: 'update', id, patch });
        if (args.dx !== undefined || args.dy !== undefined) operations.push({ type: 'move', id, dx: numberArgument(args.dx, 0), dy: numberArgument(args.dy, 0) });
        if (!operations.length) throw new Error('Provide text, color, width, dx, or dy to update this object.');
        snapshot = board.apply(operations);
        operation = `updated object ${id}`;
        break;
      }
      case 'board_delete_object':
        snapshot = board.apply([{ type: 'delete', id: String(args.id ?? '') }]);
        operation = `deleted object ${String(args.id ?? '')}`;
        break;
      case 'board_clear':
        snapshot = board.apply([{ type: 'clear' }]);
        break;
      case 'board_undo':
        if (!board.getSnapshot().canUndo) return { ok: false, content: 'There is no previous Board edit to undo.', errorCode: 'NOT_FOUND' };
        snapshot = board.undo();
        break;
      case 'board_redo':
        if (!board.getSnapshot().canRedo) return { ok: false, content: 'There is no undone Board edit to redo.', errorCode: 'NOT_FOUND' };
        snapshot = board.redo();
        break;
      case 'board_open': {
        if (!this.deps.chooseBoardFile) return { ok: false, content: 'Pixel cannot open Board files because the native file picker is unavailable.', errorCode: 'UNAVAILABLE' };
        const chosen = await this.deps.chooseBoardFile('open', 'pixelboard', board.getSnapshot().document.title);
        if (!chosen || signal?.aborted) return signal?.aborted ? cancelledResult(name) : { ok: false, content: 'Opening a Board was cancelled.', errorCode: 'CANCELLED' };
        snapshot = board.openFromFile(chosen.path, chosen.replace === true);
        operation = `opened ${chosen.path}`;
        break;
      }
      case 'board_save':
      case 'board_export': {
        if (!this.deps.chooseBoardFile) return { ok: false, content: 'Pixel cannot save Board files because the native file picker is unavailable.', errorCode: 'UNAVAILABLE' };
        const format: BoardFileFormat = name === 'board_save' ? 'pixelboard' : 'svg';
        const chosen = await this.deps.chooseBoardFile('save', format, board.getSnapshot().document.title);
        if (!chosen || signal?.aborted) return signal?.aborted ? cancelledResult(name) : { ok: false, content: 'Saving the Board was cancelled.', errorCode: 'CANCELLED' };
        const saved = board.saveToFile(chosen.path, format, chosen.overwrite === true);
        return { ok: true, content: `Saved ${format === 'pixelboard' ? 'editable Pixel Board' : 'SVG export'} to ${saved.path} (${saved.bytes} bytes); the file contents were verified.`, detail: saved, verification: { summary: `The ${format} file exists at ${saved.path} and passed read-back validation.`, source: 'main-process file read-back' } };
      }
      default:
        return { ok: false, content: `Pixel Board does not implement ${name}.`, errorCode: 'NOT_FOUND' };
    }

    if (signal?.aborted) return cancelledResult(name);
    if (!['board_get_state', 'board_save', 'board_export'].includes(name)) this.deps.focusBoard?.();
    const summary = `${operation}; revision ${snapshot.revision}; ${snapshot.document.objects.length} editable object(s)`;
    return {
      ok: true,
      content: `Pixel Board ${summary}.`,
      detail: { operation: name, revision: snapshot.revision, title: snapshot.document.title, objectCount: snapshot.document.objects.length, ids: snapshot.document.objects.slice(-20).map((object) => object.id) },
      verification: { summary: `The main-process Board snapshot confirms revision ${snapshot.revision} with ${snapshot.document.objects.length} objects.`, source: 'Pixel Board service postcondition' },
    };
  }

  /* ----------------------------- read-only ---------------------------- */

  private getCurrentTime(): ToolResult {
    const now = new Date();
    const detail = {
      iso: now.toISOString(),
      local: now.toLocaleString('en-GB', { hour12: false }),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
    return {
      ok: true,
      content: `Current local time: ${detail.local} (${detail.timeZone}); UTC ${detail.iso}.`,
      detail,
    };
  }

  private getSystemInfo(): ToolResult {
    const cpuList = cpus();
    // Adapter names and protocol families are useful diagnostics; addresses and
    // hardware identifiers are intentionally not sent to the model.
    const interfaces = Object.entries(networkInterfaces()).map(([name, addresses]) => ({
      name,
      ipv4: addresses?.some((address) => address.family === 'IPv4') ?? false,
      ipv6: addresses?.some((address) => address.family === 'IPv6') ?? false,
      internal: addresses?.every((address) => address.internal) ?? true,
    }));
    const detail = {
      platform: platform(),
      release: release(),
      arch: arch(),
      cpuModel: cpuList[0]?.model ?? 'unknown',
      cpuCount: cpuList.length,
      totalMemoryGb: round(totalmem() / 1024 ** 3),
      freeMemoryGb: round(freemem() / 1024 ** 3),
      networkInterfaces: interfaces,
    };
    return {
      ok: true,
      content: [
        `Platform: ${detail.platform} ${detail.release} (${detail.arch})`,
        `CPU: ${detail.cpuModel}, ${detail.cpuCount} cores`,
        `Memory: ${detail.freeMemoryGb} GB free of ${detail.totalMemoryGb} GB`,
        `Network adapters: ${interfaces.length === 0 ? 'none detected' : interfaces.map((item) => `${item.name} (${[item.ipv4 ? 'IPv4' : '', item.ipv6 ? 'IPv6' : ''].filter(Boolean).join('/') || 'no address'}${item.internal ? ', internal' : ''})`).join(', ')}`,
      ].join('\n'),
      detail,
    };
  }

  /* ------------------------------ screen ------------------------------ */

  private async analyzeScreen(args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> {
    const question =
      typeof args.question === 'string' && args.question.trim().length > 0
        ? args.question.trim()
        : 'Describe what is on the screen.';
    const target = args.target === 'active_window' || args.target === 'last_external' ||
      args.target === 'selected_window' ? args.target : 'display';

    if (!this.deps.captureScreen) {
      return {
        ok: false,
        content: 'Screen capture is not available in this build of Pixel.',
        errorCode: 'UNAVAILABLE',
      };
    }
    if (!this.deps.describeImage) {
      return {
        ok: false,
        content: 'Pixel cannot analyse images because no vision model is configured.',
        errorCode: 'UNAVAILABLE',
      };
    }

    const hasAnyTargetIdentity = ['targetWindowId', 'expectedWindowTitle', 'expectedProcessId', 'expectedProcessName'].some((key) => args[key] !== undefined);
    const hasTargetIdentity = typeof args.targetWindowId === 'string' && typeof args.expectedWindowTitle === 'string' &&
      typeof args.expectedProcessId === 'number' && typeof args.expectedProcessName === 'string';
    if (hasAnyTargetIdentity && (!hasTargetIdentity || target !== 'selected_window')) {
      return { ok: false, content: 'A window identity can only be used with target "selected_window". Re-list windows and select one exact target.', errorCode: 'FAILED' };
    }
    if (target === 'selected_window' && !hasTargetIdentity) {
      return { ok: false, content: 'Select one exact window from the current external-window list before capturing it.', errorCode: 'FAILED' };
    }
    const selected: ScreenWindowTarget | undefined = hasTargetIdentity ? {
      windowId: args.targetWindowId as string,
      title: args.expectedWindowTitle as string,
      pid: args.expectedProcessId as number,
      processName: args.expectedProcessName as string,
    } : undefined;
    const capture = await this.deps.captureScreen(target, selected, typeof args.displayId === 'string' ? args.displayId : undefined);
    if (!capture.ok || !capture.image) {
      return {
        ok: false,
        content: capture.error?.message ?? 'The screen could not be captured.',
        errorCode: capture.error?.code === 'TIMEOUT'
          ? 'TIMEOUT'
          : capture.error?.code === 'UNAUTHORIZED'
            ? 'DENIED'
            : capture.error?.code === 'MODEL_CAPABILITY'
              ? 'UNAVAILABLE'
              : 'FAILED',
        detail: capture.metadata ? { ...capture.metadata } : undefined,
      };
    }

    if (signal?.aborted) return cancelledResult('analyze_screen');
    const description = (await this.deps.describeImage(capture.image, question, signal)).trim();
    if (!description) {
      return { ok: false, content: 'The image was captured, but the configured vision model returned no description.', errorCode: 'FAILED', detail: capture.metadata ? { ...capture.metadata } : undefined };
    }
    const metadata = capture.metadata;
    const observedTarget = metadata?.targetWindow
      ? metadata.targetWindow.title + ' (' + metadata.targetWindow.processName + ', PID ' + metadata.targetWindow.pid + ')'
      : (capture.displayLabel ?? 'display ' + (metadata?.displayId ?? 'unknown'));
    const capturedAt = metadata ? new Date(metadata.capturedAt).toISOString() : 'unknown time';
    return {
      ok: true,
      content: 'Captured ' + observedTarget + ' at ' + capturedAt + '. The following is vision-model interpretation, not UI Automation verification: ' + description,
      detail: {
        target,
        width: capture.image.width,
        height: capture.image.height,
        question,
        capture: metadata ? { ...metadata } : undefined,
        observation: { source: 'vision_model', verified: false, capturedAt, uncertainty: 'Visual interpretation is model-inferred; individual control bounds are not verified.' },
      },
    };
  }

  private async highlightControl(args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> {
    if (!this.deps.nativeHelper || !this.deps.showVisualGuidance) {
      return { ok: false, content: 'Windows UI Automation and the visual-guidance overlay are unavailable.', errorCode: 'UNAVAILABLE' };
    }
    const selector = typeof args.selector === 'string' ? args.selector.trim() : '';
    const target = selectedWindowTarget(args);
    if (!selector || !target) {
      return { ok: false, content: 'Provide an exact UI Automation selector and a complete selected-window identity.', errorCode: 'FAILED' };
    }
    const role = typeof args.role === 'string' ? args.role : undefined;
    const shape: VisualGuidanceShape = args.shape === 'circle' || args.shape === 'arrow' ? args.shape : 'rectangle';
    const label = typeof args.label === 'string' ? args.label.trim().slice(0, 100) : undefined;
    const step = typeof args.step === 'number' && Number.isInteger(args.step) && args.step > 0 && args.step <= 99 ? args.step : undefined;
    const durationMs = typeof args.durationMs === 'number' ? Math.max(3_000, Math.min(30_000, Math.trunc(args.durationMs))) : 8_000;
    const found = await this.deps.nativeHelper.call('find_elements', {
      text: selector,
      ...(role ? { roles: [role] } : {}),
      maxResults: 25,
      targetWindowId: target.windowId,
      expectedWindowTitle: target.title,
      expectedProcessId: target.pid,
      expectedProcessName: target.processName,
    }, signal);
    if (found.window.windowId !== target.windowId || found.window.pid !== target.pid ||
      found.window.title !== target.title || found.window.processName.toLocaleLowerCase() !== target.processName.toLocaleLowerCase()) {
      return { ok: false, content: 'The selected application identity changed during control search. No highlight was drawn.', errorCode: 'FAILED' };
    }
    const exact = found.elements.filter((element) =>
      element.automationId === selector || element.name.localeCompare(selector, undefined, { sensitivity: 'accent' }) === 0);
    if (exact.length !== 1 || exact[0].rect.width <= 0 || exact[0].rect.height <= 0) {
      return {
        ok: false,
        content: exact.length === 0
          ? 'Pixel could not verify an exact accessible control named or identified "' + selector + '". No highlight was drawn.'
          : 'Pixel found ' + exact.length + ' exact matches for "' + selector + '". Choose a more specific accessible name or AutomationId; no highlight was drawn.',
        errorCode: 'NOT_FOUND',
        detail: { matchedCount: exact.length, source: 'ui_automation', verified: false },
      };
    }
    if (signal?.aborted) return cancelledResult('screen_highlight_control');
    const bounds = this.deps.toDipRect?.(exact[0].rect) ?? exact[0].rect;
    const status = await this.deps.showVisualGuidance({
      target, selector, ...(role ? { role } : {}), shape, ...(label ? { label } : {}), ...(step ? { step } : {}), durationMs, bounds,
    });
    if (status === 'unavailable') {
      return { ok: false, content: 'Pixel verified the UI Automation control, but could not display the visual guidance. No action was taken.', errorCode: 'UNAVAILABLE' };
    }
    const visible = status === 'visible';
    return {
      ok: true,
      content: visible
        ? 'Pixel verified the exact ' + exact[0].role + ' control "' + exact[0].name + '" in ' + target.title + ' and displayed the ' + (shape === 'arrow' ? 'arrow' : 'highlight') + ' at its current bounds. You can interact with it yourself; Pixel did not click it.'
        : 'Pixel verified the exact ' + exact[0].role + ' control "' + exact[0].name + '" in ' + target.title + '. The ' + (shape === 'arrow' ? 'arrow' : 'highlight') + ' will appear when that exact application is foreground; Pixel did not switch applications or click it.',
      detail: {
        source: 'ui_automation',
        verified: true,
        observedAt: found.window.observedAt,
        annotationStatus: visible ? 'visible' : 'waiting_foreground',
        target,
        element: exact[0],
        bounds,
      },
    };
  }

  private async getForegroundWindow(signal?: AbortSignal): Promise<ToolResult> {
    if (!this.deps.nativeHelper) {
      return { ok: false, content: 'Windows UI Automation is not available in this build.', errorCode: 'UNAVAILABLE' };
    }
    const window = await this.deps.nativeHelper.call('foreground_window', {}, signal);
    if (!window) return { ok: true, content: 'There is no foreground window.', detail: { window: null } };
    const rect = this.deps.toDipRect?.(window.rect) ?? window.rect;
    const detail = { ...window, physicalRect: window.rect, rect, coordinateSpace: 'electron_dip' };
    return {
      ok: true,
      content: `Foreground window: ${window.title || '(untitled)'} (${window.processName || 'unknown process'}, PID ${window.pid}). Window ref ${window.windowId}. Last observed ${new Date(window.observedAt).toISOString()}. Bounds in desktop DIP: x=${rect.x}, y=${rect.y}, width=${rect.width}, height=${rect.height}${window.isMinimized ? '; minimized' : ''}.`,
      detail,
    };
  }

  private async getLastExternalForegroundWindow(signal?: AbortSignal): Promise<ToolResult> {
    if (!this.deps.nativeHelper) {
      return { ok: false, content: 'Windows foreground tracking is not available in this build.', errorCode: 'UNAVAILABLE' };
    }
    const result: LastExternalWindowResult = await this.deps.nativeHelper.lastExternalForegroundWindow(signal);
    if (result.status === 'unavailable') {
      return { ok: true, content: `No external foreground window is available: ${result.reason}`, detail: { status: result.status } };
    }
    const physicalRect = result.window.rect;
    const rect = this.deps.toDipRect?.(physicalRect) ?? physicalRect;
    const window = { ...result.window, physicalRect, rect, coordinateSpace: 'electron_dip' };
    if (result.status === 'stale') {
      return {
        ok: true,
        content: `The last external window was ${result.window.title || '(untitled)'} (${result.window.processName}, PID ${result.window.pid}), observed ${new Date(result.window.observedAt).toISOString()}, but it is stale: ${result.reason} Do not target its expired window ref.`,
        detail: { status: result.status, window: { ...window, windowId: undefined }, reason: result.reason },
      };
    }
    return {
      ok: true,
      content: `Last external foreground window: ${result.window.title || '(untitled)'} (${result.window.processName}, PID ${result.window.pid}). Window ref ${result.window.windowId}. Last observed ${new Date(result.window.observedAt).toISOString()}. Bounds in desktop DIP: x=${rect.x}, y=${rect.y}, width=${rect.width}, height=${rect.height}${result.window.isMinimized ? '; minimized' : ''}.`,
      detail: { status: result.status, window },
    };
  }

  private async listExternalWindows(signal?: AbortSignal): Promise<ToolResult> {
    if (!this.deps.nativeHelper) {
      return { ok: false, content: 'Windows foreground tracking is not available in this build.', errorCode: 'UNAVAILABLE' };
    }
    const result = await this.deps.nativeHelper.listExternalWindows(signal);
    if (result.windows.length === 0) {
      return { ok: true, content: 'No visible external application windows are available to select.', detail: { windows: [], truncated: result.truncated } };
    }
    const windows = result.windows.map((window) => {
      const physicalRect = window.rect;
      return { ...window, physicalRect, rect: this.deps.toDipRect?.(physicalRect) ?? physicalRect, coordinateSpace: 'electron_dip' };
    });
    const lines = windows.map((window, index) =>
      `${index + 1}. ${window.processName} (PID ${window.pid}), "${window.title || '(untitled)'}"; ref=${window.windowId}; observed=${new Date(window.observedAt).toISOString()}${window.isMinimized ? '; minimized' : ''}`,
    );
    return {
      ok: true,
      content: `Visible external windows${result.truncated ? ' (list truncated at the safety limit)' : ''}. Ask the user to choose one if the requested target is ambiguous; never activate a window automatically.\n${lines.join('\n')}`,
      detail: { windows, truncated: result.truncated, coordinateSpace: 'electron_dip' },
    };
  }

  private async findUiElements(args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> {
    if (!this.deps.nativeHelper) {
      return { ok: false, content: 'Windows UI Automation is not available in this build.', errorCode: 'UNAVAILABLE' };
    }
    const text = typeof args.text === 'string' ? args.text.trim() : '';
    if (!text) return { ok: false, content: 'Provide the accessible name or AutomationId to search for.', errorCode: 'FAILED' };
    const hasTargetSelection = ['targetWindowId', 'expectedWindowTitle', 'expectedProcessId', 'expectedProcessName']
      .some((key) => args[key] !== undefined);
    const hasCompleteTargetSelection = typeof args.targetWindowId === 'string' &&
      typeof args.expectedWindowTitle === 'string' && typeof args.expectedProcessId === 'number' &&
      typeof args.expectedProcessName === 'string';
    if (hasTargetSelection && !hasCompleteTargetSelection) {
      return { ok: false, content: 'The selected window identity is incomplete. Re-list windows and ask the user to select one exact target.', errorCode: 'FAILED' };
    }
    const targetSelection: Pick<FindElementsQuery, 'targetWindowId' | 'expectedWindowTitle' | 'expectedProcessId' | 'expectedProcessName'> =
      hasCompleteTargetSelection
        ? {
          targetWindowId: args.targetWindowId as string,
          expectedWindowTitle: args.expectedWindowTitle as string,
          expectedProcessId: args.expectedProcessId as number,
          expectedProcessName: args.expectedProcessName as string,
        }
        : {};
    const query: FindElementsQuery = {
      text,
      ...(Array.isArray(args.roles) ? { roles: args.roles.filter((role): role is string => typeof role === 'string').slice(0, 20) } : {}),
      ...(typeof args.maxResults === 'number' ? { maxResults: Math.max(1, Math.min(25, Math.trunc(args.maxResults))) } : {}),
      ...targetSelection,
    };
    const result = await this.deps.nativeHelper.call('find_elements', query, signal);
    const convert = (element: UiElement): UiElement & { physicalRect: UiElement['rect'] } => ({
      ...element,
      physicalRect: element.rect,
      rect: this.deps.toDipRect?.(element.rect) ?? element.rect,
    });
    const windowRect = this.deps.toDipRect?.(result.window.rect) ?? result.window.rect;
    const elements = result.elements.map(convert);
    const detail = {
      window: { ...result.window, physicalRect: result.window.rect, rect: windowRect },
      elements,
      truncated: result.truncated,
      coordinateSpace: 'electron_dip',
      observation: {
        source: 'ui_automation',
        verified: true,
        observedAt: result.window.observedAt,
        uncertainty: 'Only controls exposed in the Windows UI Automation tree are returned.',
      },
    };
    const lines = elements.map((element, index) =>
      `${index + 1}. ${element.role} "${element.name || '(unnamed)'}"${element.automationId ? ` (AutomationId: ${element.automationId})` : ''}; enabled=${element.enabled}; bounds=${element.rect.x},${element.rect.y},${element.rect.width},${element.rect.height} DIP`,
    );
    return {
      ok: true,
      content: `Found ${elements.length} matching UI element${elements.length === 1 ? '' : 's'} in ${result.window.title || 'the foreground window'} (${result.window.processName}, PID ${result.window.pid}; ref ${result.window.windowId}).${result.truncated ? ' Search was truncated at its safety limit.' : ''}${lines.length ? `\n${lines.join('\n')}` : ' No matching elements were found.'}`,
      detail,
    };
  }

  private async invokeUiElement(args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> {
    if (!this.deps.nativeHelper) {
      return { ok: false, content: 'Windows UI Automation is not available in this build.', errorCode: 'UNAVAILABLE' };
    }
    const selector = typeof args.selector === 'string' ? args.selector.trim() : '';
    if (!selector) return { ok: false, content: 'Provide the exact accessible name or AutomationId of the control.', errorCode: 'FAILED' };
    if (typeof args.targetWindowId !== 'string' || typeof args.expectedWindowTitle !== 'string' ||
      typeof args.expectedProcessId !== 'number' || typeof args.expectedProcessName !== 'string') {
      return { ok: false, content: 'Select a recently observed window and provide its exact title and process identity before requesting an action.', errorCode: 'FAILED' };
    }
    const expectedResult = args.expectedResult && typeof args.expectedResult === 'object'
      ? args.expectedResult as Record<string, unknown>
      : {};
    const result = await this.deps.nativeHelper.call('invoke_element', {
      selector,
      expectedWindowTitle: args.expectedWindowTitle,
      targetWindowId: args.targetWindowId,
      expectedProcessId: args.expectedProcessId,
      expectedProcessName: args.expectedProcessName,
      ...(typeof args.role === 'string' ? { role: args.role } : {}),
      expectedResult: {
        selector: typeof expectedResult.selector === 'string' ? expectedResult.selector : '',
        state: expectedResult.state === 'absent' ? 'absent' : 'present',
        ...(typeof expectedResult.role === 'string' ? { role: expectedResult.role } : {}),
      },
    }, signal);
    const rect = this.deps.toDipRect?.(result.element.rect) ?? result.element.rect;
    const detail = {
      window: result.window,
      element: { ...result.element, physicalRect: result.element.rect, rect },
      invoked: result.invoked,
      coordinateSpace: 'electron_dip',
    };
    return {
      ok: true,
      content: `Invoked ${result.element.role} "${result.element.name || result.element.automationId}" in the approved selected window "${result.window.title}" (${result.window.processName}, PID ${result.window.pid}; ref ${result.window.windowId}). Now verify that ${expectedResult.state === 'absent' ? 'the control is absent' : 'the control is present'}: "${String(expectedResult.selector ?? '')}".`,
      detail,
    };
  }

  private async verifyUiState(args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> {
    if (!this.deps.nativeHelper) {
      return { ok: false, content: 'Windows UI Automation is not available in this build.', errorCode: 'UNAVAILABLE' };
    }
    const selector = typeof args.selector === 'string' ? args.selector.trim() : '';
    const expectedWindowTitle = typeof args.expectedWindowTitle === 'string' ? args.expectedWindowTitle : '';
    const state = args.state === 'absent' ? 'absent' : 'present';
    if (!selector || !expectedWindowTitle || typeof args.targetWindowId !== 'string' ||
      typeof args.expectedProcessId !== 'number' || typeof args.expectedProcessName !== 'string') {
      return { ok: false, content: 'Provide an exact UI selector and a selected window identity.', errorCode: 'FAILED' };
    }
    const result = await this.deps.nativeHelper.call('verify_element_state', {
      selector,
      targetWindowId: typeof args.targetWindowId === 'string' ? args.targetWindowId : '',
      expectedWindowTitle,
      expectedProcessId: typeof args.expectedProcessId === 'number' ? args.expectedProcessId : 0,
      expectedProcessName: typeof args.expectedProcessName === 'string' ? args.expectedProcessName : '',
      state,
      ...(typeof args.role === 'string' ? { role: args.role } : {}),
    }, signal);
    const windowRect = this.deps.toDipRect?.(result.window.rect) ?? result.window.rect;
    const element = result.element
      ? { ...result.element, physicalRect: result.element.rect, rect: this.deps.toDipRect?.(result.element.rect) ?? result.element.rect }
      : undefined;
    const detail = {
      window: { ...result.window, physicalRect: result.window.rect, rect: windowRect },
      selector,
      state,
      matches: result.matches,
      matchedCount: result.matchedCount,
      ...(element ? { element } : {}),
      coordinateSpace: 'electron_dip',
    };
    const expected = state === 'present' ? 'present exactly once' : 'absent';
    const observed = result.matchedCount === 0 ? 'absent' : `present ${result.matchedCount} time${result.matchedCount === 1 ? '' : 's'}`;
    return {
      ok: true,
      content: `UI Automation found "${selector}" ${observed} among visible controls in "${result.window.title}"; expected it to be ${expected}.${result.matches ? ' The postcondition matches.' : ' The postcondition does not match.'}`,
      detail,
      ...(result.matches ? {
        verification: {
          summary: `UI Automation confirmed that ${selector} is ${expected} in the selected window.`,
          source: 'UI Automation postcondition check',
        },
      } : {}),
    };
  }

  private async controlUiElement(args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> {
    if (!this.deps.nativeHelper) {
      return { ok: false, content: 'Windows UI Automation is not available in this build.', errorCode: 'UNAVAILABLE' };
    }
    const target = selectedWindowTarget(args);
    const selector = typeof args.selector === 'string' ? args.selector.trim() : '';
    const action = args.action;
    if (!target || !selector || !['select', 'toggle', 'scroll', 'expand', 'collapse'].includes(String(action))) {
      return { ok: false, content: 'Provide an exact control selector, selected window identity, and supported semantic action.', errorCode: 'FAILED' };
    }
    if (action === 'toggle' && args.desiredToggleState !== 'on' && args.desiredToggleState !== 'off') {
      return { ok: false, content: 'A toggle action must specify the desired state as on or off.', errorCode: 'FAILED' };
    }
    if (action === 'scroll' && !['vertical', 'horizontal'].includes(String(args.scrollAxis))) {
      return { ok: false, content: 'A scroll action must specify a vertical or horizontal axis.', errorCode: 'FAILED' };
    }
    if (action === 'scroll' && !['increment', 'decrement'].includes(String(args.scrollDirection))) {
      return { ok: false, content: 'A scroll action must specify increment or decrement.', errorCode: 'FAILED' };
    }

    const result = await this.deps.nativeHelper.call('control_element', {
      targetWindowId: target.windowId,
      expectedWindowTitle: target.title,
      expectedProcessId: target.pid,
      expectedProcessName: target.processName,
      selector,
      action: action as 'select' | 'toggle' | 'scroll' | 'expand' | 'collapse',
      ...(typeof args.role === 'string' ? { role: args.role } : {}),
      ...(args.desiredToggleState === 'on' || args.desiredToggleState === 'off'
        ? { desiredToggleState: args.desiredToggleState } : {}),
      ...(args.scrollAxis === 'vertical' || args.scrollAxis === 'horizontal'
        ? { scrollAxis: args.scrollAxis } : {}),
      ...(args.scrollDirection === 'increment' || args.scrollDirection === 'decrement'
        ? { scrollDirection: args.scrollDirection } : {}),
    }, signal);
    const elementRect = this.deps.toDipRect?.(result.element.rect) ?? result.element.rect;
    return {
      ok: true,
      content: `Pixel ${action === 'scroll' ? 'scrolled' : action === 'select' ? 'selected' : action === 'toggle' ? 'set the toggle' : action === 'expand' ? 'expanded' : 'collapsed'} the exact ${result.element.role} control "${result.element.name || result.element.automationId}" in "${result.window.title}" and verified its UI Automation state (${result.observedState}).`,
      detail: {
        window: result.window,
        element: { ...result.element, physicalRect: result.element.rect, rect: elementRect },
        action: result.action,
        observedState: result.observedState,
        verified: true,
        coordinateSpace: 'electron_dip',
      },
      verification: {
        summary: `${action} on ${result.element.role} "${result.element.name || result.element.automationId}" was confirmed by UI Automation (${result.observedState}).`,
        source: 'UI Automation pattern read-back',
      },
    };
  }

  /* --------------------------- state changing -------------------------- */

  private async openApplication(args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> {
    const requested = typeof args.name === 'string' ? args.name.trim().toLowerCase() : '';
    if (requested.length === 0) {
      return { ok: false, content: 'No application name was provided.', errorCode: 'FAILED' };
    }

    const executable = APPLICATION_ALLOWLIST[requested];
    if (!executable) {
      // Refusing unknown targets is deliberate: an open-ended launcher would let
      // a model run anything on the machine.
      const known = Object.keys(APPLICATION_ALLOWLIST)
        .filter((key) => !key.endsWith('.exe') && !key.includes('.'))
        .join(', ');
      return {
        ok: false,
        content: `Pixel is not allowed to launch "${requested}". It can open: ${known}.`,
        errorCode: 'DENIED',
      };
    }

    if (process.platform !== 'win32') {
      return {
        ok: false,
        content: 'Launching applications is only supported on Windows.',
        errorCode: 'UNAVAILABLE',
      };
    }

    // `start` is a cmd builtin, so it must be invoked through cmd.
    const child = execFile(
      'cmd.exe',
      ['/c', 'start', '', executable],
      { windowsHide: true, timeout: DEFAULT_TOOL_TIMEOUT_MS, signal },
      () => undefined,
    );
    this.track(child);

    return {
      ok: true,
      content: `Opened ${requested}.`,
      detail: { application: requested, executable },
    };
  }

  private async typeText(args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> {
    const text = typeof args.text === 'string' ? args.text : '';
    const selector = typeof args.selector === 'string' ? args.selector.trim() : '';
    const expectedWindowTitle = typeof args.expectedWindowTitle === 'string' ? args.expectedWindowTitle : '';
    const targetWindowId = typeof args.targetWindowId === 'string' ? args.targetWindowId : '';
    const expectedProcessId = typeof args.expectedProcessId === 'number' ? args.expectedProcessId : 0;
    const expectedProcessName = typeof args.expectedProcessName === 'string' ? args.expectedProcessName : '';
    if (text.length === 0) {
      return { ok: false, content: 'No text was provided to type.', errorCode: 'FAILED' };
    }
    if (expectedWindowTitle.length === 0 || expectedWindowTitle.length > 500 || !targetWindowId || expectedProcessId <= 0 || !expectedProcessName || !selector || selector.length > 300) {
      return { ok: false, content: 'Select a recently observed window and an exact editable control, including its title and process identity, before requesting text input.', errorCode: 'FAILED' };
    }
    if (text.length > 2_000) {
      return {
        ok: false,
        content: 'That text is too long for Pixel to type safely (limit 2000 characters).',
        errorCode: 'FAILED',
      };
    }
    if (!this.deps.nativeHelper) {
      return { ok: false, content: 'Window identity validation is unavailable; no text was sent.', errorCode: 'UNAVAILABLE' };
    }
    const result = await this.deps.nativeHelper.call('set_element_value', {
      selector,
      value: text,
      targetWindowId,
      expectedWindowTitle,
      expectedProcessId,
      expectedProcessName,
      ...(typeof args.role === 'string' ? { role: args.role } : {}),
    }, signal);
    const rect = this.deps.toDipRect?.(result.element.rect) ?? result.element.rect;
    return {
      ok: true,
      content: `Set and verified ${result.valueLength} character${result.valueLength === 1 ? '' : 's'} in the exact ${result.element.role} control "${result.element.name || result.element.automationId}" in "${result.window.title}" using UI Automation. The value itself was not returned or logged.`,
      detail: {
        window: result.window,
        element: { ...result.element, physicalRect: result.element.rect, rect },
        characters: result.valueLength,
        targetWindowId,
        verified: true,
      },
      verification: {
        summary: `UI Automation read the value back from ${result.element.role} "${result.element.name || result.element.automationId}" and confirmed it matched the approved input.`,
        source: 'UI Automation ValuePattern read-back',
      },
    };
  }

  /* ------------------------------ browser ----------------------------- */

  private browserOrError(): { browser: BrowserSession } | { error: ToolResult } {
    if (!this.deps.browser) {
      return {
        error: {
          ok: false,
          content: 'Browser automation is not available in this build of Pixel.',
          errorCode: 'UNAVAILABLE',
        },
      };
    }
    return { browser: this.deps.browser };
  }

  private async browserNavigate(args: Record<string, unknown>): Promise<ToolResult> {
    const ready = this.browserOrError();
    if ('error' in ready) return ready.error;

    const url = typeof args.url === 'string' ? args.url.trim() : '';
    if (url.length === 0) {
      return { ok: false, content: 'No URL was provided.', errorCode: 'FAILED' };
    }

    const problem = ready.browser.validateUrl(url);
    if (problem) return { ok: false, content: problem, errorCode: 'DENIED' };

    try {
      const page = await ready.browser.navigate(url);
      return {
        ok: true,
        content: [
          `Opened ${page.url}`,
          `Title: ${page.title || '(none)'}`,
          '',
          page.text || '(the page has no visible text)',
        ].join('\n'),
        detail: { url: page.url, title: page.title, links: page.links.length },
        verification: { summary: `Loaded and checked ${page.url} after navigation.`, source: 'browser URL and connected-address check' },
      };
    } catch (error) {
      return {
        ok: false,
        content: `Pixel could not open that page: ${message(error)}`,
        errorCode: 'FAILED',
      };
    }
  }

  private async browserNewTab(args: Record<string, unknown>): Promise<ToolResult> {
    const ready = this.browserOrError();
    if ('error' in ready) return ready.error;
    const url = typeof args.url === 'string' ? args.url.trim() : '';
    if (!url) return { ok: false, content: 'No URL was provided for the new tab.', errorCode: 'FAILED' };
    const problem = ready.browser.validateUrl(url);
    if (problem) return { ok: false, content: problem, errorCode: 'DENIED' };
    try {
      const tab = await ready.browser.newTab(url);
      const snapshot = await ready.browser.snapshot();
      return {
        ok: true,
        content: `Opened tab ${tab.id}: ${tab.title || '(untitled)'} — ${tab.url}\n\n${snapshot.text || '(the page has no visible text)'}`,
        detail: { id: tab.id, url: tab.url, title: tab.title, active: true },
        verification: { summary: `The new tab ${tab.id} loaded at ${tab.url} and became active.`, source: 'Playwright tab URL and page title' },
      };
    } catch (error) {
      return { ok: false, content: `Pixel could not open the new tab: ${message(error)}`, errorCode: 'FAILED' };
    }
  }

  private async browserListTabs(): Promise<ToolResult> {
    const ready = this.browserOrError();
    if ('error' in ready) return ready.error;
    try {
      const tabs = await ready.browser.listTabs();
      return {
        ok: true,
        content: tabs.length ? `Open Pixel browser tabs:\n${tabs.map((tab) => `- ${tab.id}${tab.active ? ' (active)' : ''}: ${tab.title || '(untitled)'} — ${tab.url}`).join('\n')}` : 'No Pixel browser tabs are open.',
        detail: { tabs },
        verification: { summary: `Read ${tabs.length} open tab(s) and their active state from the current browser context.`, source: 'Playwright browser context pages' },
      };
    } catch (error) {
      return { ok: false, content: `Pixel could not list browser tabs: ${message(error)}`, errorCode: 'FAILED' };
    }
  }

  private async browserSwitchTab(args: Record<string, unknown>): Promise<ToolResult> {
    const ready = this.browserOrError();
    if ('error' in ready) return ready.error;
    const tabId = typeof args.tabId === 'string' ? args.tabId : '';
    const tab = await ready.browser.switchTab(tabId);
    if (!tab) return { ok: false, content: 'That Pixel browser tab is no longer open. List tabs again before choosing.', errorCode: 'NOT_FOUND' };
    return {
      ok: true,
      content: `Selected ${tab.id}: ${tab.title || '(untitled)'} — ${tab.url}`,
      detail: { ...tab },
      verification: { summary: `Tab ${tab.id} is now the active Pixel browser page at ${tab.url}.`, source: 'Playwright selected page identity' },
    };
  }

  private async browserCloseTab(args: Record<string, unknown>): Promise<ToolResult> {
    const ready = this.browserOrError();
    if ('error' in ready) return ready.error;
    const tabId = typeof args.tabId === 'string' ? args.tabId : '';
    const result = await ready.browser.closeTab(tabId);
    if (!result.closed) return { ok: false, content: 'That Pixel browser tab is no longer open. List tabs again before closing.', errorCode: 'NOT_FOUND' };
    return {
      ok: true,
      content: `Closed ${tabId}; ${result.remaining} tab(s) remain. Active tab: ${result.activeTabId ?? 'none'}.`,
      detail: { closedTabId: tabId, remaining: result.remaining, activeTabId: result.activeTabId },
      verification: { summary: `Tab ${tabId} was removed from the browser context; ${result.remaining} tab(s) remain.`, source: 'Playwright browser context tab map' },
    };
  }

  private async browserOpenSearch(args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> {
    const query = typeof args.query === 'string' ? args.query.trim() : '';
    if (!query || query.length > MAX_SEARCH_QUERY_LENGTH) {
      return { ok: false, content: 'Enter a search query with 1–500 characters.', errorCode: 'FAILED' };
    }
    if (!this.deps.openExternal || !this.deps.searchProvider) {
      return { ok: false, content: 'Opening the default browser is unavailable in this build of Pixel.', errorCode: 'UNAVAILABLE' };
    }
    if (signal?.aborted) return cancelledResult('browser_open_search');
    try {
      const provider = this.deps.searchProvider();
      const url = createSearchUrl(query, provider);
      await this.deps.openExternal(url);
      return {
        ok: true,
        content: `Opened search results for ${query} in your default browser. Pixel has not read the results.`,
        detail: { query, provider },
        verification: { summary: 'The operating system accepted the external browser launch request.', source: 'Electron shell.openExternal' },
      };
    } catch (error) {
      return { ok: false, content: `Pixel could not open search results in your default browser: ${message(error)}`, errorCode: 'FAILED' };
    }
  }

  private async browserInspect(): Promise<ToolResult> {
    const ready = this.browserOrError();
    if ('error' in ready) return ready.error;

    try {
      const page = await ready.browser.snapshot();
      const lines = [`URL: ${page.url}`, `Title: ${page.title || '(none)'}`, ''];
      if (page.text) lines.push(page.text);
      if (page.buttons.length) lines.push('', `Buttons: ${page.buttons.join(' | ')}`);
      if (page.inputs.length) {
        const fields = page.inputs
          .map((input) => {
            const label = input.name || input.type;
            return input.placeholder ? `${label} (${input.placeholder})` : label;
          })
          .join(' | ');
        lines.push('', `Fields: ${fields}`);
      }
      if (page.links.length) {
        const links = page.links
          .slice(0, 15)
          .map((link) => link.text || link.href)
          .join(' | ');
        lines.push('', `Links: ${links}`);
      }
      return { ok: true, content: lines.join('\n'), detail: { url: page.url, title: page.title } };
    } catch (error) {
      return {
        ok: false,
        content: `Pixel could not read the page: ${message(error)}`,
        errorCode: 'FAILED',
      };
    }
  }

  private async browserClick(args: Record<string, unknown>): Promise<ToolResult> {
    const ready = this.browserOrError();
    if ('error' in ready) return ready.error;

    const selector = typeof args.selector === 'string' ? args.selector.trim() : '';
    if (selector.length === 0) {
      return { ok: false, content: 'No selector was provided.', errorCode: 'FAILED' };
    }

    try {
      await ready.browser.click(selector);
      const page = await ready.browser.snapshot();
      return {
        ok: true,
        content: `Clicked ${selector}. The page is now: ${page.title || page.url}`,
        detail: { selector, url: page.url },
      };
    } catch (error) {
      return {
        ok: false,
        content: `Pixel could not click "${selector}": ${message(error)}`,
        errorCode: 'FAILED',
      };
    }
  }

  private async browserType(args: Record<string, unknown>): Promise<ToolResult> {
    const ready = this.browserOrError();
    if ('error' in ready) return ready.error;

    const selector = typeof args.selector === 'string' ? args.selector.trim() : '';
    const text = typeof args.text === 'string' ? args.text : '';
    if (selector.length === 0 || text.length === 0) {
      return { ok: false, content: 'A selector and text are both required.', errorCode: 'FAILED' };
    }

    try {
      await ready.browser.fill(selector, text);
      if (args.submit === true) await ready.browser.press(selector, 'Enter');
      return {
        ok: true,
        content: `Typed into ${selector}${args.submit === true ? ' and pressed Enter' : ''}.`,
        detail: { selector, submitted: args.submit === true },
      };
    } catch (error) {
      return {
        ok: false,
        content: `Pixel could not type into "${selector}": ${message(error)}`,
        errorCode: 'FAILED',
      };
    }
  }

  private async browserScroll(args: Record<string, unknown>): Promise<ToolResult> {
    const ready = this.browserOrError();
    if ('error' in ready) return ready.error;

    const amount = typeof args.amount === 'number' ? args.amount : Number(args.amount);
    if (!Number.isFinite(amount)) {
      return { ok: false, content: 'The scroll amount must be a number.', errorCode: 'FAILED' };
    }

    try {
      const position = await ready.browser.scrollBy(amount);
      return {
        ok: true,
        content: `Scrolled to ${position.scrollY}px (page height ${position.maxScroll}px).`,
        detail: position,
      };
    } catch (error) {
      return {
        ok: false,
        content: `Pixel could not scroll the page: ${message(error)}`,
        errorCode: 'FAILED',
      };
    }
  }

  private async browserScreenshot(): Promise<ToolResult> {
    const ready = this.browserOrError();
    if ('error' in ready) return ready.error;

    try {
      const image = await ready.browser.screenshot();
      // The bytes stay in `detail`; the model context gets a compact summary.
      return {
        ok: true,
        content: `Captured a browser screenshot (${image.width}x${image.height}).`,
        detail: { image },
      };
    } catch (error) {
      return {
        ok: false,
        content: `Pixel could not capture the page: ${message(error)}`,
        errorCode: 'FAILED',
      };
    }
  }

  private async browserVerify(args: Record<string, unknown>): Promise<ToolResult> {
    const ready = this.browserOrError();
    if ('error' in ready) return ready.error;

    const expected = typeof args.expected === 'string' ? args.expected : '';
    if (expected.length === 0) {
      return { ok: false, content: 'No expected text was provided.', errorCode: 'FAILED' };
    }

    try {
      const result = await ready.browser.verifyText(expected);
      if (result.found) {
        return {
          ok: true,
          content: `Verified: the page contains "${expected}".`,
          detail: { expected, found: true },
          verification: { summary: `Confirmed the current page contains the requested text: ${expected}.`, source: 'browser page text check' },
        };
      }
      return {
        ok: false,
        content: `Verification failed: "${expected}" is not on the page. The page shows: ${result.actual}`,
        detail: { expected, found: false },
        errorCode: 'FAILED',
      };
    } catch (error) {
      return {
        ok: false,
        content: `Pixel could not verify the page: ${message(error)}`,
        errorCode: 'FAILED',
      };
    }
  }

  /* ------------------------------ helpers ----------------------------- */

  private track(child: ChildProcess): ChildProcess {
    this.children.add(child);
    child.on('exit', () => this.children.delete(child));
    child.on('error', () => this.children.delete(child));
    return child;
  }

}

function cancelledResult(name: string): ToolResult {
  return {
    ok: false,
    content: `"${name}" was cancelled before it finished.`,
    errorCode: 'CANCELLED',
  };
}

function selectedWindowTarget(args: Record<string, unknown>): ScreenWindowTarget | null {
  if (typeof args.targetWindowId !== 'string' || !args.targetWindowId ||
    typeof args.expectedWindowTitle !== 'string' || !args.expectedWindowTitle ||
    typeof args.expectedProcessName !== 'string' || !args.expectedProcessName ||
    typeof args.expectedProcessId !== 'number' || !Number.isInteger(args.expectedProcessId) || args.expectedProcessId <= 0) {
    return null;
  }
  return {
    windowId: args.targetWindowId,
    title: args.expectedWindowTitle,
    processName: args.expectedProcessName,
    pid: args.expectedProcessId,
  };
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function numberArgument(value: unknown, fallback: number): number {
  return typeof value === 'number' ? value : fallback;
}

function findBoardTextBaseline(objects: BoardObject[], x: number, text: string, width: number): number {
  const metrics = boardTextMetrics(text, width);
  for (let baseline = 72; baseline <= BOARD_HEIGHT; baseline += 24) {
    if (!textOverlapsObjects(objects, x, baseline, text, width)) return baseline;
  }
  throw new Error(`There is no clear area for this ${metrics.lines}-line text block. Move or clear Board objects, or add a shorter note.`);
}

function textOverlapsObjects(objects: BoardObject[], x: number, baseline: number, text: string, width: number): boolean {
  const candidate = boardTextMetrics(text, width);
  const box = { left: x, right: x + candidate.width, top: baseline - candidate.fontSize, bottom: baseline + candidate.height - candidate.lineHeight };
  if (box.right > BOARD_WIDTH || box.bottom > BOARD_HEIGHT) return true;
  return objects.some((object) => {
    const first = object.points[0];
    if (!first) return false;
    let left: number; let right: number; let top: number; let bottom: number;
    if (object.kind === 'text') {
      const measure = boardTextMetrics(wrapBoardText(object.text ?? '', 72), object.width);
      left = first.x; right = left + measure.width; top = first.y - measure.fontSize; bottom = first.y + measure.height - measure.lineHeight;
    } else if (object.kind === 'marker') {
      left = first.x - 17; right = first.x + 17; top = first.y - 17; bottom = first.y + 17;
    } else {
      const xs = object.points.map((point) => point.x); const ys = object.points.map((point) => point.y);
      left = Math.min(...xs) - 8; right = Math.max(...xs) + 8; top = Math.min(...ys) - 8; bottom = Math.max(...ys) + 8;
    }
    const gap = 12;
    return box.left < right + gap && box.right + gap > left && box.top < bottom + gap && box.bottom + gap > top;
  });
}

function boardTextMetrics(text: string, width: number): { fontSize: number; lineHeight: number; lines: number; width: number; height: number } {
  const fontSize = Math.max(18, width * 5);
  const lineHeight = fontSize * 1.25;
  const lines = text.split('\n');
  return { fontSize, lineHeight, lines: lines.length, width: Math.max(1, ...lines.map((line) => line.length * fontSize * 0.55)), height: lines.length * lineHeight };
}

function validColor(value: unknown): string | null {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : null;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function looksLikeClipboardSecret(text: string): boolean {
  return /\b(password|passwd|passphrase|api[_ -]?key|access[_ -]?token|secret|authorization)\b\s*(?:=|:)\s*\S+/i.test(text)
    || /\b(password|passwd|passphrase|api[_ -]?key|access[_ -]?token|secret|authorization)\b\s+is\s+\S+/i.test(text)
    || /\bsk-[A-Za-z0-9_-]{12,}\b/.test(text)
    || /\bAKIA[0-9A-Z]{16}\b/.test(text)
    || /\bBearer\s+[A-Za-z0-9._~+\/-]{16,}/i.test(text);
}
