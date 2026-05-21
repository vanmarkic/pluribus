/**
 * Anthropic Classifier Adapter
 *
 * Uses Anthropic Claude for email classification.
 * Features: prompt caching, per-call cost/latency telemetry, in-memory pattern cache.
 * API key stored in OS keychain.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam, ToolUseBlock } from '@anthropic-ai/sdk/resources/messages/messages';
import * as crypto from 'crypto';
import type { Classifier, SecureStorage, LLMProvider, LLMModel } from '../../core/ports';
import type { Email, EmailBody, Classification, TriageFolder } from '../../core/domain';
import { extractDomain } from '../../core/domain';
import { AGENT_TOOL_DEFINITIONS, executeToolCall, type AgentTools } from './agent-tools';
import { detectPromptInjection, shouldQuarantine, type InjectionFinding } from './prompt-injection';
import { loadPrompt, PRODUCTION_VERSION, type PromptVersion } from './prompts/loader';

// Legacy constant — kept for the hashPattern() cache key so cached
// classifications from before prompt versioning still invalidate
// correctly. New prompt labels live in the loader.
const PROMPT_VERSION = '3.0';

// Claude 2026 model lineup. Legacy IDs accepted for backward compatibility.
export type ClaudeModelId =
  | 'claude-opus-4-7'
  | 'claude-sonnet-4-6'
  | 'claude-haiku-4-5-20251001'
  | 'claude-opus-4-20250514'
  | 'claude-sonnet-4-20250514'
  | 'claude-haiku-4-20250514';

type Config = {
  model: ClaudeModelId | string;
  dailyBudget: number;
  dailyEmailLimit: number;
};

// Pricing per million tokens (USD). Cached reads bill at ~10% of input;
// cache writes bill at ~125% of input. Values tracked as of April 2026.
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4-7': { input: 5.0, output: 25.0 },
  'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
  'claude-haiku-4-5-20251001': { input: 1.0, output: 5.0 },
  'claude-opus-4-20250514': { input: 5.0, output: 25.0 },
  'claude-sonnet-4-20250514': { input: 3.0, output: 15.0 },
  'claude-haiku-4-20250514': { input: 1.0, output: 5.0 },
  'claude-3-5-sonnet-20241022': { input: 3.0, output: 15.0 },
  'claude-3-5-haiku-20241022': { input: 0.8, output: 4.0 },
};

export function computeCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheCreationTokens: number,
  cacheReadTokens: number,
): number {
  const price = MODEL_PRICING[model];
  if (!price) return 0;
  const M = 1_000_000;
  const freshInput = Math.max(0, inputTokens - cacheCreationTokens - cacheReadTokens);
  return (
    (freshInput * price.input) / M +
    (cacheCreationTokens * price.input * 1.25) / M +
    (cacheReadTokens * price.input * 0.1) / M +
    (outputTokens * price.output) / M
  );
}

// Record emitted for every LLM call. Wired in the container to an observability sink.
export type LlmCallRecord = {
  provider: 'anthropic' | 'ollama';
  model: string;
  promptVersion: string;
  emailId?: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  latencyMs: number;
  costUsd: number;
  cacheHit: boolean;
  stopReason: string | null;
  error?: string | null;
};

// In-memory pattern cache. Capped so a long-running desktop session
// can't grow it without bound.
const MAX_CACHE_ENTRIES = 5000;
const cache = new Map<string, Classification>();

function cacheClassification(key: string, value: Classification): void {
  // Map preserves insertion order — evict the oldest entry when full.
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, value);
}

// Daily usage counters. Reset lazily when the calendar day changes so the
// "daily" budget actually rolls over without depending on a scheduler.
let todayUsage = 0;
let todayEmailCount = 0;
let usageDay = new Date().toISOString().slice(0, 10);
const DEFAULT_DAILY_EMAIL_LIMIT = 200;

function rolloverIfNewDay(): void {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== usageDay) {
    usageDay = today;
    todayUsage = 0;
    todayEmailCount = 0;
  }
}

const TRIAGE_FOLDER_DESCRIPTIONS: Record<TriageFolder, string> = {
  INBOX: 'General inbox for emails that need attention',
  Planning: 'Emails requiring future action or planning (meetings, schedules, project planning)',
  Review: 'Emails that need review or decision-making',
  'Paper-Trail/Invoices': 'Invoices, receipts, payment confirmations',
  'Paper-Trail/Admin': 'Administrative documents, contracts, legal',
  'Paper-Trail/Travel': 'Travel bookings, itineraries, confirmations',
  Feed: 'Newsletters, digests, informational content',
  Social: 'Social media notifications, friend updates, community',
  Promotions: 'Marketing, sales, promotional offers',
  Archive: 'Already processed or low-priority items',
};

function hashPattern(email: Email): string {
  const domain = extractDomain(email.from.address);
  const normalizedSubject = email.subject
    .replace(/^(re:|fwd:|fw:)\s*/gi, '')
    .replace(/\d+/g, 'N')
    .toLowerCase()
    .trim();

  return crypto
    .createHash('sha256')
    .update(`${domain}|${normalizedSubject}|v${PROMPT_VERSION}`)
    .digest('hex')
    .slice(0, 16);
}

// System prompt rendering was extracted to prompts/loader.ts (#91).
// Must exceed the minimum cacheable block size (1024 tokens for Sonnet/Opus,
// 2048 for Haiku) to actually hit Anthropic's cache. Folder descriptions +
// rules + JSON schema hit that threshold for Sonnet/Opus.

function buildUserMessage(email: Email, body?: EmailBody): string {
  const parts = [
    `From: ${email.from.name || ''} <${email.from.address}>`,
    `Subject: ${email.subject}`,
    `Date: ${email.date.toISOString()}`,
  ];

  // Delimit untrusted content explicitly so the model treats it as data.
  parts.push(
    '',
    '<email_content>',
    body?.text?.slice(0, 2000) || email.snippet || '(empty)',
    '</email_content>',
  );

  return parts.join('\n');
}

export type ClassifierOptions = {
  /** Callback invoked after every LLM call for observability (#93). */
  onCall?: (record: LlmCallRecord) => void;
  /** Cache TTL for prompt caching: '5m' (default) or '1h' for high-volume syncs. */
  cacheTtl?: '5m' | '1h';
  /** Tools available to the agent loop. When provided, low-confidence
   *  classifications escalate to a tool-use loop (#87). */
  agentTools?: AgentTools;
  /** Confidence below which the agent loop kicks in. Default 0.6. */
  agentConfidenceThreshold?: number;
  /** Max agent iterations (tool → tool_result round trips). Default 3. */
  agentMaxIterations?: number;
  /** Callback for prompt-injection findings (#102). Default: no-op. */
  onInjectionFindings?: (emailId: number, findings: InjectionFinding[]) => void;
  /** Prompt version used for this classifier instance. Defaults to the
   *  loader's PRODUCTION_VERSION. A/B routing lives in the container —
   *  this adapter just renders whichever version it's handed (#91). */
  promptVersion?: PromptVersion;
  /** Thinking budget in tokens (#90). When >0 and the model supports
   *  extended thinking (Sonnet 4.6 / Opus 4.7), the classifier enables
   *  `thinking: { type: 'enabled', budget_tokens }` on the request.
   *  Temperature is forced to 1.0 as Anthropic requires. */
  thinkingBudgetTokens?: number;
};

/** Parse Claude's JSON reply into a Classification, falling back to INBOX on error. */
function parseClassification(content: string): {
  result: Classification;
  parseError: string | null;
} {
  const validFolders = Object.keys(TRIAGE_FOLDER_DESCRIPTIONS);
  try {
    const parsed = JSON.parse(content);
    const folder = parsed.folder as TriageFolder;
    if (!validFolders.includes(folder)) {
      const parseError = `Unknown folder "${folder}" in response`;
      return {
        result: {
          suggestedFolder: 'INBOX',
          confidence: 0.5,
          reasoning: parseError,
          priority: 'normal',
        },
        parseError,
      };
    }
    return {
      result: {
        suggestedFolder: folder,
        confidence: parsed.confidence || 0,
        reasoning: parsed.reasoning || '',
        priority: parsed.priority || 'normal',
      },
      parseError: null,
    };
  } catch {
    const parseError = 'Parse error';
    return {
      result: {
        suggestedFolder: 'INBOX',
        confidence: 0,
        reasoning: parseError,
        priority: 'normal',
      },
      parseError,
    };
  }
}

export function createClassifier(
  config: Config,
  secrets: SecureStorage,
  options: ClassifierOptions = {},
): Classifier {
  let client: Anthropic | null = null;
  const onCall = options.onCall;
  const cacheTtl = options.cacheTtl ?? '5m';
  const agentTools = options.agentTools;
  const agentConfidenceThreshold = options.agentConfidenceThreshold ?? 0.6;
  const agentMaxIterations = options.agentMaxIterations ?? 3;
  const promptSpec = loadPrompt(options.promptVersion ?? PRODUCTION_VERSION);
  const thinkingBudget =
    options.thinkingBudgetTokens && options.thinkingBudgetTokens > 0
      ? options.thinkingBudgetTokens
      : 0;

  async function getClient(): Promise<Anthropic> {
    if (!client) {
      const apiKey = await secrets.getApiKey('anthropic');
      if (!apiKey) throw new Error('Anthropic API key not set. Please configure it in settings.');
      client = new Anthropic({ apiKey });
    }
    return client;
  }

  /**
   * Multi-turn agent loop (#87). Called when a first-pass classification
   * returns confidence < threshold. Starts from the initial user message,
   * offers Claude the agent tools, and iterates up to agentMaxIterations
   * tool_use → tool_result round trips before forcing a final JSON answer.
   *
   * Returns the best available Classification — the latest parseable one,
   * or the original low-confidence result if the model never improves it.
   */
  async function runAgentLoop(
    email: Email,
    seed: MessageParam[],
    tools: AgentTools,
    fallback: Classification,
  ): Promise<Classification> {
    // Rebuild history — the first message (user email) is the only seed; the
    // initial assistant response is discarded so the model can re-reason with
    // tools available from the start.
    const history: MessageParam[] = [...seed];
    let best: Classification = fallback;

    for (let i = 0; i < agentMaxIterations; i++) {
      const { response } = await runOneCall(email, history, AGENT_TOOL_DEFINITIONS);

      // If the model produced a text block, try to parse it as the final answer.
      const textBlock = response.content.find((c) => c.type === 'text');
      if (textBlock && textBlock.type === 'text' && textBlock.text.trim()) {
        const { result } = parseClassification(textBlock.text);
        if (result.confidence > best.confidence) {
          best = result;
        }
      }

      if (response.stop_reason !== 'tool_use') {
        // Model is done (either answered or ran out of ideas).
        return best;
      }

      // Execute every tool_use block in this turn and send all results back
      // in a single user turn, as the Messages API requires.
      const toolUses = response.content.filter((c): c is ToolUseBlock => c.type === 'tool_use');
      const toolResults = await Promise.all(toolUses.map((tu) => executeToolCall(tu, tools)));

      history.push({ role: 'assistant', content: response.content as any });
      history.push({
        role: 'user',
        content: toolResults.map((tr) => {
          // exactOptionalPropertyTypes: only set is_error when it's a boolean.
          const base = {
            type: 'tool_result' as const,
            tool_use_id: tr.tool_use_id,
            content: tr.content,
          };
          return tr.is_error === undefined ? base : { ...base, is_error: tr.is_error };
        }),
      });
    }

    // Budget exhausted: force one final turn without tools so the model commits.
    history.push({
      role: 'user',
      content:
        'Based on everything above, give your final classification now as JSON only. ' +
        'Do not call any more tools.',
    });
    const { response: finalResponse } = await runOneCall(email, history);
    const finalText = finalResponse.content.find((c) => c.type === 'text');
    if (finalText && finalText.type === 'text') {
      const { result } = parseClassification(finalText.text);
      if (result.confidence > best.confidence) best = result;
    }
    return best;
  }

  function buildSystemBlocks(): any[] {
    return [
      {
        type: 'text',
        text: promptSpec.text,
        cache_control: cacheTtl === '1h' ? { type: 'ephemeral', ttl: '1h' } : { type: 'ephemeral' },
      },
    ];
  }

  // Issue one Anthropic call, emit one llm_calls row, return (result, rawResponse).
  // `extraTools` adds the agent tool definitions; when set, the response may
  // arrive as stop_reason: 'tool_use' instead of an end-of-turn text block.
  async function runOneCall(
    email: Email,
    messages: MessageParam[],
    extraTools?: typeof AGENT_TOOL_DEFINITIONS,
  ): Promise<{ response: Anthropic.Messages.Message; costUsd: number; cacheHit: boolean }> {
    const started = Date.now();
    const anthropic = await getClient();

    let response: Anthropic.Messages.Message;
    try {
      // Extended thinking (#90): Anthropic requires temperature=1 and
      // max_tokens > budget_tokens whenever the thinking block is enabled.
      const thinkingEnabled = thinkingBudget > 0;
      response = await anthropic.messages.create({
        model: config.model,
        max_tokens: thinkingEnabled ? thinkingBudget + 1024 : 1024,
        temperature: thinkingEnabled ? 1 : 0.2,
        system: buildSystemBlocks(),
        messages,
        ...(extraTools && extraTools.length > 0 ? { tools: extraTools } : {}),
        ...(thinkingEnabled
          ? { thinking: { type: 'enabled', budget_tokens: thinkingBudget } }
          : {}),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onCall?.({
        provider: 'anthropic',
        model: config.model,
        promptVersion: promptSpec.label,
        emailId: email.id,
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        latencyMs: Date.now() - started,
        costUsd: 0,
        cacheHit: false,
        stopReason: null,
        error: msg,
      });
      throw err;
    }

    const inputTokens = response.usage.input_tokens ?? 0;
    const outputTokens = response.usage.output_tokens ?? 0;
    const cacheCreationTokens = (response.usage as any).cache_creation_input_tokens ?? 0;
    const cacheReadTokens = (response.usage as any).cache_read_input_tokens ?? 0;
    todayUsage += inputTokens + outputTokens;

    const costUsd = computeCostUsd(
      config.model,
      inputTokens,
      outputTokens,
      cacheCreationTokens,
      cacheReadTokens,
    );

    onCall?.({
      provider: 'anthropic',
      model: config.model,
      promptVersion: promptSpec.label,
      emailId: email.id,
      inputTokens,
      outputTokens,
      cacheCreationTokens,
      cacheReadTokens,
      latencyMs: Date.now() - started,
      costUsd,
      cacheHit: cacheReadTokens > 0,
      stopReason: response.stop_reason ?? null,
      error: null,
    });

    return { response, costUsd, cacheHit: cacheReadTokens > 0 };
  }

  return {
    async classify(email: Email, body?: EmailBody): Promise<Classification> {
      rolloverIfNewDay();
      // Check budget
      const budget = this.getBudget();
      if (!budget.allowed) {
        throw new Error(`Daily budget exceeded (${budget.used}/${budget.limit})`);
      }

      // Check pattern cache
      const hash = hashPattern(email);
      const cached = cache.get(hash);
      if (cached) {
        return cached;
      }

      // Prompt-injection scan on input (#102). Findings don't block the call
      // — they disable caching so a poisoned classification can't persist,
      // and flow to the audit callback for logging.
      const injectionFindings = detectPromptInjection(
        email.subject,
        body?.text ?? email.snippet ?? '',
      );
      if (injectionFindings.length > 0) {
        options.onInjectionFindings?.(email.id, injectionFindings);
      }
      const quarantined = shouldQuarantine(injectionFindings);

      // First turn: no tools, fully cacheable.
      const messages: MessageParam[] = [{ role: 'user', content: buildUserMessage(email, body) }];
      const initial = await runOneCall(email, messages);

      const textContent = initial.response.content.find((c) => c.type === 'text');
      const content = textContent && textContent.type === 'text' ? textContent.text : '';
      let { result } = parseClassification(content);
      todayEmailCount++;

      // Agent refinement: only when confidence is too low AND tools are wired.
      // The model gets the same system prompt + message history and may call
      // find_similar_emails / get_sender_history to gather more evidence.
      if (
        agentTools &&
        result.confidence < agentConfidenceThreshold &&
        initial.response.stop_reason !== 'tool_use'
      ) {
        result = await runAgentLoop(email, messages, agentTools, result);
      } else if (initial.response.stop_reason === 'tool_use') {
        // The first call didn't have tools — this branch should be rare,
        // but defensively replay with tools.
        if (agentTools) result = await runAgentLoop(email, messages, agentTools, result);
      }

      // Cache if confident AND not quarantined.
      if (result.confidence > 0.5 && !quarantined) {
        cacheClassification(hash, result);
      }

      return result;
    },

    getBudget() {
      rolloverIfNewDay();
      return {
        used: todayUsage,
        limit: config.dailyBudget,
        allowed: todayUsage < config.dailyBudget,
      };
    },

    getEmailBudget() {
      rolloverIfNewDay();
      const limit = config.dailyEmailLimit || DEFAULT_DAILY_EMAIL_LIMIT;
      return {
        used: todayEmailCount,
        limit,
        allowed: todayEmailCount < limit,
      };
    },
  };
}

// Known Anthropic models (SDK v0.90 supports client.models.list(), but we ship
// a static list so the settings UI works without a network round-trip).
const ANTHROPIC_MODELS: LLMModel[] = [
  { id: 'claude-opus-4-7', displayName: 'Claude Opus 4.7' },
  { id: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6' },
  { id: 'claude-haiku-4-5-20251001', displayName: 'Claude Haiku 4.5' },
  { id: 'claude-opus-4-20250514', displayName: 'Claude Opus 4 (legacy)' },
  { id: 'claude-sonnet-4-20250514', displayName: 'Claude Sonnet 4 (legacy)' },
  { id: 'claude-haiku-4-20250514', displayName: 'Claude Haiku 4 (legacy)' },
];

export function createAnthropicProvider(secrets: SecureStorage): LLMProvider {
  return {
    type: 'anthropic',

    async validateKey(key: string) {
      try {
        const client = new Anthropic({ apiKey: key });
        await client.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }],
        });
        return { valid: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (
          message.includes('401') ||
          message.includes('invalid_api_key') ||
          message.includes('authentication')
        ) {
          return { valid: false, error: 'Invalid API key' };
        }
        if (message.includes('rate') || message.includes('overloaded')) {
          return { valid: true };
        }
        return { valid: false, error: message };
      }
    },

    async listModels() {
      const apiKey = await secrets.getApiKey('anthropic');
      if (!apiKey) return [];
      return ANTHROPIC_MODELS;
    },
  };
}

// Reset daily usage. Counters also roll over lazily on the first call of
// a new calendar day (see rolloverIfNewDay); this remains for explicit
// resets and tests.
export function resetDailyUsage(): void {
  todayUsage = 0;
  todayEmailCount = 0;
  usageDay = new Date().toISOString().slice(0, 10);
}
