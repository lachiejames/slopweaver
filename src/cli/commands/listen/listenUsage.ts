/**
 * Every `slopweaver listen …` verb's usage line, and nothing else.
 *
 * A LEAF on purpose. `cli/manifests/listen.ts` names these seven strings, and a manifest is enumerated by
 * `--help`, `catalog` and `discoverCommands` on invocations that dispatch none of these verbs — so while
 * they lived in `supervise.ts` and `listenShared.ts`, enumerating the surface dragged the whole supervision
 * stack (the arm store, the event stream, the freshness reader) onto every unrelated command's load path.
 * That is the eager-import leak `.claude/rules/area-cli.md` § "Metadata is eager, the run function is lazy"
 * names, closed for this family rather than described. Its one import is the two re-arm constants the
 * supervise line quotes, which is a ratchet rather than prose: a bound changed there cannot go stale here. The
 * `recover` line quotes {@link DEFAULT_LOOKBACK_DAYS}, which lives here for the same reason and which
 * `recover.ts` imports back.
 *
 * Keep it importing nothing else. A helper that needs the rest of the tree belongs in `listenShared.ts`.
 */

import { MAX_DEATHS_PER_WINDOW, REARM_WINDOW_MS } from "../../../live/listen/supervise/rearm.js";

/** `slopweaver listen arm`'s usage line. */
export const LISTEN_ARM_USAGE =
  "usage: slopweaver listen arm [--background] [--channels <C1,C2,…> | --dm-only] [--queue <path>]\n" +
  "                              [--thread-replies <C1,C2,…>] [--home <dir>]\n" +
  "                             [--json]\n" +
  "  Print the ONE shell line the visible loop session runs to start the listener, with a fresh arm id.\n" +
  "  Starts nothing itself: no nohup, no setsid, no daemon — they buy nothing, because MEASURED a bare `&`\n" +
  "  from an agent tool-call shell is ALREADY reparented to pid 1 by the time the call returns. What bounds\n" +
  "  the listener is the death-watch noticing it has gone, not its parentage\n" +
  "  (docs/listener-supervision/runtime-and-watching.md, docs/listener-supervision/failure-and-evidence.md).\n" +
  "  The listener registers itself on startup, so the recorded pid is the process that\n" +
  "  actually holds the socket. Refuses when a live arm already exists: Slack load-balances a tag across two\n" +
  "  Socket Mode connections, and only one of them answers.\n" +
  "  Prints what Slack last reported for this app's Socket Mode connection count, with its age, ABOVE the\n" +
  "  command: a FLOOR rather than a live count, because a closed socket keeps counting for tens of minutes.\n" +
  "  --background    background the call with a bare `&` and redirect into a FRESH per-arm log file, for a\n" +
  "                  session that wants its shell back. Default is a plain foreground call.\n" +
  "  --channels <C1,C2,…>  arm a listener that acts ONLY on tags in these conversation ids (C…, G…, D…)\n" +
  "  --thread-replies <C1,C2,…>  arm a listener that ALSO answers a reply under one of the bot's own posts,\n" +
  "                  in these channels only. Off by default. Recorded on the arm exactly as the scope is, so\n" +
  "                  `listen supervise` re-arms with it after a death — switching it off is a deliberate\n" +
  "                  `listen arm` without the flag, not letting the arm die.\n" +
  "  --dm-only       arm a listener that acts ONLY on 1:1 DM tags: prove the bot privately before going public.\n" +
  "                  Either scope is recorded on the arm, so `listen supervise` re-arms inside it after a death.\n" +
  "  --queue <path>  where captured tags are durably appended (default: $home/live/listener/queue.jsonl)";

/** `slopweaver listen status`'s usage line. */
export const LISTEN_STATUS_USAGE =
  "usage: slopweaver listen status [--home <dir>] [--json]\n" +
  "  Report the listener's liveness: unarmed, starting, reconnecting, healthy, or one of the five ways it can\n" +
  "  be down — process-dead, heartbeat-missing/foreign/stale, or socket-down (process alive, socket gone: the\n" +
  "  failure a pidfile check can never see) — AND which commit the loop is actually running: its bin and its\n" +
  "  plugin-dir, each with a HEAD, how far origin/main is ahead, and a grade. Exits 3 when the listener is\n" +
  "  DOWN or its freshness grades STALE, 0 when neither. Names the channels thread replies are answered in\n" +
  "  when any are, and prints nothing about them when none are.\n" +
  "  --json   the SUPERVISOR's shape, for a sweep that runs this every tick: a one-word grade\n" +
  "           (healthy/degraded/down/unarmed) with a one-sentence why, plus armId, pid, socketState, how\n" +
  "           long since Slack last sent anything, the deaths inside the re-arm window, the last death's\n" +
  "           reason AND the tail of that arm's log, whether an escalation is standing, threadReplyChannels\n" +
  "           (always present, `[]` when off), and the freshness block with every read it could not take.";

/** `slopweaver listen supervise`'s usage line. */
export const LISTEN_SUPERVISE_USAGE =
  "usage: slopweaver listen supervise [--queue <path>] [--home <dir>] [--json]\n" +
  "  ONE death-watch tick, for the loop session to run on its own poll. Judges liveness; on a death it\n" +
  `  journals it, counts the deaths, and answers: re-arm (printing the command to run) or — after\n` +
  `  ${String(MAX_DEATHS_PER_WINDOW)} deaths inside ${String(Math.round(REARM_WINDOW_MS / 60_000))} minutes — ESCALATE, leaving the bot deliberately DOWN with a\n` +
  "  question to record via `slopweaver handover ask`. That escalation STANDS: no later tick arms anything\n" +
  "  automatically until someone deliberately runs `slopweaver listen arm` or `slopweaver listen disarm`.\n" +
  "  Starts nothing itself: the session runs the command.";

/** `slopweaver listen disarm`'s usage line. */
export const LISTEN_DISARM_USAGE =
  "usage: slopweaver listen disarm [--home <dir>]\n" +
  "  Clear the arm record and journal it. Sends NO signal — the listener is the session's own process, and\n" +
  "  the session stops it the way it stops anything else. Idempotent: disarming nothing is success.\n" +
  "  It also clears the thread-reply channels, which live on that same record: if you intend to arm again,\n" +
  "  read them off `listen status` FIRST and repeat them when you arm.";

/** `slopweaver listen reconcile`'s usage line. */
export const LISTEN_RECONCILE_USAGE =
  "usage: slopweaver listen reconcile [--home <dir>] [--json]\n" +
  "  Back-write every listener death the arm journal implies but never recorded, from durable state alone.\n" +
  "  A death-watch that is a sibling background task of the listener dies WITH it, so nothing is alive to\n" +
  "  journal the death — measured three times over, which left 8 `armed` lines and 0 deaths. This\n" +
  "  verb needs nothing to have been watching: an arm that is DOWN with no terminal event gets one stamped\n" +
  "  at its last heartbeat, and an arm a later arm replaced with no terminal event in between gets one with\n" +
  "  reason `superseded` — which claims the arm ENDED, never how. Idempotent, so ticking it costs nothing\n" +
  "  when nothing is wrong. Starts nothing, signals nothing, and never escalates: `supervise` owns that.\n" +
  "  Exits 3 when it recorded at least one death, 0 when the journal was already complete.\n" +
  "  --json   the deaths it appended, plus the liveness verdict it read.";

/** The single usage line, printed on a parse error and by `--help`. */
export const LISTEN_USAGE =
  "usage: slopweaver listen [--check] [--once] [--emit] [--json] [--follow] [--deadline-ms <epoch>]\n" +
  "                          [--channels <C1,C2,…> | --dm-only] [--queue <path>] [--heartbeat <arm-id>]\n" +
  "                          [--thread-replies <C1,C2,…>] [--home <dir>]\n" +
  "  Opens a Socket Mode connection and captures the next message where the bot is ADDRESSED. Address means\n" +
  "  an EXPLICIT tag on both surfaces — an app_mention in a channel, or a 1:1 DM whose text tags the bot —\n" +
  "  plus, in a channel named by --thread-replies, a reply under one of the bot's OWN posts.\n" +
  "  Nothing else wakes it — not a group DM, not an untagged channel message, and not an untagged DM.\n" +
  "  An admitted address is emitted, not answered — answering is the calling session's job; see\n" +
  "  `/slopweaver:loop`. A non-whitelisted identity gets neither: a fixed, deterministic refusal reply,\n" +
  "  never a model-composed answer and never silence — see `responders.json` under $SLOPWEAVER_HOME.\n" +
  "  Refuses and exits when Slack's own `hello` reports a SECOND Socket Mode connection for this app — a tag\n" +
  "  can be delivered to either one, and only one will answer. Escape hatch, printed loudly when used:\n" +
  "  SLOPWEAVER_ALLOW_MULTIPLE_SOCKET_CONNECTIONS=1.\n" +
  "  --check  report the credentials and the one-time app setup, then exit without connecting\n" +
  "  --once   handle exactly one message, then close the connection and exit\n" +
  "  --emit   print the captured mention and answer nothing — the handoff `/slopweaver:loop` consumes.\n" +
  "           Implies --once: the mention is the whole output, so there is nothing to capture after it.\n" +
  "  --json   with --emit, print the mention as JSON; with --check, print the report as JSON\n" +
  "  --follow stay connected indefinitely, printing one JSON mention per line (JSONL) to stdout for EVERY\n" +
  "           tag captured, not just the first — the continuous alternative to --once for a caller that\n" +
  "           must never miss a tag while it is still answering the last one. Mutually exclusive with\n" +
  "           --once. Progress narration moves to stderr in this mode, so stdout stays pure JSONL.\n" +
  '           It also prints a {"kind":"witness"} line for each later message in a thread a person tagged\n' +
  '           this bot in ("ownThread":true, where `witness help` may answer unprompted) and, with profile\n' +
  "           slackBot.witnessBotHandles set, in a thread tagging one of those peer bots — silently, never an ask.\n" +
  "  --deadline-ms <epoch>  ALSO race a supplied Unix epoch-ms instant against a Slack address, valid only\n" +
  "           with --emit --json (no --follow, no --check). A past or current value wakes immediately. The\n" +
  '           winner is one discriminated JSON object — {"kind":"slack-address",...} or\n' +
  '           {"kind":"clock-wake","deadlineMs":...} — replacing the plain unwrapped mention this verb\n' +
  "           otherwise prints; without --deadline-ms, output is byte-for-byte unchanged. Progress narration\n" +
  "           moves to stderr in this mode too, for the same reason --follow's does.\n" +
  "  --queue <path>  ALSO append every captured tag as a JSONL line to <path> (created, and its parent\n" +
  "                  directory, if missing; fsync'd per line) — the durable copy a dead consumer can\n" +
  "                  still read off disk. Combines with any of the modes above.\n" +
  "  --channels <C1,C2,…>  act ONLY on a tag in these conversation ids (C…, G…, or a DM's D…). A tag anywhere\n" +
  "                  else is dropped before the responder whitelist: no reply, no reaction, no queue line,\n" +
  "                  nothing emitted, and it does not count for --once — so nothing is left stranded.\n" +
  "  --dm-only       act ONLY on a tag in a 1:1 DM, dropped the same way everywhere else. Prove the bot in a\n" +
  "                  DM before it goes live in public. Mutually exclusive with --channels.\n" +
  "  --thread-replies <C1,C2,…>  ALSO treat a reply under one of the bot's own posts as an address, in\n" +
  "                  these channels only. The thread ROOT must be a message this install's own bot user\n" +
  "                  wrote; a reply under anybody else's message, and anything not in a thread, takes the\n" +
  "                  refusal it always took. One thread wakes at most 4 replies a day. Off by default.\n" +
  "  --heartbeat <arm-id>  rewrite $SLOPWEAVER_HOME/live/listener/heartbeat.json every 15s, stamped with\n" +
  "                  <arm-id> and this process's own socket state, so a supervisor can tell 'process alive,\n" +
  "                  socket dead' from healthy. Set by `slopweaver listen arm`; valid only with --follow.";

/** How many days back the scan reaches when `--since` was not given. */
export const DEFAULT_LOOKBACK_DAYS = 3;

/** `slopweaver listen recover`'s usage line. */
export const LISTEN_RECOVER_USAGE =
  "usage: slopweaver listen recover --bot-user <U…> --channels <C1,C2,…> [--since <ISO|Nd>] [--home <dir>] [--json]\n" +
  "                                  [--scheduled [--deadline-ms <ms>]]\n" +
  "  Finds tags the bot never answered and filters them the way the owner asked: it skips anything already\n" +
  "  answered, too old, in a channel the bot does not answer in, or that was not addressed to it.\n" +
  "  Reports only — it runs no model and posts nothing.\n" +
  "  --bot-user   the bot's own Slack USER id. NOT a bot_id: a message the owner sends through the as-me\n" +
  "               token carries a bot_id too, so a bot_id test reports 'already answered' for threads the\n" +
  "               owner merely spoke in, and the tag stays dropped forever.\n" +
  `  --since      ISO-8601, or \`Nd\` for N days back. Defaults to ${String(DEFAULT_LOOKBACK_DAYS)}d.\n` +
  "               In --scheduled mode this is BOOTSTRAP-ONLY: refused once a durable watermark exists.\n" +
  "  --channels   REQUIRED, comma-separated. Reply ELIGIBILITY in every mode — the channels a survivor may\n" +
  "               be answered in. It is also the scan breadth, and every id on it is always read.\n" +
  "  --discover-channels  Manual mode only. WIDEN the scan breadth with the bot's own conversations.list\n" +
  "               membership, on top of --channels rather than instead of it — scopes filter that walk, so\n" +
  "               replacing the typed list would silently drop an id the walk cannot see. Use it for a\n" +
  "               widened gap pass: a typed list cannot know about a channel the bot joined yesterday, and\n" +
  "               one carried from shift to shift went blind to a private channel for a whole day.\n" +
  "               Complete-or-nothing — a truncated walk, one naming no conversation the bot may act in,\n" +
  "               and a token missing a read scope whose walk would omit a whole class while exhausting\n" +
  "               cleanly, all refuse rather than certifying a pass over what they did not read.\n" +
  "  --scheduled  Discovery scoped to the bot's own channel/DM membership, on the durable five-minute\n" +
  "               cadence. Requires --json and a Slack bot token (`slopweaver connect slack`).\n" +
  "  In manual mode a channel it could not READ makes the pass PARTIAL: the document carries completeness,\n" +
  "  scannedChannels of requestedChannels, failures (retry may fix) and excludedChannels (invite, or drop\n" +
  "  it from --channels), and a partial pass exits 1 even when it found survivors — take them anyway.\n" +
  "  --deadline-ms  Only with --scheduled --json. Races the next due sweep against a recipe deadline;\n" +
  "               whichever comes first wins, printing a `clock-wake` object if the deadline does.";
