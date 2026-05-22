import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock DNS so resolution is deterministic and offline-friendly.
// `default` is supplied alongside the named export for ESM interop.
vi.mock('dns/promises', () => {
  const lookup = vi.fn();
  return { lookup, default: { lookup } };
});

import { isBlockedAddress, assertPublicHttpUrl } from './net-guard';
import { lookup } from 'dns/promises';

beforeEach(() => {
  vi.mocked(lookup).mockReset();
  vi.mocked(lookup).mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as any);
});

describe('isBlockedAddress', () => {
  it('blocks IPv4 loopback', () => {
    expect(isBlockedAddress('127.0.0.1')).toBe(true);
    expect(isBlockedAddress('127.255.255.254')).toBe(true);
  });

  it('blocks IPv4 private ranges', () => {
    expect(isBlockedAddress('10.0.0.1')).toBe(true);
    expect(isBlockedAddress('172.16.0.1')).toBe(true);
    expect(isBlockedAddress('172.31.255.255')).toBe(true);
    expect(isBlockedAddress('192.168.1.1')).toBe(true);
  });

  it('blocks the IPv4 link-local / cloud-metadata range', () => {
    expect(isBlockedAddress('169.254.169.254')).toBe(true);
  });

  it('blocks the IPv4 CGNAT range', () => {
    expect(isBlockedAddress('100.64.0.1')).toBe(true);
    expect(isBlockedAddress('100.127.255.255')).toBe(true);
  });

  it('blocks "this network", multicast, and reserved IPv4', () => {
    expect(isBlockedAddress('0.0.0.0')).toBe(true);
    expect(isBlockedAddress('224.0.0.1')).toBe(true);
    expect(isBlockedAddress('255.255.255.255')).toBe(true);
  });

  it('allows public IPv4 (including ranges adjacent to private blocks)', () => {
    expect(isBlockedAddress('93.184.216.34')).toBe(false);
    expect(isBlockedAddress('8.8.8.8')).toBe(false);
    expect(isBlockedAddress('172.15.0.1')).toBe(false);
    expect(isBlockedAddress('172.32.0.1')).toBe(false);
    expect(isBlockedAddress('100.63.255.255')).toBe(false);
  });

  it('blocks IPv6 loopback and unspecified', () => {
    expect(isBlockedAddress('::1')).toBe(true);
    expect(isBlockedAddress('::')).toBe(true);
  });

  it('blocks IPv6 link-local and unique-local', () => {
    expect(isBlockedAddress('fe80::1')).toBe(true);
    expect(isBlockedAddress('fc00::1')).toBe(true);
    expect(isBlockedAddress('fd12:3456::1')).toBe(true);
  });

  it('blocks IPv4-mapped IPv6 that points at private space', () => {
    expect(isBlockedAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isBlockedAddress('::ffff:192.168.0.1')).toBe(true);
  });

  it('allows public IPv6', () => {
    expect(isBlockedAddress('2606:4700:4700::1111')).toBe(false);
  });

  it('fails closed on input that is not a valid IP', () => {
    expect(isBlockedAddress('not-an-ip')).toBe(true);
    expect(isBlockedAddress('')).toBe(true);
  });
});

describe('assertPublicHttpUrl', () => {
  it('rejects a malformed URL', async () => {
    await expect(assertPublicHttpUrl('not a url')).rejects.toThrow(/malformed/i);
  });

  it('rejects non-http(s) schemes', async () => {
    await expect(assertPublicHttpUrl('file:///etc/passwd')).rejects.toThrow(/scheme/i);
    await expect(assertPublicHttpUrl('ftp://example.com/x')).rejects.toThrow(/scheme/i);
    await expect(assertPublicHttpUrl('javascript:alert(1)')).rejects.toThrow(/scheme/i);
  });

  it('rejects literal private/loopback IPs without a DNS lookup', async () => {
    await expect(assertPublicHttpUrl('http://127.0.0.1:11435/api/tags')).rejects.toThrow(
      /private/i,
    );
    await expect(assertPublicHttpUrl('http://192.168.1.1/')).rejects.toThrow(/private/i);
    await expect(assertPublicHttpUrl('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(
      /private/i,
    );
    expect(lookup).not.toHaveBeenCalled();
  });

  it('rejects a bracketed IPv6 loopback literal', async () => {
    await expect(assertPublicHttpUrl('http://[::1]:8080/')).rejects.toThrow(/private/i);
  });

  it('allows a literal public IP', async () => {
    await expect(assertPublicHttpUrl('https://93.184.216.34/img.png')).resolves.toBeInstanceOf(URL);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('rejects internal hostnames without a DNS lookup', async () => {
    await expect(assertPublicHttpUrl('http://localhost/x')).rejects.toThrow(/internal/i);
    await expect(assertPublicHttpUrl('http://printer.local/x')).rejects.toThrow(/internal/i);
    await expect(assertPublicHttpUrl('http://svc.internal/x')).rejects.toThrow(/internal/i);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('rejects a hostname that resolves to a private address', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '10.0.0.5', family: 4 }] as any);
    await expect(assertPublicHttpUrl('https://rebind.example.com/x')).rejects.toThrow(/private/i);
  });

  it('rejects a hostname that resolves to a mix of public and private addresses', async () => {
    vi.mocked(lookup).mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ] as any);
    await expect(assertPublicHttpUrl('https://mixed.example.com/x')).rejects.toThrow(/private/i);
  });

  it('rejects a hostname that fails to resolve', async () => {
    vi.mocked(lookup).mockRejectedValue(new Error('ENOTFOUND'));
    await expect(assertPublicHttpUrl('https://nope.example.com/x')).rejects.toThrow(/resolve/i);
  });

  it('allows a hostname that resolves to a public address', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as any);
    const url = await assertPublicHttpUrl('https://example.com/img.png');
    expect(url).toBeInstanceOf(URL);
    expect(url.hostname).toBe('example.com');
    expect(lookup).toHaveBeenCalledWith('example.com', { all: true });
  });
});
