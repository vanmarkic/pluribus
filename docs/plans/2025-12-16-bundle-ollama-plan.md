# Bundle Ollama Implementation Plan

**Design:** [2025-12-16-bundle-ollama-design.md](./2025-12-16-bundle-ollama-design.md)
**Issue:** #43

## Phase 1: OllamaManager Adapter

### Task 1.1: Create OllamaManager adapter skeleton
**File:** `src/adapters/ollama-manager/index.ts`

Create the adapter with port type and factory function:
```typescript
import { app } from 'electron';
import path from 'path';
import fs from 'fs/promises';

export type DownloadProgress = {
  phase: 'binary' | 'model';
  percent: number;
  bytesDownloaded: number;
  totalBytes: number;
};

export type OllamaManager = {
  getOllamaPath: () => string;
  getModelsPath: () => string;
  isInstalled: () => Promise<boolean>;
  downloadBinary: (onProgress: (progress: DownloadProgress) => void) => Promise<void>;
  isRunning: () => Promise<boolean>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  listLocalModels: () => Promise<string[]>;
  pullModel: (name: string, onProgress: (progress: DownloadProgress) => void) => Promise<void>;
  deleteModel: (name: string) => Promise<void>;
};

export function createOllamaManager(): OllamaManager {
  const basePath = path.join(app.getPath('userData'), 'ollama');
  const binPath = path.join(basePath, 'bin', 'ollama');
  const modelsPath = path.join(basePath, 'models');
  const serverUrl = 'http://127.0.0.1:11435';

  // Implementation...
}
```

### Task 1.2: Implement binary download
**File:** `src/adapters/ollama-manager/index.ts`

Implement `isInstalled()` and `downloadBinary()`:
- Check if file exists and is executable
- Download from `https://github.com/ollama/ollama/releases/latest/download/ollama-darwin`
- Stream download with progress callback
- Set executable permissions

### Task 1.3: Implement lifecycle management
**File:** `src/adapters/ollama-manager/index.ts`

Implement `isRunning()`, `start()`, `stop()`:
- `isRunning()`: Check if port 11435 responds
- `start()`: Spawn process with env vars `OLLAMA_HOST` and `OLLAMA_MODELS`
- `stop()`: Kill spawned process gracefully

### Task 1.4: Implement model management
**File:** `src/adapters/ollama-manager/index.ts`

Implement `listLocalModels()`, `pullModel()`, `deleteModel()`:
- Use Ollama API endpoints (`/api/tags`, `/api/pull`, `/api/delete`)
- Parse pull progress from streaming response

### Task 1.5: Write tests for OllamaManager
**File:** `src/adapters/ollama-manager/index.test.ts`

Test:
- Path generation
- isInstalled returns false when binary missing
- Download progress events fire correctly (mock fetch)
- Model list parsing

---

## Phase 2: Wire into Main Process

### Task 2.1: Add OllamaManager to container
**File:** `src/main/container.ts`

- Import and create OllamaManager instance
- Export from container

### Task 2.2: Add IPC handlers
**File:** `src/main/ipc.ts`

Add handlers:
```typescript
ipcMain.handle('ollama:isInstalled', () => ollamaManager.isInstalled());
ipcMain.handle('ollama:downloadBinary', async (event) => {
  await ollamaManager.downloadBinary((progress) => {
    event.sender.send('ollama:download-progress', progress);
  });
});
ipcMain.handle('ollama:pullModel', async (event, name) => {
  await ollamaManager.pullModel(name, (progress) => {
    event.sender.send('ollama:download-progress', progress);
  });
});
ipcMain.handle('ollama:listLocalModels', () => ollamaManager.listLocalModels());
ipcMain.handle('ollama:deleteModel', (_, name) => ollamaManager.deleteModel(name));
```

### Task 2.3: Add to preload
**File:** `src/main/preload.ts`

Add to API:
```typescript
ollama: {
  isInstalled: () => ipcRenderer.invoke('ollama:isInstalled'),
  downloadBinary: () => ipcRenderer.invoke('ollama:downloadBinary'),
  pullModel: (name: string) => ipcRenderer.invoke('ollama:pullModel', name),
  listLocalModels: () => ipcRenderer.invoke('ollama:listLocalModels'),
  deleteModel: (name: string) => ipcRenderer.invoke('ollama:deleteModel', name),
}
```

Add event listener for `ollama:download-progress`.

### Task 2.4: Update existing Ollama integration
**File:** `src/adapters/llm/ollama.ts`

- Modify `startOllama()` to use OllamaManager's binary path
- Update server URL to `http://127.0.0.1:11435`
- Pass OllamaManager as dependency

---

## Phase 3: Setup Wizard UI

### Task 3.1: Create SetupWizard component
**File:** `src/renderer/components/SetupWizard.tsx`

Component with steps:
- Step 1: Welcome + binary download
- Step 2: Model selection (3 options)
- Step 3: Model download progress
- Step 4: Complete

Props: `onComplete: () => void`, `onSkip: () => void`

### Task 3.2: Add wizard state to UI store
**File:** `src/renderer/stores/index.ts`

Add:
```typescript
showSetupWizard: boolean;
setShowSetupWizard: (show: boolean) => void;
```

### Task 3.3: Wire wizard into App.tsx
**File:** `src/renderer/App.tsx`

- On mount, check `ollama.setupComplete` config
- If false and no accounts, show SetupWizard
- On complete/skip, set `ollama.setupComplete = true`

### Task 3.4: Add download progress hook
**File:** `src/renderer/hooks/useOllamaDownload.ts`

Hook that:
- Listens to `ollama:download-progress` events
- Returns `{ phase, percent, bytesDownloaded, totalBytes, isDownloading }`

---

## Phase 4: Config & Polish

### Task 4.1: Add config keys
**File:** `src/main/ipc.ts` (config handlers already exist)

Default values:
- `ollama.setupComplete`: `false`
- `ollama.selectedModel`: `'mistral:7b'`

### Task 4.2: Update mockApi for browser testing
**File:** `src/renderer/mockApi.ts`

Add mock `ollama` namespace with stub implementations.

### Task 4.3: Add Settings UI for model management
**File:** `src/renderer/components/SecuritySettings.tsx` (or new AISettings component)

- Show installed models with "Delete" button
- "Download Additional Model" dropdown
- Change active model

---

## Verification Checklist

- [ ] Binary downloads successfully on fresh install
- [ ] Model downloads with progress indicator
- [ ] Ollama starts on isolated port (11435)
- [ ] Classification works with downloaded model
- [ ] Skip wizard → AI features show setup prompt
- [ ] All 246+ tests pass
- [ ] TypeScript compiles cleanly
