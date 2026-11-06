/**
 * Probe the REA MCP server over stdio.
 *
 * Sends a JSON-RPC `initialize` frame and reports whether a valid response comes
 * back. This distinguishes "the harness cannot spawn it" from "the server itself
 * does not start", which have different fixes.
 */

import { spawn } from 'node:child_process';

const usePinned = process.argv.includes('--pinned');
const pinnedRoot = `${process.env.LOCALAPPDATA}\\PixelTooling\\node-v24.22.1-win-x64`;

const command = usePinned ? `${pinnedRoot}\\node.exe` : 'npx.cmd';
const args = usePinned
  ? [`${pinnedRoot}\\node_modules\\npm\\bin\\npx-cli.js`, '-y', 'rea-agents@6.8.0', 'mcp']
  : ['-y', 'rea-agents@6.8.0', 'mcp'];

const child = spawn(command, args, { shell: !usePinned, windowsHide: true });

let out = '';
let err = '';
const timer = setTimeout(() => {
  console.log(JSON.stringify({ ok: false, reason: 'no response within 25s', stderr: err.slice(0, 800), stdout: out.slice(0, 400) }));
  child.kill();
  process.exit(1);
}, 25_000);

child.stdout.on('data', (chunk) => {
  out += String(chunk);
  if (out.includes('"result"')) {
    const line = out.split('\n').find((entry) => entry.includes('"result"'));
    clearTimeout(timer);
    console.log(JSON.stringify({ ok: true, mode: usePinned ? 'pinned-node' : 'npx', response: line?.slice(0, 400) }));
    child.kill();
    process.exit(0);
  }
});

child.stderr.on('data', (chunk) => {
  err += String(chunk);
});

child.on('error', (error) => {
  clearTimeout(timer);
  console.log(JSON.stringify({ ok: false, reason: `spawn failed: ${error.message}` }));
  process.exit(1);
});

const initialize = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'pixel-probe', version: '1.0.0' },
  },
};

child.stdin.write(`${JSON.stringify(initialize)}\n`);
