/**
 * The sanctioned seams of the corpus and the live lanes: corpus stores and watermarks, the dev-gate read-only tools, shared library file primitives, and the `src/live/**` ask, listen, automation, resync, Slack and turn stores.
 *
 * One part of the sanctioned-seam catalogue: `./sanctionedSeams.ts` spreads it into `SANCTIONED_SEAMS`, which stays
 * the one table `./coverage.ts` reads, so a module is still sanctioned in exactly one place. A new row goes in the
 * part whose theme its module belongs to, and a part nearing 300 code lines splits again.
 */

/** The sanctioned seams of this part, keyed by repo-relative path. */
export const CORPUS_LIVE_SEAMS = {
  "src/config.ts": "read-only-tool",
  "src/corpus/compact.ts": "local-state",
  // `corpusWriter.ts`'s one append to a bronze window file under $SLOPWEAVER_HOME, split out beside it.
  "src/corpus/bronzeAppend.ts": "local-state",
  // Unlinks a dead writer's staged temp beside a canonical bronze file under $SLOPWEAVER_HOME — local state.
  "src/corpus/compactOrphanTemps.ts": "local-state",
  "src/corpus/corpusStore.ts": "local-state",
  "src/corpus/corpusWriter.ts": "local-state",
  // Copies time-bounded bronze from one local home into another. Every byte it writes came off disk on this
  // machine, and it never fetches: the same class as `compact.ts`, one directory over.
  "src/corpus/subsetBuild.ts": "local-state",
  // `subsetBuild.ts`'s kept-line sinks, split out beside it: the same copy into the same local subset home.
  "src/corpus/subsetSink.ts": "local-state",
  // `fathom share`'s removal of the hand-written `share:<token>` rows from fathom bronze under
  // `$SLOPWEAVER_HOME/corpus`: rewrites a file through `writeFileAtomicStream` and unlinks one left with no
  // line, exactly as `compact.ts` above removes a superseded window file. Nothing leaves this machine.
  "src/corpus/fathom/shareBronze.ts": "local-state",
  "src/corpus/github/repoWatermark.ts": "local-state",
  // The owner's ChatGPT export, taken in: `/usr/bin/unzip` lists the zip they downloaded and writes one conversations file
  // into a staging folder `exportStaging.ts` makes under `$SLOPWEAVER_HOME/corpus/exports/chatgpt`, `exportStore.ts`
  // renames that folder into place, and `exportReceipts.ts` writes a receipt beside it. Every byte came off this
  // machine's disk; nothing is fetched and nothing leaves it.
  "src/corpus/chatgpt/archive.ts": "local-state",
  // `audit references`: `git archive` of one commit into a zip under `$SLOPWEAVER_HOME/proof/zero-references`,
  // `/usr/bin/unzip` of it into the run's own temporary directory, a read of every extracted file, and the removal
  // of that directory and of the earlier proof zips. No fetch: the ref is read as this checkout holds it, and
  // nothing leaves the machine.
  "src/hygiene/referenceExport.ts": "local-state",
  // The private-terms lock beside `$SLOPWEAVER_HOME/hygiene/private-terms.tsv`: renames a dead holder's lock aside
  // to compare and remove it. A file under the home only; nothing is fetched and nothing leaves the machine.
  "src/hygiene/privateTermsLock.ts": "local-state",
  "src/corpus/chatgpt/exportReceipts.ts": "local-state",
  "src/corpus/chatgpt/exportStaging.ts": "local-state",
  "src/corpus/chatgpt/exportStore.ts": "local-state",
  // The live copy of the owner's ChatGPT history under `$SLOPWEAVER_HOME/corpus/chatgpt/live`: writes a snapshot
  // atomically and unlinks the body it replaced. Every byte was already read; nothing is fetched and nothing leaves.
  "src/corpus/chatgpt/liveSnapshotWrite.ts": "local-state",
  "src/corpus/history/store.ts": "local-state",
  "src/corpus/members/store.ts": "local-state",
  // The `self` connector's event-time query. Shells `git log --diff-filter=A` to learn when each of the
  // owner's files was FIRST committed, which is the only trustworthy event time on disk (mtime is when the owner last
  // touched a file, not when they thought it). A read-only tool, exactly like the residue scanners: one log
  // read, no writes, and nothing leaves the machine.
  "src/corpus/self/eventTime.ts": "read-only-tool",
  // The `calendar` source's per-calendar delta cursor, under `$SLOPWEAVER_HOME/corpus/watermarks`. Exactly
  // the class of `slack/channelWatermark.ts` beside it and `corpus/watermark.ts` below: a resume cursor
  // this program writes for itself, never a provider write and never anything that leaves the machine.
  "src/corpus/calendar/syncAnchor.ts": "local-state",
  // The `outlook-calendar` source's per-calendar modified-time anchors, beside the Google ones and the same
  // class: a resume cursor this program writes for itself under `corpus/watermarks`, never a provider write.
  "src/corpus/outlookCalendar/syncAnchor.ts": "local-state",
  // A held calendar write, waiting under `$SLOPWEAVER_HOME/calendar/intents` between the preview and the
  // owner's `commit --approve`. This program's own record of what it proposed and what Google reported
  // back; the mutation it describes routes through `safeProviderCall` in `live/calendar/writeApi.ts`.
  "src/live/calendar/intentStore.ts": "local-state",
  "src/corpus/slack/channelWatermark.ts": "local-state",
  "src/corpus/slack/threadCursors.ts": "local-state",
  // Writes only its own slice manifests under `$SLOPWEAVER_HOME/slices` — never bronze, never the network.
  "src/corpus/sliceStore.ts": "local-state",
  // The workstreams ledgers under `$SLOPWEAVER_HOME/workstreams`: the one appender cuts a failed append back to the
  // length it found, removing a ledger only that append created. Never a provider write.
  "src/workstreams/ledgerAppend.ts": "local-state",
  // Makes `$SLOPWEAVER_HOME/workstreams` for a proposal made before any mine has written the candidates there.
  "src/workstreams/proposalStore.ts": "local-state",
  // The tombstone at `$SLOPWEAVER_HOME/workstreams/register.json`: one owner-only directory and its `RETIRED` marker,
  // so a build from before the store cannot write the retired file again. Never a provider write.
  "src/workstreams/store/retiredRegisterSeams.ts": "local-state",
  "src/corpus/structures/store.ts": "local-state",
  "src/corpus/watermark.ts": "local-state",
  // Image read-back records under `$SLOPWEAVER_HOME/visual-evidence/records`, appended one line per look.
  // Local state by construction: the whole point of the store is that it is consulted BEFORE an outbound
  // send, so it can never itself be the thing going out.
  "src/visualEvidence/store.ts": "local-state",
  // Capture records under `$SLOPWEAVER_HOME/visual-evidence/captures`, one document per `browser shot`
  // evidence capture, linked from the image record above by captureId. Local state for the same reason.
  "src/visualEvidence/captureRecord.ts": "local-state",
  // macOS Vision through `osascript`, reading a picture's text on this machine before `github attach` sends it:
  // the bytes go to an owner-only temp file it removes, and no byte or model call leaves the machine.
  "src/visualEvidence/imageTextRecognition.ts": "read-only-tool",
  "src/devGate/devGate.ts": "local-state",
  "src/devLint/boundaryResidue.ts": "read-only-tool",
  "src/devLint/controlBytes.ts": "read-only-tool",
  "src/devLint/maxFunctionLines.ts": "read-only-tool",
  // The no-headless gate. Shells `git ls-files` to enumerate the working tree and reads them; it starts no
  // process at all, which is the property it exists to enforce on everyone else.
  //
  // It is listed here because this scanner matches TEXT, and a gate against starting processes necessarily
  // WRITES the forbidden shapes down: its rule documentation shows a member-call counterexample and quotes an
  // English sentence from the code it polices, and both read as calls to a regex. A gate flagging another
  // gate's comments is the same class of defect as one flagging the doctrine prose that describes it, and the
  // remedy is the same — record it once, here, rather than contorting the documentation to hide from a scan.
  //
  // This very comment is written to avoid naming those shapes literally, because doing so flagged THIS file
  // on the first attempt. That is the trap in miniature, and it is why the entry is worth its length.
  "src/devLint/noHeadless.ts": "read-only-tool",
  // Its capability rules, split out along that seam: the same pattern text, for the same reason.
  "src/devLint/noHeadlessCapability.ts": "read-only-tool",
  // PR5.2.1b's operation-label gate. Shells `git ls-files` to enumerate the working tree, exactly as the
  // residue scanners around it do — a read-only tool, never a write.
  "src/devLint/operationLabels.ts": "read-only-tool",
  "src/devLint/resilienceResidue.ts": "read-only-tool",
  // PR5.2's scheduler-bypass gate. Shells `git ls-files` to enumerate the working tree, exactly as the two
  // residue scanners above it do — a read-only tool, never a write.
  "src/devLint/schedulerBypass.ts": "read-only-tool",
  // The secrets-registry gate's branch attribution. Shells `git rev-parse`, `log -S`, `for-each-ref` and `show`
  // to name which unlanded branch declares a stray store file — reads only, never a ref or tree write.
  "src/devLint/secretsRegistryGit.ts": "read-only-tool",
  // The unbounded-spread gate. Shells `git ls-files` to enumerate the working tree, exactly as every residue
  // scanner above it does — a read-only tool, never a write.
  "src/devLint/unboundedSpread.ts": "read-only-tool",
  "src/gold/distilCache.ts": "local-state",
  "src/handover/evaluate.ts": "read-only-tool",
  "src/handover/hookShell.ts": "read-only-tool",
  "src/handover/runStore.ts": "local-state",
  // The wake journal's writer: the reseats `handover wake` attempted and how each ended, appended under
  // `$SLOPWEAVER_HOME/ledgers`. Same class as `runStore.ts` directly above — it records a reseat, never performs one.
  "src/handover/wakeJournalStore.ts": "local-state",
  "src/hygiene/scan.ts": "read-only-tool",
  "src/init/stateInit.ts": "local-state",
  // The private judgement/voice profile and its mining checkpoint. Writes only under
  // `$SLOPWEAVER_HOME/judgement` (0700/0600) — nothing here reaches an external provider, so there is no
  // door to route through, the same reasoning as `live/turn/briefStore.ts` above.
  "src/judgement/miningStore.ts": "local-state",
  "src/lib/gitRepo.ts": "read-only-tool",
  // The onboarding self-evaluation's report history + filed board docs. Writes only under a local eval home
  // (`~/.slopweaver` by default, or an explicit `--eval-home`) — deliberately NOT `slopweaverHome()`, since an
  // evaluation run's own `$SLOPWEAVER_HOME` is a throwaway exercise home (see the module header). No external
  // provider is ever reached from here.
  "src/onboardEval/historyStore.ts": "local-state",
  "src/lib/jsonFile.ts": "local-state",
  // The concurrent-whole-corpus-load guard's lanes. Each in-flight load holds one lane of a machine-wide directory
  // under the OS temp dir, taken and given back by renaming one empty marker file. Nothing here names a provider or
  // leaves the machine — it is process bookkeeping about this laptop's memory, so there is no door to route through.
  "src/lib/loadSlotLanes.ts": "local-state",
  // The load slots' holder identity: a signal-0 probe and one local `/bin/ps` read of a pid's state and start
  // time, so a slot whose pid was reused reads dead. It reads this laptop's process table and nothing else.
  "src/lib/processIdentity.ts": "local-state",
  // The repo's one atomic, crash-durable file replace — the temp-file / fsync / rename / fsync-the-directory
  // primitive twenty-odd local stores used to hand-roll. It writes exactly the path its caller names and
  // reaches nothing else; every caller is itself a `local-state` store, so routing them here concentrated
  // those seams rather than adding any.
  "src/lib/writeAtomic.ts": "local-state",
  // The repo's one line-oriented append, which starts a record on a fresh line after a torn tail. Like
  // `writeAtomic.ts` it writes exactly the path its caller names, and every caller is itself a `local-state`
  // store, so routing every append here concentrated those seams rather than adding any.
  "src/lib/appendSeparator.ts": "local-state",
  // The permanent ignore registry: fsync'd JSONL under `$SLOPWEAVER_HOME/live/slack/ignored-asks.jsonl`.
  // Local bookkeeping only — nothing here ever reaches Slack, GitHub or Linear, so there is no door to route
  // through.
  "src/live/ask/ignoreStore.ts": "local-state",
  // The channel-keyed sibling: fsync'd JSONL under `$SLOPWEAVER_HOME/live/slack/ignored-conversations.jsonl`.
  // Same reasoning as `ignoreStore.ts` immediately above.
  "src/live/ask/ignoredConversationStore.ts": "local-state",
  // The ask-lifecycle log: fsync'd JSONL under `$SLOPWEAVER_HOME/live/slack/asks.jsonl`, recording what
  // already happened to a real Slack tag. Same reasoning as `briefStore.ts`/`completionStore.ts` below — the
  // external write it records (the answer itself) already went through the door before this ever appends.
  "src/live/ask/store.ts": "local-state",
  // `listen`'s `--queue` durability writer: an ordinary file at a path the CALLER chose, not this program.
  // Local state, never a network seam — the whole point of the queue is that it survives without Slack or
  // any door at all, which is exactly why nothing here is routed through one.
  // The SHARED OAuth consent flow's ONE seam — Gmail's, Drive's and Outlook's alike: a blocking exec of the
  // platform opener, handing the owner's own browser a consent page, beside the one-request loopback listener
  // the redirect lands on. It drives a LOCAL application and reaches no provider — the same class as
  // `proof/yarnWhy/vhsExec.ts` below, which drives `vhs`. The credential the consent then yields is written by
  // `secrets/grantFile.ts`, sanctioned separately; the API calls it authorises route through
  // `safeProviderCall` in `live/gmail/api.ts`, `live/drive/api.ts` and `live/outlook/api*.ts`, which is where
  // the external read actually happens.
  "src/live/oauth/loopback.ts": "local-state",
  // `gmail attachment`'s own writer, the same class as `live/slack/fileDownloads.ts`: a READ verb with nothing
  // changed in the mailbox, creating and `lstat`-checking one directory under
  // `$SLOPWEAVER_HOME/live/gmail/attachments` (0700) for the atomic 0600 write. The Gmail call itself routes
  // through `safeProviderCall` in `live/gmail/api.ts`.
  "src/live/gmail/attachmentSave.ts": "local-state",
  // The mail a triage card pinned, kept beside the pin for the Queue to draw: one 0600 file per card under
  // `$SLOPWEAVER_HOME/live/gmail/card-mail` (0700), written atomically and REMOVED when the pin it was captured for
  // could not be written. Nothing in the mailbox changes; the Gmail reads route through `safeProviderCall` in
  // `live/gmail/api.ts`.
  "src/live/gmail/cardMail.ts": "local-state",
  "src/live/listen/queueFile.ts": "local-state",
  // The supervised listener's own durable state: the arm record, the heartbeat file and the append-only arm
  // journal, all under $SLOPWEAVER_HOME/live/listener. Exactly the class of `queueFile.ts` above and
  // `recoverScheduleStore.ts` below — nothing here reaches Slack, GitHub or Linear.
  "src/live/listen/supervise/store.ts": "local-state",
  // The SUPERVISOR STREAM and its named cursors: one append-only JSONL file and one JSON file per reader,
  // both under `$SLOPWEAVER_HOME/live/events`. Exactly the class of `supervise/store.ts` above — a
  // notification a local session reads, never a Slack/GitHub/Linear write, so there is no door to route
  // through. See `docs/supervisor-events.md`.
  "src/events/store.ts": "local-state",
  // The ANOMALOUS-LOAD dispatch register: one append-only JSONL file under `$SLOPWEAVER_HOME/live/machine`,
  // written with the same mkdir-plus-append pair as `events/store.ts` directly above and for the same
  // reason. A finding row about this machine's own load is read by the supervisor gate and the capacity
  // verb on this device, never written to a provider, so there is no door to route through. See
  // `skills/supervisor/reference/load-dispatch.md`.
  "src/live/machine/dispatchStore.ts": "local-state",
  "src/events/cursor.ts": "local-state",
  // Starts the detached `slopweaver listen --follow --queue` process the supervisor watches. Same class as
  // `cmux/client.ts` above, which likewise starts a LOCAL process (a terminal multiplexer) rather than
  // writing to a provider: the listener it launches routes its own Slack writes through the door itself, so
  // arming one performs no external write. See `docs/listener-supervision/runtime-and-watching.md`.
  "src/live/listen/supervise/arm.ts": "local-state",
  // The scheduled recovery sweep's durable cadence state: one JSON file (temp-file-plus-rename) under
  // `$SLOPWEAVER_HOME/live/slack/recovery-sweep.json`. Local bookkeeping only — a watermark, a next-due
  // instant, and (schema V2 on) recovery's own per-thread checkpoint inventory, never a Slack/GitHub/Linear
  // write, so there is no door to route through.
  "src/live/listen/recoverScheduleStore.ts": "local-state",
  // The one real write path for `responders.json` (`slopweaver responders add`/`remove`) — atomic
  // temp-file-plus-rename, entirely under `$SLOPWEAVER_HOME`. Never an external write itself: the effect it
  // eventually unlocks is a Slack reply, which still goes through the door in the ordinary way when it sends.
  "src/live/listen/whitelistWrite.ts": "local-state",
  // The exactly-once slot ledger: one small JSON row per cadence firing under
  // $SLOPWEAVER_HOME/live/recipe/slot-attempts, saying who took that firing and how it ended. Local state
  // that decides whether an external write may happen at all — never an external write itself.
  "src/live/automation/slotLedger.ts": "local-state",
  // The repairs register: one appended line per seat taking a stopped recipe's repair, under
  // `$SLOPWEAVER_HOME/live/recipe/repairs.jsonl`, which the recipe-stopped and recipe-repairing monitors read.
  // Local machine state exclusively — it reaches no provider, and nothing it records is sent anywhere.
  "src/live/automation/repairTake.ts": "local-state",
  // The finding debt: one `<finding>.json` per failed firing whose finding did not land, under
  // `$SLOPWEAVER_HOME/live/recipe/finding-debt`, written and removed once the board holds the row. Local machine
  // state exclusively — the `handover register` it replays is its own verb, and nothing it records is sent anywhere.
  "src/live/automation/findingDebt.ts": "local-state",
  // The failure-explanations register: one appended line per failed firing a visible session explained with
  // `automation explain`, under `$SLOPWEAVER_HOME/live/recipe/failure-explanations.jsonl`, which the Automations
  // page reads. Local machine state exclusively — it reaches no provider, and nothing it records is sent anywhere.
  "src/live/automation/failureExplanation.ts": "local-state",
  // The standing-row writer: `<recipeId>.json` under `$SLOPWEAVER_HOME/live/recipe/definitions`, the same
  // directory `live/resync/registrationStore.ts` below already writes and `definitionStore.ts` reads. It is
  // narrower than either — create-if-absent only, no update, no retire, no `rmSync` — and it REFUSES any
  // path it cannot prove empty rather than writing over somebody's file. Local machine state exclusively:
  // it reaches no provider, and the verb a row it writes eventually runs has its own door.
  "src/live/automation/standingRowStore.ts": "local-state",
  // `automation retire`: the one `rmSync` of a canonical `<recipeId>.json` under
  // `$SLOPWEAVER_HOME/live/recipe/definitions`, made only AFTER the retirement registry beside it records the row
  // retired, under the definition hold lock. Local machine state exclusively — it reaches no provider.
  "src/cli/commands/automation/retire.ts": "local-state",
  // `automation enable|disable`: the switch journal, one appended line per row switched under
  // `$SLOPWEAVER_HOME/live/recipe/switches.jsonl`, and the one-key `enabled` write of a canonical `<recipeId>.json`
  // through `writeAtomic.ts`. Local machine state exclusively — it reaches no provider, and a row it turns on runs
  // its own verb through that verb's own door.
  "src/live/automation/rowSwitchStore.ts": "local-state",
  // `automation repoint`: one atomic rewrite of a canonical `<recipeId>.json` under
  // `$SLOPWEAVER_HOME/live/recipe/definitions` whose one `--repo` drifted, every other field kept, made only AFTER the
  // own-repository history beside it records the new address, under the definition hold lock. Local machine state
  // exclusively — it reaches no provider, and the verb the row runs has its own door.
  "src/cli/commands/automation/repoint.ts": "local-state",
  // `automation run-due`'s verb child: one `spawn` of THIS SAME CLI (`process.execPath`, its own exec arguments and
  // entry script) with a due row's already-planned verb argv, so the verb runs with default signal disposition.
  // The child passes `cli/main.ts` exactly as a typed invocation does, its own door and ruling gate included; this
  // seam writes nothing and reaches no provider itself.
  "src/cli/commands/automation/runDueVerbProcess.ts": "local-state",
  // The resync outcome record: one `<recipeId>.json` per scheduled target under
  // `$SLOPWEAVER_HOME/live/recipe/resync-state`, holding that target's last attempt, its last SUCCESS and
  // any recorded blocker. Local machine state exclusively — it reaches no provider, and the syncs it
  // describes each route through their own verbs and their own doors.
  "src/live/resync/outcomeStore.ts": "local-state",
  // The sync-run ledger: one append-only `<start>-<runId>.jsonl` per refresh run per source under
  // `$SLOPWEAVER_HOME/live/sync-runs/<source>/`, recording what the run started on, its progress, what each bronze
  // commit wrote per container, and how it finished. Local machine state exclusively — the sync it describes
  // reached its provider through its own connector, and these rows reach nothing.
  "src/syncRun/store.ts": "local-state",
  // The corpus-propagation store: one record per successful corpus sync, the one open judgement pass
  // (`batch.json`), and each retired pass, under `$SLOPWEAVER_HOME/live/recipe/propagation`. The `renameSync`
  // retires a confirmed batch into `batches/`. Local machine state exclusively — the landing reading it
  // receipts went through its own verb, and the pass it records seats through `cmux spawn`.
  "src/live/resync/propagationStore.ts": "local-state",
  // The scheduled-resync definition writer: `<recipeId>.json` files and one ownership record under
  // `$SLOPWEAVER_HOME/live/recipe`, the same directory `live/automation/definitionStore.ts` already reads. The
  // `rmSync` retires a row this registrar itself recorded writing and nothing else — a managed-looking row
  // it did not write is reported as a conflict rather than removed, which is `registrationPlan.ts`'s rule.
  "src/live/resync/registrationStore.ts": "local-state",
  // `slack channel-view`'s picture cache: a READ verb's writer, same class as `read-thread`'s below. It keeps
  // Slack's own preview renditions, content-addressed, under `$SLOPWEAVER_HOME/live/slack/channel-media`
  // (0700/0600) for the console's channel window to serve by hash; nothing goes out to Slack.
  "src/live/slack/channelMedia.ts": "local-state",
  "src/live/slack/download.ts": "local-state",
  "src/live/slack/fileDownloads.ts": "local-state",
  // `slack read-file`'s own writer, same class and same reasoning as the two above: a READ verb with
  // nothing going out to Slack, writing only under `$SLOPWEAVER_HOME/live/slack/file-reads` (0700/0600).
  // A separate directory from `thread-files` because a `read-file` body can be a huddle transcript — see
  // `stateHome.ts` for why that lane stays addressable on its own.
  "src/live/slack/readFile.ts": "local-state",
  // `slack read-thread`'s attachment writers. A READ verb: nothing goes out to Slack, so there is no door
  // to route through. They write only under `$SLOPWEAVER_HOME/live/slack/thread-files` (0700/0600), and
  // never into the corpus — `refresh` remains bronze's only writer.
  // The BRIEF store — the one writer for the artifact a tag becomes. Writes only under
  // `$SLOPWEAVER_HOME/briefs`; the external write it feeds is `turn answer`'s Slack post, which goes through
  // the door in the ordinary way.
  "src/live/turn/briefStore.ts": "local-state",
  // The review store: one directory per ask under `$SLOPWEAVER_HOME/live/slack/reviews` holding the
  // reviewer's locator, the packet code composed for it, and where its verdict lands. Local files only — the
  // reviewer session reads them, and the external write the verdict licenses (the answer) goes through the
  // door in `turn answer`. Same reasoning as `briefStore.ts` above.
  "src/live/turn/reviewStore.ts": "local-state",
  // The turn-completion ledger. Writes only under `$SLOPWEAVER_HOME/ledgers` (0700/0600); the external write
  // it durably records — the Slack answer/notice — already went through the door in `poster.ts` before this
  // ever appends, same reasoning as `briefStore.ts` and `queueStore.ts` above.
  "src/live/turn/completionStore.ts": "local-state",
  // The supersession journal — one row per correction that declared it replaced an earlier answer, and what
  // became of the delete. Appends only under `$SLOPWEAVER_HOME/live/slack/supersessions.jsonl` (0700/0600)
  // and reaches no provider: the Slack DELETE a row records is made by `./deleteOwnedMessage.ts` through the
  // door, and this file is what makes that irreversible act auditable afterwards. Same class and same
  // reasoning as `completionStore.ts` above — it RECORDS an external write, it never performs one.
  "src/live/turn/supersession/store.ts": "local-state",
  // The fresh-visible-session dispatch-record store. Writes only under
  // `$SLOPWEAVER_HOME/live/slack/dispatches` (0700/0600), atomically (temp file + rename) — an address and
  // request facts, never a Slack effect of its own; the external write it eventually feeds is `turn
  // answer`'s post, which goes through the door in the ordinary way.
  "src/live/turn/dispatchStore.ts": "local-state",
  // Appends one turn's own progress log under `$SLOPWEAVER_HOME/live/slack/progress` — the stages the worker
  // declared and every card write that landed. Writes nothing outside the home and reaches no provider; the
  // Slack edits the log RECORDS are made by `turn status`/`turn watch`/the sweep, each routed through the
  // door in the usual way.
  "src/live/turn/progressLog.ts": "local-state",
  // The turn journal — every edit to an answer a reviewer had already been given, with the reason its author
  // stated. Appends only under `$SLOPWEAVER_HOME/live/slack/turn-journal`, reaches
  // no provider, and is read only by this program's own refusals and tests. Same class and same
  // reasoning as `progressLog.ts` directly above; unlike that file it never even RECORDS an external write.
  "src/live/turn/turnJournalStore.ts": "local-state",
  // Writes one turn's validated DRAFTS under `$SLOPWEAVER_HOME/live/slack/checkpoints` — the answer bytes a
  // worker got past validate, and the append-only log that orders them. Writes nothing outside the home and
  // reaches no provider: what it holds is the material a later session on the same ask reads back so a
  // dropped connection costs a retry rather than the whole investigation. The answer it eventually posts
  // goes through the door in the ordinary way.
  "src/live/turn/checkpointStore.ts": "local-state",
  // The browser-door guard's VERDICT journal: `$SLOPWEAVER_HOME/ledgers/browser-verdicts.jsonl`, one line per
  // refused `mcp__claude-in-chrome__*` call. A PreToolUse hook is a fresh process every call, so what it
  // decided has to be written down to exist at all. Reaches no provider; the call it records is refused.
  "src/admit/browserVerdictJournal.ts": "local-state",
  // The poll gate's memory: when each target (a log, a pid, a task) was last polled, and a file's change token
  // then, one file per Claude Code session under `$SLOPWEAVER_HOME/live/poll-gate`. Same class and same reason as
  // `browserVerdictJournal.ts` directly above — a PreToolUse hook is a fresh process every call, so the 60-second
  // window and the token it is compared against have to live on disk.
  "src/admit/pollGateStore.ts": "local-state",
  // The private judgement/voice profile writer. Writes only under `$SLOPWEAVER_HOME/judgement` (0700/0600),
  // never to an external provider — same reasoning as `briefStore.ts` immediately above.
  "src/live/turn/judgementProfileStore.ts": "local-state",
  // The always-loaded context's last-known-good cache: one file at `$SLOPWEAVER_HOME/profile/context.json`,
  // written after every successful store read so a session start still gets the owner's profile when the local
  // Supabase stack is down. Same class and same reasoning as `judgementProfileStore.ts` directly above —
  // it is a DERIVED projection of rows the store owns, nothing edits it, and it reaches no provider. The
  // directory creation lives with the write rather than in the calling verb so one module owns the seam.
  "src/context/cache.ts": "local-state",
  // The profile load ledger: one append-only file at `$SLOPWEAVER_HOME/profile/loads.jsonl` (0700/0600), a
  // row per load attempt that the door's own profile-load gate and the `profile-unloaded` monitor read back.
  // Same class as `cache.ts` directly above: local state beside it, reaching no provider.
  "src/context/loadLedgerStore.ts": "local-state",
  // The profile delivery markers: one file per context at `$SLOPWEAVER_HOME/profile/delivered/` (0700/0600), written
  // after the owner's profile was printed into it and removed when a compaction voids it. Same class as the ledger above.
  "src/context/profileDelivery.ts": "local-state",
  // The first-boot session marks at `$SLOPWEAVER_HOME/profile/first-boot/<session id>`, and the owner-written mark at
  // `$SLOPWEAVER_HOME/profile/owner-written`: empty or fingerprint-only files beside the delivery markers, which the
  // profile hold and the door's profile-load gate read back. Same class as the two above, reaching no provider.
  "src/admit/firstBootSession.ts": "local-state",
  "src/admit/ownerProfileWritten.ts": "local-state",
  // The durable turn-marker store — `turn resume`'s completion signal, persisted so a poller isn't blind
  // whenever a host TUI collapses the stdout line the marker rode in on. Writes only under
  // `$SLOPWEAVER_HOME/live/slack/turn-markers` (0700/0600), atomically (temp file + rename), same reasoning
  // as `dispatchStore.ts` above: no Slack effect of its own, the eventual external write is `turn answer`'s
  // post, which goes through the door in the ordinary way.
  "src/live/turn/turnMarkerStore.ts": "local-state",
} as const satisfies Readonly<Record<string, "door-internal" | "local-state" | "read-only-tool">>;
