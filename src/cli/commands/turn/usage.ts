/**
 * The usage lines of every `slopweaver turn` verb but `ledger`, `satisfied` and the four in `./blockUsage.ts`, which
 * keep leaves of their own, and nothing else.
 *
 * A LEAF on purpose: `cli/manifests/turn.ts` reads these strings on EVERY invocation, because `--help`, `catalog` and
 * `discoverCommands` enumerate the manifest barrel whether or not one of these verbs runs. Kept in a command module, a
 * string would put that module and everything it imports on every invocation's load path. The command modules import
 * these from here, never the reverse. Import only other leaves: `src/__tests__/unit/cli/manifestBarrelClosure.test.ts`
 * fails on anything else.
 */

import { LIVE_STATUS_CAP, PLAN_STEP_TITLE_MAX, PLAN_STEPS_MAX } from "../../../live/turn/liveStatusCap.js";

/** `slopweaver turn watch`'s usage line. */
export const TURN_WATCH_USAGE =
  "usage: slopweaver turn watch --brief <file> [--interval-seconds <n>] [--max-seconds <n>] [--once]\n" +
  "                       [--home <dir>]\n" +
  "  Keeps THIS turn's card current without asking the model anything: every interval it reads the turn's\n" +
  "  own progress log and the worker session's command log, rewrites the card, and records the write.\n" +
  "  Runs in the FOREGROUND and blocks. The session doing the work backgrounds it with a bare `&` — never\n" +
  "  `nohup`, never `setsid`, never `disown`, which buy nothing and make a reader believe in a protection\n" +
  "  that is not there: MEASURED, a bare `&` from an agent tool-call shell is already reparented to pid 1\n" +
  "  by the time the call returns, so this is NOT a child of the session and nothing kills it with one.\n" +
  "  It reaps itself instead — see the stop conditions below.\n" +
  "  --interval-seconds  how often to rewrite the card (default 90).\n" +
  "  --max-seconds       stop after this long whatever happens (default 7200, the dispatch lease).\n" +
  "  --once              do exactly one tick immediately and exit — what a test or a probe runs.\n" +
  "  It stops early when the ask is answered or triaged to no response, and DELIBERATELY NOT when a send\n" +
  "  fails: a refused answer is when the worker keeps working and the reader most needs the card.\n" +
  "  It also reaps ITSELF when it is orphaned AND its worker session has stopped making tool calls, so a\n" +
  "  worker that dies without answering no longer leaves a card being written by nobody for two hours.";

/** `slopweaver turn brief`'s usage line. */
export const TURN_BRIEF_USAGE =
  "usage: slopweaver turn brief --channel <id> --message-ts <ts> --thread-ts <ts> --text <mention text> " +
  "--user <id> [--surface channel|dm] [--mode continuous-drain|single-turn] [--out <file>] " +
  "[--turn-id <id> --working-ts <ts>] [--rides <ts>] [--force] [--home <dir>]\n" +
  "   or: slopweaver turn brief --contracts --text <question> [--home <dir>]\n" +
  "  Turns one addressed message into a BRIEF the visible session JUDGES: what it can reach, and what to\n" +
  "  hand `slopweaver turn dispatch` once it has composed a RoutingDecision. Reads only — it posts nothing,\n" +
  "  loads no world model, and runs no model.\n" +
  "  --contracts      the READ-ONLY door: prints the capability contracts (coverage, freshness, the command\n" +
  "                   each runs) for --text and writes nothing — no brief, no lifecycle row, every other flag\n" +
  "                   ignored. Use it instead of a throwaway brief that can clobber a live one.\n" +
  "  --force          overwrite this ask's brief even though a turn has started for it; without it `turn brief`\n" +
  "                   REFUSES rather than destroy the pinned question and evidence that turn's brief carries.\n" +
  "  --message-ts     the addressing message's OWN ts — required, and never reconstructed from\n" +
  "                   --thread-ts: a reply's addressing timestamp differs from its thread root, and\n" +
  "                   guessing the two are equal is exactly the identity bug this flag exists to close.\n" +
  "  --user           the Slack user id who addressed the bot. REQUIRED: this is a flag-built entrance a\n" +
  "                   hand-typed or replayed command can reach without ever going through the live socket\n" +
  "                   gate, so it is put through the SAME responder whitelist — a refused id stops here,\n" +
  "                   before any routing or brief is written.\n" +
  "  --mode           `continuous-drain` (the continuous listen loop, which must never block on a native\n" +
  "                   subagent) or `single-turn` (one human-driven turn, where every tier is admissible on\n" +
  "                   either host; the supervisor tick's sweep reconciles a fresh session's dispatch).\n" +
  "                   Defaults to `single-turn`.\n" +
  "  --host           override the detected visible host (`claude-code` or `codex`) — normally detected\n" +
  "                   from the environment; only needed when no CLAUDE_CODE_SESSION_ID/CODEX_THREAD_ID is set.\n" +
  "  --out            where to write the brief JSON that `slopweaver turn dispatch`/`turn answer` read back.\n" +
  "                   Defaults to $SLOPWEAVER_HOME/briefs/<channel>-<message-ts>.json\n" +
  "  --surface        which surface addressed the bot. Defaults to `channel`.\n" +
  "  --turn-id, --working-ts   the id and posted ts of the checklist `listen` posted at capture (its `started`\n" +
  "                   field); `turn answer` advances it rather than posting a second. BOTH or NEITHER — a\n" +
  "                   partial pair is refused rather than silently posting a second checklist.\n" +
  "  --rides          the messageTs of the same-thread ask this one was dispatched from; `turn dispatch` rides\n" +
  "                   that ask's progress card, while it is open, instead of posting a second one.";

/** `slopweaver turn answer`'s usage line. */
export const TURN_USAGE =
  "usage: slopweaver turn answer --brief <file> --answer <file> --decision <file> [--verdict <file>] " +
  "[--session-url <url>] [--model <id>] [--home <dir>]\n" +
  "   or: slopweaver turn answer --answer <file> --print-digest\n" +
  "   or: slopweaver turn answer --dispatch <id> --verdict <file> [--session-url <url>] [--model <id>] [--home <dir>]\n" +
  "  Posts the answer a visible session composed: a working message, a checklist that advances in\n" +
  "  place, then the reply with its evidence trail and provenance footer — wrapped in the same violet accent\n" +
  "  bar every bot message carries. `answer.grounding.kind` states what actually supported the reply\n" +
  "  (`conversation`, `verb`, or `unreachable`), checked against the decision that dispatched this turn\n" +
  "  before anything posts. Any already-produced proof images ride along via `images`.\n" +
  "  There is no model in this verb.\n" +
  "  --brief     the file `slopweaver turn brief` wrote.\n" +
  "  --decision  the RoutingDecision JSON the visible session composed and handed to `turn dispatch`.\n" +
  '  --answer    a JSON file holding one `kind: "answer"` form.\n' +
  "  --verdict   the reviewing session's ReviewVerdict JSON, bound to this answer by the digest\n" +
  "              `--print-digest` reports. A DIFFERENT visible session writes it; this verb only\n" +
  "              carries it to the door.\n" +
  "              Omitting it is not a usage error — the send is refused by the admit door instead, with\n" +
  "              the finding and the correction, because an unreviewed answer is a trust decision and\n" +
  "              not a CLI mistake.\n" +
  "  --print-digest  print the digest the door will bind a verdict to, and send NOTHING. Give this to\n" +
  "              the reviewer. It is NOT the sha256 of the answer file: the door hashes the answer after\n" +
  "              parsing it, so whitespace and key order are normalised away and hashing the file by hand\n" +
  "              produces a number that will be refused as stale.\n" +
  "  --dispatch  the `fresh-visible-session` dispatch id this answer completes — reads the durable READY\n" +
  "              marker `turn resume --answer` recorded (falling back to the live workspace screen) instead\n" +
  "              of trusting `--brief`/`--answer`/`--decision`. Run by the WORKER itself, from inside the\n" +
  "              dispatched workspace, once `turn review` (poll mode) has handed it a verdict; the door still\n" +
  "              wants `--verdict`, and the workspace closes itself after the answer lands.\n" +
  "  --session-url  name the session explicitly; normally the visible Claude Code or Codex session is detected.\n" +
  "  --accounted-for-ts  later message ts values this answer already accounts for, comma-separated —\n" +
  "                      excluded from the live thread-freshness check rather than tripping it. For a\n" +
  '                      compound instruction ("add X to the whitelist, then answer their question\n' +
  "                      above\"), the owner's OWN instruction is a later message than the question it\n" +
  "                      authorises answering. For a turn a fast thread overtook, it is every message\n" +
  "                      re-read before revising the answer. A malformed entry is refused, never dropped.\n" +
  "  --read-through  the ts this answer READ UP TO — the boundary the send-time thread delta is measured\n" +
  "              from. Without it the boundary is the addressing message, so on a long thread every reply\n" +
  "              since the ask counts as new forever. It may only move the boundary FORWARD, and may not\n" +
  "              name a ts later than the thread's own newest message: both are refused.\n" +
  "  --delta-cleared  you read every message in that delta and none of them touches a claim this answer\n" +
  "              makes. The answer then posts with a door-composed freshness note and costs no review\n" +
  "              round; with no --read-through the note names the addressing message as its boundary.\n" +
  "              A message that DOES touch a claim is not this flag: fix the claim and re-open\n" +
  "              review narrowed to it.";

/** `slopweaver turn dispatch`'s usage line. */
export const TURN_DISPATCH_USAGE =
  "usage: slopweaver turn dispatch --brief <file> --decision <file> [--home <dir>]\n" +
  "   or: slopweaver turn dispatch --brief <file> --decision <file> --subagent-report <file> [--home <dir>]\n" +
  "   or: slopweaver turn dispatch --poll <id> [--home <dir>]\n" +
  "   or: slopweaver turn dispatch --sweep [--ask <channel>/<messageTs>] [--now <iso>] [--home <dir>]\n" +
  '   or: slopweaver turn dispatch --sweep --ask <channel>/<messageTs> --warn "<observation>" --warn-dispatched <iso> [--home <dir>]\n' +
  "  Executes the tier a composed RoutingDecision named. `inline` and `read-only-subagent` return\n" +
  "  instructions for THIS visible session to act on directly; `fresh-visible-session` opens a real, watched\n" +
  "  cmux workspace and returns immediately — it never blocks the caller on the work finishing.\n" +
  "  --brief             the file `slopweaver turn brief` wrote.\n" +
  "  --decision          the RoutingDecision JSON this session composed.\n" +
  "  --subagent-report   the ExecutionEvidence JSON a native read-only subagent returned — the SECOND call\n" +
  "                      for a `read-only-subagent` tier, after the first call's instructions were run.\n" +
  "  --poll              re-read a `fresh-visible-session` dispatch's live workspace screen and report its\n" +
  "                      current truth — working, ready, failed, or unreachable. Never posts anything.\n" +
  "  --sweep             read every currently-`dispatched` ask and report which are ready, still working, or\n" +
  "                      past their lease — a re-judgement candidate. Never relaunches anything.\n" +
  "  --now               the instant to judge every lease against, ISO-8601. Defaults to the real clock, and\n" +
  "                      exists for REPLAY: a frozen fixture home is a stopped world, so the wall clock would\n" +
  "                      report every lease in it expired. Passing a future instant against a LIVE home would\n" +
  "                      expire real leases, so pass it only against a fixture.\n" +
  "  --ask               sweep ONLY this ask, `<channel>/<messageTs>` as `asks.jsonl` keys it. A sweep\n" +
  "                      FINALISES what it finds, so an install carrying a backlog of stuck cards would post\n" +
  "                      to every one of their threads on the first unscoped run; this is how one is\n" +
  "                      corrected by hand without that. An ask the log does not carry is a usage refusal,\n" +
  "                      never a silent empty sweep.\n" +
  "  --warn              record the loop's ONE witness note on that ask's budget — an observation the worker reads\n" +
  "                      back on its next `turn status`, never an instruction. Needs --ask and --warn-dispatched;\n" +
  "                      records locally and returns, with no screen read, card edit or finalisation. A second\n" +
  "                      note for the same dispatch is refused.\n" +
  "  --warn-dispatched   the `dispatched` instant the sweep's `budget:` line named, so a note judged against one\n" +
  "                      dispatch is refused rather than attached to a re-dispatch that replaced it.";

/** `slopweaver turn freeze`'s usage line. */
export const TURN_FREEZE_USAGE =
  "usage: slopweaver turn freeze --ask <channel>/<messageTs> --out <dir> --incident <text>\n" +
  "                              [--through <kind>] [--not-after <iso>] [--slug <name>] [--home <dir>]\n" +
  "  Freezes one ask's on-disk record set — its lifecycle rows, brief, dispatch record, turn marker,\n" +
  "  reviewer record and verdict, and the answer it composed — into a committable REPLAY FIXTURE the\n" +
  "  subprocess replay lane points real verbs at. Every string is redacted through an allowlist: a value\n" +
  "  survives only when its key is one a replay assertion reads, every provider id becomes a stable\n" +
  "  synthetic, and every absolute home path becomes a placeholder the replay substitutes back. The whole\n" +
  "  output is then scanned by the SAME hygiene gate CI runs, and a single surviving hit REFUSES the freeze\n" +
  "  rather than writing it.\n" +
  "  --ask       the exact ask, `<channel>/<messageTs>`, as `asks.jsonl` keys it.\n" +
  "  --out       the fixture directory to write. Replaced wholesale, never merged.\n" +
  "  --incident  what went wrong, in your own words. Free prose; it lands in the manifest for the next reader.\n" +
  "  --through   keep the lifecycle log only up to the LAST event of this kind, and record the kinds withheld\n" +
  "              after it. This is what makes a fixture a replay rather than a recording: frozen whole, an\n" +
  "              incident carries the very event the defect wrote, and replaying the real verb over that\n" +
  "              proves only that it can read one.\n" +
  "  --not-after the instant the record set's window closes at, and the clock a replay judges the fixture by.\n" +
  "              Defaults to the last kept lifecycle event's own timestamp, which is right whenever the\n" +
  "              defect fired at a lifecycle event. It is wrong whenever the defect fired BETWEEN two of\n" +
  "              them — a worker dying mid-response writes no row at all — because every review round that\n" +
  "              ran after the dispatch is then cut off, and those rounds are the turn's whole work product.\n" +
  "              Give the instant the turn actually died, and the fixture is the state at that moment.\n" +
  "  --slug      the fixture's own name; defaults to the last segment of --out.\n" +
  "  --regresses comma-separated `docs/recurring-failure-register.md` class names this fixture regresses, so\n" +
  "              the register can say which frozen incident holds a failure class down. Refused when the\n" +
  "              register does not carry the class. Omit it when the turn is not an instance of a named\n" +
  "              class, which is the common case — the field is written as an empty list.";

/** `slopweaver turn resume`'s usage line. */
export const TURN_RESUME_USAGE =
  "usage: slopweaver turn resume --dispatch <id> [--home <dir>]\n" +
  "   or: slopweaver turn resume --dispatch <id> --answer <file> [--edit-reason <why>] [--home <dir>]\n" +
  "   or: slopweaver turn resume --dispatch <id> --failed <reason> [--home <dir>]\n" +
  "  Runs INSIDE the worker session `turn dispatch` opened. Without --answer, loads and prints the brief and\n" +
  "  decision this session was dispatched for, with the numbered steps the worker owns from there: validate,\n" +
  "  `turn review`, then `turn answer` in dispatch mode with the reviewer's verdict. With --answer, locally validates the answer against the\n" +
  "  decision and brief and prints the READY marker — the worker's validation report, not the send; the worker\n" +
  "  still posts itself. An answer already sent for review is FROZEN: editing bytes a standing verdict could\n" +
  "  still be posted with is refused until --edit-reason says why, because each rewrite costs another round.\n" +
  "  With --failed, records the worker's own statement that no answer is coming, so the\n" +
  "  loop's sweep finalises the thread's indicators with that reason. Never posts to Slack itself.";

/** `slopweaver turn review`'s usage line. */
export const TURN_REVIEW_USAGE =
  "usage: slopweaver turn review --dispatch <id> --answer <file> [--read-through <ts>] [--delta-cleared] [--model <id>] [--home <dir>]\n" +
  "   or: slopweaver turn review --brief <file> --decision <file> --answer <file> [--read-through <ts>] [--delta-cleared] [--model <id>] [--home <dir>]\n" +
  "   or: slopweaver turn review --dispatch <id> --poll [--wait] [--timeout-seconds <n>] [--home <dir>]\n" +
  "   or: slopweaver turn review --brief <file> --poll [--wait] [--timeout-seconds <n>] [--home <dir>]\n" +
  "   or: slopweaver turn review --dispatch <id> --close [--home <dir>]\n" +
  "  Opens the independent REVIEWER for one composed answer — a fresh visible cmux session, pinned to a\n" +
  "  model at boot — and hands it a packet this program composed from the answer's own bytes: the question,\n" +
  "  the answer verbatim, its digest, the decision's live-read plan, the evidence the answer claims, its\n" +
  "  citations, and the owner's applicable directives. Neither the session that composed the answer nor the\n" +
  "  loop writes a word of the reviewer's instructions — that is what keeps the review independent when the\n" +
  "  worker is the one pressing the button. Runs no model itself and never posts to Slack.\n" +
  "  --dispatch  the `fresh-visible-session` dispatch whose answer this reviews — the worker's own form.\n" +
  "  --brief, --decision  the loop's own form, for an `inline` answer it composed itself.\n" +
  "  --answer    the answer JSON the reviewer binds its verdict to. Re-validated here before anything opens.\n" +
  "  --read-through  the newest human message ts in the thread the draft read (the ask's own ts when nothing\n" +
  "              followed it). Before ROUND 1 only, the thread is re-read live and the round refuses to open\n" +
  "              while a human message newer than this is unread; a failed read refuses too. Later rounds\n" +
  "              are not gated: their reviewer re-reads the thread itself.\n" +
  "  --delta-cleared  you read every message that refusal listed and none touches a claim: open round 1 anyway.\n" +
  "  --model     the reviewer's model tier or id; defaults to the reviewer default in live/turn/workerModel.ts.\n" +
  "  --poll      OBSERVE. Reads the verdict the reviewer was asked to write: prints\n" +
  "              `verdict: <outcome> <path>` — the path `turn answer` takes as its verdict — and exits 0\n" +
  "              once THIS reviewer's own verdict is there for these bytes; otherwise says whether the\n" +
  "              reviewer is still working or has died, and exits non-zero. Never closes a workspace. A\n" +
  "              previous round's verdict that landed after this round opened is archived and recorded as\n" +
  "              loop breakage, then the verdict is read again.\n" +
  "  --wait      with --poll: re-read on a stepped backoff while the reviewer is still working, printing a\n" +
  "              state only when it changes, then report as --poll does; exit 4 when --timeout-seconds\n" +
  "              (default 540) passes with the reviewer still working. Still observes only.\n" +
  "  --close     CONSUME. Closes the reviewer's workspace and marks its session closed — and only when the\n" +
  "              reviewer is provably not working: its OWN verdict is written, or cmux says the host has\n" +
  "              exited. Refuses otherwise, naming what it saw. Separate from --poll on purpose: reading a\n" +
  "              verdict and tearing down the session that is writing one must not be the same act.";

/** `slopweaver turn status`'s usage line. */
export const TURN_STATUS_USAGE =
  `usage: slopweaver turn status --brief <file> (--status <text> [--step <n>] | --plan <lines>) [--tier inline|read-only-subagent|fresh-visible-session]\n` +
  "                       [--model <id>] [--session-url <url>] [--home <dir>] [--dry-run]\n" +
  "  Pushes ONE self-reported line onto this turn's own already-posted checklist, between `turn brief` and\n" +
  "  `turn answer` — the same `advanceWorking` primitive `turn dispatch`'s live sweep mode uses to\n" +
  "  screen-scrape a dispatched workspace, called directly by the session doing the work instead. Call it\n" +
  "  repeatedly at natural checkpoints while investigating; it only edits the checklist message already\n" +
  "  standing, it never posts a new one, and it posts nothing at all when this ask has no capture-time\n" +
  "  checklist to advance.\n" +
  "  --brief        the file `slopweaver turn brief` wrote — its `started` ref names the checklist message.\n" +
  `  --status       a short line for what you just LEARNED (clamped to ${String(LIVE_STATUS_CAP)} characters).\n` +
  `  --plan         the turn's plan, one step per line: at most ${String(PLAN_STEPS_MAX)} steps of at most ${String(PLAN_STEP_TITLE_MAX)}\n` +
  "                 characters, REFUSED past either. The card draws it as an outline with a progress meter;\n" +
  "                 declaring another later is a re-plan, shown in the loop below the fold.\n" +
  "  --step         the 1-based plan step this --status belongs to; the step in flight until another names one.\n" +
  "  --tier         `inline` (default), `read-only-subagent` or `fresh-visible-session` — which checklist\n" +
  "                 wording applies. A DISPATCHED worker should pass `fresh-visible-session` and push its own\n" +
  "                 progress: the sweep's screen-scrape is the dispatcher's view and stops the moment the\n" +
  "                 dispatcher stops believing in the worker (a `dispatch-failed` ends the dispatch), so a\n" +
  "                 worker that only relies on it can be alive and investigating behind a frozen card.\n" +
  "  --session-url  name the session explicitly; normally the visible Claude Code or Codex session is detected.\n" +
  "  --dry-run      run every gate (brief, responder/ignore, bot token, supervisor) and print the exact\n" +
  "                 checklist advance this would push, then exit 0 without touching Slack.";

/** `slopweaver turn ignore`'s usage line. */
export const TURN_IGNORE_USAGE =
  "usage: slopweaver turn ignore --channel <id> --message-ts <ts> --reason <text> [--remove] [--home <dir>]\n" +
  "  Permanently ignores one exact ask — never reconsidered again, at any entrance (the listener's own\n" +
  "  capture, turn brief/dispatch/resume/answer, listen recover), until --remove lifts it. A SEPARATE concept\n" +
  "  from a fresh no-response routing decision, which records one judgement attempt rather than a standing\n" +
  "  suppression. Idempotent — repeating it for the same ask is harmless. Runs no model and never touches the\n" +
  "  corpus; it does settle the live indicators of an ask already captured (its reaction, card and thinking\n" +
  "  indicator).\n" +
  "  --message-ts   the addressing message's OWN ts — the same exact identity every other turn verb keys on.\n" +
  "  --reason       why, in your own words — recorded, never inferred.\n" +
  "  --remove       lift the ignore — every entrance reads this ask normally again, so `listen recover` can\n" +
  "                 surface it. Settles nothing. Exits 3 and writes nothing when the ask is not ignored.";

/** `slopweaver turn ignore-conversation`'s usage line. */
export const TURN_IGNORE_CONVERSATION_USAGE =
  "usage: slopweaver turn ignore-conversation --channel <id> --reason <text> [--remove] [--list] [--home <dir>]\n" +
  "  Permanently ignores EVERY tag in one whole conversation — the channel-keyed sibling of `turn ignore`,\n" +
  "  which names one exact message. Checked at the SAME entrances (the listener's own capture, turn\n" +
  "  brief/dispatch/resume/answer, listen recover). Idempotent — repeating it for the same channel is\n" +
  "  harmless. Runs no model and never touches the corpus; it does settle the live indicators of every\n" +
  "  already-captured, unresolved ask this channel currently has (its reaction, card and thinking\n" +
  "  indicator) — quietly, posting no new message and draining nothing.\n" +
  "  --channel  the conversation to suppress (or un-suppress with --remove) — required unless --list.\n" +
  "  --reason   why, in your own words — recorded, never inferred. Required unless --list.\n" +
  "  --remove   un-suppress this channel — future tags are captured normally again. Settles nothing: there\n" +
  "             is nothing to correct when a suppression lifts.\n" +
  "  --list     print every channel currently under a standing ignore, then exit. Ignores --channel/--reason.";

/** `slopweaver turn settle-reaction`'s usage line. */
export const TURN_SETTLE_REACTION_USAGE =
  "usage: slopweaver turn settle-reaction --channel <id> --message-ts <ts>\n" +
  "                                        --to completion|stopped|acknowledged|for-a-human [--home <dir>]\n" +
  "  Converges one ask's ORIGINAL tagged message to exactly ONE lifecycle reaction, retiring every other\n" +
  "  member of the set (queued, capture, all four terminals) before adding the one you name. The by-hand\n" +
  "  correction path for a message an EARLIER turn left wearing a contradictory pair — no terminal will run\n" +
  "  over an ask that is already terminal, so nothing else can fix it. Human reactions are never touched.\n" +
  "  Idempotent: repeating it for the same ask and the same ending is a no-op.\n" +
  "  --message-ts   the addressing message's OWN ts — the same exact identity every other turn verb keys on.\n" +
  "  --to           which ending to leave standing: completion (it was answered), stopped (it ended with\n" +
  "                 no answer and someone should look), acknowledged (it was read and judged, and no\n" +
  "                 reply was owed), or for-a-human (it was read and judged, and a PERSON should answer).\n" +
  "  Refuses an ask the listener never captured: settling a message the bot never touched would be\n" +
  "  inventing a signal rather than correcting one.";
