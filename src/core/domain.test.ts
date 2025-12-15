import { describe, it, expect } from 'vitest';
import { createTagSlug, extractDomain, extractSubjectPattern, formatSender, isRecent } from './domain';

describe('createTagSlug', () => {
  it('converts name to lowercase kebab-case', () => {
    expect(createTagSlug('Work Projects')).toBe('work-projects');
  });

  it('removes special characters', () => {
    expect(createTagSlug('Important!')).toBe('important');
    expect(createTagSlug('$$$Money$$$')).toBe('money');
  });

  it('collapses multiple separators into one', () => {
    expect(createTagSlug('Too   Many   Spaces')).toBe('too-many-spaces');
    expect(createTagSlug('Mixed---Separators')).toBe('mixed-separators');
  });

  it('trims leading and trailing dashes', () => {
    expect(createTagSlug('---leading')).toBe('leading');
    expect(createTagSlug('trailing---')).toBe('trailing');
    expect(createTagSlug('---both---')).toBe('both');
  });

  it('handles edge cases', () => {
    expect(createTagSlug('')).toBe('');
    expect(createTagSlug('a')).toBe('a');
    expect(createTagSlug('ABC123')).toBe('abc123');
  });
});

describe('extractDomain', () => {
  it('extracts domain from email address', () => {
    expect(extractDomain('user@example.com')).toBe('example.com');
    expect(extractDomain('alice@company.co.uk')).toBe('company.co.uk');
  });

  it('returns "unknown" for invalid emails', () => {
    expect(extractDomain('no-at-sign')).toBe('unknown');
    expect(extractDomain('')).toBe('unknown');
  });

  it('handles edge cases', () => {
    expect(extractDomain('@domain.com')).toBe('domain.com');
    expect(extractDomain('user@')).toBe('unknown'); // empty domain treated as invalid
  });
});

describe('extractSubjectPattern', () => {
  it('detects multiple reply pattern', () => {
    expect(extractSubjectPattern('RE: RE: RE: Meeting')).toBe('RE: RE: RE:*');
    expect(extractSubjectPattern('Re: Re: Hello')).toBe('RE: RE: RE:*');
  });

  it('detects multiple forward pattern', () => {
    expect(extractSubjectPattern('FW: FW: FW: Document')).toBe('FW: FW: FW:*');
    expect(extractSubjectPattern('Fw: Fw: Report')).toBe('FW: FW: FW:*');
  });

  it('detects mailing list prefix pattern', () => {
    expect(extractSubjectPattern('[dev-team] Weekly update')).toBe('[list]*');
    expect(extractSubjectPattern('[JIRA] Issue assigned')).toBe('[list]*');
  });

  it('detects periodic digest pattern', () => {
    expect(extractSubjectPattern('Weekly Report Summary')).toBe('periodic digest');
    expect(extractSubjectPattern('Daily Digest')).toBe('periodic digest');
    expect(extractSubjectPattern('Monthly Newsletter')).toBe('periodic digest');
  });

  it('detects digest prefix pattern', () => {
    expect(extractSubjectPattern('Digest: Your daily updates')).toBe('digest:*');
  });

  it('detects newsletter pattern', () => {
    expect(extractSubjectPattern('Newsletter: Latest news')).toBe('newsletter*');
  });

  it('returns null for normal subjects', () => {
    expect(extractSubjectPattern('Hello from Alice')).toBeNull();
    expect(extractSubjectPattern('RE: Single reply')).toBeNull();
    expect(extractSubjectPattern('Meeting tomorrow')).toBeNull();
  });
});

describe('formatSender', () => {
  it('returns name when present', () => {
    expect(formatSender({ address: 'alice@example.com', name: 'Alice Smith' })).toBe('Alice Smith');
  });

  it('returns address when name is null', () => {
    expect(formatSender({ address: 'alice@example.com', name: null })).toBe('alice@example.com');
  });

  it('returns address when name is empty string', () => {
    expect(formatSender({ address: 'alice@example.com', name: '' })).toBe('alice@example.com');
  });
});

describe('isRecent', () => {
  it('returns true for dates within default 24 hours', () => {
    const oneHourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000);
    expect(isRecent(oneHourAgo)).toBe(true);
  });

  it('returns false for dates older than 24 hours', () => {
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
    expect(isRecent(twoDaysAgo)).toBe(false);
  });

  it('respects custom hoursAgo parameter', () => {
    const tenHoursAgo = new Date(Date.now() - 10 * 60 * 60 * 1000);
    expect(isRecent(tenHoursAgo, 12)).toBe(true);
    expect(isRecent(tenHoursAgo, 8)).toBe(false);
  });

  it('returns true for future dates', () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    expect(isRecent(tomorrow)).toBe(true);
  });

  it('handles boundary conditions', () => {
    const exactlyAt24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);
    expect(isRecent(exactlyAt24Hours)).toBe(false);
  });
});
