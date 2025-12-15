import type { Email, ClassificationState, ClassificationStats, ClassificationFeedback, ConfusedPattern, Tag, Classification } from '../../../core/domain';

/**
 * ReviewItem type - matches backend PendingReviewItem exactly.
 *
 * Backend returns: ClassificationState & { email: Email }
 * - ClassificationState fields are at top level (emailId, status, confidence, suggestedTags, etc.)
 * - email property contains the full Email object
 *
 * Note: ClassificationState has NO `id` field - use `emailId` as the identifier.
 */
export type ReviewItem = ClassificationState & {
  email: Email;
};

// Re-export for convenience
export type { ClassificationStats as AIStats, ClassificationFeedback, ConfusedPattern, Tag, Classification };
