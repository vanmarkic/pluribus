import type { Email, ClassificationState, ClassificationStats, ClassificationFeedback, ConfusedPattern, Classification } from '../../../core/domain';

/**
 * ReviewItem type - matches backend PendingReviewItem exactly.
 *
 * Backend returns: ClassificationState & { email: Email }
 * - ClassificationState fields are at top level (emailId, status, confidence, suggestedFolder, etc.)
 * - email property contains the full Email object
 *
 * Note: ClassificationState has NO `id` field - use `emailId` as the identifier.
 */
export type ReviewItem = ClassificationState & {
  email: Email;
};

// Re-export for convenience
// Tag removed - using folders for organization (Issue #54)
export type { ClassificationStats as AIStats, ClassificationFeedback, ConfusedPattern, Classification };
