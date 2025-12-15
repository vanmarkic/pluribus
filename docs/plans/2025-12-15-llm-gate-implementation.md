# LLM Gate on Account Add - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Block account creation until an LLM provider is configured, then run classification in background after account is added.

**Architecture:** Add `isLLMConfigured` use case that checks provider-specific requirements. Add background task manager adapter for async classification. Modify AccountWizard to check LLM config on mount and block if not configured.

**Tech Stack:** TypeScript, Electron IPC, React (Zustand), Clean Architecture (ports → adapters → use cases)

---

## Parallelization Map

```
PARALLEL GROUP 1 (Backend - no UI dependencies):
├── Task 1: Add BackgroundTaskManager port
├── Task 2: Create background adapter
└── Task 3: Add isLLMConfigured use case

PARALLEL GROUP 2 (Wiring - depends on Group 1):
├── Task 4: Wire container
└── Task 5: Add IPC handlers

PARALLEL GROUP 3 (Depends on Task 5):
└── Task 6: Add preload methods

PARALLEL GROUP 4 (Frontend - depends on Task 6):
├── Task 7: Add store state
├── Task 8: Modify AccountWizard
└── Task 9: Add progress indicator
```

---

## Task 1: Add BackgroundTaskManager Port

**Files:**
- Modify: `src/core/ports.ts:319` (end of file, before closing)

**Step 1: Add TaskState and BackgroundTaskManager types**

Add before the `Deps` type definition (around line 301):

```typescript
// ============================================
// Background Task Manager
// ============================================

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
```

**Step 2: Add backgroundTasks to Deps type**

Modify the `Deps` type (around line 304) to include:

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
  llmProvider: LLMProvider;
  backgroundTasks: BackgroundTaskManager;  // <-- Add this line
};
```

**Step 3: Verify TypeScript compiles**

Run: `npm run typecheck`
Expected: PASS (or errors in container.ts about missing backgroundTasks - that's expected, we'll fix in Task 4)

**Step 4: Commit**

```bash
git add src/core/ports.ts
git commit -m "$(cat <<'EOF'
feat(ports): add BackgroundTaskManager port for async tasks

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Create Background Task Manager Adapter

**Files:**
- Create: `src/adapters/background/index.ts`

**Step 1: Create the adapter file**

```typescript
/**
 * Background Task Manager
 *
 * Manages async tasks with progress tracking.
 * Tasks run in-process but don't block IPC responses.
 */

import type { BackgroundTaskManager, TaskState, TaskStatus } from '../../core/ports';

export function createBackgroundTaskManager(): BackgroundTaskManager {
  const tasks = new Map<string, TaskState>();

  return {
    start(id: string, total: number, fn: (onProgress: () => void) => Promise<void>) {
      // Initialize task state
      tasks.set(id, { status: 'running', processed: 0, total });

      // Progress callback increments processed count
      const onProgress = () => {
        const task = tasks.get(id);
        if (task && task.status === 'running') {
          task.processed++;
        }
      };

      // Run async (don't await - fire and forget)
      fn(onProgress)
        .then(() => {
          const task = tasks.get(id);
          if (task) {
            task.status = 'completed';
            task.processed = task.total; // Ensure 100% on completion
          }
        })
        .catch((err) => {
          const task = tasks.get(id);
          if (task) {
            task.status = 'failed';
            task.error = err instanceof Error ? err.message : String(err);
          }
        });
    },

    getStatus(id: string): TaskState | null {
      return tasks.get(id) || null;
    },

    clear(id: string): void {
      tasks.delete(id);
    },
  };
}

// Re-export types for convenience
export type { BackgroundTaskManager, TaskState, TaskStatus };
```

**Step 2: Verify file exists and TypeScript compiles**

Run: `npm run typecheck`
Expected: Errors about container.ts (expected - we'll fix in Task 4)

**Step 3: Commit**

```bash
git add src/adapters/background/index.ts
git commit -m "$(cat <<'EOF'
feat(adapters): add background task manager for async classification

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Add Use Cases (isLLMConfigured + background classification)

**Files:**
- Modify: `src/core/usecases.ts`

**Step 1: Add isLLMConfigured use case**

Add after `testLLMConnection` (around line 336):

```typescript
export const isLLMConfigured = (deps: Pick<Deps, 'llmProvider' | 'config' | 'secrets'>) =>
  async (): Promise<{ configured: boolean; reason?: string }> => {
    const config = deps.config.getLLMConfig();

    if (config.provider === 'anthropic') {
      // Anthropic: needs API key that validates
      const key = await deps.secrets.getApiKey('anthropic');
      if (!key) {
        return { configured: false, reason: 'No API key configured' };
      }
      const result = await deps.llmProvider.validateKey(key);
      return result.valid
        ? { configured: true }
        : { configured: false, reason: result.error || 'Invalid API key' };
    }

    // Ollama: needs server reachable + at least one model
    if (!deps.llmProvider.testConnection) {
      return { configured: false, reason: 'Provider does not support connection test' };
    }
    const conn = await deps.llmProvider.testConnection();
    if (!conn.connected) {
      return { configured: false, reason: conn.error || 'Ollama server not reachable' };
    }
    const models = await deps.llmProvider.listModels();
    if (models.length === 0) {
      return { configured: false, reason: 'No models installed in Ollama' };
    }
    return { configured: true };
  };
```

**Step 2: Add background classification use cases**

Add after `isLLMConfigured`:

```typescript
export const startBackgroundClassification = (deps: Pick<Deps, 'backgroundTasks' | 'emails' | 'tags' | 'classifier' | 'classificationState' | 'config'>) =>
  (emailIds: number[]): { taskId: string; count: number } => {
    const taskId = crypto.randomUUID();
    const threshold = deps.config.getLLMConfig().confidenceThreshold;

    deps.backgroundTasks.start(taskId, emailIds.length, async (onProgress) => {
      for (const emailId of emailIds) {
        try {
          await classifyAndApply(deps)(emailId, threshold);
        } catch (error) {
          // Log error but continue with remaining emails
          console.error(`Background classification failed for email ${emailId}:`, error);
          await deps.classificationState.setState({
            emailId,
            status: 'error',
            confidence: null,
            priority: null,
            suggestedTags: [],
            reasoning: null,
            errorMessage: error instanceof Error ? error.message : String(error),
            classifiedAt: new Date(),
          });
        }
        onProgress();
      }
    });

    return { taskId, count: emailIds.length };
  };

export const getBackgroundTaskStatus = (deps: Pick<Deps, 'backgroundTasks'>) =>
  (taskId: string): import('./ports').TaskState | null => {
    return deps.backgroundTasks.getStatus(taskId);
  };

export const clearBackgroundTask = (deps: Pick<Deps, 'backgroundTasks'>) =>
  (taskId: string): void => {
    deps.backgroundTasks.clear(taskId);
  };
```

**Step 3: Add to createUseCases factory**

Find the `createUseCases` function (around line 989) and add to the return object:

```typescript
    // LLM Provider
    validateLLMProvider: validateLLMProvider(deps),
    listLLMModels: listLLMModels(deps),
    testLLMConnection: testLLMConnection(deps),
    isLLMConfigured: isLLMConfigured(deps),  // <-- Add

    // Background Tasks
    startBackgroundClassification: startBackgroundClassification(deps),  // <-- Add
    getBackgroundTaskStatus: getBackgroundTaskStatus(deps),  // <-- Add
    clearBackgroundTask: clearBackgroundTask(deps),  // <-- Add
```

**Step 4: Verify TypeScript compiles**

Run: `npm run typecheck`
Expected: Errors in container.ts (expected - we'll fix in Task 4)

**Step 5: Commit**

```bash
git add src/core/usecases.ts
git commit -m "$(cat <<'EOF'
feat(usecases): add isLLMConfigured and background classification

- isLLMConfigured checks provider requirements before account add
- startBackgroundClassification runs async after account creation
- getBackgroundTaskStatus/clearBackgroundTask for progress tracking

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Wire Container

**Files:**
- Modify: `src/main/container.ts`

**Step 1: Add import for background adapter**

Add to imports (around line 21):

```typescript
import { createBackgroundTaskManager } from '../adapters/background';
```

**Step 2: Create background task manager instance**

Add after `const imageCache = createImageCache(getDb);` (around line 231):

```typescript
  // Background task manager
  const backgroundTasks = createBackgroundTaskManager();
```

**Step 3: Add to deps object**

In the `deps: Deps` object (around line 248), add:

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
    llmProvider,
    backgroundTasks,  // <-- Add this line
  };
```

**Step 4: Verify TypeScript compiles**

Run: `npm run typecheck`
Expected: PASS

**Step 5: Commit**

```bash
git add src/main/container.ts
git commit -m "$(cat <<'EOF'
feat(container): wire background task manager

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Add IPC Handlers

**Files:**
- Modify: `src/main/ipc.ts`

**Step 1: Add isConfigured handler**

Add after `llm:testConnection` handler (around line 270):

```typescript
  ipcMain.handle('llm:isConfigured', async () => {
    return useCases.isLLMConfigured();
  });
```

**Step 2: Add background classification handlers**

Add after the new `llm:isConfigured` handler:

```typescript
  ipcMain.handle('llm:startBackgroundClassification', async (_, emailIds: number[]) => {
    if (!Array.isArray(emailIds)) {
      throw new Error('emailIds must be an array');
    }
    const validIds = emailIds.map((id, i) => {
      if (typeof id !== 'number' || !Number.isInteger(id) || id < 1) {
        throw new Error(`Invalid emailIds[${i}]: must be a positive integer`);
      }
      return id;
    });
    return useCases.startBackgroundClassification(validIds);
  });

  ipcMain.handle('llm:getTaskStatus', async (_, taskId: string) => {
    if (typeof taskId !== 'string') {
      throw new Error('taskId must be a string');
    }
    return useCases.getBackgroundTaskStatus(taskId);
  });

  ipcMain.handle('llm:clearTask', async (_, taskId: string) => {
    if (typeof taskId !== 'string') {
      throw new Error('taskId must be a string');
    }
    useCases.clearBackgroundTask(taskId);
  });
```

**Step 3: Verify TypeScript compiles**

Run: `npm run typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add src/main/ipc.ts
git commit -m "$(cat <<'EOF'
feat(ipc): add LLM config check and background classification handlers

- llm:isConfigured checks if provider is ready
- llm:startBackgroundClassification triggers async classification
- llm:getTaskStatus/clearTask for progress tracking

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Add Preload Methods

**Files:**
- Modify: `src/main/preload.ts`

**Step 1: Add new methods to llm object**

Find the `llm` object (around line 55) and add after `stopOllama`:

```typescript
  llm: {
    classify: (emailId: number) => ipcRenderer.invoke('llm:classify', emailId),
    classifyAndApply: (emailId: number) => ipcRenderer.invoke('llm:classifyAndApply', emailId),
    getBudget: () => ipcRenderer.invoke('llm:getBudget'),
    getEmailBudget: () => ipcRenderer.invoke('llm:getEmailBudget'),
    validate: (key?: string) => ipcRenderer.invoke('llm:validate', key) as Promise<{ valid: boolean; error?: string }>,
    listModels: () => ipcRenderer.invoke('llm:listModels') as Promise<{ id: string; displayName: string; createdAt?: string }[]>,
    testConnection: () => ipcRenderer.invoke('llm:testConnection') as Promise<{ connected: boolean; error?: string }>,
    startOllama: () => ipcRenderer.invoke('llm:startOllama') as Promise<{ started: boolean; error?: string }>,
    stopOllama: () => ipcRenderer.invoke('llm:stopOllama') as Promise<void>,
    // New methods for LLM gate
    isConfigured: () => ipcRenderer.invoke('llm:isConfigured') as Promise<{ configured: boolean; reason?: string }>,
    startBackgroundClassification: (emailIds: number[]) =>
      ipcRenderer.invoke('llm:startBackgroundClassification', emailIds) as Promise<{ taskId: string; count: number }>,
    getTaskStatus: (taskId: string) =>
      ipcRenderer.invoke('llm:getTaskStatus', taskId) as Promise<{ status: 'running' | 'completed' | 'failed'; processed: number; total: number; error?: string } | null>,
    clearTask: (taskId: string) => ipcRenderer.invoke('llm:clearTask', taskId) as Promise<void>,
  },
```

**Step 2: Verify TypeScript compiles**

Run: `npm run typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add src/main/preload.ts
git commit -m "$(cat <<'EOF'
feat(preload): expose LLM config and background classification to renderer

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Add Store State for Classification Progress

**Files:**
- Modify: `src/renderer/stores/index.ts`

**Step 1: Update window.mailApi type**

Find the `llm` section in the `Window` interface (around line 69) and add:

```typescript
      llm: {
        classify: (emailId: number) => Promise<any>;
        classifyAndApply: (emailId: number) => Promise<any>;
        getBudget: () => Promise<{ used: number; limit: number; allowed: boolean }>;
        getEmailBudget: () => Promise<{ used: number; limit: number; allowed: boolean }>;
        validate: (key?: string) => Promise<{ valid: boolean; error?: string }>;
        listModels: () => Promise<{ id: string; displayName: string; createdAt?: string }[]>;
        testConnection: () => Promise<{ connected: boolean; error?: string }>;
        startOllama: () => Promise<{ started: boolean; error?: string }>;
        stopOllama: () => Promise<void>;
        // New methods
        isConfigured: () => Promise<{ configured: boolean; reason?: string }>;
        startBackgroundClassification: (emailIds: number[]) => Promise<{ taskId: string; count: number }>;
        getTaskStatus: (taskId: string) => Promise<{ status: 'running' | 'completed' | 'failed'; processed: number; total: number; error?: string } | null>;
        clearTask: (taskId: string) => Promise<void>;
      };
```

**Step 2: Add classification task state to UIStore**

Find the `UIStore` type (around line 424) and add:

```typescript
type UIStore = {
  view: View;
  sidebarCollapsed: boolean;

  // Modal states
  showAccountWizard: boolean;
  editAccountId: number | null;
  composeMode: ComposeMode;
  composeEmailId: number | null;
  composeDraftId: number | null;

  // Classification progress
  classificationTaskId: string | null;
  classificationProgress: { processed: number; total: number } | null;

  setView: (view: View) => void;
  toggleSidebar: () => void;

  // Account wizard
  openAccountWizard: (editId?: number) => void;
  closeAccountWizard: () => void;

  // Compose
  openCompose: (mode: ComposeMode, emailId?: number) => void;
  openComposeDraft: (draftId: number) => void;
  closeCompose: () => void;

  // Classification
  setClassificationTask: (taskId: string, total: number) => void;
  updateClassificationProgress: (processed: number, total: number) => void;
  clearClassificationTask: () => void;
};
```

**Step 3: Add initial state and actions**

In the `useUIStore` create call (around line 451), add:

```typescript
export const useUIStore = create<UIStore>((set) => ({
  view: 'inbox',
  sidebarCollapsed: false,
  showAccountWizard: false,
  editAccountId: null,
  composeMode: null,
  composeEmailId: null,
  composeDraftId: null,
  classificationTaskId: null,
  classificationProgress: null,

  setView: (view) => set({ view }),
  toggleSidebar: () => set(state => ({ sidebarCollapsed: !state.sidebarCollapsed })),

  openAccountWizard: (editId) => set({ showAccountWizard: true, editAccountId: editId ?? null }),
  closeAccountWizard: () => set({ showAccountWizard: false, editAccountId: null }),

  openCompose: (mode, emailId) => set({ composeMode: mode, composeEmailId: emailId ?? null, composeDraftId: null }),
  openComposeDraft: (draftId) => set({ composeMode: 'new', composeEmailId: null, composeDraftId: draftId }),
  closeCompose: () => set({ composeMode: null, composeEmailId: null, composeDraftId: null }),

  setClassificationTask: (taskId, total) => set({ classificationTaskId: taskId, classificationProgress: { processed: 0, total } }),
  updateClassificationProgress: (processed, total) => set({ classificationProgress: { processed, total } }),
  clearClassificationTask: () => set({ classificationTaskId: null, classificationProgress: null }),
}));
```

**Step 4: Verify TypeScript compiles**

Run: `npm run typecheck`
Expected: PASS

**Step 5: Commit**

```bash
git add src/renderer/stores/index.ts
git commit -m "$(cat <<'EOF'
feat(stores): add classification task progress state

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Modify AccountWizard

**Files:**
- Modify: `src/renderer/components/AccountWizard.tsx`

**Step 1: Add LLM check state**

Add after the existing state declarations (around line 70):

```typescript
  const [llmCheck, setLlmCheck] = useState<'checking' | 'configured' | 'not-configured'>('checking');
  const [llmReason, setLlmReason] = useState<string>('');
```

**Step 2: Add useEffect to check LLM on mount**

Add after the existing useEffect for loading account (around line 64):

```typescript
  // Check LLM configuration on mount (only for new accounts)
  useEffect(() => {
    if (editAccountId) {
      // Skip check when editing existing account
      setLlmCheck('configured');
      return;
    }

    window.mailApi.llm.isConfigured().then((result) => {
      if (result.configured) {
        setLlmCheck('configured');
      } else {
        setLlmCheck('not-configured');
        setLlmReason(result.reason || 'LLM provider not configured');
      }
    }).catch((err) => {
      setLlmCheck('not-configured');
      setLlmReason(String(err));
    });
  }, [editAccountId]);
```

**Step 3: Add import for useUIStore**

Add to imports at top of file:

```typescript
import { useUIStore } from '../stores';
```

**Step 4: Modify handleSave to trigger background classification**

Find `handleSave` (around line 124) and modify the success path for new accounts:

```typescript
  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      if (editAccountId) {
        // Editing existing account - just update, no sync
        await window.mailApi.accounts.update(editAccountId, {
          name: form.email.split('@')[0],
          imapHost: form.imapHost,
          imapPort: form.imapPort,
          smtpHost: form.smtpHost,
          smtpPort: form.smtpPort,
        }, form.password || undefined);
        onSuccess();
      } else {
        // New account - use addAccount which creates + syncs
        setStep('syncing');
        setSaving(false);

        const result = await window.mailApi.accounts.add({
          name: form.email.split('@')[0],
          email: form.email,
          imapHost: form.imapHost,
          imapPort: form.imapPort,
          smtpHost: form.smtpHost,
          smtpPort: form.smtpPort,
          username: form.email,
        }, form.password);

        // Trigger background classification if we have new emails
        if (result.syncResult.newEmailIds.length > 0) {
          const { taskId, count } = await window.mailApi.llm.startBackgroundClassification(
            result.syncResult.newEmailIds
          );
          useUIStore.getState().setClassificationTask(taskId, count);
        }

        setSyncResult({
          newCount: result.syncResult.newCount,
          maxMessagesPerFolder: result.maxMessagesPerFolder,
        });
        setStep('complete');
      }
    } catch (err) {
      setError(String(err));
      if (step === 'syncing') {
        setStep('test');
        setTestResult('success'); // Connection was successful, sync failed
      }
      setSaving(false);
    }
  };
```

**Step 5: Add blocking UI at the start of render**

Find the start of the return statement (around line 178) and add blocking UI before the existing content:

```typescript
  // Show loading while checking LLM config
  if (llmCheck === 'checking') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
          <div className="flex items-center gap-3">
            <IconSpinnerBall className="w-6 h-6 animate-spin text-blue-600" />
            <span className="text-zinc-600">Checking AI configuration...</span>
          </div>
        </div>
      </div>
    );
  }

  // Block if LLM not configured
  if (llmCheck === 'not-configured') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4">
          <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200">
            <h2 className="text-lg font-semibold">AI Provider Required</h2>
            <button onClick={onClose} className="p-1 hover:bg-zinc-100 rounded">
              <IconClose className="w-5 h-5" />
            </button>
          </div>
          <div className="p-6 space-y-4">
            <div className="flex items-start gap-3">
              <IconCircleWarningFill className="w-6 h-6 text-amber-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-zinc-800 font-medium">
                  Configure an AI provider before adding accounts
                </p>
                <p className="text-sm text-zinc-500 mt-1">
                  This mail client uses AI to classify your emails. Please set up Ollama or Anthropic first.
                </p>
              </div>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p className="text-sm text-amber-800">{llmReason}</p>
            </div>
            <div className="flex gap-3 pt-2">
              <button
                onClick={onClose}
                className="flex-1 px-4 py-2 text-sm border border-zinc-200 rounded-lg hover:bg-zinc-50"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  onClose();
                  useUIStore.getState().setView('settings');
                }}
                className="flex-1 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Open AI Settings
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    // ... existing wizard UI
```

**Step 6: Verify TypeScript compiles**

Run: `npm run typecheck`
Expected: PASS

**Step 7: Commit**

```bash
git add src/renderer/components/AccountWizard.tsx
git commit -m "$(cat <<'EOF'
feat(wizard): block account creation until LLM configured

- Check LLM config on wizard mount
- Show blocking UI with reason if not configured
- Trigger background classification after account add

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Add Classification Progress Indicator

**Files:**
- Modify: `src/renderer/App.tsx`

**Step 1: Add import for classification state**

The `useUIStore` import already exists. Just destructure the new properties.

Find the line that destructures useUIStore (around line 23):

```typescript
  const { view, showAccountWizard, editAccountId, composeMode, composeEmailId, composeDraftId, closeAccountWizard, closeCompose, openCompose, classificationTaskId, classificationProgress, updateClassificationProgress, clearClassificationTask } = useUIStore();
```

**Step 2: Add useEffect to poll classification progress**

Add after the existing sync progress subscription (around line 83):

```typescript
  // Poll classification progress
  useEffect(() => {
    if (!classificationTaskId) return;

    const interval = setInterval(async () => {
      const status = await window.mailApi.llm.getTaskStatus(classificationTaskId);
      if (!status) {
        clearClassificationTask();
        return;
      }

      updateClassificationProgress(status.processed, status.total);

      if (status.status === 'completed' || status.status === 'failed') {
        await window.mailApi.llm.clearTask(classificationTaskId);
        clearClassificationTask();
        // Refresh emails to show new tags
        useEmailStore.getState().loadEmails();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [classificationTaskId]);
```

**Step 3: Add progress indicator in title bar**

Find the title bar div (around line 92) and add the indicator inside:

```typescript
      {/* macOS Title Bar - Drag Region */}
      <div
        className="h-10 shrink-0 flex items-center"
        style={{
          WebkitAppRegion: 'drag',
          background: 'var(--color-bg)',
          borderBottom: '1px solid var(--color-border)',
        } as React.CSSProperties}
      >
        {/* Space for traffic lights (left) */}
        <div className="w-20" />

        {/* Classification progress indicator */}
        {classificationProgress && (
          <div
            className="flex items-center gap-2 text-sm px-3 py-1 rounded-full"
            style={{
              WebkitAppRegion: 'no-drag',
              background: 'var(--color-bg-secondary)',
              color: 'var(--color-text-secondary)',
            } as React.CSSProperties}
          >
            <div
              className="w-2 h-2 rounded-full animate-pulse"
              style={{ background: 'var(--color-accent)' }}
            />
            <span>
              Classifying {classificationProgress.processed}/{classificationProgress.total} emails
            </span>
          </div>
        )}
      </div>
```

**Step 4: Verify TypeScript compiles**

Run: `npm run typecheck`
Expected: PASS

**Step 5: Test the app**

Run: `npm run dev:electron`
Expected: App starts, AccountWizard checks LLM config before showing

**Step 6: Commit**

```bash
git add src/renderer/App.tsx
git commit -m "$(cat <<'EOF'
feat(ui): add classification progress indicator in title bar

Shows progress while background classification runs after account add.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Testing Checklist

After all tasks complete:

1. **No LLM configured:**
   - Open AccountWizard → see "AI Provider Required" blocking message
   - Click "Open AI Settings" → navigates to settings, wizard closes

2. **Anthropic without key:**
   - Select Anthropic as provider, don't set key
   - Open AccountWizard → see "No API key configured"

3. **Ollama not running:**
   - Select Ollama as provider
   - Stop Ollama server
   - Open AccountWizard → see "Ollama server not reachable"

4. **Ollama no models:**
   - Start Ollama but have no models pulled
   - Open AccountWizard → see "No models installed in Ollama"

5. **LLM configured (happy path):**
   - Configure Ollama with a model OR set Anthropic key
   - Open AccountWizard → wizard shows normally
   - Add account → sync completes → "Classifying X/Y emails" shows in title bar
   - Progress updates → completes → indicator disappears → emails have tags

6. **Edit existing account:**
   - With LLM not configured
   - Click Edit on existing account → wizard shows (no LLM check for edits)
