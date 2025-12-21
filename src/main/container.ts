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
import { initDb, closeDb, getDb, createEmailRepo, createAttachmentRepo, createAccountRepo, createFolderRepo, createDraftRepo, createClassificationStateRepo, createContactRepo, checkIntegrity, createDbBackup, createAwaitingRepo } from '../adapters/db';
import { createMailSync, createImapFolderOps } from '../adapters/imap';
import { createClassifier, createAnthropicProvider, createOllamaProvider, createOllamaClassifier } from '../adapters/llm';
import { createPatternMatcher, createTrainingRepo, createSenderRulesRepo, createSnoozeRepo, createTriageLogRepo, createTriageClassifier } from '../adapters/triage';
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
  
  // Create secure storage (OS keychain)
  const secrets = createSecureStorage();
  
  // Create repositories
  const emails = createEmailRepo();
  const attachments = createAttachmentRepo();
  // Tags removed - using folders for organization (Issue #54)
  const accounts = createAccountRepo();
  const folders = createFolderRepo();
  const drafts = createDraftRepo();
  const contacts = createContactRepo();
  const classificationState = createClassificationStateRepo(getDb);

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

  // Dynamic classifier that delegates based on current provider setting
  const classifier: import('../core/ports').Classifier = {
    async classify(email, body) {
      const cfg = configStore.get('llm');
      if (cfg.provider === 'ollama') {
        return ollamaClassifier.classify(email, body);
      } else {
        // Create fresh Anthropic classifier with current config
        const anthClassifier = createClassifier(
          {
            model: cfg.model as 'claude-sonnet-4-20250514' | 'claude-haiku-4-20250514',
            dailyBudget: cfg.dailyBudget,
            dailyEmailLimit: cfg.dailyEmailLimit,
          },
          secrets
        );
        return anthClassifier.classify(email, body);
      }
    },
    getBudget() {
      const cfg = configStore.get('llm');
      if (cfg.provider === 'ollama') {
        return ollamaClassifier.getBudget();
      }
      // Anthropic budget - create fresh instance
      const anthClassifier = createClassifier(
        {
          model: cfg.model as 'claude-sonnet-4-20250514' | 'claude-haiku-4-20250514',
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
          model: cfg.model as 'claude-sonnet-4-20250514' | 'claude-haiku-4-20250514',
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
  const triageClassifier = createTriageClassifier(triageLlmClient);

  // Awaiting reply adapters
  const awaiting = createAwaitingRepo(getDb);

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
