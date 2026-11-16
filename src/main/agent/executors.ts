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
import { arch, cpus, freemem, platform, release, totalmem } from 'node:os';
import type { ImageAttachment } from '../../shared/types';
import { BrowserSession } from './browser';
import { DesktopInputLease } from './inputLease';
import type { MemoryTools } from '../memory/toolset';
import type { DocumentTools } from '../documents/toolset';
import type { FileTools } from '../files/toolset';
import { terminateProcessTree } from '../services/process';
import { NativeHelperError } from '../services/nativeHelper';
import type { NativeHelper, UiElement, WindowInfo } from '../services/nativeHelper';

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

/**
 * Escape text for WScript.Shell.SendKeys.
 *
 * SendKeys is a mini-language, not a text API: + ^ % ~ ( ) { } [ ] are control
 * characters. Typing "50% off (today)" unescaped sends Alt+<keys>, and a
 * model-supplied "%{F4}" would close the focused window. Every metacharacter is
 * wrapped in braces so it is typed literally, and line breaks become Enter.
 */
export function escapeSendKeys(text: string): string {
  let out = '';
  for (const ch of text) {
    if ('+^%~(){}[]'.includes(ch)) out += `{${ch}}`;
    else if (ch === '\r') continue;
    else if (ch === '\n') out += '{ENTER}';
    else if (ch === '\t') out += '{TAB}';
    else out += ch;
  }
  return out;
}

/** Per-tool wall clock limit. */
export const DEFAULT_TOOL_TIMEOUT_MS = 30_000;

export interface ExecutorDeps {
  /**
   * Capture access. Only called for `analyze_screen`, and only after the
   * permission flow has approved that specific call.
   */
  captureDisplay?: (target: 'active_window' | 'display') => Promise<ImageAttachment | null>;
  /** Vision analysis of a captured image. */
  describeImage?: (image: ImageAttachment, question: string, signal?: AbortSignal) => Promise<string>;
  /** Shared browser session, created lazily on first use. */
  browser?: BrowserSession;
  /** Wave 3 memory tools, scoped to the active project. */
  memory?: MemoryTools;
  /** Wave 3 document tools. */
  documents?: DocumentTools;
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
}

export class ToolExecutors {
  private readonly children = new Set<ChildProcess>();
  private readonly deps: ExecutorDeps;
  private readonly inputLease: DesktopInputLease;

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
    if (this.deps.browser) void this.deps.browser.close();
    this.deps.nativeHelper?.dispose();
    return killed;
  }

  /** Dispatch one call. Never throws: failures become ToolResult. */
  async run(name: string, args: Record<string, unknown>, signal?: AbortSignal, context?: { taskId: string }): Promise<ToolResult> {
    if (signal?.aborted) return cancelledResult(name);

    let releaseInput: (() => void) | null = null;
    if (name === 'type_text' || name === 'invoke_ui_element') {
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
    const isBrowserTool = name.startsWith('browser_');
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
      return signal?.aborted ? cancelledResult(name) : result;
    } finally {
      signal?.removeEventListener('abort', onAbort);
      if (releaseInput && name === 'invoke_ui_element' && this.deps.nativeHelper?.terminating) {
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
      if (this.deps.files?.handles(name)) {
        return this.deps.files.run(name, args);
      }

      switch (name) {
        case 'get_current_time':
          return this.getCurrentTime();
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
        case 'get_foreground_window':
          return await this.getForegroundWindow(signal);
        case 'find_ui_elements':
          return await this.findUiElements(args, signal);
        case 'verify_ui_state':
          return await this.verifyUiState(args, signal);
        case 'invoke_ui_element':
          return await this.invokeUiElement(args, signal);
        case 'open_application':
          return await this.openApplication(args, signal);
        case 'type_text':
          return await this.typeText(args, signal);
        case 'browser_navigate':
          return await this.browserNavigate(args);
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
    const detail = {
      platform: platform(),
      release: release(),
      arch: arch(),
      cpuModel: cpuList[0]?.model ?? 'unknown',
      cpuCount: cpuList.length,
      totalMemoryGb: round(totalmem() / 1024 ** 3),
      freeMemoryGb: round(freemem() / 1024 ** 3),
    };
    return {
      ok: true,
      content: [
        `Platform: ${detail.platform} ${detail.release} (${detail.arch})`,
        `CPU: ${detail.cpuModel}, ${detail.cpuCount} cores`,
        `Memory: ${detail.freeMemoryGb} GB free of ${detail.totalMemoryGb} GB`,
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
    const target = args.target === 'active_window' ? 'active_window' : 'display';

    if (!this.deps.captureDisplay) {
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

    const image = await this.deps.captureDisplay(target);
    if (!image) {
      return { ok: false, content: 'The screen could not be captured.', errorCode: 'FAILED' };
    }

    if (signal?.aborted) return cancelledResult('analyze_screen');
    const description = await this.deps.describeImage(image, question, signal);
    return {
      ok: true,
      content: description,
      detail: { target, width: image.width, height: image.height, question },
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
      content: `Foreground window: ${window.title || '(untitled)'} (${window.processName || 'unknown process'}). Bounds in desktop DIP: x=${rect.x}, y=${rect.y}, width=${rect.width}, height=${rect.height}${window.isMinimized ? '; minimized' : ''}.`,
      detail,
    };
  }

  private async findUiElements(args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> {
    if (!this.deps.nativeHelper) {
      return { ok: false, content: 'Windows UI Automation is not available in this build.', errorCode: 'UNAVAILABLE' };
    }
    const text = typeof args.text === 'string' ? args.text.trim() : '';
    if (!text) return { ok: false, content: 'Provide the accessible name or AutomationId to search for.', errorCode: 'FAILED' };
    const query = {
      text,
      ...(Array.isArray(args.roles) ? { roles: args.roles.filter((role): role is string => typeof role === 'string').slice(0, 20) } : {}),
      ...(typeof args.maxResults === 'number' ? { maxResults: Math.max(1, Math.min(25, Math.trunc(args.maxResults))) } : {}),
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
    };
    const lines = elements.map((element, index) =>
      `${index + 1}. ${element.role} "${element.name || '(unnamed)'}"${element.automationId ? ` (AutomationId: ${element.automationId})` : ''}; enabled=${element.enabled}; bounds=${element.rect.x},${element.rect.y},${element.rect.width},${element.rect.height} DIP`,
    );
    return {
      ok: true,
      content: `Found ${elements.length} matching UI element${elements.length === 1 ? '' : 's'} in ${result.window.title || 'the foreground window'}.${result.truncated ? ' Search was truncated at its safety limit.' : ''}${lines.length ? `\n${lines.join('\n')}` : ' No matching elements were found.'}`,
      detail,
    };
  }

  private async invokeUiElement(args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> {
    if (!this.deps.nativeHelper) {
      return { ok: false, content: 'Windows UI Automation is not available in this build.', errorCode: 'UNAVAILABLE' };
    }
    const selector = typeof args.selector === 'string' ? args.selector.trim() : '';
    if (!selector) return { ok: false, content: 'Provide the exact accessible name or AutomationId of the control.', errorCode: 'FAILED' };
    const expectedResult = args.expectedResult && typeof args.expectedResult === 'object'
      ? args.expectedResult as Record<string, unknown>
      : {};
    const result = await this.deps.nativeHelper.call('invoke_element', {
      selector,
      expectedWindowTitle: typeof args.expectedWindowTitle === 'string' ? args.expectedWindowTitle : '',
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
      content: `Invoked ${result.element.role} "${result.element.name || result.element.automationId}" in the approved foreground window "${result.window.title}". Now verify that ${expectedResult.state === 'absent' ? 'the control is absent' : 'the control is present'}: "${String(expectedResult.selector ?? '')}".`,
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
    if (!selector || !expectedWindowTitle) {
      return { ok: false, content: 'Provide an exact UI selector and foreground window title.', errorCode: 'FAILED' };
    }
    const result = await this.deps.nativeHelper.call('verify_element_state', {
      selector,
      expectedWindowTitle,
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
          summary: `UI Automation confirmed that ${selector} is ${expected} in the expected foreground window.`,
          source: 'UI Automation postcondition check',
        },
      } : {}),
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
    const expectedWindowTitle = typeof args.expectedWindowTitle === 'string' ? args.expectedWindowTitle : '';
    if (text.length === 0) {
      return { ok: false, content: 'No text was provided to type.', errorCode: 'FAILED' };
    }
    if (expectedWindowTitle.length === 0 || expectedWindowTitle.length > 500) {
      return { ok: false, content: 'Observe the foreground window and include its exact title before requesting text input.', errorCode: 'FAILED' };
    }
    if (text.length > 2_000) {
      return {
        ok: false,
        content: 'That text is too long for Pixel to type safely (limit 2000 characters).',
        errorCode: 'FAILED',
      };
    }
    if (process.platform !== 'win32') {
      return {
        ok: false,
        content: 'Typing into other applications is only supported on Windows.',
        errorCode: 'UNAVAILABLE',
      };
    }

    // Both the requested title and text travel through the environment, never
    // inside the PowerShell script. A Win32 recheck immediately before SendKeys
    // narrows the focus-change race between the approval card and input.
    const nativeCode = [
      'using System;',
      'using System.Runtime.InteropServices;',
      'using System.Text;',
      'public static class PixelForegroundWindowCheck {',
      '  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
      '  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);',
      '}',
    ].join('\n');
    const script = [
      '$ErrorActionPreference = "Stop";',
      "$native = @'",
      nativeCode,
      "'@",
      'Add-Type -TypeDefinition $native;',
      '$handle = [PixelForegroundWindowCheck]::GetForegroundWindow();',
      '$title = New-Object System.Text.StringBuilder 1024;',
      '[void][PixelForegroundWindowCheck]::GetWindowText($handle, $title, $title.Capacity);',
      'if ($title.ToString() -cne $env:CYPS_EXPECTED_WINDOW_TITLE) { Write-Error "Foreground window changed; no text was sent"; exit 3 }',
      '$value = $env:CYPS_TYPE_TEXT;',
      'if ([string]::IsNullOrEmpty($value)) { Write-Error "empty"; exit 2 }',
      '$shell = New-Object -ComObject WScript.Shell;',
      '$shell.SendKeys($value);',
      'Write-Output "typed"',
    ].join('\n');

    const result = await this.runChild(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { ...process.env, CYPS_TYPE_TEXT: escapeSendKeys(text), CYPS_EXPECTED_WINDOW_TITLE: expectedWindowTitle },
      signal,
    );

    if (!result.ok) {
      return {
        ok: false,
        content: `Windows refused the keystrokes: ${result.error}. The target window may not accept input, or the session may be locked.`,
        errorCode: result.timedOut ? 'TIMEOUT' : /foreground window changed/i.test(result.error ?? '') ? 'DENIED' : 'FAILED',
      };
    }

    return {
      ok: true,
      content: `Typed ${text.length} character${text.length === 1 ? '' : 's'} into the foreground window titled "${expectedWindowTitle}" after rechecking its title.`,
      detail: { characters: text.length, expectedWindowTitle },
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

  /** Run a child process to completion with a timeout, never throwing. */
  private runChild(
    file: string,
    args: string[],
    env: NodeJS.ProcessEnv,
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; error: string; timedOut: boolean }> {
    return new Promise((resolve) => {
      let settled = false;
      const child = execFile(
        file,
        args,
        // Node kills the child when the signal aborts.
        { env, windowsHide: true, timeout: DEFAULT_TOOL_TIMEOUT_MS, signal },
        (error) => {
          if (settled) return;
          settled = true;
          if (!error) {
            resolve({ ok: true, error: '', timedOut: false });
            return;
          }
          const timedOut = (error as { killed?: boolean }).killed === true;
          resolve({ ok: false, error: message(error), timedOut });
        },
      );
      this.track(child);
      const onAbort = (): void => terminateProcessTree(child);
      signal?.addEventListener('abort', onAbort, { once: true });
      child.once('close', () => signal?.removeEventListener('abort', onAbort));
    });
  }
}

function cancelledResult(name: string): ToolResult {
  return {
    ok: false,
    content: `"${name}" was cancelled before it finished.`,
    errorCode: 'CANCELLED',
  };
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
