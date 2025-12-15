/**
 * LLM Classifier Adapter
 * 
 * Uses Anthropic Claude for email classification.
 * Includes caching and budget management.
 * API key stored in OS keychain.
 */

import Anthropic from '@anthropic-ai/sdk';
import * as crypto from 'crypto';
import type { Classifier, TagRepo, SecureStorage, LLMProvider, LLMModel } from '../../core/ports';
import type { Email, EmailBody, Classification, Tag } from '../../core/domain';
import { extractDomain } from '../../core/domain';

const PROMPT_VERSION = '1.0';

type Config = {
  model: 'claude-sonnet-4-20250514' | 'claude-haiku-4-20250514';
  dailyBudget: number;
  dailyEmailLimit: number;
};

// Simple in-memory cache (production: use DB)
const cache = new Map<string, Classification>();
let todayUsage = 0;
let todayEmailCount = 0;
const DEFAULT_DAILY_EMAIL_LIMIT = 200;

function hashPattern(email: Email): string {
  const domain = extractDomain(email.from.address);
  const normalizedSubject = email.subject
    .replace(/^(re:|fwd:|fw:)\s*/gi, '')
    .replace(/\d+/g, 'N')
    .toLowerCase()
    .trim();
  
  return crypto
    .createHash('sha256')
    .update(`${domain}|${normalizedSubject}`)
    .digest('hex')
    .slice(0, 16);
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
- Suggest 1-3 relevant tags from the available list
- Be conservative: only suggest confident matches
- Consider sender domain and subject patterns
- If no existing tag fits well, you may suggest ONE new tag (use lowercase slug format with hyphens, e.g. "project-updates")
- Only create a new tag if it would be genuinely useful for categorizing future similar emails

Respond with JSON only:
{"tags":["slug"],"confidence":0.0-1.0,"reasoning":"brief","priority":"high"|"normal"|"low","newTag":{"slug":"new-tag-slug","name":"New Tag Name"}|null}`;
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

export function createClassifier(
  config: Config,
  tagRepo: TagRepo,
  secrets: SecureStorage
): Classifier {
  let client: Anthropic | null = null;
  
  async function getClient(): Promise<Anthropic> {
    if (!client) {
      const apiKey = await secrets.getApiKey('anthropic');
      if (!apiKey) throw new Error('Anthropic API key not set. Please configure it in settings.');
      client = new Anthropic({ apiKey });
    }
    return client;
  }

  return {
    async classify(email, body, existingTags) {
      // Check budget
      const budget = this.getBudget();
      if (!budget.allowed) {
        throw new Error(`Daily budget exceeded (${budget.used}/${budget.limit})`);
      }
      
      // Check cache
      const hash = hashPattern(email);
      const cached = cache.get(hash);
      if (cached) {
        console.log(`Cache hit for pattern ${hash}`);
        return cached;
      }
      
      // Get tags for prompt
      const tags = await tagRepo.findAll();
      
      // Call API
      const anthropic = await getClient();
      const response = await anthropic.messages.create({
        model: config.model,
        max_tokens: 512,
        temperature: 0.2,
        system: buildSystemPrompt(tags),
        messages: [{ role: 'user', content: buildUserMessage(email, body, existingTags) }],
      });
      
      // Track usage
      todayUsage += response.usage.input_tokens + response.usage.output_tokens;
      todayEmailCount++;
      
      // Parse response
      const textContent = response.content.find(c => c.type === 'text');
      const content = textContent?.text || '';
      
      let result: Classification;
      try {
        const parsed = JSON.parse(content);
        result = {
          suggestedTags: parsed.tags || [],
          confidence: parsed.confidence || 0,
          reasoning: parsed.reasoning || '',
          priority: parsed.priority || 'normal',
          newTag: parsed.newTag || null,
        };
      } catch {
        console.error('Failed to parse LLM response:', content);
        result = {
          suggestedTags: [],
          confidence: 0,
          reasoning: 'Parse error',
          priority: 'normal',
          newTag: null,
        };
      }
      
      // Cache if confident
      if (result.confidence > 0.5) {
        cache.set(hash, result);
      }
      
      return result;
    },

    getBudget() {
      return {
        used: todayUsage,
        limit: config.dailyBudget,
        allowed: todayUsage < config.dailyBudget,
      };
    },

    getEmailBudget() {
      const limit = config.dailyEmailLimit || DEFAULT_DAILY_EMAIL_LIMIT;
      return {
        used: todayEmailCount,
        limit,
        allowed: todayEmailCount < limit,
      };
    },
  };
}

// Known Anthropic models (SDK v0.27 doesn't have models.list API)
const ANTHROPIC_MODELS: LLMModel[] = [
  { id: 'claude-opus-4-20250514', displayName: 'Claude Opus 4' },
  { id: 'claude-sonnet-4-20250514', displayName: 'Claude Sonnet 4' },
  { id: 'claude-haiku-4-20250514', displayName: 'Claude Haiku 4' },
  { id: 'claude-3-5-sonnet-20241022', displayName: 'Claude 3.5 Sonnet' },
  { id: 'claude-3-5-haiku-20241022', displayName: 'Claude 3.5 Haiku' },
];

export function createAnthropicProvider(secrets: SecureStorage): LLMProvider {
  return {
    type: 'anthropic',

    async validateKey(key: string) {
      try {
        // Validate by making a minimal API call
        const client = new Anthropic({ apiKey: key });
        await client.messages.create({
          model: 'claude-haiku-4-20250514',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }],
        });
        return { valid: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('401') || message.includes('invalid_api_key') || message.includes('authentication')) {
          return { valid: false, error: 'Invalid API key' };
        }
        // Other errors (rate limit, etc.) mean the key is valid
        if (message.includes('rate') || message.includes('overloaded')) {
          return { valid: true };
        }
        return { valid: false, error: message };
      }
    },

    async listModels() {
      const apiKey = await secrets.getApiKey('anthropic');
      if (!apiKey) return [];

      // Return known models (API doesn't have a public models endpoint in SDK v0.27)
      return ANTHROPIC_MODELS;
    },
  };
}

// Reset daily usage (call from scheduler)
export function resetDailyUsage(): void {
  todayUsage = 0;
  todayEmailCount = 0;
}
