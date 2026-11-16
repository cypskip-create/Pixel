import { execFile } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

/** Stop a supervised child and its descendants where Windows provides taskkill. */
export function terminateProcessTree(child: ChildProcess): void {
  const pid = child.pid;
  if (child.exitCode !== null) return;

  if (process.platform === 'win32' && Number.isSafeInteger(pid) && (pid ?? 0) > 0) {
    execFile('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, (error) => {
      if (error && child.exitCode === null) {
        try { child.kill('SIGKILL'); } catch { /* process already exited */ }
      }
    });
    return;
  }

  try { child.kill('SIGKILL'); } catch { /* process already exited */ }
}
