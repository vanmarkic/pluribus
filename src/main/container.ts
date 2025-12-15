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
import { initDb, closeDb, getDb, createEmailRepo, createAttachmentRepo, createTagRepo, createAccountRepo, createFolderRepo, createDraftRepo, createClassificationStateRepo } from '../adapters/db';
import { createMailSync } from '../adapters/imap';
import { createClassifier, createAnthropicProvider, createOllamaProvider, createOllamaClassifier } from '../adapters/llm';
import { createSecureStorage } from '../adapters/keychain';
import { createMailSender } from '../adapters/smtp';
import { createImageCache } from '../adapters/image-cache';
import type { RemoteImagesSetting } from '../core/ports';

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
};

const configStore = new Store<AppConfig>({
  defaults: {
    llm: {
      provider: 'anthropic',
      model: 'claude-haiku-4-20250514',
      dailyBudget: 100000,
      dailyEmailLimit: 200,
      autoClassify: false,
      confidenceThreshold: 0.85,
      reclassifyCooldownDays: 7,
      ollamaServerUrl: 'http://localhost:11434',
    },
    security: {
      remoteImages: 'block', // Privacy-first default
    },
  },
});

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
  const classificationState = createClassificationStateRepo(getDb);

  // Create services (with dependencies)
  const sync = createMailSync(emails, attachments, folders, secrets);
  const sender = createMailSender(secrets);

  // Create LLM provider and classifier based on config
  const llmConfig = configStore.get('llm');

  let llmProvider;
  let classifier;

  if (llmConfig.provider === 'ollama') {
    llmProvider = createOllamaProvider(llmConfig.ollamaServerUrl);
    classifier = createOllamaClassifier(
      {
        model: llmConfig.model,
        serverUrl: llmConfig.ollamaServerUrl,
        dailyBudget: llmConfig.dailyBudget,
        dailyEmailLimit: llmConfig.dailyEmailLimit,
      },
      tags
    );
  } else {
    llmProvider = createAnthropicProvider(secrets);
    classifier = createClassifier(
      {
        model: llmConfig.model as 'claude-sonnet-4-20250514' | 'claude-haiku-4-20250514',
        dailyBudget: llmConfig.dailyBudget,
        dailyEmailLimit: llmConfig.dailyEmailLimit,
      },
      tags,
      secrets
    );
  }

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

  // Assemble dependencies
  const deps: Deps = {
    emails,
    attachments,
    tags,
    accounts,
    folders,
    drafts,
    classificationState,
    sync,
    classifier,
    secrets,
    sender,
    config,
    imageCache,
    llmProvider,
  };
  
  // Create use cases
  const useCases = createUseCases(deps);
  
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
    shutdown,
  };
}
