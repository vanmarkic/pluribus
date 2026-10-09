/**
 * Canonical System 1 input text.
 *
 * Training vectors and inference vectors must come from exactly the same
 * text, or the heads learn one distribution and are asked about another.
 * Every place that embeds an email for System 1 goes through this function.
 *
 * The sender's domain (not the full address) is included because it carries
 * most of the routing signal without tying the vector to one person; the
 * body excerpt is optional because bodies are often not fetched yet.
 */

import type { Email } from '../domain';

/** Max characters of body excerpt that reach the encoder. */
export const SYSTEM1_BODY_CHARS = 600;

const collapse = (value: string): string => value.replace(/\s+/g, ' ').trim();

export function system1Text(email: Pick<Email, 'subject' | 'from'>, bodyPreview?: string): string {
  const domain = email.from.address.split('@')[1]?.toLowerCase() ?? '';
  const name = collapse(email.from.name ?? '');
  const sender = [name, domain && `<${domain}>`].filter(Boolean).join(' ');

  const lines = [`From: ${sender}`, `Subject: ${collapse(email.subject)}`];
  const body = bodyPreview ? collapse(bodyPreview).slice(0, SYSTEM1_BODY_CHARS) : '';
  if (body) lines.push('', body);
  return lines.join('\n');
}
