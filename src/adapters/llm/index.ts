/**
 * LLM Adapters
 *
 * Provides LLM provider implementations for classification.
 */

export { createClassifier, createAnthropicProvider, resetDailyUsage } from './anthropic';
export type { AgentTools, SimilarEmailHit, SenderHistorySummary } from './agent-tools';
export { detectPromptInjection, shouldQuarantine, type InjectionFinding } from './prompt-injection';
export { createFallbackClassifier, type FallbackTier, type FallbackTransition, type FallbackOptions } from './fallback';
export { scoreRiskTier, scoreEmailRiskTier, type RiskTier } from './risk-tier';
export {
  fitPlattScaling,
  calibrateConfidence,
  expectedCalibrationError,
  IDENTITY_CALIBRATION,
  type FeedbackPair,
  type CalibrationModel,
} from './calibration';
export { classifyStreaming, type StreamEvent, type StreamingClassifyInput } from './streaming';
export { createOllamaProvider, createOllamaClassifier, resetOllamaDailyUsage, resetOllamaEmailCount, startOllama, stopOllama } from './ollama';
