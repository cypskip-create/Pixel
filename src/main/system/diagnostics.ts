/**
 * Diagnostics: real, verified facts about the machine.
 *
 * Two rules learned the hard way on this platform:
 *  1. Every probe can fail independently; a failed probe yields null or a
 *     warning, never a throw.
 *  2. Never invent a value. If Windows will not tell us free disk space, the
 *     field is null and the UI says "unavailable", rather than showing 0.
 *
 * This returns the frozen `DiagnosticsSnapshot` shape from src/shared/types.ts.
 * Display data comes from Electron's screen module via the injected probe, so
 * this file stays free of Electron imports and remains unit-testable.
 */

import { arch, cpus, freemem, loadavg, platform, release, totalmem, uptime } from 'node:os';
import type { DiagnosticsSnapshot } from '../../shared/types';

/** Injected probes, so tests can simulate a hostile environment. */
export interface DiagnosticsProbes {
  now: () => number;
  /** Electron `screen.getAllDisplays()`, mapped to the shared display shape. */
  getDisplays: () => DiagnosticsSnapshot['displays'];
  /** Optional disk probe; returns null when the platform refuses to answer. */
  getDisks?: () => DiagnosticsSnapshot['disks'];
  /** Optional battery probe; returns null when unavailable. */
  getBattery?: () => DiagnosticsSnapshot['battery'];
}

export type DisplayInfo = DiagnosticsSnapshot['displays'][number];

/** Normalize one Electron display into the shared shape. */
export function toDisplayInfo(display: {
  id: number;
  label?: string;
  size: { width: number; height: number };
  bounds: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
}): DisplayInfo {
  return {
    id: String(display.id),
    width: display.size.width,
    height: display.size.height,
    scaleFactor: display.scaleFactor,
    label: display.label && display.label.length > 0 ? display.label : `Display ${display.id}`,
    bounds: {
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
    },
  };
}

/**
 * Choose the primary display: the one Electron reports as primary, else the
 * first. Exported so the window module can reuse the same rule.
 */
export function pickPrimary(
  displays: DisplayInfo[],
  primaryId?: string,
): DiagnosticsSnapshot['primaryDisplay'] {
  if (displays.length === 0) return null;
  const match = primaryId ? displays.find((d) => d.id === primaryId) : undefined;
  const chosen = match ?? displays[0];
  return {
    id: chosen.id,
    width: chosen.width,
    height: chosen.height,
    scaleFactor: chosen.scaleFactor,
    label: chosen.label,
  };
}

/**
 * Collect a snapshot. Pure apart from the injected probes, so it is fully
 * testable without Electron, fs, or WMI.
 */
export function collectDiagnostics(
  probes: DiagnosticsProbes,
  primaryDisplayId?: string,
): DiagnosticsSnapshot {
  const warnings: string[] = [];
  const cpuList = cpus();

  let displays: DiagnosticsSnapshot['displays'] = [];
  try {
    displays = probes.getDisplays();
  } catch (error) {
    warnings.push(`Display information unavailable: ${describe(error)}`);
  }

  let disks: DiagnosticsSnapshot['disks'] = null;
  if (probes.getDisks) {
    try {
      disks = probes.getDisks();
    } catch (error) {
      warnings.push(`Disk information unavailable: ${describe(error)}`);
    }
  } else {
    warnings.push('Disk information unavailable on this system.');
  }

  let battery: DiagnosticsSnapshot['battery'] = null;
  if (probes.getBattery) {
    try {
      battery = probes.getBattery();
    } catch (error) {
      warnings.push(`Battery information unavailable: ${describe(error)}`);
    }
  } else {
    warnings.push('Battery information unavailable on this system.');
  }

  // loadavg() legitimately returns 0,0,0 on Windows; that is a real reading,
  // not a failure, so it is reported as-is.
  const [loadAverage1m = 0] = loadavg();

  return {
    capturedAt: probes.now(),
    platform: platform(),
    release: release(),
    arch: arch(),
    cpuModel: cpuList[0]?.model ?? 'Unknown',
    cpuCount: cpuList.length,
    loadAverage1m,
    totalMemoryBytes: totalmem(),
    freeMemoryBytes: freemem(),
    uptimeSeconds: Math.round(uptime()),
    disks,
    battery,
    primaryDisplay: pickPrimary(displays, primaryDisplayId),
    displays,
    warnings,
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Human-readable summary lines for the diagnostics panel. */
export function summarize(snapshot: DiagnosticsSnapshot): string[] {
  const lines = [
    `${snapshot.platform} ${snapshot.release} (${snapshot.arch})`,
    `CPU ${snapshot.cpuModel} - ${snapshot.cpuCount} cores, load ${snapshot.loadAverage1m.toFixed(2)}`,
    `Memory ${formatGb(snapshot.freeMemoryBytes)} GB free of ${formatGb(snapshot.totalMemoryBytes)} GB`,
    `Up since ${formatUptime(snapshot.uptimeSeconds)}`,
    snapshot.primaryDisplay
      ? `Primary display ${snapshot.primaryDisplay.label} ${snapshot.primaryDisplay.width}x${snapshot.primaryDisplay.height} @${snapshot.primaryDisplay.scaleFactor}x`
      : 'Primary display: unavailable',
    `Displays: ${snapshot.displays.length}`,
  ];

  if (snapshot.disks === null) {
    lines.push('Disk space: unavailable on this system');
  } else {
    for (const disk of snapshot.disks) {
      lines.push(
        disk.freeBytes === null || disk.totalBytes === null
          ? `${disk.mount}: size unavailable`
          : `${disk.mount}: ${formatGb(disk.freeBytes)} GB free of ${formatGb(disk.totalBytes)} GB`,
      );
    }
  }

  if (snapshot.battery === null) {
    lines.push('Battery: unavailable on this system');
  } else if (!snapshot.battery.present) {
    lines.push('Battery: none detected');
  } else {
    lines.push(
      `Battery: ${snapshot.battery.percent ?? '?'}%${snapshot.battery.charging ? ' (charging)' : ''}`,
    );
  }


  return lines;
}

export function formatGb(bytes: number): string {
  return (Math.round((bytes / 1024 ** 3) * 10) / 10).toString();
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}