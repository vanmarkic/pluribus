/**
 * Awaiting Reply Use Cases
 *
 * Task 9: Awaiting Detection Use Case
 *
 * Manages the "Awaiting Reply" feature:
 * - shouldTrackAwaiting: Decides if sent email should be tracked
 *   - Fast path: If body contains `?`, return true immediately
 *   - Slow path: Use LLM to classify (Mistral 7B via Ollama)
 * - markAwaiting, clearAwaiting: Set/clear the awaiting flag
 * - clearAwaitingByReply: Auto-clear when reply arrives
 * - getAwaitingList: Get all awaiting emails for virtual folder
 */

import type { AwaitingRepo } from '../../adapters/db/awaiting-repo';
import type { Email } from '../domain';

type LLMPort = {
  generate(prompt: string): Promise<string>;
};

type Deps = {
  awaiting: AwaitingRepo;
  llm: LLMPort;
};

export const shouldTrackAwaiting = (deps: Pick<Deps, 'llm'>) =>
  async (body: string): Promise<boolean> => {
    // Fast path: contains question mark
    if (body.includes('?')) {
      return true;
    }

    // Slow path: LLM classification
    try {
      const result = await deps.llm.generate(
        `Does this email expect a reply? Answer only "yes" or "no".\n\n${body.slice(0, 1000)}`
      );
      return result.toLowerCase().includes('yes');
    } catch {
      // If LLM fails, default to not tracking
      return false;
    }
  };

export const markAwaiting = (deps: Pick<Deps, 'awaiting'>) =>
  async (emailId: number): Promise<void> => {
    await deps.awaiting.markAwaiting(emailId);
  };

export const clearAwaiting = (deps: Pick<Deps, 'awaiting'>) =>
  async (emailId: number): Promise<void> => {
    await deps.awaiting.clearAwaiting(emailId);
  };

export const clearAwaitingByReply = (deps: Pick<Deps, 'awaiting'>) =>
  async (inReplyToMessageId: string): Promise<number | null> => {
    return deps.awaiting.clearByReply(inReplyToMessageId);
  };

export const getAwaitingList = (deps: Pick<Deps, 'awaiting'>) =>
  async (accountId: number): Promise<Email[]> => {
    return deps.awaiting.getAwaitingList(accountId);
  };
