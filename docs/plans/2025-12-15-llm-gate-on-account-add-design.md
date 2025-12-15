# LLM Configuration Gate on Account Add

## Overview

Block account creation until an LLM provider (Anthropic or Ollama) is properly configured. After successful account add, run classification in the background.

## Requirements

1. **Block account creation** if LLM not configured
2. **Anthropic configured** = API key exists + validates
3. **Ollama configured** = server reachable + at least one model installed
4. **Block at wizard start** — show message before any wizard steps
5. **Simple blocking UI** — message + "Open AI Settings" button
6. **Background classification** — after account add, classify async without blocking wizard completion

## Design

### 1. New Use Case: `isLLMConfigured`

**Location:** `src/core/usecases.ts`

```typescript
export const isLLMConfigured = (deps: Pick<Deps, 'llm' | 'config' | 'secrets'>) =>
  async (): Promise<{ configured: boolean; reason?: string }> => {
    const config = deps.config.getLLMConfig();

    if (config.provider === 'anthropic') {
      const key = await deps.secrets.getApiKey();
      if (!key) return { configured: false, reason: 'No API key set' };
      const result = await deps.llm.validateKey(key);
      return result.valid
        ? { configured: true }
        : { configured: false, reason: result.error };
    }

    // Ollama: check connection + models
    const conn = await deps.llm.testConnection();
    if (!conn.connected) return { configured: false, reason: conn.error };
    const models = await deps.llm.listModels();
    if (models.length === 0)
      return { configured: false, reason: 'No models installed' };
    return { configured: true };
  };
```

### 2. New Adapter: Background Task Manager

**Location:** `src/adapters/background/index.ts` (new file)

```typescript
export type TaskStatus = 'running' | 'completed' | 'failed';

export type TaskState = {
  status: TaskStatus;
  processed: number;
  total: number;
  error?: string;
};

export type BackgroundTaskManager = {
  start: (id: string, total: number, fn: (onProgress: () => void) => Promise<void>) => void;
  getStatus: (id: string) => TaskState | null;
  clear: (id: string) => void;
};

export function createBackgroundTaskManager(): BackgroundTaskManager {
  const tasks = new Map<string, TaskState>();

  return {
    start(id, total, fn) {
      tasks.set(id, { status: 'running', processed: 0, total });

      const onProgress = () => {
        const task = tasks.get(id);
        if (task) task.processed++;
      };

      fn(onProgress)
        .then(() => {
          const task = tasks.get(id);
          if (task) task.status = 'completed';
        })
        .catch((err) => {
          const task = tasks.get(id);
          if (task) {
            task.status = 'failed';
            task.error = err.message;
          }
        });
    },

    getStatus(id) {
      return tasks.get(id) || null;
    },

    clear(id) {
      tasks.delete(id);
    },
  };
}
```

### 3. New Use Cases: Background Classification

**Location:** `src/core/usecases.ts`

```typescript
export const startBackgroundClassification = (deps: Pick<Deps, 'backgroundTasks' | ...>) =>
  (emailIds: number[]): { taskId: string; count: number } => {
    const taskId = crypto.randomUUID();
    const threshold = deps.config.getLLMConfig().confidenceThreshold;

    deps.backgroundTasks.start(taskId, emailIds.length, async (onProgress) => {
      for (const emailId of emailIds) {
        await classifyAndApply(deps)(emailId, threshold);
        onProgress();
      }
    });

    return { taskId, count: emailIds.length };
  };

export const getBackgroundTaskStatus = (deps: Pick<Deps, 'backgroundTasks'>) =>
  (taskId: string): TaskState | null => {
    return deps.backgroundTasks.getStatus(taskId);
  };

export const clearBackgroundTask = (deps: Pick<Deps, 'backgroundTasks'>) =>
  (taskId: string): void => {
    deps.backgroundTasks.clear(taskId);
  };
```

### 4. Port Definition

**Location:** `src/core/ports.ts`

```typescript
export type BackgroundTaskManager = {
  start: (id: string, total: number, fn: (onProgress: () => void) => Promise<void>) => void;
  getStatus: (id: string) => TaskState | null;
  clear: (id: string) => void;
};

// Add to Deps type
export type Deps = {
  // ... existing deps
  backgroundTasks: BackgroundTaskManager;
};
```

### 5. Container Wiring

**Location:** `src/main/container.ts`

```typescript
import { createBackgroundTaskManager } from '../adapters/background';

// In createDeps()
const backgroundTasks = createBackgroundTaskManager();

// Add to deps object
const deps: Deps = {
  // ... existing deps
  backgroundTasks,
};

// Add to useCases
const useCases = {
  // ... existing use cases
  isLLMConfigured: isLLMConfigured(deps),
  startBackgroundClassification: startBackgroundClassification(deps),
  getBackgroundTaskStatus: getBackgroundTaskStatus(deps),
  clearBackgroundTask: clearBackgroundTask(deps),
};
```

### 6. IPC Handlers

**Location:** `src/main/ipc.ts`

```typescript
ipcMain.handle('llm:isConfigured', async () => {
  return useCases.isLLMConfigured();
});

ipcMain.handle('llm:startBackgroundClassification', async (_, emailIds: number[]) => {
  if (!Array.isArray(emailIds) || !emailIds.every(id => typeof id === 'number')) {
    throw new Error('Invalid emailIds');
  }
  return useCases.startBackgroundClassification(emailIds);
});

ipcMain.handle('llm:getTaskStatus', async (_, taskId: string) => {
  if (typeof taskId !== 'string') throw new Error('Invalid taskId');
  return useCases.getBackgroundTaskStatus(taskId);
});

ipcMain.handle('llm:clearTask', async (_, taskId: string) => {
  if (typeof taskId !== 'string') throw new Error('Invalid taskId');
  useCases.clearBackgroundTask(taskId);
});
```

### 7. Preload Exposure

**Location:** `src/main/preload.ts`

```typescript
llm: {
  // ... existing methods
  isConfigured: () => ipcRenderer.invoke('llm:isConfigured'),
  startBackgroundClassification: (emailIds: number[]) =>
    ipcRenderer.invoke('llm:startBackgroundClassification', emailIds),
  getTaskStatus: (taskId: string) => ipcRenderer.invoke('llm:getTaskStatus', taskId),
  clearTask: (taskId: string) => ipcRenderer.invoke('llm:clearTask', taskId),
},
```

### 8. AccountWizard Changes

**Location:** `src/renderer/components/AccountWizard.tsx`

Add state:
```typescript
const [llmCheck, setLlmCheck] = useState<'checking' | 'configured' | 'not-configured'>('checking');
const [llmReason, setLlmReason] = useState<string>('');
```

Check on mount:
```typescript
useEffect(() => {
  window.mailApi.llm.isConfigured().then((result) => {
    if (result.configured) {
      setLlmCheck('configured');
    } else {
      setLlmCheck('not-configured');
      setLlmReason(result.reason || 'LLM provider not configured');
    }
  });
}, []);
```

Render blocking UI when not configured:
```typescript
if (llmCheck === 'checking') {
  return <div>Checking AI configuration...</div>;
}

if (llmCheck === 'not-configured') {
  return (
    <div className="...">
      <h2>AI Provider Not Configured</h2>
      <p>This mail client requires an AI provider to classify your emails.</p>
      <p className="text-red-500">{llmReason}</p>
      <div className="flex gap-2">
        <button onClick={() => { onClose(); navigate('/settings'); }}>
          Open AI Settings
        </button>
        <button onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

// ... existing wizard steps
```

After account add succeeds:
```typescript
const result = await window.mailApi.accounts.add(...);

if (result.newEmailIds?.length > 0) {
  const { taskId } = await window.mailApi.llm.startBackgroundClassification(result.newEmailIds);
  store.setClassificationTask(taskId);
}
```

### 9. Store Changes

**Location:** `src/renderer/stores/index.ts`

```typescript
// Add to store state
classificationTaskId: string | null;
classificationProgress: { processed: number; total: number } | null;

// Add actions
setClassificationTask: (taskId: string) => void;
clearClassificationTask: () => void;

// Polling effect (in App.tsx or useEffect in store)
useEffect(() => {
  if (!classificationTaskId) return;

  const interval = setInterval(async () => {
    const status = await window.mailApi.llm.getTaskStatus(classificationTaskId);
    if (!status) {
      clearClassificationTask();
      return;
    }

    setClassificationProgress({ processed: status.processed, total: status.total });

    if (status.status === 'completed' || status.status === 'failed') {
      await window.mailApi.llm.clearTask(classificationTaskId);
      clearClassificationTask();
      // Refresh email list to show new tags
      refreshEmails();
    }
  }, 1000);

  return () => clearInterval(interval);
}, [classificationTaskId]);
```

### 10. Progress Indicator UI

**Location:** `src/renderer/App.tsx` or header component

```typescript
{classificationProgress && (
  <div className="text-sm text-gray-500">
    Classifying emails... {classificationProgress.processed}/{classificationProgress.total}
  </div>
)}
```

## Files Changed

| File | Type | Change |
|------|------|--------|
| `src/core/ports.ts` | Modify | Add `BackgroundTaskManager` type |
| `src/core/usecases.ts` | Modify | Add 4 new use cases |
| `src/adapters/background/index.ts` | **New** | Task manager implementation |
| `src/main/container.ts` | Modify | Wire new adapter and use cases |
| `src/main/ipc.ts` | Modify | Add 4 IPC handlers |
| `src/main/preload.ts` | Modify | Expose new IPC methods |
| `src/renderer/components/AccountWizard.tsx` | Modify | Add LLM check and blocking UI |
| `src/renderer/stores/index.ts` | Modify | Add task tracking state |
| `src/renderer/App.tsx` | Modify | Add progress indicator |

## Testing

1. **No LLM configured:** Open AccountWizard → see blocking message
2. **Anthropic without key:** See "No API key set" message
3. **Ollama not running:** See "Ollama server not reachable" message
4. **Ollama no models:** See "No models installed" message
5. **LLM configured:** Wizard works normally
6. **After account add:** Classification starts in background, progress shows, emails get tagged
