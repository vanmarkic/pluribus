/**
 * Jev-style typed answers.
 *
 * A question gets a typed answer (a choice label, a 1..n score or a yes/no
 * with a probability) plus a confidence. The caller acts when `escalate` is
 * false and hands the question to the slower, smarter System 2 otherwise.
 *
 * A head answers only when it exists, is armed, fits the input and is at
 * least as confident as its calibrated threshold. An escalating answer from
 * a head that exists still carries the head's real prediction (shadow mode);
 * with no usable head it carries a neutral placeholder that must not be used.
 */

import { entropyConfidence } from './confidence';
import { predictProba } from './linear-head';
import { isCompatible } from './serialize';
import type {
  Answer,
  ChoiceQuestion,
  HeadRecord,
  NoulQuestion,
  Question,
  ScoreQuestion,
  System1Input,
} from './types';

function isFiniteVector(values: ArrayLike<number>): boolean {
  for (let i = 0; i < values.length; i++) {
    if (!Number.isFinite(values[i])) return false;
  }
  return true;
}

function flatten(input: System1Input): number[] {
  const x: number[] = new Array<number>(input.embedding.length + input.features.length);
  let at = 0;
  for (let i = 0; i < input.embedding.length; i++) x[at++] = input.embedding[i]!;
  for (let i = 0; i < input.features.length; i++) x[at++] = input.features[i]!;
  return x;
}

function labelsFit(question: Question, labels: readonly string[]): boolean {
  switch (question.kind) {
    case 'choice':
      return labels.length > 0 && labels.every((label) => question.options.includes(label));
    case 'score':
      return (
        labels.length === question.levels.length && labels.every((l, i) => l === String(i + 1))
      );
    case 'noul':
      return labels.length === 2 && labels[0] === 'false' && labels[1] === 'true';
  }
}

function argmax(values: readonly number[]): number {
  let best = 0;
  for (let i = 1; i < values.length; i++) if (values[i]! > values[best]!) best = i;
  return best;
}

/** Placeholder for "no usable head": uniform, zero confidence, always escalates. */
function neutral(question: Question): Answer {
  switch (question.kind) {
    case 'choice': {
      const share = question.options.length > 0 ? 1 / question.options.length : 0;
      return {
        kind: 'choice',
        questionId: question.id,
        value: question.options[0] ?? '',
        probabilities: Object.fromEntries(question.options.map((option) => [option, share])),
        confidence: 0,
        escalate: true,
      };
    }
    case 'score': {
      const levels = question.levels.length;
      return {
        kind: 'score',
        questionId: question.id,
        value: 1,
        probabilities: new Array<number>(levels).fill(levels > 0 ? 1 / levels : 0),
        confidence: 0,
        escalate: true,
      };
    }
    case 'noul':
      return {
        kind: 'noul',
        questionId: question.id,
        value: false,
        probability: 0.5,
        confidence: 0,
        escalate: true,
      };
  }
}

function typed(
  question: ChoiceQuestion | ScoreQuestion | NoulQuestion,
  labels: readonly string[],
  p: readonly number[],
  confidence: number,
  escalate: boolean,
): Answer {
  switch (question.kind) {
    case 'choice': {
      return {
        kind: 'choice',
        questionId: question.id,
        value: labels[argmax(p)]!,
        probabilities: Object.fromEntries(labels.map((label, i) => [label, p[i]!])),
        confidence,
        escalate,
      };
    }
    case 'score':
      return {
        kind: 'score',
        questionId: question.id,
        value: argmax(p) + 1,
        probabilities: [...p],
        confidence,
        escalate,
      };
    case 'noul': {
      const probability = p[1]!;
      return {
        kind: 'noul',
        questionId: question.id,
        value: probability >= 0.5,
        probability,
        confidence,
        escalate,
      };
    }
  }
}

/**
 * Answer one question from its head. Never throws: anything unexpected
 * (missing or foreign head, wrong dimension, corrupt weights, non-finite
 * input) escalates.
 */
export function answer(question: Question, head: HeadRecord | null, input: System1Input): Answer {
  if (!head) return neutral(question);

  const { weights } = head;
  if (weights.kind !== question.kind) return neutral(question);
  if (!labelsFit(question, weights.labels)) return neutral(question);

  const dim = input.embedding.length + input.features.length;
  if (!isCompatible(weights, dim)) return neutral(question);
  if (!isFiniteVector(input.embedding) || !isFiniteVector(input.features)) return neutral(question);

  let p: number[];
  try {
    p = predictProba(weights.W, weights.b, flatten(input));
  } catch {
    return neutral(question);
  }
  if (!isFiniteVector(p)) return neutral(question);

  const confidence = entropyConfidence(p);
  // `!(a >= b)` so a NaN threshold or confidence escalates instead of slipping through.
  const escalate = !head.armed || !(confidence >= head.threshold);
  return typed(question, weights.labels, p, confidence, escalate);
}

/** Answer several questions; a question without a head escalates. */
export function decide(
  questions: readonly Question[],
  heads: Readonly<Record<string, HeadRecord | null | undefined>>,
  input: System1Input,
): Answer[] {
  return questions.map((question) => answer(question, heads[question.id] ?? null, input));
}
