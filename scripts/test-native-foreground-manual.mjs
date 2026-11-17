import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { NativeHelper } = require('../dist/main/main/services/nativeHelper.js');

if (process.platform !== 'win32') throw new Error('This integration check requires an interactive Windows desktop.');
const expectedProcess = (process.argv[2] ?? '').trim().toLowerCase();
if (!expectedProcess) throw new Error('Usage: node scripts/test-native-foreground-manual.mjs <process-name>, for example notepad, Code, or msedge.');
const excludedPids = [
  process.pid,
  ...(process.env.PIXEL_HOST_PIDS ?? '').split(',').map((value) => Number.parseInt(value.trim(), 10)).filter((value) => Number.isInteger(value) && value > 0),
];
if (excludedPids.length < 3) {
  throw new Error('Set PIXEL_HOST_PIDS to include the running Pixel main-process PID and this PowerShell/terminal window host PID.');
}

const helper = new NativeHelper({
  executablePath: resolve('native/bin/PixelNative.exe'),
  hostProcessIds: excludedPids,
});
const prompt = createInterface({ input: stdin, output: stdout });

try {
  await helper.startForegroundTracking();
  const tracking = await helper.call('ping', {});
  console.log(`Foreground tracking mode: ${tracking.trackingMode ?? 'unknown'}`);
  console.log(`Excluded host process IDs: ${[...new Set(excludedPids)].join(', ')}`);
  await prompt.question(`Focus ${expectedProcess}, then switch to either Pixel window, and finally return here. Press Enter to check the last external app: `);

  const last = await helper.lastExternalForegroundWindow();
  if (last.status !== 'available') throw new Error(`Expected an available last window; received ${JSON.stringify(last)}`);
  if (!last.window.processName.toLowerCase().includes(expectedProcess)) {
    throw new Error(`Expected ${expectedProcess}; last external window was ${last.window.processName} (${last.window.title}), PID ${last.window.pid}.`);
  }
  console.log(JSON.stringify({
    step: 'external-foreground-recovered',
    processName: last.window.processName,
    pid: last.window.pid,
    title: last.window.title,
    windowId: last.window.windowId,
    observedAt: last.window.observedAt,
    rect: last.window.rect,
    isMinimized: last.window.isMinimized,
  }, null, 2));

  const visible = await helper.listExternalWindows();
  if (visible.windows.some((window) => excludedPids.includes(window.pid))) {
    throw new Error('A configured Pixel/test-host PID appeared in the external window list.');
  }
  console.log(`Visible external windows listed: ${visible.windows.length}; truncated=${visible.truncated}.`);

  await prompt.question(`Close the ${expectedProcess} window/application now, then return here. Press Enter to check stale-target handling: `);
  const afterClose = await helper.lastExternalForegroundWindow();
  if (afterClose.status !== 'stale') {
    throw new Error(`Expected the closed target to be stale; received ${JSON.stringify(afterClose)}`);
  }
  console.log(JSON.stringify({ step: 'closed-target-marked-stale', reason: afterClose.reason }, null, 2));
  console.log('No screenshot API was called by this metadata-only integration check.');
} finally {
  prompt.close();
  helper.dispose();
  await helper.whenStopped();
}
