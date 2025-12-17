import { useState, useEffect, useRef } from 'react';

/**
 * Classification Settings Component
 * Manages AI classification configuration
 */

const CONFIDENCE_OPTIONS = [
  { label: 'Low (50%)', value: 0.5 },
  { label: 'Medium (70%)', value: 0.7 },
  { label: 'High (85%)', value: 0.85 },
  { label: 'Very High (95%)', value: 0.95 },
];

const COOLDOWN_OPTIONS = [
  { label: '1 day', value: 1 },
  { label: '3 days', value: 3 },
  { label: '1 week', value: 7 },
  { label: '2 weeks', value: 14 },
  { label: 'Never (manual only)', value: -1 },
];

type Config = {
  provider: 'anthropic' | 'ollama';
  model: string;
  dailyBudget: number;
  dailyEmailLimit: number;
  autoClassify: boolean;
  confidenceThreshold?: number;
  reclassifyCooldownDays?: number;
  ollamaServerUrl?: string;
};

export function ClassificationSettings() {
  const [config, setConfig] = useState<Config | null>(null);
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

  // Track initial provider and model to detect changes requiring restart
  const [initialProvider, setInitialProvider] = useState<string | null>(null);
  const [initialModel, setInitialModel] = useState<string | null>(null);
  const [llmConfigChanged, setLlmConfigChanged] = useState(false);

  // Cache models per provider to avoid refetching on every settings load
  const modelCache = useRef<Record<string, { id: string; displayName: string }[]>>({});

  // Load config on mount
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const [llmConfig, apiKeyStatus, budget] = await Promise.all([
          window.mailApi.config.get('llm'),
          window.mailApi.credentials.hasApiKey('anthropic'),
          window.mailApi.llm.getEmailBudget()
        ]);
        setConfig(llmConfig as Config);
        setHasApiKey(apiKeyStatus);
        setEmailBudget(budget);
        // Capture initial provider and model on first load
        if (initialProvider === null && llmConfig) {
          const cfg = llmConfig as Config;
          setInitialProvider(cfg?.provider ?? null);
          setInitialModel(cfg?.model ?? null);
        }
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

      // Check cache first
      const cacheKey = config.provider;
      if (modelCache.current[cacheKey]?.length > 0) {
        setModels(modelCache.current[cacheKey]);
        return;
      }

      setLoadingModels(true);
      try {
        const modelList = await window.mailApi.llm.listModels();
        // Store in cache
        modelCache.current[cacheKey] = modelList;
        setModels(modelList);

        // Auto-select first model if current model is empty or not in list
        if (modelList.length > 0) {
          const currentModelValid = modelList.some(m => m.id === config.model);
          if (!currentModelValid) {
            updateConfig({ model: modelList[0].id });
          }
        }
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
  const updateConfig = async (updates: Partial<Config>) => {
    if (!config) return;
    const newConfig = { ...config, ...updates };
    try {
      await window.mailApi.config.set('llm', newConfig);
      setConfig(newConfig);
      // Check if provider or model changed from initial
      const providerChanged = updates.provider && updates.provider !== initialProvider;
      const modelChanged = updates.model && updates.model !== initialModel;
      if (providerChanged || modelChanged) {
        setLlmConfigChanged(true);
      }
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
        // Clear cache and reload models after key is saved
        delete modelCache.current['anthropic'];
        const modelList = await window.mailApi.llm.listModels();
        modelCache.current['anthropic'] = modelList;
        setModels(modelList);

        // Auto-select first model if current model is empty or not in list
        if (modelList.length > 0 && config) {
          const currentModelValid = modelList.some(m => m.id === config.model);
          if (!currentModelValid) {
            updateConfig({ model: modelList[0].id });
          }
        }
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
        // Clear cache and reload models
        delete modelCache.current['ollama'];
        const modelList = await window.mailApi.llm.listModels();
        modelCache.current['ollama'] = modelList;
        setModels(modelList);

        // Auto-select first model if current model is empty or not in list
        if (modelList.length > 0 && config) {
          const currentModelValid = modelList.some(m => m.id === config.model);
          if (!currentModelValid) {
            updateConfig({ model: modelList[0].id });
          }
        }
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
      <div>
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
        {llmConfigChanged && (
          <div
            className="mt-2 p-2 rounded text-sm"
            style={{
              background: '#fef3c7',
              color: '#92400e',
              border: '1px solid #fde68a'
            }}
          >
            Restart the app for provider/model change to take effect
          </div>
        )}
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
                  autoComplete="new-password"
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
            <div className="mt-2">
              <div className="flex items-center gap-2">
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ background: ollamaStatus.connected ? 'var(--color-success)' : 'var(--color-danger)' }}
                />
                <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                  {ollamaStatus.connected ? 'Connected' : ollamaStatus.error || 'Not connected'}
                </span>
              </div>
              {!ollamaStatus.connected && (
                <button
                  onClick={async () => {
                    setTestingConnection(true);
                    const result = await window.mailApi.llm.startOllama();
                    if (result.started) {
                      // Refresh connection status and models
                      const status = await window.mailApi.llm.testConnection();
                      setOllamaStatus(status);
                      if (status.connected) {
                        delete modelCache.current['ollama'];
                        const modelList = await window.mailApi.llm.listModels();
                        setModels(modelList);
                      }
                    } else {
                      setOllamaStatus({ connected: false, error: result.error });
                    }
                    setTestingConnection(false);
                  }}
                  disabled={testingConnection}
                  className="btn mt-2"
                  style={{ background: '#2563eb', color: 'white', border: 'none' }}
                >
                  {testingConnection ? 'Starting...' : 'Start Ollama'}
                </button>
              )}
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
