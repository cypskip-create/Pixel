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

import type { BrowserAutomationSettings, ImageAttachment } from '../../shared/types';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { NetworkGuard, isPrivateHost, type HostResolver } from './netGuard';
import { validateCdpEndpoint } from './browserProfiles';

export { isPrivateHost };

/** Longest a single page operation may take. */
export const PAGE_TIMEOUT_MS = 15_000;

/** Refuse absurdly long pages; the model cannot read them anyway. */
export const MAX_TEXT_CHARS = 8_000;
export const MAX_BROWSER_TRANSFER_BYTES = 25 * 1024 * 1024;

export interface BrowserCapability {
  available: boolean;
  reason?: string;
}

export interface BrowserTabInfo {
  id: string;
  active: boolean;
  url: string;
  title: string;
}

export interface PageSnapshot {
  url: string;
  title: string;
  /** Visible text, truncated for the model. */
  text: string;
  links: Array<{ text: string; href: string }>;
  buttons: string[];
  inputs: Array<{ name: string; type: string; placeholder: string; accessibleName: string }>;
}

export type BrowserSemanticTarget =
  | { kind: 'role'; role: string; value: string }
  | { kind: 'label' | 'placeholder' | 'text'; value: string };

interface PlaywrightLocator {
  count(): Promise<number>;
  isVisible(): Promise<boolean>;
  isEnabled(): Promise<boolean>;
  click(options?: { timeout?: number }): Promise<void>;
  dblclick(options?: { timeout?: number }): Promise<void>;
  hover(options?: { timeout?: number }): Promise<void>;
  selectOption(value: string, options?: { timeout?: number }): Promise<string[]>;
  waitFor(options?: { state?: 'visible' | 'hidden' | 'attached' | 'detached'; timeout?: number }): Promise<void>;
  first(): PlaywrightLocator;
  fill(value: string, options?: { timeout?: number }): Promise<void>;
  press(key: string): Promise<void>;
  inputValue(options?: { timeout?: number }): Promise<string>;
  getAttribute(name: string): Promise<string | null>;
  setInputFiles(files: string | string[] | Array<{ name: string; mimeType: string; buffer: Buffer }>): Promise<void>;
  evaluate<T>(fn: (element: Element) => T): Promise<T>;
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
  locator(selector: string): PlaywrightLocator;
  getByRole(role: string, options: { name: string; exact: true }): PlaywrightLocator;
  getByLabel(text: string, options: { exact: true }): PlaywrightLocator;
  getByPlaceholder(text: string, options: { exact: true }): PlaywrightLocator;
  getByText(text: string, options: { exact: true }): PlaywrightLocator;
  waitForEvent(event: 'download', options?: { timeout?: number }): Promise<PlaywrightDownload>;
  waitForSelector(selector: string, options?: { timeout?: number }): Promise<unknown>;
  screenshot(options?: { type?: 'png' | 'jpeg' }): Promise<Buffer>;
  evaluate<T, A = void>(fn: (arg: A) => T, arg?: A): Promise<T>;
  setViewportSize?(size: { width: number; height: number }): Promise<void>;
  bringToFront?(): Promise<void>;
  close?(): Promise<void>;
  isClosed?(): boolean;
}

interface PlaywrightDownload {
  suggestedFilename(): string;
  createReadStream(): Promise<AsyncIterable<Uint8Array>>;
  cancel(): Promise<void>;
  failure(): Promise<string | null>;
}

export interface BrowserUploadFile {
  path: string;
  fileName: string;
  sizeBytes: number;
  sha256: string;
}

export interface BrowserDownloadResult {
  path: string;
  fileName: string;
  sizeBytes: number;
  sha256: string;
}

/** Validate a user-selected upload immediately before it enters Chromium. */
export function validateBrowserUploadFile(rawPath: string): BrowserUploadFile {
  let requested: string;
  try { requested = resolve(rawPath); }
  catch { throw new Error('The selected upload path is invalid.'); }
  let link;
  try { link = lstatSync(requested); }
  catch { throw new Error('The selected upload file is no longer available.'); }
  if (link.isSymbolicLink() || !link.isFile()) throw new Error('Pixel uploads regular files only and will not follow a symbolic link.');
  const path = realpathSync(requested);
  const info = statSync(path);
  if (!info.isFile() || info.size > MAX_BROWSER_TRANSFER_BYTES) throw new Error('The selected upload must be a regular file no larger than 25 MB.');
  const fileName = basename(path);
  if (/^(?:\.env(?:\.|$)|.*(?:password|passwd|passphrase|secret|token|credential|id_rsa|private[_-]?key|api[_-]?key|otp).*)$/i.test(fileName)) {
    throw new Error('Pixel will not upload a file with a credential-like name.');
  }
  const data = readFileSync(path);
  if (data.byteLength !== info.size) throw new Error('The selected upload changed while Pixel was checking it.');
  return { path, fileName, sizeBytes: info.size, sha256: createHash('sha256').update(data).digest('hex') };
}

function validateBrowserDownloadPath(rawPath: string): string {
  const path = resolve(rawPath);
  const fileName = basename(path);
  if (!fileName || fileName === '.' || fileName === '..') throw new Error('Choose a filename for the browser download.');
  let parent: string;
  try { parent = realpathSync(dirname(path)); }
  catch { throw new Error('The selected download folder is unavailable.'); }
  if (!statSync(parent).isDirectory()) throw new Error('The selected download parent is not a folder.');
  if (existsSync(path)) throw new Error('Pixel will not overwrite an existing download. Choose a new filename.');
  return resolve(parent, fileName);
}

interface PlaywrightRoute {
  request(): { url(): string };
  abort(errorCode?: string): Promise<void>;
  continue(): Promise<void>;
}

interface PlaywrightResponse {
  serverAddr?(): Promise<{ ipAddress: string; port: number } | null>;
}

interface PlaywrightContext {
  newPage(): Promise<PlaywrightPage>;
  pages?(): PlaywrightPage[];
  route(url: string, handler: (route: PlaywrightRoute) => Promise<void> | void): Promise<void>;
  close(): Promise<void>;
}

interface PlaywrightBrowser {
  newContext(options?: {
    viewport?: { width: number; height: number };
    userAgent?: string;
  }): Promise<PlaywrightContext>;
  contexts?(): PlaywrightContext[];
  close(): Promise<void>;
}


export interface BrowserOptions {
  /** Headed browsers need a desktop session; Pixel defaults to headless. */
  headless?: boolean;
  /**
   * Allow localhost, LAN and link-local addresses. Off in the app: a page the
   * model was steered to (prompt injection) must not be able to probe the user's
   * router, NAS or cloud-metadata endpoint. On only for local tests.
   */
  allowPrivateNetwork?: boolean;
  /** Override DNS resolution (tests simulate rebinding with this). */
  resolver?: HostResolver;
  /** Allow file:// URLs. Off in the app, on for local tests. */
  allowFileUrls?: boolean;
  /** Viewport for screenshots. */
  viewport?: { width: number; height: number };
  /** Dynamic settings reader so persisted BrowserAutomationSettings affect live execution. */
  getSettings?: () => BrowserAutomationSettings;
  /** Optional named session identifier for multi-conversation isolation. */
  sessionId?: string;
  /** Optional trusted owner identifier (conversation/project/task). */
  ownerId?: string;
  /** Root directory for Pixel-owned persistent browser profiles. */
  persistentProfilesRoot?: string;
  /** When attaching via CDP, set true to force a new isolated context instead of reusing an existing authorized context. */
  cdpIsolatedContext?: boolean;
  /** Optional injectable Playwright loader for deterministic CDP/persistent-profile/lifecycle tests. */
  playwrightLoader?: () => Promise<{
    chromium: {
      launch(options?: Record<string, unknown>): Promise<PlaywrightBrowser>;
      launchPersistentContext?(userDataDir: string, options?: Record<string, unknown>): Promise<PlaywrightContext>;
      connectOverCDP?(endpointURL: string, options?: Record<string, unknown>): Promise<PlaywrightBrowser>;
    };
  }>;
}

export type BrowserOwnershipMode =
  | 'pixel_isolated'
  | 'pixel_persistent'
  | 'cdp_attached_existing'
  | 'cdp_attached_isolated';

export class BrowserSession {
  private browser: PlaywrightBrowser | null = null;
  private context: PlaywrightContext | null = null;
  private page: PlaywrightPage | null = null;
  private readonly tabs = new Map<string, PlaywrightPage>();
  private nextTabId = 1;
  private activeTabId: string | null = null;
  private launchError: string | null = null;
  private launching: Promise<void> | null = null;
  private attachedViaCdp = false;
  private ownershipMode: BrowserOwnershipMode = 'pixel_isolated';
  private persistentProfileDir: string | null = null;
  private readonly options: BrowserOptions;
  private readonly guard: NetworkGuard;
  /** Why the guard last blocked a request, so navigate() can explain itself. */
  private lastBlocked: string | null = null;

  constructor(options: BrowserOptions = {}) {
    this.guard = new NetworkGuard({
      allowPrivateNetwork: options.allowPrivateNetwork ?? false,
      resolve: options.resolver,
    });
    this.options = {
      headless: options.headless ?? true,
      allowPrivateNetwork: options.allowPrivateNetwork ?? false,
      resolver: options.resolver,
      allowFileUrls: options.allowFileUrls ?? false,
      viewport: options.viewport ?? { width: 1280, height: 800 },
      getSettings: options.getSettings,
      sessionId: options.sessionId,
      ownerId: options.ownerId,
      persistentProfilesRoot: options.persistentProfilesRoot,
      cdpIsolatedContext: options.cdpIsolatedContext,
      playwrightLoader: options.playwrightLoader,
    };
  }

  private getEffectiveGuard(): NetworkGuard {
    const live = this.options.getSettings?.();
    if (!live) return this.guard;
    return new NetworkGuard({
      allowPrivateNetwork: this.options.allowPrivateNetwork || live.allowPrivateNetwork,
      allowedDomains: live.allowedDomains,
      blockedDomains: live.blockedDomains,
      resolve: this.options.resolver,
    });
  }

  get isAttachedViaCdp(): boolean {
    return this.attachedViaCdp;
  }

  get mode(): BrowserOwnershipMode {
    return this.ownershipMode;
  }

  get activeProfileDir(): string | null {
    return this.persistentProfileDir;
  }

  get sessionId(): string {
    return this.options.sessionId ?? 'default';
  }

  get ownerId(): string {
    return this.options.ownerId ?? 'default';
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

    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      if (!this.options.allowPrivateNetwork && isPrivateHost(parsed.hostname)) {
        return `Pixel will not open "${parsed.hostname}": it is a local or private-network address.`;
      }
      return null;
    }
    if (parsed.protocol === 'file:' && this.options.allowFileUrls) return null;

    return `Pixel will not open ${parsed.protocol} URLs. Only http and https pages are allowed.`;
  }

  /** Load a page and return its snapshot. */
  async navigate(url: string): Promise<PageSnapshot> {
    const problem = this.validateUrl(url);
    if (problem) throw new Error(problem);
    const allowedLocalFile = this.isAllowedLocalFile(url);

    // Resolve the name now so a private destination is refused before any request.
    const guard = this.getEffectiveGuard();
    const upfront = allowedLocalFile ? null : await guard.check(url);
    if (upfront) throw new Error(upfront);

    const page = await this.ensurePage();
    this.lastBlocked = null;
    let response: unknown;
    try {
      const cmdTimeout = Math.max(5_000, Math.min((this.options.getSettings?.().commandTimeoutSec ?? 15) * 1000, 120_000));
      response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: cmdTimeout });
    } catch (error) {
      // A blocked redirect or subresource surfaces as a generic network error.
      if (this.lastBlocked) throw new Error(this.lastBlocked);
      throw error;
    }

    // The request was allowed on paper; verify where it actually went. A redirect
    // may have landed somewhere private, or DNS may have answered differently to
    // Chromium than it did to us. Either way the model must not see that page.
    const landed = this.isAllowedLocalFile(page.url()) ? null : await guard.check(page.url());
    const connected = guard.checkConnectedAddress(
      (await (response as PlaywrightResponse | null)?.serverAddr?.().catch(() => null))?.ipAddress,
    );
    const problemAfter = landed ?? connected;
    if (problemAfter) {
      await page.goto('about:blank').catch(() => undefined);
      throw new Error(problemAfter);
    }
    // Give client-rendered pages a moment without waiting for idle network.
    await page.waitForSelector('body', { timeout: PAGE_TIMEOUT_MS }).catch(() => undefined);
    return this.snapshot();
  }

  /** Create a separately identified tab after validating its initial URL. */
  async newTab(url: string): Promise<BrowserTabInfo> {
    const problem = this.validateUrl(url);
    if (problem) throw new Error(problem);
    const networkProblem = this.isAllowedLocalFile(url) ? null : await this.guard.check(url);
    if (networkProblem) throw new Error(networkProblem);
    await this.ensurePage();
    if (!this.context) throw new Error('The browser context is unavailable.');
    const page = await this.context.newPage();
    const id = `tab_${this.nextTabId++}`;
    this.tabs.set(id, page);
    this.page = page;
    this.activeTabId = id;
    try {
      await this.navigate(url);
      return { id, active: true, url: page.url(), title: await page.title().catch(() => '') };
    } catch (error) {
      if (page.close) await page.close().catch(() => undefined);
      this.tabs.delete(id);
      this.selectFallbackTab();
      throw error;
    }
  }

  async listTabs(): Promise<BrowserTabInfo[]> {
    await this.ensurePage();
    const result: BrowserTabInfo[] = [];
    for (const [id, page] of this.tabs) {
      if (page.isClosed?.()) { this.tabs.delete(id); continue; }
      result.push({ id, active: id === this.activeTabId, url: page.url(), title: await page.title().catch(() => '') });
    }
    return result;
  }

  async switchTab(id: string): Promise<BrowserTabInfo | null> {
    await this.ensurePage();
    const page = this.tabs.get(id);
    if (!page || page.isClosed?.()) {
      this.tabs.delete(id);
      return null;
    }
    this.page = page;
    this.activeTabId = id;
    await page.bringToFront?.();
    return { id, active: true, url: page.url(), title: await page.title().catch(() => '') };
  }

  async closeTab(id: string): Promise<{ closed: boolean; remaining: number; activeTabId: string | null }> {
    await this.ensurePage();
    const page = this.tabs.get(id);
    if (!page) return { closed: false, remaining: this.tabs.size, activeTabId: this.activeTabId };
    // Keep one usable tab so subsequent browser tools have a defined target.
    if (this.tabs.size === 1) {
      const replacement = await this.context?.newPage();
      if (!replacement) throw new Error('A replacement browser tab could not be created.');
      const replacementId = `tab_${this.nextTabId++}`;
      this.tabs.set(replacementId, replacement);
      this.page = replacement;
      this.activeTabId = replacementId;
    }
    this.tabs.delete(id);
    if (page.close) await page.close();
    if (this.activeTabId === id) this.selectFallbackTab();
    return { closed: true, remaining: this.tabs.size, activeTabId: this.activeTabId };
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
          const labels = input.labels ? Array.from(input.labels).map((label) => (label.textContent ?? '').trim()).filter(Boolean) : [];
          const labelledBy = input.getAttribute('aria-labelledby')?.split(/\s+/).map((id) => document.getElementById(id)?.textContent?.trim() ?? '').filter(Boolean) ?? [];
          const accessibleName = input.getAttribute('aria-label')?.trim() || labelledBy.join(' ') || labels.join(' ') || input.name || input.placeholder || '';
          return {
            name: input.name ?? '',
            type: input.type ?? element.tagName.toLowerCase(),
            placeholder: input.placeholder ?? '',
            accessibleName,
          };
        }),
      )
      .catch(() => [])) as Array<{ name: string; type: string; placeholder: string; accessibleName: string }>;

    return { url: page.url(), title, text, links, buttons, inputs };
  }

  async click(target: string | BrowserSemanticTarget): Promise<void> {
    const page = await this.ensurePage();
    const locator = this.resolveTarget(page, target);
    await this.assertUniqueActionTarget(locator, 'click');
    await locator.click({ timeout: PAGE_TIMEOUT_MS });
  }

  async fill(target: string | BrowserSemanticTarget, value: string): Promise<void> {
    const page = await this.ensurePage();
    const locator = this.resolveTarget(page, target);
    await this.assertUniqueActionTarget(locator, 'fill');
    const [type, autocomplete, name, id] = await Promise.all([
      locator.getAttribute('type'), locator.getAttribute('autocomplete'), locator.getAttribute('name'), locator.getAttribute('id'),
    ]);
    if (type?.toLowerCase() === 'password' || /(?:current|new)-password|one-time-code/i.test(autocomplete ?? '') ||
      /(?:password|passwd|passphrase|secret|token|credential|api[_-]?key|otp)/i.test(`${name ?? ''} ${id ?? ''}`)) {
      throw new Error('Pixel will not fill credential or one-time-code fields without a dedicated credential broker.');
    }
    await locator.fill(value, { timeout: PAGE_TIMEOUT_MS });
    const actual = await locator.inputValue({ timeout: PAGE_TIMEOUT_MS });
    if (actual !== value) throw new Error('The browser field value did not match the requested value after read-back.');
  }

  async press(target: string | BrowserSemanticTarget, key: string): Promise<void> {
    const page = await this.ensurePage();
    const locator = this.resolveTarget(page, target);
    await this.assertUniqueActionTarget(locator, 'press a key in');
    await locator.press(key);
  }

  async doubleClick(target: string | BrowserSemanticTarget): Promise<void> {
    const page = await this.ensurePage();
    const locator = this.resolveTarget(page, target);
    await this.assertUniqueActionTarget(locator, 'double-click');
    await locator.dblclick({ timeout: PAGE_TIMEOUT_MS });
  }

  async hover(target: string | BrowserSemanticTarget): Promise<void> {
    const page = await this.ensurePage();
    const locator = this.resolveTarget(page, target);
    await this.assertUniqueActionTarget(locator, 'hover over');
    await locator.hover({ timeout: PAGE_TIMEOUT_MS });
  }

  async selectOption(target: string | BrowserSemanticTarget, value: string): Promise<string[]> {
    const page = await this.ensurePage();
    const locator = this.resolveTarget(page, target);
    await this.assertUniqueActionTarget(locator, 'select an option in');
    return locator.selectOption(value, { timeout: PAGE_TIMEOUT_MS });
  }

  async waitForElement(target: string | BrowserSemanticTarget, timeoutMs?: number): Promise<boolean> {
    const page = await this.ensurePage();
    const locator = this.resolveTarget(page, target);
    await locator.first().waitFor({ state: 'visible', timeout: Math.min(timeoutMs ?? PAGE_TIMEOUT_MS, 30_000) });
    return true;
  }

  /** Select one explicitly approved file in a unique file input and verify its metadata. */
  async upload(target: string | BrowserSemanticTarget, rawPath: string): Promise<BrowserUploadFile> {
    const file = validateBrowserUploadFile(rawPath);
    const page = await this.ensurePage();
    const locator = this.resolveTarget(page, target);
    const count = await locator.count();
    if (count !== 1) throw new Error(`Pixel requires one unique file input; this target matched ${count} elements.`);
    if (!(await locator.isEnabled())) throw new Error('Pixel will not upload to a disabled file input.');
    const type = (await locator.getAttribute('type'))?.toLowerCase();
    if (type !== 'file') throw new Error('The selected browser target is not a file input.');
    const data = readFileSync(file.path);
    const dataHash = createHash('sha256').update(data).digest('hex');
    const latest = validateBrowserUploadFile(file.path);
    if (data.byteLength !== file.sizeBytes || dataHash !== file.sha256 || latest.sha256 !== file.sha256) throw new Error('The selected upload changed after confirmation. Nothing was attached.');
    await locator.setInputFiles([{ name: file.fileName, mimeType: 'application/octet-stream', buffer: data }]);
    const selected = await locator.evaluate((element) => {
      const input = element as HTMLInputElement;
      const item = input.files?.item(0);
      return { count: input.files?.length ?? 0, name: item?.name ?? '', size: item?.size ?? -1 };
    });
    if (selected.count !== 1 || selected.name !== file.fileName || selected.size !== file.sizeBytes) {
      throw new Error('The browser did not report the selected file metadata after attachment.');
    }
    return file;
  }

  /** Download from one approved page element into a user-selected, new file. */
  async download(
    target: string | BrowserSemanticTarget,
    chooseDestination: (suggestedName: string) => Promise<string | null>,
  ): Promise<BrowserDownloadResult | null> {
    const page = await this.ensurePage();
    const locator = this.resolveTarget(page, target);
    await this.assertUniqueActionTarget(locator, 'download from');
    const downloadPromise = page.waitForEvent('download', { timeout: PAGE_TIMEOUT_MS });
    try {
      await locator.click({ timeout: PAGE_TIMEOUT_MS });
    } catch (error) {
      void downloadPromise.catch(() => undefined);
      throw error;
    }
    const download = await downloadPromise;
    const suggestedName = basename(download.suggestedFilename().replace(/[\\/]+/g, '/'))
      .replace(/[<>:"|?*\u0000-\u001f]/g, '_').slice(0, 180) || 'download';
    const destination = await chooseDestination(suggestedName);
    if (!destination) {
      await download.cancel();
      return null;
    }
    const path = validateBrowserDownloadPath(destination);
    const chunks: Uint8Array[] = [];
    let sizeBytes = 0;
    for await (const chunk of await download.createReadStream()) {
      sizeBytes += chunk.byteLength;
      if (sizeBytes > MAX_BROWSER_TRANSFER_BYTES) {
        await download.cancel();
        throw new Error('Pixel refused a browser download larger than 25 MB.');
      }
      chunks.push(chunk);
    }
    const failure = await download.failure();
    if (failure) throw new Error(`The browser download failed: ${failure}`);
    const data = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
    const hash = createHash('sha256').update(data).digest('hex');
    let fd: number | undefined;
    try {
      fd = openSync(path, 'wx');
      writeFileSync(fd, data);
      fsyncSync(fd);
      closeSync(fd);
      fd = undefined;
      const readback = readFileSync(path);
      const readbackHash = createHash('sha256').update(readback).digest('hex');
      if (readback.byteLength !== sizeBytes || readbackHash !== hash) {
        throw new Error('The saved browser download failed its size or SHA-256 read-back check.');
      }
      return { path, fileName: basename(path), sizeBytes, sha256: hash };
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
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

  /** Close the browser. Safe to call repeatedly. Never terminates a user-owned CDP browser. */
  async close(): Promise<void> {
    const context = this.context;
    const browser = this.browser;
    const wasCdp = this.attachedViaCdp;
    const wasExistingCdpContext = this.ownershipMode === 'cdp_attached_existing';
    this.page = null;
    this.context = null;
    this.browser = null;
    this.attachedViaCdp = false;
    this.ownershipMode = 'pixel_isolated';
    this.tabs.clear();
    this.activeTabId = null;
    if (!wasExistingCdpContext) {
      try {
        if (context) await context.close();
      } catch {
        /* already gone */
      }
    }
    if (!wasCdp) {
      try {
        if (browser) await browser.close();
      } catch {
        /* already gone */
      }
    }
  }

  /* ------------------------------ internals --------------------------- */

  private async ensurePage(): Promise<PlaywrightPage> {
    if (this.page && !this.page.isClosed?.()) return this.page;
    if (this.page) this.page = null;
    const openTab = [...this.tabs.entries()].find(([, page]) => !page.isClosed?.());
    if (openTab) {
      this.activeTabId = openTab[0];
      this.page = openTab[1];
      return openTab[1];
    }
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
      const playwright = this.options.playwrightLoader
        ? await this.options.playwrightLoader()
        : ((await import('playwright')) as unknown as {
            chromium: {
              launch(options?: Record<string, unknown>): Promise<PlaywrightBrowser>;
              launchPersistentContext?(userDataDir: string, options?: Record<string, unknown>): Promise<PlaywrightContext>;
              connectOverCDP?(endpointURL: string, options?: Record<string, unknown>): Promise<PlaywrightBrowser>;
            };
          });

      const liveSettings = this.options.getSettings?.();
      const cdpRaw = liveSettings?.cdpEndpoint?.trim() ?? '';
      const viewport = this.options.viewport ?? { width: 1280, height: 800 };
      const headless = liveSettings?.headless ?? this.options.headless ?? true;
      const launchArgs = [
        ...(process.platform === 'win32' ? [] : ['--no-sandbox']),
        '--disable-gpu',
        '--disable-dev-shm-usage',
      ];

      if (cdpRaw) {
        const validated = validateCdpEndpoint(cdpRaw);
        if (!validated.ok || !validated.endpoint) {
          throw new Error(validated.error ?? 'Invalid CDP endpoint.');
        }
        if (typeof playwright.chromium.connectOverCDP !== 'function') {
          throw new Error('Playwright connectOverCDP is unavailable in this runtime.');
        }
        this.browser = await playwright.chromium.connectOverCDP(validated.endpoint, {
          timeout: (liveSettings?.commandTimeoutSec ?? 30) * 1000,
        });
        this.attachedViaCdp = true;
        this.persistentProfileDir = null;

        const existingContexts = this.browser.contexts?.() ?? [];
        if (!this.options.cdpIsolatedContext && existingContexts.length > 0) {
          this.context = existingContexts[0];
          this.ownershipMode = 'cdp_attached_existing';
        } else {
          this.context = await this.browser.newContext({ viewport });
          this.ownershipMode = 'cdp_attached_isolated';
        }
      } else if (liveSettings?.profileMode === 'pixel_persistent_profile') {
        if (typeof playwright.chromium.launchPersistentContext !== 'function') {
          throw new Error('Playwright launchPersistentContext is unavailable in this runtime.');
        }
        const safeSessionName = (this.options.sessionId || 'default').replace(/[^a-zA-Z0-9._-]+/g, '_');
        const profileRoot = this.options.persistentProfilesRoot ?? join(tmpdir(), 'pixel-browser-profiles');
        const userDataDir = resolve(profileRoot, safeSessionName);
        mkdirSync(userDataDir, { recursive: true });
        this.context = await playwright.chromium.launchPersistentContext(userDataDir, {
          headless,
          viewport,
          args: launchArgs,
        });
        this.browser = null;
        this.attachedViaCdp = false;
        this.persistentProfileDir = userDataDir;
        this.ownershipMode = 'pixel_persistent';
      } else {
        this.browser = await playwright.chromium.launch({
          headless,
          args: launchArgs,
        });
        this.attachedViaCdp = false;
        this.persistentProfileDir = null;
        this.ownershipMode = 'pixel_isolated';
        this.context = await this.browser.newContext({ viewport });
      }

      await this.context.route('**/*', async (route) => {
        const target = route.request().url();
        if (target.startsWith('file:') && this.options.allowFileUrls) {
          await route.continue();
          return;
        }
        const reason = await this.getEffectiveGuard().check(target);
        if (reason) {
          this.lastBlocked = reason;
          await route.abort('blockedbyclient');
          return;
        }
        await route.continue();
      });

      const existingPages = (this.context.pages?.() ?? []).filter((p) => !p.isClosed?.());
      if (existingPages.length > 0) {
        for (const p of existingPages) {
          const id = `tab_${this.nextTabId++}`;
          this.tabs.set(id, p);
          if (!this.page) {
            this.page = p;
            this.activeTabId = id;
          }
        }
      } else {
        this.page = await this.context.newPage();
        const id = `tab_${this.nextTabId++}`;
        this.tabs.set(id, this.page);
        this.activeTabId = id;
      }
      this.launchError = null;
    } catch (error) {
      this.launchError = message(error);
      this.browser = null;
      this.context = null;
      this.page = null;
      this.tabs.clear();
      this.activeTabId = null;
      throw error;
    } finally {
      this.launching = null;
    }
  }

  private selectFallbackTab(): void {
    const fallback = [...this.tabs.entries()].find(([, page]) => !page.isClosed?.());
    this.activeTabId = fallback?.[0] ?? null;
    this.page = fallback?.[1] ?? null;
    if (fallback) void fallback[1].bringToFront?.();
  }

  private resolveTarget(page: PlaywrightPage, target: string | BrowserSemanticTarget): PlaywrightLocator {
    if (typeof target === 'string') return page.locator(target);
    const value = target.value.trim();
    if (!value || value.length > 300) throw new Error('The accessible target name must contain 1–300 characters.');
    switch (target.kind) {
      case 'role':
        if (!target.role.trim() || target.role.length > 80) throw new Error('Provide a valid accessible role.');
        return page.getByRole(target.role, { name: value, exact: true });
      case 'label': return page.getByLabel(value, { exact: true });
      case 'placeholder': return page.getByPlaceholder(value, { exact: true });
      case 'text': return page.getByText(value, { exact: true });
    }
  }

  private isAllowedLocalFile(rawUrl: string): boolean {
    if (!this.options.allowFileUrls) return false;
    try { return new URL(rawUrl).protocol === 'file:'; }
    catch { return false; }
  }

  private async assertUniqueActionTarget(locator: PlaywrightLocator, action: string): Promise<void> {
    const count = await locator.count();
    if (count !== 1) throw new Error(`Pixel requires one unique target to ${action}; this target matched ${count} elements.`);
    if (!(await locator.isVisible())) throw new Error('Pixel will not act on a hidden browser element.');
    if (!(await locator.isEnabled())) throw new Error('Pixel will not act on a disabled browser element.');
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

export interface ManagedBrowserSessionInfo {
  sessionId: string;
  ownerId: string;
  mode: BrowserOwnershipMode;
  attachedViaCdp: boolean;
  persistentProfileDir: string | null;
  lastUsedAt: number;
}

/**
 * Managed multi-session browser registry (Hermes `browser_session_lifecycle.py` parity).
 *
 * Isolates browser contexts per conversation / project / delegated agent so two
 * unrelated tasks never control the same active tab, enforces inactivity cleanup,
 * and ensures Emergency Stop disconnects CDP sessions without killing user browsers.
 */
export class BrowserSessionManager {
  private readonly sessions = new Map<string, { session: BrowserSession; ownerId: string; lastUsedAt: number }>();

  constructor(
    private readonly baseOptions: Omit<BrowserOptions, 'sessionId' | 'ownerId'> = {},
    private readonly maxSessions = 8,
  ) {}

  getOrCreate(ownerId: string, sessionName?: string): BrowserSession {
    const cleanOwner = (ownerId || 'default').trim();
    const key = sessionName ? `${cleanOwner}:${sessionName.trim()}` : cleanOwner;
    const existing = this.sessions.get(key);
    if (existing) {
      existing.lastUsedAt = Date.now();
      return existing.session;
    }
    if (this.sessions.size >= this.maxSessions) {
      const oldest = [...this.sessions.entries()].sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt)[0];
      if (oldest) {
        void oldest[1].session.close();
        this.sessions.delete(oldest[0]);
      }
    }
    const session = new BrowserSession({
      ...this.baseOptions,
      sessionId: key,
      ownerId: cleanOwner,
    });
    this.sessions.set(key, { session, ownerId: cleanOwner, lastUsedAt: Date.now() });
    return session;
  }

  list(ownerId?: string): ManagedBrowserSessionInfo[] {
    const out: ManagedBrowserSessionInfo[] = [];
    for (const [sessionId, entry] of this.sessions) {
      if (ownerId && entry.ownerId !== ownerId) continue;
      out.push({
        sessionId,
        ownerId: entry.ownerId,
        mode: entry.session.mode,
        attachedViaCdp: entry.session.isAttachedViaCdp,
        persistentProfileDir: entry.session.activeProfileDir,
        lastUsedAt: entry.lastUsedAt,
      });
    }
    return out;
  }

  async pruneInactive(maxIdleMs?: number): Promise<number> {
    const configuredSec = this.baseOptions.getSettings?.().inactivityTimeoutSec ?? 600;
    const threshold = maxIdleMs ?? Math.max(30_000, configuredSec * 1000);
    const now = Date.now();
    let closed = 0;
    for (const [id, entry] of [...this.sessions.entries()]) {
      if (now - entry.lastUsedAt > threshold) {
        await entry.session.close();
        this.sessions.delete(id);
        closed += 1;
      }
    }
    return closed;
  }

  async closeSession(sessionId: string, ownerId?: string): Promise<boolean> {
    const entry = this.sessions.get(sessionId);
    if (!entry) return false;
    if (ownerId && entry.ownerId !== ownerId) return false;
    await entry.session.close();
    this.sessions.delete(sessionId);
    return true;
  }

  async closeAll(): Promise<number> {
    let closed = 0;
    for (const [id, entry] of [...this.sessions.entries()]) {
      await entry.session.close();
      this.sessions.delete(id);
      closed += 1;
    }
    return closed;
  }
}
