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

export interface ToolResult {
  ok: boolean;
  /** Text fed back to the model as the tool message. */
  content: string;
  /** Structured detail kept for the audit trail and the task rail. */
  detail?: Record<string, unknown>;
  /** Present when the tool failed, for classification in the UI. */
  errorCode?: 'TIMEOUT' | 'DENIED' | 'NOT_FOUND' | 'UNAVAILABLE' | 'FAILED';
}

/** Applications Cyps is willing to launch. Anything else is refused. */
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
  /**
   * Capture access. Only called for `analyze_screen`, and only after the
   * permission flow has approved that specific call.
   */
  captureDisplay?: () => Promise<ImageAttachment | null>;
  /** Vision analysis of a captured image. */
  describeImage?: (image: ImageAttachment, question: string) => Promise<string>;
  /** Shared browser session, created lazily on first use. */
  browser?: BrowserSession;
}

export class ToolExecutors {
  private readonly children = new Set<ChildProcess>();
  private readonly deps: ExecutorDeps;

  constructor(deps: ExecutorDeps = {}) {
    this.deps = deps;
  }

  /** Terminate every child process and close the browser. Returns kill count. */
  killAll(): number {
    let killed = 0;
    for (const child of this.children) {
      try {
        if (child.exitCode === null && !child.killed) {
          child.kill('SIGKILL');
          killed += 1;
        }
      } catch {
        // The process may already be gone.
      }
    }
    this.children.clear();
    if (this.deps.browser) void this.deps.browser.close();
    return killed;
  }

  /** Dispatch one call. Never throws: failures become ToolResult. */
  async run(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    try {
      switch (name) {
        case 'get_current_time':
          return this.getCurrentTime();
        case 'get_system_info':
          return this.getSystemInfo();
        case 'analyze_screen':
          return await this.analyzeScreen(args);
        case 'open_application':
          return await this.openApplication(args);
        case 'type_text':
          return await this.typeText(args);
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
            content: `Cyps has no implementation for the tool "${name}".`,
            errorCode: 'NOT_FOUND',
          };
      }
    } catch (error) {
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

  private async analyzeScreen(args: Record<string, unknown>): Promise<ToolResult> {
    const question =
      typeof args.question === 'string' && args.question.trim().length > 0
        ? args.question.trim()
        : 'Describe what is on the screen.';
    const target = args.target === 'active_window' ? 'active_window' : 'display';

    if (!this.deps.captureDisplay) {
      return {
        ok: false,
        content: 'Screen capture is not available in this build of Cyps.',
        errorCode: 'UNAVAILABLE',
      };
    }
    if (!this.deps.describeImage) {
      return {
        ok: false,
        content: 'Cyps cannot analyse images because no vision model is configured.',
        errorCode: 'UNAVAILABLE',
      };
    }

    const image = await this.deps.captureDisplay();
    if (!image) {
      return { ok: false, content: 'The screen could not be captured.', errorCode: 'FAILED' };
    }

    const description = await this.deps.describeImage(image, question);
    return {
      ok: true,
      content: description,
      detail: { target, width: image.width, height: image.height, question },
    };
  }

  /* --------------------------- state changing -------------------------- */

  private async openApplication(args: Record<string, unknown>): Promise<ToolResult> {
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
        content: `Cyps is not allowed to launch "${requested}". It can open: ${known}.`,
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
      { windowsHide: true, timeout: DEFAULT_TOOL_TIMEOUT_MS },
      () => undefined,
    );
    this.track(child);

    return {
      ok: true,
      content: `Opened ${requested}.`,
      detail: { application: requested, executable },
    };
  }

  private async typeText(args: Record<string, unknown>): Promise<ToolResult> {
    const text = typeof args.text === 'string' ? args.text : '';
    if (text.length === 0) {
      return { ok: false, content: 'No text was provided to type.', errorCode: 'FAILED' };
    }
    if (text.length > 2_000) {
      return {
        ok: false,
        content: 'That text is too long for Cyps to type safely (limit 2000 characters).',
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

    // The text travels through the environment, never inside the script, so it
    // cannot break out into the PowerShell command.
    const script = [
      '$ErrorActionPreference = "Stop";',
      '$value = $env:CYPS_TYPE_TEXT;',
      'if ([string]::IsNullOrEmpty($value)) { Write-Error "empty"; exit 2 }',
      '$shell = New-Object -ComObject WScript.Shell;',
      'Start-Sleep -Milliseconds 120;',
      '$shell.SendKeys($value);',
      'Write-Output "typed"',
    ].join(' ');

    const result = await this.runChild(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { ...process.env, CYPS_TYPE_TEXT: text },
    );

    if (!result.ok) {
      return {
        ok: false,
        content: `Windows refused the keystrokes: ${result.error}. The target window may not accept input, or the session may be locked.`,
        errorCode: result.timedOut ? 'TIMEOUT' : 'FAILED',
      };
    }

    return {
      ok: true,
      content: `Typed ${text.length} character${text.length === 1 ? '' : 's'} into the focused window.`,
      detail: { characters: text.length },
    };
  }

  /* ------------------------------ browser ----------------------------- */

  private browserOrError(): { browser: BrowserSession } | { error: ToolResult } {
    if (!this.deps.browser) {
      return {
        error: {
          ok: false,
          content: 'Browser automation is not available in this build of Cyps.',
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
      };
    } catch (error) {
      return {
        ok: false,
        content: `Cyps could not open that page: ${message(error)}`,
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
        content: `Cyps could not read the page: ${message(error)}`,
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
        content: `Cyps could not click "${selector}": ${message(error)}`,
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
        content: `Cyps could not type into "${selector}": ${message(error)}`,
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
        content: `Cyps could not scroll the page: ${message(error)}`,
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
        content: `Cyps could not capture the page: ${message(error)}`,
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
        content: `Cyps could not verify the page: ${message(error)}`,
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
  ): Promise<{ ok: boolean; error: string; timedOut: boolean }> {
    return new Promise((resolve) => {
      let settled = false;
      const child = execFile(
        file,
        args,
        { env, windowsHide: true, timeout: DEFAULT_TOOL_TIMEOUT_MS },
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
    });
  }
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
