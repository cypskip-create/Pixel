/**
 * Global shortcuts.
 *
 * Registration is best-effort by design: another application may already own a
 * combination, and a shortcut failing must never prevent Pixel from starting.
 * Failures are reported so the Settings UI can show which one is unavailable.
 */

import { globalShortcut } from 'electron';
import type { AppSettings } from '../shared/types';
import type { PushToTalkReleaseReason } from './services/pushToTalkReleaseWatcher';

export interface PushToTalkWatcher {
  available(): boolean;
  watch(accelerator: string): Promise<PushToTalkReleaseReason>;
  cancel(): Promise<void>;
}

export interface ShortcutCallbacks {
  onToggle: () => void;
  onOpenWorkspace?: () => void;
  onEmergencyStop: () => void;
  onPushToTalkStart?: () => void;
  onPushToTalkEnd?: (reason: PushToTalkReleaseReason) => void | Promise<void>;
}

export interface ShortcutStatus {
  summon: { accelerator: string; ok: boolean };
  workspace: { accelerator: string; ok: boolean };
  emergencyStop: { accelerator: string; ok: boolean };
  pushToTalk: { accelerator: string; ok: boolean; reason?: string };
}

export class ShortcutManager {
  private readonly callbacks: ShortcutCallbacks;
  private status: ShortcutStatus = {
    summon: { accelerator: '', ok: false },
    workspace: { accelerator: '', ok: false },
    emergencyStop: { accelerator: '', ok: false },
    pushToTalk: { accelerator: '', ok: false, reason: 'Push-to-talk is not configured.' },
  };
  private pttActive = false;

  constructor(callbacks: ShortcutCallbacks, private readonly pttWatcher?: PushToTalkWatcher) {
    this.callbacks = callbacks;
  }

  /**
   * (Re)register both shortcuts from settings.
   * Safe to call repeatedly: previous registrations are released first.
   */
  apply(settings: AppSettings): ShortcutStatus {
    this.unregisterAll();

    const summon = settings.globalAccelerator;
    const workspace = settings.workspaceAccelerator;
    const emergency = settings.emergencyStopAccelerator;
    const ptt = settings.voice.pushToTalkAccelerator;

    let summonOk = false;
    let workspaceOk = false;
    let emergencyOk = false;
    let pttOk = false;
    let pttReason: string | undefined;

    if (summon) {
      try {
        summonOk = globalShortcut.register(summon, () => this.callbacks.onToggle());
      } catch {
        summonOk = false;
      }
    }

    if (emergency) {
      // Never let the same combination silently shadow the summon shortcut:
      // the emergency stop takes priority and summon is left unregistered.
      if (emergency === summon) {
        emergencyOk = false;
        summonOk = false;
      }
      try {
        emergencyOk = globalShortcut.register(emergency, () => this.callbacks.onEmergencyStop());
      } catch {
        emergencyOk = false;
      }
    }

    if (workspace && workspace !== summon && workspace !== emergency) {
      try {
        workspaceOk = globalShortcut.register(workspace, () => this.callbacks.onOpenWorkspace?.());
      } catch {
        workspaceOk = false;
      }
    }

    const duplicate = [summon, workspace, emergency].some((value) => value && sameAccelerator(value, ptt));
    if (duplicate) {
      pttReason = 'Push-to-talk conflicts with another Pixel shortcut.';
    } else if (!this.pttWatcher?.available()) {
      pttReason = 'The Windows push-to-talk release watcher is unavailable.';
    } else if (!isSupportedPushToTalkAccelerator(ptt)) {
      pttReason = 'Use a supported key combination with at least one modifier and one key.';
    } else if (ptt) {
      try {
        pttOk = globalShortcut.register(ptt, () => this.beginPushToTalk(ptt));
        if (!pttOk) pttReason = 'Another application already uses this shortcut.';
      } catch {
        pttOk = false;
        pttReason = 'Windows could not register this shortcut.';
      }
    }

    this.status = {
      summon: { accelerator: summon, ok: summonOk },
      workspace: { accelerator: workspace, ok: workspaceOk },
      emergencyStop: { accelerator: emergency, ok: emergencyOk },
      pushToTalk: { accelerator: ptt, ok: pttOk, ...(pttReason ? { reason: pttReason } : {}) },
    };
    return this.status;
  }

  getStatus(): ShortcutStatus {
    return this.status;
  }

  /** Release every shortcut this app registered. */
  unregisterAll(): void {
    this.cancelPushToTalk();
    try {
      globalShortcut.unregisterAll();
    } catch {
      // Nothing to recover from.
    }
  }

  /** Cancel the current recording on emergency stop or application shutdown. */
  cancelPushToTalk(): void {
    if (!this.pttActive) return;
    this.pttActive = false;
    void this.pttWatcher?.cancel();
    void this.callbacks.onPushToTalkEnd?.('cancelled');
  }

  private beginPushToTalk(accelerator: string): void {
    // Electron should never invoke a failed registration, but keeping the
    // callback inert also protects against stale callbacks during reconfigure.
    if (!this.status.pushToTalk.ok || this.pttActive || !this.pttWatcher?.available()) return;
    this.pttActive = true;
    // Spawn the narrowly scoped release observer before microphone startup so a
    // quick tap is still noticed and never leaves an unbounded recording open.
    const released = this.pttWatcher.watch(accelerator);
    this.callbacks.onPushToTalkStart?.();
    void released.then(async (reason) => {
      if (!this.pttActive) return;
      try {
        await this.callbacks.onPushToTalkEnd?.(reason);
      } finally {
        this.pttActive = false;
      }
    }).catch(() => {
      if (!this.pttActive) return;
      try {
        void this.callbacks.onPushToTalkEnd?.('failed');
      } finally {
        this.pttActive = false;
      }
    });
  }
}

/** Keep the native release watcher scoped to the exact registered chord. */
export function isSupportedPushToTalkAccelerator(accelerator: string): boolean {
  const parts = accelerator.split('+').map((part) => part.trim().toLowerCase());
  if (parts.length < 2 || parts.some((part) => !part)) return false;
  const modifiers = new Map([
    ['ctrl', 'control'], ['control', 'control'], ['commandorcontrol', 'commandorcontrol'],
    ['command', 'command'], ['shift', 'shift'], ['alt', 'alt'], ['super', 'super'], ['meta', 'meta'],
  ]);
  const modifierParts = parts.slice(0, -1).map((part) => modifiers.get(part));
  if (modifierParts.some((part) => !part) || new Set(modifierParts).size !== modifierParts.length) return false;
  const hasModifier = modifierParts.length > 0;
  const main = parts[parts.length - 1] ?? '';
  if (modifiers.has(main)) return false;
  const validKey = /^[a-z0-9]$/.test(main) || /^f([1-9]|1[0-9]|2[0-4])$/.test(main) || new Set([
    'space', 'enter', 'return', 'escape', 'esc', 'tab', 'backspace', 'delete', 'insert',
    'home', 'end', 'pageup', 'pagedown', 'up', 'down', 'left', 'right',
  ]).has(main);
  return hasModifier && validKey;
}

/** Compare Electron accelerators while accounting for common modifier aliases. */
function sameAccelerator(left: string, right: string): boolean {
  const canonicalize = (value: string): string => {
    const parts = value.split('+').map((part) => part.trim().toLowerCase());
    if (parts.length < 2 || parts.some((part) => !part)) return value.trim().toLowerCase();
    const key = parts.pop() ?? '';
    const aliases: Record<string, string> = {
      ctrl: 'control', commandorcontrol: 'control', command: 'meta', super: 'meta',
    };
    const modifiers = parts.map((part) => aliases[part] ?? part).sort();
    return [...modifiers, key].join('+');
  };
  return canonicalize(left) === canonicalize(right);
}
