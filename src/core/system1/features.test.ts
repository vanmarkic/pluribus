import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  DOMAIN_BUCKETS,
  FEATURE_NAMES,
  buildFeatures,
  buildInput,
  domainBucket,
  fnv1a32,
} from './features';

type FeatureEmail = Parameters<typeof buildFeatures>[0];

function email(overrides: Partial<FeatureEmail> = {}): FeatureEmail {
  return {
    from: { address: 'marie@atelier-bois.be', name: 'Marie' },
    to: ['me@example.com'],
    subject: 'Devis',
    inReplyTo: null,
    listUnsubscribe: null,
    ...overrides,
  };
}

const ctx = { myAddress: 'me@example.com', priorRepliesToSender: 0 };

function named(features: number[]): Record<string, number> {
  return Object.fromEntries(FEATURE_NAMES.map((name, i) => [name, features[i]!]));
}

describe('fnv1a32', () => {
  it('matches the reference FNV-1a vectors', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5);
    expect(fnv1a32('a')).toBe(0xe40c292c);
    expect(fnv1a32('foobar')).toBe(0xbf9cf968);
  });

  it('is stable, unsigned and handles non-ASCII input', () => {
    expect(fnv1a32('société.fr')).toBe(fnv1a32('société.fr'));
    expect(fnv1a32('société.fr')).toBeGreaterThanOrEqual(0);
    expect(fnv1a32('société.fr')).toBeLessThan(2 ** 32);
  });
});

describe('domainBucket', () => {
  it('is stable across calls, case-insensitive and within range', () => {
    expect(domainBucket('Atelier-Bois.be')).toBe(domainBucket('atelier-bois.be'));
    expect(domainBucket('atelier-bois.be')).toBe(fnv1a32('atelier-bois.be') % DOMAIN_BUCKETS);
    expect(DOMAIN_BUCKETS).toBe(64);
  });

  it('spreads typical domains over several buckets', () => {
    const domains = ['gmail.com', 'proximus.be', 'sncb.be', 'amazon.fr', 'ovh.com', 'free.fr'];
    expect(new Set(domains.map(domainBucket)).size).toBeGreaterThanOrEqual(4);
  });
});

describe('buildFeatures', () => {
  it('has one value per feature name', () => {
    const f = buildFeatures(email(), ctx);
    expect(f).toHaveLength(FEATURE_NAMES.length);
    expect(new Set(FEATURE_NAMES).size).toBe(FEATURE_NAMES.length);
    expect(FEATURE_NAMES.length).toBe(5 + DOMAIN_BUCKETS);
  });

  it('flags list-unsubscribe mail', () => {
    expect(named(buildFeatures(email(), ctx))['hasListUnsubscribe']).toBe(0);
    expect(
      named(buildFeatures(email({ listUnsubscribe: '<mailto:u@x.com>' }), ctx))[
        'hasListUnsubscribe'
      ],
    ).toBe(1);
    expect(named(buildFeatures(email({ listUnsubscribe: '' }), ctx))['hasListUnsubscribe']).toBe(0);
  });

  it('detects the user among recipients case-insensitively', () => {
    const toMe = (to: string[], my = 'me@example.com') =>
      named(buildFeatures(email({ to }), { ...ctx, myAddress: my }))['toIncludesMe'];
    expect(toMe(['someone@else.com', 'ME@Example.COM'])).toBe(1);
    expect(toMe(['me@example.com'], 'Me@EXAMPLE.com')).toBe(1);
    expect(toMe(['Moi <Me@Example.com>'])).toBe(1);
    expect(toMe(['someone@else.com'])).toBe(0);
    expect(toMe([])).toBe(0);
    // An empty own-address must never match an empty recipient.
    expect(toMe([''], '')).toBe(0);
    // No substring matches: me@example.com is not xme@example.com.
    expect(toMe(['xme@example.com'])).toBe(0);
  });

  it('flags replies by In-Reply-To or a Re: subject', () => {
    const isReply = (e: Partial<FeatureEmail>) => named(buildFeatures(email(e), ctx))['isReply'];
    expect(isReply({})).toBe(0);
    expect(isReply({ inReplyTo: '<abc@x.com>' })).toBe(1);
    expect(isReply({ subject: 'Re: Devis' })).toBe(1);
    expect(isReply({ subject: 'RE : Devis' })).toBe(1);
    expect(isReply({ subject: 'Rendez-vous' })).toBe(0);
  });

  it('detects questions in French and English, with or without a question mark', () => {
    const q = (subject: string) =>
      named(buildFeatures(email({ subject }), ctx))['subjectHasQuestion'];
    expect(q('Tu peux venir demain ?')).toBe(1);
    expect(q('Pourriez-vous me confirmer la date de livraison')).toBe(1);
    expect(q('Merci de me confirmer votre présence à la réunion')).toBe(1);
    expect(q('Quand pouvons-nous planifier un rendez-vous pour le dossier')).toBe(1);
    expect(q('Do you have a minute to look at the draft contract for next week')).toBe(1);
    expect(q('Votre facture du mois de septembre est disponible')).toBe(0);
    expect(q('Newsletter')).toBe(0);
    expect(q('')).toBe(0);
  });

  it('scales prior replies with log1p / 3 and saturates at 1', () => {
    const prior = (n: number) =>
      named(buildFeatures(email(), { ...ctx, priorRepliesToSender: n }))['priorReplies']!;
    expect(prior(0)).toBe(0);
    expect(prior(1)).toBeCloseTo(Math.log1p(1) / 3, 12);
    expect(prior(5)).toBeGreaterThan(prior(1));
    expect(prior(10_000)).toBe(1);
    expect(prior(-4)).toBe(0);
    expect(prior(Number.NaN)).toBe(0);
  });

  it('sets exactly one domain bucket, and none without a domain', () => {
    const f = buildFeatures(email({ from: { address: 'x@Proximus.be', name: null } }), ctx);
    const buckets = f.slice(5);
    expect(buckets.filter((v) => v === 1)).toHaveLength(1);
    expect(buckets[domainBucket('proximus.be')]).toBe(1);
    expect(buckets.every((v) => v === 0 || v === 1)).toBe(true);

    const none = buildFeatures(email({ from: { address: 'not-an-address', name: null } }), ctx);
    expect(none.slice(5).every((v) => v === 0)).toBe(true);
  });

  it('is deterministic and puts the same domain in the same bucket for different senders', () => {
    const a = buildFeatures(email({ from: { address: 'a@sncb.be', name: null } }), ctx);
    const b = buildFeatures(email({ from: { address: 'b@SNCB.BE', name: 'B' } }), ctx);
    expect(a.slice(5)).toEqual(b.slice(5));
    expect(buildFeatures(email(), ctx)).toEqual(buildFeatures(email(), ctx));
  });

  it('property: every value is finite and within [0, 1]', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.string(),
        fc.array(fc.string(), { maxLength: 4 }),
        fc.option(fc.string(), { nil: null }),
        fc.option(fc.string(), { nil: null }),
        fc.integer({ min: -5, max: 100_000 }),
        (address, subject, to, inReplyTo, listUnsubscribe, prior) => {
          const f = buildFeatures(
            { from: { address, name: null }, to, subject, inReplyTo, listUnsubscribe },
            { myAddress: 'me@example.com', priorRepliesToSender: prior },
          );
          expect(f).toHaveLength(FEATURE_NAMES.length);
          expect(f.every((v) => Number.isFinite(v) && v >= 0 && v <= 1)).toBe(true);
        },
      ),
      { numRuns: 200, seed: 20261009 },
    );
  });
});

describe('buildInput', () => {
  it('pairs the embedding with the features', () => {
    const embedding = Float32Array.from([0.1, 0.2]);
    const features = buildFeatures(email(), ctx);
    const input = buildInput(embedding, features);
    expect(input.embedding).toBe(embedding);
    expect(input.features).toEqual(features);
  });
});
