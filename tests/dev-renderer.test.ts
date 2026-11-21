import { createServer } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { startRendererServer } from '../scripts/dev-renderer.mjs';

const renderers: Array<{ close(): Promise<void> }> = [];
const heldServers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(renderers.splice(0).map((server) => server.close()));
  await Promise.all(heldServers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe('development renderer port selection', () => {
  it('keeps the preferred port when it is free', async () => {
    const renderer = await startRendererServer(process.cwd(), 0);
    renderers.push(renderer.server);

    expect(renderer.port).toBeGreaterThan(0);
    expect(renderer.url).toBe(`http://127.0.0.1:${renderer.port}`);
  }, 15_000);

  it('moves off an occupied port and leaves the existing listener untouched', async () => {
    const occupied = createServer();
    await new Promise<void>((resolve, reject) => {
      occupied.once('error', reject);
      occupied.listen(0, '127.0.0.1', resolve);
    });
    heldServers.push(occupied);
    const address = occupied.address();
    if (!address || typeof address === 'string') throw new Error('Test listener did not bind a TCP port.');

    const renderer = await startRendererServer(process.cwd(), address.port);
    renderers.push(renderer.server);

    expect(renderer.port).not.toBe(address.port);
    expect(occupied.listening).toBe(true);
  }, 15_000);
});
