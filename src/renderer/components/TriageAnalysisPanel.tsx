/**
 * Triage Analysis Panel
 *
 * Shows AI classification details: confidence, pattern hint, suggested folder,
 * tags, and reasoning. Inspired by Remail's AIAnalysisPanel.
 */

import { IconSparkles, IconCircleInfo, IconCheck, IconClose } from 'obra-icons-react';
import type { TriageClassificationResult } from '../../core/domain';

type TriageAnalysisPanelProps = {
  analysis: TriageClassificationResult;
  className?: string;
};

export function TriageAnalysisPanel({ analysis, className = '' }: TriageAnalysisPanelProps) {
  const getConfidenceColor = (score: number) => {
    if (score >= 0.85) return 'bg-green-500';
    if (score >= 0.5) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  const getConfidenceLabel = (score: number) => {
    if (score >= 0.85) return 'High Confidence';
    if (score >= 0.5) return 'Medium Confidence';
    return 'Low Confidence';
  };

  const confidencePercent = Math.round(analysis.confidence * 100);

  return (
    <div className={`rounded-lg border p-4 space-y-4 ${className}`} style={{ background: 'var(--color-bg-secondary)', borderColor: 'var(--color-border)' }}>
      {/* Header */}
      <div className="flex items-center gap-2">
        <IconSparkles className="h-4 w-4" style={{ color: 'var(--color-accent)' }} />
        <span className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          AI Analysis
        </span>
      </div>

      {/* Confidence Section */}
      <div className="space-y-2">
        <div className="flex justify-between text-xs" style={{ color: 'var(--color-text-secondary)' }}>
          <span>Confidence</span>
          <span className="font-medium">{confidencePercent}%</span>
        </div>
        <div className="h-2 w-full rounded-full overflow-hidden" style={{ background: 'var(--color-border)' }}>
          <div
            className={`h-full ${getConfidenceColor(analysis.confidence)} transition-all duration-500 ease-out`}
            style={{ width: `${confidencePercent}%` }}
          />
        </div>
        <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
          {getConfidenceLabel(analysis.confidence)}
        </p>
      </div>

      {/* Pattern Hint Section */}
      {analysis.patternHint && (
        <div
          className="p-3 rounded-lg border space-y-1"
          style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}
        >
          <div className="flex items-center gap-1.5 text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
            <span className="w-3 h-3 rounded" style={{ background: 'var(--color-accent)' }} />
            <span>Pattern Matcher</span>
          </div>
          <div className="flex items-center justify-between text-xs" style={{ color: 'var(--color-text-secondary)' }}>
            <span>
              Suggested: <strong style={{ color: 'var(--color-text-primary)' }}>{analysis.patternHint}</strong>
            </span>
            {analysis.patternAgreed !== undefined && (
              <span className="flex items-center gap-1">
                {analysis.patternAgreed ? (
                  <>
                    <IconCheck className="w-3 h-3 text-green-500" />
                    <span className="text-green-600">Agreed</span>
                  </>
                ) : (
                  <>
                    <IconClose className="w-3 h-3 text-orange-500" />
                    <span className="text-orange-600">Overridden</span>
                  </>
                )}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Suggested Folder */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
          Destination Folder
        </span>
        <span
          className="text-xs font-medium px-2 py-1 rounded"
          style={{ background: 'var(--color-accent-light, rgba(59, 130, 246, 0.1))', color: 'var(--color-accent)' }}
        >
          {analysis.folder}
        </span>
      </div>

      {/* Suggested Tags */}
      {analysis.tags && analysis.tags.length > 0 && (
        <div className="space-y-2">
          <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
            Detected Patterns
          </span>
          <div className="flex flex-wrap gap-1.5">
            {analysis.tags.map(tag => (
              <span
                key={tag}
                className="text-xs px-2 py-0.5 rounded border"
                style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}
              >
                #{tag}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Snooze Info */}
      {analysis.snoozeUntil && (
        <div className="flex items-center justify-between text-xs" style={{ color: 'var(--color-text-secondary)' }}>
          <span>Snooze Until</span>
          <span className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
            {new Date(analysis.snoozeUntil).toLocaleDateString()}
          </span>
        </div>
      )}

      {/* Auto-delete Info */}
      {analysis.autoDeleteAfter && (
        <div className="flex items-center justify-between text-xs" style={{ color: 'var(--color-text-secondary)' }}>
          <span>Auto-delete</span>
          <span className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
            After {analysis.autoDeleteAfter} min
          </span>
        </div>
      )}

      {/* Reasoning */}
      {analysis.reasoning && (
        <div className="pt-3 border-t" style={{ borderColor: 'var(--color-border)' }}>
          <div className="flex items-start gap-2">
            <IconCircleInfo className="h-3 w-3 mt-0.5 flex-shrink-0" style={{ color: 'var(--color-text-tertiary)' }} />
            <p className="text-xs italic leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
              "{analysis.reasoning}"
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
