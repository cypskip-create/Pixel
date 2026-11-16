import { execFile } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

export function hasProcessExited(child: ChildProcess): boolean {
  return child.exitCode != null || child.signalCode != null;
}

/** Stop a supervised child and its descendants where Windows provides taskkill. */
export function terminateProcessTree(child: ChildProcess): void {
  const pid = child.pid;
  if (hasProcessExited(child)) return;

  if (process.platform === 'win32' && Number.isSafeInteger(pid) && (pid ?? 0) > 0) {
    execFile('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, (error) => {
      if (error && !hasProcessExited(child)) {
        try { child.kill('SIGKILL'); } catch { /* process already exited */ }
      }
    });
    return;
  }

  try { child.kill('SIGKILL'); } catch { /* process already exited */ }
}

/**
 * Terminate a supervised child tree and confirm the child has exited. The
 * operation first uses taskkill on Windows, then force-kills the direct child
 * after a bounded grace period. `false` means termination could not be
 * confirmed; callers must keep any desktop-input lease held until a later exit.
 */
export async function terminateProcessTreeAndWait(child: ChildProcess, graceMs = 1_500): Promise<boolean> {
  if (hasProcessExited(child)) return true;

  const gracefulExit = waitForExit(child, graceMs);
  terminateProcessTree(child);
  if (await gracefulExit) return true;
  if (hasProcessExited(child)) return true;

  try { child.kill('SIGKILL'); } catch { /* process may have exited between checks */ }
  return await waitForExit(child, graceMs) || hasProcessExited(child);
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (hasProcessExited(child)) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (exited: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener('exit', onExit);
      resolve(exited || hasProcessExited(child));
    };
    const onExit = (): void => finish(true);
    const timer = setTimeout(() => finish(false), Math.max(1, timeoutMs));
    child.once('exit', onExit);
    if (hasProcessExited(child)) finish(true);
  });
}
