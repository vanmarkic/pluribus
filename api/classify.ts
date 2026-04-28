/**
 * Vercel serverless function — classifies a single email via Claude.
 *
 * Used only by the public demo (`mockApi.callRealClassifier`). The desktop
 * Electron app talks to its own LLM adapter inside the main process and
 * never hits this endpoint.
 *
 * Auth model: none. Fictional demo data only. Rate limit is best-effort
 * (each function instance keeps its own counter). For a production demo
 * swap this for `@upstash/ratelimit` against Vercel KV.
 */

import Anthropic from '@anthropic-ai/sdk';

const TRIAGE_FOLDERS = [
  'INBOX',
  'Planning',
  'Review',
  'Paper-Trail/Invoices',
  'Paper-Trail/Admin',
  'Paper-Trail/Travel',
  'Feed',
  'Social',
  'Promotions',
  'Archive',
] as const;

type Folder = (typeof TRIAGE_FOLDERS)[number];

type ClassifyRequest = {
  subject?: string;
  from?: { address?: string; name?: string | null };
  snippet?: string;
};

type ClassifyResponse = {
  suggestedFolder: Folder;
  priority: 'high' | 'normal' | 'low';
  confidence: number;
  reasoning: string;
};

// Per-instance rate limit. Vercel may run many parallel instances, so the
// effective ceiling is higher; this is enough to deter casual abuse.
const RATE_LIMIT_PER_HOUR = 30;
const ipBuckets = new Map<string, { count: number; resetAt: number }>();

function rateLimitOk(ip: string): boolean {
  const now = Date.now();
  const bucket = ipBuckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    ipBuckets.set(ip, { count: 1, resetAt: now + 60 * 60 * 1000 });
    return true;
  }
  if (bucket.count >= RATE_LIMIT_PER_HOUR) return false;
  bucket.count += 1;
  return true;
}

const PROMPT_TEMPLATE = (req: ClassifyRequest) => `You are an email triage classifier. Pick exactly one folder for this email from:

${TRIAGE_FOLDERS.join(', ')}

Folder semantics:
- INBOX: needs the user's attention (a person wrote them, or it's actionable)
- Planning: meetings, calendar, scheduling, action items
- Review: code review requests, design review, awaiting feedback
- Paper-Trail/Invoices: receipts, invoices, bills
- Paper-Trail/Admin: government, tax, HR, legal, lease
- Paper-Trail/Travel: flight/hotel/booking confirmations
- Feed: newsletters, blog digests, content subscriptions
- Social: notifications from social apps (LinkedIn, GitHub, Discord, etc.)
- Promotions: marketing, sales, deals
- Archive: nothing actionable, can be filed away

Email:
Subject: ${req.subject ?? '(no subject)'}
From: ${req.from?.name ?? req.from?.address ?? 'unknown'} <${req.from?.address ?? ''}>
Snippet: ${req.snippet ?? ''}

Reply with strict JSON only, no prose:
{"folder":"<one of the folders above>","confidence":<number 0-1>,"priority":"<high|normal|low>","reasoning":"<one sentence>"}`;

function safeFolder(value: unknown): Folder {
  return TRIAGE_FOLDERS.includes(value as Folder) ? (value as Folder) : 'INBOX';
}

function safePriority(value: unknown): 'high' | 'normal' | 'low' {
  return value === 'high' || value === 'low' ? value : 'normal';
}

function clampConfidence(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0.6;
  return Math.max(0, Math.min(1, value));
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: 'Classifier not configured' });
    return;
  }

  const ip = String(req.headers['x-forwarded-for'] ?? '').split(',')[0]?.trim() || 'unknown';
  if (!rateLimitOk(ip)) {
    res.status(429).json({ error: 'Rate limit exceeded — try again in an hour' });
    return;
  }

  const body = (req.body ?? {}) as ClassifyRequest;
  if (!body.subject && !body.snippet) {
    res.status(400).json({ error: 'subject or snippet required' });
    return;
  }

  const client = new Anthropic({ apiKey });
  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      messages: [{ role: 'user', content: PROMPT_TEMPLATE(body) }],
    });

    const text = response.content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('')
      .trim();

    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      res.status(502).json({ error: 'Classifier returned no JSON' });
      return;
    }
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;

    const result: ClassifyResponse = {
      suggestedFolder: safeFolder(parsed.folder),
      priority: safePriority(parsed.priority),
      confidence: clampConfidence(parsed.confidence),
      reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
    };
    res.setHeader('cache-control', 'no-store');
    res.status(200).json(result);
  } catch (err) {
    console.error('[/api/classify] failed', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'unknown error' });
  }
}
