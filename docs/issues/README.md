# Issue Drafts

This directory contains detailed issue drafts ready to be posted to GitHub.

## Active Drafts

### [DRAFT-embedding-vector-db-for-classification.md](./DRAFT-embedding-vector-db-for-classification.md)

**Status:** Ready for GitHub issue creation  
**Related Analysis:** [../designs/2025-12-23-embeddings-vs-llm-classification-analysis.md](../designs/2025-12-23-embeddings-vs-llm-classification-analysis.md)

**Summary:** Proposes adding embedding-based vector similarity search to enhance the current LLM-only email classification system.

**Key Points:**
- 2-30x faster classification
- 30-50% reduction in LLM API costs
- Unlimited learning from user corrections (vs 10 examples currently)
- ~30 hours implementation time for significant performance gains

**Recommendation:** Implement Phase 1 MVP

---

## How to Use

1. Review the draft issue in this directory
2. Check the related analysis document in `docs/designs/` for full technical details
3. Copy the content to create a new GitHub issue
4. Update with any project-specific context
5. Post to GitHub issue tracker

## Related Documentation

- [Email Triage System Design](../designs/2025-12-16-email-triage-system.md)
- [Embeddings vs LLM Classification Analysis](../designs/2025-12-23-embeddings-vs-llm-classification-analysis.md)
