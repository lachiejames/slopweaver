/**
 * The sanctioned seams of day-to-day operation: outbound provider ledgers, proof and Datadog scratch, the review, hand, incident, monitor, knowledge, secrets, hatch, session, supervisor and talk stores, and the environment probe.
 *
 * One part of the sanctioned-seam catalogue: `./sanctionedSeams.ts` spreads it into `SANCTIONED_SEAMS`, which stays
 * the one table `./coverage.ts` reads, so a module is still sanctioned in exactly one place. A new row goes in the
 * part whose theme its module belongs to, and a part nearing 300 code lines splits again.
 */

/** The sanctioned seams of this part, keyed by repo-relative path. */
export const OPERATIONAL_SEAMS = {
  // Reads git and `gh` to answer "what is actually true of this workstream" — rev-list, status, ls-remote,
  // `gh pr view`. Every one is a read; nothing here writes.
  "src/measurement/measure.ts": "read-only-tool",
  // The merge guard's docs-budget sweep: `git ls-tree`/`git show`/`git merge-tree` (via `probeSweep.ts`'s own
  // sanctioned primitives) against two LOCAL refs, to read the always-on docs and every skill body AS OF the
  // tree a merge would produce. A read-only tool, exactly like `probeSweep.ts` below, whose merge-tree
  // machinery this reuses rather than re-implementing.
  "src/outbound/github/docsBudgetSweep.ts": "read-only-tool",
  // The merge guard's diff measurement: `git diff`/`git log`/`git merge-base` against two LOCAL refs. A
  // read-only tool, exactly like `src/codex/gitRun.ts` above — it fetches nothing and writes nothing.
  "src/outbound/github/mergeFacts.ts": "read-only-tool",
  // The MERGE HOLD document: which pull request owns a repository's merge queue, entirely under
  // $SLOPWEAVER_HOME/live/github. Local state only — the hold refuses `github merge` and mutates nothing
  // outside the machine; the merge it gates still goes through the door in the ordinary way.
  "src/outbound/github/mergeHoldStore.ts": "local-state",
  // The MERGE HOLD's append-only journal: one held/released/stale row per transition, entirely under
  // $SLOPWEAVER_HOME/live/github. Local state only, and a strictly narrower claim than the document beside
  // it — it is a RECORD of holds that already happened, so it refuses nothing and gates nothing at all.
  "src/outbound/github/holdLedgerStore.ts": "local-state",
  // The GitHub pull-request ledger: one record per reserved branch locus, entirely under
  // $SLOPWEAVER_HOME/ledgers/github-prs. It is LOCAL STATE, not an external write — the write it guards
  // goes through the door in src/cli/commands/github/performCreate.ts's `performCreate`, and the reservation
  // is taken inside that door's `perform` so a refusal cannot leave a claimed locus behind.
  "src/outbound/github/prLedger.ts": "local-state",
  // The merge guard's board sweep: `git show`/`git cat-file -e`/`git rev-parse --verify` against two LOCAL
  // refs, to read a doc's probe targets AS OF a ref without checking anything out. A read-only tool, exactly
  // like `src/handover/evaluate.ts` above, whose live-tree equivalent this mirrors.
  "src/outbound/github/probeSweep.ts": "read-only-tool",
  // Inline self-review ownership and in-flight reservations, entirely under
  // $SLOPWEAVER_HOME/ledgers/github-self-reviews. Local state only: provider mutations still route through
  // the door, and this ledger prevents an ambiguous retry from duplicating a review or resolving human work.
  "src/outbound/github/selfReviewLedger.ts": "local-state",
  // The local stack-membership ledger: one record per PR registered via `stack push`/`stack adopt`, entirely
  // under $SLOPWEAVER_HOME/ledgers/github-stack-members. Local state `stack sync`'s discovery reads from,
  // never an external write itself.
  "src/outbound/github/stackLedger.ts": "local-state",
  // The checks-read register: one append-only JSONL at $SLOPWEAVER_HOME/ledgers/pr-checks-read.jsonl
  // (0700/0600) recording that a pull request was raised and that its checks were later read once. Local
  // state only — the raise it records already went through the door in `stack push`, and the read that
  // discharges it already went through the door in `github checks`; this file reaches no provider at all.
  "src/outbound/github/checksReadLedger.ts": "local-state",
  // The WALKTHROUGH-THREAD register (0700/0600): which of the owner's review threads a landing resolved and which it
  // reopened. Local state only — the resolve and reopen it records already went through the door in
  // `github thread`; this file reaches no provider at all.
  "src/outbound/github/walkthroughLedger.ts": "local-state",
  // A pull-request description's review packet under $SLOPWEAVER_HOME/pr-description-reviews/preparations/<id>/: the
  // rules, change set, images, evidence and description written as files, two local `git` commits, and the whole
  // directory removed if building it fails. Local state only, exactly like `src/pages/reviewRepo.ts`; the review is
  // the `codex` SDK's own egress, and the description reaches GitHub only through the write verbs' door.
  "src/outbound/github/descriptionReviewPacket.ts": "local-state",
  // The write verbs' review check: when a description has no receipt, the exact body and its image list are written
  // under $SLOPWEAVER_HOME/pr-description-reviews/pending/ for `review-prepare` to read. Local state only; nothing
  // is sent, because the refusal that prints these paths is what stops the send.
  "src/cli/commands/github/descriptionReviewCheck.ts": "local-state",
  // One upload receipt under $SLOPWEAVER_HOME/visual-evidence/uploads, written atomically AFTER `github attach`'s
  // door-routed upload. Local state only: the receipt records what was sent, and reaches no provider itself.
  "src/outbound/github/attachReceipt.ts": "local-state",
  // The POLL record — a $SLOPWEAVER_HOME writer, exactly like the two stores around it. It is load-bearing
  // rather than incidental: a poll carries no Slack metadata, so this record is the only place the
  // emoji→option ballot exists, which is why the send is refused when this write fails.
  // The Linear issue OWNERSHIP ledger — a $SLOPWEAVER_HOME writer, exactly like the send reservation. It is
  // load-bearing rather than incidental: a personal API key attributes every write to the human, so this
  // record is the ONLY evidence that slopweaver created an issue, and `update` refuses without it.
  "src/outbound/linear/issueLedger.ts": "local-state",
  // The Linear project + milestone ledgers — a $SLOPWEAVER_HOME writer, same reasoning and same class as
  // `issueLedger.ts` right above: a personal API key attributes every write to the human, so this record is
  // the ONLY evidence slopweaver created a project or milestone, and `project update` refuses without it.
  "src/outbound/linear/projectLedger.ts": "local-state",
  // The Linear comment + relation ledgers — same class again. A comment and a relation are APPEND-shaped, so
  // what this record prevents is not a lost edit but a DUPLICATE: the same finding posted twice, or the same
  // edge asserted twice, after a lost response. The provider mutation itself still routes through the door.
  "src/outbound/linear/commentLedger.ts": "local-state",
  // The Linear document ledger — same class as `issueLedger.ts`: the ONLY evidence slopweaver created a
  // document, plus the stored-content digest `document update` checks before it replaces a page.
  "src/outbound/linear/documentLedger.ts": "local-state",
  // The release of a create reservation the ledgers above took, when the mutation was refused before the wire —
  // the same $SLOPWEAVER_HOME records, same class. It renames the record aside, deletes only its own unconfirmed
  // reservation, and links anything else back; it reaches no provider.
  "src/outbound/linear/reservationRelease.ts": "local-state",
  // The Linear workflow-state CATALOG — what `linear states` last read for a team, under
  // $SLOPWEAVER_HOME/ledgers/linear-states. Local state, and the authority the issue write gate consults: a
  // `stateId` with no entry here is refused rather than sent, because bronze stores a fraction of these
  // UUIDs mangled and a mangled id still looks like an id.
  "src/outbound/linear/stateCatalog.ts": "local-state",
  // `linear briefing build` — writes one end-of-day briefing's bundle under --out
  // ($SLOPWEAVER_HOME/linear-briefing/<date>) and removes the numbered forms an earlier build of the SAME bundle
  // wrote that this one no longer proposes. It reaches no provider: every Linear write it proposes is sent later,
  // only on the owner's yes, by its own door-routed `linear` verb.
  "src/cli/commands/linear/briefingRun.ts": "local-state",
  "src/outbound/slack/pollStore.ts": "local-state",
  "src/outbound/slack/sendReservationSlot.ts": "local-state",
  // The high-stakes channel claims under $SLOPWEAVER_HOME/ledgers/high-stakes-claims: one file per live send,
  // written before that send reads the channel's day so two concurrent sends cannot both pass. Local state
  // consulted by the gate; the post itself still routes through the door.
  "src/outbound/slack/highStakesClaim.ts": "local-state",
  // `proof yarn-why`'s own effectful shell: drives `vhs` over a local scratch temp dir it then cleans up.
  // Same class as `cmux/client.ts` above — a local dev-environment tool, never a Slack/GitHub/Linear
  // provider write.
  "src/proof/yarnWhy/orchestrate.ts": "local-state",
  // A metrics producer's launch: one bounded `execFileSync` of the command the selected home's profile
  // declares, in the checkout it declares, with only its declared secrets in the environment. What the
  // producer reads is its own business; the points it prints reach Datadog only through `datadog submit`,
  // which IS door-routed. Same class as `runYarnWhy.ts` below: a local run of a tool on this machine.
  "src/datadog/metricsProducerRun.ts": "local-state",
  // `datadog produce` writes the directory and the one `--out` payload file the caller named, through the
  // writer below. Local disk only — the submission it prepares is a separate, door-routed verb.
  "src/cli/commands/datadog/produceRun.ts": "local-state",
  // The `--out` payload writer `datadog produce` uses: one directory and one file the caller named. Local disk
  // only, for the same reason.
  "src/datadog/seriesPayloadFile.ts": "local-state",
  // Runs `yarn why <dependency>` directly (outside any recording) to get its plain-text tree output. A
  // local read of the workspace's own dependency graph, same class as `vhsExec.ts` beside it.
  "src/proof/yarnWhy/runYarnWhy.ts": "local-state",
  // The real `vhs` driver behind `proof yarn-why`. Writes a tape and records a pty that `ttyd` serves on
  // loopback — no window, and never a Slack/GitHub/Linear provider, same class as `cmux/client.ts` above,
  // which this was modelled on.
  "src/proof/yarnWhy/vhsExec.ts": "local-state",
  // `proof cassette`'s render: clears the `--out` .mp4 it is about to write and a scratch temp dir holding the
  // tape, around one `vhs` run. Local disk only, same class as `orchestrate.ts` above.
  "src/cli/commands/proof/cassette.ts": "local-state",
  // The cassette's finish: one local `ffmpeg` copy that drops the rendered .mp4's container metadata, renamed over
  // the original (the partial copy removed on failure), then one `ffprobe` read of its frame size. Local disk and
  // local tools only, same class as `cassette.ts` above.
  "src/proof/cassette/finalise.ts": "local-state",
  // `codex plugin-sync`: `git archive` of the main checkout's own HEAD into the cache root's `codex-plugin`,
  // a lock and a staged rename there, the personal Codex marketplace's source symlink under the user's home,
  // and `codex plugin add`, which copies that export into the local Codex cache. Every write is a file on
  // this machine; no provider is reached, same class as `checkout/syncRun.ts`.
  "src/codexPlugin/sync.ts": "local-state",
  // `sync.ts`'s effect half: a local `tar` extract of the export and its staged rename under the cache root's
  // `codex-plugin`, the personal marketplace's source symlink under the user's home, and `codex plugin add` into
  // each Codex home on this machine. Local files and local CLIs only; no provider is reached, same class as `sync.ts`.
  "src/codexPlugin/syncEffects.ts": "local-state",
  // The personal Codex marketplace file under the user's home: created, or appended to, by one atomic write
  // after a byte-for-byte re-read. A file on this machine; no provider is reached, same class as `sync.ts`.
  "src/codexPlugin/marketplaceStore.ts": "local-state",
  // `sync.ts`'s read half: `git rev-parse` against the local checkout, to learn its HEAD and branch. Reads a
  // repository on this machine; no provider is reached.
  "src/codexPlugin/checkout.ts": "local-state",
  // The verb's background half writes its one outcome line to the cache root's `codex-plugin/sync.log`,
  // making that directory first. Local, same as `sync.ts` above; the hook's shell does the backgrounding.
  "src/cli/commands/codex/pluginSyncRun.ts": "local-state",
  // Writes only `$SLOPWEAVER_HOME/capability-profile.json`, never an external provider — same reasoning as
  // `judgementProfileStore.ts` above.
  "src/route/profileStore.ts": "local-state",
  // The browser break-glass journal. An append-only local record of a human decision to lift ONE read-only
  // page's rule for thirty minutes — same class and same treatment as
  // `src/hatch/grantStore.ts`. What the waiver later ADMITS may reach a provider; recording it does not.
  "src/browser/breakGlassStore.ts": "local-state",
  // The profile pin: `$SLOPWEAVER_HOME/chrome-pin.sh`, `0700`, generated from the record above. Bytes under
  // the home and nothing else — it WRITES a launcher and never runs one, and what eventually executes it is
  // `playwrightCli.ts`, already classified. The pin is what stops a browser leg landing in whichever profile
  // Chrome was last used in, so it is a narrowing of an existing effect rather than a new one.
  "src/browser/profilePin.ts": "local-state",
  // The foreground restore: `lsappinfo` and Chrome's own AppleScript dictionary to READ which app and
  // windows are in front, then `open -b` or one hide-and-show of a window (`set visible`) to put back what a walk's
  // window covered. It drives LOCAL applications and reaches no provider — the same class as
  // `live/oauth/loopback.ts` above and `proof/yarnWhy/vhsExec.ts` below. It launches no browser, by
  // construction: `open -b com.google.Chrome` is never issued, so it can only ever reorder windows of a
  // Chrome that is already running. The one thing it changes is which of the owner's windows is in front, and only
  // when the walk's own window took that place a moment earlier (`src/browser/foreground.ts`).
  "src/browser/foreground.ts": "local-state",
  // A monitor card's sign-in page put on the owner's screen: the pin above, backgrounded on ONE url, so the window is
  // already open when the note says to sign in there (`src/monitor/pass.ts`). It reads
  // nothing back and drives nothing on the page — the owner is the only one who acts there — so it reaches no
  // provider as the fleet; it replaces the same pin command the card used to hand over to paste into a terminal.
  "src/browser/openInWorkChrome.ts": "local-state",
  // One interaction session's own record and private client workspace, under
  // `$SLOPWEAVER_HOME/live/browser/sessions/<id>/`. The `rmSync` removes that one directory and only ever a
  // path built from an id this module minted — never a path a caller named. Nothing reaches a provider:
  // WHAT the session then does to a page goes through `actionRun.ts` below, which is door-routed.
  "src/browser/interactionSessionStore.ts": "local-state",
  // The cookie jar read: copies the owner's own Chrome cookie database into a private temp dir, reads it and
  // removes the copy. Nothing lands under the home at all, and no value is ever written or logged. The
  // UPLOAD those cookies then authorise is a separate file (`attachUpload.ts`) and it does route through the
  // door, which is where the external write actually happens.
  "src/browser/cookieJar.ts": "local-state",
  // `github stack restack`'s local replay: the SCRATCH worktree each branch is rebased in. Both `rmSync`
  // calls remove a directory this file made itself with `mkdtempSync` moments earlier — one on the path
  // where `git worktree add` refused, one in the teardown that always follows a successful add — and never
  // a path a caller named. The verb reaches no remote at all; its only outward act is a fetch.
  "src/cli/commands/github/restackExec.ts": "local-state",
  // Creates the screenshot output directory under the home that `notion verify`'s brief names.
  "src/cli/commands/notion/verifyRun.ts": "local-state",
  // `datadog shot`: the shots directory it writes into, and the throwaway scratch directory `shot monitor`
  // makes for the relay and removes on every exit path. Bytes landing under the home or a temp directory,
  // never an external effect. It launches no browser — `shot monitor` reads the console in the owner's own
  // Chrome through browser/datadogMonitorBacktest.ts, classified read-only-tool above — which is why the verb
  // is `external-read` and not door-routed.
  "src/cli/commands/datadog/shotRun.ts": "local-state",
  // `datadog shot`'s write path: the staging file each capture is copied or written to and graded in,
  // removed on a refusal so a bad proof is never left on disk. The commit itself goes through `writeFileAtomicBytes`; these `rmSync` calls
  // only ever remove that verb's own `.partial` file, never a caller's own.
  "src/datadog/shot/write.ts": "local-state",
  // The Datadog shape catalogue's own root, created so `writeFileAtomicStream` and `writeFileAtomic` have a
  // directory to commit into. One `mkdirSync` under `$SLOPWEAVER_HOME/datadog/catalogue`; every byte that
  // lands is written by the atomic module. Nothing external: a catalogue is this install's own observation of
  // one organisation, and `datadog catalogue build` reads Datadog and writes only here.
  "src/datadog/detective/store.ts": "local-state",
  // The Datadog hit cache — the events a verb ALREADY fetched on the caller's own instruction, appended under
  // `$SLOPWEAVER_HOME/datadog/hits.jsonl` so the disclosure ladder's later verbs can address one by id in a
  // different process. It exists because Datadog has no get-by-id route (MEASURED: that path 404s), and it
  // pre-fetches nothing — a local record of a read that already happened, never a provider write.
  "src/datadog/detective/hitsCache.ts": "local-state",
  // The CODERABBIT NUDGE register — one `0600` claim file per head `github landing --press` re-requested a stuck
  // CodeRabbit review on, under `$SLOPWEAVER_HOME`. Same class as the break-glass journal above: a local claim made
  // BEFORE the act so one head is re-requested once. The comment itself goes through the door as
  // `github comment create` (`src/review/codeRabbitNudgeJournal.ts`).
  "src/review/codeRabbitNudgeJournal.ts": "local-state",
  // The REVIEWER register — every review ask `github landing --record-reading` saw, and the owner's approve/decline
  // on a suggested reviewer, appended to `ledgers/reviewers.jsonl` under `$SLOPWEAVER_HOME`. Same class as the
  // break-glass journal above: a local record of what a doored read printed and what the owner decided about it. A pick
  // SENDS NOTHING — asking the person stays the owner's, in Slack (`src/review/reviewerRegisterStore.ts`).
  "src/review/reviewerRegisterStore.ts": "local-state",
  // Writes a Claude fallback request's PACKET — the frozen diff or plan prompt the visible session reads — into
  // a private `mkdtemp` directory under the OS temp root. The request and receipt themselves are store rows
  // (`codex/fallbackPort.ts`). Local scratch only: nothing here reaches a provider, and the repository is never
  // written.
  "src/codex/fallbackPacket.ts": "local-state",
  // The KNOWLEDGE REGISTER — what an investigation learned, appended one line at a time at `0700`/`0600`
  // under `$SLOPWEAVER_HOME/knowledge`. Same class as the break-glass journal above: an append-only local record,
  // never a provider write, and nothing here reaches a network at all. Append-only is load-bearing rather
  // than incidental — a repeated id is the consolidation signal, so a writer that rewrote a row in place
  // would destroy the count that signal is made of (`src/knowledge/types.ts`).
  // The GOLD-DEBT LEDGER — every pull request that merged at silver or bronze and still owes its gold
  // proof, appended one line at a time at `0700`/`0600` under `$SLOPWEAVER_HOME/ledgers`. Same class as
  // the knowledge register above: an append-only local record of something that ALREADY happened elsewhere,
  // never a provider write, and nothing here reaches a network. It is also read by nothing in the landing
  // lane, on purpose — a merge below gold is never delayed by it
  // (`src/__tests__/unit/goldDebt/notAMergeBlocker.test.ts` is the guard).
  "src/goldDebt/store.ts": "local-state",
  // The HAND-STEP REGISTER — the narrow set of steps only the owner's hands can take, appended one line at a time at
  // `0700`/`0600` under `$SLOPWEAVER_HOME/hand-steps`. Same class as the ledgers above: a local record of
  // something waiting on a person, never a provider write, and nothing in the module reaches a network. The
  // register is also the only thing the two macOS surfaces below read.
  "src/hand/store.ts": "local-state",
  // The PUSH LEDGER beside it — one row per pass recording which subjects were outstanding and whether a
  // banner went out, which is the whole of what makes the lane fire on ARRIVAL and never on age. Read and
  // appended in the same directory as the register; the notification itself is `../hand/push/send.ts`, which
  // is argv into `osascript` and holds no seam of its own.
  "src/hand/push/ledger.ts": "local-state",
  // The note's DISMISS MARKERS — the file the owner's Done or snooze press leaves, consumed here and turned into a
  // register row or a snooze record. One `rmSync` of a marker this install wrote, under `$SLOPWEAVER_HOME/hand-steps`.
  "src/hand/reconcile.ts": "local-state",
  // The LATER LEDGER — one file per open step a legacy Later closed, written and removed under
  // `$SLOPWEAVER_HOME/hand-steps/later` at `0700`/`0600`, so that Later outlives the marker the reconcile consumes.
  "src/hand/laterPresses.ts": "local-state",
  // The SNOOZE STORE — one `<id>.json` per open step the owner snoozed, naming when its note comes back, written and
  // removed under `$SLOPWEAVER_HOME/hand-steps/snoozes` at `0700`/`0600`. Local, read by `hand wake`/`list`/`push`.
  "src/hand/snoozeStore.ts": "local-state",
  // The note's KIND-ANSWER PRESSES — `<id>.mute-kind` / `<id>.when-worse` markers the owner's Never for this kind or When
  // it gets worse press leaves under `$SLOPWEAVER_HOME/hand-steps/dismiss`, listed and one `rmSync` once consumed.
  "src/hand/kindAnswers.ts": "local-state",
  // A step's PICTURE — the PNG `hand post --shot` names, stored by its own SHA-256 under
  // `$SLOPWEAVER_HOME/hand-steps/shots` at `0700`/`0600`. The one `rmSync` takes back a blob this same post
  // created when the register then refused the append, so a refused post leaves nothing behind.
  "src/hand/shotStore.ts": "local-state",
  // The incident CLAIM — one `<channelId>` file under `$SLOPWEAVER_HOME/incidents/claims`, created `wx` at
  // `0600` before a sweep probes or registers, and unlinked when that sweep registers nothing or the claim is
  // stale. Local exclusion between overlapping sweeps, never a provider write.
  "src/incident/claim.ts": "local-state",
  // The incident SEEN ledger — one JSON line appended per channel a sweep has registered or found registered,
  // under `$SLOPWEAVER_HOME/incidents`, so a later sweep does not judge the same channel twice.
  "src/incident/seen.ts": "local-state",
  // Writing the note's application bundle and handing it to LaunchServices. Every write lands inside
  // `$SLOPWEAVER_HOME/hand-steps/HandNote.app` at `0700`/`0600`, the `rmSync` clears this install's own stale
  // markers, and the ONE process it starts is `open -n -a <that bundle>` — a window on the owner's own screen that
  // runs no model and reaches nothing. Why a bundle rather than a spawn, and why `no-headless` is satisfied
  // rather than dodged: `skills/hand/reference/the-note.md`.
  "src/hand/note/raise.ts": "local-state",
  // The note's ANSWER MARKERS — `<id>.later` a settle leaves and `<id>.snooze-<choice>` a snooze from another
  // surface leaves, written under `$SLOPWEAVER_HOME/hand-steps/dismiss` at `0700`/`0600` and listed back.
  "src/hand/note/markers.ts": "local-state",
  // The note's CASCADE SLOTS — `<token>.slot` written per raise under `$SLOPWEAVER_HOME/hand-steps/live` at `0600`,
  // the `slot.lock` directory made and removed around the pick, and reservations whose note has gone swept.
  "src/hand/note/slots.ts": "local-state",
  // Composes those bundle bytes and nothing else — it performs no seam at all, and is named here because its
  // file overview quotes `execFileSync` while explaining why `../raise.ts` may use it.
  "src/hand/note/bundle.ts": "local-state",
  // The one `execFileSync` behind both macOS surfaces, declared once so six verbs cannot drift on it: `open`
  // for the note and `osascript` for the notification, each with every value in argv and a 5s bound. Local
  // machine state exclusively, the same class as `src/browser/foreground.ts`'s own `open`.
  "src/cli/commands/hand/deps.ts": "local-state",
  // The cmux NOTIFICATION FILTER installer. Two files, two lifetimes: the filter itself under
  // `$SLOPWEAVER_HOME/hooks/`, and a one-line `exec` shim at the path cmux's own config already names — the
  // one write outside the state home, and it backs up whatever stood there first. Local machine state
  // exclusively; nothing here reaches a provider, and cmux's config is never rewritten.
  "src/monitor/filterInstall.ts": "local-state",
  // The FLEET-HEALTH NOTE'S MEMORY — what the last posted `fleet-unhealthy` card showed, one JSON file beside the
  // register under `$SLOPWEAVER_HOME/hand-steps`, written atomically after a fired post and one `rmSync` when the
  // fleet reads clear. Local state exclusively; nothing in the module reaches a provider.
  "src/monitor/fleetHealthShown.ts": "local-state",
  // The KIND-ANSWER STORES' file half — one `<key>.json` per muted monitor kind or held-until-worse note, written
  // atomically under `$SLOPWEAVER_HOME/hand-steps/<store>` at `0700`/`0600` and removed by `hand mute remove`.
  "src/monitor/kindAnswerFiles.ts": "local-state",
  // The PROPOSAL QUEUE — candidate beliefs of the owner's, read out of their own recorded words and appended one
  // line at a time beside the register. Same class and same reasons as the register above, and it is a
  // SEPARATE file for the reason its own header gives: a proposal owes no evidence, tier or verdict, so it
  // is not a lesson and may not be written where one is (`src/knowledge/voice/types.ts`).
  "src/knowledge/voice/store.ts": "local-state",
  // The QUIZ ledger — one question per sweep and what the owner said about it, appended one line at a time
  // beside the register and the proposal queue. Same class and same reasons as both, and a THIRD file
  // for the reason its own header gives: a proposal runs from the owner's words toward the fleet and a quiz runs
  // the other way, so a reader telling them apart by a field would eventually get one wrong.
  "src/knowledge/quiz/store.ts": "local-state",
  // `knowledge redact --apply`'s pre-redaction ARCHIVE — the register and its ledger, written at `0600` under
  // `$SLOPWEAVER_HOME/knowledge/redaction` before the in-place rewrite. Its only removals are of the two
  // files THIS run just wrote, when either write fails, so a rolled-back rewrite never leaves half an archive
  // reading as the whole register. Never a stored row, and nothing here reaches a network.
  "src/cli/commands/knowledge/redact.ts": "local-state",
  // Pinning ONE batch of the owner's own words to a file the reader names, so `knowledge propose --quote` has
  // something byte-exact to verify a quote against. It writes where the caller pointed `--out` rather than
  // under `$SLOPWEAVER_HOME`, which is the whole point — the batch is evidence a session hands itself, and
  // nothing here reads or reaches a network (`src/knowledge/voice/batch.ts`).
  "src/knowledge/voice/batch.ts": "local-state",
  // The OAuth GRANT file — a refresh token (Google) or MSAL's token cache (Outlook) landing at `0600` under
  // `$SLOPWEAVER_HOME/secrets`, one file per door, staged then renamed. Exactly the class of
  // `src/secrets/store.ts` below, and a separate file for the reason its own header gives: a user-consented
  // grant is not the single-line shape that store writes. The bindings over it (`googleGrant.ts`,
  // `outlookGrant.ts`) declare a filename and a shape, and no seam of their own.
  "src/secrets/grantFile.ts": "local-state",
  "src/secrets/store.ts": "local-state",
  // The escape-hatch grant journal, the outbound lane only. Exactly the class above: an append-only local record of a decision to proceed past ONE refusal
  // for thirty minutes. What the grant later ADMITS may reach a provider — and that send is itself routed
  // through the door, which is where it is gated. Recording the decision is not the send.
  "src/hatch/grantStore.ts": "local-state",
  // The plan-drawdown journal: every gauge sample the watch has taken, and every investigation it opened
  // because of one. An append-only local record under `$SLOPWEAVER_HOME/claude-accounts`, in the same class
  // and with the same `0700`/`0600` treatment as the grant journals above. The readings it records came from
  // a provider, but they arrived through `claude/probeStore.ts`, which is already classified; writing them
  // down is not a second provider call.
  "src/claude/drawdownJournalStore.ts": "local-state",
  // The sign-in log: which plan store the owner signed in, and when the vendor's own login exited cleanly.
  // Its sibling in every respect — append-only, under the same `$SLOPWEAVER_HOME/claude-accounts` with the
  // same `0700`/`0600` treatment. It records that a login happened; it neither performs one nor reaches a
  // provider. The login itself is `signinRun.ts`'s `launchLogin`, already classified above; this file writes
  // down that it exited cleanly, and a clock.
  "src/claude/signInLog.ts": "local-state",
  // The Codex burn journal and its episode claims: every rate-limit reading the watch has taken, every
  // investigation it opened, and the exclusive claim that makes at most one of those automatic. Same class
  // and same `0700`/`0600` treatment as its Claude twin above, under `$SLOPWEAVER_HOME/codex-burn`. The
  // readings came from a provider, but they arrived through Codex's OWN rollout log on disk rather than
  // through any call this repository makes (`codex/gauge.ts` § Why this is not a probe), so writing them
  // down is not a second provider call — it is not even a first one.
  "src/codex/drawdownJournalStore.ts": "local-state",
  // The reach-grant journal for the production-facing raw block. Same directory, same class and same
  // `0700`/`0600` treatment as the hatch journal above — an append-only local record of a decision, never a
  // provider write. What the grant later ADMITS may reach a provider; recording it does not.
  "src/admit/reachGrantStore.ts": "local-state",
  // The supervisor's session ledger. Local state only, under `$SLOPWEAVER_HOME/sessions` — exactly the same
  // class as `src/admit/queueStore.ts` above, which this was built from.
  "src/sessions/sessionStore.ts": "local-state",
  // Which session holds the supervisor pin, under `$SLOPWEAVER_HOME/sessions`. Same class again: the pin
  // itself lives in cmux, and this file is only the local record the depth-guard hook reads.
  "src/sessions/supervisorPinStore.ts": "local-state",
  // Which sessions declared that their own brief forbids sub-agents, under `$SLOPWEAVER_HOME/sessions` at
  // `0700`/`0600`. Same class and same directory as the pin record above: a local record the Agent/Task
  // PreToolUse hook reads, never a provider write.
  "src/sessions/agentToolBanStore.ts": "local-state",
  // The intake ledger — what an owner turn in the supervisor became when it did not become a board row.
  // Same directory, class and `0700`/`0600` treatment as the break-glass journal above: an append-only local
  // record of a decision, never a provider write.
  "src/supervisor/intakeStore.ts": "local-state",
  // The supervisor-chain journal — which sessions have held the pin. Same directory, class and `0700`/`0600`
  // treatment as the intake ledger it sits beside: an append-only local record of a succession that happened
  // on this machine, never a provider write.
  "src/supervisor/chainStore.ts": "local-state",
  // The supervisor tick ledger — one appended row per sweep tick, `0700`/`0600` under
  // $SLOPWEAVER_HOME/ledgers/supervisor. Same class and the same reason as the two ledgers above: it records
  // what this machine's own sweep READ and DID, including the owner's own turns verbatim, and it reaches no
  // provider on any path. It exists so the fleet briefing's narrative sections are derived from a record
  // rather than composed by hand each tick.
  "src/supervisor/tickStore.ts": "local-state",
  // The owner-turn receipt journal — one appended row per turn of the owner's a chair was SHOWN, `0700`/`0600` under
  // $SLOPWEAVER_HOME/ledgers/supervisor beside the tick ledger. Same class and the same reason: it records
  // what this machine's own chairs have read, and `cmux takeover` reads it back to refuse a chair that has
  // not read the owner's week. It reaches no provider on any path.
  "src/supervisor/ownerTurnReceiptStore.ts": "local-state",
  // The chair-restore attempt ledger — one appended row per `/model fable` the chair typed at its own tab
  // after a safeguard fallback demoted it, `0700`/`0600` under $SLOPWEAVER_HOME/supervisor beside the
  // ledgers above. Same class and the same reason: it counts what this machine's own chair did to itself,
  // so `chairRestore.ts` can stop at two attempts and hand off instead of re-sending forever, and it
  // reaches no provider on any path.
  "src/supervisor/chairRestoreStore.ts": "local-state",
  // The chair hand-off cadence's version read: `claude --version` with a constant argv and a five-second bound,
  // plus a listing of the native installer's versions directory. It asks the LOCAL binary what it is and never
  // sends a prompt, starts a session or reaches a provider.
  "src/supervisor/chairCadenceRead.ts": "read-only-tool",
  // `supervisor successor-summary` writes ONE markdown file the operator names with `--out`, derived from the
  // reconciliation document it was handed, whose outcomes are the owner's kept Workstreams entries. Local state exclusively, the same
  // class as the two state-doc edits below: no provider, no network, no other write on any branch.
  "src/cli/commands/supervisor/successorSummaryRun.ts": "local-state",
  // The three state-doc edits, `supervisor state-amend`, `state-fold` and `state-archive`, whose filesystem
  // seams live in their publication module. Local state exclusively: they read and replace ONE markdown file
  // the operator names with `--doc`, publish its archive beside it, and unlink only the staging file they
  // themselves just wrote. No provider, no network, no other path on any branch.
  "src/cli/commands/supervisor/stateDocEditPublication.ts": "local-state",
  // The readings ledger: the last `--json` document a slow verb printed, written under
  // `$SLOPWEAVER_HOME/readings` with one index row per document, `0700`/`0600`, under the ledger lock. The
  // same class as the journals above — a verb that reached a provider did so through its own already-classified
  // path (`github landing`, the supervisor tick's gauges); recording what it printed is a second local write,
  // never a second provider call, and nothing here reads one.
  "src/readings/store.ts": "local-state",
  // The value-sample ledger: one `<week>.json` per ISO week under `$SLOPWEAVER_HOME/ledgers/value-samples`, its
  // first draw written beside its target and hard-linked into place so the create is exclusive, and the staging
  // file it just wrote removed. Local state exclusively: the pull-request states a sample carries were read by
  // `value sample` through its own closure seam before this module is called, and nothing here reaches a network.
  "src/value/store.ts": "local-state",
  // read-only tool, exactly like `src/outbound/github/mergeFacts.ts` above — `git log` only, never a write.
  "src/velocity/gitEdge.ts": "read-only-tool",
  // What the console voice's `read_code` tool may see. Two read-only `git` invocations against the checkout the
  // caller named — `rev-parse --show-toplevel` and `ls-files --cached` — so the model's reach is the TRACKED
  // set rather than whatever the filesystem holds. The same class as `codex/gitRun.ts`: a constant argv, no
  // write on any path, and no provider behind it.
  "src/talk/checkout.ts": "read-only-tool",
  // The voice context pack's landings: one read-only `git log --first-parent` of the base ref over the last
  // day, against the checkout `resolveTalkCheckout` resolves. The same class as `src/talk/checkout.ts` above — a
  // constant argv shape, no write on any path, and no provider behind it.
  "src/talk/packLandings.ts": "read-only-tool",
  // `fleet landed`'s history: `rev-parse --verify` of the ref and one `git log --first-parent -n` of it, against
  // the checkout the caller named. The same class as `src/talk/packLandings.ts` above — a constant argv shape, no
  // fetch, no write on any path, and no provider behind it.
  "src/fleet/landedGit.ts": "read-only-tool",
  // The relay ledger: one turn record per file plus an append to `$SLOPWEAVER_HOME/talk-relays.jsonl`, both
  // `0600`. Local state exclusively — the board row a pressed relay registers is written by `handover
  // register` through its own path, and this file is only the receipt that a second press is compared
  // against, so nothing here reaches a provider.
  "src/talk/relayStore.ts": "local-state",
  // The relay's run lease: `$SLOPWEAVER_HOME/talk/turns/<turn>.run/<n>`, generations each naming a pid and its
  // start time (one local `ps`), placed by link and marked released on release. Local state exclusively — it only
  // decides which live run may touch a turn, and nothing here reaches a provider.
  "src/talk/relayLease.ts": "local-state",
  // The relay courier hand-off under `$SLOPWEAVER_HOME/talk/courier/`: a `pending/<turnId>.json` request renamed into
  // `claimed/` by the one courier that takes it, unlinked when withdrawn or finished. Local state exclusively — a
  // request names a turn id and nothing else, and the courier's cmux paste is `talk courier`'s, never this file's.
  "src/talk/relayCourierStore.ts": "local-state",
  // The console-voice call files under `$SLOPWEAVER_HOME/talk/calls/`, and the call index each new call is appended to
  // before its first line, all `0600`. Local state exclusively: the page's own transcript, written by `talk transcript`
  // and read by `talk calls` and `talk unread`. Nothing here reaches a provider.
  "src/talk/callStore.ts": "local-state",
  // The desktop e2e leg's reopen arm file, `$SLOPWEAVER_HOME/talk/e2e-reopen-probe.json`: written by `call-reopen`,
  // read by `talk offer --test-instance e2e`, removed before every scenario. Local state exclusively — it names a pid,
  // a process start and an instant, and nothing here reaches a provider.
  "src/talk/e2eReopenProbe.ts": "local-state",
  // The append lock beside a call file, `<callId>.jsonl.lock` under the same `0700` directory: a holder line staged
  // `0600`, linked into place and removed on release. Local state exclusively, split out of `callStore.ts`.
  "src/talk/callLock.ts": "local-state",
  // How one batch reaches the end of a call file under that lock: appended in place, or — reconnect steps alone — a
  // `0600` copy staged beside it, renamed over it and removed on failure. Local state exclusively, split out of
  // `callStore.ts`.
  "src/talk/callFileAppend.ts": "local-state",
  // A writer's intent beside a call file or the card-landing ledger, `<file>.intent.<pid>.<n>` under the same `0700`
  // directory: a holder line created `0600` exclusively, removed once the write is done. Local state exclusively: it
  // only tells a fence over the owner's words that an append is waiting.
  "src/talk/callWriteIntent.ts": "local-state",
  // The marks a failed card landing leaves, one empty `0600` file each under `$SLOPWEAVER_HOME/talk/sweep-owed/`. Local
  // state exclusively: they only say the next batch sweeps other calls again.
  "src/talk/sweepOwed.ts": "local-state",
  // The boot-refusal wake's claims, one empty file per register card under `$SLOPWEAVER_HOME/talk/boot-refusals/`,
  // created exclusively before the chair is woken and removed when nothing was typed. Local state exclusively: the
  // keystroke itself is the courier's typist, never this file's, and nothing here reaches a provider.
  "src/talk/bootRefusalWakeShell.ts": "local-state",
  // A file the owner attached in the Messenger, kept at `$SLOPWEAVER_HOME/talk/attachments/<uuid>/<name>`: the directory
  // `0700`, the file `0600` and created exclusively, the directory removed when its write fails. Local state
  // exclusively: the thinking model reads it with `file_read`, and nothing here reaches a provider.
  "src/talk/attachmentStore.ts": "local-state",
  // The running list, `$SLOPWEAVER_HOME/talk/running-list.json` (`0600`) under its `0700` directory, rewritten whole
  // under the call lock. Local state exclusively: the console and the voice read it through `talk list`, and nothing
  // here reaches a provider.
  "src/talk/runningListStore.ts": "local-state",
  // Restore's exclusive create under `$SLOPWEAVER_HOME` and `store authored-show --out`'s write to a file the
  // operator names. Local files only: the bytes came out of the store, and nothing here reaches a provider.
  "src/store/fleet/authoredWrite.ts": "local-state",
  // The auto-memory mirror: copies local corpus files into `$SLOPWEAVER_HOME/claude-memory` and removes the
  // mirror's own copies. Local files only, and nothing under `~/.claude` is written.
  "src/store/fleet/claudeMemorySync.ts": "local-state",
  // `doctor --deep`'s two spawns, both literal argv: `gh auth token` with every stdio stream ignored, so only
  // its exit status is read and the token never enters this process, and `zsh -i -c "exit 0"`, which starts a
  // shell the way a terminal does, its stderr in a temp file this module makes and removes. Neither writes
  // anything of Slopweaver's or reaches a provider beyond what `gh` itself reads to check its own login.
  "src/environment/gather.ts": "read-only-tool",
} as const satisfies Readonly<Record<string, "door-internal" | "local-state" | "read-only-tool">>;
