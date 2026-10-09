/**
 * Needs your reply
 *
 * Important emails the user has read (or been sent) but not answered yet,
 * ranked by the backend. Layout mirrors the mail views: a list on the left and
 * the normal reader on the right.
 *
 * Per item: Done, Snooze 1 day, Not important (all optimistic, rolled back on
 * failure). Keyboard, with an item focused: e done, s snooze, x not important,
 * j/k or arrows move.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { IconCheck, IconClock3, IconClose, IconWarningTriangle } from 'obra-icons-react';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { EmailViewer } from './EmailViewer';
import { useAccountStore, useEmailUiStore } from '../stores';
import { SNOOZE_HOURS, useRepliesStore } from '../stores/repliesStore';
import type { ForgottenReply, ImportanceLevel } from '../../core/domain';

const IMPORTANCE_BADGES: Partial<
  Record<ImportanceLevel, { label: string; style: React.CSSProperties }>
> = {
  4: {
    label: 'Critical',
    style: { background: 'var(--color-error-bg)', color: 'var(--color-error-text)' },
  },
  // The amber "tag" tokens have light and dark variants, unlike a hard-coded hex.
  3: {
    label: 'Important',
    style: { background: 'var(--tag-marketing-bg)', color: 'var(--tag-marketing-text)' },
  },
};

const OPEN_SELECTOR = '[data-reply-open]';

type ReplyAction = (emailId: number) => Promise<boolean>;

export function NeedsReplyView() {
  const results = useRepliesStore((s) => s.results);
  const loaded = useRepliesStore((s) => s.loaded);
  const loadError = useRepliesStore((s) => s.error);
  const actionError = useRepliesStore((s) => s.actionError);
  const load = useRepliesStore((s) => s.load);
  const markDone = useRepliesStore((s) => s.done);
  const snooze = useRepliesStore((s) => s.snooze);
  const dismiss = useRepliesStore((s) => s.dismiss);
  const clearActionError = useRepliesStore((s) => s.clearActionError);

  const selectedId = useEmailUiStore((s) => s.selectedId);
  const selectEmail = useEmailUiStore((s) => s.selectEmail);
  const knownAccounts = useAccountStore((s) => s.accounts);

  const listRef = useRef<HTMLDivElement>(null);
  const focusAfterRemoval = useRef<string | null>(null);

  const [backfilling, setBackfilling] = useState(false);
  const [backfillNotice, setBackfillNotice] = useState<string | null>(null);
  const [backfillError, setBackfillError] = useState<string | null>(null);

  // Mounted == the view is active: always show fresh data.
  useEffect(() => {
    void load();
  }, [load]);

  // After a keyboard action removes the focused row, keep the keyboard flow going.
  useEffect(() => {
    const id = focusAfterRemoval.current;
    if (!id) return;
    focusAfterRemoval.current = null;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-email-id="${id}"] ${OPEN_SELECTOR}`)
      ?.focus();
  }, [results]);

  const groups = useMemo(() => results.filter((r) => r.items.length > 0), [results]);
  const multiAccount = results.length > 1;
  const total = groups.reduce((n, r) => n + r.items.length, 0);
  const unhealthy = results.filter((r) => r.sentHealth === 'no-sent-mail');

  const backfillAccountIds = useMemo(
    () =>
      results.length > 0
        ? results.map((r) => r.accountId)
        : knownAccounts.filter((a) => a.isActive).map((a) => a.id),
    [results, knownAccounts],
  );

  const run = (item: ForgottenReply, action: ReplyAction) => {
    const row = listRef.current?.querySelector(`[data-email-id="${item.emailId}"]`);
    if (row?.contains(document.activeElement)) {
      const neighbour = row.nextElementSibling ?? row.previousElementSibling;
      focusAfterRemoval.current = neighbour?.getAttribute('data-email-id') ?? null;
    }
    const wasOpen = selectedId === item.emailId;
    if (wasOpen) selectEmail(null);
    void action(item.emailId).then((ok) => {
      if (!ok && wasOpen) selectEmail(item.emailId);
    });
  };

  const moveFocus = (from: HTMLElement, delta: number) => {
    const buttons = Array.from(listRef.current?.querySelectorAll<HTMLElement>(OPEN_SELECTOR) ?? []);
    const current = from.querySelector<HTMLElement>(OPEN_SELECTOR);
    const index = current ? buttons.indexOf(current) : -1;
    buttons[index + delta]?.focus();
  };

  const handleRowKeyDown = (e: KeyboardEvent<HTMLLIElement>, item: ForgottenReply) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    switch (e.key) {
      case 'e':
        run(item, markDone);
        break;
      case 's':
        run(item, (id) => snooze(id, SNOOZE_HOURS));
        break;
      case 'x':
        run(item, dismiss);
        break;
      case 'j':
      case 'ArrowDown':
        moveFocus(e.currentTarget, 1);
        break;
      case 'k':
      case 'ArrowUp':
        moveFocus(e.currentTarget, -1);
        break;
      default:
        return;
    }
    // These keys also mean archive / star / next-email globally; not here.
    e.preventDefault();
    e.stopPropagation();
  };

  const handleBackfill = async () => {
    setBackfilling(true);
    setBackfillError(null);
    setBackfillNotice(null);
    try {
      let processed = 0;
      for (const accountId of backfillAccountIds) {
        const outcome = await window.mailApi.replies.backfill(accountId);
        processed += outcome.processed;
      }
      setBackfillNotice(
        processed === 0
          ? 'No new emails needed analysis.'
          : `Analyzed ${processed} recent email${processed === 1 ? '' : 's'}.`,
      );
      await load({ force: true });
    } catch (err) {
      console.error('Failed to analyze recent emails:', err);
      setBackfillError("Couldn't analyze recent emails. Please try again.");
    } finally {
      setBackfilling(false);
    }
  };

  let body: React.ReactNode;
  if (!loaded && !loadError) {
    body = (
      <div
        role="status"
        className="flex-1 flex flex-col items-center justify-center gap-3"
        style={{ color: 'var(--color-text-tertiary)' }}
      >
        <div
          className="w-8 h-8 rounded-full border-4 border-t-transparent animate-spin"
          style={{ borderColor: 'var(--color-accent)', borderTopColor: 'transparent' }}
        />
        <span className="text-sm">Loading your replies…</span>
      </div>
    );
  } else if (!loaded) {
    body = (
      <div
        role="alert"
        className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center"
      >
        <h2 className="text-lg font-medium" style={{ color: 'var(--color-text-primary)' }}>
          Couldn't load your replies
        </h2>
        <p className="text-sm max-w-md" style={{ color: 'var(--color-text-tertiary)' }}>
          {loadError}
        </p>
        <Button variant="outline" onClick={() => void load({ force: true })}>
          Try again
        </Button>
      </div>
    );
  } else if (total === 0) {
    body = (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 px-6 text-center">
        <IconCheck className="w-12 h-12 mb-2" style={{ color: 'var(--color-success)' }} />
        <h2 className="text-lg font-medium" style={{ color: 'var(--color-text-primary)' }}>
          {unhealthy.length > 0 ? 'Nothing to show yet' : "You're all caught up"}
        </h2>
        <p className="text-sm max-w-md" style={{ color: 'var(--color-text-tertiary)' }}>
          {unhealthy.length > 0
            ? 'Once your Sent folder is syncing, emails waiting for your reply will show up here.'
            : 'Nothing important is waiting for your reply.'}
        </p>
        {backfillAccountIds.length > 0 && (
          <Button
            variant="outline"
            className="mt-3"
            onClick={() => void handleBackfill()}
            disabled={backfilling}
          >
            {backfilling ? 'Analyzing…' : 'Analyze recent emails'}
          </Button>
        )}
      </div>
    );
  } else {
    body = (
      <div className="flex flex-1 min-h-0">
        <div
          ref={listRef}
          className="w-[400px] shrink-0 overflow-y-auto border-r"
          style={{ borderColor: 'var(--color-border)' }}
        >
          {groups.map((result) => (
            <section key={result.accountId}>
              {multiAccount && (
                <h2
                  className="sticky top-0 z-10 flex items-center justify-between px-4 py-2 text-xs font-semibold border-b"
                  style={{
                    background: 'var(--color-bg-secondary)',
                    borderColor: 'var(--color-border)',
                    color: 'var(--color-text-secondary)',
                  }}
                >
                  <span className="truncate">{result.accountEmail}</span>
                  <span className="ml-2 font-normal" style={{ color: 'var(--color-text-muted)' }}>
                    {result.items.length}
                  </span>
                </h2>
              )}
              <ul>
                {result.items.map((item) => (
                  <ReplyRow
                    key={item.emailId}
                    item={item}
                    selected={selectedId === item.emailId}
                    onOpen={() => selectEmail(item.emailId)}
                    onKeyDown={(e) => handleRowKeyDown(e, item)}
                    onDone={() => run(item, markDone)}
                    onSnooze={() => run(item, (id) => snooze(id, SNOOZE_HOURS))}
                    onDismiss={() => run(item, dismiss)}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
        <EmailViewer />
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-w-0 h-full" style={{ background: 'var(--color-bg)' }}>
      <header
        className="shrink-0 flex items-baseline justify-between gap-4 px-6 py-4 border-b"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <div className="min-w-0">
          <h1 className="text-lg font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            Needs your reply
          </h1>
          <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
            Emails you haven't answered yet
          </p>
        </div>
        {loaded && total > 0 && <span className="email-list-count shrink-0">{total} waiting</span>}
      </header>

      {unhealthy.length > 0 && (
        <div
          className="shrink-0 flex items-start gap-2 px-6 py-3 text-sm border-b"
          style={{
            background: 'var(--tag-marketing-bg)',
            color: 'var(--tag-marketing-text)',
            borderColor: 'var(--color-border)',
          }}
        >
          <IconWarningTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <p>
            We couldn't find any emails you sent recently, so we can't tell what you've answered.
            Check that your Sent folder is syncing.
            {multiAccount && ` (${unhealthy.map((r) => r.accountEmail).join(', ')})`}
          </p>
        </div>
      )}

      {actionError && (
        <Notice tone="error" role="alert" onAction={clearActionError}>
          {actionError} Nothing was changed.
        </Notice>
      )}
      {loaded && loadError && (
        <Notice
          tone="error"
          role="alert"
          actionLabel="Retry"
          onAction={() => void load({ force: true })}
        >
          Couldn't refresh the list. Showing the last version we had.
        </Notice>
      )}
      {backfillError && (
        <Notice tone="error" role="alert" onAction={() => setBackfillError(null)}>
          {backfillError}
        </Notice>
      )}
      {backfillNotice && (
        <Notice tone="info" role="status" onAction={() => setBackfillNotice(null)}>
          {backfillNotice}
        </Notice>
      )}

      {body}
    </div>
  );
}

type NoticeProps = {
  tone: 'error' | 'info';
  role: 'alert' | 'status';
  onAction: () => void;
  actionLabel?: string;
  children: React.ReactNode;
};

function Notice({ tone, role, onAction, actionLabel = 'Dismiss', children }: NoticeProps) {
  const style: React.CSSProperties =
    tone === 'error'
      ? { background: 'var(--color-error-bg)', color: 'var(--color-error-text)' }
      : { background: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' };
  return (
    <div
      role={role}
      className="shrink-0 flex items-center justify-between gap-3 px-6 py-2 text-sm border-b"
      style={{ ...style, borderColor: 'var(--color-border)' }}
    >
      <span>{children}</span>
      <button
        type="button"
        onClick={onAction}
        className="shrink-0 text-xs font-medium underline-offset-2 hover:underline"
      >
        {actionLabel}
      </button>
    </div>
  );
}

type ReplyRowProps = {
  item: ForgottenReply;
  selected: boolean;
  onOpen: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLLIElement>) => void;
  onDone: () => void;
  onSnooze: () => void;
  onDismiss: () => void;
};

function ReplyRow({
  item,
  selected,
  onOpen,
  onKeyDown,
  onDone,
  onSnooze,
  onDismiss,
}: ReplyRowProps) {
  const importance = IMPORTANCE_BADGES[item.importance];
  const sender = item.from.name || item.from.address;

  return (
    <li
      data-email-id={item.emailId}
      onKeyDown={onKeyDown}
      className={`border-b transition-colors ${
        selected ? 'bg-[var(--color-bg-selected)]' : 'hover:bg-[var(--color-bg-hover)]'
      }`}
      style={{ borderColor: 'var(--color-border-light)' }}
    >
      <button
        type="button"
        data-reply-open
        aria-current={selected ? 'true' : undefined}
        onClick={onOpen}
        className="block w-full text-left px-4 pt-3 pb-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--color-accent)]"
      >
        <span className="flex items-baseline justify-between gap-3">
          <span
            className="text-sm font-semibold truncate"
            style={{ color: 'var(--color-text-primary)' }}
            title={item.from.address}
          >
            {sender}
          </span>
          <span className="text-xs shrink-0" style={{ color: 'var(--color-text-muted)' }}>
            {formatDistanceToNow(new Date(item.date), { addSuffix: true })}
          </span>
        </span>
        <span className="block text-sm truncate" style={{ color: 'var(--color-text-secondary)' }}>
          {item.subject || '(no subject)'}
        </span>
        <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {importance && (
            <Badge className="text-[11px]" style={importance.style}>
              {importance.label}
            </Badge>
          )}
          {item.basis === 'heuristic' && (
            <Badge
              variant="outline"
              className="text-[11px]"
              title="Picked up by pattern matching, not analysed by the AI"
            >
              Heuristic
            </Badge>
          )}
          <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
            {item.reason}
          </span>
        </span>
      </button>
      <div className="flex items-center gap-1 px-3 pb-2 pt-1">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1 px-2 py-1"
          title="Done (E)"
          onClick={onDone}
        >
          <IconCheck className="w-3.5 h-3.5" />
          Done
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1 px-2 py-1"
          title="Remind me again tomorrow (S)"
          onClick={onSnooze}
        >
          <IconClock3 className="w-3.5 h-3.5" />
          Snooze 1 day
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1 px-2 py-1"
          title="Stop suggesting emails like this (X)"
          onClick={onDismiss}
        >
          <IconClose className="w-3.5 h-3.5" />
          Not important
        </Button>
      </div>
    </li>
  );
}
