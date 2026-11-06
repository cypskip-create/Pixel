// Download a specific official Node.js Windows zip without touching the system.
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { get } from 'node:https';
import { join } from 'node:path';

const version = 'v24.22.1';
const url = `https://nodejs.org/dist/${version}/node-${version}-win-x64.zip`;
const outDir = join(process.env.LOCALAPPDATA, 'PixelTooling');
const outFile = join(outDir, `node-${version}-win-x64.zip`);

await mkdir(outDir, { recursive: true });

function download(target, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'));
    get(target, { headers: { 'user-agent': 'pixel-tooling/1.0' } }, (response) => {
      const { statusCode = 0, headers } = response;
      if (statusCode >= 300 && statusCode < 400 && headers.location) {
        response.resume();
        download(headers.location, redirects + 1).then(resolve, reject);
        return;
      }
      if (statusCode !== 200) {
        response.resume();
        reject(new Error(`HTTP ${statusCode} for ${target}`));
        return;
      }
      const file = createWriteStream(outFile);
      let bytes = 0;
      response.on('data', (chunk) => {
        bytes += chunk.length;
      });
      response.pipe(file);
      file.on('finish', () => {
        file.close(() => resolve({ bytes }));
      });
      file.on('error', reject);
    }).on('error', reject);
  });
}

const result = await download(url);
console.log(JSON.stringify({ url, file: outFile, bytes: result.bytes }));
