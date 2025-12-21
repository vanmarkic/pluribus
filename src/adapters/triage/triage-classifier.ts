import type { TriageClassifier, PatternMatchResult } from '../../core/ports';
import type { Email, TrainingExample, TriageClassificationResult, TriageFolder } from '../../core/domain';

const TRIAGE_PROMPT = `You are an email triage assistant. Classify this email into ONE folder.

FOLDERS (user can drag-drop emails between these to correct you):
- INBOX: Urgent, actionable, important, requires response today
- Planning: Medium-term, "when you have time", no hard deadline
- Paper-Trail/Invoices: Receipts, invoices, payment confirmations
- Paper-Trail/Admin: Contracts, account info, legal, support tickets
- Paper-Trail/Travel: Flight/hotel bookings, itineraries
- Feed: Newsletters, curated content you want to read
- Social: Social media notifications (NOT direct messages)
- Promotions: Marketing, sales, discounts
- Archive: Done, no action needed, keep for reference

NOTE: If confidence < 0.7, email goes to Review for user triage.
Be honest about your confidence - uncertain classifications help the user.

USER CORRECTIONS: When the user drags an email to a different folder, their
correction is logged as training data. Pay special attention to USER PREFERENCES
below - these represent explicit corrections from this user.

SPECIAL RULES:
- Direct messages from social platforms → INBOX (human conversation)
- CC'd with no action required → Planning
- 2FA/security codes → INBOX (mark for auto-delete)
- Shipping updates → INBOX (mark for snooze until delivery)`;

export function buildTriagePrompt(
  email: Email,
  patternHint: PatternMatchResult,
  examples: TrainingExample[]
): string {
  let prompt = TRIAGE_PROMPT;

  // Add pattern hint
  prompt += `

PATTERN MATCHING HINT:
Our pattern matcher suggests: ${patternHint.folder} (confidence: ${patternHint.confidence.toFixed(2)})
Detected patterns: ${patternHint.tags.join(', ') || 'none'}

Your job: VALIDATE or OVERRIDE this suggestion based on email content and context.
- If pattern seems correct, confirm it with your reasoning
- If pattern missed context (spam disguised as invoice, etc.), override it
- You are the final authority`;

  // Add training examples
  if (examples.length > 0) {
    prompt += `

USER PREFERENCES (from training):`;
    for (const ex of examples) {
      if (ex.wasCorrection) {
        prompt += `
• ${ex.fromDomain}: AI suggested ${ex.aiSuggestion}, user corrected to ${ex.userChoice}`;
      } else {
        prompt += `
• ${ex.fromDomain}: ${ex.userChoice} ✓`;
      }
    }
  }

  // Add email details
  prompt += `

EMAIL:
From: ${email.from.name || ''} <${email.from.address}>
Subject: ${email.subject}
Date: ${email.date.toISOString()}

Respond with JSON only:
{
  "folder": "...",
  "tags": ["...", "..."],
  "confidence": 0.0-1.0,
  "snoozeUntil": "ISO date or null",
  "autoDeleteMinutes": number or null,
  "patternAgreed": true/false,
  "reasoning": "brief explanation"
}`;

  return prompt;
}

type LLMClient = {
  complete: (prompt: string) => Promise<string>;
};

export function createTriageClassifier(llmClient: LLMClient): TriageClassifier {
  return {
    async classify(
      email: Email,
      patternHint: PatternMatchResult,
      examples: TrainingExample[]
    ): Promise<TriageClassificationResult> {
      const prompt = buildTriagePrompt(email, patternHint, examples);

      try {
        const response = await llmClient.complete(prompt);
        const parsed = JSON.parse(response);

        return {
          folder: parsed.folder as TriageFolder,
          tags: parsed.tags || [],
          confidence: parsed.confidence,
          snoozeUntil: parsed.snoozeUntil ? new Date(parsed.snoozeUntil) : undefined,
          autoDeleteAfter: parsed.autoDeleteMinutes,
          patternHint: patternHint.folder,
          patternAgreed: parsed.patternAgreed,
          reasoning: parsed.reasoning,
        };
      } catch (error) {
        // LLM failed - return pattern hint with low confidence
        return {
          folder: 'Review',
          tags: patternHint.tags,
          confidence: 0,
          patternHint: patternHint.folder,
          patternAgreed: false,
          reasoning: `LLM error: ${error instanceof Error ? error.message : 'unknown'}`,
        };
      }
    },
  };
}
