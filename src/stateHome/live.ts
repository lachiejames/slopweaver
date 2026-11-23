/**
 * The `live` area of the state-home contract: provider-CURRENT reads and the per-turn records one bot turn keeps,
 * under `$home/live`.
 *
 * Part of the one `$SLOPWEAVER_HOME` contract tree, composed by `../stateHome.ts`, which is the only module that
 * imports it. A new live path is a field on {@link LiveStateHomePaths} and a line in the resolver of its sub-tree.
 */

import { join } from "node:path";

import { type LiveHygienePaths, liveHygienePaths } from "../live/hygiene/paths.js";

/** The live area's fields of {@link ../stateHome.StateHomePaths}. */
export interface LiveStateHomePaths {
  /**
   * Provider-CURRENT reads — the `live` tier, deliberately a SIBLING of `corpus` rather than inside it.
   * `refresh` is the only writer into bronze (constraint 4, `docs/constraints/hard.md`), and nothing here is a `CorpusRecord`: these
   * are bytes fetched on demand to answer "read me this thread", never ingested and never redacted.
   *
   * Holding UNREDACTED attachment bytes is the reason the directory is owner-only (`0700`/`0600`). The
   * corpus redacts on write; this tier deliberately does not, because the whole point is the real content.
   */
  readonly live: {
    readonly root: string;
    /**
     * `$home/live/browser` — the browser sessions a `slopweaver browser` verb is holding open. Process
     * state, like `listener`, rather than provider state.
     */
    readonly browser: {
      readonly root: string;
      /**
       * `$home/live/browser/sessions` — one `<id>.json` per OPEN interaction session, plus the private
       * workspace the terminal client runs in and the evidence each action filed.
       *
       * Here rather than under `ledgers/` because a session is live process state that ends when it is
       * closed.
       */
      readonly sessionsDir: string;
    };
    /**
     * `$home/live/poll-gate` — one `<session-id>.json` per session, holding when each target (a log, a
     * pid, a task) was last polled. The poll gate's memory between hook invocations; see `admit/pollGateStore.ts`.
     */
    readonly pollGateDir: string;
    /**
     * `$home/live/seat-pass` — one `<session-id>` file per seat the `UserPromptSubmit` seat check passed on a plan,
     * naming its pid and process start, so `bin/slopweaver` answers its next prompt without node. See
     * `claude/seatPass.ts`; `hooks/lib/seat-pass.sh` spells the same path.
     */
    readonly seatPassDir: string;
    /**
     * `$home/live/claude-usage` — one `<alias>.json` per Claude plan: the newest weekly reading `claude gauge` or a
     * `claude watch` tick took of it, replaced whole and never by an older one. The `UserPromptSubmit` seat check
     * judges a limited plan's running seat against it; see `claude/planUsageSnapshotStore.ts`.
     * `hooks/lib/seat-pass.sh` spells the same path.
     */
    readonly claudeUsageSnapshotsDir: string;
    /**
     * `$home/live/codex-pass-reservations.json` — owner-only (`0600`): one row per Codex plan or review pass still
     * running on a usage-limited account, each holding one weekly point of that account until it is released or
     * expires. Published whole under the `codex-pass-reservations` operation lock; see
     * `codex/passReservationStore.ts`.
     */
    readonly codexPassReservationsJson: string;
    /**
     * `$home/live/dev-lint-gate-seconds.json` — each lint gate's elapsed seconds on the last whole-lane run, which
     * orders the next run longest-first. A scheduling hint only; see `devLint/gateSeconds.ts`.
     */
    readonly devLintGateSecondsJson: string;
    /**
     * `$home/live/plan-connections` — owner-only (`0700`): one `<provider>.json` per plan sign-in the Settings
     * modal's Connect button started, naming its phase (starting, waiting on the browser, connected, failed,
     * cancelled), and one `<id>.cancel` marker while a Cancel is pending. Process state the console polls, never
     * a credential: the sign-in itself lands in the plan's own store. See `plans/connectionStore.ts`.
     */
    readonly planConnectionsDir: string;
    /**
     * `$home/live/sync-runs` — one directory per corpus source, holding one `<start>-<runId>.jsonl` per refresh
     * run: what it started on, its progress checkpoints, what each bronze commit wrote per container, and how it
     * finished. The record the console's Automations page reads; see `syncRun/`.
     */
    readonly syncRunsDir: string;
    /** `$home/live/console-sync-failures.jsonl` — every failed sync started by the console, for the monitor sweep. */
    readonly consoleSyncFailuresJsonl: string;
    /**
     * `$home/live/listener` — how the standing Slack listener is RUN and WATCHED, a sibling of `live/slack`
     * (which is what the listener produces) because this is process state, not provider state. See
     * `live/listen/supervise/` and `docs/listener-supervision.md`.
     */
    /**
     * `$home/live/events` — the SUPERVISOR STREAM: one append-only file every long-running Slopweaver
     * surface publishes its state changes onto, plus the named byte-offset cursors its readers resume from.
     * See `events/` and `docs/supervisor-events.md` for why this is Slopweaver's own file rather than a
     * publication into cmux's stream.
     */
    readonly events: {
      readonly root: string;
      /** `$home/live/events/stream.jsonl` — the append-only stream itself. One JSON event per line. */
      readonly streamJsonl: string;
      /** `$home/live/events/cursors` — one `<name>.json` per named reader, holding its byte offset. */
      readonly cursorsDir: string;
    };
    /**
     * `$home/live/machine` — what the machine gauge has FOUND, as opposed to what it read. The dispatch
     * register is append-only and owner-only for the same reason the event stream beside it is: its rows
     * name pids and process labels.
     */
    readonly machine: {
      readonly root: string;
      /**
       * `$home/live/machine/dispatches.jsonl` — one row per anomalous reading: the triggers, the culprit
       * tree, the seat it opened or the reason it opened none, and its settlement.
       */
      readonly dispatchesJsonl: string;
      /**
       * `$home/live/machine/series.jsonl` — the last hour of `machine series` samples, oldest first, at most one
       * per thirty seconds: CPU split fleet and other, load against its hold, memory, and each session tree. The
       * Fleet page's live charts read it through that verb. Rewritten whole and bounded on every sample.
       */
      readonly seriesJsonl: string;
      /**
       * `$home/live/machine/spawn-backoff.json` — the fleet-wide spawn backoff every `cmux spawn` reads and
       * writes under one lock: the held window, its streak, and the recovery spacing after it.
       */
      readonly spawnBackoffJson: string;
    };
    /**
     * `$home/live/friction-review` — the last local date the Friction Review page was republished (written by
     * `reflect friction-review --republish` once its page is out, or `--mark-published` alone), a
     * sibling of `live/github` for the same reason: it is about how a session ACTED (published a page),
     * never anything a provider holds. See `reflect/frictionReviewPublish.ts` for the reader/writer and
     * `reflect/frictionReviewGap.ts` for what compares it against `$home/morning`'s dated reports.
     */
    readonly frictionReview: {
      readonly root: string;
      /** `$home/live/friction-review/published.json` — `{ localDate, publishedAtIso }` of the last republish. */
      readonly publishedJson: string;
    };
    /**
     * `$home/live/github` — cross-session GitHub coordination state, a sibling of `live/listener` because it
     * is about how sessions RUN rather than about anything a provider holds.
     */
    readonly github: {
      readonly root: string;
      /**
       * `$home/live/github/merge-hold.json` — which pull request owns the merge queue, per repository.
       *
       * One document rather than one file per repository: the set is at most one entry each, and a single
       * document is what lets `github hold --status` report the whole picture in one read. See
       * `outbound/github/mergeHold.ts` for why the hold exists at all.
       */
      readonly mergeHoldJson: string;
      /**
       * `$home/live/github/pr-state/` — one JSONL snapshot per repository of every open pull request the
       * operator authored, as `github stack restack` last measured and prepared it.
       *
       * One file PER REPOSITORY rather than one per pull request, unlike `ledgers/github-stack-members/`:
       * the whole point is that a snapshot is COMPLETE, so a merged pull request disappears by being absent
       * from the next one rather than needing a deletion nobody remembers to do. That ledger is never
       * pruned, and 227 stale entries in one repository made `stack sync --dry-run` take 186 seconds to
       * decide it had nothing to do (measured). The file name hashes the repository slug AND the
       * git common directory, so worktrees of one clone share a snapshot and two clones never collide.
       */
      readonly prStateDir: string;
      /**
       * `$home/live/github/hold-ledger.jsonl` — the append-only journal of every hold transition: one
       * `held`, `released` or `stale` row carrying the pull request, the holding session, the instant and
       * how long the hold had stood.
       *
       * A SIBLING of `merge-hold.json` rather than a field inside it, and the distinction is the point:
       * the document is REPLACED, so a released hold leaves it carrying nothing, while the journal is
       * appended, so a shift's holds can be measured after the fact. See `outbound/github/holdLedger.ts`.
       */
      readonly holdLedgerJsonl: string;
    };
    /** `$home/live/gmail` — mail bytes a Gmail verb was explicitly asked to keep. */
    readonly gmail: {
      readonly root: string;
      /**
       * `$home/live/gmail/attachments` — one `<message-id>/` directory per message, holding each attachment
       * `gmail attachment` fetched. PRIVATE and UNREDACTED: the bytes are a third party's mail content, kept
       * owner-only because reading them is the point. See `live/gmail/attachment.ts`.
       */
      readonly attachments: string;
      /**
       * `$home/live/gmail/board-drafts` — one `<slug>.<digest>.json` receipt per board mail `gmail draft
       * --board` drafted, and a `.claim` beside it while a press holds that mail. See
       * `cli/commands/gmail/boardDraftClaim.ts`.
       */
      readonly boardDrafts: string;
      /**
       * `$home/live/gmail/card-mail` — one `<card-slug>.json` per triage card: the headers and raw bodies of the mail it
       * pinned, which the Queue draws inside the card, sanitised on every read. PRIVATE and UNREDACTED, like
       * `attachments`. See `live/gmail/cardMail.ts`.
       */
      readonly cardMail: string;
      /**
       * `$home/live/gmail/triage.json` — the latest `gmail triage --write` reading: the owner's inbox grouped by sender,
       * addresses and subjects only, which the daily inbox-triage seat cards from. See `live/gmail/triage.ts`.
       */
      readonly triageJson: string;
      /** `$home/live/gmail/triage-cards` — one `<card-slug>.json` per triage card: the exact ids it showed the owner. */
      readonly triageCards: string;
    };
    /** `$home/live/outlook` — mail bytes an Outlook verb was explicitly asked to keep. */
    readonly outlook: {
      /**
       * `$home/live/outlook/attachments` — one directory per message, named by a hash of its id because an
       * Outlook id is long and carries characters a path should not, holding each file `outlook attachment`
       * fetched. PRIVATE and UNREDACTED, like Gmail's. See `live/outlook/attachments.ts`.
       */
      readonly attachments: string;
    };
    /** `$home/live/fathom` — the browser relay's working directory for `fathom share` page reads. */
    readonly fathom: { readonly root: string };
    /**
     * `$home/live/chatgpt/conversations` — one `<id>/` per ChatGPT conversation `chatgpt conversation`
     * pulled, holding its `messages.jsonl` and `transcript.md`. Named chats only, read on demand.
     */
    readonly chatgpt: { readonly conversations: string };
    /**
     * `$home/live/hygiene` — the fixed documents the daily hygiene rows replace whole: the cycle reconcile
     * report, the board sweep's findings and its verdict census, and the landing read a seated `hygiene-sweep`
     * session works from.
     * Resolved in `live/hygiene/paths.ts`; the reader's contract is
     * `skills/automation/reference/hygiene-documents.md`.
     */
    readonly hygiene: LiveHygienePaths;
    readonly standing: {
      readonly root: string;
      /**
       * `$home/live/standing/respawn-pending.json` — the loop respawn `session respawn loop` has BOOTED but
       * not yet CONFIRMED: a per-boot id, the predecessor's arm id, the successor's slug and tree, and — once
       * `--confirm` has seen the successor's own arm live from that tree — the arm id it was confirmed on.
       * Process state, like `listener`, so it lives beside it rather than under `live/slack`. See
       * `live/standing/respawnStore.ts`.
       */
      readonly respawnPendingJson: string;
    };
    readonly listener: {
      readonly root: string;
      /** `$home/live/listener/arm.json` — the current detached listener's pid, arm id and per-arm log path. */
      readonly armJson: string;
      /**
       * `$home/live/listener/heartbeat.json` — the beat the listener itself rewrites whole every
       * `HEARTBEAT_INTERVAL_MS`, carrying its socket state. Rewritten rather than appended, for the measured
       * reason `live/listen/supervise/heartbeat.ts` records.
       */
      readonly heartbeatJson: string;
      /** `$home/live/listener/arms.jsonl` — the append-only armed/died/disarmed/escalated journal. */
      readonly armsJsonl: string;
      /**
       * `$home/live/listener/connections.json` — the last `hello` frame's `num_connections`, whole-file
       * rewritten by whichever listener saw it. Deliberately NOT a field on the heartbeat: it is a fact
       * about the Slack APP rather than about one arm's liveness, and it outlives the arm that observed it.
       * See `live/listen/supervise/socketBudget.ts`.
       */
      readonly connectionsJson: string;
      /** `$home/live/listener/logs` — one `<armId>.log` per arm. Never shared between arms. */
      readonly logsDir: string;
      /**
       * `$home/live/listener/queue.jsonl` — where a supervised listener durably records every captured tag.
       * The arm always passes `--queue`: AGENTS.md rule 2 permits a sessionless listener ONLY in the
       * `--follow --queue` shape, and a detached one has no visible supervisor session to inherit.
       */
      readonly queueJsonl: string;
    };
    readonly slack: {
      readonly root: string;
      /** `$home/live/slack/thread-files` — attachments downloaded by `slack read-thread`, keyed by file id. */
      readonly threadFiles: string;
      /**
       * `$home/live/slack/file-reads` — bodies downloaded by `slack read-file`, keyed by file id.
       *
       * A SEPARATE directory from `threadFiles` rather than a shared one, because the two hold different
       * things under the same key shape: a thread attachment is a file someone posted to a conversation,
       * and a `read-file` body can be a huddle transcript, which is one person's spoken words. Keeping the
       * huddle lane addressable on its own is what lets it be swept or excluded without touching the other.
       */
      readonly fileReads: string;
      /**
       * `$home/live/slack/channel-media` — the thumbnails `slack channel-view` fetched, content-addressed
       * (`<sha[0:2]>/<sha256>`), so the console serves exactly the bytes a read fetched. Every read fetches its pictures
       * again on its own token; nothing here answers a later read.
       */
      readonly channelMedia: string;
      /** `$home/live/slack/asks.jsonl` — the append-only ask-lifecycle log (see `live/ask/lifecycle.ts`). */
      readonly asksJsonl: string;
      /**
       * `$home/live/slack/supersessions.jsonl` — the append-only SUPERSESSION journal: every time a
       * correction turn set out to delete the bot answer it replaced, and what became of that delete (see
       * `live/turn/supersession/journal.ts`).
       *
       * A file of its own rather than a line in the turn journal beside it, because what it records is an
       * IRREVERSIBLE act on somebody else's screen and the reader is an audit rather than a turn. One INTENT
       * row is written before the delete and one RESULT row after it, so an intent with no result is a
       * crashed session rather than a silence — which is the exact question a turn journal keyed by ask
       * cannot answer, since the deleted answer belongs to an EARLIER turn on that same ask.
       */
      readonly supersessionsJsonl: string;
      /**
       * `$home/live/slack/placements.jsonl` — the append-only PLACEMENT journal: where every message this
       * install posted actually landed, read back from Slack after the post, and every move or cross-link the
       * read-back caused (see `corpus/slack/writeGuardPlacement.ts`). It is also the one register of the
       * threads the bot sent into, which `slack followup` re-reads later for replies.
       */
      readonly placementsJsonl: string;
      /**
       * `$home/live/slack/followup-watermarks.json` — per thread the bot sent into, the newest message
       * `slack followup --advance` has already shown a session, so a later read lists only what is new.
       */
      readonly followupWatermarksJson: string;
      /**
       * `$home/live/slack/witness-state.json` — the threads the listener is WITNESSING because a configured
       * peer bot (`slackBot.witnessBotHandles`) was tagged in them, each with its last observed message and its per-UTC-day line
       * count (see `live/listen/witnessState.ts`). A replaced snapshot rather than a log, because the reader
       * is the listener's next event and it needs the current set, bounded by retention.
       */
      readonly witnessStateJson: string;
      /**
       * `$home/live/slack/witness-outcomes.jsonl` — the append-only WITNESS journal: every witnessed message
       * the loop dispatched a visible worker for, and how each ended (nothing checkable, nothing material,
       * posted, failed). Keyed by channel, thread and message, so a retry can never dispatch or post twice
       * (see `live/witness/journal.ts`).
       */
      readonly witnessOutcomesJsonl: string;
      /**
       * `$home/live/slack/ignored-asks.jsonl` — the append-only PERMANENT ignore registry (see
       * `live/ask/ignore.ts`). "Never reconsider this exact message," distinct from a single turn's own
       * `no-response` judgement.
       */
      readonly ignoredAsksJsonl: string;
      /**
       * `$home/live/slack/ignored-conversations.jsonl` — the append-only PERMANENT CONVERSATION ignore
       * registry (see `live/ask/ignoredConversation.ts`). "Never reconsider ANY tag in this conversation,"
       * the channel-keyed sibling of {@link ignoredAsksJsonl}.
       */
      readonly ignoredConversationsJsonl: string;
      /**
       * `$home/live/slack/dispatches` — one `<channel>-<messageTs>.json` per `fresh-visible-session`
       * dispatch, keyed the same way `briefs/` is (see `live/turn/briefStore.ts`). Holds request and
       * LOCATOR facts only — never a cached completion state (see `live/turn/dispatch.ts`'s own header).
       */
      readonly dispatches: string;
      /**
       * `$home/live/slack/checkpoints` — one `<channel>-<messageTs>/` directory per ask, keyed like
       * `dispatches`, holding the DRAFTS a worker validated and an append-only `log.jsonl` ordering them
       * (see `live/turn/checkpointStore.ts`).
       *
       * The draft is the one half of a turn's work product that nothing durable ever held. A worker writes
       * its answer to an absolute path of its own choosing and `turn resume --answer` records only that
       * path — measured on ask `C0SYN000008/1789046247.801199`, the path was a session scratchpad that no
       * longer exists, so a turn that died with two reviewer rounds behind it left a draft nobody
       * could ever read again. The verdicts are the other half and they need no directory of their own:
       * `reviews/<key>/` already holds every round's verdict as it is produced, and what was missing there
       * was a reader and a freeze that copied them.
       */
      readonly checkpoints: string;
      /**
       * `$home/live/slack/detectives` — one `<channel>-<messageTs>/` directory per ask, keyed like
       * `dispatches`, holding one `<store|recall>-<ms>/` directory per detective wave a turn planned with
       * `--ask`: every brief, every report, and the `wave.json` record `turn freeze` carries (see
       * `detective/waveHome.ts`).
       *
       * The reports are the half of an investigation nothing durable held: every wave before this passed
       * `--out` into its session scratchpad, so the false leads and exclusions a detective found died with
       * the session that spawned it.
       */
      readonly detectives: string;
      /**
       * `$home/live/slack/turn-markers` — one `<channel>-<messageTs>.json` per `fresh-visible-session`
       * dispatch, keyed identically to `dispatches`. Deliberately a SEPARATE file from the dispatch record:
       * `dispatches`'s own doc comment says it must never carry a cached completion state, and this is
       * exactly that state — `turn resume`'s own genuine `SLOPWEAVER_TURN_READY`/`SLOPWEAVER_TURN_FAILED`
       * marker, persisted in addition to being printed, so a poller isn't blind whenever a host TUI collapses
       * the stdout line the marker rode in on (see `live/turn/turnMarkerStore.ts`).
       */
      readonly turnMarkers: string;
      /**
       * `$home/live/slack/worker-sessions` — one `<channel>-<messageTs>.json` per `fresh-visible-session`
       * dispatch, keyed identically to `dispatches`. The WORKER's own statement of which visible session it
       * is running as, so the loop's sweep can render that worker's card from its transcript rather than
       * from a screen scrape (see `live/turn/workerSessionStore.ts`). A separate file for the same reason
       * `turnMarkers` is: the dispatch record holds facts decided at dispatch time by one writer, and this
       * is a fact only the worker can supply, later.
       */
      readonly workerSessions: string;
      /**
       * `$home/live/slack/reviews` — one `<channel>-<messageTs>/` directory per answer review `turn review`
       * opened, keyed like `dispatches`. Holds the reviewer's LOCATOR record (`record.json`), the packet this
       * program composed for it (`packet.md`), and the verdict path it was asked to write (`verdict.json`).
       * The record is an address to poll, never a claim about the review's progress — the same discipline
       * `dispatches` holds to (see `live/turn/review.ts`).
       */
      readonly reviews: string;
      /**
       * `$home/live/slack/progress` — one `<channel>-<messageTs>.jsonl` per ask, keyed like `dispatches`.
       * The turn's own progress record: every STAGE the worker declared, and every card WRITE that reached
       * Slack (see `live/turn/progressLog.ts`). Both kinds live in one file on purpose — two processes append
       * to it, and the question it answers ("what did the reader see, and when") is a single ordering.
       */
      readonly progress: string;
      /**
       * `$home/live/slack/turn-journal` — one `<channel>-<messageTs>.jsonl` per ask, keyed like `dispatches`.
       * The turn's decisions about ITSELF: every bounded lease grant a review round bought it, and every
       * edit to an answer a reviewer had already been given, each with its stated reason (see
       * `live/turn/turnJournal.ts`).
       *
       * A sibling of `progress` rather than more rows in it. That file answers "what did the people in the
       * thread see, and when"; nothing here ever reaches Slack, so folding the two would invite a reader to
       * treat a lease grant as something the thread was told.
       */
      readonly turnJournal: string;
      /**
       * `$home/live/slack/recovery-sweep.json` — the scheduled all-visible recovery sweep's durable
       * watermark, and — from schema V2 on — recovery's own per-thread checkpoint inventory (see
       * `live/listen/recoverSchedule.ts` and `live/listen/recoverThreads.ts`). Written temp-file-plus-rename;
       * invalid contents refuse rather than silently re-bootstrapping the whole scan window. The checkpoint
       * inventory is a SEPARATE namespace from corpus ingestion's own thread cursors
       * (`corpus/slack/threadCursors.ts`) even though it lives in this one file — never the same values.
       */
      readonly recoverySweepJson: string;
      /**
       * `$home/live/slack/owed.json` — the latest `slack owed --write` reading: followed threads whose last
       * word is somebody else's, with its coverage and residue (see `live/slack/owedDocument.ts`). One
       * document replaced atomically on every write, never appended: it is a snapshot a briefing reads.
       */
      readonly owedJson: string;
      /**
       * `$home/live/slack/awaiting.json` — the latest `slack awaiting --write` reading: followed threads whose
       * last HUMAN word is the owner's ask, quiet two business days or more (see `live/slack/awaitingDocument.ts`). The
       * worklist a seated `thread-chase` session drafts chases from; replaced atomically, never appended.
       */
      readonly awaitingJson: string;
      /**
       * `$home/live/slack/finding-followups.json` — the latest `slack finding-followups --write` reading: shared
       * findings owed their one follow-up card (see `live/slack/findingFollowupsDocument.ts`). Read by the same
       * seated `thread-chase` session; replaced atomically, never appended.
       */
      readonly findingFollowupsJson: string;
    };
    /**
     * `$home/live/recipe` — the AUTOMATION state: what is registered, when each row last ran, who holds
     * one right now, and what the last attempt on each target achieved. A SIBLING of `live/slack` for the
     * same reason `live/slack` sits beside the corpus — it is CURRENT machine state a pass reads and writes
     * directly, never a `CorpusRecord`.
     *
     * The generation lifecycle, the job request/result files and the scheduler registration were here until
     * the standing scheduler and its dispatcher were retired. What is left is what the
     * seat path itself reads.
     */
    /**
     * `$home/live/vuln` — the vulnerability-fix flywheel's own per-install state.
     *
     * Two files: the association from a GitHub code-owner answer to a person the identity map knows
     * (`live/vuln/reviewerMap.ts`), and the packages ruled not fixable by a bump (`live/vuln/notABumpStore.ts`).
     * Both are here rather than in the repository because they are one installation's facts, and state
     * rather than configuration because they change when the team or the dependency tree does.
     */
    readonly vuln: {
      readonly root: string;
      /** `$home/live/vuln/reviewers.json` — the login/team → person map the daily roster post addresses by. */
      readonly reviewersJson: string;
      /** `$home/live/vuln/not-a-bump.json` — the packages the top-up planner never batches, each with its anchor. */
      readonly notABumpJson: string;
    };
    readonly recipe: {
      readonly root: string;
      /**
       * `$home/live/recipe/definitions` — one `<recipeId>.json` DEFINITION per recurring job: which kind it
       * runs, whether it reads or writes, when it is due, where it lands, and the params the kind validates.
       *
       * These live outside the repository by construction rather than by preference. A definition names its real destination, and a real
       * destination carries a workspace id, which is exactly the `raw-workspace-id` class `hygiene/scan.ts`
       * refuses in any working-tree file wherever `IDENTIFIER_VERDICT` reads `refuse` — so a committed
       * definition is one the gate flags, and refuses under that value. What IS in the repository is the KIND the definition names
       * (`live/automation/kinds.ts`), which is a reviewed, gated verb. The row chooses when and with what; it
       * can never choose what Slopweaver is allowed to do.
       */
      readonly definitionsDir: string;
      /**
       * `$home/live/recipe/definition-runs.json` — when each definition last ran, which is the only clock
       * `live/automation/definitionDue.ts` has: a row's cadence names firings, and "has one gone by" needs a
       * left-hand side. `automation run-due` reads and writes it, whether it was typed by a supervisor pass or by
       * the session `automation seat` opened for a spawn-shaped row.
       */
      readonly definitionRunsJson: string;
      /**
       * `$home/live/recipe/slot-attempts` — one `<slotKey>.json` per cadence FIRING, holding that firing's
       * whole story: who took it, under what lease, on which attempt, and how it ended.
       *
       * The exactly-once ledger. A directory rather than one map because it grows with
       * TIME, which is the distinction `whole-file-json` draws — `definitionRunsJson` is bounded by the
       * number of definition files instead. See
       * `live/automation/slotLedger.ts` for the key derivation and the mutex, `live/automation/slotAttempt.ts` for
       * what a row means.
       */
      /**
       * `$home/live/recipe/metrics-push` — one `<recipeId>/<utcDay>.json` series payload per firing of a
       * `metrics-push` row: exactly what `datadog submit` read and sent.
       *
       * Kept rather than staged and deleted, because the door's ledger records the DECISION and the UTC
       * days, never the points — so "what did that run actually submit" is answerable afterwards only from
       * here. A directory for the reason `slotAttemptsDir` is one: it grows with time.
       */
      readonly metricsPushDir: string;
      /**
       * `$home/live/recipe/postings` — one `<slotKey>.json` per firing that POSTED, written by the executor the
       * moment the post is confirmed: the channel it went to, the message's ts and when.
       *
       * Recorded rather than recomputed because the inputs that chose the channel (the row's `params`, its
       * `channelApprovals`, the profile's `promptChannel`) can all change after the firing, and a reader
       * re-deriving the send's key from today's inputs would lose every post made under yesterday's. The
       * Automations page reads it (`live/automation/postingLedger.ts`). A directory for the reason
       * `slotAttemptsDir` is one: it grows with time.
       */
      readonly postingsDir: string;
      readonly slotAttemptsDir: string;
      /**
       * `$home/live/recipe/repairs.jsonl` — one line per stopped recipe a seat TOOK to repair: the recipe id,
       * the board row the seat is running and when (`slopweaver automation repair`).
       *
       * What turns the `recipe-stopped` card into a notice naming the seat: a take
       * counts only while its row is non-terminal and its run is open (`live/automation/repairTake.ts`), so a line
       * is never deleted — it simply stops counting when the repair ends. It is one of two owners of a stop: a
       * seat holding the current firing's slot lease is the other (`monitor/stoppedSource.ts` `mergeHeldStops`),
       * and a take here wins when both exist.
       */
      readonly repairsJsonl: string;
      /**
       * `$home/live/recipe/failure-explanations.jsonl` — one line per failed firing a visible session explained in
       * one plain sentence (`slopweaver automation explain`): the recipe, the firing's slot and attempt, the
       * sentence and when it was written. The Automations page leads a broken row with it (a run
       * that errors records why, in words the owner can read). Append-only beside the slot ledger rather than inside it,
       * so the exactly-once rows are never rewritten after they settle; the newest line for a firing wins.
       */
      readonly failureExplanationsJsonl: string;
      /**
       * `$home/live/recipe/resync-owned.json` — the recipe ids `automation register-resyncs` has itself
       * written, so a row wearing a managed id that no pass on this install recorded is reported as
       * somebody else's rather than retired out from under them.
       */
      readonly resyncOwnedJson: string;
      /**
       * `$home/live/recipe/team-repositories.json` — the team repositories THIS install has registered with
       * `automation register-standing --repo`, each by its repository alone. The per-repository standing rows are declared
       * from it (`live/automation/teamStandingRows.ts`), so a fresh home declares none, and a registered
       * repository's deleted row stays loud. Absent is the valid fresh-install state; a file that does not
       * parse is a typed error, never read as absent (`live/automation/teamRepositoryStore.ts`).
       */
      readonly teamRepositoriesJson: string;
      /**
       * `$home/live/recipe/own-repositories.json` — every address `automation register-standing` has written into
       * this install's own-repository rows, oldest first and append-only, so a row a later `origin` move left behind
       * still reads as the build's own write. Absent is the valid fresh-install state; a file that does not parse is
       * a typed error, never read as absent (`live/automation/ownRepositoryStore.ts`).
       */
      readonly ownRepositoriesJson: string;
      /**
       * `$home/live/recipe/retirements.json` — the standing rows THIS install retired with `automation retire`,
       * each with the owner's anchored words and why. The declaration subtracts them (`live/automation/declaredStandingRows.ts`),
       * so a retired row is neither reported MISSING nor written back by `register-standing`. Absent is the valid
       * fresh-install state; a file that does not parse is a typed error, never read as absent
       * (`live/automation/retirementStore.ts`).
       */
      readonly retirementsJson: string;
      /**
       * `$home/live/recipe/switches.jsonl` — one appended line per row `automation enable` or `automation disable`
       * switched, with the state written and the owner's anchored words and why. The definition's `enabled` is the
       * state; this is who asked for it, so a wrong switch is findable afterwards. Append-only; nothing edits a line
       * (`live/automation/rowSwitchStore.ts`).
       */
      readonly switchesJsonl: string;
      /**
       * `$home/live/recipe/resync-state` — one `<recipeId>.json` per scheduled target, holding its last
       * attempt, its last SUCCESS and any standing blocker.
       *
       * Separate from `definitionRunsJson` for the reason that file is separate from the claims file: a run
       * stamp answers "when did this row last fire", and a reader deciding whether an atlas is actually
       * current needs "when did it last WORK". A row that has fired every four hours and failed every time
       * looks identical to a healthy one through the stamp alone.
       */
      readonly resyncStateDir: string;
      /**
       * `$home/live/recipe/propagation` — what each successful corpus sync re-derived (`records/<id>.json`,
       * written once), the ONE open judgement pass every sync joins (`batch.json`), and each retired pass
       * (`batches/<batchId>.json`). `live/resync/propagationBatch.ts` holds the shapes.
       */
      readonly propagationDir: string;
    };
  };
}

/**
 * Resolve `live/github` — the merge lane's own state: what is held now, and what has ever been held.
 *
 * Its own function so {@link liveHomePaths} stays short enough for a reader to hold whole.
 *
 * @param home the Slopweaver home
 * @returns the `live.github` sub-tree, rooted at `home`
 */
function liveGithubPaths({ home }: { home: string }): LiveStateHomePaths["live"]["github"] {
  return {
    holdLedgerJsonl: join(home, "live", "github", "hold-ledger.jsonl"),
    mergeHoldJson: join(home, "live", "github", "merge-hold.json"),
    prStateDir: join(home, "live", "github", "pr-state"),
    root: join(home, "live", "github"),
  };
}

/**
 * The recipe sub-tree of {@link liveHomePaths}.
 *
 * Its own function because the live tree grew past the length at which a reader holds the whole body, and
 * the recipe branch is the one that keeps growing — the scheduler's own state, the in-repo
 * definition store, and now the scheduled-resync roster's ownership and outcome records.
 *
 * @param home the Slopweaver home
 * @returns the recipe sub-tree, rooted at `home`
 */
function recipeHomePaths({ home }: { home: string }): LiveStateHomePaths["live"]["recipe"] {
  return {
    definitionRunsJson: join(home, "live", "recipe", "definition-runs.json"),
    definitionsDir: join(home, "live", "recipe", "definitions"),
    failureExplanationsJsonl: join(home, "live", "recipe", "failure-explanations.jsonl"),
    metricsPushDir: join(home, "live", "recipe", "metrics-push"),
    ownRepositoriesJson: join(home, "live", "recipe", "own-repositories.json"),
    postingsDir: join(home, "live", "recipe", "postings"),
    propagationDir: join(home, "live", "recipe", "propagation"),
    repairsJsonl: join(home, "live", "recipe", "repairs.jsonl"),
    resyncOwnedJson: join(home, "live", "recipe", "resync-owned.json"),
    resyncStateDir: join(home, "live", "recipe", "resync-state"),
    retirementsJson: join(home, "live", "recipe", "retirements.json"),
    root: join(home, "live", "recipe"),
    slotAttemptsDir: join(home, "live", "recipe", "slot-attempts"),
    switchesJsonl: join(home, "live", "recipe", "switches.jsonl"),
    teamRepositoriesJson: join(home, "live", "recipe", "team-repositories.json"),
  };
}

/**
 * The `live/browser` block — what an interaction session is holding open.
 *
 * Its own builder because {@link liveHomePaths} is already at the length where a reader stops holding the
 * whole body.
 *
 * @param home the state home
 * @returns the browser paths
 */
function liveBrowserPaths({ home }: { home: string }): LiveStateHomePaths["live"]["browser"] {
  return {
    root: join(home, "live", "browser"),
    sessionsDir: join(home, "live", "browser", "sessions"),
  };
}

/**
 * Resolve the `live/slack` sub-tree — every record one bot turn reads or writes about a Slack ask.
 *
 * Its own function for the same line-count reason as {@link liveBrowserPaths}, and it is the sub-tree that
 * GROWS: a new per-turn record lands here rather than anywhere else under `live`, so lifting it out is what
 * keeps the next one from pushing its parent over the cap again.
 *
 * @param home the Slopweaver home
 * @returns the Slack sub-tree, rooted at `home`
 */
function liveSlackPaths({ home }: { home: string }): LiveStateHomePaths["live"]["slack"] {
  return {
    asksJsonl: join(home, "live", "slack", "asks.jsonl"),
    awaitingJson: join(home, "live", "slack", "awaiting.json"),
    findingFollowupsJson: join(home, "live", "slack", "finding-followups.json"),
    checkpoints: join(home, "live", "slack", "checkpoints"),
    detectives: join(home, "live", "slack", "detectives"),
    dispatches: join(home, "live", "slack", "dispatches"),
    ignoredAsksJsonl: join(home, "live", "slack", "ignored-asks.jsonl"),
    ignoredConversationsJsonl: join(home, "live", "slack", "ignored-conversations.jsonl"),
    owedJson: join(home, "live", "slack", "owed.json"),
    recoverySweepJson: join(home, "live", "slack", "recovery-sweep.json"),
    progress: join(home, "live", "slack", "progress"),
    reviews: join(home, "live", "slack", "reviews"),
    root: join(home, "live", "slack"),
    supersessionsJsonl: join(home, "live", "slack", "supersessions.jsonl"),
    placementsJsonl: join(home, "live", "slack", "placements.jsonl"),
    followupWatermarksJson: join(home, "live", "slack", "followup-watermarks.json"),
    witnessOutcomesJsonl: join(home, "live", "slack", "witness-outcomes.jsonl"),
    witnessStateJson: join(home, "live", "slack", "witness-state.json"),
    fileReads: join(home, "live", "slack", "file-reads"),
    channelMedia: join(home, "live", "slack", "channel-media"),
    threadFiles: join(home, "live", "slack", "thread-files"),
    turnJournal: join(home, "live", "slack", "turn-journal"),
    turnMarkers: join(home, "live", "slack", "turn-markers"),
    workerSessions: join(home, "live", "slack", "worker-sessions"),
  };
}

/**
 * Resolve `live/listener` — how the standing Slack listener is run and watched.
 *
 * Its own function for the same line-count reason as {@link liveBrowserPaths}.
 *
 * @param root the `live/listener` directory itself
 * @returns the listener sub-tree, rooted at `root`
 */
function liveListenerPaths({ root }: { root: string }): LiveStateHomePaths["live"]["listener"] {
  return {
    armJson: join(root, "arm.json"),
    armsJsonl: join(root, "arms.jsonl"),
    connectionsJson: join(root, "connections.json"),
    heartbeatJson: join(root, "heartbeat.json"),
    logsDir: join(root, "logs"),
    queueJsonl: join(root, "queue.jsonl"),
    root,
  };
}

/**
 * Resolve the `live` sub-tree — provider-CURRENT reads, a sibling of the corpus.
 *
 * @param home the Slopweaver home
 * @returns the live sub-tree, rooted at `home`
 */
function liveHomePaths({ home }: { home: string }): LiveStateHomePaths["live"] {
  return {
    browser: liveBrowserPaths({ home }),
    claudeUsageSnapshotsDir: join(home, "live", "claude-usage"),
    codexPassReservationsJson: join(home, "live", "codex-pass-reservations.json"),
    devLintGateSecondsJson: join(home, "live", "dev-lint-gate-seconds.json"),
    planConnectionsDir: join(home, "live", "plan-connections"),
    pollGateDir: join(home, "live", "poll-gate"),
    seatPassDir: join(home, "live", "seat-pass"),
    syncRunsDir: join(home, "live", "sync-runs"),
    consoleSyncFailuresJsonl: join(home, "live", "console-sync-failures.jsonl"),
    events: {
      cursorsDir: join(home, "live", "events", "cursors"),
      root: join(home, "live", "events"),
      streamJsonl: join(home, "live", "events", "stream.jsonl"),
    },
    machine: {
      dispatchesJsonl: join(home, "live", "machine", "dispatches.jsonl"),
      root: join(home, "live", "machine"),
      seriesJsonl: join(home, "live", "machine", "series.jsonl"),
      spawnBackoffJson: join(home, "live", "machine", "spawn-backoff.json"),
    },
    frictionReview: {
      publishedJson: join(home, "live", "friction-review", "published.json"),
      root: join(home, "live", "friction-review"),
    },
    github: liveGithubPaths({ home }),
    gmail: {
      attachments: join(home, "live", "gmail", "attachments"),
      boardDrafts: join(home, "live", "gmail", "board-drafts"),
      cardMail: join(home, "live", "gmail", "card-mail"),
      root: join(home, "live", "gmail"),
      triageCards: join(home, "live", "gmail", "triage-cards"),
      triageJson: join(home, "live", "gmail", "triage.json"),
    },
    outlook: { attachments: join(home, "live", "outlook", "attachments") },
    fathom: { root: join(home, "live", "fathom") },
    chatgpt: { conversations: join(home, "live", "chatgpt", "conversations") },
    hygiene: liveHygienePaths({ root: join(home, "live", "hygiene") }),
    standing: {
      respawnPendingJson: join(home, "live", "standing", "respawn-pending.json"),
      root: join(home, "live", "standing"),
    },
    listener: liveListenerPaths({ root: join(home, "live", "listener") }),
    recipe: recipeHomePaths({ home }),
    root: join(home, "live"),
    vuln: {
      notABumpJson: join(home, "live", "vuln", "not-a-bump.json"),
      reviewersJson: join(home, "live", "vuln", "reviewers.json"),
      root: join(home, "live", "vuln"),
    },
    slack: liveSlackPaths({ home }),
  };
}

/**
 * Resolve the live area under one home. Pure: no I/O.
 *
 * @param home the resolved Slopweaver home
 * @returns the live area's fields, rooted at `home`
 */
export function liveStateHomePaths({ home }: { home: string }): LiveStateHomePaths {
  return {
    live: liveHomePaths({ home }),
  };
}
