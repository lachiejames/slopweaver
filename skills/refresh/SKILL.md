---
name: refresh
description: Ingest recent GitHub, Slack, Linear or Notion activity into your local bronze corpus — and, when explicitly named, the owner's Gmail mailbox, diary, recorded Fathom calls or downloaded ChatGPT export. Use when an ask or facts answer looks stale or misses work the user knows exists, or when they name a repo or a date range to pull in. Phrases like "refresh the corpus", "pull in the latest", "ingest", "it doesn't know about that yet".
argument-hint: "[--repo owner/repo] [--source linear|fathom|chatgpt|outlook-calendar] [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--if-stale [--stale-after 4h]] [--numbers-only]"
---

Run `"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" refresh $ARGUMENTS` and report what was written (new records, deduped, source). If it reports no GitHub auth, tell the user to run `gh auth login` — no personal access token is needed. A refresh rebuilds silver itself (`derive`) unless `--no-derive` was passed, which prints that silver is behind; gold (`/slopweaver:distil`) is built only when they ask for it.

Two things worth reporting back that are easy to skip past:

- **The `notes` lines.** A lane can write to a store other than bronze — Linear writes its activity history to
  `corpus/history/` — and reports the count plus its real API spend (requests AND complexity, which are separate
  budgets) as a note. Relay those; a store that fills invisibly is indistinguishable from one that never fills.
- **Any `ABANDONED` warning.** A Slack conversation that goes ten minutes with no page, thread reply or
  flush is abandoned and the crawl moves on — the intermittent silent hang, auto-skipped rather than
  babysat. It claims nothing, so the next refresh retries it whole; but the line names the channel and the
  phase it froze in, and those lines are the only dataset the root-cause work has. Relay them verbatim.
  It is also a coverage GAP: the Slack lane fails, holds its cursor and the run **exits 1** even though the
  other conversations' rows were written, so never report such a run as a fresh corpus.
  `SLOPWEAVER_SLACK_STALL_MINUTES` moves the window ([docs/environment.md](../../docs/environment.md)).
- **The `gmail` lane, when it ran.** It is the one source `--all-sources` does not sweep up: the mailbox is
  ingested only by typing `--source gmail`, because it is one person's private correspondence rather than an
  org-shared surface. Its notes name which of its two crawls ran and that difference matters — a `delta`
  crawl resumed from the stored `historyId`, while a `window` crawl means the anchor had expired (Google
  keeps roughly a week) and the run fell back to a date range in the same pass. A quiet week and an expired
  anchor look identical in the record counts, so relay the lane. Three more of its lines are worth relaying
  verbatim rather than summarising: the **meeting transcripts** count (how many Gemini / Google Meet
  meetings were STORED and how many characters of raw speech they carry — only the transcript block is
  stored, never Gemini's summary, and a meeting with no transcript is refused with its own warning line
  saying how many and what recovers it); a **backfill floor** line, which on a full-history run says either that the backfill
  moved back to an instant and `--all` should be run again, or that it CONVERGED and the whole mailbox is
  crawled; and any line saying the grant cannot read a transcript, whose fix is re-running
  `slopweaver gmail connect` to approve the Google Docs scope.

  Before a full-history mailbox pull, run **`slopweaver gmail measure`** and report its three numbers — the
  exact message count, the exact date of the oldest message, and the estimated byte total with its sample
  size. It walks ids only and costs seconds. After one, run **`slopweaver audit hygiene --source gmail`**:
  a CREDENTIAL shape fails and is a secret the redaction missed; an IDENTIFIER (a workspace id, a home path)
  and a private-denylist word do not fail and are not defects, because a world model of the org is supposed
  to contain the org's own ids and names. A credential it does find is repaired with
  `slopweaver audit hygiene --scrub`, which rewrites only the flagged lines. Every mail record is private by
  source and every address is scrubbed on write — [docs/security/mail-boundary.md](../../docs/security/mail-boundary.md) § "The mail
  boundary".

- **The `fathom` lane, when it ran.** Recorded calls, named or not run — `--all-sources` never sweeps it up.
  Two of its lines are worth relaying rather than summarising. Its **note** says how many pages it walked and
  how many transcripts it stored of how many meetings it saw, and the gap between those last two numbers is
  the whole signal: a meeting Fathom has not finished processing carries a summary and no words, so it is
  refused with its own warning and a LATER refresh over the same window picks it up. The provider's own
  summary is never stored, on the owner's ruling — a lane that stored one would be putting the exact
  thing the owner excluded into the corpus under a kind that promises raw speech. And any line naming a **gap**:
  this lane pages a cursor, so a page that failed halfway holds the cursor rather than moving it, and the
  next run asks the same question again.

  With no key the lane refuses in one line carrying both steps —
  `fathom.video/customize#api-access-header` to mint one, then `slopweaver secrets set fathom-api-key`. That
  refusal is the owner's to clear and nothing here can clear it for the owner: there is no consent flow to drive
  and no signed-in browser session to borrow.

- **The `chatgpt` lane re-reads the owner's newest held export whole.** No network call and no cursor, so `--since`,
  `--until`, `--lookback-days`, `--sample` and `--fetch-cap` are refused beside it, and `--all-sources` never
  sweeps it up. With no export held it says so; `chatgpt sync` is the verb the owner runs ([chatgpt](../chatgpt/SKILL.md)).

- **The `outlook-calendar` lane reads the whole diary once, then what changed.** It rides the calendar's
  own grant (`outlook-calendar connect`). A calendar with no anchor is read whole; then by `lastModifiedDateTime`, five
  minutes overlapped. `--since`/`--all` read every calendar whole, the only way a deleted event's record goes.
  A gap or a `--sample`/`--fetch-cap` moves no anchor ([outlook-calendar](../outlook-calendar/SKILL.md)).

- **The Slack `huddle` lane, and it carries the WORDS.** The workspace-wide `files.list` walk splits
  huddles out from canvases, so a recorded call lands as its own `huddle` record rather than as a document
  somebody wrote — stamped PRIVATE by its kind. Each huddle that names a transcript also
  costs one `files.info` (Slack returns the transcription inline under `include_transcription=true`), and the
  words land in bronze, chunked, searchable by `store read`/`store cite`. **Measured: a minority of `types=spaces` files are
  huddles naming a transcript, so a full Slack refresh pays one extra call per such huddle, not per file.** It is
  best-effort per huddle: one failure warns and leaves that huddle pointer-only rather than sinking the lane.
  `slopweaver atlas slack` counts huddles, how many name a transcript, and how many have their words.
- **`--if-stale`, the cron-safe entry point.** It reads each selected source's stored cursor BEFORE fetching
  anything and refreshes only the sources past `--stale-after` (a duration with a unit — `30m`, `4h`, `7d` — defaulting to
  7d, the same age a coverage leg is annotated stale at). A BARE number is refused rather than read as
  days, because silently reading `4` as four days would turn an intended four-HOUR tick into a four-day one. It prints a verdict line for every selected source, skipped ones included, so a
  tick that did nothing is never a silent tick; over an already-current corpus it costs one file read per
  source and exits `refresh --if-stale · every selected source is inside its freshness window — nothing to do`.
  It only ever REMOVES sources from what was asked for, so the full scheduled form has to be spelled out:
  **`slopweaver refresh --if-stale --all-sources --source gmail`**. A BARE `--if-stale` is REFUSED rather
  than run: on its own it would inherit the implicit GitHub default and quietly leave every other source
  ageing while reporting success, so the verb names the scheduled command instead. Reach for it when the user
  wants a refresh that is cheap to run repeatedly; reach for a plain `refresh` when they have named a window.
- **EVERY refresh takes each selected source's slot, and no flag waives it.** `src/corpus/refreshSlot.ts` —
  the same pid-owned, liveness-probed lock `src/lib/loadSlots.ts` rations memory with, at a limit of one per
  source, taken by one exclusive rename so two racing refreshes never both get it. A hand-run `refresh`, the scheduled `--if-stale` tick and a `--jit` wait all take it, per the
  owner's ruling that a lock is wanted for corpus refresh in general and not only the
  just-in-time case. A source whose slot another live process holds is DROPPED with a line naming the pid
  (or, when the slot could not be taken at all, naming why), and the rest still refresh; a run whose sources were ALL dropped fetched nothing and exits 4
  (`EXIT_DEFERRED`, not yet) — a scheduled resync gives its slot back rather than holding the row.
- **Every refresh writes a sync-run ledger as it runs**: `live/sync-runs/<source>/<start>-<runId>.jsonl`
  (`src/syncRun/`), one `started` row, a `committed` row per bronze commit with each container's new rows by
  kind, a `progress` heartbeat at most every five seconds or on a phase change, and a `finished` row with the
  outcome. A run with no finish row and no process holding the slot reads as ended unfinished. It is best-effort,
  so a failed ledger write is counted in `ledgerFailures` and never sinks the refresh. `automation status` (`src/automations/`) and the
  console's Automations page read it.
- **`--jit`, the just-in-time wait.** What the freshness gate prints when it decides a recency-marked
  question cannot be answered from what is on disk. The slot is every refresh's; `--jit` decides only
  which REMEDY a held slot names: a turn that waited re-asks once the holder finishes, because the
  holder's run is the refresh it wanted, while an operator runs their own command again.
- **`--store`, the leg that reaches the Supabase store.** A refresh writes BRONZE and nothing else; with
  `--store` it then replays every one of the source's bronze window files (`src/cli/commands/refresh/storeLeg.ts`)
  into the selected store, after the bronze summary and before derive, printing one `--store: <source>: N
row(s) stored` line per source. A store that is unselected, unreachable or stale FAILS the verb, in the
  store's own words: every scheduled `resync-corpus-<source>` row runs with it, and a row that exited zero
  having stored nothing was how the store once sat hours stale while the resync reported success.
  Off by default, so a bare `refresh` stays a bronze write and an install with no store keeps working.
- **A Slack refresh measures the owner's voice.** After a Slack ingest that succeeded, the voice leg
  (`src/cli/commands/refresh/voiceLeg.ts`) runs `profile voice measure`'s service over the owner's sent Slack and writes the
  length register, printing one `voice: …` line. No owner id, no corpus, no message of the owner's or no store selected is a
  `voice: nothing measured — <why>` line that keeps the exit code; a read or write that fails FAILS the verb.
- **A failed refresh ENDS on one `refresh failed: …` stderr line** naming every failing leg (ingest, store,
  voice, derive) in run order, its reasons withheld under `--numbers-only` — a scheduled firing keeps only the tail.
- **`--numbers-only`.** If the user wants to paste the run somewhere PUBLIC, use it. It withholds every
  identifying string — previews, item titles, repo slugs, the bronze path — and keeps the counts. Linear's
  progress stream prints issue identifiers, which are team keys, so an unsanitised capture is a leak the
  committed hygiene gate cannot catch: it scans tracked files, not a terminal.

## Running this from Codex

This skill runs on both hosts. In Claude Code, `${CLAUDE_PLUGIN_ROOT}` above is substituted for you. In
Codex it is not: resolve this `SKILL.md` on disk, take the plugin root two directories above it, and invoke
`<plugin-root>/bin/slopweaver` by absolute path for every CLI call. Never run bare `slopweaver` on either
host, because an ambient `PATH` may point at another checkout.
