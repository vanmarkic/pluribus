# Bundle Ollama Design

**Date:** 2025-12-16
**Issue:** #43
**Status:** Approved

## Summary

Auto-download Ollama binary and models on first run, with a setup wizard to guide users through local AI setup.

## Decisions

| Aspect | Decision |
|--------|----------|
| Distribution | Auto-download on first run |
| Setup | First-run wizard |
| Model choice | 3 curated options (Llama 3.2, Mistral 7B, Phi-3 Mini) |
| Storage | App userData folder (isolated) |
| Platform | macOS only (initial) |

## Architecture

### Storage Layout

```
~/Library/Application Support/Pluribus/
├── ollama/
│   ├── bin/
│   │   └── ollama              # Downloaded binary
│   └── models/                 # OLLAMA_MODELS env var points here
│       └── manifests/
│       └── blobs/
├── pluribus.sqlite
└── image-cache/
```

### Components

1. **OllamaManager** - handles binary download, lifecycle, model management
2. **SetupWizard** - first-run UI for Ollama + model setup
3. Modified `startOllama()` - uses downloaded binary instead of system `ollama`

## Ollama Binary Download

**Source:** GitHub releases
```
https://github.com/ollama/ollama/releases/latest/download/ollama-darwin
```

**Process:**
1. Check if binary exists at `userData/ollama/bin/ollama`
2. Fetch from GitHub releases with progress events
3. Make executable (`chmod +x`)
4. Verify with `ollama --version`

**Environment Variables (isolation):**
- `OLLAMA_HOST=127.0.0.1:11435` (avoid conflict with system Ollama)
- `OLLAMA_MODELS=userData/ollama/models`

## OllamaManager API

```typescript
// src/adapters/ollama-manager/index.ts
export type OllamaManager = {
  isInstalled: () => Promise<boolean>;
  downloadBinary: (onProgress: (percent: number) => void) => Promise<void>;

  isRunning: () => Promise<boolean>;
  start: () => Promise<void>;
  stop: () => Promise<void>;

  listLocalModels: () => Promise<string[]>;
  pullModel: (name: string, onProgress: (percent: number) => void) => Promise<void>;
  deleteModel: (name: string) => Promise<void>;
};
```

## First-Run Setup Wizard

### When to Show

On app launch, check `config.get('ollama.setupComplete')`. If false and no accounts exist, show wizard.

### Steps

**Step 1: Download Ollama Binary**
- Progress bar showing download (23 MB / 51 MB)
- "Skip for Now" option

**Step 2: Choose Model**
- Llama 3.2 (Recommended) - 4.7 GB - Best overall accuracy
- Mistral 7B - 4.1 GB - Excellent for French & European languages
- Phi-3 Mini - 2.2 GB - Smaller, faster, good for older machines

**Step 3: Download Model**
- Progress bar showing model download
- Cancel option

### Skip Behavior

- User can skip at any step
- App works normally, AI features show "Set up AI" prompt
- Resume setup from Settings → AI

## Integration

### IPC Handlers

```typescript
'ollama:isInstalled'     → ollamaManager.isInstalled()
'ollama:downloadBinary'  → ollamaManager.downloadBinary() + progress events
'ollama:pullModel'       → ollamaManager.pullModel() + progress events
'ollama:listLocalModels' → ollamaManager.listLocalModels()
'ollama:deleteModel'     → ollamaManager.deleteModel()
```

### Events

```typescript
'ollama:download-progress' → { phase: 'binary'|'model', percent, bytesDownloaded, totalBytes }
```

### Config Keys

```typescript
'ollama.setupComplete'   → boolean
'ollama.selectedModel'   → string (e.g., 'mistral:7b')
```

## Error Handling

### Download Failures
- Network error during binary download → Retry button, resume if possible
- Network error during model pull → Ollama's pull supports resume
- Disk full → Show clear message with required space

### Startup Failures
- Binary won't start → Check permissions, offer re-download
- Port 11435 in use → Try alternative port (11436, 11437)
- Model corrupted → Offer to re-download

### Lifecycle
- App quit → Stop Ollama process
- App crash → On next launch, detect and kill stale process

## Future Enhancements

Settings UI for:
- View installed models with sizes
- Delete unused models
- Download additional models
- Change active model
