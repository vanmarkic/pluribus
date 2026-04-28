import { describe, it, expect } from 'vitest';
import { scoreRiskTier } from './risk-tier';

const mk = (subject: string, address: string) => ({ subject, from: { address } });

describe('scoreRiskTier', () => {
  it('returns low for ordinary personal email', () => {
    expect(scoreRiskTier(mk('lunch friday?', 'friend@personal.com'))).toBe('low');
  });

  it('returns normal when only the subject is risk-bearing', () => {
    expect(scoreRiskTier(mk('Invoice INV-1234', 'randomservice@example.com'))).toBe('normal');
  });

  it('returns normal when only the sender is risk-bearing', () => {
    expect(scoreRiskTier(mk('hello', 'news@defence-example.com'))).toBe('normal');
  });

  it('returns high when both sender and subject are risk-bearing', () => {
    expect(scoreRiskTier(mk('Contract signed', 'alice@legal-example.com'))).toBe('high');
    expect(scoreRiskTier(mk('Payment received for invoice #42', 'billing@bank-example.com')))
      .toBe('high');
  });

  it('recognises French admin vocabulary', () => {
    expect(scoreRiskTier(mk('Déclaration fiscale', 'noreply@minfin-example.gov.be'))).toBe('high');
  });

  it('is case-insensitive on subjects', () => {
    expect(scoreRiskTier(mk('ACTION REQUIRED', 'x@notaire-example.fr'))).toBe('high');
  });
});
