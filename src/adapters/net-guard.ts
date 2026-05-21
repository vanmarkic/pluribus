/**
 * SSRF guard for outbound fetches of URLs that originate from untrusted
 * email content — remote images and `List-Unsubscribe` links.
 *
 * Without this, a crafted email can point the main process at internal
 * services (`http://127.0.0.1:11435` is the bundled Ollama server),
 * router admin pages, or cloud metadata endpoints. `assertPublicHttpUrl`
 * resolves the host and rejects loopback / private / link-local /
 * reserved address space.
 *
 * Limitation: HTTP redirects are not re-validated hop-by-hop — the guard
 * checks the initial URL only. The attacker has no feedback channel from
 * a desktop client, so redirect-based bypass is low-value; callers that
 * need stricter handling should disable redirects.
 */

import { lookup } from 'dns/promises';
import { isIP } from 'net';

function ipv4IsPrivate(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) return true;
  const a = Number(parts[0]);
  const b = Number(parts[1]);
  if (!Number.isInteger(a) || !Number.isInteger(b)) return true;
  if (a === 0) return true; // "this network"
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function ipv6IsPrivate(ip: string): boolean {
  const v = (ip.split('%')[0] ?? '').toLowerCase();
  if (v === '::1' || v === '::') return true; // loopback / unspecified
  if (v.startsWith('fe80')) return true; // link-local
  if (v.startsWith('fc') || v.startsWith('fd')) return true; // unique-local
  const mapped = v.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/); // IPv4-mapped
  if (mapped) return ipv4IsPrivate(mapped[1] ?? '');
  return false;
}

/** True if `ip` is loopback / private / link-local / reserved (or not a valid IP). */
export function isBlockedAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return ipv4IsPrivate(ip);
  if (kind === 6) return ipv6IsPrivate(ip);
  return true; // not a recognisable IP — fail closed
}

/**
 * Resolve `rawUrl` and throw if it is not a plain http(s) URL pointing at
 * a publicly routable host. Call before fetching any email-derived URL.
 */
export async function assertPublicHttpUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Malformed URL');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Blocked URL scheme: ${url.protocol}`);
  }

  const host = url.hostname.replace(/^\[|\]$/g, ''); // strip IPv6 brackets

  // Literal IP in the URL — check directly, no DNS needed.
  if (isIP(host)) {
    if (isBlockedAddress(host)) {
      throw new Error('Blocked: URL targets a private address');
    }
    return url;
  }

  // Obvious internal hostnames that may resolve via local resolvers.
  const lower = host.toLowerCase();
  if (
    lower === 'localhost' ||
    lower.endsWith('.localhost') ||
    lower.endsWith('.local') ||
    lower.endsWith('.internal') ||
    lower.endsWith('.home.arpa')
  ) {
    throw new Error('Blocked: URL targets an internal host');
  }

  // Resolve and reject if any returned address is private.
  let records: { address: string }[];
  try {
    records = await lookup(host, { all: true });
  } catch {
    throw new Error('Could not resolve URL host');
  }
  if (records.length === 0) {
    throw new Error('Could not resolve URL host');
  }
  for (const record of records) {
    if (isBlockedAddress(record.address)) {
      throw new Error('Blocked: URL host resolves to a private address');
    }
  }

  return url;
}
