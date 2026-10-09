import { describe, it, expect } from 'vitest';
import { digestStrings, resolveDigestLocale, type DigestLocale } from './digest-i18n';
import type { ImportanceLevel } from './domain';

describe('resolveDigestLocale', () => {
  it.each([
    ['fr', 'fr'],
    ['fr-BE', 'fr'],
    ['fr-FR', 'fr'],
    ['fr_CH', 'fr'],
    ['FR', 'fr'],
    [' fr-CA ', 'fr'],
    ['en', 'en'],
    ['en-US', 'en'],
    ['de-DE', 'en'],
    ['es-ES', 'en'],
    ['', 'en'],
    ['   ', 'en'],
    // Not French: other languages whose tag merely starts with the same letters.
    ['fra', 'en'],
    ['frc', 'en'],
    ['fro-FR', 'en'],
  ] as const)('maps %j to %s', (tag, expected) => {
    expect(resolveDigestLocale(tag)).toBe(expected);
  });

  it('is English when there is no tag', () => {
    expect(resolveDigestLocale(undefined)).toBe('en');
    expect(resolveDigestLocale(null)).toBe('en');
  });
});

describe('digest strings', () => {
  const en = digestStrings('en');
  const fr = digestStrings('fr');

  it.each([
    [0, 'No emails are waiting for your reply', 'Aucun e-mail n’attend votre réponse'],
    [1, '1 email is waiting for your reply', '1 e-mail attend votre réponse'],
    [2, '2 emails are waiting for your reply', '2 e-mails attendent votre réponse'],
    [12, '12 emails are waiting for your reply', '12 e-mails attendent votre réponse'],
  ])('notification count for %i', (n, english, french) => {
    expect(en.notificationCount(n)).toBe(english);
    expect(fr.notificationCount(n)).toBe(french);
  });

  it.each([
    [0, '[Pluribus] No emails need your reply', '[Pluribus] Aucun e-mail n’attend votre réponse'],
    [1, '[Pluribus] 1 email needs your reply', '[Pluribus] 1 e-mail attend votre réponse'],
    [3, '[Pluribus] 3 emails need your reply', '[Pluribus] 3 e-mails attendent votre réponse'],
  ])('email subject for %i', (n, english, french) => {
    expect(en.emailSubject(n)).toBe(english);
    expect(fr.emailSubject(n)).toBe(french);
  });

  it('names the importance levels in each language', () => {
    const levels: ImportanceLevel[] = [1, 2, 3, 4];
    expect(levels.map((l) => en.importance[l])).toEqual(['Low', 'Normal', 'Important', 'Critical']);
    expect(levels.map((l) => fr.importance[l])).toEqual([
      'Faible',
      'Normal',
      'Important',
      'Critique',
    ]);
  });

  it.each([
    [0, 'less than an hour ago', 'il y a moins d’une heure'],
    [1, '1 hour ago', 'il y a 1 heure'],
    [5, '5 hours ago', 'il y a 5 heures'],
    [23, '23 hours ago', 'il y a 23 heures'],
    [24, '1 day ago', 'il y a 1 jour'],
    [47, '1 day ago', 'il y a 1 jour'],
    [96, '4 days ago', 'il y a 4 jours'],
  ])('age of %i hours', (hours, english, french) => {
    expect(en.age(hours)).toBe(english);
    expect(fr.age(hours)).toBe(french);
  });

  it('gives a different, non-empty reason for each way a mail can be flagged', () => {
    const cases = [
      { basis: 'heuristic', signalSource: null },
      { basis: 'signal', signalSource: 'user' },
      { basis: 'signal', signalSource: 'system1' },
      { basis: 'signal', signalSource: 'system2' },
    ] as const;
    for (const locale of ['en', 'fr'] as DigestLocale[]) {
      const reasons = cases.map((c) => digestStrings(locale).reason(c));
      expect(reasons.every((r) => r.length > 0)).toBe(true);
      expect(new Set(reasons).size).toBe(cases.length);
    }
  });

  it('never mentions importance or age inside the reason (they have their own columns)', () => {
    for (const locale of ['en', 'fr'] as DigestLocale[]) {
      const s = digestStrings(locale);
      for (const basis of ['heuristic', 'signal'] as const) {
        const reason = s.reason({ basis, signalSource: 'system2' });
        expect(reason).not.toMatch(/critical|important|critique|ago|il y a|jour|day/i);
      }
    }
  });

  it('exposes the html language of each table', () => {
    expect(en.htmlLang).toBe('en');
    expect(fr.htmlLang).toBe('fr');
  });

  it('has a complete table for every locale (same shape, no empty string)', () => {
    expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort());
    for (const s of [en, fr]) {
      for (const text of [
        s.testPrefix,
        s.notificationTitle,
        s.heading(2),
        s.empty,
        s.noSubject,
        s.footer,
      ]) {
        expect(text.length).toBeGreaterThan(0);
      }
    }
  });
});
