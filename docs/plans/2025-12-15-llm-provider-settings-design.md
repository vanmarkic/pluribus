# LLM Provider Settings Design

## Overview

Add secure API key management, dynamic model selection from provider APIs, and support for multiple LLM providers (Anthropic Claude and local Ollama).

## Features

1. **Secure API key entry** - Inline password field in settings, validated before saving to OS keychain
2. **Dynamic model list** - Fetched from provider API (Anthropic `/v1/models` or Ollama `/api/tags`)
3. **Provider selection** - Switch between Anthropic Claude and Local (Ollama)
4. **Usage link** - Opens Anthropic Console for detailed usage stats

## UI Design

```
┌─ AI Classification ─────────────────────────────┐
│                                                 │
│ Auto-classify new emails                    [✓] │
│                                                 │
│ Provider                                        │
│ [Anthropic Claude ▼]                            │
│                                                 │
│ ── When Anthropic selected ──                   │
│ API Key                                         │
│ [sk-ant-••••••••••••••••] [Change]  ✓ Valid     │
│                                                 │
│ Model                                           │
│ [Claude Haiku 4 ▼]                              │
│                                                 │
│ Usage                                           │
│ View usage in Anthropic Console →               │
│                                                 │
│ ── When Ollama selected ──                      │
│ Server URL                                      │
│ [http://localhost:11434] ● Connected            │
│                                                 │
│ Model                                           │
│ [llama3.2 ▼]                                    │
└─────────────────────────────────────────────────┘
```

## Architecture (Clean Architecture)

Data flow: `Renderer → IPC → Use Case → Port → Adapter → External API`

### New Port Type

```typescript
// core/ports.ts
export type LLMProvider = {
  validateKey: (key: string) => Promise<{ valid: boolean; error?: string }>;
  listModels: () => Promise<LLMModel[]>;
  testConnection?: () => Promise<{ connected: boolean; error?: string }>;
};

export type LLMModel = {
  id: string;
  displayName: string;
  createdAt?: string;
};

// Update LLMConfig
export type LLMConfig = {
  provider: 'anthropic' | 'ollama';
  model: string;
  autoClassify: boolean;
  // Anthropic-specific
  dailyBudget?: number;
  dailyEmailLimit?: number;
  // Ollama-specific
  serverUrl?: string;
};
```

### New Use Cases

```typescript
// core/usecases.ts
export const validateLLMProvider = (deps: Pick<Deps, 'llmProvider'>) =>
  (provider: 'anthropic' | 'ollama', key?: string): Promise<{ valid: boolean; error?: string }> =>
    deps.llmProvider.validateKey(key || '');

export const listLLMModels = (deps: Pick<Deps, 'llmProvider'>) =>
  (): Promise<LLMModel[]> =>
    deps.llmProvider.listModels();

export const testLLMConnection = (deps: Pick<Deps, 'llmProvider'>) =>
  (): Promise<{ connected: boolean; error?: string }> =>
    deps.llmProvider.testConnection?.() ?? Promise.resolve({ connected: true });
```

## Files to Modify

| File | Changes |
|------|---------|
| `src/core/ports.ts` | Add `LLMProvider` port type, `LLMModel` type, update `LLMConfig` |
| `src/core/domain.ts` | Add `LLMModel` domain type if needed |
| `src/core/usecases.ts` | Add `validateLLMProvider`, `listLLMModels`, `testLLMConnection` use cases |
| `src/adapters/llm/anthropic.ts` | **Rename from index.ts** - Add `validateKey()`, `listModels()`, implement `LLMProvider` |
| `src/adapters/llm/ollama.ts` | **New file** - Ollama provider implementing `LLMProvider` + `Classifier` |
| `src/adapters/llm/index.ts` | **New file** - Factory that returns correct provider based on config |
| `src/main/container.ts` | Wire `llmProvider` based on `llm.provider` config |
| `src/main/ipc.ts` | Add `llm:validate`, `llm:listModels`, `llm:testConnection` handlers |
| `src/main/preload.ts` | Expose new methods: `llm.validate()`, `llm.listModels()`, `llm.testConnection()` |
| `src/renderer/App.tsx` | Update AI Classification settings with provider dropdown, API key input, dynamic model dropdown |

## Implementation Details

### Anthropic Adapter (`src/adapters/llm/anthropic.ts`)

```typescript
export function createAnthropicProvider(secrets: SecureStorage): LLMProvider {
  return {
    async validateKey(key: string) {
      try {
        const client = new Anthropic({ apiKey: key });
        await client.models.list();
        return { valid: true };
      } catch (err) {
        return { valid: false, error: String(err) };
      }
    },

    async listModels() {
      const apiKey = await secrets.getApiKey('anthropic');
      if (!apiKey) return [];

      const client = new Anthropic({ apiKey });
      const response = await client.models.list();

      return response.data.map(m => ({
        id: m.id,
        displayName: m.display_name,
        createdAt: m.created_at,
      }));
    },
  };
}
```

### Ollama Adapter (`src/adapters/llm/ollama.ts`)

```typescript
export function createOllamaProvider(serverUrl: string): LLMProvider {
  return {
    async validateKey() {
      // Ollama doesn't need API key, just test connection
      return this.testConnection();
    },

    async listModels() {
      const response = await fetch(`${serverUrl}/api/tags`);
      const data = await response.json();

      return data.models.map((m: any) => ({
        id: m.name,
        displayName: m.name,
      }));
    },

    async testConnection() {
      try {
        const response = await fetch(`${serverUrl}/api/tags`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return { connected: true };
      } catch (err) {
        return { connected: false, error: String(err) };
      }
    },
  };
}
```

### IPC Handlers

```typescript
// main/ipc.ts
ipcMain.handle('llm:validate', (_, provider, key) => {
  const p = assertString(provider, 'provider', 20);
  if (!['anthropic', 'ollama'].includes(p)) throw new Error('Invalid provider');
  const k = key ? assertString(key, 'key', 500) : undefined;
  return useCases.validateLLMProvider(p as 'anthropic' | 'ollama', k);
});

ipcMain.handle('llm:listModels', () => {
  return useCases.listLLMModels();
});

ipcMain.handle('llm:testConnection', () => {
  return useCases.testLLMConnection();
});
```

### Preload API

```typescript
// main/preload.ts
llm: {
  // existing...
  validate: (provider: string, key?: string) =>
    ipcRenderer.invoke('llm:validate', provider, key),
  listModels: () =>
    ipcRenderer.invoke('llm:listModels'),
  testConnection: () =>
    ipcRenderer.invoke('llm:testConnection'),
},
```

## UI Flow

### On Settings Load
1. Load `llm` config to get current provider
2. Check `credentials.hasApiKey('anthropic')` if Anthropic selected
3. If configured → show "Configured" status, call `llm.listModels()` to populate dropdown
4. If not configured → show API key input, model dropdown disabled

### On Provider Change
1. Update `config.set('llm', { ...config, provider: newProvider })`
2. Reset model selection
3. If Ollama → call `llm.testConnection()` to show status
4. Fetch models for new provider

### On API Key Save (Anthropic)
1. User enters key, clicks "Save"
2. Call `llm.validate('anthropic', key)` → show spinner
3. If valid:
   - Call `credentials.setApiKey('anthropic', key)`
   - Fetch models, populate dropdown
   - Show "✓ Configured"
4. If invalid:
   - Show error message
   - Don't save

### On Server URL Change (Ollama)
1. User edits URL
2. Debounce 500ms, then call `llm.testConnection()`
3. Update status indicator
4. If connected → fetch models

## Security Considerations

- API key never exposed to renderer (stored in OS keychain)
- Validation happens in main process
- Key passed to `validate()` only during initial setup, not stored in renderer state
- Ollama runs locally, no external credentials needed
