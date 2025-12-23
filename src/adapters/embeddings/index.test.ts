/**
 * Embedding Service Tests
 */

import { describe, it, expect } from 'vitest';
import { createEmbeddingService, serializeEmbedding, deserializeEmbedding, prepareEmailText } from './index';

describe('EmbeddingService', () => {
  it.skip('should generate embeddings of correct dimension', async () => {
    // Skipped: requires network access to download model
    const service = createEmbeddingService();
    const embedding = await service.embed('Hello, world!');

    expect(embedding).toBeDefined();
    expect(embedding.length).toBe(384); // all-MiniLM-L6-v2 dimension
    expect(embedding.every((v) => typeof v === 'number')).toBe(true);
  });

  it.skip('should generate normalized embeddings', async () => {
    // Skipped: requires network access to download model
    const service = createEmbeddingService();
    const embedding = await service.embed('Test email content');

    // Calculate magnitude
    const magnitude = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));

    // Should be approximately 1.0 (normalized)
    expect(magnitude).toBeCloseTo(1.0, 2);
  });

  it.skip('should generate similar embeddings for similar text', async () => {
    // Skipped: requires network access to download model
    const service = createEmbeddingService();

    const emb1 = await service.embed('Your invoice for December');
    const emb2 = await service.embed('Receipt for payment in December');
    const emb3 = await service.embed('Meeting scheduled for tomorrow');

    const sim12 = service.similarity(emb1, emb2);
    const sim13 = service.similarity(emb1, emb3);

    // Invoice/receipt should be more similar than invoice/meeting
    expect(sim12).toBeGreaterThan(sim13);
    expect(sim12).toBeGreaterThan(0.5); // Should be fairly similar
  });

  it('should calculate cosine similarity correctly', () => {
    const service = createEmbeddingService();

    // Identical vectors
    const v1 = [1, 0, 0];
    expect(service.similarity(v1, v1)).toBeCloseTo(1.0);

    // Orthogonal vectors (normalized)
    const v2 = [1 / Math.sqrt(2), 1 / Math.sqrt(2), 0];
    const v3 = [1 / Math.sqrt(2), -1 / Math.sqrt(2), 0];
    expect(service.similarity(v2, v3)).toBeCloseTo(0.0, 2);

    // Opposite vectors
    const v4 = [1, 0, 0];
    const v5 = [-1, 0, 0];
    expect(service.similarity(v4, v5)).toBeCloseTo(-1.0);
  });

  it('should throw on dimension mismatch', () => {
    const service = createEmbeddingService();

    expect(() => {
      service.similarity([1, 2, 3], [1, 2]);
    }).toThrow('dimension mismatch');
  });

  it('should return model identifier', () => {
    const service = createEmbeddingService();
    expect(service.getModel()).toBe('all-MiniLM-L6-v2');
  });
});

describe('Vector Serialization', () => {
  it('should serialize and deserialize correctly', () => {
    const original = [0.1, 0.2, 0.3, -0.4, -0.5];
    const serialized = serializeEmbedding(original);
    const deserialized = deserializeEmbedding(serialized);

    expect(deserialized.length).toBe(original.length);
    deserialized.forEach((v, i) => {
      expect(v).toBeCloseTo(original[i], 5);
    });
  });

  it('should handle empty vectors', () => {
    const empty: number[] = [];
    const serialized = serializeEmbedding(empty);
    const deserialized = deserializeEmbedding(serialized);

    expect(deserialized.length).toBe(0);
  });

  it('should use Float32 precision', () => {
    const original = [Math.PI, Math.E, Math.SQRT2];
    const serialized = serializeEmbedding(original);

    // Float32 buffer should be 4 bytes per element
    expect(serialized.length).toBe(original.length * 4);
  });
});

describe('Email Text Preparation', () => {
  it('should combine subject and snippet', () => {
    const result = prepareEmailText('Invoice for December', 'Your payment is due');
    expect(result).toContain('Invoice for December');
    expect(result).toContain('Your payment is due');
  });

  it('should truncate long text', () => {
    const longText = 'x'.repeat(500);
    const result = prepareEmailText('Subject', longText);

    expect(result.length).toBeLessThanOrEqual(400);
  });

  it('should handle empty inputs', () => {
    expect(prepareEmailText('', '')).toBe('');
    expect(prepareEmailText('Subject', '')).toContain('Subject');
    expect(prepareEmailText('', 'Snippet')).toContain('Snippet');
  });
});
