import type { GrantScope } from '../../shared/types';
import { resolve } from 'node:path';

export interface StandingGrantEligibility {
  allowed: boolean;
  target: GrantScope;
  reason: string;
}

const ALWAYS_LAUNCHABLE_APPS = new Set(['notepad', 'calculator', 'mspaint']);
export const SCREEN_SESSION_GRANT_TOOL = 'screen_observation_session';
const SCREEN_SESSION_TOOLS = new Set(['analyze_screen', 'find_ui_elements', 'verify_ui_state', 'screen_highlight_control', 'screen_draw_arrow']);

export function isScreenSessionTool(toolName: string): boolean {
  return SCREEN_SESSION_TOOLS.has(toolName);
}

/** Explicit allow-list for repeatable operations that are safe to remember. */
export function standingGrantEligibility(toolName: string, args: Record<string, unknown>): StandingGrantEligibility {
  if (toolName === 'open_application') {
    const app = normaliseApp(args.name);
    if (!app) return { allowed: false, target: {}, reason: 'Pixel cannot identify one exact application.' };
    if (!ALWAYS_LAUNCHABLE_APPS.has(app)) {
      return { allowed: false, target: { app }, reason: 'Always Allow is available only for bounded, allow-listed applications such as Notepad.' };
    }
    return { allowed: true, target: { app }, reason: `Future launches are limited to ${app}.` };
  }

  if (toolName === 'browser_navigate') {
    const origin = originOf(args.url);
    if (!origin || !/^https:\/\//i.test(String(args.url ?? ''))) {
      return { allowed: false, target: {}, reason: 'Always Allow requires a secure HTTPS website with an exact origin.' };
    }
    return { allowed: true, target: { origin }, reason: `Future navigation is limited to ${origin}.` };
  }

  return { allowed: false, target: deriveGrantScope(toolName, args), reason: 'This action requires approval each time because its target or effects are not safe to persist.' };
}

/** A volatile observation grant is exact to one live HWND/PID/title identity. */
export function sessionGrantEligibility(toolName: string, args: Record<string, unknown>): StandingGrantEligibility {
  if (toolName === 'analyze_screen' && args.target !== 'selected_window') {
    return { allowed: false, target: {}, reason: 'Select one exact live application window before authorizing screen observation for this Pixel run.' };
  }
  const target = selectedWindowScope(args);
  if (!isScreenSessionTool(toolName) || !target) {
    return { allowed: false, target: deriveGrantScope(toolName, args), reason: 'Session access is available only for one explicitly selected live window.' };
  }
  return { allowed: true, target, reason: `This Pixel run only · screen observation and passive guidance for ${target.processName} · “${target.windowTitle}” (exact live window; no clicks or typing)` };
}

export function validateSessionGrant(toolName: string, target: GrantScope | undefined): boolean {
  if (!target || toolName !== SCREEN_SESSION_GRANT_TOOL) return false;
  return Object.keys(target).length === 4 &&
    typeof target.windowId === 'string' && target.windowId.length > 0 && target.windowId.length <= 64 &&
    Number.isInteger(target.processId) && Number(target.processId) > 0 &&
    typeof target.processName === 'string' && target.processName.length > 0 && target.processName.length <= 260 &&
    typeof target.windowTitle === 'string' && target.windowTitle.length > 0 && target.windowTitle.length <= 500;
}

export const PERMISSION_POLICY_VERSION = 1;

export function validateStandingGrant(toolName: string, target: GrantScope | undefined): boolean {
  if (!target) return false;
  if (toolName === 'open_application') {
    return Object.keys(target).length === 1 && typeof target.app === 'string' && ALWAYS_LAUNCHABLE_APPS.has(target.app);
  }
  if (toolName === 'browser_navigate') {
    return Object.keys(target).length === 1 && typeof target.origin === 'string' && /^https:\/\//i.test(target.origin) && originOf(target.origin) === target.origin;
  }
  return false;
}

/**
 * Work out what an invocation is aimed at, so an approval can be limited to it.
 *
 * Only values taken from the tool's own arguments are used. Text that came back
 * from a web page, document or earlier tool result never feeds this function, so
 * untrusted content cannot widen what the user approved.
 */
export function deriveGrantScope(toolName: string, args: Record<string, unknown>): GrantScope {
  switch (toolName) {
    case 'browser_navigate': {
      const origin = originOf(args.url);
      return origin ? { origin } : {};
    }
    case 'browser_open_search': {
      const query = typeof args.query === 'string' ? args.query.trim().replace(/\s+/g, ' ').toLocaleLowerCase() : '';
      return query ? { query } : {};
    }
    case 'open_application': {
      const app = normaliseApp(args.name);
      return app ? { app } : {};
    }
    case 'documents_index': {
      const directory = canonicalDirectory(args.directory);
      return directory ? { directory } : {};
    }
    case 'analyze_screen':
    case 'find_ui_elements':
    case 'verify_ui_state':
    case 'screen_highlight_control':
    case 'screen_draw_arrow':
      if (toolName === 'analyze_screen' && args.target !== 'selected_window') return {};
      return selectedWindowScope(args) ?? {};
    default:
      return {};
  }
}

/** True when a grant's target covers an invocation's target. */
export function scopeCovers(granted: GrantScope | undefined, wanted: GrantScope): boolean {
  if (!granted) return true;
  if (granted.origin !== undefined && granted.origin !== wanted.origin) return false;
  if (granted.app !== undefined && granted.app !== wanted.app) return false;
  if (granted.directory !== undefined && canonicalDirectory(granted.directory) !== canonicalDirectory(wanted.directory)) return false;
  if (granted.query !== undefined && granted.query !== wanted.query) return false;
  if (granted.windowId !== undefined && granted.windowId !== wanted.windowId) return false;
  if (granted.processId !== undefined && granted.processId !== wanted.processId) return false;
  if (granted.processName !== undefined && granted.processName.toLocaleLowerCase() !== wanted.processName?.toLocaleLowerCase()) return false;
  if (granted.windowTitle !== undefined && granted.windowTitle !== wanted.windowTitle) return false;
  return true;
}

export function originOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function normaliseApp(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim().toLowerCase().replace(/\.exe$/, '').replace(/\\/g, '/').split('/').pop() ?? '';
  const aliases: Record<string, string> = { calc: 'calculator', 'mspaint.exe': 'mspaint', 'notepad.exe': 'notepad' };
  const normalized = aliases[cleaned] ?? cleaned;
  return normalized.length > 0 ? normalized : null;
}

function canonicalDirectory(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  try {
    const path = resolve(value.trim());
    return process.platform === 'win32' ? path.toLowerCase() : path;
  } catch {
    return null;
  }
}

/** Human description of a scope for the approval card. */
export function describeScope(scope: GrantScope): string {
  if (scope.windowId && scope.processName && scope.windowTitle) return `${scope.processName} window “${scope.windowTitle}” (${scope.windowId}, PID ${scope.processId ?? '?'})`;
  if (scope.origin) return `only ${scope.origin}`;
  if (scope.app) return `only ${scope.app}`;
  if (scope.directory) return `only ${scope.directory}`;
  if (scope.query) return `only the search “${scope.query.slice(0, 72)}”`;
  return 'this action anywhere';
}

function selectedWindowScope(args: Record<string, unknown>): GrantScope | null {
  if (typeof args.targetWindowId !== 'string' || !args.targetWindowId || args.targetWindowId.length > 64 ||
    typeof args.expectedWindowTitle !== 'string' || !args.expectedWindowTitle || args.expectedWindowTitle.length > 500 ||
    typeof args.expectedProcessName !== 'string' || !args.expectedProcessName || args.expectedProcessName.length > 260 ||
    !Number.isInteger(args.expectedProcessId) || Number(args.expectedProcessId) <= 0) return null;
  return {
    windowId: args.targetWindowId,
    processId: Number(args.expectedProcessId),
    processName: args.expectedProcessName,
    windowTitle: args.expectedWindowTitle,
  };
}
