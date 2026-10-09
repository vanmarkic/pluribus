# Reply Digest ("Needs your reply") and System 1

**Date:** 2026-10-09
**Status:** Milestone 1 (reply digest) implemented. Milestone 2 (System 1) planned.

## Summary

Important mail that nobody answered is the most expensive thing a mail client can lose. Pluribus
now finds received emails that look important, expect a personal reply and have none yet, shows
them in a **Needs your reply** view, and once a day sends a native notification and an email to
yourself with the list.

Everything runs on the user's machine. The classifier that decides "does this need a reply, and
how much does it matter" is the same triage LLM that already sorts mail into folders (Ollama
locally by default). Body text is only ever shown to a local model unless the user opts in.

Milestone 2 adds **System 1**: a small on-device model, trained on the LLM's answers and the user's
corrections, that answers the same questions without calling the LLM when it is confident.

## Problem

- Triage sorts mail into folders but says nothing about what is still waiting for you.
- A reply that slipped under the fold for a week is invisible: the mail is read, so no unread
  badge, and it is in the inbox, so nothing looks wrong.
- Most of the user's mail is French (about 95 percent), so "does this ask something?" cannot rely
  on English phrases or on a question mark.
- The reminder must not become a new leak: no body text in notifications or digest emails, no
  surprise Touch ID prompts at 09:00, no cloud calls the user did not choose.

## Design (Milestone 1)

### Data flow

```
sync -> triage (System 2: LLM) -> email_signals -> reply-candidate SQL -> scoring
     -> digest scheduler -> notification + email to self
```

1. **Triage** classifies new mail as before. The System 2 prompt now also returns `needsReply`
   (a probability) and `importance` (1 to 4), in French or English, on the meaning of the mail.
2. **Signals.** `withSignalRecording` (adapters/triage) stores what the model said in
   `email_signals`, one row per `(email, source)` with source `user`, `system2` or `system1`.
   Fallback results (pattern matching only) are not recorded: a guess is not evidence. When
   several rows exist the effective signal is chosen by precedence `user > system2 > system1`.
   `Done` and `Not important` in the UI write `user` signals, which later become gold labels.
3. **Candidates.** `reply-candidate-repo` selects received mail that looks unanswered (below).
4. **Scoring.** `core/reply-scoring.ts` gates and ranks the candidates (below).
5. **Digest.** `runDailyDigest` runs per active account and delivers the result.

Skipped before any of this: the user's own mail and anything in Sent, Drafts, Trash, Junk or Spam
(English and French provider folder names) is never triaged.

### Candidate query

`listUnanswered` returns mail that:

- is in INBOX, Planning or Review (matched case-insensitively on `folders.path`);
- was not written by the account itself and has no `List-Unsubscribe` header (not a newsletter);
- is older than the grace period and newer than the lookback window;
- has no reminder state `done` or `dismissed`, and no `snoozed` state that has not expired;
- has **no answer**, meaning none of the following exists among the account's own mail:
  a message whose `In-Reply-To` equals the candidate's `Message-ID`; a message whose `References`
  contains it (plain substring test, so `%` and `_` in ids are not wildcards); or a message in the
  same thread dated at or after the candidate (an earlier mail from me in the thread does not
  count).

Dates are ISO-8601 strings, so string comparison orders correctly. The query reads only the
user's own sent mail from a day before the lookback start, and is backed by indexes on
`in_reply_to`, `(account_id, from_address, date)` and `thread_id`.

**Sent health.** If the account has sent nothing at all in the lookback window, the Sent folder is
probably not synced and every mail would look unanswered. The result is flagged
`sentHealth: 'no-sent-mail'`, has no items, and the digest is suppressed. The view shows a banner.

### French handling

- The System 2 prompt states that mail may be French, English or mixed and tells the model to
  judge on meaning.
- When there is no usable signal the **heuristic** (`quickCheck` in `usecases/awaiting.ts`) decides.
  It recognises question marks and French patterns that carry no `?`: "pourriez-vous", "pouvez-vous",
  "est-ce que", "merci de me confirmer", "dans l'attente de votre retour", "rendez-vous", "je suis
  disponible", plus English equivalents. "Pour info", "je vous informe" and similar phrases veto it.
- Automated senders are recognised in both languages, accent-folded: `noreply`, `no-reply`,
  `notifications`, `ne-pas-repondre`, `pas_de_reponse`, `bounces` and suffixed variants.
- Body previews drop quoted text including French quote introductions ("Le ... a écrit :").
- Heuristic items are marked in the UI as a guess, never as a model verdict.

### Scoring

Gate, when a signal exists: `importance >= 3` and `needsReply >= 0.6`.
Gate, when it does not: the sender looks like a person **and** the heuristic says the mail asks
something. Such items count as importance 3 and needsReply 0.6 and are labelled `heuristic`.

```
score = importanceWeight(importance) * needsReply * ageFactor(ageHours) * (1.1 if you are in To)

importanceWeight: 1 -> 0.2   2 -> 0.5   3 -> 1.0   4 -> 1.8
ageFactor:        1.0 while age <= graceHours, then linear up to 1.5 at 7 days, flat afterwards
```

A user `Done` mark stores needsReply 1 without an importance; the scorer treats that as
importance 3. Ties are broken by signal before heuristic, then longer waiting, then lower id, so
the order is deterministic. At most `maxItems` are kept. The `reason` shown to the user is built
from fixed phrases ("Important - flagged by Claude", "Asked you a question 3 days ago") and never
quotes the mail.

### Settings (`config.digest`)

| Key | Default | Meaning |
|---|---|---|
| `enabled` | true | Run the daily digest |
| `time` | `09:00` | Local time, 24 h |
| `graceHours` | 24 | Give people time to be answered before they are reminded |
| `lookbackDays` | 14 | How far back to look |
| `maxItems` | 10 | Items per account |
| `emailToSelf` | true | Also email the digest to the account's own address |
| `showSubjects` | false | Notification shows sender and subject instead of a count |
| `allowBiometricPrompt` | false | Let a scheduled run trigger Touch ID |

Scheduler bookkeeping (`digestState`: last run date, accounts with a deferred email) lives in the
same store but is not readable or writable over IPC.

### Digest runtime

- **Scheduler.** Checks every minute against local wall-clock time and a local `YYYY-MM-DD` key, so
  DST never skips or doubles a day. It claims the day before running: ticks and wake-ups racing each
  other cannot fire twice, and a failed run is not retried until tomorrow.
- **Catch-up.** About 10 seconds after launch, and on system resume and screen unlock, a digest
  that was missed (app closed, laptop asleep at 09:00) runs immediately.
- **Per account.** Sync first (so the list reflects the mailbox now; a failed sync falls back to
  local data), compute the result, then email it to the account's own address.
- **Notification.** Native (Electron `Notification`). Count only ("3 important emails are waiting
  for your reply") unless `showSubjects`. Clicking it marks an open request pending, shows or
  creates the window and sends `digest:open`; a window that is still loading pulls the request with
  `digest:consumePendingOpen` when it mounts.
- **Email to self.** Sent through the mail sender directly, so it is **not** appended to Sent and
  cannot itself look like an answered thread. Plain text and inline-styled HTML, no remote content,
  every interpolated value escaped.

### Credentials and Touch ID

The scheduled run happens when nobody is watching, so it must not prompt.

- Credentials are read with `getPasswordIfUnlocked`, which returns the password only if a normal
  read would not need a biometric prompt (valid session cache, or no biometric gate). It never calls
  Touch ID and never extends the session.
- Locked credentials: the sync is skipped and the email is **deferred**. The account is remembered
  in `digestState.pendingEmailAccountIds`. The notification still fires from local data.
- Deferred emails are sent when credentials become available: on unlock, on wake, and on app focus
  (throttled to once per 5 minutes). The digest is recomputed at send time, never replayed.
- `allowBiometricPrompt` opts in to one prompt for a scheduled sync. If that sync fails, the email
  is deferred rather than prompting a second time. Manual and test runs never prompt on their own.

### Lifecycle

The window is a view; the app is the process.

- `app.whenReady()` runs **once**: custom protocol, temp cleanup, the CSP header hook, the container,
  IPC registration, Ollama auto-start, the digest runtime, then the first window.
- The window is created and found through a window manager (`main/window-manager.ts`). `showWindow()`
  creates it if needed or restores, shows and focuses it, and concurrent calls create one window.
- IPC handlers that push events (sync progress, classification status, streams) take a window
  **getter** and no-op when there is no window. `registerIpcHandlers` throws if called twice.
- macOS: closing the last window does not quit, so the 09:00 digest still fires. Clicking the dock
  icon (`activate`) or the digest notification re-creates the window. Other platforms quit when the
  last window closes (so the digest only runs while the app is open there).
- A single-instance lock makes a second launch focus the first and exit, so two copies can never
  both send the daily digest. The losing instance registers no lifecycle handlers, so its quit
  cannot clean up the running instance's temp files.

### Privacy invariants (each has tests)

1. Body previews and the body-derived snippet reach an LLM only if the provider is local (Ollama) or
   `llm.sendBodyExcerptsToCloud` is true. `withBodyPrivacy` enforces this at the last moment and
   treats an unreadable config as "no consent". With Anthropic and no opt-in, no body text is in any
   prompt.
2. The notification and the digest email never contain body text or snippets. Notification text is
   a count unless `showSubjects`.
3. `getPasswordIfUnlocked` never prompts biometrics.
4. `digestState` is not exposed over IPC; `digest` settings are validated at the boundary.

### Network egress

| Destination | When | What is sent |
|---|---|---|
| The user's IMAP and SMTP servers | Sync, send, digest email | Normal mail traffic with the user's own provider |
| Ollama at `127.0.0.1:11435` | Default LLM provider | Triage prompts; stays on the machine |
| `api.anthropic.com` | Only if the user chose the Anthropic provider | Triage prompts. Body excerpts only with `sendBodyExcerptsToCloud` |
| Hugging Face (model files) | Once, the first time the on-device embedding model is needed | Model download request only; no mail data. Milestone 2 caches the model in `userData/models`, then disables remote loading entirely and offers an offline "import from folder" |
| GitHub releases (`ollama-darwin.tgz`) | Only when the user clicks to download the bundled Ollama | A download request |
| Ollama model registry | Only when the user pulls a model, done by the local Ollama server | A download request |
| License server (HTTPS) | License activation and validation | License key and machine identifier |
| Remote images in mail | Blocked by default (`security.remoteImages = 'block'`); fetched through the SSRF guard only if the user allows them | Image requests the mail itself asked for |

The renderer's CSP allows `connect-src` only to itself and `api.anthropic.com`.

## Milestone 2: System 1 (planned)

A small local model that answers the three triage questions without the LLM, in the style of a
typed question and answer interface with a confidence on every answer (callers act above a
threshold and escalate below it). Not part of this change. Only the groundwork exists: the shared
types, the `system1` source in `email_signals`, the `system1_heads` table and the
`system1:getStatus` / `system1:retrain` channels, whose use cases are still stubs.

- **Questions** (`EMAIL_QUESTIONS`): `folder` (choice), `needsReply` (yes/no with probability),
  `importance` (score 1 to 4).
- **Encoder.** A frozen multilingual sentence encoder run in-process. Default
  `Xenova/multilingual-e5-small` (384 dimensions; clearly better on French than the MiniLM family;
  needs a `query: ` prefix, applied in one place so training and inference vectors match).
  Alternatives on an allowlist: `Xenova/paraphrase-multilingual-MiniLM-L12-v2`, and the English-only
  `Xenova/all-MiniLM-L6-v2`. The text fed to the encoder is the canonical `system1Text`.
- **Heads.** One linear softmax head per question on `[embedding ++ small scalar features]`
  (list-unsubscribe, addressed-to-me, is-reply, question wording in French and English, prior
  replies to this sender, hashed sender domain). Trained locally with a seeded RNG.
- **Labels.** Gold = user actions (corrections, Done, Not important), weight 3. Teacher = System 2
  signals. Fallback results and `email_embeddings.folder` (pseudo-labels) are never used.
- **Bounded risk.** Hold out 20 percent, then pick the lowest confidence threshold whose
  Clopper-Pearson 95 percent upper bound on disagreement with the teacher is below epsilon (default
  5 percent). A head only arms if such a threshold exists with enough accepted samples.
- **Decorator.** `withSystem1` wraps the classifier: confident and armed -> answer locally with
  `source: 'system1'`; otherwise (or on any error) -> System 2. A small fraction of confident
  answers (default 5 percent) is also sent to System 2 as a permanent audit; the teacher's answer
  wins and the agreement is recorded. A rolling agreement below `1 - 2 * epsilon` after 20 audits
  disarms the head until the next retrain (drift).
- **Retraining.** A nightly job about 10 minutes after start, then every 24 hours; opt out with
  `PLURIBUS_DISABLE_SYSTEM1_JOB=1`. Settings: enabled, encoder, target disagreement, audit rate.
- **Privacy.** The encoder never sends mail anywhere. Once the model is in the cache it is loaded
  with `allowRemoteModels = false`; the first download uses a pinned revision, or the user imports
  the model from a folder and never touches the network.
- **Evals.** The French/English eval set gets French entries (the real mix is about 95/5), per
  language and language-weighted metrics, selective-prediction metrics (accuracy at coverage,
  escalation rate, ECE) and a k-fold System 1 eval with a configurable encoder.

## Manual verification (macOS, real Electron)

Unit tests cover the logic with injected Electron pieces. These need a real run:

1. **Notification fires on time.** Set the digest time to one or two minutes ahead, leave the app
   open, wait. A notification appears (count only by default). Use Settings -> Daily digest ->
   "Send test digest now" for an immediate one.
2. **Click opens the view.** Click the notification with the app focused, in the background, and
   with the window closed: the Needs your reply view is shown each time, including right after a
   cold re-create of the window.
3. **No double registration.** Close the window (red button; the app stays in the Dock), click the
   Dock icon, repeat several times. The window comes back, the app works, and the console shows no
   "already registered" or duplicate-channel error. Sync progress still reaches the new window.
4. **One window.** Click the Dock icon and a notification at the same moment: only one window.
5. **Single instance.** Start the app, then start it again (`open -n` or the binary): the second
   exits and the first window is focused.
6. **Relaunch does not re-fire.** After a digest has run today, quit and relaunch: no second
   notification or email. Change the system date to the next day or wait for it: it fires once.
7. **Missed digest catches up.** Quit before the digest time, relaunch after it: it runs about 10
   seconds after launch. Sleep the Mac across the time and wake it: it runs on wake.
8. **Locked credentials defer the email.** Set the biometric mode to `always`, or let the session
   lapse, and run a scheduled digest with `allowBiometricPrompt` off: no Touch ID prompt appears, the
   notification fires, the email does not. Unlock (use the app so credentials are read) and the
   deferred email arrives within a few minutes or on the next focus.
9. **Not in Sent.** The digest email is in the inbox and not in Sent.
10. **Cloud privacy.** With the Anthropic provider and "Send short body excerpts" off, inspect the
    outgoing requests with a proxy and confirm no body text, then turn the option on and confirm
    short excerpts now appear.
