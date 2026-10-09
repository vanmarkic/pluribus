# Reply Digest ("Needs your reply") and System 1

**Date:** 2026-10-09
**Status:** Milestone 1 (reply digest) and Milestone 2 (System 1, on-device classifier) implemented.
The model revision of the encoder is not pinned yet (see Milestone 2, Encoder).

## Summary

Important mail that nobody answered is the most expensive thing a mail client can lose. Pluribus
now finds received emails that look important, expect a personal reply and have none yet, shows
them in a **Needs your reply** view, and once a day sends a native notification and an email to
yourself with the list.

Everything runs on the user's machine. The classifier that decides "does this need a reply, and
how much does it matter" is the same triage LLM that already sorts mail into folders (Ollama
locally by default). Body text is only ever shown to a local model unless the user opts in.

Milestone 2 adds **System 1**: a small on-device model, trained on the LLM's answers and the user's
corrections, that answers the same questions without calling the LLM when it is confident. It is a
local, Jev-like classifier: typed questions, typed answers, a confidence on every answer, and an
escalation to the LLM when the confidence is below a threshold that was chosen with a statistical
guarantee.

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
  the System 1 runtime (retrain job, model import), IPC registration, Ollama auto-start, the digest
  runtime, then the first window; the digest and System 1 jobs start after the window and stop
  together on quit.
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
5. System 1 never sends anything anywhere. It reads body previews (and embeds them) on this device;
   it sits **outside** `withBodyPrivacy`, so every prompt that reaches an LLM is still stripped of
   body text and snippet unless the provider is local or the user opted in. The integration test
   `src/__tests__/system1-pipeline.test.ts` composes the real decorators and checks it for the
   LLM-called, audit and System-1-answers paths, with a local-provider and a consent control.
6. Training never reads `email_embeddings.folder` (LLM pseudo-labels and old `INBOX` placeholders),
   fallback results or System 1's own answers: only user actions and System 2 signals.

### Network egress

| Destination | When | What is sent |
|---|---|---|
| The user's IMAP and SMTP servers | Sync, send, digest email | Normal mail traffic with the user's own provider |
| Ollama at `127.0.0.1:11435` | Default LLM provider | Triage prompts; stays on the machine |
| `api.anthropic.com` | Only if the user chose the Anthropic provider | Triage prompts. Body excerpts only with `sendBodyExcerptsToCloud` |
| Hugging Face (model files) | Once, the first time the on-device encoder is needed and is not in `userData/models` | Model download request only; no mail data. Afterwards remote loading is switched off entirely (`allowRemoteModels = false`); "Import model from folder" installs the model with no network at all. The download uses the `main` revision until `PINNED_MODEL_REVISIONS` is filled in (see Encoder) |
| GitHub releases (`ollama-darwin.tgz`) | Only when the user clicks to download the bundled Ollama | A download request |
| Ollama model registry | Only when the user pulls a model, done by the local Ollama server | A download request |
| License server (HTTPS) | License activation and validation | License key and machine identifier |
| Remote images in mail | Blocked by default (`security.remoteImages = 'block'`); fetched through the SSRF guard only if the user allows them | Image requests the mail itself asked for |

The renderer's CSP allows `connect-src` only to itself and `api.anthropic.com`.

## Milestone 2: System 1 (as built)

A small model that runs on this device and answers the three triage questions without the LLM
when it is sure. It follows the Jev idea (typed questions, typed answers with probabilities and a
confidence; act above a threshold, escalate below) distilled locally in the Jevstiller way: a
small head on **frozen** sentence embeddings, a threshold chosen with a finite-sample bound on
disagreement with the teacher, a permanent audit, and a fallback plus retrain when it drifts.

- **System 2** is the LLM (cloud or Ollama): slow, smart, costs money or battery. The **teacher**.
- **System 1** is the local head: fast, free, only answers when it is confident.

Everything System 1 does is on-device: embedding, training, scoring, auditing.

### Questions

`EMAIL_QUESTIONS` in `core/system1/types.ts`:

| Question | Kind | Answer |
|---|---|---|
| `folder` | choice over `TRIAGE_FOLDERS` | the label |
| `needsReply` | yes/no ("noul") | `p(true) >= 0.5`, probability `p(true)` |
| `importance` | score 1 to 4 | the level |

### Where it sits: decorator order (binding)

```
withSignalRecording         records what answered: a 'system1' or 'system2' signal (+ model tag)
  withSystem1               embeds locally, asks the heads; answers, audits or escalates
    withBodyPrivacy         strips body text and the snippet before any cloud LLM
      enhanced classifier   pattern hint + vector search + prompt -> System 2 (the LLM)
```

`main/triage-composition.ts` builds this stack for both the container and the integration test, so
the order exists in one place.

- Signal recording is **outermost**: System 1's own answers are recorded (`source: 'system1'`,
  `modelVersion: 'system1:<encoder id>'`), and an audit or escalation, which returns the LLM's
  result, is recorded as `system2`.
- System 1 is **outside** body privacy. It may see `opts.bodyPreview` because it runs on this
  device; body privacy still strips it before any cloud LLM.
- The pipeline fetches a body preview whenever System 1 is enabled (as well as when the LLM may
  see one). `reclassifyEmail` passes `forceSystem2: true`, so a manual re-run always asks the LLM.
  Results with `source: 'system1'` skip Platt calibration: their confidence is already calibrated
  against held-out data.

### Encoder

- **Model.** `Xenova/multilingual-e5-small` by default (384 dimensions, int8 ONNX, in-process via
  `@xenova/transformers`). About 95 percent of the mail is French and e5 scores clearly higher on
  French than the MiniLM family. The `system1.embeddingModel` setting is an allowlist:
  `Xenova/multilingual-e5-small`, `Xenova/paraphrase-multilingual-MiniLM-L12-v2` and the
  English-only legacy `Xenova/all-MiniLM-L6-v2` (stored under its old short key
  `all-MiniLM-L6-v2`, so vectors made before Milestone 2 stay valid).
- **`query: ` prefix.** e5 models need it on every input. It is added in exactly one place
  (`prepareModelInput`, used by `embed`), so training and inference vectors always match; callers
  pass plain text.
- **Canonical text.** Every System 1 vector comes from `system1Text(email, bodyPreview?)`:
  `From: <name> <domain>`, `Subject: ...`, and up to 600 characters of the cached body preview.
  The decorator stores the vector it scored (`email_embeddings`, keyed by encoder id, with no
  folder label), and training reads exactly that vector. The RAG indexer and the backfill reuse it
  (`keepVector`) and never overwrite it.
- **Cache directory.** The container passes `cacheDir = userData/models` and the model named in
  the settings. Changing the model takes effect after a restart (the settings panel says so);
  heads trained on another encoder never answer, so a switch starts in shadow mode until the next
  retrain.
- **No network once cached.** Right before the model loads, the service checks the cache. If the
  model files are there (`config.json`, `tokenizer.json`, `tokenizer_config.json`,
  `onnx/model_quantized.onnx`) it sets `env.allowRemoteModels = false`, so the library cannot reach
  the network at all. Only a missing model may be downloaded, once. A failed load is not retried
  for 60 seconds.
- **Import from folder.** Settings -> Classification -> Semantic index -> "Import model from folder". A native folder
  picker (the renderer never names a path); the main process validates the required files, copies
  them through temporary names so an interrupted copy never looks complete, and resets the encoder
  so the next embed loads the model offline.
- **Revision pin status: NOT pinned.** Hugging Face was unreachable when this was built, so
  `PINNED_MODEL_REVISIONS` in `src/adapters/embeddings/index.ts` is empty and downloads use the
  `main` revision. On a machine with access, fill it with the current commit sha of each allowed
  model (`curl -s https://huggingface.co/api/models/Xenova/multilingual-e5-small`, field `sha`) and
  the download is pinned from then on (a pinned model is cached under `<model>/<sha>/`).

### Features

The head's input is `[embedding ++ 69 scalar features]`, every feature in `[0, 1]`
(`core/system1/features.ts`): has `List-Unsubscribe`; I am in To (case-insensitive); is a reply;
the subject asks something (`quickCheck`: French and English patterns, works without `?`);
`log1p(prior replies to this sender) / 3` (capped at 1); and the sender domain hashed (stable
FNV-1a) into 64 one-hot buckets, so heads never need a vocabulary.

### Heads and confidence

One multinomial logistic regression (softmax) per question, trained locally with minibatch Adam
and a seeded RNG (deterministic: same data, same weights). Weights live in `system1_heads` as JSON,
one immutable version per retrain. Confidence is `1 - H(p) / ln K` (K = number of classes): 1 for
a one-hot distribution, 0 for uniform.

### Training labels (honest sources only)

| Question | Gold (the user did it) | Teacher (System 2) |
|---|---|---|
| `folder` | `training_examples.user_choice`, `classification_feedback.final_folder`, `triage_log` rows with source `user-override` (latest action wins) | `email_signals` source `system2` `folder` |
| `needsReply` | `email_signals` source `user` (Done, Not important) | source `system2`, `needs_reply >= 0.5` |
| `importance` | source `user` importance | source `system2` importance |

Gold wins over the teacher for the same email and trains with weight 3. **Never used as labels:**
`email_embeddings.folder` (it holds LLM pseudo-labels and old `INBOX` placeholders), fallback
results (pattern matching only; they are not even recorded as signals), `system1` signals (the
model must not learn from itself), and silence. An email without a real label is simply not a
sample.

"Prior replies to this sender" is rebuilt at training time with the same definition as at
inference: mail from the account address, with a readable date, **strictly before** the email,
whose recipients (trimmed, case-insensitive, exact match) include the sender. A reply sent after
the email must not leak its label. `createPriorRepliesCounter` (inference) takes an optional
`before` date and is tested against the training repository on shared data
(`system1-pipeline.test.ts`).

### Bounded-risk threshold (Clopper-Pearson over a fixed grid, Bonferroni corrected)

`trainSystem1` needs 60 labelled emails and at least two classes with 5 each, otherwise it keeps
whatever head exists. It makes a seeded, stratified 80/20 split and fits the head on the 80.
On the 20 percent held out it records, per answer, the confidence and whether the argmax equals
the label, then `selectThreshold` looks for the confidence cut-off that answers the most mail
while keeping the disagreement bounded:

- Only a **fixed grid** of K = 9 cut-offs is tested, `THRESHOLD_GRID = 0.1, 0.2, ..., 0.9`.
  (Testing every observed confidence would run one hypothesis per held-out point and quietly
  weaken the guarantee; commit 1dc289f.)
- For each cut-off, with the accepted answers (confidence at or above it), the one-sided
  Clopper-Pearson upper bound on their disagreement rate is computed at level `alpha / K`
  (Bonferroni, alpha = 0.05), so "disagreement <= epsilon with 95 percent confidence" holds for
  whichever grid value is chosen.
- A cut-off qualifies if the bound is at or below epsilon (default 0.05) and at least 30 answers
  are accepted. The qualifying cut-off with the **most coverage** wins (ties: the stricter one).
  No qualifying cut-off means no threshold: the head stays unarmed.

How much data that takes: with epsilon = 5 percent, 9 grid points and no errors, the bound needs
**102 accepted held-out answers** (144 with one error, 258 for epsilon = 2 percent). With the 20
percent holdout that is roughly **550 labelled emails** before a head can arm (~110 clean held-out
answers with a margin). Fewer emails, or a noisy teacher, simply mean the head keeps learning in
shadow mode and the LLM keeps answering. The panel shows coverage, held-out agreement, the bound,
train size and training date per question.

### Arming rules

- A head is stored `armed` only if `system1.enabled` **and** a threshold was found.
- The decorator answers locally only if **all three** heads are present, armed, trained on the
  encoder that is running (same stored id), the input dimension fits, and each confidence is at or
  above its own threshold. One unsure or unarmed head sends the whole email to the LLM.
- A shadow head (trained, not armed) still predicts: when the LLM answers, the agreement is
  logged (never mail content) so the effect of arming can be judged. Shadow agreement never
  disarms anything.

### Audit and disarm

- With probability `auditRate` (default 5 percent) a confident System 1 answer is **also** sent to
  the LLM. The teacher wins: its result is returned and recorded as `system2`, and System 1's
  agreement is recorded per head: folder equal; needsReply on the same side of 0.5; importance
  within one level. A fallback result is not a teacher opinion and is not audited against.
- `recordSystem1Audit` keeps a rolling agreement per head version (plain mean for the first 50
  audits, then an exponential average with alpha 0.02). After at least 20 audits, agreement below
  `1 - 2 * epsilon` **disarms** that head version; the decorator drops its head cache at once, so
  the very next email goes to the LLM. Audits of a superseded version are ignored.
- Heads are cached for up to 60 seconds in the decorator, so a retrain shows up within a minute.
- Any System 1 error (encoder missing, bad weights, unreadable settings) is logged and escalates to
  the LLM; a failed write of the stored vector is logged and ignored. System 1 is never the reason
  a classification fails.

### Retraining

A scheduler runs `trainSystem1` about 10 minutes after launch and every 24 hours
(`PLURIBUS_DISABLE_SYSTEM1_JOB=1` turns it off; it also skips while `system1.enabled` is false).
"Retrain now" in the settings panel runs it on demand. A question with too little data is left
as it is. Every retrain saves a new head version; a disarmed head stays disarmed until a retrain
finds a qualifying threshold again.

### Settings (`config.system1`)

| Key | Default | Meaning |
|---|---|---|
| `enabled` | true | Use System 1: heads only arm while it is on; it also gates body-preview fetching |
| `embeddingModel` | `Xenova/multilingual-e5-small` | Encoder, from the allowlist; applies after a restart |
| `targetDisagreement` | 0.05 | epsilon: allowed disagreement among answered mail (0.01 to 0.2) |
| `auditRate` | 0.05 | Share of confident answers also sent to the LLM (0 to 0.5) |

Validated at the IPC boundary (`config:set`). IPC: `system1:getStatus`, `system1:retrain`,
`system1:importModel`.

### Tests

Unit tests use fake embedders everywhere (CI cannot reach Hugging Face). The integration test
(`src/__tests__/system1-pipeline.test.ts`) composes the real decorators over in-memory SQLite with
a spy LLM and a fake encoder, and covers: armed and confident heads answer without the LLM and
leave a `system1` signal; unarmed, unsure, other-encoder, forced and failed paths reach the LLM;
audits and drift disarming; the privacy invariant with System 1 in the stack (the encoder receives
the body token, the cloud prompt does not, plus local-provider and consent controls); the whole
learning loop (720 LLM-labelled emails, `trainSystem1`, heads arm, then System 1 answers); and the
prior-replies agreement between training and inference.

### Evaluation

The eval set has French entries (French is the majority; the real mix is about 95 percent French,
5 percent English). Headline accuracy and macro-F1 are **language-weighted** (`EVAL_LANG_WEIGHTS`,
default `fr:0.95,en:0.05`), with per-language numbers beside them, plus selective-prediction
metrics (accuracy at 50 and 80 percent coverage, escalation rate, ECE over 10 bins).

```bash
npm run eval                                   # rule-based stub, CI gate (macro-F1 >= 0.75)
EVAL_CLASSIFIER=system1 npm run eval           # real encoder + the production head, 4-fold CV
EVAL_CLASSIFIER=system1 EVAL_EMBED_MODEL=Xenova/paraphrase-multilingual-MiniLM-L12-v2 npm run eval
EVAL_MODEL_CACHE=~/models EVAL_CLASSIFIER=system1 npm run eval   # default ~/.cache/pluribus-eval-models
```

The System 1 eval embeds every entry once with `system1Text`, then runs 4-fold cross-validation
with `trainHead`, `predictProba` and `entropyConfidence` from the core, so each entry is predicted
by a head that never saw it. It then runs `selectThreshold` on those out-of-fold answers and prints
whether a head trained on this much data would arm, at which threshold and coverage (the escalation
rate in the report uses that threshold). The 100-odd entries are far below the ~550 emails an
armed head needs, so "would NOT arm" is the normal verdict on the dataset; the number to compare
across encoders is the language-weighted accuracy and accuracy at coverage. It needs the model
downloaded once (or imported); it cannot run in CI.

### Known limits

- The encoder revision is not pinned (see Encoder).
- Features that need mail headers (List-Unsubscribe, To, prior replies) are zero in the eval.

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
11. **Encoder downloads once, then runs offline.** With an empty `userData/models`, enable System 1
    and classify some mail: the only new outbound traffic is the model download from Hugging Face
    (no mail data), and `userData/models/Xenova/multilingual-e5-small/` appears. Quit, disconnect
    the network, relaunch, classify new mail: embedding still works and nothing is requested.
12. **Import from folder.** Delete the model folder, click "Import model from folder" and pick a
    downloaded copy: the panel confirms the size, and embedding works with the network off. Pick a
    wrong folder: a readable error naming the missing files, nothing half-copied.
13. **Arming, live.** After about 550 labelled emails and a retrain ("Retrain now"), the panel
    shows armed heads with coverage and a bound at or below the target. New mail is then answered
    on-device (reasoning "On-device model (System 1)") and the LLM call count drops. Moving a mail
    to another folder feeds the next retrain.
14. **Model switch.** Change `system1.embeddingModel` (config), restart: the panel shows the new
    encoder id, the old heads are not used (shadow), and a retrain trains for the new model.
15. **Cloud privacy with System 1 on.** Repeat step 10 with System 1 enabled: even though System 1
    reads previews, the requests to `api.anthropic.com` contain no body text and no snippet unless
    the opt-in is on.
16. **Real encoder, real French.** `EVAL_CLASSIFIER=system1 npm run eval` with the real model
    reports language-weighted accuracy; compare encoders with `EVAL_EMBED_MODEL`.
