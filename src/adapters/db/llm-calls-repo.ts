/**
 * LLM Calls Repository
 *
 * Persists one row per LLM classify call for cost/latency observability (#93).
 * Drives the cost dashboard (#94).
 */

import Database from 'better-sqlite3';
import type { LlmCallsRepo, LlmCallRow, LlmUsageStats, LlmDailyCost } from '../../core/ports';

function mapRow(row: any): LlmCallRow {
  return {
    id: row.id,
    ts: new Date(row.ts),
    provider: row.provider,
    model: row.model,
    promptVersion: row.prompt_version ?? null,
    emailId: row.email_id ?? null,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cacheReadTokens: row.cache_read_tokens,
    cacheCreationTokens: row.cache_creation_tokens,
    latencyMs: row.latency_ms,
    costUsd: row.cost_usd,
    cacheHit: !!row.cache_hit,
    stopReason: row.stop_reason ?? null,
    error: row.error ?? null,
  };
}

export function createLlmCallsRepo(getDb: () => Database.Database): LlmCallsRepo {
  return {
    async record(entry) {
      getDb().prepare(`
        INSERT INTO llm_calls (
          provider, model, prompt_version, email_id,
          input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
          latency_ms, cost_usd, cache_hit, stop_reason, error
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        entry.provider,
        entry.model,
        entry.promptVersion ?? null,
        entry.emailId ?? null,
        entry.inputTokens,
        entry.outputTokens,
        entry.cacheReadTokens,
        entry.cacheCreationTokens,
        entry.latencyMs,
        entry.costUsd,
        entry.cacheHit ? 1 : 0,
        entry.stopReason,
        entry.error ?? null,
      );
    },

    async listRecent(limit = 50) {
      const rows = getDb().prepare(`
        SELECT * FROM llm_calls ORDER BY ts DESC LIMIT ?
      `).all(Math.min(limit, 500)) as any[];
      return rows.map(mapRow);
    },

    async getStats() {
      const db = getDb();

      // Totals since inception + today + this month.
      const overall = db.prepare(`
        SELECT
          COUNT(*)                                AS total_calls,
          COALESCE(SUM(cost_usd), 0)              AS total_cost_usd,
          COALESCE(SUM(cache_hit), 0)             AS total_cache_hits,
          COALESCE(AVG(latency_ms), 0)            AS avg_latency_ms,
          COALESCE(SUM(input_tokens), 0)          AS input_tokens,
          COALESCE(SUM(output_tokens), 0)         AS output_tokens,
          COALESCE(SUM(cache_read_tokens), 0)     AS cache_read_tokens,
          COALESCE(SUM(cache_creation_tokens), 0) AS cache_creation_tokens
        FROM llm_calls
      `).get() as any;

      const today = db.prepare(`
        SELECT
          COUNT(*)                     AS calls,
          COALESCE(SUM(cost_usd), 0)   AS cost_usd
        FROM llm_calls
        WHERE date(ts) = date('now')
      `).get() as any;

      const month = db.prepare(`
        SELECT COALESCE(SUM(cost_usd), 0) AS cost_usd
        FROM llm_calls
        WHERE strftime('%Y-%m', ts) = strftime('%Y-%m', 'now')
      `).get() as any;

      const totalCalls = Number(overall.total_calls) || 0;
      const cacheHits = Number(overall.total_cache_hits) || 0;

      const stats: LlmUsageStats = {
        totalCalls,
        totalCostUsd: Number(overall.total_cost_usd) || 0,
        todayCalls: Number(today.calls) || 0,
        todayCostUsd: Number(today.cost_usd) || 0,
        monthCostUsd: Number(month.cost_usd) || 0,
        cacheHitRate: totalCalls > 0 ? cacheHits / totalCalls : 0,
        avgLatencyMs: Math.round(Number(overall.avg_latency_ms) || 0),
        totalInputTokens: Number(overall.input_tokens) || 0,
        totalOutputTokens: Number(overall.output_tokens) || 0,
        totalCacheReadTokens: Number(overall.cache_read_tokens) || 0,
        totalCacheCreationTokens: Number(overall.cache_creation_tokens) || 0,
      };
      return stats;
    },

    async getDailyCost(days = 30) {
      const rows = getDb().prepare(`
        SELECT
          date(ts)                                 AS day,
          model,
          COUNT(*)                                 AS calls,
          COALESCE(SUM(cost_usd), 0)               AS cost_usd
        FROM llm_calls
        WHERE ts >= datetime('now', ?)
        GROUP BY date(ts), model
        ORDER BY day ASC
      `).all(`-${Math.max(1, Math.min(days, 365))} days`) as any[];

      return rows.map((r): LlmDailyCost => ({
        day: r.day,
        model: r.model,
        calls: Number(r.calls) || 0,
        costUsd: Number(r.cost_usd) || 0,
      }));
    },
  };
}
