/**
 * Browser automation.
 *
 * Playwright is loaded lazily: if it (or its browser binaries) is missing, Pixel
 * reports a precise capability error instead of pretending a page was opened.
 *
 * Safety rules enforced here rather than in the UI:
 *  - Only http(s) and (when explicitly allowed) file URLs are reachable. `javascript:`,
 *    `data:` and `file:` URLs are refused by default.
 *  - Every page action has a timeout, so a hung page cannot wedge the agent.
 *  - Nothing is typed or clicked without the registry's approval gate; this
 *    module is the executor, not the policy.
 *  - A single browser context is reused and always closed on shutdown.
 */

import type { ImageAttachment } from '../../shared/types';

/** Longest a single page operation may take. */
export const PAGE_TIMEOUT_MS = 15_000;

/** Refuse absurdly long pages; the model cannot read them anyway. */
export const MAX_TEXT_CHARS = 8_000;

export interface BrowserCapability {
  available: boolean;
  reason?: string;
}

export interface PageSnapshot {
  url: string;
  title: string;
  /** Visible text, truncated for the model. */
  text: string;
  links: Array<{ text: string; href: string }>;
  buttons: string[];
  inputs: Array<{ name: string; type: string; placeholder: string }>;
}

interface PlaywrightPage {
  goto(url: string, options?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  url(): string;
  title(): Promise<string>;
  innerText(selector: string): Promise<string>;
  $$eval(selector: string, fn: (elements: Element[]) => unknown): Promise<unknown>;
  click(selector: string, options?: { timeout?: number }): Promise<void>;
  fill(selector: string, value: string, options?: { timeout?: number }): Promise<void>;
  press(selector: string, key: string): Promise<void>;
  waitForSelector(selector: string, options?: { timeout?: number }): Promise<unknown>;
  screenshot(options?: { type?: 'png' | 'jpeg' }): Promise<Buffer>;
  evaluate<T, A = void>(fn: (arg: A) => T, arg?: A): Promise<T>;
  setViewportSize?(size: { width: number; height: number }): Promise<void>;
}

interface PlaywrightContext {
  newPage(): Promise<PlaywrightPage>;
  close(): Promise<void>;
}

interface PlaywrightBrowser {
  newContext(options?: {
    viewport?: { width: number; height: number };
    userAgent?: string;
  }): Promise<PlaywrightContext>;
  close(): Promise<void>;
}

export interface BrowserOptions {
  /** Headed browsers need a desktop session; Pixel defaults to headless. */
  headless?: boolean;
  /** Allow file:// URLs. Off in the app, on for local tests. */
  allowFileUrls?: boolean;
  /** Viewport for screenshots. */
  viewport?: { width: number; height: number };
}

export class BrowserSession {
  private browser: PlaywrightBrowser | null = null;
  private context: PlaywrightContext | null = null;
  private page: PlaywrightPage | null = null;
  private launchError: string | null = null;
  private launching: Promise<void> | null = null;
  private readonly options: BrowserOptions;

  constructor(options: BrowserOptions = {}) {
    this.options = {
      headless: options.headless ?? true,
      allowFileUrls: options.allowFileUrls ?? false,
      viewport: options.viewport ?? { width: 1280, height: 800 },
    };
  }

  /** Can a real browser be driven right now? */
  async capability(): Promise<BrowserCapability> {
    try {
      await this.ensurePage();
      return { available: true };
    } catch (error) {
      return {
        available: false,
        reason: `${MISSING_BROWSER_HINT} ${message(error)}`,
      };
    }
  }

  /** Reject URLs Pixel will not visit. Returns null when the URL is acceptable. */
  validateUrl(raw: string): string | null {
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      return `"${raw}" is not a valid URL. Include the scheme, for example https://example.com.`;
    }

    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return null;
    if (parsed.protocol === 'file:' && this.options.allowFileUrls) return null;

    return `Pixel will not open ${parsed.protocol} URLs. Only http and https pages are allowed.`;
  }

  /** Load a page and return its snapshot. */
  async navigate(url: string): Promise<PageSnapshot> {
    const problem = this.validateUrl(url);
    if (problem) throw new Error(problem);

    const page = await this.ensurePage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS });
    // Give client-rendered pages a moment without waiting for idle network.
    await page.waitForSelector('body', { timeout: PAGE_TIMEOUT_MS }).catch(() => undefined);
    return this.snapshot();
  }

  /** Read the current page. */
  async snapshot(): Promise<PageSnapshot> {
    const page = await this.ensurePage();

    const title = await page.title().catch(() => '');
    const rawText = await page.innerText('body').catch(() => '');
    const text = truncate(rawText.replace(/\s+\n/g, '\n').trim(), MAX_TEXT_CHARS);

    const links = (await page
      .$$eval('a[href]', (elements) =>
        elements.slice(0, 40).map((element) => ({
          text: (element.textContent ?? '').trim().slice(0, 120),
          href: (element as HTMLAnchorElement).href,
        })),
      )
      .catch(() => [])) as Array<{ text: string; href: string }>;

    const buttons = (await page
      .$$eval(
        'button, input[type="submit"], input[type="button"], [role="button"]',
        (elements) =>
          elements
            .slice(0, 40)
            .map((element) => (element.textContent ?? (element as HTMLInputElement).value ?? '').trim())
            .filter((label) => label.length > 0),
      )
      .catch(() => [])) as string[];

    const inputs = (await page
      .$$eval('input, textarea, select', (elements) =>
        elements.slice(0, 40).map((element) => {
          const input = element as HTMLInputElement;
          return {
            name: input.name ?? '',
            type: input.type ?? element.tagName.toLowerCase(),
            placeholder: input.placeholder ?? '',
          };
        }),
      )
      .catch(() => [])) as Array<{ name: string; type: string; placeholder: string }>;

    return { url: page.url(), title, text, links, buttons, inputs };
  }

  async click(selector: string): Promise<void> {
    const page = await this.ensurePage();
    await page.click(selector, { timeout: PAGE_TIMEOUT_MS });
  }

  async fill(selector: string, value: string): Promise<void> {
    const page = await this.ensurePage();
    await page.fill(selector, value, { timeout: PAGE_TIMEOUT_MS });
  }

  async press(selector: string, key: string): Promise<void> {
    const page = await this.ensurePage();
    await page.press(selector, key);
  }

  /** Scroll the page by a signed pixel amount and report the new position. */
  async scrollBy(amount: number): Promise<{ scrollY: number; maxScroll: number }> {
    const page = await this.ensurePage();
    return page.evaluate((offset: number) => {
      window.scrollBy(0, offset);
      return { scrollY: window.scrollY, maxScroll: document.body.scrollHeight };
    }, amount);
  }
  /** Capture the viewport as a PNG attachment. */
  async screenshot(): Promise<ImageAttachment> {
    const page = await this.ensurePage();
    if (page.setViewportSize) {
      await page.setViewportSize(this.options.viewport ?? { width: 1280, height: 800 });
    }
    const buffer = await page.screenshot({ type: 'png' });
    const viewport = this.options.viewport ?? { width: 1280, height: 800 };
    return {
      dataUrl: `data:image/png;base64,${buffer.toString('base64')}`,
      mimeType: 'image/png',
      width: viewport.width,
      height: viewport.height,
      source: 'screenshot',
      label: `Browser: ${await page.title().catch(() => 'page')}`,
    };
  }

  /** True when the current page contains the expected text. */
  async verifyText(expected: string): Promise<{ found: boolean; actual: string }> {
    const page = await this.ensurePage();
    const body = await page.innerText('body').catch(() => '');
    return {
      found: body.toLowerCase().includes(expected.toLowerCase()),
      actual: truncate(body.trim(), 400),
    };
  }

  /** Close the browser. Safe to call repeatedly. */
  async close(): Promise<void> {
    const context = this.context;
    const browser = this.browser;
    this.page = null;
    this.context = null;
    this.browser = null;
    try {
      if (context) await context.close();
    } catch {
      /* already gone */
    }
    try {
      if (browser) await browser.close();
    } catch {
      /* already gone */
    }
  }

  /* ------------------------------ internals --------------------------- */

  private async ensurePage(): Promise<PlaywrightPage> {
    if (this.page) return this.page;
    if (!this.launching) {
      this.launching = this.launch();
    }
    await this.launching;
    if (!this.page) {
      throw new Error(this.launchError ?? 'The browser could not be started.');
    }
    return this.page;
  }

  private async launch(): Promise<void> {
    try {
      const playwright = (await import('playwright')) as unknown as {
        chromium: { launch(options?: Record<string, unknown>): Promise<PlaywrightBrowser> };
      };

      this.browser = await playwright.chromium.launch({
        headless: this.options.headless ?? true,
        args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
      });
      this.context = await this.browser.newContext({
        viewport: this.options.viewport ?? { width: 1280, height: 800 },
      });
      this.page = await this.context.newPage();
      this.launchError = null;
    } catch (error) {
      this.launchError = message(error);
      this.browser = null;
      this.context = null;
      this.page = null;
      throw error;
    } finally {
      this.launching = null;
    }
  }
}

export const MISSING_BROWSER_HINT =
  'Browser automation is unavailable: the Playwright browser is not installed. Run "npx playwright install chromium" once. Details:';

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}...`;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
