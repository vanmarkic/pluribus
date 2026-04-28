/**
 * Agent tools for the email-triage classifier (#87).
 *
 * When a single-turn classification returns low confidence, the classifier
 * runs an agent loop. The model can call these tools to gather additional
 * evidence before producing a final JSON classification.
 *
 * Tools are deliberately narrow and read-only: they let the model reason
 * over what the user has classified before and what looks semantically
 * similar, without giving it authority to mutate state.
 */

import type { Tool, ToolUseBlock } from '@anthropic-ai/sdk/resources/messages/messages';

export type SimilarEmailHit = {
  folder: string;
  similarity: number;
  subject: string;
  fromAddress: string;
};

export type SenderHistorySummary = {
  total: number;
  // Folder name → count of past emails from this sender classified into that folder
  byFolder: Record<string, number>;
};

/**
 * Handlers the container must provide. Each handler wraps an existing
 * adapter (vectorSearch, emails repo, classificationState repo).
 */
export type AgentTools = {
  findSimilarEmails: (queryText: string, limit?: number) => Promise<SimilarEmailHit[]>;
  getSenderHistory: (senderAddress: string) => Promise<SenderHistorySummary>;
};

/**
 * JSON Schema tool definitions shipped to Claude. Kept separate from the
 * handlers so the schemas can be versioned and cached via prompt caching.
 */
export const AGENT_TOOL_DEFINITIONS: Tool[] = [
  {
    name: 'find_similar_emails',
    description:
      'Find the most semantically similar emails the user has already seen. ' +
      'Returns their subjects and the folder each was classified into. Use this ' +
      'to check whether similar emails have consistently been routed to one folder.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'A short text query derived from the email (e.g. subject + first sentence of body). ' +
            'Keep it under 200 characters.',
        },
        limit: {
          type: 'integer',
          description: 'Maximum number of similar emails to return (1–10).',
          minimum: 1,
          maximum: 10,
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_sender_history',
    description:
      'Look up how past emails from the same sender address were classified. ' +
      'Returns counts by folder. Use this when the sender is the primary signal ' +
      '(e.g. a newsletter, an invoice provider, a recruiter).',
    input_schema: {
      type: 'object',
      properties: {
        sender_address: {
          type: 'string',
          description: 'The full email address of the sender (e.g. "billing@acme.com").',
        },
      },
      required: ['sender_address'],
    },
  },
];

/** Result of executing one tool call. */
export type ToolExecutionResult = {
  tool_use_id: string;
  content: string;      // JSON-serialised for the model to consume
  is_error?: boolean;
};

/**
 * Dispatch a ToolUseBlock to the matching handler. Any thrown error is
 * converted to an is_error tool_result so the model can observe failure
 * and adapt rather than the loop crashing.
 */
export async function executeToolCall(
  block: ToolUseBlock,
  tools: AgentTools
): Promise<ToolExecutionResult> {
  try {
    const input = (block.input ?? {}) as Record<string, unknown>;
    switch (block.name) {
      case 'find_similar_emails': {
        const query = String(input.query ?? '').slice(0, 400);
        const limit = typeof input.limit === 'number' ? Math.min(Math.max(1, input.limit), 10) : 5;
        const hits = await tools.findSimilarEmails(query, limit);
        return {
          tool_use_id: block.id,
          content: JSON.stringify({ hits }),
        };
      }
      case 'get_sender_history': {
        const sender = String(input.sender_address ?? '').slice(0, 320);
        const summary = await tools.getSenderHistory(sender);
        return {
          tool_use_id: block.id,
          content: JSON.stringify(summary),
        };
      }
      default:
        return {
          tool_use_id: block.id,
          content: JSON.stringify({ error: `Unknown tool: ${block.name}` }),
          is_error: true,
        };
    }
  } catch (err) {
    return {
      tool_use_id: block.id,
      content: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      is_error: true,
    };
  }
}
