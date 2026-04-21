import { describe, it, expect, vi } from 'vitest';
import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/messages/messages';
import {
  AGENT_TOOL_DEFINITIONS,
  executeToolCall,
  type AgentTools,
} from './agent-tools';

function mkToolUse(id: string, name: string, input: unknown): ToolUseBlock {
  // caller shape is an open union; we only care about name + input at the
  // dispatch layer, so cast narrowly here.
  return { id, name, input, type: 'tool_use', caller: { type: 'direct' } as any };
}

describe('AGENT_TOOL_DEFINITIONS', () => {
  it('exports two tools with required properties', () => {
    expect(AGENT_TOOL_DEFINITIONS).toHaveLength(2);
    const names = AGENT_TOOL_DEFINITIONS.map(t => t.name);
    expect(names).toEqual(expect.arrayContaining(['find_similar_emails', 'get_sender_history']));
    for (const tool of AGENT_TOOL_DEFINITIONS) {
      expect(tool.description).toBeTruthy();
      expect(tool.input_schema.type).toBe('object');
    }
  });
});

describe('executeToolCall', () => {
  const tools: AgentTools = {
    findSimilarEmails: vi.fn().mockResolvedValue([
      { folder: 'Feed', similarity: 0.91, subject: 'Weekly digest', fromAddress: 'news@x.com' },
    ]),
    getSenderHistory: vi.fn().mockResolvedValue({ total: 3, byFolder: { Feed: 2, INBOX: 1 } }),
  };

  it('dispatches find_similar_emails', async () => {
    const result = await executeToolCall(mkToolUse('u1', 'find_similar_emails', { query: 'digest' }), tools);
    expect(result.tool_use_id).toBe('u1');
    expect(result.is_error).toBeUndefined();
    expect(JSON.parse(result.content).hits[0].folder).toBe('Feed');
    expect(tools.findSimilarEmails).toHaveBeenCalledWith('digest', 5);
  });

  it('clamps limit to the 1..10 range', async () => {
    await executeToolCall(mkToolUse('u2', 'find_similar_emails', { query: 'q', limit: 100 }), tools);
    expect(tools.findSimilarEmails).toHaveBeenLastCalledWith('q', 10);
    await executeToolCall(mkToolUse('u3', 'find_similar_emails', { query: 'q', limit: 0 }), tools);
    expect(tools.findSimilarEmails).toHaveBeenLastCalledWith('q', 1);
  });

  it('dispatches get_sender_history', async () => {
    const result = await executeToolCall(
      mkToolUse('u4', 'get_sender_history', { sender_address: 'news@x.com' }),
      tools,
    );
    expect(JSON.parse(result.content).total).toBe(3);
    expect(tools.getSenderHistory).toHaveBeenCalledWith('news@x.com');
  });

  it('returns is_error on unknown tool', async () => {
    const result = await executeToolCall(mkToolUse('u5', 'launch_missiles', {}), tools);
    expect(result.is_error).toBe(true);
    expect(JSON.parse(result.content).error).toMatch(/Unknown tool/);
  });

  it('converts handler exceptions into an is_error tool_result', async () => {
    const failing: AgentTools = {
      findSimilarEmails: vi.fn().mockRejectedValue(new Error('db unavailable')),
      getSenderHistory: vi.fn(),
    };
    const result = await executeToolCall(mkToolUse('u6', 'find_similar_emails', { query: 'q' }), failing);
    expect(result.is_error).toBe(true);
    expect(JSON.parse(result.content).error).toBe('db unavailable');
  });
});
