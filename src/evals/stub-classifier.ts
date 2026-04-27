/**
 * Rule-based stub classifier (#92).
 *
 * Lets the eval harness run in CI with zero API credits. Order matters —
 * more-specific rules first. This is deliberately a lousy baseline: its
 * job is to prove the harness works end-to-end and to be the floor any
 * real classifier must beat.
 */

import type { TriageFolder } from '../core/domain';
import type { EvalEntry, EvalClassifier } from './types';

type Rule = {
  folder: TriageFolder;
  // Function returns > 0 score if the rule matches; higher = more confident.
  score: (entry: EvalEntry, text: string) => number;
};

const RULES: Rule[] = [
  {
    folder: 'Archive',
    score: (_, t) =>
      /\b(verification code|2fa|\[resolved\]|no action required)\b/i.test(t) ? 0.8 : 0,
  },
  {
    folder: 'Paper-Trail/Invoices',
    score: (_, t) =>
      /\b(invoice|receipt|payment confirmation|bill for|charges for|VAT receipt|payment method|total charges)\b/i.test(t) ? 0.85 : 0,
  },
  {
    folder: 'Paper-Trail/Travel',
    score: (_, t) =>
      /\b(booking confirmation|e-?ticket|flight|hotel reservation|check-?in|itinerary|trip to|reservation confirmation)\b/i.test(t) ? 0.8 : 0,
  },
  {
    folder: 'Paper-Trail/Admin',
    score: (_, t) =>
      /\b(please sign|freelance agreement|contract|policy renewal|action required|fiscale|declaration|insurance)\b/i.test(t) ? 0.75 : 0,
  },
  {
    folder: 'Review',
    score: (e, t) => {
      if (/\breview requested\b|\brequest for review\b/i.test(t)) return 0.9;
      if (/\bcan you review|please review|comments? on\b/i.test(t)) return 0.75;
      // Shared-doc emails with an ask
      if (/\bdocument shared\b/i.test(e.subject) && /comments?|review|feedback/i.test(t)) return 0.7;
      return 0;
    },
  },
  {
    folder: 'Planning',
    score: (_, t) =>
      /\b(meeting|schedule|calendly|sprint planning|kickoff|retrospective|save the date|RSVP|calendar invite)\b/i.test(t) ? 0.75 : 0,
  },
  {
    folder: 'Promotions',
    score: (_, t) =>
      /\b(\d+\s*%\s*off|sale|discount|promo|offer ends|buy 1 get 1|free shipping|limited[- ]time|last chance|double miles|upgrade now and save)\b/i.test(t) ? 0.8 : 0,
  },
  {
    folder: 'Feed',
    score: (e, t) => {
      // Newsletter-y sender address is the strongest signal
      if (/^(digest|news|newsletter|editor|hello)@/i.test(e.from.address)) return 0.7;
      if (/\b(daily digest|weekly (digest|roundup)|unsubscribe|manage (your )?subscription|issue #\d+|top stories|curated)\b/i.test(t)) return 0.65;
      return 0;
    },
  },
  {
    folder: 'Social',
    score: (e, t) => {
      if (/^(notify|notifications|no-?reply)@(linkedin|twitter|github|meetup|facebook|instagram)/i.test(e.from.address)) return 0.8;
      if (/\bappeared in \d+ searches|new follower|commented on issue|new rsvp\b/i.test(t)) return 0.75;
      return 0;
    },
  },
];

export const STUB_CLASSIFIER: EvalClassifier = {
  label: 'rule-based-stub',
  async classify(entry: EvalEntry) {
    const started = Date.now();
    const text = `${entry.subject}\n${entry.body}`;

    let bestFolder: TriageFolder = 'INBOX';
    let bestScore = 0.3; // anything below this stays INBOX

    for (const rule of RULES) {
      const s = rule.score(entry, text);
      if (s > bestScore) {
        bestScore = s;
        bestFolder = rule.folder;
      }
    }

    // Simulate some realistic latency variance without actually sleeping,
    // otherwise CI runs become needlessly slow.
    const simLatency = 5 + ((entry.subject.length + entry.body.length) % 30);
    return {
      folder: bestFolder,
      confidence: bestScore,
      latencyMs: Math.max(1, Date.now() - started + simLatency),
      costUsd: 0,
    };
  },
};
