import type { PatternMatcher, PatternMatchResult } from '../../core/ports';
import type { Email, TriageFolder } from '../../core/domain';
import { TRIAGE_PATTERNS, SOCIAL_DOMAINS, DEV_DOMAINS } from '../../core/domain';

export function createPatternMatcher(): PatternMatcher {
  return {
    match(email: Email): PatternMatchResult {
      const subject = email.subject.toLowerCase();
      const fromDomain = extractDomain(email.from.address);
      const text = `${email.subject} ${email.from.address}`.toLowerCase();

      const tags: string[] = [];
      let folder: TriageFolder = 'INBOX';
      let confidence = 0.3;
      let snoozeUntil: Date | undefined;
      let autoDeleteAfter: number | undefined;

      // 2FA codes - highest priority
      if (TRIAGE_PATTERNS.twoFA.test(text)) {
        tags.push('2fa');
        folder = 'INBOX';
        confidence = 0.95;
        autoDeleteAfter = 15; // minutes
        return { folder, confidence, tags, autoDeleteAfter };
      }

      // Social DMs vs regular social notifications
      if (isSocialDomain(fromDomain)) {
        if (TRIAGE_PATTERNS.socialDM.test(text)) {
          tags.push('social-dm');
          folder = 'INBOX';
          confidence = 0.9;
        } else {
          tags.push('social');
          folder = 'Social';
          confidence = 0.85;
        }
        return { folder, confidence, tags };
      }

      // Dev notifications
      if (isDevDomain(fromDomain)) {
        tags.push('dev');
        folder = 'INBOX';
        confidence = 0.8;
        autoDeleteAfter = 30 * 24 * 60; // 30 days in minutes
        return { folder, confidence, tags, autoDeleteAfter };
      }

      // Shipping
      if (TRIAGE_PATTERNS.shipping.test(text)) {
        tags.push('shipping');
        folder = 'INBOX';
        confidence = 0.85;
        // Fallback snooze - 3 days
        snoozeUntil = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
        return { folder, confidence, tags, snoozeUntil };
      }

      // Invoices/Receipts
      if (TRIAGE_PATTERNS.invoice.test(text)) {
        tags.push('invoice');
        folder = 'Paper-Trail/Invoices';
        confidence = 0.85;
        return { folder, confidence, tags };
      }

      // Travel
      if (TRIAGE_PATTERNS.travel.test(text)) {
        tags.push('travel');
        folder = 'Paper-Trail/Travel';
        confidence = 0.85;
        return { folder, confidence, tags };
      }

      // Admin/Contracts
      if (TRIAGE_PATTERNS.admin.test(text)) {
        tags.push('admin');
        folder = 'Paper-Trail/Admin';
        confidence = 0.75;
        return { folder, confidence, tags };
      }

      // Newsletters
      if (TRIAGE_PATTERNS.newsletter.test(text)) {
        tags.push('newsletter');
        folder = 'Feed';
        confidence = 0.85;
        return { folder, confidence, tags };
      }

      // Promotions
      if (TRIAGE_PATTERNS.promo.test(text)) {
        tags.push('promo');
        folder = 'Promotions';
        confidence = 0.8;
        autoDeleteAfter = 7 * 24 * 60; // 7 days
        return { folder, confidence, tags, autoDeleteAfter };
      }

      // No pattern matched - default to INBOX with low confidence
      return { folder, confidence, tags };
    },
  };
}

function extractDomain(email: string): string {
  const match = email.match(/@([^>]+)/);
  return match ? match[1].toLowerCase() : '';
}

function isSocialDomain(domain: string): boolean {
  return SOCIAL_DOMAINS.some(d => domain.includes(d));
}

function isDevDomain(domain: string): boolean {
  return DEV_DOMAINS.some(d => domain.includes(d));
}
