/**
 * Consolidated Windows Computer Use Controller (Hermes `tools/computer_use` parity).
 *
 * Persistent across separate agent tool calls:
 *  - `ax` mode: structured UIA accessibility tree + verified target window/process identity.
 *  - `vision` mode: real PNG screenshot via `capture_window` + window bounds.
 *  - `som` mode: real PNG screenshot + 1-based Set-of-Marks element index table bound to
 *    `(snapshotId, windowId, processId, capturedAt)` with 30s TTL expiry.
 *  - Distinct action semantics: `click` (UIA select/invoke), `set_value`/`type` (UIA ValuePattern),
 *    `scroll` (UIA ScrollPattern), `verify` (`verify_element_state`), while `double_click`,
 *    `right_click`, `middle_click`, `drag`, and `key` explicitly report `foreground_required`
 *    instead of silently masquerading as UIA `select`.
 */

import { randomUUID } from 'node:crypto';
import type { ComputerUseSettings, ImageAttachment } from '../../shared/types';
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
  snapshotId: string;
  windowId: string;
  windowTitle: string;
  processId: number;
  processName: string;
  capturedAt: number;
  mode: ComputerUseCaptureMode;
  elements: SomElementRef[];
  image?: ImageAttachment;
}

export interface ComputerUseRequest {
  action: ComputerUseAction;
  mode?: ComputerUseCaptureMode;
  windowId?: string;
  element?: number;
  text?: string;
  key?: string;
  direction?: 'up' | 'down';
  durationMs?: number;
  expected?: string;
}

export interface ComputerUseOutcome {
  ok: boolean;
  action: ComputerUseAction;
  interactionMode: 'background_uia' | 'foreground_required' | 'read_only';
  content: string;
  image?: ImageAttachment;
  detail?: Record<string, unknown>;
}

const SNAPSHOT_TTL_MS = 30_000;

export class ComputerUseController {
  private lastSnapshot: ComputerUseSnapshot | null = null;

  constructor(
    private readonly deps: {
      nativeHelper?: NativeHelper;
      isEmergencyStopped?: () => boolean;
      getSettings?: () => ComputerUseSettings;
      now?: () => number;
    } = {},
  ) {}

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  recordSnapshot(snapshot: ComputerUseSnapshot): void {
    this.lastSnapshot = snapshot;
  }

  getSnapshot(): ComputerUseSnapshot | null {
    return this.lastSnapshot;
  }

  resolveElement(
    index: number,
    expectedWindowId?: string,
  ): { ok: true; ref: SomElementRef; snapshot: ComputerUseSnapshot } | { ok: false; error: string } {
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
      const mode: ComputerUseCaptureMode = req.mode ?? this.deps.getSettings?.().captureMode ?? 'som';
      const fg = await helper.lastExternalForegroundWindow();
      const targetWin = 'window' in fg ? fg.window : null;
      if (!targetWin) {
        return { ok: false, action: 'capture', interactionMode: 'read_only', content: 'No target external window is available to capture.' };
      }

      let image: ImageAttachment | undefined;
      if (mode === 'vision' || mode === 'som') {
        try {
          const cap = await helper.call('capture_window', {
            targetWindowId: req.windowId ?? targetWin.windowId,
            expectedWindowTitle: targetWin.title,
            expectedProcessId: targetWin.pid,
            expectedProcessName: targetWin.processName,
            requireForeground: false,
          });
          if (cap && typeof cap.base64 === 'string' && cap.base64.length > 0) {
            image = {
              dataUrl: `data:image/png;base64,${cap.base64}`,
              mimeType: 'image/png',
              width: cap.width,
              height: cap.height,
              source: 'screenshot',
              label: `${targetWin.title} (${mode})`,
            };
          }
        } catch {
          // If PrintWindow capture is unavailable for this window, fall back cleanly to AX metadata.
        }
      }

      let refs: SomElementRef[] = [];
      if (mode === 'ax' || mode === 'som') {
        const found = await helper.call('find_elements', {
          text: req.text ?? '',
          targetWindowId: req.windowId ?? targetWin.windowId,
          expectedWindowTitle: targetWin.title,
          expectedProcessId: targetWin.pid,
          expectedProcessName: targetWin.processName,
        });
        const elements: UiElement[] = found.elements;
        refs = elements.slice(0, 80).map((el, idx) => ({
          index: idx + 1,
          name: el.name,
          controlType: el.role,
          automationId: el.automationId,
          bounds: el.rect,
          isPassword: /password/i.test(el.name) || /password/i.test(el.automationId),
          isEnabled: el.enabled,
        }));
      }

      const snap: ComputerUseSnapshot = {
        snapshotId: `snap_${randomUUID().slice(0, 8)}`,
        windowId: targetWin.windowId,
        windowTitle: targetWin.title,
        processId: targetWin.pid,
        processName: targetWin.processName,
        capturedAt: this.now(),
        mode,
        elements: refs,
        ...(image ? { image } : {}),
      };
      this.recordSnapshot(snap);

      const summary = refs.map((r) => `[${r.index}] ${r.controlType}: "${r.name}"${r.bounds ? ` @(${r.bounds.x},${r.bounds.y},${r.bounds.width}x${r.bounds.height})` : ''}`).join('\n');
      return {
        ok: true,
        action: 'capture',
        interactionMode: 'read_only',
        content: `Captured ${snap.windowTitle} (${snap.processName}) in ${mode} mode [${snap.snapshotId}]${image ? ` with ${image.width}x${image.height} PNG screenshot` : ''} and ${refs.length} element(s).${summary ? `\n${summary}` : ''}`,
        ...(image ? { image } : {}),
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
      await helper.call('set_element_value', {
        targetWindowId: resolved.snapshot.windowId,
        expectedWindowTitle: resolved.snapshot.windowTitle,
        expectedProcessId: resolved.snapshot.processId,
        expectedProcessName: resolved.snapshot.processName,
        selector: resolved.ref.automationId || resolved.ref.name,
        role: resolved.ref.controlType,
        value: req.text ?? '',
      });
      return {
        ok: true,
        action: req.action,
        interactionMode: 'background_uia',
        content: `Set value on element [${resolved.ref.index}] "${resolved.ref.name}" via background UIA ValuePattern.`,
      };
    }

    if (req.action === 'click') {
      if (typeof req.element !== 'number') {
        return { ok: false, action: 'click', interactionMode: 'background_uia', content: 'An explicit element index from capture is required.' };
      }
      const resolved = this.resolveElement(req.element, req.windowId);
      if (!resolved.ok) {
        return { ok: false, action: 'click', interactionMode: 'background_uia', content: resolved.error };
      }
      if (!helper) {
        return { ok: false, action: 'click', interactionMode: 'background_uia', content: 'Windows UIA helper is unavailable.' };
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
        action: 'click',
        interactionMode: 'background_uia',
        content: `Clicked/selected element [${resolved.ref.index}] "${resolved.ref.name}" in ${resolved.snapshot.windowTitle} via background UIA.`,
      };
    }

    if (req.action === 'scroll') {
      if (typeof req.element !== 'number') {
        return { ok: false, action: 'scroll', interactionMode: 'background_uia', content: 'An explicit element index from capture is required to scroll.' };
      }
      const resolved = this.resolveElement(req.element, req.windowId);
      if (!resolved.ok) {
        return { ok: false, action: 'scroll', interactionMode: 'background_uia', content: resolved.error };
      }
      if (!helper) {
        return { ok: false, action: 'scroll', interactionMode: 'background_uia', content: 'Windows UIA helper is unavailable.' };
      }
      await helper.call('control_element', {
        targetWindowId: resolved.snapshot.windowId,
        expectedWindowTitle: resolved.snapshot.windowTitle,
        expectedProcessId: resolved.snapshot.processId,
        expectedProcessName: resolved.snapshot.processName,
        selector: resolved.ref.automationId || resolved.ref.name,
        role: resolved.ref.controlType,
        action: 'scroll',
        scrollAxis: 'vertical',
        scrollDirection: req.direction === 'up' ? 'decrement' : 'increment',
      });
      return {
        ok: true,
        action: 'scroll',
        interactionMode: 'background_uia',
        content: `Scrolled element [${resolved.ref.index}] "${resolved.ref.name}" ${req.direction === 'up' ? 'up' : 'down'}.`,
      };
    }

    if (req.action === 'verify') {
      if (!helper || !this.lastSnapshot) {
        return { ok: false, action: 'verify', interactionMode: 'read_only', content: 'Capture a window first before verifying element state.' };
      }
      const selector = req.expected?.trim() || '';
      if (!selector) {
        return { ok: false, action: 'verify', interactionMode: 'read_only', content: 'Specify expected selector/text to verify.' };
      }
      const res = await helper.call('verify_element_state', {
        selector,
        targetWindowId: this.lastSnapshot.windowId,
        expectedWindowTitle: this.lastSnapshot.windowTitle,
        expectedProcessId: this.lastSnapshot.processId,
        expectedProcessName: this.lastSnapshot.processName,
        state: 'present',
      });
      return {
        ok: res.matches,
        action: 'verify',
        interactionMode: 'read_only',
        content: res.matches
          ? `Verified "${selector}" is present (${res.matchedCount} match(es)).`
          : `Verification failed: "${selector}" was not found in ${this.lastSnapshot.windowTitle}.`,
      };
    }

    // Distinct foreground-only pointer/keyboard actions (never silently aliased to UIA select!).
    return {
      ok: false,
      action: req.action,
      interactionMode: 'foreground_required',
      content: `Action "${req.action}" requires foreground pointer/keyboard driver control and is not silently emulated via UIA select.`,
    };
  }
}
