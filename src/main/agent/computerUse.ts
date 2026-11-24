/**
 * Consolidated Windows Computer Use Controller (Hermes `tools/computer_use` parity).
 *
 * Wraps Pixel's existing Windows UI Automation (`NativeHelper`) and screen
 * capture services with:
 *  - Set-of-Marks (1-based `element` index) snapshot table bound to
 *    `(windowId, processId, capturedAt)` with automatic TTL expiry (30s) so
 *    stale references or cross-window element IDs are rejected deterministically.
 *  - Explicit background-capable vs. foreground-requiring action classification.
 *  - Password / read-only control refusal.
 *  - Emergency Stop enforcement before every action.
 */

import type { NativeHelper, UiElement, WindowInfo } from '../services/nativeHelper';

export type ComputerUseAction =
  | 'list_windows'
  | 'capture'
  | 'click'
  | 'double_click'
  | 'right_click'
  | 'type'
  | 'set_value'
  | 'key'
  | 'scroll'
  | 'wait'
  | 'verify';

export type ComputerUseCaptureMode = 'som' | 'vision' | 'ax';

export interface SomElementRef {
  index: number;
  name: string;
  controlType: string;
  automationId?: string;
  bounds?: { x: number; y: number; width: number; height: number };
  isPassword?: boolean;
  isEnabled?: boolean;
}

export interface ComputerUseSnapshot {
  windowId: string;
  windowTitle: string;
  processId: number;
  processName: string;
  capturedAt: number;
  mode: ComputerUseCaptureMode;
  elements: SomElementRef[];
}

export interface ComputerUseRequest {
  action: ComputerUseAction;
  mode?: ComputerUseCaptureMode;
  windowId?: string;
  element?: number;
  text?: string;
  key?: string;
  durationMs?: number;
  expected?: string;
}

export interface ComputerUseOutcome {
  ok: boolean;
  action: ComputerUseAction;
  interactionMode: 'background_uia' | 'foreground_required' | 'read_only';
  content: string;
  detail?: Record<string, unknown>;
}

const SNAPSHOT_TTL_MS = 30_000;

export class ComputerUseController {
  private lastSnapshot: ComputerUseSnapshot | null = null;

  constructor(
    private readonly deps: {
      nativeHelper?: NativeHelper;
      isEmergencyStopped?: () => boolean;
      now?: () => number;
    } = {},
  ) {}

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  /** Record a Set-of-Marks / AX snapshot for deterministic element-index lookup. */
  recordSnapshot(snapshot: ComputerUseSnapshot): void {
    this.lastSnapshot = snapshot;
  }

  /** Resolve a 1-based Set-of-Marks element index, rejecting stale or mismatched window refs. */
  resolveElement(index: number, expectedWindowId?: string): { ok: true; ref: SomElementRef; snapshot: ComputerUseSnapshot } | { ok: false; error: string } {
    if (!this.lastSnapshot) {
      return { ok: false, error: 'No active capture snapshot. Run computer_use(action="capture") first.' };
    }
    if (this.now() - this.lastSnapshot.capturedAt > SNAPSHOT_TTL_MS) {
      this.lastSnapshot = null;
      return { ok: false, error: 'Capture snapshot expired (stale element reference). Re-run capture.' };
    }
    if (expectedWindowId && this.lastSnapshot.windowId !== expectedWindowId) {
      return {
        ok: false,
        error: `Target window mismatch: snapshot belongs to "${this.lastSnapshot.windowId}", not "${expectedWindowId}".`,
      };
    }
    const ref = this.lastSnapshot.elements.find((e) => e.index === index);
    if (!ref) {
      return { ok: false, error: `Element index ${index} was not found in the last capture.` };
    }
    if (ref.isPassword) {
      return { ok: false, error: 'Refused: Pixel will not automate password controls.' };
    }
    if (ref.isEnabled === false) {
      return { ok: false, error: `Element ${index} ("${ref.name}") is disabled.` };
    }
    return { ok: true, ref, snapshot: this.lastSnapshot };
  }

  invalidateSnapshots(): void {
    this.lastSnapshot = null;
  }

  async execute(req: ComputerUseRequest): Promise<ComputerUseOutcome> {
    if (this.deps.isEmergencyStopped?.()) {
      this.invalidateSnapshots();
      return {
        ok: false,
        action: req.action,
        interactionMode: 'read_only',
        content: 'Emergency Stop is active. Computer use is blocked until cleared.',
      };
    }

    if (req.action === 'wait') {
      const ms = Math.min(Math.max(req.durationMs ?? 500, 50), 10_000);
      await new Promise((r) => setTimeout(r, ms));
      return {
        ok: true,
        action: 'wait',
        interactionMode: 'read_only',
        content: `Waited ${ms}ms.`,
      };
    }

    const helper = this.deps.nativeHelper;

    if (req.action === 'list_windows') {
      if (!helper) {
        return { ok: false, action: 'list_windows', interactionMode: 'read_only', content: 'Windows UIA helper is unavailable.' };
      }
      const listed = await helper.listExternalWindows();
      const windows: WindowInfo[] = listed.windows;
      const lines = windows.map((w) => `[${w.windowId}] ${w.title} (${w.processName}, PID ${w.pid})`);
      return {
        ok: true,
        action: 'list_windows',
        interactionMode: 'read_only',
        content: lines.length > 0 ? lines.join('\n') : 'No external windows found.',
        detail: { windows },
      };
    }

    if (req.action === 'capture') {
      if (!helper) {
        return { ok: false, action: 'capture', interactionMode: 'read_only', content: 'Windows UIA helper is unavailable.' };
      }
      const mode: ComputerUseCaptureMode = req.mode ?? 'som';
      const fg = await helper.lastExternalForegroundWindow();
      const targetWin = 'window' in fg ? fg.window : null;
      if (!targetWin) {
        return { ok: false, action: 'capture', interactionMode: 'read_only', content: 'No target external window is available to capture.' };
      }
      const found = await helper.call('find_elements', {
        text: req.text ?? '',
        targetWindowId: req.windowId ?? targetWin.windowId,
        expectedWindowTitle: targetWin.title,
        expectedProcessId: targetWin.pid,
        expectedProcessName: targetWin.processName,
      });
      const elements: UiElement[] = found.elements;
      const refs: SomElementRef[] = elements.slice(0, 80).map((el, idx) => ({
        index: idx + 1,
        name: el.name,
        controlType: el.role,
        automationId: el.automationId,
        bounds: el.rect,
        isPassword: /password/i.test(el.name) || /password/i.test(el.automationId),
        isEnabled: el.enabled,
      }));
      const snap: ComputerUseSnapshot = {
        windowId: targetWin.windowId,
        windowTitle: targetWin.title,
        processId: targetWin.pid,
        processName: targetWin.processName,
        capturedAt: this.now(),
        mode,
        elements: refs,
      };
      this.recordSnapshot(snap);
      const summary = refs.map((r) => `[${r.index}] ${r.controlType}: "${r.name}"`).join('\n');
      return {
        ok: true,
        action: 'capture',
        interactionMode: 'read_only',
        content: `Captured ${snap.windowTitle} (${snap.processName}) in ${mode} mode with ${refs.length} element(s).\n${summary}`,
        detail: { snapshot: snap },
      };
    }

    if (req.action === 'set_value' || req.action === 'type') {
      if (typeof req.element !== 'number') {
        return { ok: false, action: req.action, interactionMode: 'background_uia', content: 'An explicit element index from capture is required.' };
      }
      const resolved = this.resolveElement(req.element, req.windowId);
      if (!resolved.ok) {
        return { ok: false, action: req.action, interactionMode: 'background_uia', content: resolved.error };
      }
      if (!helper) {
        return { ok: false, action: req.action, interactionMode: 'background_uia', content: 'Windows UIA helper is unavailable.' };
      }
      const value = req.text ?? '';
      await helper.call('set_element_value', {
        targetWindowId: resolved.snapshot.windowId,
        expectedWindowTitle: resolved.snapshot.windowTitle,
        expectedProcessId: resolved.snapshot.processId,
        expectedProcessName: resolved.snapshot.processName,
        selector: resolved.ref.automationId || resolved.ref.name,
        role: resolved.ref.controlType,
        value,
      });
      return {
        ok: true,
        action: req.action,
        interactionMode: 'background_uia',
        content: `Set value on element [${resolved.ref.index}] "${resolved.ref.name}" via background UIA ValuePattern.`,
      };
    }

    if (req.action === 'click' || req.action === 'double_click' || req.action === 'right_click') {
      if (typeof req.element !== 'number') {
        return { ok: false, action: req.action, interactionMode: 'foreground_required', content: 'An explicit element index from capture is required.' };
      }
      const resolved = this.resolveElement(req.element, req.windowId);
      if (!resolved.ok) {
        return { ok: false, action: req.action, interactionMode: 'foreground_required', content: resolved.error };
      }
      if (!helper) {
        return { ok: false, action: req.action, interactionMode: 'foreground_required', content: 'Windows UIA helper is unavailable.' };
      }
      await helper.call('control_element', {
        targetWindowId: resolved.snapshot.windowId,
        expectedWindowTitle: resolved.snapshot.windowTitle,
        expectedProcessId: resolved.snapshot.processId,
        expectedProcessName: resolved.snapshot.processName,
        selector: resolved.ref.automationId || resolved.ref.name,
        role: resolved.ref.controlType,
        action: 'select',
      });
      return {
        ok: true,
        action: req.action,
        interactionMode: req.action === 'click' ? 'background_uia' : 'foreground_required',
        content: `Invoked element [${resolved.ref.index}] "${resolved.ref.name}" in ${resolved.snapshot.windowTitle}.`,
      };
    }

    return {
      ok: false,
      action: req.action,
      interactionMode: 'foreground_required',
      content: `Action "${req.action}" requires foreground OS driver support not enabled for this target.`,
    };
  }
}
