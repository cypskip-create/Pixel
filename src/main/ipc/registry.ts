import type { IpcMainInvokeEvent } from 'electron';

export type IpcHandlerFn = (event: IpcMainInvokeEvent, ...args: any[]) => unknown;

export interface IpcRegistrar {
  registerHandler<Args extends unknown[], Result>(
    channel: string,
    handler: (event: IpcMainInvokeEvent, ...args: Args) => Result,
  ): void;
  listChannels(): string[];
  dispose(): void;
}

export interface IpcRegistryDeps {
  handle: (channel: string, listener: (event: IpcMainInvokeEvent, ...args: any[]) => unknown) => void;
  removeHandler: (channel: string) => void;
  isTrustedSender: (event: IpcMainInvokeEvent) => boolean;
}

/**
 * Auditable IPC channel registry that enforces:
 *  1. Unique handler ownership (refuses silent duplicate channel registration).
 *  2. Consistent trusted-sender verification before every handler invocation.
 *  3. Clean disposal of every registered channel on shutdown/teardown.
 */
export class IpcHandlerRegistry implements IpcRegistrar {
  private readonly channels = new Set<string>();

  constructor(private readonly deps: IpcRegistryDeps) {}

  registerHandler<Args extends unknown[], Result>(
    channel: string,
    handler: (event: IpcMainInvokeEvent, ...args: Args) => Result,
  ): void {
    if (this.channels.has(channel)) {
      throw new Error(`Duplicate IPC handler registration refused for channel "${channel}".`);
    }
    this.channels.add(channel);
    this.deps.removeHandler(channel);
    this.deps.handle(channel, (event, ...args) => {
      if (!this.deps.isTrustedSender(event)) {
        throw new Error('Unauthorized IPC sender.');
      }
      return handler(event, ...(args as Args));
    });
  }

  listChannels(): string[] {
    return [...this.channels].sort();
  }

  dispose(): void {
    for (const channel of this.channels) {
      this.deps.removeHandler(channel);
    }
    this.channels.clear();
  }
}
