/**
 * Vector Search
 * 
 * Semantic similarity search using embeddings.
 * Uses linear search for simplicity (fast enough for <10k embeddings).
 */

import type { VectorSearch, VectorSearchResult, EmbeddingService, EmbeddingRepo } from '../../core/ports';
import type { Email } from '../../core/domain';
import { prepareEmailText } from './index';

/**
 * Create vector search service.
 * 
 * Strategy:
 * - Linear search through all embeddings (good for <10k items)
 * - Weighted by correction status (corrections count 2x)
 * - Returns top K most similar neighbors
 */
export function createVectorSearch(
  embeddingService: EmbeddingService,
  embeddingRepo: EmbeddingRepo
): VectorSearch {
  return {
    async findSimilar(
      emailText: string,
      topK: number = 5,
      accountId?: number
    ): Promise<VectorSearchResult[]> {
      // Generate embedding for query
      const queryVector = await embeddingService.embed(emailText);

      // Get all embeddings (filtered by account if specified)
      const allEmbeddings = await embeddingRepo.findAll(
        embeddingService.getModel(),
        accountId
      );

      // No embeddings yet
      if (allEmbeddings.length === 0) {
        return [];
      }

      // Calculate similarities
      const scored = allEmbeddings.map((emb) => ({
        emailId: emb.emailId,
        folder: emb.folder,
        similarity: embeddingService.similarity(queryVector, emb.embedding),
        wasCorrection: emb.isCorrection,
      }));

      // Sort by similarity descending
      scored.sort((a, b) => b.similarity - a.similarity);

      // Return top K
      return scored.slice(0, topK);
    },

    async indexEmail(
      emailId: number,
      emailText: string,
      folder: string,
      isCorrection: boolean = false
    ): Promise<void> {
      // Generate embedding
      const embedding = await embeddingService.embed(emailText);

      // Save to database
      await embeddingRepo.save(
        emailId,
        embedding,
        folder,
        isCorrection,
        embeddingService.getModel()
      );
    },

    calculateConfidence(similar: VectorSearchResult[]): { folder: string; confidence: number } | null {
      if (similar.length === 0) {
        return null;
      }

      // Weight votes by similarity and correction status
      const folderVotes: Record<string, number> = {};
      let totalWeight = 0;

      for (const result of similar) {
        // Corrections count 2x as much
        const weight = result.similarity * (result.wasCorrection ? 2.0 : 1.0);
        folderVotes[result.folder] = (folderVotes[result.folder] || 0) + weight;
        totalWeight += weight;
      }

      // Find folder with most votes
      const entries = Object.entries(folderVotes);
      if (entries.length === 0) {
        return null;
      }

      entries.sort(([, a], [, b]) => b - a);
      const [topFolder, topWeight] = entries[0];

      // Confidence is the proportion of total weight
      const confidence = totalWeight > 0 ? topWeight / totalWeight : 0;

      return {
        folder: topFolder,
        confidence: Math.min(1.0, confidence), // Cap at 1.0
      };
    },
  };
}

/**
 * Helper: Prepare email for embedding
 */
export function prepareEmailForEmbedding(email: Email): string {
  return prepareEmailText(email.subject, email.snippet);
}
