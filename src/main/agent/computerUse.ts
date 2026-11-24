/**
 * Consolidated Windows Computer Use Controller (Hermes `tools/computer_use` parity).
 *
 * Session-isolated & multimodal:
 *  - Snapshots are strictly scoped per `scopeKey` (trusted conversation/project/agent ID)
 *    and bound to `(snapshotId, windowId, processId, capturedAt)` with 30s TTL expiry.
 *    A capture from Conversation A NEVER overwrites Conversation B's active snapshot.
 *  - `ax` mode: structured UIA accessibility tree + verified target window/process identity.
 *  - `vision` mode: real PNG screenshot via `capture_window` + window bounds.
 *  - `som` mode: real PNG screenshot annotated via Python Set-of-Marks (`annotateSom`)
 *    with crisp visible bounding boxes & 1-based numbered badges matching the element table.
 *  - Distinct action semantics:
 *    - Background UIA: `click`, `set_value`/`type`, `scroll`, `verify`.
 *    - Foreground Win32 (`PixelNative.exe` `mouse_action`/`send_keys`/`focus_window`):
 *      `double_click`, `right_click`, `middle_click`, `drag`, `key`, `focus_window`
 *      execute against the revalidated target window when `allowForegroundFallback === true`,
 *      and explicitly refuse with `foreground_required` when foreground input is disabled.
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
  | 'middle_click'
  | 'drag'
  | 'type'
  | 'set_value'
  | 'key'
  | 'scroll'
  | 'focus_window'
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
  scopeKey: string;
  windowId: string;
  windowTitle: string;
  processId: number;
  processName: string;
  windowBounds?: { x: number; y: number; width: number; height: number };
  capturedAt: number;
  mode: ComputerUseCaptureMode;
  elements: SomElementRef[];
  image?: ImageAttachment;
  somAnnotated?: boolean;
}

export interface ComputerUseRequest {
  action: ComputerUseAction;
  mode?: ComputerUseCaptureMode;
  windowId?: string;
  snapshotId?: string;
  element?: number;
  targetElement?: number;
  text?: string;
  key?: string;
  direction?: 'up' | 'down';
  durationMs?: number;
  expected?: string;
  /** Trusted runtime scope (conversation/project/task). Set by ToolExecutors, never model args. */
  scopeKey?: string;
}

export interface ComputerUseOutcome {
  ok: boolean;
  action: ComputerUseAction;
  interactionMode: 'background_uia' | 'foreground_approved' | 'foreground_required' | 'read_only';
  content: string;
  image?: ImageAttachment;
  detail?: Record<string, unknown>;
}

export type SomAnnotator = (input: {
  pngBase64: string;
  elements: Array<{ index: number; bounds?: { x: number; y: number; width: number; height: number } }>;
  windowBounds?: { x: number; y: number; width: number; height: number };
}) => Promise<{ ok: boolean; annotatedBase64?: string; width?: number; height?: number; annotatedCount?: number; error?: string }>;

const SNAPSHOT_TTL_MS = 30_000;
const DEFAULT_SCOPE = 'default-session';

export class ComputerUseController {
  private readonly snapshots = new Map<string, ComputerUseSnapshot>();

  constructor(
    private readonly deps: {
      nativeHelper?: NativeHelper;
      isEmergencyStopped?: () => boolean;
      getSettings?: () => ComputerUseSettings;
      annotateSom?: SomAnnotator;
      now?: () => number;
    } = {},
  ) {}

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  private normalizeScope(scopeKey?: string): string {
    return (scopeKey && scopeKey.trim()) ? scopeKey.trim() : DEFAULT_SCOPE;
  }

  recordSnapshot(snapshot: ComputerUseSnapshot, scopeKey?: string): void {
    const scope = this.normalizeScope(scopeKey ?? snapshot.scopeKey);
    this.snapshots.set(scope, { ...snapshot, scopeKey: scope });
  }

  getSnapshot(scopeKey?: string): ComputerUseSnapshot | null {
    return this.snapshots.get(this.normalizeScope(scopeKey)) ?? null;
  }

  resolveElement(
    index: number,
    expectedWindowId?: string,
    scopeKey?: string,
    expectedSnapshotId?: string,
  ): { ok: true; ref: SomElementRef; snapshot: ComputerUseSnapshot } | { ok: false; error: string } {
    const scope = this.normalizeScope(scopeKey);
    const snap = this.snapshots.get(scope);
    if (!snap) {
      return { ok: false, error: 'No active capture snapshot for this session. Run computer_use(action="capture") first.' };
    }
    if (this.now() - snap.capturedAt > SNAPSHOT_TTL_MS) {
      this.snapshots.delete(scope);
      return { ok: false, error: 'Capture snapshot expired (stale element reference). Re-run capture.' };
    }
    if (expectedSnapshotId && snap.snapshotId !== expectedSnapshotId) {
      return {
        ok: false,
        error: `Snapshot mismatch: expected "${expectedSnapshotId}", active session snapshot is "${snap.snapshotId}".`,
      };
    }
    if (expectedWindowId && snap.windowId !== expectedWindowId) {
      return {
        ok: false,
        error: `Target window mismatch: snapshot belongs to "${snap.windowId}", not "${expectedWindowId}".`,
      };
    }
    const ref = snap.elements.find((e) => e.index === index);
    if (!ref) {
      return { ok: false, error: `Element index ${index} was not found in the last capture.` };
    }
    if (ref.isPassword) {
      return { ok: false, error: 'Refused: Pixel will not automate password controls.' };
    }
    if (ref.isEnabled === false) {
      return { ok: false, error: `Element ${index} ("${ref.name}") is disabled.` };
    }
    return { ok: true, ref, snapshot: snap };
  }

  invalidateSnapshots(scopeKey?: string): void {
    if (scopeKey) {
      this.snapshots.delete(this.normalizeScope(scopeKey));
    } else {
      this.snapshots.clear();
    }
  }

  async execute(req: ComputerUseRequest): Promise<ComputerUseOutcome> {
    const scope = this.normalizeScope(req.scopeKey);

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
    const settings = this.deps.getSettings?.();

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
      const mode: ComputerUseCaptureMode = req.mode ?? settings?.captureMode ?? 'som';
      const fg = await helper.lastExternalForegroundWindow();
      const targetWin = 'window' in fg ? fg.window : null;
      if (!targetWin) {
        return { ok: false, action: 'capture', interactionMode: 'read_only', content: 'No target external window is available to capture.' };
      }

      let rawPngBase64 = '';
      let capWidth = targetWin.rect?.width ?? 0;
      let capHeight = targetWin.rect?.height ?? 0;
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
            rawPngBase64 = cap.base64;
            capWidth = cap.width;
            capHeight = cap.height;
          }
        } catch {
          // PrintWindow may fail on protected/minimized windows; fall back cleanly to AX metadata.
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

      let finalPngBase64 = rawPngBase64;
      let somAnnotated = false;
      if (mode === 'som' && rawPngBase64 && refs.length > 0 && this.deps.annotateSom) {
        try {
          const ann = await this.deps.annotateSom({
            pngBase64: rawPngBase64,
            elements: refs.map((r) => ({ index: r.index, bounds: r.bounds })),
            windowBounds: targetWin.rect,
          });
          if (ann.ok && ann.annotatedBase64) {
            finalPngBase64 = ann.annotatedBase64;
            somAnnotated = true;
          }
        } catch {
          // Keep unannotated screenshot if annotator is temporarily unavailable.
        }
      }

      const image: ImageAttachment | undefined = finalPngBase64
        ? {
            dataUrl: `data:image/png;base64,${finalPngBase64}`,
            mimeType: 'image/png',
            width: capWidth,
            height: capHeight,
            source: 'screenshot',
            label: `${targetWin.title} (${mode}${somAnnotated ? ' annotated' : ''})`,
          }
        : undefined;

      const snap: ComputerUseSnapshot = {
        snapshotId: `snap_${randomUUID().slice(0, 8)}`,
        scopeKey: scope,
        windowId: targetWin.windowId,
        windowTitle: targetWin.title,
        processId: targetWin.pid,
        processName: targetWin.processName,
        windowBounds: targetWin.rect,
        capturedAt: this.now(),
        mode,
        elements: refs,
        ...(image ? { image } : {}),
        somAnnotated,
      };
      this.recordSnapshot(snap, scope);

      const summary = refs
        .map((r) => `[${r.index}] ${r.controlType}: "${r.name}"${r.bounds ? ` @(${r.bounds.x},${r.bounds.y},${r.bounds.width}x${r.bounds.height})` : ''}`)
        .join('\n');
      return {
        ok: true,
        action: 'capture',
        interactionMode: 'read_only',
        content: `Captured ${snap.windowTitle} (${snap.processName}) in ${mode}${somAnnotated ? ' (Set-of-Marks annotated)' : ''} mode [${snap.snapshotId}]${image ? ` with ${image.width}x${image.height} PNG screenshot` : ''} and ${refs.length} element(s).${summary ? `\n${summary}` : ''}`,
        ...(image ? { image } : {}),
        detail: { snapshot: snap },
      };
    }

    if (req.action === 'set_value' || req.action === 'type') {
      if (typeof req.element !== 'number') {
        return { ok: false, action: req.action, interactionMode: 'background_uia', content: 'An explicit element index from capture is required.' };
      }
      const resolved = this.resolveElement(req.element, req.windowId, scope, req.snapshotId);
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
      const resolved = this.resolveElement(req.element, req.windowId, scope, req.snapshotId);
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
      const resolved = this.resolveElement(req.element, req.windowId, scope, req.snapshotId);
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
      const snap = this.getSnapshot(scope);
      if (!helper || !snap) {
        return { ok: false, action: 'verify', interactionMode: 'read_only', content: 'Capture a window first before verifying element state.' };
      }
      const selector = req.expected?.trim() || '';
      if (!selector) {
        return { ok: false, action: 'verify', interactionMode: 'read_only', content: 'Specify expected selector/text to verify.' };
      }
      const res = await helper.call('verify_element_state', {
        selector,
        targetWindowId: snap.windowId,
        expectedWindowTitle: snap.windowTitle,
        expectedProcessId: snap.processId,
        expectedProcessName: snap.processName,
        state: 'present',
      });
      return {
        ok: res.matches,
        action: 'verify',
        interactionMode: 'read_only',
        content: res.matches
          ? `Verified "${selector}" is present (${res.matchedCount} match(es)).`
          : `Verification failed: "${selector}" was not found in ${snap.windowTitle}.`,
      };
    }

    // Foreground-only Win32 pointer/keyboard/focus actions: require explicit allowForegroundFallback!
    const foregroundAllowed = settings?.allowForegroundFallback === true;
    if (!foregroundAllowed) {
      return {
        ok: false,
        action: req.action,
        interactionMode: 'foreground_required',
        content: `Action "${req.action}" requires foreground pointer/keyboard control (enable "Allow foreground fallback" in Computer Use settings).`,
      };
    }

    if (!helper) {
      return {
        ok: false,
        action: req.action,
        interactionMode: 'foreground_approved',
        content: 'Windows UIA/Win32 native helper is unavailable.',
      };
    }

    const snap = this.getSnapshot(scope);
    if (!snap) {
      return {
        ok: false,
        action: req.action,
        interactionMode: 'foreground_approved',
        content: 'Capture a window first before issuing foreground actions.',
      };
    }

    if (req.action === 'focus_window') {
      const res = await helper.call('focus_window', {
        targetWindowId: snap.windowId,
        expectedWindowTitle: snap.windowTitle,
        expectedProcessId: snap.processId,
        expectedProcessName: snap.processName,
      });
      return {
        ok: res.focused,
        action: 'focus_window',
        interactionMode: 'foreground_approved',
        content: res.focused ? `Focused window "${snap.windowTitle}".` : `Could not focus "${snap.windowTitle}".`,
      };
    }

    if (req.action === 'key') {
      const keyStr = req.key?.trim() || '';
      if (!keyStr) {
        return { ok: false, action: 'key', interactionMode: 'foreground_approved', content: 'Specify a key or shortcut (e.g. Enter, Ctrl+S).' };
      }
      const res = await helper.call('send_keys', {
        targetWindowId: snap.windowId,
        expectedWindowTitle: snap.windowTitle,
        expectedProcessId: snap.processId,
        expectedProcessName: snap.processName,
        key: keyStr,
      });
      return {
        ok: res.executed,
        action: 'key',
        interactionMode: 'foreground_approved',
        content: `Sent key "${keyStr}" to "${snap.windowTitle}".`,
      };
    }

    if (req.action === 'double_click' || req.action === 'right_click' || req.action === 'middle_click' || req.action === 'drag') {
      if (typeof req.element !== 'number') {
        return { ok: false, action: req.action, interactionMode: 'foreground_approved', content: 'An explicit element index from capture is required.' };
      }
      const resolved = this.resolveElement(req.element, req.windowId, scope, req.snapshotId);
      if (!resolved.ok) {
        return { ok: false, action: req.action, interactionMode: 'foreground_approved', content: resolved.error };
      }
      const b = resolved.ref.bounds;
      if (!b) {
        return { ok: false, action: req.action, interactionMode: 'foreground_approved', content: `Element [${resolved.ref.index}] has no screen bounds.` };
      }
      const cx = Math.round(b.x + b.width / 2);
      const cy = Math.round(b.y + b.height / 2);
      let toX = cx;
      let toY = cy;
      if (req.action === 'drag' && typeof req.targetElement === 'number') {
        const dest = this.resolveElement(req.targetElement, req.windowId, scope, req.snapshotId);
        if (dest.ok && dest.ref.bounds) {
          toX = Math.round(dest.ref.bounds.x + dest.ref.bounds.width / 2);
          toY = Math.round(dest.ref.bounds.y + dest.ref.bounds.height / 2);
        }
      }
      const res = await helper.call('mouse_action', {
        targetWindowId: resolved.snapshot.windowId,
        expectedWindowTitle: resolved.snapshot.windowTitle,
        expectedProcessId: resolved.snapshot.processId,
        expectedProcessName: resolved.snapshot.processName,
        action: req.action,
        x: cx,
        y: cy,
        ...(req.action === 'drag' ? { toX, toY } : {}),
      });
      return {
        ok: res.executed,
        action: req.action,
        interactionMode: 'foreground_approved',
        content: `Performed foreground ${req.action} on [${resolved.ref.index}] "${resolved.ref.name}" at (${res.x},${res.y}).`,
      };
    }

    return {
      ok: false,
      action: req.action,
      interactionMode: 'foreground_required',
      content: `Unsupported computer_use action "${String(req.action)}".`,
    };
  }
}
