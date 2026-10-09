/**
 * Body previews for the triage LLM
 *
 * A short excerpt of the message text helps the model judge "does this expect
 * a personal reply, and how much does it matter". Because it is body text it
 * is only gathered when the privacy settings allow it (local model, or the
 * user opted in to cloud excerpts), and only for mail that looks like it was
 * written by a person to the user.
 *
 * Everything here is best-effort: a failed or slow fetch just means "no
 * preview", never a failed classification.
 */

import type { Deps, LLMConfig } from '../ports';
import type { Email, EmailBody } from '../domain';
import { getEmailBody } from './email-usecases';

/** Maximum preview length in characters. */
export const BODY_PREVIEW_CHARS = 1000;

/** Give up on a single body fetch after this long. */
export const BODY_PREVIEW_TIMEOUT_MS = 8000;

/** Body previews leave the machine only for local models or with explicit opt-in. */
export function mayUseBodyPreview(config: Pick<LLMConfig, 'provider' | 'sendBodyExcerptsToCloud'>) {
  return config.provider === 'ollama' || config.sendBodyExcerptsToCloud === true;
}

/** Human mail: not a newsletter (no List-Unsubscribe) and not written by the user. */
export function isHumanCandidate(email: Email, accountEmail: string | null | undefined): boolean {
  if (email.listUnsubscribe) return false;
  if (accountEmail && email.from.address.toLowerCase() === accountEmail.toLowerCase()) return false;
  return true;
}

function stripHtml(html: string): string {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&');
}

/** Lines that introduce a quoted earlier message ("On Tue ... wrote:", "Le ... a écrit :"). */
const QUOTE_INTRO = /^(on .{5,200} wrote:|le .{5,200} a écrit\s?:)$/i;

/**
 * Reduce a message body to the part the sender actually wrote: no quoted
 * (`>`) lines, nothing after a signature delimiter or a quote introduction,
 * whitespace collapsed, at most {@link BODY_PREVIEW_CHARS} characters.
 */
export function makeBodyPreview(body: Pick<EmailBody, 'text' | 'html'>): string {
  const raw = body.text?.trim() ? body.text : stripHtml(body.html ?? '');
  const kept: string[] = [];
  for (const line of raw.replace(/\r\n?/g, '\n').split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '--' || trimmed === '-- ' || /^_{5,}$/.test(trimmed)) break; // signature
    if (QUOTE_INTRO.test(trimmed)) break;
    if (trimmed.startsWith('>')) continue;
    kept.push(trimmed);
  }
  return kept
    .join('\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, BODY_PREVIEW_CHARS);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Body fetch timed out')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/**
 * Preview for one email: the cached body when there is one, otherwise the
 * same IMAP fetch (and cache write) the "open email" use case performs.
 * Resolves to undefined on any failure, timeout or empty body.
 */
export const fetchBodyPreview =
  (deps: Pick<Deps, 'emails' | 'accounts' | 'sync'>) =>
  async (emailId: number, timeoutMs = BODY_PREVIEW_TIMEOUT_MS): Promise<string | undefined> => {
    try {
      const body = await withTimeout(getEmailBody(deps)(emailId), timeoutMs);
      const preview = makeBodyPreview(body);
      return preview === '' ? undefined : preview;
    } catch {
      return undefined;
    }
  };
