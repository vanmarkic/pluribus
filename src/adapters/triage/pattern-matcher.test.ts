import { describe, it, expect } from 'vitest';
import { createPatternMatcher } from './pattern-matcher';
import type { Email } from '../../core/domain';

const baseEmail: Email = {
  id: 1,
  messageId: 'test@example.com',
  accountId: 1,
  folderId: 1,
  uid: 1,
  subject: 'Test',
  from: { address: 'test@example.com', name: 'Test' },
  to: ['user@example.com'],
  date: new Date(),
  snippet: '',
  sizeBytes: 1000,
  isRead: false,
  isStarred: false,
  hasAttachments: false,
  bodyFetched: false,
};

describe('PatternMatcher', () => {
  const matcher = createPatternMatcher();

  it('detects 2FA codes', () => {
    const email = { ...baseEmail, subject: 'Your verification code is 123456' };
    const result = matcher.match(email);
    expect(result.folder).toBe('INBOX');
    expect(result.autoDeleteAfter).toBe(15);
    expect(result.tags).toContain('2fa');
  });

  it('detects shipping notifications', () => {
    const email = { ...baseEmail, subject: 'Your package has shipped', from: { address: 'shipments@amazon.com', name: 'Amazon' } };
    const result = matcher.match(email);
    expect(result.folder).toBe('INBOX');
    expect(result.tags).toContain('shipping');
  });

  it('detects invoices', () => {
    const email = { ...baseEmail, subject: 'Your receipt from Apple' };
    const result = matcher.match(email);
    expect(result.folder).toBe('Paper-Trail/Invoices');
  });

  it('detects LinkedIn DMs -> INBOX', () => {
    const email = { ...baseEmail, subject: 'John sent you a message', from: { address: 'notifications@linkedin.com', name: 'LinkedIn' } };
    const result = matcher.match(email);
    expect(result.folder).toBe('INBOX');
    expect(result.tags).toContain('social-dm');
  });

  it('detects LinkedIn notifications -> Social', () => {
    const email = { ...baseEmail, subject: 'You appeared in 3 searches', from: { address: 'notifications@linkedin.com', name: 'LinkedIn' } };
    const result = matcher.match(email);
    expect(result.folder).toBe('Social');
  });

  it('detects newsletters', () => {
    const email = { ...baseEmail, subject: 'Weekly digest from Substack' };
    const result = matcher.match(email);
    expect(result.folder).toBe('Feed');
  });

  it('detects promotions', () => {
    const email = { ...baseEmail, subject: '50% off this weekend only!' };
    const result = matcher.match(email);
    expect(result.folder).toBe('Promotions');
  });

  it('defaults to INBOX for unknown patterns', () => {
    const email = { ...baseEmail, subject: 'Meeting tomorrow', from: { address: 'boss@company.com', name: 'Boss' } };
    const result = matcher.match(email);
    expect(result.folder).toBe('INBOX');
    expect(result.confidence).toBeLessThan(0.5);
  });

  it('detects travel bookings', () => {
    const email = { ...baseEmail, subject: 'Your flight booking confirmation' };
    const result = matcher.match(email);
    expect(result.folder).toBe('Paper-Trail/Travel');
    expect(result.tags).toContain('travel');
  });

  it('detects GitHub notifications', () => {
    const email = { ...baseEmail, subject: '[github] New pull request', from: { address: 'notifications@github.com', name: 'GitHub' } };
    const result = matcher.match(email);
    expect(result.folder).toBe('INBOX');
    expect(result.tags).toContain('dev');
    expect(result.autoDeleteAfter).toBe(30 * 24 * 60); // 30 days in minutes
  });
});
