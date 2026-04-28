/**
 * Demo email fixtures.
 *
 * 30 hand-curated emails distributed across the triage folders so the
 * Sidebar counts feel real and clicking each folder actually changes
 * what's shown.
 *
 * `folder` is kept as a parallel map (`emailFolders`) so the `Email`
 * type stays unchanged; the renderer never sees the demo metadata.
 */

import type { Email, EmailBody } from '../../core/domain';

type Seed = {
  folder: string;
  subject: string;
  fromAddr: string;
  fromName: string | null;
  hoursAgo: number;
  snippet: string;
  isRead?: boolean;
  isStarred?: boolean;
  hasAttachments?: boolean;
  body?: { text: string; html: string };
};

const seeds: Seed[] = [
  // --- INBOX (mix of work, personal) ---
  {
    folder: 'INBOX',
    subject: 'Welcome to Pluribus — quick tour',
    fromAddr: 'hello@pluribus.app',
    fromName: 'Pluribus',
    hoursAgo: 0.2,
    snippet:
      "Welcome — this is a live demo. Try the AI sort button (sparkle icon) to classify any email, or drag emails between folders. All data here is fictional.",
    isStarred: true,
    body: {
      text:
        "Welcome to the Pluribus demo.\n\nThis inbox is fully fictional but the AI classifier is real — it calls Claude via a backend proxy.\n\nThings to try:\n- Click the sparkle icon to classify an email\n- Drag an email to a different folder\n- Press '?' to see keyboard shortcuts\n- Watch the inbox: a new email arrives every minute or two",
      html:
        "<h2>Welcome to the Pluribus demo</h2><p>This inbox is fully fictional but the AI classifier is real — it calls Claude via a backend proxy.</p><h3>Things to try</h3><ul><li>Click the sparkle icon to classify an email</li><li>Drag an email to a different folder</li><li>Press <code>?</code> for keyboard shortcuts</li><li>Watch the inbox: a new email arrives every minute or two</li></ul>",
    },
  },
  {
    folder: 'INBOX',
    subject: 'Q2 roadmap review — agenda attached',
    fromAddr: 'priya.shah@nimbus.co',
    fromName: 'Priya Shah',
    hoursAgo: 1.5,
    snippet:
      "Sending the agenda ahead of Wednesday's roadmap review. The biggest item is the migration deadline — we need a call on whether we hold or push.",
    hasAttachments: true,
  },
  {
    folder: 'INBOX',
    subject: 'Re: design tokens migration',
    fromAddr: 'mateus@nimbus.co',
    fromName: 'Mateus Rocha',
    hoursAgo: 4,
    snippet:
      "Yeah, I think we should pull semantic tokens out of the legacy package and ship them separately. Lower blast radius. Free this afternoon if you want to pair on it.",
  },
  {
    folder: 'INBOX',
    subject: 'birthday next weekend?',
    fromAddr: 'sara.bourdier@gmail.com',
    fromName: 'Sara',
    hoursAgo: 8,
    snippet:
      "hey! we're doing dinner saturday for marc's 35th — small place near canal saint-martin. count you in? bring whoever",
    isStarred: true,
  },
  {
    folder: 'INBOX',
    subject: 'Production alert: p99 latency above SLO',
    fromAddr: 'alerts@grafana.nimbus.co',
    fromName: 'Grafana Alerts',
    hoursAgo: 12,
    snippet:
      "Service: api-gateway. p99 has been above 850ms for 14 minutes. Triggered by deploy abc123. Runbook: https://wiki.nimbus.co/runbooks/api-gateway-latency",
    isRead: true,
  },
  {
    folder: 'INBOX',
    subject: 'Doctor follow-up — appointment available',
    fromAddr: 'noreply@docto.fr',
    fromName: 'Docto',
    hoursAgo: 30,
    snippet:
      "Dr. Lefèvre has an opening Tuesday Apr 30 at 11:20. To confirm, click the link below. This appointment will be released after 24 hours.",
    isRead: true,
  },

  // --- Planning ---
  {
    folder: 'Planning',
    subject: 'Calendar invite: Hiring sync — Frontend Eng',
    fromAddr: 'calendar@google.com',
    fromName: 'Google Calendar',
    hoursAgo: 6,
    snippet:
      "You have been invited to: Hiring sync — Frontend Eng. When: Wed Apr 30, 10:00–10:30 CET. Where: Meet (link). Organizer: Lena Park.",
    isRead: true,
  },
  {
    folder: 'Planning',
    subject: 'Action items from Monday standup',
    fromAddr: 'lena.park@nimbus.co',
    fromName: 'Lena Park',
    hoursAgo: 26,
    snippet:
      "Quick recap. (1) Mateus owns the tokens migration spike. (2) You own the RTK Query rollout. (3) I'll talk to legal about the EU residency requirement.",
    isRead: true,
  },
  {
    folder: 'Planning',
    subject: 'Reminder: Tax declaration deadline May 23',
    fromAddr: 'reminder@todoist.com',
    fromName: 'Todoist',
    hoursAgo: 50,
    snippet:
      "Your reminder: 'File tax declaration' is scheduled for May 23. You set this 4 weeks ago. Mark complete when filed.",
    isRead: true,
  },

  // --- Review ---
  {
    folder: 'Review',
    subject: '[PR] feat(emails): optimistic star toggle',
    fromAddr: 'notifications@github.com',
    fromName: 'GitHub',
    hoursAgo: 3,
    snippet:
      "vanmarkic opened a pull request: feat(emails): optimistic star toggle. Reviewers: you. CI: passing. +124 −38.",
  },
  {
    folder: 'Review',
    subject: 'Design review: Sidebar redesign v3',
    fromAddr: 'figma@nimbus.co',
    fromName: 'Figma',
    hoursAgo: 18,
    snippet:
      "Anya Volkov shared a design with you for review: 'Sidebar redesign v3'. Comment by Friday so we can ship next sprint.",
    isRead: true,
  },

  // --- Feed (newsletters, blog digests) ---
  {
    folder: 'Feed',
    subject: 'JavaScript Weekly #1234',
    fromAddr: 'editor@javascriptweekly.com',
    fromName: 'JavaScript Weekly',
    hoursAgo: 5,
    snippet:
      "This week: React 19.2 ships server actions GA. TC39 advances Iterator Helpers to Stage 4. Node.js 24 drops. Plus: a deep dive on RTK Query custom baseQueries.",
    isRead: true,
  },
  {
    folder: 'Feed',
    subject: 'The Pragmatic Engineer: scaling on-call',
    fromAddr: 'gergely@pragmaticengineer.com',
    fromName: 'Gergely Orosz',
    hoursAgo: 28,
    snippet:
      "How three companies (Stripe, Cloudflare, Vercel) structure their on-call rotations. Long read — 22 min — with org charts and post-mortem excerpts.",
    isRead: true,
  },
  {
    folder: 'Feed',
    subject: 'Anthropic: Constitutional AI 2.0',
    fromAddr: 'newsletter@anthropic.com',
    fromName: 'Anthropic',
    hoursAgo: 60,
    snippet:
      "We're publishing the second iteration of Constitutional AI. Key changes: per-domain principles, multi-agent debate during training, and sharper refusal calibration.",
    isRead: true,
  },
  {
    folder: 'Feed',
    subject: 'Substack: weekend reads, Apr 26',
    fromAddr: 'no-reply@substack.com',
    fromName: 'Substack',
    hoursAgo: 80,
    snippet:
      "5 reads from your subscriptions. Top: 'Why Electron lost the developer mindshare battle' by Lea Verou. Also: a profile of the Linear engineering team.",
    isRead: true,
  },

  // --- Social ---
  {
    folder: 'Social',
    subject: 'Anya Volkov mentioned you in a post',
    fromAddr: 'notify@linkedin.com',
    fromName: 'LinkedIn',
    hoursAgo: 4,
    snippet:
      "Anya Volkov: 'Just shipped a brutal RTK Query migration with @vanmarkic — the IPC base query trick is genuinely elegant. Recommended read for any Electron team.'",
  },
  {
    folder: 'Social',
    subject: '3 new followers this week',
    fromAddr: 'noreply@github.com',
    fromName: 'GitHub',
    hoursAgo: 36,
    snippet:
      "@miragel, @pchen, and @jdoe followed you this week. Your repos got 24 stars. Your top repo: pluribus (mail client).",
    isRead: true,
  },
  {
    folder: 'Social',
    subject: '"Nice work on the Storybook setup!"',
    fromAddr: 'discord@discord.com',
    fromName: 'Discord',
    hoursAgo: 70,
    snippet:
      "1 new mention in #frontend-guild on Reactiflux. mateus: 'nice work on the storybook setup vanmarkic — clean preview decorators 👌'",
    isRead: true,
  },

  // --- Promotions ---
  {
    folder: 'Promotions',
    subject: 'Final hours: 40% off the Pro plan',
    fromAddr: 'sales@linear.app',
    fromName: 'Linear',
    hoursAgo: 2,
    snippet:
      "Annual plans at 40% off until midnight UTC. Includes unlimited workspaces, the new Insights dashboard, and the Roadmap planning tool.",
  },
  {
    folder: 'Promotions',
    subject: 'You earned a $20 credit',
    fromAddr: 'rewards@vercel.com',
    fromName: 'Vercel',
    hoursAgo: 18,
    snippet:
      "Thanks for being a Hobby user. We're crediting $20 toward your next Pro upgrade. Credit expires in 30 days. Apply at checkout — no code needed.",
    isRead: true,
  },
  {
    folder: 'Promotions',
    subject: 'New from Notion AI: meeting notes',
    fromAddr: 'team@notion.so',
    fromName: 'Notion',
    hoursAgo: 50,
    snippet:
      "Notion AI now joins your meetings, takes notes, and files them where they belong. Free for the first 100 minutes per month on every workspace.",
    isRead: true,
  },
  {
    folder: 'Promotions',
    subject: 'Free shipping this weekend only',
    fromAddr: 'hello@muji.eu',
    fromName: 'Muji',
    hoursAgo: 96,
    snippet:
      "Free shipping on orders over €40 — Saturday and Sunday only. New spring collection just dropped, including the linen overshirt that sold out last year.",
    isRead: true,
  },

  // --- Paper-Trail/Invoices ---
  {
    folder: 'Paper-Trail/Invoices',
    subject: 'Invoice INV-2026-0428 from Anthropic',
    fromAddr: 'billing@anthropic.com',
    fromName: 'Anthropic Billing',
    hoursAgo: 7,
    snippet:
      "Invoice INV-2026-0428. Period: Apr 1–30. Total: $42.18 USD. API usage: 1.4M input tokens, 220K output tokens. Auto-charged to card ending 4242.",
    hasAttachments: true,
  },
  {
    folder: 'Paper-Trail/Invoices',
    subject: 'Receipt: Vercel Pro — €20.00',
    fromAddr: 'receipts@vercel.com',
    fromName: 'Vercel',
    hoursAgo: 40,
    snippet:
      "Thanks — your monthly Vercel Pro subscription has renewed. €20.00 charged to your card. Receipt PDF attached. Next billing: May 27.",
    hasAttachments: true,
    isRead: true,
  },
  {
    folder: 'Paper-Trail/Invoices',
    subject: 'Your March electricity bill — €78.40',
    fromAddr: 'noreply@engie.fr',
    fromName: 'Engie',
    hoursAgo: 110,
    snippet:
      "Your March 2026 bill is now available. Amount: €78.40. Direct debit on Apr 30. View detail and consumption history in your customer area.",
    isRead: true,
  },

  // --- Paper-Trail/Admin ---
  {
    folder: 'Paper-Trail/Admin',
    subject: '[Action required] URSSAF — declaration trimestrielle',
    fromAddr: 'noreply@urssaf.fr',
    fromName: 'URSSAF',
    hoursAgo: 24,
    snippet:
      "Votre déclaration trimestrielle est disponible. Date limite: 30 avril. Connectez-vous à votre espace pour valider et payer en ligne.",
  },
  {
    folder: 'Paper-Trail/Admin',
    subject: 'Lease renewal — 2026 → 2029',
    fromAddr: 'gestion@imo-paris.fr',
    fromName: 'Immobilier Paris',
    hoursAgo: 58,
    snippet:
      "Veuillez trouver ci-joint la proposition de renouvellement de bail pour la période 2026–2029. Loyer indexé selon l'IRL Q4 2025. Merci de retourner signé sous 30 jours.",
    hasAttachments: true,
    isRead: true,
  },

  // --- Paper-Trail/Travel ---
  {
    folder: 'Paper-Trail/Travel',
    subject: 'Booking confirmation — Paris → Lisbon, May 14',
    fromAddr: 'noreply@tap.pt',
    fromName: 'TAP Air Portugal',
    hoursAgo: 10,
    snippet:
      "Reservation TP-PXX9F2 confirmed. Outbound: CDG → LIS, May 14, 09:35–11:45 (TP433). Return: LIS → CDG, May 18, 18:10–22:25 (TP442). Online check-in 30h before.",
    hasAttachments: true,
    isStarred: true,
  },
  {
    folder: 'Paper-Trail/Travel',
    subject: 'Hotel reservation — Memmo Alfama, Lisbon',
    fromAddr: 'reservations@memmoalfama.com',
    fromName: 'Memmo Alfama',
    hoursAgo: 32,
    snippet:
      "We've confirmed your stay May 14–18. Room: Tejo Suite, river view. Check-in from 15:00. Reply to this email if you'd like to arrange airport transfer.",
    isRead: true,
  },

  // --- Sent ---
  {
    folder: 'Sent',
    subject: "Re: Q2 roadmap review — agenda attached",
    fromAddr: 'me@pluribus.demo',
    fromName: 'You',
    hoursAgo: 1.4,
    snippet:
      "Thanks Priya — agenda looks right. My read on the migration: we hold for one more sprint. The auth changes need a clean window. Talk Wednesday.",
    isRead: true,
  },
];

const FOLDER_TO_ID: Record<string, number> = {
  INBOX: 1,
  Sent: 2,
  Drafts: 3,
  Archive: 4,
  Trash: 5,
  Planning: 10,
  Review: 11,
  Feed: 12,
  Social: 13,
  Promotions: 14,
  'Paper-Trail/Invoices': 20,
  'Paper-Trail/Admin': 21,
  'Paper-Trail/Travel': 22,
};

export type DemoEmail = Email & { __folder: string };

let nextId = 1;
const buildEmail = (seed: Seed): DemoEmail => {
  const id = nextId++;
  return {
    id,
    messageId: `demo-${id}@pluribus.app`,
    accountId: 1,
    folderId: FOLDER_TO_ID[seed.folder] ?? 1,
    uid: 1000 + id,
    subject: seed.subject,
    from: { address: seed.fromAddr, name: seed.fromName },
    to: ['demo@pluribus.app'],
    date: new Date(Date.now() - seed.hoursAgo * 60 * 60 * 1000),
    snippet: seed.snippet,
    sizeBytes: 1500 + Math.floor(seed.snippet.length * 8),
    isRead: seed.isRead ?? false,
    isStarred: seed.isStarred ?? false,
    hasAttachments: seed.hasAttachments ?? false,
    bodyFetched: !!seed.body,
    inReplyTo: null,
    references: null,
    threadId: null,
    awaitingReply: false,
    awaitingReplySince: null,
    listUnsubscribe: null,
    listUnsubscribePost: null,
    __folder: seed.folder,
  };
};

const initial = seeds.map(buildEmail);

const initialBodies: Record<number, EmailBody> = {};
seeds.forEach((seed, idx) => {
  if (seed.body) {
    const email = initial[idx];
    if (email) initialBodies[email.id] = seed.body;
  }
});

export const demoFixtures = {
  emails: initial,
  bodies: initialBodies,
  nextEmailId: () => nextId++,
  folderIdFor: (folder: string) => FOLDER_TO_ID[folder] ?? 1,
};

/**
 * Drip seeds — synthetic "incoming" emails the live timer rotates through.
 * Each one is realistic but uses obviously fictional senders so it's clear
 * the demo isn't connected to anything.
 */
export const dripSeeds: Seed[] = [
  {
    folder: 'INBOX',
    subject: 'CI failed on main: tests/imap.test.ts',
    fromAddr: 'ci@nimbus.co',
    fromName: 'CI',
    hoursAgo: 0,
    snippet:
      "Build #2841 failed. 1 test failure: tests/imap.test.ts › idle reconnects after timeout. Last commit: 'chore: bump imapflow'.",
  },
  {
    folder: 'INBOX',
    subject: 'Mateus shared a doc: "Tokens v3 — proposal"',
    fromAddr: 'docs-noreply@nimbus.co',
    fromName: 'Nimbus Docs',
    hoursAgo: 0,
    snippet:
      "Mateus Rocha shared a document with you: 'Tokens v3 — proposal'. Comment access. Looking for feedback by Friday.",
  },
  {
    folder: 'Feed',
    subject: 'TLDR newsletter — daily digest',
    fromAddr: 'tldr@tldrnewsletter.com',
    fromName: 'TLDR',
    hoursAgo: 0,
    snippet:
      "Top stories: OpenAI rolls back GPT-4o updates after sycophancy reports. Apple Vision Pro ships in France. Vercel acquires Turbopack maintainer.",
  },
  {
    folder: 'Promotions',
    subject: 'New limited edition just dropped',
    fromAddr: 'newsletter@aesop.com',
    fromName: 'Aesop',
    hoursAgo: 0,
    snippet:
      "The Marrakech Intense Eau de Toilette returns for a limited spring edition. Available online and in-store. Free sample with every order over €60.",
  },
  {
    folder: 'Social',
    subject: 'You have 1 new connection request',
    fromAddr: 'invitations@linkedin.com',
    fromName: 'LinkedIn',
    hoursAgo: 0,
    snippet:
      "Sofia Andersson, Engineering Manager at Klarna, would like to connect. You both worked at Nimbus. View profile to accept.",
  },
];
