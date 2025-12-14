/**
 * LLM Classifier Adapter
 * 
 * Uses Anthropic Claude for email classification.
 * Includes caching and budget management.
 * API key stored in OS keychain.
 */

import Anthropic from '@anthropic-ai/sdk';
import * as crypto from 'crypto';
import type { Classifier, TagRepo, SecureStorage } from '../../core/ports';
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
        };
      } catch {
        console.error('Failed to parse LLM response:', content);
        result = {
          suggestedTags: [],
          confidence: 0,
          reasoning: 'Parse error',
          priority: 'normal',
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

// Reset daily usage (call from scheduler)
export function resetDailyUsage(): void {
  todayUsage = 0;
  todayEmailCount = 0;
}
