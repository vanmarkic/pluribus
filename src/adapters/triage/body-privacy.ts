/**
 * Body privacy decorator
 *
 * Email body excerpts are the most sensitive thing the triage pipeline can put
 * in a prompt. They may reach a model only when that model runs on the user's
 * machine (Ollama) or the user explicitly opted in to cloud excerpts
 * (`sendBodyExcerptsToCloud`). This wrapper enforces that at the last moment,
 * so no caller can leak a preview by forgetting to check.
 *
 * The configuration is read on every call (settings can change at any time),
 * and an unreadable configuration counts as "no consent".
 *
 * The stored snippet is body-derived too (first characters of a viewed body),
 * so it is blanked under the same rule.
 */

import type { LLMConfig, TriageClassifier } from '../../core/ports';

function mayShareBody(getLLMConfig: () => LLMConfig): boolean {
  try {
    const config = getLLMConfig();
    return config.provider === 'ollama' || config.sendBodyExcerptsToCloud === true;
  } catch {
    return false;
  }
}

export function withBodyPrivacy(
  inner: TriageClassifier,
  getLLMConfig: () => LLMConfig,
): TriageClassifier {
  return {
    async classify(email, patternHint, examples, opts) {
      if (mayShareBody(getLLMConfig)) {
        return opts === undefined
          ? inner.classify(email, patternHint, examples)
          : inner.classify(email, patternHint, examples, opts);
      }
      const redacted = email.snippet ? { ...email, snippet: '' } : email;
      if (opts === undefined) return inner.classify(redacted, patternHint, examples);
      const { bodyPreview: _withheld, ...rest } = opts;
      return inner.classify(redacted, patternHint, examples, rest);
    },
  };
}
