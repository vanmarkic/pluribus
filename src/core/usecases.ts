/**
 * Use Cases (Barrel Export)
 *
 * This file has been refactored to improve maintainability.
 * Use cases are now organized by domain in the ./usecases/ directory.
 *
 * This barrel file re-exports everything for backwards compatibility.
 * All existing imports will continue to work without changes.
 */

// Re-export all use cases from their domain modules
export * from './usecases/index';

// Re-export createUseCases factory and UseCases type
export { createUseCases, type UseCases } from './usecases/factory';
