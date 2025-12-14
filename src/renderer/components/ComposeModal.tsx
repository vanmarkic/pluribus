/**
 * Compose Modal
 * 
 * New email, reply, reply-all, forward.
 */

import { useState, useEffect, useRef } from 'react';
import { IconClose, IconSend, IconAttachment, IconDelete, IconSpinnerBall } from 'obra-icons-react';
import { cn } from './ui/utils';
import type { Email, EmailBody } from '../../core/domain';
import { formatSender } from '../../core/domain';
import { useAccountStore } from '../stores';

export type ComposeMode = 'new' | 'reply' | 'replyAll' | 'forward';

type Attachment = {
  id: string;
  name: string;
  size: number;
  file: File;
};

type Props = {
  mode: ComposeMode;
  originalEmail?: Email;
  originalBody?: EmailBody;
  onClose: () => void;
  onSent: () => void;
};

export function ComposeModal({ mode, originalEmail, originalBody, onClose, onSent }: Props) {
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initialize form based on mode
  useEffect(() => {
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
  }, [mode, originalEmail, originalBody]);

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
      // Convert attachments to base64
      const attachmentData = await Promise.all(
        attachments.map(async (a) => ({
          filename: a.name,
          content: await fileToBase64(a.file),
          contentType: a.file.type || undefined,
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

      onSent();
    } catch (err) {
      setError(String(err));
    } finally {
      setSending(false);
    }
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
      file,
    }));
    setAttachments(prev => [...prev, ...newAttachments]);
    e.target.value = '';
  };

  const removeAttachment = (id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const titles: Record<ComposeMode, string> = {
    new: 'New Message',
    reply: 'Reply',
    replyAll: 'Reply All',
    forward: 'Forward',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50">
      <div className="bg-white rounded-t-xl sm:rounded-xl shadow-xl w-full max-w-2xl mx-0 sm:mx-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200">
          <h2 className="font-semibold">{titles[mode]}</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSend}
              disabled={sending || !to.trim()}
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
            <button onClick={onClose} className="p-1.5 hover:bg-zinc-100 rounded">
              <IconClose className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Form */}
        <div className="flex-1 overflow-y-auto">
          <div className="divide-y divide-zinc-100">
            {/* To */}
            <div className="flex items-center px-4 py-2">
              <label className="w-16 text-sm text-zinc-500">To</label>
              <input
                type="text"
                value={to}
                onChange={e => setTo(e.target.value)}
                className="flex-1 outline-none text-sm"
                placeholder="recipient@example.com"
              />
              {!showCc && (
                <button
                  onClick={() => setShowCc(true)}
                  className="text-xs text-zinc-400 hover:text-zinc-600"
                >
                  Cc/Bcc
                </button>
              )}
            </div>

            {/* Cc */}
            {showCc && (
              <div className="flex items-center px-4 py-2">
                <label className="w-16 text-sm text-zinc-500">Cc</label>
                <input
                  type="text"
                  value={cc}
                  onChange={e => setCc(e.target.value)}
                  className="flex-1 outline-none text-sm"
                  placeholder="cc@example.com"
                />
              </div>
            )}

            {/* Bcc */}
            {showCc && (
              <div className="flex items-center px-4 py-2">
                <label className="w-16 text-sm text-zinc-500">Bcc</label>
                <input
                  type="text"
                  value={bcc}
                  onChange={e => setBcc(e.target.value)}
                  className="flex-1 outline-none text-sm"
                  placeholder="bcc@example.com"
                />
              </div>
            )}

            {/* Subject */}
            <div className="flex items-center px-4 py-2">
              <label className="w-16 text-sm text-zinc-500">Subject</label>
              <input
                type="text"
                value={subject}
                onChange={e => setSubject(e.target.value)}
                className="flex-1 outline-none text-sm"
                placeholder="Subject"
              />
            </div>
          </div>

          {/* Body */}
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            className="w-full h-64 px-4 py-3 outline-none text-sm resize-none"
            placeholder="Write your message..."
          />

          {/* Attachments */}
          {attachments.length > 0 && (
            <div className="px-4 py-3 border-t border-zinc-100">
              <div className="flex flex-wrap gap-2">
                {attachments.map(a => (
                  <div
                    key={a.id}
                    className="flex items-center gap-2 px-3 py-1.5 bg-zinc-100 rounded-lg text-sm"
                  >
                    <IconAttachment className="w-3 h-3 text-zinc-400" />
                    <span className="max-w-32 truncate">{a.name}</span>
                    <span className="text-zinc-400">({formatSize(a.size)})</span>
                    <button
                      onClick={() => removeAttachment(a.id)}
                      className="p-0.5 hover:bg-zinc-200 rounded"
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
            <div className="px-4 py-2 text-sm text-red-600 bg-red-50">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-4 py-3 border-t border-zinc-200">
          <button
            onClick={handleAttach}
            className="flex items-center gap-2 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 rounded-lg"
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
            onClick={onClose}
            className="flex items-center gap-2 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 rounded-lg"
          >
            <IconDelete className="w-4 h-4" />
            Discard
          </button>
        </div>
      </div>
    </div>
  );
}
