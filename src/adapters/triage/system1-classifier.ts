/**
 * System 1 decorator
 *
 * Wraps a TriageClassifier (System 2, the LLM) with the local decision heads.
 * Everything here runs on-device: the email is embedded locally, three small
 * heads answer (folder, needs-reply, importance) and, only when ALL of them
 * are armed and at least as confident as their calibrated thresholds, the
 * answer is returned without calling the wrapped classifier.
 *
 * - otherwise the question goes to System 2, and any System 1 prediction that
 *   exists is only logged (shadow agreement), never used to disarm a head;
 * - a small share of confident answers (`auditRate`) is ALSO sent to System 2.
 *   The teacher wins on those: its result is returned and the agreement is
 *   recorded, so drift disarms a head;
 * - any System 1 failure falls back to System 2. System 1 must never be the
 *   reason a classification fails.
 *
 * Compose it just inside signal recording and outside body privacy:
 *   withSignalRecording(withSystem1(withBodyPrivacy(enhanced)), ...)
 * It may see the body preview (it never leaves the device); body privacy still
 * strips it before any cloud LLM.
 */

import {
  TRIAGE_FOLDERS,
  type Email,
  type ImportanceLevel,
  type System1Settings,
  type TriageClassificationResult,
  type TriageFolder,
} from '../../core/domain';
import type {
  PatternMatchResult,
  System1HeadRepo,
  TriageClassifier,
  TriageClassifyOptions,
} from '../../core/ports';
import { buildFeatures, buildInput } from '../../core/system1/features';
import { decide } from '../../core/system1/decide';
import { system1Text } from '../../core/system1/text';
import {
  EMAIL_QUESTIONS,
  type Answer,
  type ChoiceAnswer,
  type HeadRecord,
  type NoulAnswer,
  type Question,
  type ScoreAnswer,
} from '../../core/system1/types';

/** How long loaded heads are reused before the next lookup (a retrain shows up within this). */
const HEAD_CACHE_TTL_MS = 60_000;

const QUESTIONS: readonly Question[] = [
  EMAIL_QUESTIONS.folder,
  EMAIL_QUESTIONS.needsReply,
  EMAIL_QUESTIONS.importance,
];

export type System1ClassifierDeps = {
  /** Only `getLatest` is used. */
  heads: Pick<System1HeadRepo, 'getLatest'>;
  /** Local encoder. Must produce the same vectors training used (same model, same text). */
  embed: (text: string) => Promise<Float32Array>;
  myAddressFor: (accountId: number) => Promise<string>;
  priorRepliesToSender: (accountId: number, address: string) => Promise<number>;
  getSettings: () => System1Settings;
  recordAudit: (o: { questionId: string; version: number; agreed: boolean }) => Promise<void>;
  /** Persist the vector so training uses the identical one. */
  storeEmbedding?: (emailId: number, vector: Float32Array) => Promise<void>;
  /** Id of the encoder actually producing vectors; defaults to `getSettings().embeddingModel`. */
  embeddingModel?: () => string;
  rng?: () => number;
  /** Diagnostics only. Never receives mail content. */
  log?: (msg: string, meta?: object) => void;
  /** Clock for the head cache (tests). */
  now?: () => number;
};

type Heads = Record<string, HeadRecord | null>;

type Local = {
  /** Heads that exist and were trained on the current encoder. */
  heads: Heads;
  folder: ChoiceAnswer;
  needsReply: NoulAnswer;
  importance: ScoreAnswer;
};

const asChoice = (a: Answer | undefined): ChoiceAnswer => {
  if (a?.kind !== 'choice') throw new Error('System 1: expected a choice answer');
  return a;
};
const asNoul = (a: Answer | undefined): NoulAnswer => {
  if (a?.kind !== 'noul') throw new Error('System 1: expected a noul answer');
  return a;
};
const asScore = (a: Answer | undefined): ScoreAnswer => {
  if (a?.kind !== 'score') throw new Error('System 1: expected a score answer');
  return a;
};

const percent = (value: number): string => `${Math.round(value * 100)}%`;
const isTriageFolder = (value: string): value is TriageFolder =>
  (TRIAGE_FOLDERS as readonly string[]).includes(value);
const isImportance = (value: number): value is ImportanceLevel =>
  value === 1 || value === 2 || value === 3 || value === 4;

type Comparison = { folder: boolean; needsReply: boolean | null; importance: boolean | null };

/** System 1 versus the teacher. Fields the teacher did not return are not comparable (null). */
function compare(local: Local, teacher: TriageClassificationResult): Comparison {
  return {
    folder: teacher.folder === local.folder.value,
    needsReply:
      teacher.needsReply === undefined
        ? null
        : teacher.needsReply >= 0.5 === local.needsReply.value,
    importance:
      teacher.importance === undefined
        ? null
        : Math.abs(teacher.importance - local.importance.value) <= 1,
  };
}

export function withSystem1(
  inner: TriageClassifier,
  deps: System1ClassifierDeps,
): TriageClassifier {
  const log = deps.log ?? (() => {});
  const now = deps.now ?? Date.now;
  const rng = deps.rng ?? Math.random;

  let cache: { heads: Heads; loadedAt: number } | null = null;
  let loading: Promise<Heads> | null = null;

  function loadHeads(): Promise<Heads> {
    if (cache && now() - cache.loadedAt < HEAD_CACHE_TTL_MS) return Promise.resolve(cache.heads);
    if (loading) return loading;
    const pending: Promise<Heads> = (async () => {
      const entries = await Promise.all(
        QUESTIONS.map(async (q) => [q.id, await deps.heads.getLatest(q.id)] as const),
      );
      const heads: Heads = Object.fromEntries(entries);
      cache = { heads, loadedAt: now() };
      return heads;
    })().finally(() => {
      if (loading === pending) loading = null;
    });
    loading = pending;
    return pending;
  }

  /** Embed, store and ask the heads. Returns null when no usable head exists yet. */
  async function askLocal(
    email: Email,
    settings: System1Settings,
    opts: TriageClassifyOptions | undefined,
  ): Promise<Local | null> {
    const vector = await deps.embed(system1Text(email, opts?.bodyPreview));

    if (deps.storeEmbedding) {
      try {
        await deps.storeEmbedding(email.id, vector);
      } catch (error) {
        log('System 1: could not store the embedding', { emailId: email.id, error: String(error) });
      }
    }

    const model = deps.embeddingModel?.() ?? settings.embeddingModel;
    const loaded = await loadHeads();
    const heads: Heads = {};
    for (const q of QUESTIONS) {
      const head = loaded[q.id] ?? null;
      heads[q.id] = head && head.embeddingModel === model ? head : null;
    }
    if (!Object.values(heads).some((head) => head !== null)) return null;

    const [myAddress, priorReplies] = await Promise.all([
      deps.myAddressFor(email.accountId),
      deps.priorRepliesToSender(email.accountId, email.from.address),
    ]);
    const features = buildFeatures(email, { myAddress, priorRepliesToSender: priorReplies });
    const answers = decide(QUESTIONS, heads, buildInput(vector, features));
    return {
      heads,
      folder: asChoice(answers[0]),
      needsReply: asNoul(answers[1]),
      importance: asScore(answers[2]),
    };
  }

  function toResult(
    local: Local,
    patternHint: PatternMatchResult,
  ): TriageClassificationResult | null {
    const folder = local.folder.value;
    const importance = local.importance.value;
    if (!isTriageFolder(folder) || !isImportance(importance)) return null;
    return {
      folder,
      tags: [],
      confidence: local.folder.confidence,
      patternHint: patternHint.folder,
      patternAgreed: folder === patternHint.folder,
      reasoning:
        `On-device model (System 1): ${folder} (${percent(local.folder.confidence)} sure), ` +
        `needs reply ${percent(local.needsReply.probability)}, importance ${importance}/4`,
      needsReply: local.needsReply.probability,
      importance,
      source: 'system1',
    };
  }

  async function recordAudits(local: Local, teacher: TriageClassificationResult): Promise<boolean> {
    const verdict = compare(local, teacher);
    const audits: { questionId: string; agreed: boolean | null }[] = [
      { questionId: EMAIL_QUESTIONS.folder.id, agreed: verdict.folder },
      { questionId: EMAIL_QUESTIONS.needsReply.id, agreed: verdict.needsReply },
      { questionId: EMAIL_QUESTIONS.importance.id, agreed: verdict.importance },
    ];
    let recorded = false;
    for (const audit of audits) {
      const head = local.heads[audit.questionId];
      if (audit.agreed === null || !head) continue;
      try {
        await deps.recordAudit({
          questionId: audit.questionId,
          version: head.version,
          agreed: audit.agreed,
        });
        recorded = true;
      } catch (error) {
        log('System 1: could not record an audit', {
          questionId: audit.questionId,
          error: String(error),
        });
      }
    }
    return recorded;
  }

  return {
    async classify(email, patternHint, examples, opts) {
      const callInner = () =>
        opts === undefined
          ? inner.classify(email, patternHint, examples)
          : inner.classify(email, patternHint, examples, opts);

      if (opts?.forceSystem2) return callInner();

      // System 1 work is isolated in these two blocks: whatever goes wrong in them (and only
      // there) falls back to System 2, and System 2 itself is never called from inside a `try`.
      let settings: System1Settings | null = null;
      try {
        settings = deps.getSettings();
      } catch (error) {
        log('System 1 error, escalating to System 2', { emailId: email.id, error: String(error) });
      }
      if (!settings?.enabled) return callInner();

      let local: Local | null = null;
      try {
        local = await askLocal(email, settings, opts);
      } catch (error) {
        log('System 1 error, escalating to System 2', { emailId: email.id, error: String(error) });
      }
      if (!local) return callInner();

      const confident =
        !local.folder.escalate && !local.needsReply.escalate && !local.importance.escalate;
      const answer = confident ? toResult(local, patternHint) : null;

      if (!answer) {
        // Shadow / escalate: System 2 decides. Note how often System 1 would have agreed.
        const teacher = await callInner();
        if (teacher.source === 'llm') {
          log('System 1 shadow comparison', {
            emailId: email.id,
            ...compare(local, teacher),
            escalated: [local.folder, local.needsReply, local.importance]
              .filter((a) => a.escalate)
              .map((a) => a.questionId),
          });
        }
        return teacher;
      }

      const audit = Number.isFinite(settings.auditRate) && rng() < settings.auditRate;
      if (!audit) return answer;

      let teacher: TriageClassificationResult;
      try {
        teacher = await callInner();
      } catch (error) {
        log('System 1: audit skipped, System 2 failed', {
          emailId: email.id,
          error: String(error),
        });
        return answer;
      }
      // A fallback (pattern/vector) result is not the teacher's opinion: do not audit against it.
      if (teacher.source !== 'llm') return answer;

      if (await recordAudits(local, teacher)) {
        // A disarm caused by this audit must apply to the very next email.
        cache = null;
      }
      return teacher;
    },
  };
}
