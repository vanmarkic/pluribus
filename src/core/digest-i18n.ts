/**
 * Digest strings (notification + email to self), in English and French.
 *
 * Only the digest is localized; the in-app UI stays English. The locale follows
 * the system language: French for any `fr`, `fr-BE`, `fr_FR`... tag, English
 * for everything else (including no tag at all).
 *
 * Pure and dependency-free. Nothing here ever sees a mail body: reason lines
 * are built from structured fields (basis, signal source), never from text.
 */

import type { ForgottenReply, ImportanceLevel } from './domain';

export type DigestLocale = 'fr' | 'en';

/** French for `fr`, `fr-BE`, `fr_FR`, `FR-ch`...; English otherwise. */
export function resolveDigestLocale(tag: string | null | undefined): DigestLocale {
  return typeof tag === 'string' && /^fr([-_]|$)/i.test(tag.trim()) ? 'fr' : 'en';
}

/** The part of an item the reason line is built from. */
export type ReasonInput = Pick<ForgottenReply, 'basis' | 'signalSource'>;

export type DigestStrings = {
  /** `<html lang>` of the email. */
  htmlLang: DigestLocale;
  /** Prefix of the subject on a "send test digest" run. */
  testPrefix: string;
  notificationTitle: string;
  /** "3 emails are waiting for your reply" (never includes any mail content). */
  notificationCount: (count: number) => string;
  emailSubject: (count: number) => string;
  /** Heading above the list: "Needs your reply (3)". */
  heading: (count: number) => string;
  empty: string;
  noSubject: string;
  footer: string;
  importance: Record<ImportanceLevel, string>;
  /** "3 days ago" / "il y a 3 jours" from whole hours. */
  age: (hours: number) => string;
  /** Why the mail is listed; does not repeat the age or the importance label. */
  reason: (item: ReasonInput) => string;
};

const HOURS_PER_DAY = 24;

const en: DigestStrings = {
  htmlLang: 'en',
  testPrefix: '[test]',
  notificationTitle: 'Needs your reply',
  notificationCount: (n) =>
    n === 0
      ? 'No emails are waiting for your reply'
      : n === 1
        ? '1 email is waiting for your reply'
        : `${n} emails are waiting for your reply`,
  emailSubject: (n) =>
    n === 0
      ? '[Pluribus] No emails need your reply'
      : n === 1
        ? '[Pluribus] 1 email needs your reply'
        : `[Pluribus] ${n} emails need your reply`,
  heading: (n) => `Needs your reply (${n})`,
  empty: 'No emails are waiting for your reply.',
  noSubject: '(no subject)',
  footer: 'Generated on your device by Pluribus. Turn off in Settings → Daily digest.',
  importance: { 1: 'Low', 2: 'Normal', 3: 'Important', 4: 'Critical' },
  age: (hours) => {
    if (hours < 1) return 'less than an hour ago';
    if (hours < HOURS_PER_DAY) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
    const days = Math.floor(hours / HOURS_PER_DAY);
    return `${days} ${days === 1 ? 'day' : 'days'} ago`;
  },
  reason: ({ basis, signalSource }) => {
    if (basis === 'heuristic') return 'Looks like a question for you';
    switch (signalSource) {
      case 'user':
        return 'You marked this as needing a reply';
      case 'system1':
        return 'Flagged by the on-device model';
      default:
        return 'Flagged by the AI model';
    }
  },
};

const fr: DigestStrings = {
  htmlLang: 'fr',
  testPrefix: '[test]',
  notificationTitle: 'Réponses en attente',
  notificationCount: (n) =>
    n === 0
      ? 'Aucun e-mail n’attend votre réponse'
      : n === 1
        ? '1 e-mail attend votre réponse'
        : `${n} e-mails attendent votre réponse`,
  emailSubject: (n) =>
    n === 0
      ? '[Pluribus] Aucun e-mail n’attend votre réponse'
      : n === 1
        ? '[Pluribus] 1 e-mail attend votre réponse'
        : `[Pluribus] ${n} e-mails attendent votre réponse`,
  heading: (n) => `Réponses en attente (${n})`,
  empty: 'Aucun e-mail n’attend votre réponse.',
  noSubject: '(sans objet)',
  // The app itself is in English, so the menu names are quoted as they appear there.
  footer: 'Généré sur votre appareil par Pluribus. Pour le désactiver : Settings → Daily digest.',
  importance: { 1: 'Faible', 2: 'Normal', 3: 'Important', 4: 'Critique' },
  age: (hours) => {
    if (hours < 1) return 'il y a moins d’une heure';
    if (hours < HOURS_PER_DAY) return `il y a ${hours} ${hours === 1 ? 'heure' : 'heures'}`;
    const days = Math.floor(hours / HOURS_PER_DAY);
    return `il y a ${days} ${days === 1 ? 'jour' : 'jours'}`;
  },
  reason: ({ basis, signalSource }) => {
    if (basis === 'heuristic') return 'Ressemble à une question qui vous est posée';
    switch (signalSource) {
      case 'user':
        return 'Vous l’avez marqué comme à traiter';
      case 'system1':
        return 'Repéré par le modèle sur l’appareil';
      default:
        return 'Repéré par le modèle d’IA';
    }
  },
};

const TABLES: Record<DigestLocale, DigestStrings> = { en, fr };

export function digestStrings(locale: DigestLocale): DigestStrings {
  return TABLES[locale];
}
