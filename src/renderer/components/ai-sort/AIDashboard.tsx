import { useState, useEffect, useRef } from 'react';
import { Card, CardContent } from '../ui/card';
import { Progress } from '../ui/progress';
import { Button } from '../ui/button';
import type { AIStats, ClassificationFeedback, ConfusedPattern } from './types';
import { IconSpinnerBall, IconBarChart, IconClock3, IconArrowUp } from 'obra-icons-react';

type AIDashboardProps = {
  onClassifyUnprocessed: () => Promise<{ classified: number; skipped: number }>;
  onClearCache: () => void;
  accountId?: number;
};

export function AIDashboard({ onClassifyUnprocessed, onClearCache, accountId }: AIDashboardProps) {
  const [stats, setStats] = useState<AIStats | null>(null);
  const [patterns, setPatterns] = useState<ConfusedPattern[]>([]);
  const [activity, setActivity] = useState<ClassificationFeedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [classifying, setClassifying] = useState(false);
  const [classifyResult, setClassifyResult] = useState<{ classified: number; skipped: number } | null>(null);
  const clearResultTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const loadData = async () => {
    try {
      const [statsData, patternsData, activityData] = await Promise.all([
        window.mailApi.aiSort.getStats(accountId),
        window.mailApi.aiSort.getConfusedPatterns(5, accountId),
        window.mailApi.aiSort.getRecentActivity(5, accountId),
      ]);
      setStats(statsData);
      setPatterns(patternsData);
      setActivity(activityData);
    } catch (err) {
      console.error('Failed to load AI dashboard data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [accountId]);

  const handleClassify = async () => {
    setClassifying(true);
    setClassifyResult(null);
    // Clear any existing timeout
    if (clearResultTimeoutRef.current) {
      clearTimeout(clearResultTimeoutRef.current);
    }
    try {
      const result = await onClassifyUnprocessed();
      await loadData();
      setClassifyResult(result);
      // Clear the result message after 5 seconds
      clearResultTimeoutRef.current = setTimeout(() => setClassifyResult(null), 5000);
    } catch (err) {
      console.error('Classification error:', err);
    } finally {
      setClassifying(false);
    }
  };

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (clearResultTimeoutRef.current) {
        clearTimeout(clearResultTimeoutRef.current);
      }
    };
  }, []);

  if (loading || !stats) {
    return (
      <div className="flex items-center justify-center h-full">
        <p style={{ color: 'var(--color-text-tertiary)' }}>Loading...</p>
      </div>
    );
  }

  const isUnlimitedBudget = stats.budgetLimit === 0;
  const budgetPercent = stats.budgetLimit > 0 ? (stats.budgetUsed / stats.budgetLimit) * 100 : 0;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
            AI Sort Dashboard
          </h2>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
            Monitor classification performance and manage your sorting budget.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex gap-3">
            <Button variant="outline" size="sm" onClick={onClearCache}>
              <IconSpinnerBall className="mr-2 h-4 w-4" />
              Clear Cache
            </Button>
            <Button size="sm" onClick={handleClassify} disabled={classifying}>
              {classifying && <IconSpinnerBall className="mr-2 h-4 w-4 animate-spin" />}
              {classifying ? 'Processing...' : 'Classify Unprocessed'}
            </Button>
          </div>
          {classifyResult && (
            <div
              className="text-sm px-3 py-1.5 rounded-md"
              style={{
                background: 'var(--color-success-bg, rgba(34, 197, 94, 0.1))',
                color: 'var(--color-success, #22c55e)'
              }}
            >
              Processed {classifyResult.classified} email{classifyResult.classified !== 1 ? 's' : ''}
              {classifyResult.skipped > 0 && `, skipped ${classifyResult.skipped}`}
            </div>
          )}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-medium" style={{ color: 'var(--color-text-tertiary)' }}>
                Classified Today
              </span>
              <IconBarChart className="h-4 w-4" style={{ color: 'var(--color-accent)' }} />
            </div>
            <div className="text-3xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
              {stats.classifiedToday}
            </div>
            <p className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
              emails processed
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-medium" style={{ color: 'var(--color-text-tertiary)' }}>
                Pending Review
              </span>
              <IconClock3 className="h-4 w-4" style={{ color: 'var(--color-warning)' }} />
            </div>
            <div className="text-3xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
              {stats.pendingReview}
            </div>
            <p className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
              requires attention
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-medium" style={{ color: 'var(--color-text-tertiary)' }}>
                Accuracy (30d)
              </span>
              <IconArrowUp className="h-4 w-4" style={{ color: 'var(--color-success)' }} />
            </div>
            <div className="text-3xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
              {stats.accuracy30Day != null && !isNaN(stats.accuracy30Day)
                ? `${Math.round(stats.accuracy30Day * 100)}%`
                : 'N/A'}
            </div>
            <p className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
              based on corrections
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Budget Section */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
              Daily Classification Budget
            </h3>
            <span className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
              {isUnlimitedBudget
                ? `${stats.budgetUsed} emails (unlimited)`
                : `${stats.budgetUsed} / ${stats.budgetLimit} tokens`
              }
            </span>
          </div>
          {isUnlimitedBudget ? (
            <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
              Using local Ollama — no daily limit
            </p>
          ) : (
            <>
              <Progress value={budgetPercent} className="h-2" />
              <div className="flex justify-between mt-2 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                <span>Resets at midnight</span>
                <span>{Math.round(budgetPercent)}% used</span>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Confused Patterns & Activity */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Confused Patterns */}
        <div className="space-y-4">
          <h3
            className="text-sm font-semibold uppercase tracking-wider"
            style={{ color: 'var(--color-text-primary)' }}
          >
            Confused Patterns
          </h3>
          <Card>
            {patterns.length === 0 ? (
              <CardContent className="p-4 text-center">
                <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
                  No confused patterns detected
                </p>
              </CardContent>
            ) : (
              <div className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
                {patterns.map((item) => (
                  <div key={item.id} className="p-4 flex items-center justify-between">
                    <div>
                      <div
                        className="text-sm font-medium font-mono"
                        style={{ color: 'var(--color-text-primary)' }}
                      >
                        {item.patternValue}
                      </div>
                      <div className="text-xs mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>
                        Avg Confidence: {item.avgConfidence != null && !isNaN(item.avgConfidence)
                          ? `${Math.round(item.avgConfidence * 100)}%`
                          : 'N/A'}
                      </div>
                    </div>
                    <div
                      className="text-xs font-medium px-2 py-1 rounded"
                      style={{
                        background: 'rgba(239, 68, 68, 0.1)',
                        color: 'var(--color-danger)',
                      }}
                    >
                      {item.dismissalCount} dismissals
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Recent Activity */}
        <div className="space-y-4">
          <h3
            className="text-sm font-semibold uppercase tracking-wider"
            style={{ color: 'var(--color-text-primary)' }}
          >
            Recent Activity
          </h3>
          <Card>
            {activity.length === 0 ? (
              <CardContent className="p-4 text-center">
                <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
                  No recent activity
                </p>
              </CardContent>
            ) : (
              <div className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
                {activity.map((item) => (
                  <div key={item.id} className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-2 h-2 rounded-full"
                        style={{
                          background:
                            item.action === 'accept' ? 'var(--color-success)' :
                            item.action === 'accept_edit' ? 'var(--color-accent)' :
                            'var(--color-text-tertiary)',
                        }}
                      />
                      <div>
                        <div className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
                          {item.action === 'accept' ? 'Accepted' :
                           item.action === 'accept_edit' ? 'Edited' : 'Dismissed'}
                        </div>
                        <div
                          className="text-xs truncate max-w-[200px]"
                          style={{ color: 'var(--color-text-tertiary)' }}
                        >
                          Email #{item.emailId}
                        </div>
                      </div>
                    </div>
                    <div className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                      {formatTimeAgo(item.createdAt)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - new Date(date).getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}
