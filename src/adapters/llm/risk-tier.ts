/**
 * Risk-tier scorer for extended-thinking routing (#90).
 *
 * Some emails are worth the extra latency and cost of a Sonnet 4.6 call
 * with a thinking budget — specifically anything that produces a
 * financial or legal paper trail, or anything from a sender associated
 * with defence / legal / financial contexts. Everything else stays on
 * the default Haiku path.
 *
 * Pure function; no side effects and no classifier deps so it can be
 * reused by the eval harness.
 */

import type { Email } from '../../core/domain';
import { extractDomain } from '../../core/domain';

export type RiskTier = 'low' | 'normal' | 'high';

// Domain fragments that imply defence / legal / financial context. Kept
// deliberately narrow to avoid upgrading every newsletter to Sonnet.
const HIGH_RISK_DOMAIN_FRAGMENTS = [
  'naval',
  'defence',
  'defense',
  'legal',
  'law',
  'bank',
  'tax',
  'finances',
  'treasury',
  'notaire',
  'gov',     // .gov TLDs and *.gov.be/fr/etc
];

const HIGH_RISK_SUBJECT_PATTERNS = [
  /\binvoice\b/i,
  /\breceipt\b/i,
  /\bcontract\b/i,
  /\bagreement\b/i,
  /\bNDA\b/,
  /\btax\b/i,
  /\bpayment (confirmation|received|due)\b/i,
  /\baction required\b/i,
  /\bdéclaration\b/i,
  /\bfiscale\b/i,
];

export function scoreRiskTier(email: { subject: string; from: { address: string } }): RiskTier {
  const domain = extractDomain(email.from.address).toLowerCase();
  const domainHit = HIGH_RISK_DOMAIN_FRAGMENTS.some(frag => domain.includes(frag));
  const subjectHit = HIGH_RISK_SUBJECT_PATTERNS.some(pattern => pattern.test(email.subject));

  if (domainHit && subjectHit) return 'high';
  if (domainHit || subjectHit) return 'normal';
  return 'low';
}

/**
 * Convenience wrapper — type-safe variant that takes a full Email object.
 */
export function scoreEmailRiskTier(email: Email): RiskTier {
  return scoreRiskTier({ subject: email.subject, from: email.from });
}
