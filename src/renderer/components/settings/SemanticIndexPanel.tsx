import { useEffect, useState } from 'react';
import { DEFAULT_SYSTEM1_SETTINGS } from '../../../core/domain';
import type { System1Settings } from '../../../core/domain';
import type { System1HeadStatus, System1Status } from '../../../core/system1/types';

type Stats = {
  totalEmails: number;
  indexed: number;
  coverage: number;
  model: string;
};

/**
 * Semantic index (#88) plus the on-device System 1 model, which is built on
 * the same local embeddings.
 */
export function SemanticIndexPanel() {
  // Building the index needs the on-device model, which the System 1 block below
  // installs. It reports whether the model is there (null while that is unknown).
  const [modelInstalled, setModelInstalled] = useState<boolean | null>(null);
  return (
    <div className="space-y-6">
      <SemanticIndexStats modelInstalled={modelInstalled} />
      <System1Block onModelInstalledChange={setModelInstalled} />
    </div>
  );
}

/**
 * Semantic-index management panel (#88). Shows how much of the user's
 * mailbox has been embedded into the RAG corpus, and offers a backfill
 * button for existing inboxes.
 */
const NEEDS_MODEL_FIRST =
  'Rebuilding the index needs the on-device model first. Download it (or import it) in the System 1 section below.';

function SemanticIndexStats({ modelInstalled }: { modelInstalled: boolean | null }) {
  const needsModel = modelInstalled === false;
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillInfo, setBackfillInfo] = useState<string | null>(null);

  const load = async () => {
    try {
      const s = await window.mailApi.embeddings.getStats();
      setStats(s);
    } catch (err) {
      console.error('Failed to load embedding stats:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 15_000);
    return () => clearInterval(interval);
  }, []);

  const handleBackfill = async () => {
    setBackfilling(true);
    setBackfillInfo(null);
    try {
      const { total, status } = await window.mailApi.embeddings.backfill({ limit: 5000 });
      if (status === 'model-not-installed') {
        setBackfillInfo(NEEDS_MODEL_FIRST);
        return;
      }
      setBackfillInfo(
        total === 0
          ? 'Nothing to index — every email already has an embedding.'
          : `Indexing ${total} email${total === 1 ? '' : 's'} in the background…`
      );
      // Refresh stats in a moment; the background task will update coverage.
      setTimeout(load, 2000);
    } catch (err) {
      setBackfillInfo(err instanceof Error ? err.message : String(err));
    } finally {
      setBackfilling(false);
    }
  };

  if (loading) {
    return (
      <div className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
        Loading semantic-index stats…
      </div>
    );
  }

  if (!stats) return null;

  const pct = (stats.coverage * 100).toFixed(1);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide" style={{ color: 'var(--color-text-tertiary)' }}>
            Coverage
          </div>
          <div className="text-lg font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            {stats.indexed.toLocaleString()} / {stats.totalEmails.toLocaleString()} emails
            <span className="text-sm ml-2" style={{ color: 'var(--color-text-tertiary)' }}>
              ({pct}%)
            </span>
          </div>
          <div className="text-xs mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>
            model: {stats.model}
          </div>
        </div>
        <button
          type="button"
          onClick={handleBackfill}
          disabled={backfilling || needsModel}
          className="px-3 py-1.5 rounded-md text-sm border"
          style={{
            background: 'var(--color-bg)',
            borderColor: 'var(--color-border)',
            color: 'var(--color-text-primary)',
            opacity: backfilling || needsModel ? 0.5 : 1,
            cursor: needsModel ? 'not-allowed' : backfilling ? 'wait' : 'pointer',
          }}
        >
          {backfilling ? 'Starting…' : 'Rebuild index'}
        </button>
      </div>

      <div
        className="h-1.5 rounded-full overflow-hidden"
        style={{ background: 'var(--color-bg-tertiary)' }}
      >
        <div
          style={{
            width: `${Math.min(100, stats.coverage * 100)}%`,
            height: '100%',
            background: 'var(--color-primary, #3b82f6)',
            transition: 'width 200ms ease-out',
          }}
        />
      </div>

      {needsModel && (
        <div
          data-testid="rebuild-needs-model"
          className="text-xs"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          {NEEDS_MODEL_FIRST}
        </div>
      )}

      {backfillInfo && (
        <div className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
          {backfillInfo}
        </div>
      )}

      <div className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
        The semantic index powers "find similar emails" retrieval and the
        agent-loop tools. New emails are indexed automatically after
        classification.
      </div>
    </div>
  );
}

// ============================================
// System 1 (on-device model)
// ============================================

const QUESTION_LABELS: Record<string, string> = {
  folder: 'Folder',
  needsReply: 'Needs reply',
  importance: 'Importance',
};

const percent = (value: number | null): string =>
  value === null ? '–' : `${Math.round(value * 100)}%`;

const bound = (value: number | null): string =>
  value === null ? '–' : `≤ ${(value * 100).toFixed(1)}%`;

const formatDate = (value: Date | string | null): string =>
  value === null
    ? 'Not trained yet'
    : new Date(value).toLocaleDateString(undefined, { dateStyle: 'medium' });

const formatMegabytes = (bytes: number): string =>
  `${Math.max(1, Math.round(bytes / (1024 * 1024)))} MB`;

const errorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message ? error.message : fallback;

const buttonStyle = (disabled: boolean): React.CSSProperties => ({
  background: 'var(--color-bg)',
  borderColor: 'var(--color-border)',
  color: 'var(--color-text-primary)',
  opacity: disabled ? 0.5 : 1,
  cursor: disabled ? 'wait' : 'pointer',
});

function ModeBadge({ armed }: { armed: boolean }) {
  return (
    <span
      className="inline-block px-2 py-0.5 rounded text-xs font-medium"
      style={{
        background: armed ? 'var(--color-primary, #3b82f6)' : 'var(--color-bg-tertiary)',
        color: armed ? '#fff' : 'var(--color-text-secondary)',
      }}
    >
      {armed ? 'Armed' : 'Shadow'}
    </span>
  );
}

function HeadRow({ head }: { head: System1HeadStatus }) {
  const trained = head.version !== null;
  return (
    <tr>
      <th scope="row" className="text-left font-medium py-1 pr-3">
        {QUESTION_LABELS[head.questionId] ?? head.questionId}
      </th>
      <td className="py-1 pr-3">
        <ModeBadge armed={head.armed} />
      </td>
      <td className="py-1 pr-3">{trained ? percent(head.coverage) : '–'}</td>
      <td className="py-1 pr-3">{trained ? percent(head.agreement) : '–'}</td>
      <td className="py-1 pr-3">{trained ? bound(head.disagreementUpperBound) : '–'}</td>
      <td className="py-1 pr-3">{head.trainSize}</td>
      <td className="py-1">{formatDate(head.trainedAt)}</td>
    </tr>
  );
}

/**
 * Is the on-device model on this disk? It is never downloaded on its own: huggingface.co
 * would see the user's IP address, so the download needs a click (or an import).
 */
function ModelState({
  installed,
  downloading,
  error,
  onDownload,
}: {
  installed: boolean;
  downloading: boolean;
  error: string | null;
  onDownload: () => void;
}) {
  if (installed) {
    return (
      <div
        data-testid="system1-model-state"
        className="text-sm"
        style={{ color: 'var(--color-text-secondary)' }}
      >
        Model installed
      </div>
    );
  }

  return (
    <div
      data-testid="system1-model-state"
      className="rounded-md border p-3 space-y-2"
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg-secondary)' }}
    >
      <div className="font-medium">On-device model not installed</div>
      <div className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
        {downloading
          ? 'Downloading the on-device model (about 118 MB) from huggingface.co. This can take a few minutes; you can leave this page, the download keeps going.'
          : 'The on-device model (about 118 MB) is not installed. Downloading it connects to huggingface.co; your IP address is visible to that site, no mail or mail data is sent. Until it is installed, System 1 is off and the LLM classifies every email. You can also install it without any network with "Import model from folder…" below.'}
      </div>
      {error && !downloading && (
        <div role="alert" className="text-sm" style={{ color: 'var(--color-danger)' }}>
          Couldn't download the model: {error}
        </div>
      )}
      <div>
        <button
          type="button"
          onClick={onDownload}
          disabled={downloading}
          aria-busy={downloading}
          className="px-3 py-1.5 rounded-md text-sm border"
          style={buttonStyle(downloading)}
        >
          {downloading ? 'Downloading…' : error ? 'Retry download' : 'Download model'}
        </button>
      </div>
    </div>
  );
}

/**
 * System 1: a small model that runs on this device and answers the easy
 * emails itself (folder, needs a reply, importance). It starts in shadow mode
 * and is armed per question only when its measured disagreement with the LLM
 * is low enough. The enabled flag is the `system1` config section.
 */
function System1Block({
  onModelInstalledChange,
}: {
  onModelInstalledChange: (installed: boolean | null) => void;
}) {
  const [settings, setSettings] = useState<System1Settings>({ ...DEFAULT_SYSTEM1_SETTINGS });
  const [status, setStatus] = useState<System1Status | null>(null);
  const [statusFailed, setStatusFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [retraining, setRetraining] = useState(false);
  const [importing, setImporting] = useState(false);
  // The user's "Download model" request is pending (the call returns when it is done).
  const [downloadRequested, setDownloadRequested] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const loadAll = async () => {
      const [stored, current] = await Promise.allSettled([
        window.mailApi.config.get('system1') as Promise<Partial<System1Settings> | null>,
        window.mailApi.system1.getStatus(),
      ]);
      if (!alive) return;
      if (stored.status === 'fulfilled') {
        setSettings({ ...DEFAULT_SYSTEM1_SETTINGS, ...(stored.value ?? {}) });
      }
      if (current.status === 'fulfilled') {
        setStatus(current.value);
      } else {
        console.error('Failed to load System 1 status:', current.reason);
        setStatusFailed(true);
      }
    };
    void loadAll();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    onModelInstalledChange(status ? status.modelInstalled : null);
  }, [status, onModelInstalledChange]);

  // A download takes minutes and also runs when Settings was closed and reopened:
  // follow it by asking for the status every second until it is over.
  const downloading = downloadRequested || status?.modelDownloading === true;
  useEffect(() => {
    if (!downloading) return;
    let alive = true;
    const timer = setInterval(() => {
      window.mailApi.system1.getStatus().then(
        (next) => {
          if (alive) setStatus(next);
        },
        () => {
          // Transient: the next tick asks again.
        },
      );
    }, 1000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [downloading]);

  const handleToggle = async (enabled: boolean) => {
    const previous = settings;
    setSettings({ ...settings, enabled });
    setError(null);
    try {
      await window.mailApi.config.set('system1', { enabled });
    } catch (err) {
      console.error('Failed to save System 1 settings:', err);
      setSettings(previous);
      setError("Couldn't save the System 1 setting. Your previous setting is still in place.");
    }
  };

  const handleRetrain = async () => {
    setRetraining(true);
    setError(null);
    setInfo(null);
    try {
      setStatus(await window.mailApi.system1.retrain());
      setStatusFailed(false);
    } catch (err) {
      console.error('System 1 retrain failed:', err);
      setError(errorMessage(err, "Couldn't retrain the on-device model."));
    } finally {
      setRetraining(false);
    }
  };

  // Only ever started by a click on "Download model" / "Retry download": nothing here
  // fetches the model on its own.
  const handleDownload = async () => {
    if (downloading) return;
    setDownloadRequested(true);
    setDownloadError(null);
    setError(null);
    setInfo(null);
    try {
      setStatus(await window.mailApi.system1.downloadModel());
      setStatusFailed(false);
    } catch (err) {
      console.error('System 1 model download failed:', err);
      setDownloadError(errorMessage(err, "Couldn't download the model."));
      try {
        setStatus(await window.mailApi.system1.getStatus());
      } catch {
        // Keep what is shown; the error above says what happened.
      }
    } finally {
      setDownloadRequested(false);
    }
  };

  const handleImport = async () => {
    setImporting(true);
    setError(null);
    setInfo(null);
    try {
      const result = await window.mailApi.system1.importModel();
      if (result.status === 'imported') {
        setInfo(
          `Installed ${result.model} (${formatMegabytes(result.bytes)}). It now runs fully offline.`,
        );
        setDownloadError(null);
        try {
          setStatus(await window.mailApi.system1.getStatus());
        } catch {
          // The info line above already says it worked.
        }
      }
    } catch (err) {
      console.error('System 1 model import failed:', err);
      setError(errorMessage(err, "Couldn't import the model."));
    } finally {
      setImporting(false);
    }
  };

  const modelId = status?.embeddingModel || settings.embeddingModel;
  const modelError = downloadError ?? status?.modelError ?? null;

  return (
    <div className="space-y-3" style={{ color: 'var(--color-text-primary)' }}>
      <div className="pt-4 border-t" style={{ borderColor: 'var(--color-border)' }}>
        <div className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
          System 1 (on-device model)
        </div>
        <div className="text-xs mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>
          Runs entirely on this device. Your mail is never sent anywhere to train or run it.
        </div>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <label htmlFor="system1-enabled" className="block font-medium">
            Use the on-device model
          </label>
          <div id="system1-enabled-help" className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
            Learns from your mail and answers the easy emails itself; the LLM handles the rest
          </div>
        </div>
        <input
          id="system1-enabled"
          type="checkbox"
          checked={settings.enabled}
          aria-describedby="system1-enabled-help"
          onChange={(e) => void handleToggle(e.target.checked)}
          className="h-5 w-5 shrink-0"
        />
      </div>

      {status && (
        <ModelState
          installed={status.modelInstalled}
          downloading={downloading}
          error={modelError}
          onDownload={() => void handleDownload()}
        />
      )}

      {status ? (
        <table
          aria-label="System 1 questions"
          className="w-full text-sm"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          <thead>
            <tr
              className="text-left text-xs uppercase tracking-wide"
              style={{ color: 'var(--color-text-tertiary)' }}
            >
              <th scope="col" className="font-normal pr-3">Question</th>
              <th scope="col" className="font-normal pr-3">Mode</th>
              <th scope="col" className="font-normal pr-3">Coverage</th>
              <th scope="col" className="font-normal pr-3">Agreement</th>
              <th scope="col" className="font-normal pr-3">Bound</th>
              <th scope="col" className="font-normal pr-3">Train size</th>
              <th scope="col" className="font-normal">Trained</th>
            </tr>
          </thead>
          <tbody>
            {status.heads.map((head) => (
              <HeadRow key={head.questionId} head={head} />
            ))}
          </tbody>
        </table>
      ) : statusFailed ? (
        <div role="alert" className="text-sm" style={{ color: 'var(--color-danger)' }}>
          Couldn't load the System 1 status.
        </div>
      ) : (
        <div className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
          Loading the System 1 status…
        </div>
      )}

      <div className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
        Armed answers on its own when it is confident. Shadow keeps learning while the LLM still
        answers. Coverage is the share of emails it would answer, agreement how often it matched
        the LLM and you on held-out mail, and the bound the worst disagreement rate among its
        answers (95% confidence).
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void handleRetrain()}
          disabled={retraining}
          className="px-3 py-1.5 rounded-md text-sm border"
          style={buttonStyle(retraining)}
        >
          {retraining ? 'Training…' : 'Retrain now'}
        </button>
        <button
          type="button"
          onClick={() => void handleImport()}
          disabled={importing}
          className="px-3 py-1.5 rounded-md text-sm border"
          style={buttonStyle(importing)}
        >
          {importing ? 'Importing…' : 'Import model from folder…'}
        </button>
        <span data-testid="system1-model" className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
          {modelId}
        </span>
      </div>

      <div className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
        The model is loaded when the app starts: if you change it, restart the app for the change
        to take effect.
      </div>

      {error && (
        <div role="alert" className="text-sm" style={{ color: 'var(--color-danger)' }}>
          {error}
        </div>
      )}
      {info && (
        <div className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          {info}
        </div>
      )}
    </div>
  );
}
