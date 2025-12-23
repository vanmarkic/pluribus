/**
 * Embedding Service
 * 
 * Local embedding generation using sentence-transformers via @xenova/transformers.
 * Runs entirely locally for privacy preservation.
 */

import { pipeline, type FeatureExtractionPipeline } from '@xenova/transformers';
import type { EmbeddingService } from '../../core/ports';

const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';
const MODEL_ID = 'all-MiniLM-L6-v2';

let pipelineInstance: FeatureExtractionPipeline | null = null;
let pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;

/**
 * Create embedding service using all-MiniLM-L6-v2 model.
 * 
 * Model characteristics:
 * - 384 dimensions
 * - ~50ms inference on CPU
 * - Good quality for email classification
 * - 22MB model size
 */
export function createEmbeddingService(): EmbeddingService {
  return {
    async embed(text: string): Promise<number[]> {
      // Lazy load the model pipeline (with race condition protection)
      if (!pipelineInstance) {
        if (!pipelinePromise) {
          pipelinePromise = pipeline('feature-extraction', MODEL_NAME);
        }
        pipelineInstance = await pipelinePromise;
      }

      // Generate embedding with mean pooling and normalization
      const output = await pipelineInstance(text, {
        pooling: 'mean',
        normalize: true,
      });

      // Convert to plain array
      return Array.from(output.data as Float32Array);
    },

    similarity(a: number[], b: number[]): number {
      // Cosine similarity (dot product of normalized vectors)
      if (a.length !== b.length) {
        throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
      }

      let dotProduct = 0;
      for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
      }

      // Vectors should already be normalized, but clamp to [-1, 1] for safety
      return Math.max(-1, Math.min(1, dotProduct));
    },

    getModel(): string {
      return MODEL_ID;
    },
  };
}

/**
 * Serialize embedding vector to binary format for SQLite storage.
 * Uses Float32Array for efficient storage (4 bytes per dimension).
 */
export function serializeEmbedding(vector: number[]): Buffer {
  const float32 = new Float32Array(vector);
  return Buffer.from(float32.buffer);
}

/**
 * Deserialize embedding vector from binary format.
 */
export function deserializeEmbedding(buffer: Buffer): number[] {
  const float32 = new Float32Array(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength / 4
  );
  return Array.from(float32);
}

/**
 * Prepare email text for embedding.
 * Combines subject and snippet with emphasis on subject.
 */
export function prepareEmailText(subject: string, snippet: string): string {
  // Truncate to reasonable length (model has 512 token limit)
  const maxLength = 400;
  const combined = `${subject}\n${snippet}`.trim();
  return combined.length > maxLength 
    ? combined.substring(0, maxLength)
    : combined;
}
