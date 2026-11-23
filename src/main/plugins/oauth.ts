/**
 * Standards-based OAuth 2.0 Authorization Code + PKCE (RFC 7636) utilities
 * for Pixel desktop integrations (Google Calendar, remote MCP servers, etc.).
 *
 * Security invariants:
 * - Enforces S256 PKCE code challenge.
 * - Validates HTTPS authorization/token endpoints and loopback-only redirect URIs.
 * - Enforces exact `state` matching to block CSRF/replay attacks.
 * - Enforces audience/resource matching so tokens are never passed through to
 *   unintended hosts.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export interface PkcePair {
  codeVerifier: string;
  codeChallenge: string;
  method: 'S256';
}

export interface OAuthClientConfig {
  providerId: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  revocationEndpoint?: string;
  clientId: string;
  redirectUri: string;
  scopes: string[];
  /** Intended API host/audience (e.g. 'https://www.googleapis.com'). */
  audience: string;
}

export interface OAuthTokenRecord {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  expiresAt: number;
  scopes: string[];
  audience: string;
  accountEmail?: string;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

function toBase64Url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function generatePkcePair(): PkcePair {
  const codeVerifier = toBase64Url(randomBytes(32));
  const digest = createHash('sha256').update(codeVerifier, 'ascii').digest();
  return {
    codeVerifier,
    codeChallenge: toBase64Url(digest),
    method: 'S256',
  };
}

export function generateOAuthState(): string {
  return toBase64Url(randomBytes(24));
}

export function validateLoopbackRedirectUri(rawUri: string): URL {
  const parsed = new URL(rawUri);
  const host = parsed.hostname.toLowerCase();
  const isLoopback = host === '127.0.0.1' || host === 'localhost' || host === '[::1]';
  if (parsed.protocol !== 'http:' || !isLoopback) {
    throw new Error('Desktop OAuth redirect URI must use loopback http://127.0.0.1 or http://localhost.');
  }
  return parsed;
}

export function validateHttpsEndpoint(rawUrl: string, label: string): URL {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== 'https:') {
    throw new Error(`${label} must use https://.`);
  }
  return parsed;
}

export function buildOAuthAuthorizationUrl(
  config: OAuthClientConfig,
  state: string,
  pkce: PkcePair,
): string {
  const authUrl = validateHttpsEndpoint(config.authorizationEndpoint, 'OAuth authorization endpoint');
  validateLoopbackRedirectUri(config.redirectUri);
  if (!config.clientId.trim()) throw new Error('OAuth clientId is required.');
  if (!state || state.length < 16) throw new Error('OAuth state token is too short.');

  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', config.clientId.trim());
  authUrl.searchParams.set('redirect_uri', config.redirectUri);
  authUrl.searchParams.set('scope', config.scopes.join(' '));
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', pkce.codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');
  return authUrl.toString();
}

export function validateOAuthCallback(params: {
  expectedState: string;
  receivedState: string | null | undefined;
  code: string | null | undefined;
  error?: string | null;
}): { ok: true; code: string } | { ok: false; error: string } {
  if (params.error) {
    return { ok: false, error: `OAuth authorization denied: ${params.error}` };
  }
  const exp = Buffer.from(params.expectedState, 'utf8');
  const rec = Buffer.from(params.receivedState ?? '', 'utf8');
  if (exp.length === 0 || exp.length !== rec.length || !timingSafeEqual(exp, rec)) {
    return { ok: false, error: 'OAuth state mismatch; authorization aborted to prevent CSRF.' };
  }
  const code = (params.code ?? '').trim();
  if (!code) return { ok: false, error: 'OAuth callback did not include an authorization code.' };
  return { ok: true, code };
}

export function isTokenExpired(record: OAuthTokenRecord, skewSeconds = 60): boolean {
  return Date.now() >= record.expiresAt - skewSeconds * 1000;
}

/** Prevents token passthrough to an unintended API host/audience. */
export function assertTokenAudience(record: OAuthTokenRecord, targetUrl: string): void {
  const target = new URL(targetUrl);
  const allowed = new URL(record.audience);
  if (target.protocol !== allowed.protocol || target.host.toLowerCase() !== allowed.host.toLowerCase()) {
    throw new Error(`Blocked OAuth token passthrough: token audience is ${allowed.origin}, not ${target.origin}.`);
  }
}

export function hasRequiredScope(record: OAuthTokenRecord, requiredScope: string): boolean {
  return record.scopes.includes(requiredScope);
}

export async function exchangeAuthorizationCode(
  config: OAuthClientConfig,
  code: string,
  codeVerifier: string,
  fetchFn: FetchLike = fetch,
): Promise<OAuthTokenRecord> {
  validateHttpsEndpoint(config.tokenEndpoint, 'OAuth token endpoint');
  validateLoopbackRedirectUri(config.redirectUri);

  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    code,
    code_verifier: codeVerifier,
  });

  const resp = await fetchFn(config.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: form.toString(),
  });
  if (!resp.ok) {
    throw new Error(`OAuth token exchange failed with HTTP ${resp.status}.`);
  }
  const data = (await resp.json()) as Record<string, unknown>;
  const accessToken = typeof data.access_token === 'string' ? data.access_token : '';
  if (!accessToken) throw new Error('OAuth token response missing access_token.');
  const expiresIn = typeof data.expires_in === 'number' && data.expires_in > 0 ? data.expires_in : 3600;
  const scopeStr = typeof data.scope === 'string' ? data.scope : config.scopes.join(' ');
  return {
    accessToken,
    ...(typeof data.refresh_token === 'string' && data.refresh_token ? { refreshToken: data.refresh_token } : {}),
    tokenType: typeof data.token_type === 'string' ? data.token_type : 'Bearer',
    expiresAt: Date.now() + expiresIn * 1000,
    scopes: scopeStr.split(/\s+/).filter(Boolean),
    audience: config.audience,
  };
}

export async function refreshAccessToken(
  config: OAuthClientConfig,
  existing: OAuthTokenRecord,
  fetchFn: FetchLike = fetch,
): Promise<OAuthTokenRecord> {
  if (!existing.refreshToken) {
    throw new Error('No refresh token available; reconnect the account.');
  }
  validateHttpsEndpoint(config.tokenEndpoint, 'OAuth token endpoint');
  const form = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: config.clientId,
    refresh_token: existing.refreshToken,
  });
  const resp = await fetchFn(config.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: form.toString(),
  });
  if (!resp.ok) {
    throw new Error(`OAuth token refresh failed with HTTP ${resp.status}; reconnect the account.`);
  }
  const data = (await resp.json()) as Record<string, unknown>;
  const accessToken = typeof data.access_token === 'string' ? data.access_token : '';
  if (!accessToken) throw new Error('OAuth refresh response missing access_token.');
  const expiresIn = typeof data.expires_in === 'number' && data.expires_in > 0 ? data.expires_in : 3600;
  return {
    ...existing,
    accessToken,
    ...(typeof data.refresh_token === 'string' && data.refresh_token ? { refreshToken: data.refresh_token } : {}),
    expiresAt: Date.now() + expiresIn * 1000,
  };
}
