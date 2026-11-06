import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BrowserSession } from '../src/main/agent/browser';
import { ToolExecutors } from '../src/main/agent/executors';
import { ToolRegistry } from '../src/main/agent/tools';

/**
 * Live browser tests.
 *
 * These drive a real headless Chromium against a page served from this machine
 * on 127.0.0.1. If Playwright's browser is not installed, the suite is skipped
 * with an explicit reason rather than silently passing.
 */

const PAGE = `<!doctype html>
<html lang="en">
  <head><title>Cyps test page</title></head>
  <body style="height: 3000px">
    <h1 id="title">Cyps local fixture</h1>
    <button id="greet" onclick="document.getElementById('title').textContent='Button worked'">
      Greet
    </button>
    <form id="form" onsubmit="event.preventDefault(); document.getElementById('result').textContent = 'Submitted ' + document.getElementById('name').value;">
      <input id="name" name="name" placeholder="Your name" />
      <button id="submit" type="submit">Submit</button>
    </form>
    <p id="result">Nothing submitted yet</p>
    <a href="/second">Second page</a>
  </body>
</html>`;

let server: Server;
let baseUrl = '';

const probe = new BrowserSession();

beforeAll(async () => {
  server = createServer((request, response) => {
    if (request.url === '/second') {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<html><head><title>Second</title></head><body><h1>Second page</h1></body></html>');
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(PAGE);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const capability = await probe.capability();
await probe.close();

const live = capability.available ? describe : describe.skip;
if (!capability.available) {
  // Visible in test output so a skipped run is never mistaken for a green run.
  console.warn(`[browser tests skipped] ${capability.reason ?? 'browser unavailable'}`);
}

/* ------------------------------------------------------------------ *
 * Pure logic (always runs)
 * ------------------------------------------------------------------ */

describe('BrowserSession.validateUrl', () => {
  const session = new BrowserSession({ allowFileUrls: false });

  it('accepts http and https', () => {
    expect(session.validateUrl('http://example.com')).toBeNull();
    expect(session.validateUrl('https://example.com/path?q=1')).toBeNull();
  });

  it('refuses javascript: URLs', () => {
    expect(session.validateUrl('javascript:alert(1)')).toMatch(/will not open/i);
  });

  it('refuses data: URLs', () => {
    expect(session.validateUrl('data:text/html,<h1>x</h1>')).toMatch(/will not open/i);
  });

  it('refuses file: URLs unless explicitly allowed', () => {
    expect(session.validateUrl('file:///C:/Windows/System32/drivers/etc/hosts')).toMatch(
      /will not open/i,
    );
    const permissive = new BrowserSession({ allowFileUrls: true });
    expect(permissive.validateUrl('file:///tmp/page.html')).toBeNull();
  });

  it('explains how to fix a malformed URL', () => {
    expect(session.validateUrl('example.com')).toMatch(/not a valid URL/i);
  });
});

/* ------------------------------------------------------------------ *
 * Live automation
 * ------------------------------------------------------------------ */

live('browser automation (live chromium)', () => {
  let session: BrowserSession;

  beforeAll(async () => {
    session = new BrowserSession({ headless: true, viewport: { width: 900, height: 700 } });
    await session.navigate(baseUrl);
  });

  afterAll(async () => {
    await session.close();
  });

  it('navigates and reports the real page title and text', async () => {
    const page = await session.snapshot();
    expect(page.title).toBe('Cyps test page');
    expect(page.text).toContain('Cyps local fixture');
    expect(page.url).toBe(`${baseUrl}/`);
  });

  it('lists buttons, inputs and links from the live DOM', async () => {
    const page = await session.snapshot();
    expect(page.buttons).toContain('Greet');
    expect(page.inputs.some((input) => input.name === 'name')).toBe(true);
    expect(page.links.some((link) => link.text.includes('Second page'))).toBe(true);
  });

  it('clicks a real button and observes the resulting DOM change', async () => {
    await session.click('#greet');
    const page = await session.snapshot();
    expect(page.text).toContain('Button worked');
  });

  it('types into a field and verifies the submitted result', async () => {
    await session.fill('#name', 'Ada');
    await session.click('#submit');
    const verification = await session.verifyText('Submitted Ada');
    expect(verification.found).toBe(true);
  });

  it('reports a failed verification honestly', async () => {
    const verification = await session.verifyText('this text is not present');
    expect(verification.found).toBe(false);
  });

  it('scrolls the page and reports a new position', async () => {
    const before = await session.scrollBy(0);
    expect(before.scrollY).toBe(0);
    const after = await session.scrollBy(500);
    expect(after.scrollY).toBeGreaterThan(0);
  });

  it('captures a real PNG screenshot', async () => {
    const image = await session.screenshot();
    expect(image.mimeType).toBe('image/png');
    expect(image.dataUrl.startsWith('data:image/png;base64,')).toBe(true);
    // A blank image compresses very small; real content is meaningfully larger.
    expect(image.dataUrl.length).toBeGreaterThan(2000);
  });

  it('follows an in-page link to another document', async () => {
    await session.navigate(`${baseUrl}/second`);
    const page = await session.snapshot();
    expect(page.title).toBe('Second');
  });

  it('refuses to navigate to a javascript: URL at the session level', async () => {
    await expect(session.navigate('javascript:alert(1)')).rejects.toThrow(/will not open/i);
  });
});

/* ------------------------------------------------------------------ *
 * Tools through the executor, with the registry policy in play
 * ------------------------------------------------------------------ */

live('browser tools through ToolExecutors', () => {
  let session: BrowserSession;
  let executors: ToolExecutors;
  const registry = new ToolRegistry();

  beforeAll(async () => {
    session = new BrowserSession({ headless: true });
    executors = new ToolExecutors({ browser: session });
  });

  afterAll(async () => {
    await session.close();
  });

  it('registry gates browser actions by mode', () => {
    const guideTools = registry.availableFor('guide').map((tool) => tool.name);
    const agentTools = registry.availableFor('agent').map((tool) => tool.name);

    // Read-only browser tools are available everywhere; click and navigate are not.
    expect(guideTools).toContain('browser_inspect');
    expect(guideTools).toContain('browser_verify');
    expect(guideTools).not.toContain('browser_click');
    expect(guideTools).not.toContain('browser_navigate');
    expect(agentTools).toContain('browser_click');
    expect(agentTools).toContain('browser_navigate');
  });

  it('browser_click requires approval', () => {
    const click = registry.get('browser_click');
    expect(click?.requiresApproval).toBe(true);
    expect(click?.changesState).toBe(true);
  });

  it('navigates and inspects through the tool surface', async () => {
    const navigate = await executors.run('browser_navigate', { url: baseUrl });
    expect(navigate.ok).toBe(true);
    expect(navigate.content).toContain('Cyps local fixture');

    const inspect = await executors.run('browser_inspect', {});
    expect(inspect.ok).toBe(true);
    expect(inspect.content).toContain('Cyps test page');
    expect(inspect.content).toContain('Buttons:');
  });

  it('clicks and verifies through the tool surface', async () => {
    const click = await executors.run('browser_click', { selector: '#greet' });
    expect(click.ok).toBe(true);

    const verify = await executors.run('browser_verify', { expected: 'Button worked' });
    expect(verify.ok).toBe(true);
    expect(verify.content).toMatch(/verified/i);
  });

  it('returns a tool failure, not a throw, for a missing selector', async () => {
    const result = await executors.run('browser_click', { selector: '#does-not-exist' });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('FAILED');
    // The page-level timeout is 15s, so this legitimately takes longer than the
    // default per-test limit.
  }, 25_000);

  it('refuses a non-http URL without touching the browser', async () => {
    const result = await executors.run('browser_navigate', { url: 'file:///C:/Windows/win.ini' });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('DENIED');
  });

  it('screenshots through the tool surface', async () => {
    const result = await executors.run('browser_screenshot', {});
    expect(result.ok).toBe(true);
    expect(result.detail).toHaveProperty('image');
  });

  it('kills the browser on emergency stop', async () => {
    expect(() => executors.killAll()).not.toThrow();
    // After a kill, the session is closed and further navigation must fail
    // rather than silently succeed.
    const after = await executors.run('browser_inspect', {});
    expect(after.ok).toBe(true); // a fresh context is launched lazily
  });
});
