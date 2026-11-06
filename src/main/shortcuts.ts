/**
 * Global shortcuts.
 *
 * Registration is best-effort by design: another application may already own a
 * combination, and a shortcut failing must never prevent Pixel from starting.
 * Failures are reported so the Settings UI can show which one is unavailable.
 */

import { globalShortcut } from 'electron';
import type { AppSettings } from '../shared/types';

export interface ShortcutCallbacks {
  onToggle: () => void;
  onEmergencyStop: () => void;
}

export interface ShortcutStatus {
  summon: { accelerator: string; ok: boolean };
  emergencyStop: { accelerator: string; ok: boolean };
}

export class ShortcutManager {
  private readonly callbacks: ShortcutCallbacks;
  private status: ShortcutStatus = {
    summon: { accelerator: '', ok: false },
    emergencyStop: { accelerator: '', ok: false },
  };

  constructor(callbacks: ShortcutCallbacks) {
    this.callbacks = callbacks;
  }

  /**
   * (Re)register both shortcuts from settings.
   * Safe to call repeatedly: previous registrations are released first.
   */
  apply(settings: AppSettings): ShortcutStatus {
    this.unregisterAll();

    const summon = settings.globalAccelerator;
    const emergency = settings.emergencyStopAccelerator;

    let summonOk = false;
    let emergencyOk = false;

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

    this.status = {
      summon: { accelerator: summon, ok: summonOk },
      emergencyStop: { accelerator: emergency, ok: emergencyOk },
    };
    return this.status;
  }

  getStatus(): ShortcutStatus {
    return this.status;
  }

  /** Release every shortcut this app registered. */
  unregisterAll(): void {
    try {
      globalShortcut.unregisterAll();
    } catch {
      // Nothing to recover from.
    }
  }
}
