/**
 * Compose Modal
 * 
 * New email, reply, reply-all, forward.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { IconClose, IconSend, IconAttachment, IconDelete, IconSpinnerBall } from 'obra-icons-react';
import { cn } from './ui/utils';
import type { Email, EmailBody } from '../../core/domain';
import { formatSender } from '../../core/domain';
import { useAccountStore } from '../stores';
import { debounce } from '../utils/debounce';

export type ComposeMode = 'new' | 'reply' | 'replyAll' | 'forward';

type Attachment = {
  id: string;
  name: string;
  size: number;
  contentType?: string;
  file?: File;        // Present for newly added attachments
  content?: string;   // Base64 content for persisted attachments
};

type Props = {
  mode: ComposeMode;
  originalEmail?: Email;
  originalBody?: EmailBody;
  draftId?: number;
  onClose: () => void;
  onSent: () => void;
};

export function ComposeModal({ mode, originalEmail, originalBody, draftId, onClose, onSent }: Props) {
  const { accounts } = useAccountStore();
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCc, setShowCc] = useState(false);
  const [currentDraftId, setCurrentDraftId] = useState<number | undefined>(draftId);
  const [loadingDraft, setLoadingDraft] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [isInitialized, setIsInitialized] = useState(false); // Track if form init is complete
  const [hasUserEdited, setHasUserEdited] = useState(false); // Track if user has made changes
  // Preserve inReplyTo and originalEmailId when editing existing drafts
  const [draftInReplyTo, setDraftInReplyTo] = useState<string | null>(null);
  const [draftOriginalEmailId, setDraftOriginalEmailId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Helper to emit drafts changed event
  const emitDraftsChanged = () => {
    window.dispatchEvent(new CustomEvent('drafts:changed'));
  };

  // Load draft if draftId is provided
  useEffect(() => {
    const loadDraft = async () => {
      if (!draftId) return;

      setLoadingDraft(true);
      setError(null);

      try {
        const draft = await window.mailApi.drafts.get(draftId);
        if (!draft) {
          setError('Draft not found');
          return;
        }

        setCurrentDraftId(draft.id);
        setTo(draft.to.join(', '));
        setCc(draft.cc.join(', '));
        setBcc(draft.bcc.join(', '));
        setSubject(draft.subject);
        setBody(draft.text || '');
        setShowCc(draft.cc.length > 0 || draft.bcc.length > 0);
        // Restore attachments from draft (they have base64 content, no File)
        setAttachments(draft.attachments.map(a => ({
          id: String(a.id),
          name: a.filename,
          size: a.size,
          contentType: a.contentType || undefined,
          content: a.content,
        })));
        // Preserve reply metadata from the draft
        setDraftInReplyTo(draft.inReplyTo);
        setDraftOriginalEmailId(draft.originalEmailId);
        setIsInitialized(true);
        setHasUserEdited(true); // Editing existing draft counts as user edit
      } catch (err) {
        setError(`Failed to load draft: ${err}`);
      } finally {
        setLoadingDraft(false);
      }
    };

    loadDraft();
  }, [draftId]);

  // Initialize form based on mode (skip if loading a draft)
  useEffect(() => {
    if (draftId) return;
    if (mode === 'new') {
      setTo('');
      setCc('');
      setBcc('');
      setSubject('');
      setBody('');
    } else if (originalEmail) {
      const replyPrefix = originalEmail.subject?.startsWith('Re:') ? '' : 'Re: ';
      const fwdPrefix = originalEmail.subject?.startsWith('Fwd:') ? '' : 'Fwd: ';

      if (mode === 'reply') {
        setTo(originalEmail.from.address);
        setSubject(`${replyPrefix}${originalEmail.subject || ''}`);
      } else if (mode === 'replyAll') {
        setTo(originalEmail.from.address);
        const others = originalEmail.to || [];
        setCc(others.join(', '));
        setShowCc(others.length > 0);
        setSubject(`${replyPrefix}${originalEmail.subject || ''}`);
      } else if (mode === 'forward') {
        setTo('');
        setSubject(`${fwdPrefix}${originalEmail.subject || ''}`);
      }

      // Quote original message
      const date = new Date(originalEmail.date).toLocaleString();
      const quote = `\n\n---\nOn ${date}, ${formatSender(originalEmail.from)} wrote:\n\n${originalBody?.text || ''}`;
      setBody(quote);
    }

    setAttachments([]);
    setError(null);
    setIsInitialized(true);
  }, [mode, originalEmail, originalBody, draftId]);

  // Convert attachments to format for saving
  const convertAttachmentsForSave = async () => {
    return Promise.all(attachments.map(async (a) => ({
      filename: a.name,
      contentType: a.contentType || a.file?.type,
      size: a.size,
      content: a.file ? await fileToBase64(a.file) : (a.content || ''),
    })));
  };

  // Auto-save draft
  const saveDraft = useCallback(async () => {
    // Don't save during form initialization or if user hasn't edited
    if (!isInitialized || !hasUserEdited) return;

    const account = accounts.find(a => a.isActive) || accounts[0];
    if (!account) return;

    // Don't create new empty drafts, but DO save updates to existing drafts (user may have cleared fields)
    if (!currentDraftId && !to && !cc && !bcc && !subject && !body && attachments.length === 0) return;

    setSaveStatus('saving');

    try {
      // Convert attachments to base64 format for persistence
      const attachmentData = await convertAttachmentsForSave();

      const draft = await window.mailApi.drafts.save({
        id: currentDraftId,
        accountId: account.id,
        // Always send arrays - empty array clears the field, undefined would preserve old value
        to: to.split(',').map(s => s.trim()).filter(Boolean),
        cc: cc.split(',').map(s => s.trim()).filter(Boolean),
        bcc: bcc.split(',').map(s => s.trim()).filter(Boolean),
        subject,
        text: body,
        // Use originalEmail if available (reply/forward), otherwise preserve from loaded draft
        inReplyTo: originalEmail?.messageId ?? draftInReplyTo ?? undefined,
        originalEmailId: originalEmail?.id ?? draftOriginalEmailId ?? undefined,
        attachments: attachmentData,
      });

      setCurrentDraftId(draft.id);
      setSaveStatus('saved');
      emitDraftsChanged();

      // Reset to idle after 2 seconds
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (err) {
      console.error('Failed to save draft:', err);
      setSaveStatus('idle');
    }
  }, [to, cc, bcc, subject, body, attachments, currentDraftId, accounts, originalEmail, isInitialized, hasUserEdited, draftInReplyTo, draftOriginalEmailId]);

  // Debounced auto-save (2 second delay)
  const debouncedSave = useRef(debounce(saveDraft, 2000));

  // Update debounced function when saveDraft changes
  useEffect(() => {
    // Cancel old debounced function before creating new one
    debouncedSave.current.cancel();
    debouncedSave.current = debounce(saveDraft, 2000);
  }, [saveDraft]);

  // Trigger auto-save when fields change (only if user has edited)
  useEffect(() => {
    if (hasUserEdited) {
      debouncedSave.current();
    }
  }, [to, cc, bcc, subject, body, attachments, hasUserEdited]);

  // Input change handlers that mark form as user-edited
  const handleToChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setHasUserEdited(true);
    setTo(e.target.value);
  };
  const handleCcChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setHasUserEdited(true);
    setCc(e.target.value);
  };
  const handleBccChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setHasUserEdited(true);
    setBcc(e.target.value);
  };
  const handleSubjectChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setHasUserEdited(true);
    setSubject(e.target.value);
  };
  const handleBodyChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setHasUserEdited(true);
    setBody(e.target.value);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      debouncedSave.current.cancel();
    };
  }, []);

  // Convert File to base64 for IPC transfer
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // Remove data URL prefix (e.g., "data:application/pdf;base64,")
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleSend = async () => {
    // Cancel any pending auto-save to prevent race conditions
    debouncedSave.current.cancel();

    if (!to.trim()) {
      setError('Please enter a recipient');
      return;
    }

    // Get the first active account (or just the first account)
    const account = accounts.find(a => a.isActive) || accounts[0];
    if (!account) {
      setError('No email account configured. Please add an account in Settings.');
      return;
    }

    setSending(true);
    setError(null);

    try {
      // Convert attachments to base64 (handle both new files and persisted attachments)
      const attachmentData = await Promise.all(
        attachments.map(async (a) => ({
          filename: a.name,
          content: a.file ? await fileToBase64(a.file) : (a.content || ''),
          contentType: a.contentType || a.file?.type || undefined,
        }))
      );

      await window.mailApi.send.email(account.id, {
        to: to.split(',').map(s => s.trim()).filter(Boolean),
        cc: cc ? cc.split(',').map(s => s.trim()).filter(Boolean) : undefined,
        bcc: bcc ? bcc.split(',').map(s => s.trim()).filter(Boolean) : undefined,
        subject,
        text: body,
        inReplyTo: originalEmail?.messageId,
        attachments: attachmentData.length > 0 ? attachmentData : undefined,
      });

      // Delete draft after successful send
      if (currentDraftId) {
        try {
          await window.mailApi.drafts.delete(currentDraftId);
          emitDraftsChanged();
        } catch (draftErr) {
          // Log but don't fail the send if draft deletion fails
          console.error('Failed to delete draft after send:', draftErr);
        }
      }

      onSent();
    } catch (err) {
      setError(String(err));
    } finally {
      setSending(false);
    }
  };

  const handleDiscard = async () => {
    // Confirm if user has made changes (even if not saved yet)
    if (hasUserEdited || currentDraftId) {
      const confirmed = window.confirm('Discard this draft? This cannot be undone.');
      if (!confirmed) return;

      // Delete saved draft if exists
      if (currentDraftId) {
        try {
          await window.mailApi.drafts.delete(currentDraftId);
          emitDraftsChanged();
        } catch (err) {
          console.error('Failed to delete draft:', err);
        }
      }
    }
    onClose();
  };

  // Close handler that saves pending changes first
  const handleClose = async () => {
    // Cancel any pending debounced save
    debouncedSave.current.cancel();
    // Save immediately if there are unsaved changes
    if (hasUserEdited) {
      await saveDraft();
    }
    onClose();
  };

  const handleAttach = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const newAttachments = files.map(file => ({
      id: Math.random().toString(36).slice(2),
      name: file.name,
      size: file.size,
      contentType: file.type || undefined,
      file,
    }));
    setHasUserEdited(true);
    setAttachments(prev => [...prev, ...newAttachments]);
    e.target.value = '';
  };

  const removeAttachment = (id: string) => {
    setHasUserEdited(true);
    setAttachments(prev => prev.filter(a => a.id !== id));
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const titles: Record<ComposeMode, string> = {
    new: draftId ? 'Edit Draft' : 'New Message',
    reply: 'Reply',
    replyAll: 'Reply All',
    forward: 'Forward',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50">
      <div
        className="rounded-t-xl sm:rounded-xl shadow-xl w-full max-w-2xl mx-0 sm:mx-4 max-h-[90vh] flex flex-col"
        style={{ background: 'var(--color-bg)' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3 border-b"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <div className="flex items-center gap-3">
            <h2 className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>
              {loadingDraft ? 'Loading draft...' : titles[mode]}
            </h2>
            {saveStatus === 'saving' && (
              <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Saving...</span>
            )}
            {saveStatus === 'saved' && (
              <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Saved</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSend}
              disabled={sending || !to.trim() || loadingDraft}
              className={cn(
                'flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium',
                'bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50'
              )}
            >
              {sending ? (
                <IconSpinnerBall className="w-4 h-4 animate-spin" />
              ) : (
                <IconSend className="w-4 h-4" />
              )}
              Send
            </button>
            <button
              onClick={handleClose}
              className="p-1.5 rounded hover:bg-[var(--color-bg-hover)]"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              <IconClose className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Form */}
        <div className="flex-1 overflow-y-auto">
          <div>
            {/* To */}
            <div
              className="flex items-center px-4 py-2 border-b"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <label className="w-16 text-sm" style={{ color: 'var(--color-text-tertiary)' }}>To</label>
              <input
                type="text"
                value={to}
                onChange={handleToChange}
                className="flex-1 outline-none text-sm bg-transparent"
                style={{ color: 'var(--color-text-primary)' }}
                placeholder="recipient@example.com"
              />
              {!showCc && (
                <button
                  onClick={() => setShowCc(true)}
                  className="text-xs hover:opacity-80"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  Cc/Bcc
                </button>
              )}
            </div>

            {/* Cc */}
            {showCc && (
              <div
                className="flex items-center px-4 py-2 border-b"
                style={{ borderColor: 'var(--color-border)' }}
              >
                <label className="w-16 text-sm" style={{ color: 'var(--color-text-tertiary)' }}>Cc</label>
                <input
                  type="text"
                  value={cc}
                  onChange={handleCcChange}
                  className="flex-1 outline-none text-sm bg-transparent"
                  style={{ color: 'var(--color-text-primary)' }}
                  placeholder="cc@example.com"
                />
              </div>
            )}

            {/* Bcc */}
            {showCc && (
              <div
                className="flex items-center px-4 py-2 border-b"
                style={{ borderColor: 'var(--color-border)' }}
              >
                <label className="w-16 text-sm" style={{ color: 'var(--color-text-tertiary)' }}>Bcc</label>
                <input
                  type="text"
                  value={bcc}
                  onChange={handleBccChange}
                  className="flex-1 outline-none text-sm bg-transparent"
                  style={{ color: 'var(--color-text-primary)' }}
                  placeholder="bcc@example.com"
                />
              </div>
            )}

            {/* Subject */}
            <div
              className="flex items-center px-4 py-2 border-b"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <label className="w-16 text-sm" style={{ color: 'var(--color-text-tertiary)' }}>Subject</label>
              <input
                type="text"
                value={subject}
                onChange={handleSubjectChange}
                className="flex-1 outline-none text-sm bg-transparent"
                style={{ color: 'var(--color-text-primary)' }}
                placeholder="Subject"
              />
            </div>
          </div>

          {/* Body */}
          <textarea
            value={body}
            onChange={handleBodyChange}
            className="w-full h-64 px-4 py-3 outline-none text-sm resize-none bg-transparent"
            style={{ color: 'var(--color-text-primary)' }}
            placeholder="Write your message..."
          />

          {/* Attachments */}
          {attachments.length > 0 && (
            <div
              className="px-4 py-3 border-t"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <div className="flex flex-wrap gap-2">
                {attachments.map(a => (
                  <div
                    key={a.id}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm"
                    style={{ background: 'var(--color-bg-tertiary)', color: 'var(--color-text-primary)' }}
                  >
                    <IconAttachment className="w-3 h-3" style={{ color: 'var(--color-text-muted)' }} />
                    <span className="max-w-32 truncate">{a.name}</span>
                    <span style={{ color: 'var(--color-text-muted)' }}>({formatSize(a.size)})</span>
                    <button
                      onClick={() => removeAttachment(a.id)}
                      className="p-0.5 rounded hover:bg-[var(--color-bg-hover)]"
                    >
                      <IconClose className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div
              className="px-4 py-2 text-sm"
              style={{ background: 'var(--color-danger-bg, rgba(239, 68, 68, 0.1))', color: 'var(--color-danger)' }}
            >
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center gap-2 px-4 py-3 border-t"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <button
            onClick={handleAttach}
            className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg hover:bg-[var(--color-bg-hover)]"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            <IconAttachment className="w-4 h-4" />
            Attach
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={handleFileSelect}
            className="hidden"
          />

          <div className="flex-1" />

          <button
            onClick={handleDiscard}
            className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg hover:bg-[var(--color-bg-hover)]"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            <IconDelete className="w-4 h-4" />
            Discard
          </button>
        </div>
      </div>
    </div>
  );
}
