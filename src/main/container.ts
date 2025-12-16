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
import { initDb, closeDb, getDb, createEmailRepo, createAttachmentRepo, createTagRepo, createAccountRepo, createFolderRepo, createDraftRepo, createClassificationStateRepo, createContactRepo, checkIntegrity, createDbBackup } from '../adapters/db';
import { createMailSync } from '../adapters/imap';
import { createClassifier, createAnthropicProvider, createOllamaProvider, createOllamaClassifier } from '../adapters/llm';
import { createSecureStorage } from '../adapters/keychain';
import { createMailSender } from '../adapters/smtp';
import { createImageCache } from '../adapters/image-cache';
import { createBackgroundTaskManager } from '../adapters/background';
import { createOllamaManager, type OllamaManager } from '../adapters/ollama-manager';
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
  const tags = createTagRepo();
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

  // Create classifiers for both providers
  const ollamaClassifier = createOllamaClassifier(
    () => {
      const cfg = configStore.get('llm');
      return {
        model: cfg.model,
        serverUrl: cfg.ollamaServerUrl,
        dailyBudget: cfg.dailyBudget,
        dailyEmailLimit: cfg.dailyEmailLimit,
      };
    },
    tags
  );

  // Dynamic classifier that delegates based on current provider setting
  const classifier: import('../core/ports').Classifier = {
    async classify(email, body, existingTags) {
      const cfg = configStore.get('llm');
      if (cfg.provider === 'ollama') {
        return ollamaClassifier.classify(email, body, existingTags);
      } else {
        // Create fresh Anthropic classifier with current config
        const anthClassifier = createClassifier(
          {
            model: cfg.model as 'claude-sonnet-4-20250514' | 'claude-haiku-4-20250514',
            dailyBudget: cfg.dailyBudget,
            dailyEmailLimit: cfg.dailyEmailLimit,
          },
          tags,
          secrets
        );
        return anthClassifier.classify(email, body, existingTags);
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
        tags,
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
        tags,
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

  // Triage stubs (will be replaced with real implementations)
  const patternMatcher: import('../core/ports').PatternMatcher = {
    match: () => ({ folder: 'INBOX', confidence: 0.3, tags: [] }),
  };
  const triageClassifier: import('../core/ports').TriageClassifier = {
    classify: async () => ({
      folder: 'INBOX',
      tags: [],
      confidence: 0.5,
      patternAgreed: true,
      reasoning: 'Stub implementation',
    }),
  };
  const trainingRepo: import('../core/ports').TrainingRepo = {
    findByAccount: async () => [],
    findByDomain: async () => [],
    save: async (ex) => ({ ...ex, id: 0, createdAt: new Date() }),
    getRelevantExamples: async () => [],
  };
  const senderRules: import('../core/ports').SenderRuleRepo = {
    findByAccount: async () => [],
    findAutoApply: async () => [],
    findByPattern: async () => null,
    upsert: async (r) => ({ ...r, id: 0, createdAt: new Date(), updatedAt: new Date() }),
    incrementCount: async () => {},
  };
  const snoozes: import('../core/ports').SnoozeRepo = {
    findByEmail: async () => null,
    findDue: async () => [],
    create: async (s) => ({ ...s, id: 0, createdAt: new Date() }),
    delete: async () => {},
  };
  const triageLog: import('../core/ports').TriageLogRepo = {
    log: async () => {},
    findByEmail: async () => [],
    findRecent: async () => [],
  };
  const imapFolderOps: import('../core/ports').ImapFolderOps = {
    createFolder: async () => {},
    deleteFolder: async () => {},
    listFolders: async () => [],
    moveMessage: async () => {},
    ensureTriageFolders: async () => [],
  };

  // Assemble dependencies
  const deps: Deps = {
    emails,
    attachments,
    tags,
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
