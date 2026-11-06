/**
 * Pixel application entry point.
 *
 * Deliberately tiny. It logs before anything else loads, then imports the
 * application dynamically so that a failure anywhere in the dependency graph -
 * Electron, the IPC layer, a provider client, a bad resource path - is written to
 * the startup log instead of vanishing.
 *
 * The previous version statically imported the whole application, which meant a
 * failure during import produced exactly the reported symptom: no window, no
 * log, and no event-log entry.
 *
 * `--pixel-selfcheck` runs the checks that do not need a window and prints JSON,
 * so the bundle can be verified on a machine where the GUI is suspect.
 */

import { boot } from './startup/boot';

// First statement in the process: create the log and install the handlers that
// record uncaught exceptions, unhandled rejections and the exit code.
boot.begin();

const selfCheck = process.argv.includes('--pixel-selfcheck');

void (async (): Promise<void> => {
  try {
    if (selfCheck) {
      boot.stage('self-check requested');
      const { runSelfCheck } = await import('./startup/selfcheck');
      const report = await runSelfCheck();
      // Machine-readable output for the diagnostic script.
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      boot.stage('self-check complete', `ok=${String(report.ok)}`);
      // Importing Electron can leave handles open, so exit explicitly. Every
      // boot line is written synchronously, so nothing is lost.
      process.exit(report.ok ? 0 : 1);
    }

    boot.stage('loading application modules');
    const application = await import('./app');
    boot.stage('application modules loaded');

    await application.start();
    boot.stage('startup complete');
  } catch (error) {
    boot.fatal(error);
    process.exitCode = 1;
    // A visible failure beats an invisible one: exit promptly so the exit code
    // is recorded and the diagnostics script can report it.
    setTimeout(() => process.exit(1), 150);
  }
})();
