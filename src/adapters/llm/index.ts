/**
 * LLM Adapters
 *
 * Provides LLM provider implementations for classification.
 */

export { createClassifier, createAnthropicProvider, resetDailyUsage } from './anthropic';
export type { AgentTools, SimilarEmailHit, SenderHistorySummary } from './agent-tools';
export { detectPromptInjection, shouldQuarantine, type InjectionFinding } from './prompt-injection';
export { createFallbackClassifier, type FallbackTier, type FallbackTransition, type FallbackOptions } from './fallback';
export { createOllamaProvider, createOllamaClassifier, resetOllamaDailyUsage, resetOllamaEmailCount, startOllama, stopOllama } from './ollama';
