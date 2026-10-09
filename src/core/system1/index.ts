/**
 * System 1: the local, Jev-like decision layer.
 *
 * Frozen sentence embeddings + a few scalar features feed small linear
 * softmax heads. Each head answers typed questions with a confidence; a
 * threshold chosen with a finite-sample bound on disagreement with the
 * teacher (System 2) decides when to answer and when to escalate.
 */

export * from './types';
export * from './text';
export * from './settings';
export * from './linear-head';
export * from './confidence';
export * from './bounds';
export * from './threshold';
export * from './features';
export * from './decide';
export * from './serialize';
