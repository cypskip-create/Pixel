import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, mergeSettings } from '@shared/types';
import { NetworkGuard, isCloudMetadataHost } from '../src/main/agent/netGuard';
import {
  prepareBrowserProfile,
  revokeRealProfileSnapshots,
  validateCdpEndpoint,
} from '../src/main/agent/browserProfiles';
import { ComputerUseController } from '../src/main/agent/computerUse';
import { ToolRegistry } from '../src/main/agent/tools';
import { TerminalService } from '../src/main/services/terminalService';
import type { NativeHelper } from '../src/main/services/nativeHelper';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('Stage 5: Browser Security, Profiles, CDP, Computer Use, Settings & Terminal Containment', () => {
  it('enforces unconditional cloud metadata blocking, credential URL rejection, and domain allow/deny policies in NetworkGuard', async () => {
    expect(isCloudMetadataHost('169.254.169.254')).toBe(true);
    expect(isCloudMetadataHost('metadata.google.internal')).toBe(true);
    expect(isCloudMetadataHost('::ffff:169.254.169.254')).toBe(true);

    // Even when allowPrivateNetwork is true, cloud metadata & credentials MUST be refused!
    const privateAllowedGuard = new NetworkGuard({
      allowPrivateNetwork: true,
      blockedDomains: ['evil.example.com'],
      resolve: async () => ['93.184.216.34'],
    });
    expect(await privateAllowedGuard.check('http://169.254.169.254/latest/meta-data/')).toContain('unconditionally blocked');
    expect(await privateAllowedGuard.check('http://metadata.google.internal/computeMetadata/v1/')).toContain('unconditionally blocked');
    expect(await privateAllowedGuard.check('https://user:pass@example.com/')).toContain('credentials');
    expect(await privateAllowedGuard.check('https://sub.evil.example.com/')).toContain('blocked domains');
    expect(await privateAllowedGuard.check('http://127.0.0.1:3000/test')).toBeNull();
    expect(privateAllowedGuard.checkConnectedAddress('169.254.169.254')).toContain('unconditionally blocked');

    // Allowlist enforcement.
    const allowlistGuard = new NetworkGuard({
      allowedDomains: ['docs.example.org'],
      resolve: async () => ['93.184.216.34'],
    });
    expect(await allowlistGuard.check('https://docs.example.org/guide')).toBeNull();
    expect(await allowlistGuard.check('https://other.org/')).toContain('allowed domains');
  });

  it('validates CDP endpoints safely and manages consented real-profile snapshots with revocation cleanup', () => {
    expect(validateCdpEndpoint('http://127.0.0.1:9222')).toMatchObject({ ok: true, ownedByPixel: false });
    expect(validateCdpEndpoint('ws://localhost:9222/devtools/browser/1')).toMatchObject({ ok: true, ownedByPixel: false });
    expect(validateCdpEndpoint('https://remote-cdp.example.com')).toMatchObject({ ok: true, ownedByPixel: false });
    expect(validateCdpEndpoint('http://remote-insecure.example.com:9222').ok).toBe(false);
    expect(validateCdpEndpoint('http://169.254.169.254:9222').ok).toBe(false);
    expect(validateCdpEndpoint('http://user:pass@127.0.0.1:9222').ok).toBe(false);

    const root = mkdtempSync(join(tmpdir(), 'pixel-bprof-'));
    tempDirs.push(root);
    const fakeProfile = join(root, 'fake-chrome-default');
    const snapRoot = join(root, 'snapshots');
    mkdirSync(fakeProfile, { recursive: true });
    writeFileSync(join(fakeProfile, 'Preferences'), '{"profile":{"name":"Test"}}', 'utf8');

    // Consent OFF -> isolated fresh profile, nothing copied.
    const noConsent = prepareBrowserProfile({
      consent: false,
      snapshotRoot: snapRoot,
      selectedProfile: {
        id: 'chrome',
        label: 'Google Chrome (Stable)',
        executablePath: 'C:\\chrome.exe',
        userDataDir: root,
        profileDir: fakeProfile,
        locked: false,
      },
    });
    expect(noConsent.mode).toBe('isolated_fresh_profile');
    expect(existsSync(snapRoot)).toBe(false);

    // Locked profile -> honest fallback note.
    const lockedRes = prepareBrowserProfile({
      consent: true,
      snapshotRoot: snapRoot,
      selectedProfile: {
        id: 'chrome',
        label: 'Google Chrome (Stable)',
        executablePath: 'C:\\chrome.exe',
        userDataDir: root,
        profileDir: fakeProfile,
        locked: true,
      },
    });
    expect(lockedRes.mode).toBe('isolated_fresh_profile');
    expect(lockedRes.fallbackNote).toContain('locked');

    // Unlocked + consent ON -> copies into Pixel-owned snapshot dir, then revocation wipes it.
    const okRes = prepareBrowserProfile({
      consent: true,
      snapshotRoot: snapRoot,
      selectedProfile: {
        id: 'chrome',
        label: 'Google Chrome (Stable)',
        executablePath: 'C:\\chrome.exe',
        userDataDir: root,
        profileDir: fakeProfile,
        locked: false,
      },
    });
    expect(okRes.mode).toBe('signed_in_profile_copy');
    expect(okRes.profilePath && existsSync(join(okRes.profilePath, 'Preferences'))).toBe(true);

    expect(revokeRealProfileSnapshots(snapRoot)).toBe(true);
    expect(existsSync(snapRoot)).toBe(false);
  });

  it('executes consolidated Windows computer_use with Set-of-Marks indexing, stale/password rejection, and Emergency Stop', async () => {
    const registry = new ToolRegistry();
    expect(registry.get('computer_use')?.requiresApproval).toBe(true);
    expect(registry.get('browser_hover')?.category).toBe('browser');
    expect(registry.get('browser_select_option')?.changesState).toBe(true);
    expect(registry.get('browser_wait_for_element')?.requiresApproval).toBe(false);

    let nowMs = 1_000_000;
    let stopped = false;
    const callMock = vi.fn(async (cmd: string) => {
      if (cmd === 'find_elements') {
        return {
          window: { windowId: 'win-1', title: 'TestApp', pid: 4242, processName: 'TestApp.exe' },
          elements: [
            { name: 'Submit', role: 'Button', automationId: 'btnSubmit', enabled: true, rect: { x: 0, y: 0, width: 80, height: 30 } },
            { name: 'Password', role: 'Edit', automationId: 'txtPassword', enabled: true, rect: { x: 0, y: 40, width: 180, height: 30 } },
            { name: 'Search', role: 'Edit', automationId: 'txtSearch', enabled: true, rect: { x: 0, y: 80, width: 180, height: 30 } },
          ],
          truncated: false,
        };
      }
      return { ok: true };
    });

    const fakeHelper = {
      listExternalWindows: vi.fn(async () => ({
        windows: [{ windowId: 'win-1', title: 'TestApp', pid: 4242, processName: 'TestApp.exe' }],
        truncated: false,
      })),
      lastExternalForegroundWindow: vi.fn(async () => ({
        window: { windowId: 'win-1', title: 'TestApp', pid: 4242, processName: 'TestApp.exe' },
      })),
      call: callMock,
    } as unknown as NativeHelper;

    const controller = new ComputerUseController({
      nativeHelper: fakeHelper,
      isEmergencyStopped: () => stopped,
      now: () => nowMs,
    });

    const captureRes = await controller.execute({ action: 'capture', mode: 'som' });
    expect(captureRes.ok).toBe(true);
    expect(captureRes.content).toContain('[1] Button: "Submit"');

    // Background UIA set_value on element 3 succeeds.
    const setRes = await controller.execute({ action: 'set_value', element: 3, text: 'hello' });
    expect(setRes.ok).toBe(true);
    expect(setRes.interactionMode).toBe('background_uia');
    expect(callMock).toHaveBeenCalledWith('set_element_value', expect.objectContaining({ selector: 'txtSearch', value: 'hello' }));

    // Password control (element 2) is unconditionally refused.
    const passRes = await controller.execute({ action: 'set_value', element: 2, text: 'secret' });
    expect(passRes.ok).toBe(false);
    expect(passRes.content).toContain('password');

    // Window mismatch is refused.
    const mismatchRes = await controller.execute({ action: 'click', element: 1, windowId: 'win-other' });
    expect(mismatchRes.ok).toBe(false);
    expect(mismatchRes.content).toContain('mismatch');

    // Stale snapshot (> 30s) is refused.
    nowMs += 35_000;
    const staleRes = await controller.execute({ action: 'click', element: 1 });
    expect(staleRes.ok).toBe(false);
    expect(staleRes.content).toContain('expired');

    // Emergency Stop blocks all computer_use actions.
    stopped = true;
    const stopRes = await controller.execute({ action: 'list_windows' });
    expect(stopRes.ok).toBe(false);
    expect(stopRes.content).toContain('Emergency Stop');
  });

  it('rejects TerminalService cwdOverride escapes outside the canonical authorized project root', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'pixel-proj-root-'));
    const outsideDir = mkdtempSync(join(tmpdir(), 'pixel-outside-'));
    tempDirs.push(projectRoot, outsideDir);

    const terminal = new TerminalService({ authorizedRoot: projectRoot });
    const escapeRes = await terminal.run('Write-Output "nope"', outsideDir);
    expect(escapeRes.ok).toBe(false);
    expect(escapeRes.error).toContain('escapes the authorized project root');
  });

  it('clamps and persists Stage 5 browser and computerUse settings', () => {
    expect(DEFAULT_SETTINGS.browser?.headless).toBe(true);
    expect(DEFAULT_SETTINGS.computerUse?.captureMode).toBe('som');

    const merged = mergeSettings({
      browser: {
        headless: false,
        cdpEndpoint: 'http://127.0.0.1:9222',
        inactivityTimeoutSec: 99_999,
        commandTimeoutSec: 1,
        realProfileConsent: true,
        selectedBrowserId: 'edge',
        allowPrivateNetwork: true,
        blockedDomains: ['Ads.Example.com'],
        allowedDomains: [],
      },
      computerUse: {
        captureMode: 'ax',
        interactionPolicy: 'ask_before_foreground',
        requireVerification: true,
      },
    });

    expect(merged.browser?.headless).toBe(false);
    expect(merged.browser?.inactivityTimeoutSec).toBe(3600);
    expect(merged.browser?.commandTimeoutSec).toBe(5);
    expect(merged.browser?.blockedDomains).toEqual(['ads.example.com']);
    expect(merged.computerUse?.captureMode).toBe('ax');
    expect(merged.computerUse?.interactionPolicy).toBe('ask_before_foreground');
  });
});
