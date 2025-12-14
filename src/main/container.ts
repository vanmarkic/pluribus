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
import { initDb, closeDb, createEmailRepo, createAttachmentRepo, createTagRepo, createAccountRepo, createFolderRepo } from '../adapters/db';
import { createMailSync } from '../adapters/imap';
import { createClassifier } from '../adapters/llm';
import { createSecureStorage } from '../adapters/keychain';
import { createMailSender } from '../adapters/smtp';

// ============================================
// Config Store (non-sensitive settings only)
// ============================================

type AppConfig = {
  llm: {
    model: 'claude-sonnet-4-20250514' | 'claude-haiku-4-20250514';
    dailyBudget: number;
    dailyEmailLimit: number;
    autoClassify: boolean;
    confidenceThreshold: number;
  };
};

const configStore = new Store<AppConfig>({
  defaults: {
    llm: {
      model: 'claude-haiku-4-20250514',
      dailyBudget: 100000,
      dailyEmailLimit: 200,
      autoClassify: false,
      confidenceThreshold: 0.85,
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

  // Create services (with dependencies)
  const sync = createMailSync(emails, attachments, folders, secrets);
  const sender = createMailSender(secrets);
  
  const llmConfig = configStore.get('llm');
  const classifier = createClassifier(llmConfig, tags, secrets);

  // Config adapter (implements ConfigStore port)
  const config = {
    getLLMConfig: () => configStore.get('llm'),
  };

  // Assemble dependencies
  const deps: Deps = {
    emails,
    attachments,
    tags,
    accounts,
    folders,
    sync,
    classifier,
    secrets,
    sender,
    config,
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
