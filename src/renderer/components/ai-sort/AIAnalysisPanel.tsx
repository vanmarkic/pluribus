import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import type { ClassificationState } from '../../../core/domain';
import { IconSparkles, IconCircleInfo } from 'obra-icons-react';

type AIAnalysisPanelProps = {
  classification: ClassificationState;
  className?: string;
};

export function AIAnalysisPanel({ classification, className }: AIAnalysisPanelProps) {
  const confidence = classification.confidence ?? 0;

  const getConfidenceColor = (score: number) => {
    if (score >= 85) return 'var(--color-success)';
    if (score >= 50) return 'var(--color-warning)';
    return 'var(--color-danger)';
  };

  const getConfidenceLabel = (score: number) => {
    if (score >= 85) return 'High Confidence';
    if (score >= 50) return 'Medium Confidence';
    return 'Low Confidence';
  };

  const getPriorityStyle = (priority: string | null) => {
    switch (priority) {
      case 'high':
        return { color: 'var(--color-danger)', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)' };
      case 'normal':
        return { color: 'var(--color-accent)', background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.2)' };
      case 'low':
      default:
        return { color: 'var(--color-text-secondary)', background: 'var(--color-bg-tertiary)', border: '1px solid var(--color-border)' };
    }
  };

  return (
    <Card className={className} style={{ background: 'var(--color-bg-secondary)' }}>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <IconSparkles className="h-4 w-4" style={{ color: 'var(--color-accent)' }} />
          <CardTitle className="text-sm font-semibold">AI Analysis</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Confidence Section */}
        <div className="space-y-2">
          <div className="flex justify-between text-xs" style={{ color: 'var(--color-text-secondary)' }}>
            <span>Confidence</span>
            <span className="font-medium">{confidence}%</span>
          </div>
          <div
            className="h-2 w-full rounded-full overflow-hidden"
            style={{ background: 'var(--color-bg-tertiary)' }}
          >
            <div
              className="h-full transition-all duration-500 ease-out"
              style={{
                width: `${confidence}%`,
                background: getConfidenceColor(confidence),
              }}
            />
          </div>
          <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
            {getConfidenceLabel(confidence)}
          </p>
        </div>

        {/* Priority Section */}
        {classification.priority && (
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
              Priority
            </span>
            <Badge variant="outline" style={getPriorityStyle(classification.priority)}>
              {classification.priority.charAt(0).toUpperCase() + classification.priority.slice(1)}
            </Badge>
          </div>
        )}

        {/* Suggested Tags */}
        {classification.suggestedTags.length > 0 && (
          <div className="space-y-2">
            <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
              Suggested Tags
            </span>
            <div className="flex flex-wrap gap-1.5">
              {classification.suggestedTags.map(tag => (
                <Badge
                  key={tag}
                  variant="secondary"
                  className="border"
                  style={{
                    background: 'var(--color-bg)',
                    borderColor: 'var(--color-border)',
                    color: 'var(--color-text-secondary)',
                  }}
                >
                  #{tag}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Reasoning */}
        {classification.reasoning && (
          <div
            className="pt-2 border-t"
            style={{ borderColor: 'var(--color-border)' }}
          >
            <div className="flex items-start gap-2">
              <IconCircleInfo
                className="h-3 w-3 mt-0.5 flex-shrink-0"
                style={{ color: 'var(--color-text-tertiary)' }}
              />
              <p
                className="text-xs leading-relaxed italic"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                "{classification.reasoning}"
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
