import { createServer } from 'vite';
import { join } from 'node:path';

/** Start Vite on the preferred loopback port, allowing Vite to select a free one. */
export async function startRendererServer(rootDir, preferredPort = 5199) {
  const server = await createServer({
    configFile: join(rootDir, 'vite.config.ts'),
    server: {
      host: '127.0.0.1',
      port: preferredPort,
      strictPort: false,
    },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === 'string') {
    await server.close();
    throw new Error('Vite started without a loopback TCP address.');
  }
  return {
    server,
    port: address.port,
    url: `http://127.0.0.1:${address.port}`,
  };
}
