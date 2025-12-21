/**
 * Awaiting Reply Use Cases
 *
 * Tracks sent emails that expect a reply.
 * Uses fast heuristics first, then LLM for ambiguous cases.
 */

import type { Email } from '../domain';
import type { AwaitingRepo, LLMGenerator } from '../ports';

type Deps = {
  awaiting: AwaitingRepo;
  llm: LLMGenerator;
};

// French question patterns (common question starters, often without ?)
const FRENCH_QUESTION_PATTERNS = [
  /\best-ce que\b/i,
  /\bqu['']est-ce que\b/i,
  /\bpourriez-vous\b/i,
  /\bpouvez-vous\b/i,
  /\bpourrait-on\b/i,
  /\bauriez-vous\b/i,
  /\bavez-vous\b/i,
  /\bmerci de\s+(me\s+)?(confirmer|répondre|revenir)/i,
  /\bdans l['']attente de votre (réponse|retour)/i,
  /\bj['']attends votre\b/i,
];

// French scheduling patterns (proposing times/meetings, expects confirmation)
const FRENCH_SCHEDULING_PATTERNS = [
  /\brendez[- ]?vous\b/i,                           // rendez-vous, rendez vous
  /\bon s['']appelle\b/i,                           // on s'appelle
  /\bnous pouvons nous appeler\b/i,                 // we can call each other
  /\bje suis (libre|disponible)\b/i,                // I'm free/available
  /\bquand (vous le souhaitez|tu veux)\b/i,         // when you want
  /\bà quelle heure\b/i,                            // at what time
  /\bproposer? (un|une|le|la)?\s*(rdv|rendez|créneau|horaire)\b/i,
];

// English question/request patterns
const ENGLISH_QUESTION_PATTERNS = [
  /\bdo you (have|know|think)\b/i,
  /\bare you (able|available|free)\b/i,
  /\bwhat (do you|are your|is your)\b/i,
  /\bwhen (can|will|would) you\b/i,
  /\bhow (do|can|should) (I|we|you)\b/i,
  /\bI('d| would) (like|appreciate|need) (to know|your|a)\b/i,
  /\bI('m| am) (wondering|curious)\b/i,
];

// Patterns indicating NO reply expected (informational, FYI, notifications)
const NO_REPLY_EXPECTED_PATTERNS = [
  // English
  /\bjust a heads up\b/i,
  /\bjust wanted to let you know\b/i,
  /\bfor your information\b/i,
  /\bfyi\b/i,
  /\bno (action|reply|response) (needed|required|necessary)\b/i,
  /\bno need to (reply|respond)\b/i,
  /\bthis is (just )?to (inform|notify|let you know)\b/i,
  /\bi('ll| will) be out of (the )?office\b/i,
  // French
  /\bjuste pour (info|information)\b/i,
  /\bpour info\b/i,
  /\bpour votre information\b/i,
  /\baucune action\b.*\b(requise|nécessaire)\b/i,           // aucune action ... requise/nécessaire
  /\bpas besoin de répondre\b/i,
  /\bje vous informe\b/i,                                   // I'm informing you (formal)
  /\bceci est (un message|une notification) automatique\b/i,
];

// Common closing phrases that expect a reply (French + English)
const EXPECTING_REPLY_PATTERNS = [
  // English
  /\blooking forward to (hearing|your reply|your response)\b/i,
  /\bplease (let me know|confirm|reply|respond|get back|advise)\b/i,
  /\blet me know (if|what|when|how|your)\b/i,
  /\bget back to me\b/i,
  /\bawaiting your (reply|response|feedback|confirmation)\b/i,
  /\bhope to hear (from you|back)\b/i,
  /\bwould (love|like|appreciate) to (hear|get|know)\b/i,
  /\bany (thoughts|feedback|questions)\b/i,
  /\bcan you\b.*\?$/im,
  /\bcould you\b.*\?$/im,
  /\bwould you\b.*\?$/im,
];

/**
 * Fast heuristic check for questions/reply expectations.
 * Returns true if we're confident it expects a reply.
 * Returns false if we're confident it does NOT expect a reply.
 * Returns null if LLM should decide.
 */
function quickCheck(body: string): boolean | null {
  // First check: patterns that indicate NO reply expected
  // These take priority to avoid false positives
  for (const pattern of NO_REPLY_EXPECTED_PATTERNS) {
    if (pattern.test(body)) {
      return false;
    }
  }

  // Obvious: contains question mark
  if (body.includes('?')) {
    return true;
  }

  // French question patterns (don't always use ?)
  for (const pattern of FRENCH_QUESTION_PATTERNS) {
    if (pattern.test(body)) {
      return true;
    }
  }

  // French scheduling patterns (proposing times/meetings)
  for (const pattern of FRENCH_SCHEDULING_PATTERNS) {
    if (pattern.test(body)) {
      return true;
    }
  }

  // English question patterns
  for (const pattern of ENGLISH_QUESTION_PATTERNS) {
    if (pattern.test(body)) {
      return true;
    }
  }

  // Reply-expecting closing phrases (both languages)
  for (const pattern of EXPECTING_REPLY_PATTERNS) {
    if (pattern.test(body)) {
      return true;
    }
  }

  // If body is very short (likely just a thank you), skip LLM
  if (body.length < 50) {
    return false;
  }

  // Link-only emails (just sharing a URL) don't expect replies
  // Check if body is mostly a URL with minimal surrounding text
  const urlPattern = /https?:\/\/[^\s]+/g;
  const urls = body.match(urlPattern) || [];
  if (urls.length > 0) {
    const textWithoutUrls = body.replace(urlPattern, '').trim();
    // If remaining text is very short (just a title or nothing), it's link sharing
    if (textWithoutUrls.length < 60) {
      return false;
    }
  }

  // Can't determine quickly, need LLM
  return null;
}

/**
 * Determine if a sent email expects a reply.
 * Uses fast heuristics first, then LLM for ambiguous cases.
 */
export const shouldTrackAwaiting = (deps: Pick<Deps, 'llm'>) =>
  async (body: string): Promise<boolean> => {
    // Fast path: heuristic check
    const quickResult = quickCheck(body);
    if (quickResult !== null) {
      return quickResult;
    }

    // Slow path: LLM classification
    try {
      // Truncate to ~500 chars for efficiency
      const truncatedBody = body.length > 500 ? body.slice(0, 500) + '...' : body;

      const prompt = `Analyze this sent email and determine if it expects a reply from the recipient.

Consider:
- Questions (explicit or implicit, in any language)
- Requests for information, confirmation, or action
- Phrases indicating expectation of response

Email content:
"""
${truncatedBody}
"""

Answer with ONLY "yes" or "no" (lowercase, no explanation):`;

      const result = await deps.llm.generate(prompt);
      const answer = result.toLowerCase().trim();

      // Parse yes/no, default to false on ambiguous response
      return answer === 'yes' || answer.startsWith('yes');
    } catch (error) {
      console.error('[awaiting] LLM classification failed:', error);
      // On error, default to not tracking
      return false;
    }
  };

/**
 * Mark an email as awaiting reply.
 */
export const markAwaiting = (deps: Pick<Deps, 'awaiting'>) =>
  async (emailId: number): Promise<void> => {
    await deps.awaiting.markAwaiting(emailId);
  };

/**
 * Clear awaiting status from an email.
 */
export const clearAwaiting = (deps: Pick<Deps, 'awaiting'>) =>
  async (emailId: number): Promise<void> => {
    await deps.awaiting.clearAwaiting(emailId);
  };

/**
 * Clear awaiting status when a reply is received.
 * Called during sync when an email with in_reply_to header is found.
 * Returns the ID of the cleared email, or null if none found.
 */
export const clearAwaitingByReply = (deps: Pick<Deps, 'awaiting'>) =>
  async (inReplyToMessageId: string): Promise<number | null> => {
    return deps.awaiting.clearByReply(inReplyToMessageId);
  };

/**
 * Get list of emails awaiting reply for an account.
 */
export const getAwaitingList = (deps: Pick<Deps, 'awaiting'>) =>
  async (accountId: number): Promise<Email[]> => {
    return deps.awaiting.getAwaitingList(accountId);
  };

/**
 * Toggle awaiting status for an email.
 * Returns the new status (true = now awaiting, false = no longer awaiting).
 */
export const toggleAwaiting = (deps: Pick<Deps, 'awaiting'>) =>
  async (emailId: number): Promise<boolean> => {
    return deps.awaiting.toggleAwaiting(emailId);
  };
