/**
 * Ollama LLM Provider
 *
 * Uses local Ollama server for email classification.
 * No API key required - just server URL.
 */

import type { LLMProvider, LLMModel, Classifier } from '../../core/ports';
import type { Email, EmailBody, Classification, Tag } from '../../core/domain';

const DEFAULT_SERVER_URL = 'http://localhost:11434';

export function createOllamaProvider(serverUrl = DEFAULT_SERVER_URL): LLMProvider {
  return {
    type: 'ollama',

    async validateKey() {
      // Ollama doesn't need API key, just test connection
      return this.testConnection!();
    },

    async listModels() {
      try {
        const response = await fetch(`${serverUrl}/api/tags`);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();

        return (data.models || []).map((m: { name: string; modified_at?: string }) => ({
          id: m.name,
          displayName: m.name,
          createdAt: m.modified_at,
        }));
      } catch (err) {
        console.error('Failed to list Ollama models:', err);
        return [];
      }
    },

    async testConnection() {
      try {
        const response = await fetch(`${serverUrl}/api/tags`, {
          method: 'GET',
          signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) {
          return { connected: false, error: `HTTP ${response.status}` };
        }
        return { connected: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { connected: false, error: message };
      }
    },
  };
}

function buildSystemPrompt(tags: Tag[]): string {
  const tagList = tags
    .filter(t => !t.isSystem)
    .map(t => `- ${t.slug}: ${t.name}`)
    .join('\n');

  return `You are an email sorting assistant. Analyze emails and suggest tags.

Available tags:
${tagList}

Rules:
- Suggest 1-3 relevant tags
- Be conservative: only suggest confident matches
- Consider sender domain and subject patterns

Respond with JSON only:
{"tags":["slug"],"confidence":0.0-1.0,"reasoning":"brief","priority":"high"|"normal"|"low"}`;
}

function buildUserMessage(email: Email, body?: EmailBody, existingTags?: string[]): string {
  const parts = [
    `From: ${email.from.name || ''} <${email.from.address}>`,
    `Subject: ${email.subject}`,
    `Date: ${email.date.toISOString()}`,
  ];

  if (existingTags?.length) {
    parts.push(`Current tags: ${existingTags.join(', ')}`);
  }

  parts.push('', 'Content:', body?.text?.slice(0, 2000) || email.snippet || '(empty)');

  return parts.join('\n');
}

type OllamaConfig = {
  model: string;
  serverUrl: string;
  dailyBudget: number;
  dailyEmailLimit: number;
};

let todayEmailCount = 0;

export function createOllamaClassifier(
  config: OllamaConfig,
  tagRepo: { findAll: () => Promise<Tag[]> }
): Classifier {
  return {
    async classify(email, body, existingTags) {
      const budget = this.getEmailBudget();
      if (!budget.allowed) {
        throw new Error(`Daily budget exceeded (${budget.used}/${budget.limit})`);
      }

      const tags = await tagRepo.findAll();
      const systemPrompt = buildSystemPrompt(tags);
      const userMessage = buildUserMessage(email, body, existingTags);

      const response = await fetch(`${config.serverUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
          stream: false,
          options: { temperature: 0.2 },
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status}`);
      }

      const data = await response.json();
      todayEmailCount++;

      const content = data.message?.content || '';

      try {
        const parsed = JSON.parse(content);
        return {
          suggestedTags: parsed.tags || [],
          confidence: parsed.confidence || 0,
          reasoning: parsed.reasoning || '',
          priority: parsed.priority || 'normal',
        };
      } catch {
        console.error('Failed to parse Ollama response:', content);
        return {
          suggestedTags: [],
          confidence: 0,
          reasoning: 'Parse error',
          priority: 'normal',
        };
      }
    },

    getBudget() {
      // Ollama is free, but we still track for UI consistency
      return { used: 0, limit: config.dailyBudget, allowed: true };
    },

    getEmailBudget() {
      return {
        used: todayEmailCount,
        limit: config.dailyEmailLimit,
        allowed: todayEmailCount < config.dailyEmailLimit,
      };
    },
  };
}

export function resetOllamaDailyUsage(): void {
  todayEmailCount = 0;
}
