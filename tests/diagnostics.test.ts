import { describe, expect, it } from 'vitest';
import {
  collectDiagnostics,
  formatGb,
  pickPrimary,
  summarize,
  toDisplayInfo,
} from '../src/main/system/diagnostics';
import type { DiagnosticsSnapshot } from '../src/shared/types';

type Display = DiagnosticsSnapshot['displays'][number];

function display(id: string, width = 1920, height = 1080, x = 0): Display {
  return {
    id,
    width,
    height,
    scaleFactor: 1,
    label: `Display ${id}`,
    bounds: { x, y: 0, width, height },
  };
}

function probes(
  overrides: Partial<Parameters<typeof collectDiagnostics>[0]> = {},
): Parameters<typeof collectDiagnostics>[0] {
  return {
    now: () => 1_700_000_000_000,
    getDisplays: () => [display('1'), display('2', 2560, 1440, 1920)],
    ...overrides,
  };
}

describe('toDisplayInfo', () => {
  it('maps an Electron display into the shared shape', () => {
    const info = toDisplayInfo({
      id: 7,
      label: 'DELL U2720Q',
      size: { width: 3840, height: 2160 },
      bounds: { x: 0, y: 0, width: 3840, height: 2160 },
      scaleFactor: 2,
    });
    expect(info).toEqual({
      id: '7',
      width: 3840,
      height: 2160,
      scaleFactor: 2,
      label: 'DELL U2720Q',
      bounds: { x: 0, y: 0, width: 3840, height: 2160 },
    });
  });

  it('substitutes a label when Electron reports an empty one', () => {
    const info = toDisplayInfo({
      id: 3,
      label: '',
      size: { width: 800, height: 600 },
      bounds: { x: 0, y: 0, width: 800, height: 600 },
      scaleFactor: 1,
    });
    expect(info.label).toBe('Display 3');
  });
});

describe('pickPrimary', () => {
  it('returns null when there are no displays', () => {
    expect(pickPrimary([])).toBeNull();
  });

  it('uses the requested primary id when present', () => {
    const primary = pickPrimary([display('1'), display('2')], '2');
    expect(primary?.id).toBe('2');
  });

  it('falls back to the first display when the primary id is unknown', () => {
    expect(pickPrimary([display('1'), display('2')], 'zzz')?.id).toBe('1');
  });

  it('omits bounds from the primary display shape', () => {
    const primary = pickPrimary([display('1')]);
    expect(primary).not.toBeNull();
    expect(primary && 'bounds' in primary).toBe(false);
  });
});

describe('collectDiagnostics', () => {
  it('reports real CPU and memory rather than placeholders', () => {
    const snapshot = collectDiagnostics(probes());
    expect(snapshot.cpuCount).toBeGreaterThan(0);
    expect(snapshot.cpuModel.length).toBeGreaterThan(0);
    expect(snapshot.totalMemoryBytes).toBeGreaterThan(0);
    expect(snapshot.freeMemoryBytes).toBeGreaterThanOrEqual(0);
    expect(snapshot.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it('produces every field the shared contract requires', () => {
    const snapshot = collectDiagnostics(probes());
    for (const key of [
      'capturedAt',
      'platform',
      'release',
      'arch',
      'cpuModel',
      'cpuCount',
      'loadAverage1m',
      'totalMemoryBytes',
      'freeMemoryBytes',
      'uptimeSeconds',
      'disks',
      'battery',
      'primaryDisplay',
      'displays',
      'warnings',
    ] as const) {
      expect(snapshot).toHaveProperty(key);
    }
  });

  it('leaves disks and battery null when no probe is supplied, and warns', () => {
    const snapshot = collectDiagnostics(probes());
    expect(snapshot.disks).toBeNull();
    expect(snapshot.battery).toBeNull();
    expect(snapshot.warnings.some((w) => /disk information unavailable/i.test(w))).toBe(true);
    expect(snapshot.warnings.some((w) => /battery information unavailable/i.test(w))).toBe(true);
  });

  it('uses supplied disk and battery probes', () => {
    const snapshot = collectDiagnostics(
      probes({
        getDisks: () => [{ mount: 'C:', totalBytes: 500, freeBytes: 100 }],
        getBattery: () => ({ present: true, percent: 82, charging: true }),
      }),
    );
    expect(snapshot.disks).toHaveLength(1);
    expect(snapshot.battery?.percent).toBe(82);
    expect(snapshot.warnings.some((w) => /disk information unavailable/i.test(w))).toBe(false);
  });

  it('degrades to a warning when a display probe throws, never throwing itself', () => {
    const snapshot = collectDiagnostics(
      probes({
        getDisplays: () => {
          throw new Error('no screen access');
        },
      }),
    );
    expect(snapshot.displays).toEqual([]);
    expect(snapshot.primaryDisplay).toBeNull();
    expect(snapshot.warnings.some((w) => w.includes('no screen access'))).toBe(true);
  });

  it('degrades to a warning when the disk probe throws', () => {
    const snapshot = collectDiagnostics(
      probes({
        getDisks: () => {
          throw new Error('WMI access denied');
        },
      }),
    );
    expect(snapshot.disks).toBeNull();
    expect(snapshot.warnings.some((w) => w.includes('WMI access denied'))).toBe(true);
  });

  it('populates the primary display from the display list', () => {
    const snapshot = collectDiagnostics(probes(), '2');
    expect(snapshot.primaryDisplay?.id).toBe('2');
    expect(snapshot.displays).toHaveLength(2);
  });
});

describe('formatGb', () => {
  it('formats one decimal place', () => {
    expect(formatGb(1024 ** 3)).toBe('1');
    expect(formatGb(1024 ** 3 * 1.25)).toBe('1.3');
    expect(formatGb(0)).toBe('0');
  });
});

describe('summarize', () => {
  const base: DiagnosticsSnapshot = {
    capturedAt: 0,
    platform: 'win32',
    release: '10.0.26100',
    arch: 'x64',
    cpuModel: 'Test CPU',
    cpuCount: 8,
    loadAverage1m: 0,
    totalMemoryBytes: 16 * 1024 ** 3,
    freeMemoryBytes: 4 * 1024 ** 3,
    uptimeSeconds: 90_000,
    disks: null,
    battery: null,
    primaryDisplay: {
      id: '1',
      width: 1920,
      height: 1080,
      scaleFactor: 1.25,
      label: 'Display 1',
    },
    displays: [],
    warnings: [],
  };

  it('states plainly when disk and battery data are unavailable', () => {
    const lines = summarize(base);
    expect(lines.some((l) => /disk space: unavailable/i.test(l))).toBe(true);
    expect(lines.some((l) => /battery: unavailable/i.test(l))).toBe(true);
  });

  it('shows battery percentage when present', () => {
    const lines = summarize({ ...base, battery: { present: true, percent: 82, charging: true } });
    expect(lines.some((l) => l.includes('82%') && l.includes('charging'))).toBe(true);
  });

  it('says none detected when no battery is present', () => {
    const lines = summarize({
      ...base,
      battery: { present: false, percent: null, charging: null },
    });
    expect(lines.some((l) => /none detected/i.test(l))).toBe(true);
  });

  it('reports per-disk usage when available', () => {
    const lines = summarize({
      ...base,
      disks: [{ mount: 'C:', totalBytes: 500 * 1024 ** 3, freeBytes: 100 * 1024 ** 3 }],
    });
    expect(lines.some((l) => l.startsWith('C:') && l.includes('100'))).toBe(true);
  });

  it('reports size unavailable for a disk that refused to report', () => {
    const lines = summarize({
      ...base,
      disks: [{ mount: 'D:', totalBytes: null, freeBytes: null }],
    });
    expect(lines.some((l) => /D:.*size unavailable/i.test(l))).toBe(true);
  });

  it('handles a missing primary display without throwing', () => {
    const lines = summarize({ ...base, primaryDisplay: null });
    expect(lines.some((l) => /primary display: unavailable/i.test(l))).toBe(true);
  });

  it('formats uptime in days', () => {
    const lines = summarize(base);
    expect(lines.some((l) => /up since 1d/i.test(l))).toBe(true);
  });
});
