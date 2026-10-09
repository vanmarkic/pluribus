/**
 * The triage classifier stack (composition root helper).
 *
 * One function, used by the container and by the integration test, so the
 * decorator order that the privacy and learning guarantees rely on exists in
 * exactly one place:
 *
 *   withSignalRecording            records what answered (system1 / system2)
 *     withSystem1                  on-device heads; escalates, audits, falls back
 *       withBodyPrivacy            strips body text before any cloud LLM
 *         createEnhancedTriageClassifier   pattern hint + vector search + LLM
 *
 * - Signal recording is OUTERMOST so System 1's own answers are recorded, and
 *   so an audit or escalation (which returns the LLM result) is recorded as
 *   the teacher's.
 * - System 1 sits OUTSIDE body privacy: it may see the body preview because it
 *   runs on this device. Body privacy sits between it and the LLM, so nothing
 *   System 1 was given can reach a cloud model unless the user consented.
 */

import type { LLMConfig, SignalRepo, TriageClassifier, VectorSearch } from '../core/ports';
import { createEnhancedTriageClassifier } from '../adapters/triage/enhanced-classifier';
import { withBodyPrivacy } from '../adapters/triage/body-privacy';
import { withSignalRecording } from '../adapters/triage/signal-recorder';
import { withSystem1 } from '../adapters/triage/system1-classifier';
import {
  buildSystem1ClassifierDeps,
  type BuildSystem1ClassifierDepsOptions,
} from './system1-wiring';

export type TriageStackOptions = {
  /** System 2: completes a prompt with the configured LLM (cloud or local). */
  llmClient: { complete: (prompt: string) => Promise<string> };
  vectorSearch?: VectorSearch;
  signals: SignalRepo;
  /** Read on every email, so a settings change applies to the very next one. */
  getLLMConfig: () => LLMConfig;
  /** Everything System 1 needs; see `buildSystem1ClassifierDeps`. */
  system1: BuildSystem1ClassifierDepsOptions;
};

export function composeTriageClassifier(opts: TriageStackOptions): TriageClassifier {
  const { embeddingService } = opts.system1;

  // The id the encoder stores and trains under (`getModel()`), which is not always the
  // settings value (the legacy MiniLM is stored under a short key). Heads, stored vectors
  // and signal tags must all use that same id.
  const embeddingModel = () => embeddingService.getModel();

  const system1Deps = { ...buildSystem1ClassifierDeps(opts.system1), embeddingModel };

  return withSignalRecording(
    withSystem1(
      withBodyPrivacy(createEnhancedTriageClassifier(opts.llmClient, opts.vectorSearch), () =>
        opts.getLLMConfig(),
      ),
      system1Deps,
    ),
    opts.signals,
    {
      modelVersion: () => opts.getLLMConfig().model,
      system1ModelVersion: () => `system1:${embeddingModel()}`,
    },
  );
}
