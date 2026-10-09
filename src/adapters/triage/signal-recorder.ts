/**
 * Signal recording decorator
 *
 * Wraps a TriageClassifier so that every real model answer also leaves a
 * per-email signal (needs-reply probability, importance, folder) behind. The
 * "needs your reply" digest ranks mail from those signals.
 *
 * - `source: 'llm'`     -> `system2` signal (the cloud/local LLM)
 * - `source: 'system1'` -> `system1` signal (the on-device model)
 * - `'fallback'` / unknown -> nothing: guesses from pattern matching are not
 *   evidence about the email.
 *
 * Recording is best-effort. A storage hiccup must never turn a successful
 * classification into a failed one, so errors are logged and swallowed.
 */

import type { SignalRepo, TriageClassifier } from '../../core/ports';
import type { SignalSource } from '../../core/domain';

export type SignalRecordingOptions = {
  /** Identifier of the model that produced the answer, e.g. 'claude-haiku-4-5' or 'mistral:7b'. */
  modelVersion: () => string;
  /**
   * Identifier recorded for on-device answers, e.g. 'system1:Xenova/multilingual-e5-small'.
   * Separate from `modelVersion` (which names the LLM). Defaults to 'system1'.
   */
  system1ModelVersion?: () => string;
};

const SOURCE_TO_SIGNAL: Record<string, SignalSource | undefined> = {
  llm: 'system2',
  system1: 'system1',
};

export function withSignalRecording(
  inner: TriageClassifier,
  signals: SignalRepo,
  opts: SignalRecordingOptions,
): TriageClassifier {
  return {
    async classify(email, patternHint, examples, classifyOpts) {
      const result =
        classifyOpts === undefined
          ? await inner.classify(email, patternHint, examples)
          : await inner.classify(email, patternHint, examples, classifyOpts);

      const signalSource = result.source ? SOURCE_TO_SIGNAL[result.source] : undefined;
      if (signalSource) {
        try {
          await signals.upsert({
            emailId: email.id,
            source: signalSource,
            needsReply: result.needsReply ?? null,
            importance: result.importance ?? null,
            folder: result.folder,
            confidence: result.confidence,
            modelVersion:
              signalSource === 'system1'
                ? (opts.system1ModelVersion?.() ?? 'system1')
                : opts.modelVersion(),
          });
        } catch (error) {
          console.warn(`Failed to record ${signalSource} signal for email ${email.id}:`, error);
        }
      }
      return result;
    },
  };
}
