# Add Embedding + Vector DB for Enhanced Email Classification

## Summary

Enhance the current LLM-based email classification system with **semantic embeddings and vector similarity search** to improve speed, reduce costs, and enable better learning from user corrections.

**Current:** Pattern matching → LLM classification (always)  
**Proposed:** Pattern matching → **Vector similarity search** → LLM validation (selective)

## Motivation

### Current System Analysis

Our email triage uses a hybrid approach:
1. **Pattern matching** (regex, domains) provides hints
2. **LLM (Claude/Ollama)** makes final classification decision
3. **Training examples** included in LLM prompt (limited to ~10 due to context window)

**Strengths:**
- Works immediately with no training data
- LLM understands context and nuance
- Privacy-first with local Ollama

**Weaknesses:**
- **Every email requires full LLM inference** (~1.5s per email)
- **High cost** with Anthropic API ($0.003/email = $30 per 10k emails)
- **Context window limits** learning to ~10 recent examples
- **No semantic similarity** - purely syntactic pattern matching
- **Slow bulk operations** (1000 emails = 25 minutes)
- **Redundant processing** - similar emails re-classified from scratch

### Why Embeddings?

Embeddings are **dense vector representations** that capture semantic meaning. Similar emails have similar vectors:

```
"Your invoice for December"     → [0.23, -0.45, 0.12, ...]
"Receipt for payment"            → [0.21, -0.43, 0.14, ...]  ← Similar!
"Meeting tomorrow at 3pm"        → [0.87, 0.12, -0.34, ...]  ← Different
```

**Benefits over pure LLM:**

| Aspect | Pure LLM | Embeddings + Vector DB |
|--------|----------|----------------------|
| **Speed** | ~1.5s per email | <100ms similarity search |
| **Cost** | $0.003/email | One-time embedding cost |
| **Learning** | ~10 examples (context limit) | Unlimited examples (indexed) |
| **Semantic matching** | Excellent | Excellent |
| **Bulk operations** | Linear scaling | Near-constant (indexed) |

## Use Cases Where Embeddings Excel

### 1. Repeated Sender Patterns

**Without embeddings:**
```
Email 1 from newsletters@substack.com → Full LLM call (1.5s)
Email 2 from newsletters@substack.com → Full LLM call (1.5s) [redundant!]
Email 3 from newsletters@substack.com → Full LLM call (1.5s) [redundant!]
```

**With embeddings:**
```
Email 1 → No similar matches → Full LLM call → Index result
Email 2 → 0.95 similarity to Email 1 → Quick LLM validation (0.5s)
Email 3 → 0.93 avg similarity → Skip LLM entirely (0.05s)
```

### 2. Learning from User Corrections

**Current:** 
- User corrections added as text in prompt
- Limited to ~10 examples due to context window
- No semantic search through past corrections

**With embeddings:**
- **All corrections** embedded and searchable
- New email finds **most similar past corrections**
- Learns from **entire history**, not just recent 10

Example:
```
User corrects 5 emails from "linkedin.com" → Feed (not Social)
New LinkedIn email arrives → Vector search finds those 5 corrections
                          → High confidence for Feed folder
                          → Skip or quick-validate with LLM
```

### 3. Bulk Re-classification

User reorganizes folders → needs to re-classify 1000+ emails:
- **Without embeddings:** 1000 × 1.5s = **25 minutes**
- **With embeddings:** 1000 × 0.05s = **50 seconds** (30x faster)

### 4. Multi-language Support

Embeddings capture semantic similarity across languages:
- "Facture" (French) near "Invoice" (English) in vector space
- Better hints for LLM, even without language-specific patterns

## Proposed Architecture

### Enhanced Classification Flow

```
Email arrives
     ↓
[PHASE 1] Pattern Matching (existing)
     ↓ hint
[PHASE 2] Vector Similarity Search ← NEW
     │
     ├─→ Embed email (subject + snippet)
     ├─→ Query vector DB for top 5 similar emails
     ├─→ Calculate confidence from neighbors
     │
     ├─→ High confidence (>0.85) → Suggest folder
     └─→ Low confidence (<0.85) → Continue to LLM
     ↓
[PHASE 3] LLM Validation
     │
     ├─→ If vector confidence >0.85 → Quick validation prompt
     ├─→ If vector confidence <0.85 → Full analysis prompt
     └─→ Include similar examples as context
     ↓
IMAP folder assignment + Index embedding
```

### Performance Impact

**Scenario: 10,000 emails**

| Metric | Current (LLM-only) | With Embeddings | Improvement |
|--------|-------------------|-----------------|-------------|
| Initial classification | 4.2 hours | 2.25 hours | **47% faster** |
| Cost (Anthropic) | $30 | $15 | **50% savings** |
| Incremental (new email) | 1.5s | 0.05-0.7s avg | **2-30x faster** |
| Bulk reclassify (1000) | 25 min | 50 sec | **30x faster** |
| Learning capacity | 10 examples | Unlimited | **∞ better** |

## Technical Implementation

### 1. Embedding Model

**Recommendation:** [all-MiniLM-L6-v2](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2) via [@xenova/transformers](https://github.com/xenova/transformers.js)

- ✅ **Runs locally** (privacy preserved)
- ✅ **Fast:** ~50ms per embedding on CPU
- ✅ **Compact:** 384 dimensions (15 MB per 10k emails)
- ✅ **Node.js native** - no Python dependency
- ✅ **Good quality** for email classification

**Alternative for v2:** [Nomic Embed](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5) (higher quality, larger)

### 2. Vector Storage

**Recommendation:** **SQLite with BLOB storage** (already using better-sqlite3)

```sql
CREATE TABLE email_embeddings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email_id INTEGER REFERENCES emails(id),
  embedding BLOB NOT NULL,           -- 384-dim float32 vector
  embedding_model TEXT DEFAULT 'all-MiniLM-L6-v2',
  folder TEXT NOT NULL,
  is_correction BOOLEAN DEFAULT false,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_embeddings_folder ON email_embeddings(folder);
CREATE INDEX idx_embeddings_correction ON email_embeddings(is_correction);
```

**Why SQLite?**
- ✅ Already in use (zero new dependencies)
- ✅ Simple linear search for <10k emails (fast enough)
- ✅ Upgrade path: Add HNSW index later if needed (>100k emails)

**Alternative for v2:** [LanceDB](https://lancedb.github.io/lancedb/) (Node.js native, better for >10k emails)

### 3. Code Structure

```typescript
// src/adapters/embeddings/index.ts
export type EmbeddingService = {
  embed: (text: string) => Promise<number[]>;
  similarity: (a: number[], b: number[]) => number;
};

export function createEmbeddingService(): EmbeddingService {
  const pipeline = await transformers.pipeline('feature-extraction', 
    'Xenova/all-MiniLM-L6-v2');
  
  return {
    async embed(text) {
      const output = await pipeline(text, { pooling: 'mean', normalize: true });
      return Array.from(output.data); // 384-dim vector
    },
    
    similarity(a, b) {
      return cosineSimilarity(a, b); // Dot product of normalized vectors
    }
  };
}
```

### 4. When to Index Embeddings

**Strategy:** Index **training examples + corrections only**, not all emails

- ✅ **Onboarding training** (12 emails) → index immediately
- ✅ **User corrections** (drag-drop to different folder) → index as correction
- ✅ **High-confidence classifications** (maybe) → optional, to grow training set
- ❌ **All emails** → No (unnecessary overhead)

Typical user will have **<1000 training signals** (onboarding + corrections over time).

## Implementation Plan

### Phase 1: MVP (30 hours)

- [ ] Add `@xenova/transformers` dependency
- [ ] Implement `EmbeddingService` adapter (all-MiniLM-L6-v2)
- [ ] Add `email_embeddings` table to schema
- [ ] Implement `VectorSearch` adapter with SQLite storage
- [ ] Integrate vector search into classification flow
- [ ] Index onboarding training examples
- [ ] Index user corrections (folder drag-drop)
- [ ] Update LLM prompt to include similar examples
- [ ] Add tests for embedding + similarity
- [ ] Measure accuracy improvement

**Success criteria:**
- ✅ 30-50% reduction in LLM API calls
- ✅ Same or better classification accuracy
- ✅ <100ms vector search latency

### Phase 2: Optimization (Future)

- [ ] A/B test: Full email indexing vs training-only
- [ ] Confidence-based LLM skipping (>0.9 similarity = no LLM)
- [ ] Advanced indexing (HNSW) for >10k training examples
- [ ] Fine-tune embedding model on email corpus
- [ ] Similarity-based deduplication ("You already have similar emails...")

### Phase 3: Advanced Features (v2+)

- [ ] Smart suggestions UI: "This looks like past emails you moved to Planning"
- [ ] Anomaly detection: "This email is unusual for this sender"
- [ ] Cross-account learning (optional, privacy-preserving)
- [ ] Embedding-based email search (find similar emails)

## Benefits Summary

| Benefit | Impact |
|---------|--------|
| **Speed** | 2-30x faster (depends on cache hit rate) |
| **Cost** | 30-50% reduction in LLM API calls |
| **Learning** | Unlimited training examples (vs 10) |
| **Bulk ops** | 30x faster re-classification |
| **User corrections** | Immediate, lasting impact |
| **Semantic search** | Better than pattern matching |
| **Privacy** | Local embeddings (no API calls) |

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| **Embedding quality insufficient** | LLM still validates → embeddings just provide hints |
| **Performance overhead** | Async indexing, train-only (not all emails) |
| **Increased complexity** | Clean adapter abstraction, well-tested |
| **Model compatibility** | Version pinning, migration strategy |

**Overall risk: LOW** - Embeddings are additive enhancement, LLM remains final authority.

## Related

- [docs/designs/2025-12-23-embeddings-vs-llm-classification-analysis.md](../designs/2025-12-23-embeddings-vs-llm-classification-analysis.md) - Full technical analysis
- [docs/designs/2025-12-16-email-triage-system.md](../designs/2025-12-16-email-triage-system.md) - Current triage design
- Issue #55 - Improve AI onboarding with diverse training
- Issue #56 - Allow reclassification of emails

## References

### Papers
- "Sentence-BERT: Sentence Embeddings using Siamese BERT-Networks" (Reimers & Gurevych, 2019)
- "Text Embeddings Reveal (Almost) As Much As Text" (Morris et al., 2023)

### Libraries
- [@xenova/transformers](https://github.com/xenova/transformers.js) - Run Transformers models in Node.js
- [Sentence-Transformers](https://www.sbert.net/) - Reference for model architecture
- [LanceDB](https://lancedb.github.io/lancedb/) - Future vector DB option

### Models
- [all-MiniLM-L6-v2](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2) - Recommended for MVP
- [Nomic Embed](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5) - Higher quality alternative

---

**Recommendation: IMPLEMENT Phase 1 MVP**

The benefits (2-30x speed, 30-50% cost savings, unlimited learning) far outweigh the moderate implementation cost (~30 hours). This is a proven approach used by modern email clients and will significantly improve classification quality over time as user corrections accumulate.
