/**
 * Enhanced Triage Classifier with Vector Search
 * 
 * Integrates semantic similarity search to improve classification.
 * Flow: Pattern matching → Vector similarity → LLM validation
 */

import type { TriageClassifier, PatternMatchResult, VectorSearch } from '../../core/ports';
import type { Email, TrainingExample, TriageClassificationResult, TriageFolder, SimilarEmail } from '../../core/domain';
import { prepareEmailForEmbedding } from '../embeddings/vector-search';

/** Number of similar emails to retrieve for context */
const TOP_SIMILAR_EMAILS = 5;

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

export function buildEnhancedTriagePrompt(
  email: Email,
  patternHint: PatternMatchResult,
  examples: TrainingExample[],
  similarEmails?: { folder: string; similarity: number; wasCorrection: boolean }[]
): string {
  let prompt = TRIAGE_PROMPT;

  // Add pattern hint
  prompt += `

PATTERN MATCHING HINT:
Our pattern matcher suggests: ${patternHint.folder} (confidence: ${patternHint.confidence.toFixed(2)})
Detected patterns: ${patternHint.tags.join(', ') || 'none'}`;

  // Add vector similarity results if available
  if (similarEmails && similarEmails.length > 0) {
    prompt += `

SIMILAR EMAILS (semantic search):`;
    for (const sim of similarEmails) {
      const correctionMark = sim.wasCorrection ? ' [USER CORRECTION]' : '';
      prompt += `
• ${sim.folder} (similarity: ${sim.similarity.toFixed(2)})${correctionMark}`;
    }

    // Calculate suggested folder from similarities
    const folderVotes: Record<string, number> = {};
    for (const sim of similarEmails) {
      const weight = sim.similarity * (sim.wasCorrection ? 2.0 : 1.0);
      folderVotes[sim.folder] = (folderVotes[sim.folder] || 0) + weight;
    }
    const topFolder = Object.entries(folderVotes).sort(([, a], [, b]) => b - a)[0];
    if (topFolder) {
      prompt += `

SIMILARITY SUGGESTION: ${topFolder[0]} (based on past similar emails)`;
    }
  }

  prompt += `

Your job: VALIDATE or OVERRIDE suggestions based on email content and context.
- Consider pattern hints, similar emails, and user preferences
- If pattern seems correct, confirm it with your reasoning
- If context suggests otherwise (spam disguised as invoice, etc.), override it
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
Snippet: ${email.snippet.substring(0, 200)}

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

/**
 * Create enhanced triage classifier with vector search.
 * 
 * Classification flow:
 * 1. Pattern matching (fast, rule-based)
 * 2. Vector similarity search (semantic matching)
 * 3. LLM validation (final authority)
 * 
 * Benefits:
 * - Faster: High-confidence vector matches can skip LLM
 * - Smarter: LLM sees similar past examples
 * - Learning: User corrections immediately improve future classifications
 */
export function createEnhancedTriageClassifier(
  llmClient: LLMClient,
  vectorSearch?: VectorSearch
): TriageClassifier {
  return {
    async classify(
      email: Email,
      patternHint: PatternMatchResult,
      examples: TrainingExample[]
    ): Promise<TriageClassificationResult> {
      let similarEmails: { folder: string; similarity: number; wasCorrection: boolean }[] | undefined;
      let vectorConfidence: { folder: string; confidence: number } | null = null;

      // Try vector similarity search if available
      if (vectorSearch) {
        try {
          const emailText = prepareEmailForEmbedding(email);
          const similar = await vectorSearch.findSimilar(emailText, TOP_SIMILAR_EMAILS, email.accountId);
          
          if (similar.length > 0) {
            similarEmails = similar.map(s => ({
              folder: s.folder,
              similarity: s.similarity,
              wasCorrection: s.wasCorrection,
            }));

            vectorConfidence = vectorSearch.calculateConfidence(similar);
          }
        } catch (error) {
          // Vector search failed, continue with LLM only
          console.warn('Vector search failed:', error);
        }
      }

      // Build prompt with all available context
      const prompt = buildEnhancedTriagePrompt(email, patternHint, examples, similarEmails);

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
        // LLM failed - use best available hint
        const fallbackFolder = vectorConfidence?.folder || patternHint.folder || 'Review';
        const fallbackConfidence = vectorConfidence?.confidence || patternHint.confidence || 0;

        return {
          folder: fallbackConfidence > 0.6 ? (fallbackFolder as TriageFolder) : 'Review',
          tags: patternHint.tags,
          confidence: fallbackConfidence,
          patternHint: patternHint.folder,
          patternAgreed: false,
          reasoning: `LLM error: ${error instanceof Error ? error.message : 'unknown'}. Using ${vectorConfidence ? 'vector similarity' : 'pattern'} fallback.`,
        };
      }
    },
  };
}
