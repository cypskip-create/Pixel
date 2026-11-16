/**
 * Serializes operations that send input to a physical desktop.
 *
 * A lease is held until the operation actually settles. Aborting a queued
 * caller removes it immediately; aborting the current owner does not let a
 * second writer overlap while the first operation is still winding down.
 */
interface Waiter {
  signal?: AbortSignal;
  resolve: (release: (() => void) | null) => void;
  onAbort?: () => void;
}

export class DesktopInputLease {
  private held = false;
  private readonly waiters: Waiter[] = [];

  get isHeld(): boolean {
    return this.held;
  }

  async acquire(signal?: AbortSignal): Promise<(() => void) | null> {
    if (signal?.aborted) return null;
    if (!this.held) {
      this.held = true;
      return this.makeRelease();
    }

    return new Promise((resolve) => {
      const waiter: Waiter = { signal, resolve };
      const onAbort = (): void => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        signal?.removeEventListener('abort', onAbort);
        resolve(null);
      };
      waiter.onAbort = onAbort;
      this.waiters.push(waiter);
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
    });
  }

  private makeRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;

      while (this.waiters.length > 0) {
        const next = this.waiters.shift();
        if (!next) continue;
        next.signal?.removeEventListener('abort', next.onAbort!);
        if (next.signal?.aborted) {
          next.resolve(null);
          continue;
        }
        // Keep the lease held while handing it directly to the next owner.
        next.resolve(this.makeRelease());
        return;
      }

      this.held = false;
    };
  }
}
