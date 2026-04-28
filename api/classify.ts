/**
 * Vercel serverless function — classifies a single email via the
 * Vercel AI Gateway.
 *
 * Used only by the public demo (`mockApi.callRealClassifier`). The
 * desktop Electron app talks to its own LLM adapter inside the main
 * process and never hits this endpoint.
 *
 * Auth model: OIDC. On Vercel, `VERCEL_OIDC_TOKEN` is auto-provisioned
 * and refreshed; locally, run `vercel env pull .env.local`. No
 * `ANTHROPIC_API_KEY` needed.
 */

import { generateText, APICallError } from 'ai';

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

// Per-instance rate limit. Fluid Compute reuses instances, so this
// catches abuse from a single function instance; the dashboard's
// per-user gateway rate limit is the real enforcement.
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

const PROMPT = (
  req: ClassifyRequest,
) => `You are an email triage classifier. Pick exactly one folder for this email from:

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

const safeFolder = (v: unknown): Folder =>
  TRIAGE_FOLDERS.includes(v as Folder) ? (v as Folder) : 'INBOX';

const safePriority = (v: unknown): 'high' | 'normal' | 'low' =>
  v === 'high' || v === 'low' ? v : 'normal';

const clampConfidence = (v: unknown): number => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0.6;
  return Math.max(0, Math.min(1, v));
};

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const ip =
    String(req.headers['x-forwarded-for'] ?? '')
      .split(',')[0]
      ?.trim() || 'unknown';
  if (!rateLimitOk(ip)) {
    res.status(429).json({ error: 'Rate limit exceeded — try again in an hour' });
    return;
  }

  const body = (req.body ?? {}) as ClassifyRequest;
  if (!body.subject && !body.snippet) {
    res.status(400).json({ error: 'subject or snippet required' });
    return;
  }

  try {
    // Plain "provider/model" string routes through the AI Gateway via
    // the OIDC token Vercel provisions automatically. No SDK wrapper or
    // explicit client needed.
    const { text } = await generateText({
      model: 'anthropic/claude-haiku-4.5',
      prompt: PROMPT(body),
      providerOptions: {
        gateway: {
          tags: ['feature:classify', 'env:demo'],
          // Fail over to a different provider if Anthropic is unavailable.
          models: ['openai/gpt-5.4'],
        },
      },
    });

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
    if (APICallError.isInstance(err)) {
      // 402: budget hit; 429: gateway-level user rate limit; 503: providers down.
      const status = err.statusCode ?? 500;
      res.status(status).json({ error: err.message });
      return;
    }
    console.error('[/api/classify] failed', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'unknown error' });
  }
}
