/**
 * Composition Root
 * 
 * Wires all adapters to ports and creates use cases.
 * This is where dependency injection happens.
 */

import * as path from 'path';
import { app } from 'electron';
import Store from 'electron-store';

// Core
import { createUseCases, type UseCases, type Deps } from '../core';

// Adapters
// Tags removed - using folders for organization (Issue #54)
import { initDb, closeDb, getDb, createEmailRepo, createAttachmentRepo, createAccountRepo, createFolderRepo, createDraftRepo, createClassificationStateRepo, createContactRepo, checkIntegrity, createDbBackup, createAwaitingRepo, createLlmCallsRepo, createSecurityEventRepo } from '../adapters/db';
import { logger } from '../adapters/observability';
import { wrapSecureStorageWithAudit } from '../adapters/keychain/audit';
import { createMailSync, createImapFolderOps } from '../adapters/imap';
import { createClassifier, createAnthropicProvider, createOllamaProvider, createOllamaClassifier, createFallbackClassifier, scoreEmailRiskTier, type AgentTools, type FallbackTransition } from '../adapters/llm';
import { chooseVersion, challengerPercentFromEnv } from '../adapters/llm/prompts/loader';
import { createPatternMatcher, createTrainingRepo, createSenderRulesRepo, createSnoozeRepo, createTriageLogRepo, createTriageClassifier } from '../adapters/triage';
import { createEmbeddingService } from '../adapters/embeddings/index';
import { createEmbeddingRepo } from '../adapters/embeddings/embedding-repo';
import { createVectorSearch } from '../adapters/embeddings/vector-search';
import { createEnhancedTriageClassifier } from '../adapters/triage/enhanced-classifier';
import { createSecureStorage } from '../adapters/keychain';
import { createMailSender } from '../adapters/smtp';
import { createImageCache } from '../adapters/image-cache';
import { createBackgroundTaskManager } from '../adapters/background';
import { createOllamaManager, type OllamaManager } from '../adapters/ollama-manager';
import { createOllamaTextGenerator } from '../adapters/ollama';
import { createLicenseService } from '../adapters/license';
import type { RemoteImagesSetting, DatabaseHealth } from '../core/ports';

// ============================================
// Config Store (non-sensitive settings only)
// ============================================

type AppConfig = {
  llm: {
    provider: 'anthropic' | 'ollama';
    model: string;
    dailyBudget: number;
    dailyEmailLimit: number;
    autoClassify: boolean;
    confidenceThreshold: number;
    reclassifyCooldownDays: number;
    ollamaServerUrl: string;
  };
  security: {
    remoteImages: RemoteImagesSetting;
  };
  ollama: {
    setupComplete: boolean;
  };
};

const LLM_DEFAULTS = {
  provider: 'ollama' as const,
  model: 'mistral:7b',
  dailyBudget: 100000,
  dailyEmailLimit: 200,
  autoClassify: false,
  confidenceThreshold: 0.85,
  reclassifyCooldownDays: 7,
  ollamaServerUrl: 'http://localhost:11434',
};

const configStore = new Store<AppConfig>({
  defaults: {
    llm: LLM_DEFAULTS,
    security: {
      remoteImages: 'block', // Privacy-first default
    },
    ollama: {
      setupComplete: false,
    },
  },
});

// Migration: ensure new llm fields have defaults (electron-store doesn't deep-merge)
const storedLlm = configStore.get('llm');
const migratedLlm = { ...LLM_DEFAULTS, ...storedLlm };
if (JSON.stringify(storedLlm) !== JSON.stringify(migratedLlm)) {
  configStore.set('llm', migratedLlm);
}

// ============================================
// Container Type
// ============================================

export type Container = {
  deps: Deps;
  useCases: UseCases;
  config: {
    get: <K extends keyof AppConfig>(key: K) => AppConfig[K];
    set: <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => void;
  };
  ollamaManager: OllamaManager;
  shutdown: () => Promise<void>;
};

// ============================================
// Create Container
// ============================================

export function createContainer(): Container {
  // Initialize database
  const userDataPath = app.getPath('userData');
  const dbPath = path.join(userDataPath, 'mail.db');

  // Schema path: check packaged app location first, then dev location
  const packagedSchemaPath = path.join(process.resourcesPath, 'schema.sql');
  const devSchemaPath = path.join(__dirname, '../adapters/db/schema.sql');
  const schemaPath = require('fs').existsSync(packagedSchemaPath) ? packagedSchemaPath : devSchemaPath;

  initDb(dbPath, schemaPath);

  // Create repositories
  const emails = createEmailRepo();
  const attachments = createAttachmentRepo();
  // Tags removed - using folders for organization (Issue #54)
  const accounts = createAccountRepo();
  const folders = createFolderRepo();
  const drafts = createDraftRepo();
  const contacts = createContactRepo();
  const classificationState = createClassificationStateRepo(getDb);
  const llmCalls = createLlmCallsRepo(getDb);
  const securityEvents = createSecurityEventRepo(getDb);

  // Security audit sink (#98). Centralised so every security-relevant event
  // emitter in the container funnels through one write path. Defensive:
  // a sink failure is logged but must never break the originating flow.
  const recordSecurityEvent = (entry: import('../core/ports').SecurityEventEntry) => {
    securityEvents.record(entry).catch(err =>
      logger.error({ err, entry }, 'Failed to persist security_events row'),
    );
  };

  // Keychain: OS-backed storage wrapped with the audit decorator so every
  // credential read/write/delete lands in security_events (#98).
  const secrets = wrapSecureStorageWithAudit(createSecureStorage(), securityEvents, {
    onSinkError: err => logger.error({ err }, 'security audit sink failed'),
  });

  // Observability sink: records every classify call for the cost dashboard (#94)
  // and emits a structured pino log line.
  const recordLlmCall = (record: {
    provider: 'anthropic' | 'ollama';
    model: string;
    promptVersion: string;
    emailId?: number;
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
    latencyMs: number;
    costUsd: number;
    cacheHit: boolean;
    stopReason: string | null;
    error?: string | null;
  }) => {
    llmCalls.record({
      provider: record.provider,
      model: record.model,
      promptVersion: record.promptVersion,
      emailId: record.emailId ?? null,
      inputTokens: record.inputTokens,
      outputTokens: record.outputTokens,
      cacheReadTokens: record.cacheReadTokens,
      cacheCreationTokens: record.cacheCreationTokens,
      latencyMs: record.latencyMs,
      costUsd: record.costUsd,
      cacheHit: record.cacheHit,
      stopReason: record.stopReason,
      error: record.error ?? null,
    }).catch(err => logger.error({ err }, 'Failed to persist llm_calls row'));

    logger.info({
      component: 'llm',
      ...record,
    }, 'llm.call');
  };

  // Create services (with dependencies)
  const sync = createMailSync(emails, attachments, folders, secrets);
  const sender = createMailSender(secrets);

  // Create LLM providers (both, so we can switch dynamically)
  const ollamaProvider = createOllamaProvider(configStore.get('llm').ollamaServerUrl);
  const anthropicProvider = createAnthropicProvider(secrets);

  // Create classifiers for both providers (updated for folder-based classification - Issue #54)
  const ollamaClassifier = createOllamaClassifier(
    () => {
      const cfg = configStore.get('llm');
      return {
        model: cfg.model,
        serverUrl: cfg.ollamaServerUrl,
        dailyBudget: cfg.dailyBudget,
        dailyEmailLimit: cfg.dailyEmailLimit,
      };
    }
  );

  // Agent tools for the Anthropic classifier (#87). Provided to the classifier
  // so low-confidence classifications can call find_similar_emails and
  // get_sender_history to gather more evidence.
  //
  // Note: `embeddingRepo` and `emails` are declared later in this function;
  // these tools are looked up lazily via closures so ordering doesn't matter.
  const buildAgentTools = (): AgentTools => ({
    async findSimilarEmails(queryText, limit = 5) {
      const hits = await vectorSearch.findSimilar(queryText, Math.min(Math.max(1, limit), 10));
      // Enrich with subject + sender for the model. Best-effort; skip hits
      // whose email row no longer exists.
      const enriched = await Promise.all(
        hits.map(async h => {
          const e = await emails.findById(h.emailId);
          if (!e) return null;
          return {
            folder: h.folder,
            similarity: h.similarity,
            subject: e.subject,
            fromAddress: e.from.address,
          };
        })
      );
      return enriched.filter((x): x is NonNullable<typeof x> => x !== null);
    },
    async getSenderHistory(senderAddress) {
      const matches = await emails.search(senderAddress, 100);
      const byFolder: Record<string, number> = {};
      for (const e of matches) {
        if (e.from.address.toLowerCase() !== senderAddress.toLowerCase()) continue;
        const state = await classificationState.getState(e.id);
        if (!state?.suggestedFolder) continue;
        byFolder[state.suggestedFolder] = (byFolder[state.suggestedFolder] ?? 0) + 1;
      }
      const total = Object.values(byFolder).reduce((a, b) => a + b, 0);
      return { total, byFolder };
    },
  });

  // Prompt-injection audit sink (#102 → #98). Logs high-signal findings to
  // the structured logger AND to the security audit log.
  const logInjectionFindings = (emailId: number, findings: ReturnType<typeof import('../adapters/llm').detectPromptInjection>) => {
    const findingSummary = findings.map(f => ({ category: f.category, severity: f.severity, matched: f.matched }));
    logger.warn({
      component: 'prompt-injection',
      emailId,
      findings: findingSummary,
    }, 'prompt-injection.detected');
    const worstSeverity = findings.some(f => f.severity === 'high') ? 'alert'
      : findings.some(f => f.severity === 'medium') ? 'warn'
      : 'info';
    recordSecurityEvent({
      eventType: 'prompt_injection.detected',
      severity: worstSeverity,
      actor: 'classifier',
      target: `email:${emailId}`,
      metadata: { findings: findingSummary, count: findings.length },
    });
  };

  // Read once; the env var is process-level config, not per-request state.
  const challengerPercent = challengerPercentFromEnv();
  if (challengerPercent > 0) {
    logger.info({ component: 'prompt-ab', challengerPercent }, 'prompt-ab.enabled');
  }

  // Fallback-chain transitions (#95 → #98): logged via pino, counted in
  // memory, and persisted to the security audit log.
  let fallbackCount = 0;
  const logFallbackTransition = (t: FallbackTransition) => {
    fallbackCount++;
    logger.warn({
      component: 'fallback',
      ...t,
    }, 'classifier.fallback');
    recordSecurityEvent({
      eventType: 'classifier.fallback',
      severity: t.reason === 'budget_exhausted' ? 'alert' : 'warn',
      actor: 'classifier',
      target: `email:${t.emailId}`,
      metadata: {
        fromTier: t.fromTier,
        toTier: t.toTier,
        reason: t.reason,
        attemptsInPreviousTier: t.attemptsInPreviousTier,
        errorMessage: t.errorMessage,
      },
    });
  };

  // Dynamic classifier that delegates based on current provider setting.
  // For Anthropic, we wrap the user's configured model in a 2-tier fallback
  // chain so transient 5xx / timeout / overloaded errors automatically
  // degrade to Haiku 4.5 instead of surfacing to the user (#95).
  const HAIKU_FALLBACK_MODEL = 'claude-haiku-4-5-20251001';
  const classifier: import('../core/ports').Classifier = {
    async classify(email, body) {
      const cfg = configStore.get('llm');
      if (cfg.provider === 'ollama') {
        return ollamaClassifier.classify(email, body);
      }

      // Prompt version chosen deterministically per email so retries and
      // reclassifications see the same version (#91). Applies to every tier.
      const promptVersion = chooseVersion(email.id, challengerPercent);

      // Extended thinking (#90): high-risk emails (legal / financial /
      // defence-adjacent sender AND a risk-bearing subject) get a 4000-
      // token thinking budget on the primary tier. Haiku fallback never
      // thinks — it's the cheap/fast degraded mode.
      const risk = scoreEmailRiskTier(email);
      const classifierOptsFor = (model: string) => ({
        onCall: recordLlmCall,
        agentTools: buildAgentTools(),
        agentConfidenceThreshold: 0.6,
        agentMaxIterations: 3,
        onInjectionFindings: logInjectionFindings,
        promptVersion,
        ...(model === HAIKU_FALLBACK_MODEL ? { cacheTtl: '5m' as const } : {}),
        ...(risk === 'high' && model !== HAIKU_FALLBACK_MODEL
          ? { thinkingBudgetTokens: 4000 }
          : {}),
      });
      if (risk === 'high') {
        logger.info({ component: 'risk-tier', emailId: email.id, risk }, 'risk.high');
      }

      const primary = createClassifier(
        { model: cfg.model, dailyBudget: cfg.dailyBudget, dailyEmailLimit: cfg.dailyEmailLimit },
        secrets,
        classifierOptsFor(cfg.model),
      );
      // Only add the Haiku fallback when the user isn't already on Haiku —
      // no point falling back to the same model we just failed on.
      const tiers =
        cfg.model === HAIKU_FALLBACK_MODEL
          ? [{ label: `anthropic:${cfg.model}`, classifier: primary }]
          : [
              { label: `anthropic:${cfg.model}`, classifier: primary },
              {
                label: `anthropic:${HAIKU_FALLBACK_MODEL}`,
                classifier: createClassifier(
                  {
                    model: HAIKU_FALLBACK_MODEL,
                    dailyBudget: cfg.dailyBudget,
                    dailyEmailLimit: cfg.dailyEmailLimit,
                  },
                  secrets,
                  classifierOptsFor(HAIKU_FALLBACK_MODEL),
                ),
              },
            ];

      const fallbackClassifier = createFallbackClassifier(tiers, {
        onTransition: logFallbackTransition,
      });
      return fallbackClassifier.classify(email, body);
    },
    getBudget() {
      const cfg = configStore.get('llm');
      if (cfg.provider === 'ollama') {
        return ollamaClassifier.getBudget();
      }
      // Anthropic budget - create fresh instance
      const anthClassifier = createClassifier(
        {
          model: cfg.model,
          dailyBudget: cfg.dailyBudget,
          dailyEmailLimit: cfg.dailyEmailLimit,
        },
        secrets
      );
      return anthClassifier.getBudget();
    },
    getEmailBudget() {
      const cfg = configStore.get('llm');
      if (cfg.provider === 'ollama') {
        return ollamaClassifier.getEmailBudget();
      }
      const anthClassifier = createClassifier(
        {
          model: cfg.model,
          dailyBudget: cfg.dailyBudget,
          dailyEmailLimit: cfg.dailyEmailLimit,
        },
        secrets
      );
      return anthClassifier.getEmailBudget();
    },
  };

  // Dynamic LLM provider that delegates based on current provider setting
  const llmProvider: import('../core/ports').LLMProvider = {
    get type() {
      return configStore.get('llm').provider;
    },
    async validateKey(key?: string) {
      const cfg = configStore.get('llm');
      if (cfg.provider === 'ollama') {
        return ollamaProvider.validateKey(key ?? '');
      }
      return anthropicProvider.validateKey(key ?? '');
    },
    async listModels() {
      const cfg = configStore.get('llm');
      if (cfg.provider === 'ollama') {
        // Refresh Ollama provider with current URL
        const freshProvider = createOllamaProvider(cfg.ollamaServerUrl);
        return freshProvider.listModels();
      }
      return anthropicProvider.listModels();
    },
    async testConnection() {
      const cfg = configStore.get('llm');
      if (cfg.provider === 'ollama') {
        const freshProvider = createOllamaProvider(cfg.ollamaServerUrl);
        return freshProvider.testConnection!();
      }
      return anthropicProvider.testConnection?.() ?? { connected: true };
    },
  };

  // Config adapter (implements ConfigStore port)
  const config = {
    getLLMConfig: () => configStore.get('llm'),
    getRemoteImagesSetting: () => configStore.get('security').remoteImages,
    setRemoteImagesSetting: (setting: RemoteImagesSetting) => {
      configStore.set('security', { ...configStore.get('security'), remoteImages: setting });
    },
  };

  // Image cache adapter
  const imageCache = createImageCache(getDb);

  // Background task manager
  const backgroundTasks = createBackgroundTaskManager();

  // Database health adapter (wraps existing db functions)
  const databaseHealth: DatabaseHealth = {
    checkIntegrity,
    createBackup: createDbBackup,
  };

  // License service
  const license = createLicenseService();

  // Triage adapters
  const patternMatcher = createPatternMatcher();
  const trainingRepo = createTrainingRepo(getDb);
  const senderRules = createSenderRulesRepo(getDb);
  const snoozes = createSnoozeRepo(getDb);
  const triageLog = createTriageLogRepo(getDb);
  const imapFolderOps = createImapFolderOps(secrets);

  // Embedding & vector search adapters
  const embeddingService = createEmbeddingService();
  const embeddingRepo = createEmbeddingRepo(getDb());
  const vectorSearch = createVectorSearch(embeddingService, embeddingRepo);

  // Create LLM client for triage classifier (delegates to current provider)
  const triageLlmClient = {
    async complete(prompt: string): Promise<string> {
      const cfg = configStore.get('llm');
      if (cfg.provider === 'ollama') {
        const freshProvider = createOllamaProvider(cfg.ollamaServerUrl);
        // Use Ollama's generate endpoint
        const response = await fetch(`${cfg.ollamaServerUrl}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: cfg.model,
            prompt,
            stream: false,
            format: 'json',
          }),
        });
        const data = await response.json() as { response: string };
        return data.response;
      } else {
        // Use Anthropic
        const apiKey = await secrets.getApiKey('anthropic');
        if (!apiKey) throw new Error('Anthropic API key not configured');
        const Anthropic = (await import('@anthropic-ai/sdk')).default;
        const client = new Anthropic({ apiKey });
        const message = await client.messages.create({
          model: cfg.model,
          max_tokens: 1024,
          messages: [{ role: 'user', content: prompt }],
        });
        const textBlock = message.content.find(b => b.type === 'text');
        return textBlock?.type === 'text' ? textBlock.text : '';
      }
    },
  };
  const triageClassifier = createEnhancedTriageClassifier(triageLlmClient, vectorSearch);

  // Awaiting reply adapters
  const awaiting = createAwaitingRepo();

  // LLM text generator for awaiting classification (uses qwen2.5:1.5b by default)
  const llmGenerator = createOllamaTextGenerator(() => {
    const cfg = configStore.get('llm');
    return {
      serverUrl: cfg.ollamaServerUrl,
      // Use smaller model for awaiting classification (faster, efficient)
      model: 'qwen2.5:1.5b',
      timeoutMs: 15000,
    };
  });

  // Assemble dependencies
  const deps: Deps = {
    emails,
    attachments,
    // tags removed - using folders for organization (Issue #54)
    accounts,
    folders,
    drafts,
    contacts,
    classificationState,
    sync,
    classifier,
    secrets,
    sender,
    config,
    imageCache,
    llmProvider,
    backgroundTasks,
    databaseHealth,
    license,
    // Triage
    patternMatcher,
    triageClassifier,
    trainingRepo,
    senderRules,
    snoozes,
    triageLog,
    imapFolderOps,
    // Awaiting reply
    awaiting,
    llmGenerator,
    // Embeddings & Vector Search
    embeddingService,
    embeddingRepo,
    vectorSearch,
    // Observability
    llmCalls,
    // Security audit log (#98)
    securityEvents,
  };
  
  // Create use cases
  const useCases = createUseCases(deps);

  // Create OllamaManager for bundled Ollama binary management
  const ollamaManager = createOllamaManager();

  // Shutdown function
  const shutdown = async () => {
    await sync.disconnect(0); // Disconnect all
    closeDb();
  };

  return {
    deps,
    useCases,
    config: {
      get: (key) => configStore.get(key),
      set: (key, value) => configStore.set(key, value),
    },
    ollamaManager,
    shutdown,
  };
}
