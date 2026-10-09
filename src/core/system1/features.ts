/**
 * Scalar features that ride alongside the sentence embedding.
 *
 * The embedding captures what the mail says; these capture how it reached
 * us: bulk mail markers, whether we are addressed directly, threading, the
 * wording of the subject (French and English) and how often the user has
 * answered this sender before. The sender domain is hashed into a fixed
 * number of buckets (stable FNV-1a) so heads never need a vocabulary.
 *
 * Every value is in [0, 1].
 */

import type { Email } from '../domain';
import { quickCheck } from '../usecases/awaiting';
import type { System1Input } from './types';

export const DOMAIN_BUCKETS = 64;

const SCALAR_FEATURES = [
  'hasListUnsubscribe',
  'toIncludesMe',
  'isReply',
  'subjectHasQuestion',
  'priorReplies',
] as const;

export const FEATURE_NAMES: string[] = [
  ...SCALAR_FEATURES,
  ...Array.from({ length: DOMAIN_BUCKETS }, (_, i) => `senderDomain#${i}`),
];

export type FeatureEmail = Pick<Email, 'from' | 'to' | 'subject' | 'inReplyTo' | 'listUnsubscribe'>;

export type FeatureContext = {
  /** The account's own address (compared case-insensitively). */
  myAddress: string;
  /** How many times the user already wrote to this sender. */
  priorRepliesToSender: number;
};

/** UTF-8 bytes of a string (lone surrogates become U+FFFD), without platform APIs. */
function utf8Bytes(text: string): number[] {
  const bytes: number[] = [];
  for (const char of text) {
    let cp = char.codePointAt(0)!;
    if (cp >= 0xd800 && cp <= 0xdfff) cp = 0xfffd;
    if (cp < 0x80) {
      bytes.push(cp);
    } else if (cp < 0x800) {
      bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    } else if (cp < 0x10000) {
      bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      bytes.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
    }
  }
  return bytes;
}

/** 32-bit FNV-1a over the UTF-8 bytes of `text`. Unsigned. */
export function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (const byte of utf8Bytes(text)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function domainBucket(domain: string): number {
  return fnv1a32(domain.trim().toLowerCase()) % DOMAIN_BUCKETS;
}

/** Bare, lowercased address from `a@b.c` or `Name <a@b.c>`. */
function bareAddress(value: string): string {
  const angle = /<([^<>]*)>/.exec(value);
  return (angle?.[1] ?? value).trim().toLowerCase();
}

function senderDomain(address: string): string {
  const at = address.lastIndexOf('@');
  if (at < 0) return '';
  const domain = address.slice(at + 1);
  return domain.trim().toLowerCase();
}

const REPLY_PREFIX = /^\s*re\s*:/i;

export function buildFeatures(email: FeatureEmail, ctx: FeatureContext): number[] {
  const me = bareAddress(ctx.myAddress);
  const toIncludesMe = me !== '' && email.to.some((recipient) => bareAddress(recipient) === me);

  const hasListUnsubscribe = Boolean(email.listUnsubscribe?.trim());
  const isReply = Boolean(email.inReplyTo?.trim()) || REPLY_PREFIX.test(email.subject);
  const subjectHasQuestion = quickCheck(email.subject) === true;

  const prior = Number.isFinite(ctx.priorRepliesToSender)
    ? Math.max(0, ctx.priorRepliesToSender)
    : 0;
  const priorReplies = Math.min(1, Math.log1p(prior) / 3);

  const features = new Array<number>(FEATURE_NAMES.length).fill(0);
  features[0] = hasListUnsubscribe ? 1 : 0;
  features[1] = toIncludesMe ? 1 : 0;
  features[2] = isReply ? 1 : 0;
  features[3] = subjectHasQuestion ? 1 : 0;
  features[4] = priorReplies;

  const domain = senderDomain(email.from.address);
  if (domain) features[SCALAR_FEATURES.length + domainBucket(domain)] = 1;
  return features;
}

export function buildInput(embedding: Float32Array, features: number[]): System1Input {
  return { embedding, features };
}
