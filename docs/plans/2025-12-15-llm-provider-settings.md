# LLM Provider Settings Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add secure API key management in UI, dynamic model selection from provider APIs, and support for switching between Anthropic Claude and local Ollama.

**Architecture:** Follows functional Clean Architecture pattern. New `LLMProvider` port defines validation and model listing. Anthropic and Ollama adapters implement the port. Use cases wrap provider methods. IPC handlers call use cases (never adapters directly).

**Tech Stack:** TypeScript, Anthropic SDK, Ollama REST API, React, Electron IPC

---

## Task 1: Add LLMProvider Port and LLMModel Type

**Files:**
- Modify: `src/core/ports.ts:210-220`

**Step 1: Add the new types to ports.ts**

Add after line 220 (after `LLMConfig` type):

```typescript
// ============================================
// LLM Provider (for model listing & validation)
// ============================================

export type LLMModel = {
  id: string;
  displayName: string;
  createdAt?: string;
};

export type LLMProviderType = 'anthropic' | 'ollama';

export type LLMProvider = {
  type: LLMProviderType;
  validateKey: (key: string) => Promise<{ valid: boolean; error?: string }>;
  listModels: () => Promise<LLMModel[]>;
  testConnection?: () => Promise<{ connected: boolean; error?: string }>;
};
```

**Step 2: Update LLMConfig type**

Replace the existing `LLMConfig` type (lines 213-220):

```typescript
export type LLMConfig = {
  provider: LLMProviderType;
  model: string;
  dailyBudget: number;
  dailyEmailLimit: number;
  autoClassify: boolean;
  confidenceThreshold: number;
  reclassifyCooldownDays: number;
  // Ollama-specific
  ollamaServerUrl?: string;
};
```

**Step 3: Add LLMProvider to Deps type**

In the `Deps` type (around line 282), add:

```typescript
export type Deps = {
  emails: EmailRepo;
  attachments: AttachmentRepo;
  tags: TagRepo;
  accounts: AccountRepo;
  folders: FolderRepo;
  drafts: DraftRepo;
  sync: MailSync;
  classifier: Classifier;
  classificationState: ClassificationStateRepo;
  secrets: SecureStorage;
  sender: MailSender;
  config: ConfigStore;
  imageCache: ImageCache;
  llmProvider: LLMProvider;  // Add this line
};
```

**Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: Errors about missing `llmProvider` in container (expected, we'll fix in later tasks)

**Step 5: Commit**

```bash
git add src/core/ports.ts
git commit -m "feat(core): add LLMProvider port and LLMModel type"
```

---

## Task 2: Add LLM Provider Use Cases

**Files:**
- Modify: `src/core/usecases.ts`

**Step 1: Add the use cases**

Add after the Classification Use Cases section (around line 293):

```typescript
// ============================================
// LLM Provider Use Cases
// ============================================

export const validateLLMProvider = (deps: Pick<Deps, 'llmProvider'>) =>
  (key: string): Promise<{ valid: boolean; error?: string }> =>
    deps.llmProvider.validateKey(key);

export const listLLMModels = (deps: Pick<Deps, 'llmProvider'>) =>
  (): Promise<import('./ports').LLMModel[]> =>
    deps.llmProvider.listModels();

export const testLLMConnection = (deps: Pick<Deps, 'llmProvider'>) =>
  async (): Promise<{ connected: boolean; error?: string }> => {
    if (deps.llmProvider.testConnection) {
      return deps.llmProvider.testConnection();
    }
    return { connected: true };
  };
```

**Step 2: Add to createUseCases factory**

In the `createUseCases` function return object (around line 990), add:

```typescript
    // LLM Provider
    validateLLMProvider: validateLLMProvider(deps),
    listLLMModels: listLLMModels(deps),
    testLLMConnection: testLLMConnection(deps),
```

**Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: Still errors about container (expected)

**Step 4: Commit**

```bash
git add src/core/usecases.ts
git commit -m "feat(core): add LLM provider use cases"
```

---

## Task 3: Create Anthropic Provider Adapter

**Files:**
- Rename: `src/adapters/llm/index.ts` → `src/adapters/llm/anthropic.ts`
- Create: `src/adapters/llm/index.ts` (new barrel file)

**Step 1: Rename existing file**

```bash
mv src/adapters/llm/index.ts src/adapters/llm/anthropic.ts
```

**Step 2: Add LLMProvider implementation to anthropic.ts**

Add after the imports in `src/adapters/llm/anthropic.ts`:

```typescript
import type { LLMProvider, LLMModel, TagRepo, SecureStorage } from '../../core/ports';
```

Add this new function after the `createClassifier` function:

```typescript
export function createAnthropicProvider(secrets: SecureStorage): LLMProvider {
  return {
    type: 'anthropic',

    async validateKey(key: string) {
      try {
        const client = new Anthropic({ apiKey: key });
        await client.models.list({ limit: 1 });
        return { valid: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('401') || message.includes('invalid')) {
          return { valid: false, error: 'Invalid API key' };
        }
        return { valid: false, error: message };
      }
    },

    async listModels() {
      const apiKey = await secrets.getApiKey('anthropic');
      if (!apiKey) return [];

      try {
        const client = new Anthropic({ apiKey });
        const response = await client.models.list();

        const models: LLMModel[] = [];
        for await (const model of response) {
          models.push({
            id: model.id,
            displayName: model.display_name,
            createdAt: model.created_at,
          });
        }
        return models;
      } catch (err) {
        console.error('Failed to list Anthropic models:', err);
        return [];
      }
    },
  };
}
```

**Step 3: Create new barrel file**

Create `src/adapters/llm/index.ts`:

```typescript
/**
 * LLM Adapters
 *
 * Provides LLM provider implementations for classification.
 */

export { createClassifier, createAnthropicProvider, resetDailyUsage } from './anthropic';
```

**Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: Still container errors (expected)

**Step 5: Commit**

```bash
git add src/adapters/llm/
git commit -m "feat(adapters): extract Anthropic provider with model listing"
```

---

## Task 4: Create Ollama Provider Adapter

**Files:**
- Create: `src/adapters/llm/ollama.ts`
- Modify: `src/adapters/llm/index.ts`

**Step 1: Create Ollama provider**

Create `src/adapters/llm/ollama.ts`:

```typescript
/**
 * Ollama LLM Provider
 *
 * Uses local Ollama server for email classification.
 * No API key required - just server URL.
 */

import type { LLMProvider, LLMModel, Classifier } from '../../core/ports';
import type { Email, EmailBody, Classification, Tag } from '../../core/domain';

const DEFAULT_SERVER_URL = 'http://localhost:11434';

export function createOllamaProvider(serverUrl = DEFAULT_SERVER_URL): LLMProvider {
  return {
    type: 'ollama',

    async validateKey() {
      // Ollama doesn't need API key, just test connection
      return this.testConnection!();
    },

    async listModels() {
      try {
        const response = await fetch(`${serverUrl}/api/tags`);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();

        return (data.models || []).map((m: { name: string; modified_at?: string }) => ({
          id: m.name,
          displayName: m.name,
          createdAt: m.modified_at,
        }));
      } catch (err) {
        console.error('Failed to list Ollama models:', err);
        return [];
      }
    },

    async testConnection() {
      try {
        const response = await fetch(`${serverUrl}/api/tags`, {
          method: 'GET',
          signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) {
          return { connected: false, error: `HTTP ${response.status}` };
        }
        return { connected: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { connected: false, error: message };
      }
    },
  };
}

function buildSystemPrompt(tags: Tag[]): string {
  const tagList = tags
    .filter(t => !t.isSystem)
    .map(t => `- ${t.slug}: ${t.name}`)
    .join('\n');

  return `You are an email sorting assistant. Analyze emails and suggest tags.

Available tags:
${tagList}

Rules:
- Suggest 1-3 relevant tags
- Be conservative: only suggest confident matches
- Consider sender domain and subject patterns

Respond with JSON only:
{"tags":["slug"],"confidence":0.0-1.0,"reasoning":"brief","priority":"high"|"normal"|"low"}`;
}

function buildUserMessage(email: Email, body?: EmailBody, existingTags?: string[]): string {
  const parts = [
    `From: ${email.from.name || ''} <${email.from.address}>`,
    `Subject: ${email.subject}`,
    `Date: ${email.date.toISOString()}`,
  ];

  if (existingTags?.length) {
    parts.push(`Current tags: ${existingTags.join(', ')}`);
  }

  parts.push('', 'Content:', body?.text?.slice(0, 2000) || email.snippet || '(empty)');

  return parts.join('\n');
}

type OllamaConfig = {
  model: string;
  serverUrl: string;
  dailyBudget: number;
  dailyEmailLimit: number;
};

let todayEmailCount = 0;

export function createOllamaClassifier(
  config: OllamaConfig,
  tagRepo: { findAll: () => Promise<Tag[]> }
): Classifier {
  return {
    async classify(email, body, existingTags) {
      const budget = this.getEmailBudget();
      if (!budget.allowed) {
        throw new Error(`Daily budget exceeded (${budget.used}/${budget.limit})`);
      }

      const tags = await tagRepo.findAll();
      const systemPrompt = buildSystemPrompt(tags);
      const userMessage = buildUserMessage(email, body, existingTags);

      const response = await fetch(`${config.serverUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
          stream: false,
          options: { temperature: 0.2 },
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status}`);
      }

      const data = await response.json();
      todayEmailCount++;

      const content = data.message?.content || '';

      try {
        const parsed = JSON.parse(content);
        return {
          suggestedTags: parsed.tags || [],
          confidence: parsed.confidence || 0,
          reasoning: parsed.reasoning || '',
          priority: parsed.priority || 'normal',
        };
      } catch {
        console.error('Failed to parse Ollama response:', content);
        return {
          suggestedTags: [],
          confidence: 0,
          reasoning: 'Parse error',
          priority: 'normal',
        };
      }
    },

    getBudget() {
      // Ollama is free, but we still track for UI consistency
      return { used: 0, limit: config.dailyBudget, allowed: true };
    },

    getEmailBudget() {
      return {
        used: todayEmailCount,
        limit: config.dailyEmailLimit,
        allowed: todayEmailCount < config.dailyEmailLimit,
      };
    },
  };
}

export function resetOllamaDailyUsage(): void {
  todayEmailCount = 0;
}
```

**Step 2: Update barrel file**

Update `src/adapters/llm/index.ts`:

```typescript
/**
 * LLM Adapters
 *
 * Provides LLM provider implementations for classification.
 */

export { createClassifier, createAnthropicProvider, resetDailyUsage } from './anthropic';
export { createOllamaProvider, createOllamaClassifier, resetOllamaDailyUsage } from './ollama';
```

**Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: Still container errors (expected, will fix next)

**Step 4: Commit**

```bash
git add src/adapters/llm/
git commit -m "feat(adapters): add Ollama provider and classifier"
```

---

## Task 5: Update Container to Wire LLM Provider

**Files:**
- Modify: `src/main/container.ts`

**Step 1: Update imports**

Replace the llm import line:

```typescript
import { createClassifier, createAnthropicProvider, createOllamaProvider, createOllamaClassifier } from '../adapters/llm';
```

**Step 2: Update AppConfig type**

Replace the `llm` section in `AppConfig` type:

```typescript
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
```

**Step 3: Update defaults**

Update the `configStore` defaults:

```typescript
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
      remoteImages: 'block',
    },
  },
});
```

**Step 4: Create provider and classifier based on config**

Replace the classifier creation section (around line 104-105):

```typescript
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
```

**Step 5: Add llmProvider to deps**

In the deps object:

```typescript
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
    llmProvider,  // Add this
  };
```

**Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: PASS (or IPC errors which we fix next)

**Step 7: Commit**

```bash
git add src/main/container.ts
git commit -m "feat(main): wire LLM provider based on config"
```

---

## Task 6: Add IPC Handlers for LLM Provider

**Files:**
- Modify: `src/main/ipc.ts`

**Step 1: Add validation handlers**

Add after the Classification section (around line 254):

```typescript
  // ==========================================
  // LLM Provider
  // ==========================================

  ipcMain.handle('llm:validate', async (_, key) => {
    const k = key ? assertString(key, 'key', 500) : '';
    return useCases.validateLLMProvider(k);
  });

  ipcMain.handle('llm:listModels', () => {
    return useCases.listLLMModels();
  });

  ipcMain.handle('llm:testConnection', () => {
    return useCases.testLLMConnection();
  });
```

**Step 2: Update config validation for new LLM config shape**

Update the `config:set` handler's LLM validation (around line 387):

```typescript
    if (k === 'llm') {
      if (!value || typeof value !== 'object') throw new Error('Invalid llm config');
      const v = value as Record<string, unknown>;

      // Validate provider
      if (v.provider !== undefined) {
        const validProviders = ['anthropic', 'ollama'];
        if (!validProviders.includes(v.provider as string)) {
          throw new Error('Invalid provider');
        }
      }

      // Validate model (just check it's a string, actual model comes from API)
      if (v.model !== undefined) {
        assertString(v.model, 'model', 100);
      }

      if (v.dailyBudget !== undefined) assertPositiveInt(v.dailyBudget, 'dailyBudget');
      if (v.dailyEmailLimit !== undefined) assertPositiveInt(v.dailyEmailLimit, 'dailyEmailLimit');
      if (v.autoClassify !== undefined) assertBoolean(v.autoClassify, 'autoClassify');
      if (v.confidenceThreshold !== undefined) {
        const ct = v.confidenceThreshold;
        if (typeof ct !== 'number' || ct < 0 || ct > 1) {
          throw new Error('confidenceThreshold must be between 0 and 1');
        }
      }
      if (v.reclassifyCooldownDays !== undefined) {
        const validCooldowns = [1, 3, 7, 14, -1];
        const cd = v.reclassifyCooldownDays;
        if (typeof cd !== 'number' || !validCooldowns.includes(cd)) {
          throw new Error('reclassifyCooldownDays must be 1, 3, 7, 14, or -1 (never)');
        }
      }
      if (v.ollamaServerUrl !== undefined) {
        assertString(v.ollamaServerUrl, 'ollamaServerUrl', 200);
      }
    }
```

**Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add src/main/ipc.ts
git commit -m "feat(ipc): add LLM provider validation and model listing handlers"
```

---

## Task 7: Update Preload Script

**Files:**
- Modify: `src/main/preload.ts`

**Step 1: Add new LLM methods**

Update the `llm` object in the api (around line 55):

```typescript
  llm: {
    classify: (emailId: number) => ipcRenderer.invoke('llm:classify', emailId),
    classifyAndApply: (emailId: number) => ipcRenderer.invoke('llm:classifyAndApply', emailId),
    getBudget: () => ipcRenderer.invoke('llm:getBudget'),
    getEmailBudget: () => ipcRenderer.invoke('llm:getEmailBudget'),
    validate: (key?: string) => ipcRenderer.invoke('llm:validate', key) as Promise<{ valid: boolean; error?: string }>,
    listModels: () => ipcRenderer.invoke('llm:listModels') as Promise<{ id: string; displayName: string; createdAt?: string }[]>,
    testConnection: () => ipcRenderer.invoke('llm:testConnection') as Promise<{ connected: boolean; error?: string }>,
  },
```

**Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add src/main/preload.ts
git commit -m "feat(preload): expose LLM provider methods to renderer"
```

---

## Task 8: Update ClassificationSettings Component

**Files:**
- Modify: `src/renderer/App.tsx`

**Step 1: Update state and types**

Replace the ClassificationSettings function (starting around line 400):

```typescript
function ClassificationSettings() {
  const [config, setConfig] = useState<{
    provider: 'anthropic' | 'ollama';
    model: string;
    dailyBudget: number;
    dailyEmailLimit: number;
    autoClassify: boolean;
    confidenceThreshold?: number;
    reclassifyCooldownDays?: number;
    ollamaServerUrl?: string;
  } | null>(null);
  const [hasApiKey, setHasApiKey] = useState<boolean>(false);
  const [emailBudget, setEmailBudget] = useState<{ used: number; limit: number } | null>(null);
  const [loading, setLoading] = useState(true);

  // New state for provider features
  const [models, setModels] = useState<{ id: string; displayName: string }[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [validatingKey, setValidatingKey] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [ollamaStatus, setOllamaStatus] = useState<{ connected: boolean; error?: string } | null>(null);
  const [testingConnection, setTestingConnection] = useState(false);

  // Load config on mount
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const [llmConfig, apiKeyStatus, budget] = await Promise.all([
          window.mailApi.config.get('llm'),
          window.mailApi.credentials.hasApiKey('anthropic'),
          window.mailApi.llm.getEmailBudget()
        ]);
        setConfig(llmConfig as typeof config);
        setHasApiKey(apiKeyStatus);
        setEmailBudget(budget);
      } catch (error) {
        console.error('Failed to load classification settings:', error);
      } finally {
        setLoading(false);
      }
    };
    loadConfig();
  }, []);

  // Load models when provider changes or API key is set
  useEffect(() => {
    if (!config) return;

    const loadModels = async () => {
      // For Anthropic, only load if API key is configured
      if (config.provider === 'anthropic' && !hasApiKey) {
        setModels([]);
        return;
      }

      // For Ollama, check connection first
      if (config.provider === 'ollama') {
        setTestingConnection(true);
        const status = await window.mailApi.llm.testConnection();
        setOllamaStatus(status);
        setTestingConnection(false);
        if (!status.connected) {
          setModels([]);
          return;
        }
      }

      setLoadingModels(true);
      try {
        const modelList = await window.mailApi.llm.listModels();
        setModels(modelList);
      } catch (error) {
        console.error('Failed to load models:', error);
        setModels([]);
      } finally {
        setLoadingModels(false);
      }
    };

    loadModels();
  }, [config?.provider, hasApiKey]);

  // Save config changes
  const updateConfig = async (updates: Partial<NonNullable<typeof config>>) => {
    if (!config) return;
    const newConfig = { ...config, ...updates };
    try {
      await window.mailApi.config.set('llm', newConfig);
      setConfig(newConfig);
    } catch (error) {
      console.error('Failed to save classification settings:', error);
    }
  };

  // Validate and save API key
  const handleSaveApiKey = async () => {
    if (!apiKeyInput.trim()) return;

    setValidatingKey(true);
    setKeyError(null);

    try {
      const result = await window.mailApi.llm.validate(apiKeyInput);
      if (result.valid) {
        await window.mailApi.credentials.setApiKey('anthropic', apiKeyInput);
        setHasApiKey(true);
        setApiKeyInput('');
        // Reload models after key is saved
        const modelList = await window.mailApi.llm.listModels();
        setModels(modelList);
      } else {
        setKeyError(result.error || 'Invalid API key');
      }
    } catch (error) {
      setKeyError(String(error));
    } finally {
      setValidatingKey(false);
    }
  };

  // Test Ollama connection
  const handleTestOllama = async () => {
    setTestingConnection(true);
    try {
      const status = await window.mailApi.llm.testConnection();
      setOllamaStatus(status);
      if (status.connected) {
        const modelList = await window.mailApi.llm.listModels();
        setModels(modelList);
      }
    } finally {
      setTestingConnection(false);
    }
  };

  if (loading || !config) {
    return (
      <div className="text-center py-4" style={{ color: 'var(--color-text-tertiary)' }}>
        Loading...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Auto-classify toggle */}
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
            Auto-classify new emails
          </div>
          <div className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
            Use AI to automatically tag incoming emails
          </div>
        </div>
        <input
          type="checkbox"
          checked={config.autoClassify}
          onChange={(e) => updateConfig({ autoClassify: e.target.checked })}
          className="h-5 w-5"
        />
      </div>

      {/* Provider selection */}
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
            Provider
          </div>
          <div className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
            Choose between cloud or local LLM
          </div>
        </div>
        <select
          value={config.provider}
          onChange={(e) => updateConfig({ provider: e.target.value as 'anthropic' | 'ollama', model: '' })}
          className="input w-48"
        >
          <option value="anthropic">Anthropic Claude</option>
          <option value="ollama">Local (Ollama)</option>
        </select>
      </div>

      {/* Anthropic API Key */}
      {config.provider === 'anthropic' && (
        <div className="pt-4 border-t" style={{ borderColor: 'var(--color-border)' }}>
          <div className="font-medium mb-2" style={{ color: 'var(--color-text-primary)' }}>
            API Key
          </div>
          {hasApiKey ? (
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ background: 'var(--color-success)' }}
                />
                <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                  sk-ant-••••••••••••
                </span>
              </div>
              <button
                onClick={() => setHasApiKey(false)}
                className="text-sm px-3 py-1 rounded"
                style={{ color: 'var(--color-primary)', background: 'var(--color-bg-secondary)' }}
              >
                Change
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex gap-2">
                <input
                  type="password"
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder="sk-ant-..."
                  className="input flex-1"
                />
                <button
                  onClick={handleSaveApiKey}
                  disabled={validatingKey || !apiKeyInput.trim()}
                  className="btn btn-primary"
                >
                  {validatingKey ? 'Validating...' : 'Save'}
                </button>
              </div>
              {keyError && (
                <div className="text-sm" style={{ color: 'var(--color-danger)' }}>
                  {keyError}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Ollama Server URL */}
      {config.provider === 'ollama' && (
        <div className="pt-4 border-t" style={{ borderColor: 'var(--color-border)' }}>
          <div className="font-medium mb-2" style={{ color: 'var(--color-text-primary)' }}>
            Server URL
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={config.ollamaServerUrl || 'http://localhost:11434'}
              onChange={(e) => updateConfig({ ollamaServerUrl: e.target.value })}
              className="input flex-1"
            />
            <button
              onClick={handleTestOllama}
              disabled={testingConnection}
              className="btn"
              style={{ background: 'var(--color-bg-secondary)' }}
            >
              {testingConnection ? 'Testing...' : 'Test'}
            </button>
          </div>
          {ollamaStatus && (
            <div className="flex items-center gap-2 mt-2">
              <div
                className="w-2 h-2 rounded-full"
                style={{ background: ollamaStatus.connected ? 'var(--color-success)' : 'var(--color-danger)' }}
              />
              <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                {ollamaStatus.connected ? 'Connected' : ollamaStatus.error || 'Not connected'}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Model selection */}
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
            Model
          </div>
          <div className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
            {config.provider === 'anthropic' ? 'Choose speed vs quality' : 'Select installed model'}
          </div>
        </div>
        <select
          value={config.model}
          onChange={(e) => updateConfig({ model: e.target.value })}
          className="input w-48"
          disabled={loadingModels || models.length === 0}
        >
          {loadingModels ? (
            <option>Loading...</option>
          ) : models.length === 0 ? (
            <option>{config.provider === 'anthropic' ? 'Configure API key first' : 'No models found'}</option>
          ) : (
            models.map(m => (
              <option key={m.id} value={m.id}>{m.displayName}</option>
            ))
          )}
        </select>
      </div>

      {/* Daily token budget */}
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
            Daily token budget
          </div>
          <div className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
            Limit API usage to control costs
          </div>
        </div>
        <input
          type="number"
          value={config.dailyBudget}
          onChange={(e) => updateConfig({ dailyBudget: parseInt(e.target.value) || 0 })}
          min="1000"
          step="1000"
          className="input w-32"
        />
      </div>

      {/* Daily email limit */}
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
            Daily email limit
          </div>
          <div className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
            Maximum emails to classify per day
          </div>
        </div>
        <input
          type="number"
          value={config.dailyEmailLimit}
          onChange={(e) => updateConfig({ dailyEmailLimit: parseInt(e.target.value) || 0 })}
          min="1"
          step="10"
          className="input w-32"
        />
      </div>

      {/* Confidence threshold */}
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
            Confidence threshold
          </div>
          <div className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
            Minimum confidence to auto-apply tags
          </div>
        </div>
        <select
          value={config.confidenceThreshold ?? 0.7}
          onChange={(e) => updateConfig({ confidenceThreshold: parseFloat(e.target.value) })}
          className="input w-40"
        >
          {CONFIDENCE_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      {/* Reclassify cooldown */}
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
            Reclassify cooldown
          </div>
          <div className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
            Wait time before reclassifying edited emails
          </div>
        </div>
        <select
          value={config.reclassifyCooldownDays ?? 7}
          onChange={(e) => updateConfig({ reclassifyCooldownDays: parseInt(e.target.value) })}
          className="input w-48"
        >
          {COOLDOWN_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      {/* Usage section */}
      <div className="pt-4 border-t" style={{ borderColor: 'var(--color-border)' }}>
        {emailBudget && (
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
              Daily usage
            </div>
            <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              {emailBudget.used} / {emailBudget.limit} emails classified today
            </span>
          </div>
        )}
        {config.provider === 'anthropic' && (
          <a
            href="https://console.anthropic.com/settings/usage"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm flex items-center gap-1"
            style={{ color: 'var(--color-primary)' }}
          >
            View usage in Anthropic Console
            <span>→</span>
          </a>
        )}
      </div>
    </div>
  );
}
```

**Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add src/renderer/App.tsx
git commit -m "feat(ui): update ClassificationSettings with provider selection and API key input"
```

---

## Task 9: Manual Testing

**Step 1: Start the app**

Run: `npm run dev:electron`

**Step 2: Test Anthropic flow**

1. Open Settings → AI Classification
2. Verify "Provider" dropdown shows "Anthropic Claude"
3. Verify API Key section shows input field
4. Enter an invalid key → should show error
5. Enter a valid key → should show "Configured" and populate models dropdown
6. Select a model → should save

**Step 3: Test Ollama flow**

1. Start Ollama locally: `ollama serve`
2. Pull a model: `ollama pull llama3.2`
3. In Settings, change Provider to "Local (Ollama)"
4. Click "Test" → should show "Connected"
5. Models dropdown should populate with installed models
6. Select a model → should save

**Step 4: Commit final changes if any**

```bash
git add -A
git commit -m "chore: testing and polish"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Add LLMProvider port and types | `src/core/ports.ts` |
| 2 | Add LLM provider use cases | `src/core/usecases.ts` |
| 3 | Create Anthropic provider adapter | `src/adapters/llm/anthropic.ts`, `index.ts` |
| 4 | Create Ollama provider adapter | `src/adapters/llm/ollama.ts` |
| 5 | Wire LLM provider in container | `src/main/container.ts` |
| 6 | Add IPC handlers | `src/main/ipc.ts` |
| 7 | Update preload script | `src/main/preload.ts` |
| 8 | Update UI component | `src/renderer/App.tsx` |
| 9 | Manual testing | - |
