/**
 * Use Cases Index
 *
 * Re-exports all use cases from their domain-specific modules.
 * This allows importing from a single location while maintaining modular structure.
 */

// Email use cases
export * from './email-usecases';

// Sync use cases
export * from './sync-usecases';

// Classification use cases (includes LLM provider, background tasks, AI sort)
export * from './classification-usecases';

// Account use cases (includes send use cases)
export * from './account-usecases';

// Draft use cases
export * from './draft-usecases';

// Contact use cases
export * from './contact-usecases';

// Database use cases
export * from './database-usecases';

// Triage use cases
export * from './triage-usecases';
