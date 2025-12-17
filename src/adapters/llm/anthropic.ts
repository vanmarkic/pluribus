/**
 * LLM Classifier Adapter
 *
 * Uses Anthropic Claude for email classification.
 * Includes caching and budget management.
 * API key stored in OS keychain.
 */

import Anthropic from '@anthropic-ai/sdk';
import * as crypto from 'crypto';
import type { Classifier, SecureStorage, LLMProvider, LLMModel } from '../../core/ports';
import type { Email, EmailBody, Classification, TriageFolder, TRIAGE_FOLDERS } from '../../core/domain';
import { extractDomain } from '../../core/domain';

const PROMPT_VERSION = '2.0'; // Updated for folder-based classification

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

// Triage folders for classification
const TRIAGE_FOLDER_DESCRIPTIONS: Record<TriageFolder, string> = {
  'INBOX': 'General inbox for emails that need attention',
  'Planning': 'Emails requiring future action or planning (meetings, schedules, project planning)',
  'Review': 'Emails that need review or decision-making',
  'Paper-Trail/Invoices': 'Invoices, receipts, payment confirmations',
  'Paper-Trail/Admin': 'Administrative documents, contracts, legal',
  'Paper-Trail/Travel': 'Travel bookings, itineraries, confirmations',
  'Feed': 'Newsletters, digests, informational content',
  'Social': 'Social media notifications, friend updates, community',
  'Promotions': 'Marketing, sales, promotional offers',
  'Archive': 'Already processed or low-priority items',
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

function buildSystemPrompt(): string {
  const folderList = Object.entries(TRIAGE_FOLDER_DESCRIPTIONS)
    .map(([folder, desc]) => `- ${folder}: ${desc}`)
    .join('\n');

  return `You are an email sorting assistant. Analyze emails and suggest the best folder.

Available folders:
${folderList}

Rules:
- Suggest exactly ONE folder from the available list
- Be conservative: choose based on email content, not guesses
- Consider sender domain and subject patterns
- Use INBOX if no other folder is a clear match
- Invoices, receipts → Paper-Trail/Invoices
- Meeting/scheduling → Planning
- Newsletters → Feed
- Marketing/sales → Promotions

Respond with JSON only:
{"folder":"FolderName","confidence":0.0-1.0,"reasoning":"brief","priority":"high"|"normal"|"low"}`;
}

function buildUserMessage(email: Email, body?: EmailBody): string {
  const parts = [
    `From: ${email.from.name || ''} <${email.from.address}>`,
    `Subject: ${email.subject}`,
    `Date: ${email.date.toISOString()}`,
  ];

  parts.push('', 'Content:', body?.text?.slice(0, 2000) || email.snippet || '(empty)');

  return parts.join('\n');
}

export function createClassifier(
  config: Config,
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
    async classify(email: Email, body?: EmailBody): Promise<Classification> {
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

      // Call API
      const anthropic = await getClient();
      const response = await anthropic.messages.create({
        model: config.model,
        max_tokens: 512,
        temperature: 0.2,
        system: buildSystemPrompt(),
        messages: [{ role: 'user', content: buildUserMessage(email, body) }],
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
        // Validate folder is a known triage folder
        const folder = parsed.folder as TriageFolder;
        const validFolders = Object.keys(TRIAGE_FOLDER_DESCRIPTIONS);
        if (!validFolders.includes(folder)) {
          console.warn(`Unknown folder "${folder}", defaulting to INBOX`);
          result = {
            suggestedFolder: 'INBOX',
            confidence: 0.5,
            reasoning: `Unknown folder "${folder}" in response`,
            priority: 'normal',
          };
        } else {
          result = {
            suggestedFolder: folder,
            confidence: parsed.confidence || 0,
            reasoning: parsed.reasoning || '',
            priority: parsed.priority || 'normal',
          };
        }
      } catch {
        console.error('Failed to parse LLM response:', content);
        result = {
          suggestedFolder: 'INBOX',
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
