import { lookup } from 'node:dns/promises';

/** Resolves a hostname to every address it currently points at. */
export type HostResolver = (hostname: string) => Promise<string[]>;

export const systemResolver: HostResolver = async (hostname) => {
  const results = await lookup(hostname, { all: true, verbatim: true });
  return results.map((entry) => entry.address);
};

export interface NetworkGuardOptions {
  /** Permit localhost / LAN / link-local targets. Off in the app, on in tests. */
  allowPrivateNetwork?: boolean;
  resolve?: HostResolver;
}

/**
 * Decides whether the browser may talk to a URL, looking at what the name
 * resolves to rather than at the name alone.
 *
 * It closes four gaps a hostname check leaves open:
 *   - a public-looking name whose DNS record points at a private address;
 *   - a name with several records where one is private;
 *   - redirects, because it is applied to every request the page makes, and a
 *     redirect hop is a request;
 *   - the address Chromium really connected to, via checkConnectedAddress.
 *
 * Residual risk: DNS rebinding can still return a different answer to Chromium
 * than it did to this check. checkConnectedAddress detects that after the fact
 * and the browser then refuses to hand the page to the model; fully preventing
 * the connection would need an egress proxy that resolves and connects itself.
 */
export class NetworkGuard {
  private readonly allowPrivate: boolean;
  private readonly resolve: HostResolver;

  constructor(options: NetworkGuardOptions = {}) {
    this.allowPrivate = options.allowPrivateNetwork ?? false;
    this.resolve = options.resolve ?? systemResolver;
  }

  /** Returns null when the URL is allowed, otherwise a human reason. */
  async check(rawUrl: string): Promise<string | null> {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return 'The address is not a valid URL.';
    }

    // data:, blob: and about: never leave the machine.
    if (url.protocol === 'data:' || url.protocol === 'blob:' || url.protocol === 'about:') return null;
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return `The "${url.protocol}" scheme is not allowed.`;
    }
    if (this.allowPrivate) return null;

    const host = url.hostname;
    if (isPrivateHost(host)) return blocked(host);

    // A literal IP was already judged by isPrivateHost; a name must be resolved.
    if (!isIpLiteral(host)) {
      let addresses: string[];
      try {
        addresses = await this.resolve(host);
      } catch {
        return `Pixel could not resolve "${host}", so it cannot check where it leads.`;
      }
      if (addresses.length === 0) return `"${host}" did not resolve to any address.`;
      const bad = addresses.find((address) => isPrivateHost(address));
      if (bad !== undefined) {
        return `"${host}" resolves to a private-network address (${bad}), so Pixel will not open it.`;
      }
    }
    return null;
  }

  /**
   * Check the address a connection actually used (Playwright's serverAddr).
   * Catches a rebind that happened between check() and Chromium's own lookup.
   */
  checkConnectedAddress(address: string | undefined | null): string | null {
    if (this.allowPrivate || !address) return null;
    return isPrivateHost(address)
      ? `The page connected to a private-network address (${address}).`
      : null;
  }
}

function blocked(host: string): string {
  return `Pixel will not open "${host}": it is a local or private-network address.`;
}

function isIpLiteral(host: string): boolean {
  const bare = host.replace(/^\[|\]$/g, '');
  return bare.includes(':') || /^\d+\.\d+\.\d+\.\d+$/.test(bare);
}

/**
 * True for hosts that point at this machine or a private network.
 *
 * This inspects the hostname only. It does not resolve DNS, so a public name
 * that resolves to a private address (DNS rebinding) is not caught here; closing
 * that needs a network-level egress filter.
 */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (host === '' || host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.lan')) return true;

  // IPv6: loopback, unspecified, unique-local (fc00::/7), link-local (fe80::/10),
  // and IPv4-mapped addresses, which are checked as IPv4 below.
  if (host.includes(':')) {
    if (host === '::1' || host === '::') return true;
    if (/^f[cd][0-9a-f]{2}:/.test(host)) return true;
    if (/^fe[89ab][0-9a-f]:/.test(host)) return true;
    const mapped = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPrivateHost(mapped[1]) : false;
  }

  const m = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}