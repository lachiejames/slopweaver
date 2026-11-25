/**
 * The closed list of verbs the console may run, and the only place an argv is ever assembled.
 *
 * This file is what makes operating-doctrine rule 2 structural rather than a promise. The route handler
 * takes a SLUG off the URL and looks it up here; nothing the URL carries is ever spliced into a command.
 * `store read`, `turn`, `cmux spawn` and every other verb that could launch a model are simply not in the map, so
 * "no model runs in the console" is a property of the data structure rather than of anyone's restraint.
 *
 * Rule 3 (one door) is kept the same way: every row runs the `slopweaver` VERB. The console never shells
 * `git`, never shells `gh`, and never reaches into `src/` or the store. A number no verb emits is a verb
 * that has to be written, not a shell line that gets added here.
 *
 * ## The two lanes, and why the split is not cosmetic
 *
 * MEASURED on this machine: `slopweaver fleet status --json` produced no output inside 180
 * seconds, and `slopweaver handover list` takes roughly six seconds on the live board because it scans
 * every doc and resolves each one's probes. A tile polling either of those is a tile that is usually
 * showing you the last answer while a request nobody can see is still running.
 *
 * So `lane` is a real contract. `fast` may be polled on a timer; `slow` is fetched once when a page opens
 * and again only when the reader asks, or on a timer of minutes where a page states why its reading must not age
 * (the Queue's board, `./queueRegisterPolls.ts`). Reproduce both numbers with
 * `time slopweaver fleet status --json` and `time slopweaver handover list --json`.
 *
 * The full board stays slow: measured over 10,220 docs it took 7.14s bare and printed 29 MB, which the
 * route then has to parse whole.
 *
 * ## `format` is a verb's declared shape, not a preference
 *
 * Two rows here print JSONL — one object per line — and that is the repo's `whole-file-json` rule rather
 * than an inconsistency between verbs. `src/cli/commands/autonomy/list.ts` says so in its own module doc:
 * the register it reads grows for as long as the installation runs, so a verb that stringified the whole
 * of it into one value would be the exact shape that rule refuses. The route therefore parses per
 * `format`, and the allowlist is where a verb's shape is declared beside its lane and its timeout.
 */

import { alignmentLiveVerbs } from "./liveVerbsAlignment";
import { plansLiveVerbs } from "./liveVerbsPlans";

/** Which cadence a verb may be read at. */
export type LiveLane = "fast" | "slow";

/** How a verb's stdout parses: one JSON document, or one object per line. */
export type LiveFormat = "json" | "jsonl";

/** One readable verb: what to run, how long to wait, and what a reader should call it. */
export interface LiveVerb {
  /** The URL segment. */
  readonly slug: string;
  /** The label a tile shows when it has to name its own source. */
  readonly title: string;
  /** The argv after the binary — a literal array, never built from input. */
  readonly argv: readonly string[];
  readonly lane: LiveLane;
  /**
   * How the verb's stdout parses. `jsonl` is one object per line, which several registers emit deliberately
   * — see § `format` above.
   */
  readonly format: LiveFormat;
  /** How long the child may run before the route reports a timeout instead of waiting. */
  readonly timeoutMs: number;
  /**
   * Whether the verb's own payload carries an `observedAtIso`. When it does not, the route stamps its own
   * receipt time and the tile must say the stamp is the route's — a reader who cannot tell the two apart
   * will read a cached number as a fresh one.
   */
  readonly stampsItsOwnTime: boolean;
  /**
   * The one non-zero exit this verb uses to ANSWER rather than fail, and the refusal code it means. The verb's own
   * `EXIT_EXPECTED_EMPTY` is a status, not a fault (`src/cli/exitCodes.ts`), so the runner hands it to the tile as a
   * typed {@link LiveExpectedEmpty} payload instead of a not-measured reading — and never by parsing stderr's words.
   */
  readonly expectedEmpty?: { readonly exitCode: number; readonly code: string };
}

/** The payload a verb's declared expected-empty exit becomes: which refusal it was, and the verb's own sentence. */
export interface LiveExpectedEmpty {
  readonly kind: "expected-empty";
  readonly code: string;
  readonly why: string;
}

/** Twenty seconds: long enough for a cold `session depth`, short enough that a tile says so rather than hangs. */
const FAST_TIMEOUT_MS = 20_000;

/** Ninety seconds. `handover list` scans every doc on the board and resolves each one's probes. */
const SLOW_TIMEOUT_MS = 90_000;

/**
 * Two hundred and forty seconds. MEASURED on an install whose read spanned two repositories:
 * the `@me` read over 44 open pull requests of the owner's, drafts in, took 146.5s — six tests per row, a local merge per
 * CONFLICTING row, a corpus scan for Slack asks, and GitHub's open census of each repository (7.4s of it) —
 * against 91s on a quieter day, so a 150s budget was one busy morning from timing out. The time grows with the
 * organisation's repository count. Reproduce with `time slopweaver github landing --author @me --json
 * --include-drafts`, whose bare read covers the organisation's repositories plus this build's.
 */
const LANDING_TIMEOUT_MS = 240_000;

/**
 * Every verb the console can read. Adding a row here is the only way to widen what the site may run.
 *
 * `fleet status --json` is deliberately ABSENT rather than present on the slow lane: it is the verb whose
 * name most invites use on the Fleet page, and at over 180 seconds it would make a "live" page a lie. The
 * same board's placement comes from `handover list --json`, which is the row below.
 *
 * MEASURED for three of these rows, and each measurement is what chose its
 * lane rather than a preference. Reproduce with `time slopweaver <the row's argv>`:
 *
 * - `hand list --json` answers in 3.4s over the open steps only, so it polls.
 * - `pane pr-status --json` answers in 10s, well inside the fast lane's timeout — and it is on the SLOW
 *   lane anyway, because the verb's own blurb declares its poll contract: "at most one `gh pr list` per
 *   repository per 60s while this page is open", budgeted at 60 calls of a 1000/hour share. A 20-second
 *   timer would triple the call rate the verb itself planned for, against a token every agent shares.
 * - `autonomy list --json` answers in 2.5s but printed 558 rows and 489,554 bytes on this machine, and
 *   "what was done without asking" is not a figure that moves inside a glance. Read once.
 */
export const LIVE_VERBS: readonly LiveVerb[] = [
  {
    argv: ["workstreams", "list", "--json"],
    // An install whose store holds no workstream and no register document yet exits 3, `NO_WORKSTREAMS`, to say so:
    // an answer, never a failed read (`workstreamsReading.ts` `readWorkstreamsReading`). A store refusal exits 1.
    expectedEmpty: { code: "NO_WORKSTREAMS", exitCode: 3 },
    format: "json",
    lane: "fast",
    slug: "workstreams",
    stampsItsOwnTime: false,
    timeoutMs: FAST_TIMEOUT_MS,
    title: "slopweaver workstreams list --json",
  },
  {
    // MEASURED on this machine: 1.78s over 65 rows and 987 slot-ledger files. Reproduce with
    // `time slopweaver automation status --json`.
    argv: ["recipe", "status", "--json"],
    format: "json",
    lane: "fast",
    slug: "automations",
    stampsItsOwnTime: true,
    timeoutMs: FAST_TIMEOUT_MS,
    title: "slopweaver automation status --json",
  },
  {
    // How current each provider's stored data is — the line the Slack and pull-request panels draw. MEASURED
    // on this machine: 3.04s wall, 3,789 bytes, 7 sources. Reproduce with
    // `time slopweaver automation freshness --json | wc -c`.
    argv: ["recipe", "freshness", "--json"],
    format: "json",
    lane: "fast",
    slug: "source-freshness",
    stampsItsOwnTime: true,
    timeoutMs: FAST_TIMEOUT_MS,
    title: "slopweaver automation freshness --json",
  },
  {
    argv: ["workstreams", "candidates", "--json"],
    format: "json",
    lane: "fast",
    slug: "workstream-candidates",
    stampsItsOwnTime: false,
    timeoutMs: FAST_TIMEOUT_MS,
    title: "slopweaver workstreams candidates --json",
  },
  {
    argv: ["session", "list", "--json"],
    format: "json",
    lane: "fast",
    slug: "sessions",
    stampsItsOwnTime: false,
    timeoutMs: FAST_TIMEOUT_MS,
    title: "slopweaver session list --json",
  },
  {
    argv: ["session", "depth", "--json"],
    format: "json",
    lane: "fast",
    slug: "depth",
    stampsItsOwnTime: true,
    timeoutMs: FAST_TIMEOUT_MS,
    title: "slopweaver session depth --json",
  },
  {
    argv: ["catalog", "--json"],
    format: "json",
    lane: "fast",
    slug: "catalog",
    stampsItsOwnTime: false,
    timeoutMs: FAST_TIMEOUT_MS,
    title: "slopweaver catalog --json",
  },
  // The sidebar's build status (`site/components/console/BuildStatus.tsx`). FAST, polled once a minute: 2.5s on a
  // read that finds the upstream fetched inside the last minute, 8.2s on the read that fetches it, measured
  // from the main checkout's `site/` — reproduce with `time ./bin/slopweaver checkout console --json` there.
  // The verb throttles its own `git fetch` to one a minute across every tab, so the poll cannot multiply it.
  {
    argv: ["checkout", "console", "--json"],
    format: "json",
    lane: "fast",
    slug: "build",
    stampsItsOwnTime: true,
    timeoutMs: FAST_TIMEOUT_MS,
    title: "slopweaver checkout console --json",
  },
  {
    // The organisation this install works for, read once per document by the console layout
    // (`./placementOrganisationLive.ts`): that one reading carries both the placement every page places its rows by
    // and the display name on the team label and provenance mark. The queue's refusal and stopping reports read it
    // again, once per request. Written once by `org set` and moved only by another, so never polled: 1.92s on an
    // unwritten store (MEASURED, `time ./bin/slopweaver org show --json`). An unwritten store is its exit
    // 3, `ORG_NOT_CONFIGURED`, which the console states rather than reading as a fault.
    argv: ["org", "show", "--json"],
    expectedEmpty: { code: "ORG_NOT_CONFIGURED", exitCode: 3 },
    format: "json",
    lane: "slow",
    slug: "organisation",
    stampsItsOwnTime: false,
    timeoutMs: SLOW_TIMEOUT_MS,
    title: "slopweaver org show --json",
  },
  // SLOW rather than fast, and the number is why: this verb reads every non-test `.ts` file under `src/`
  // and takes 6.7s against `catalog --json`'s 4.6s on this machine (`time ./bin/slopweaver catalog trees
  // --json`). It is well inside the fast timeout, but the lane is a CADENCE contract — a four-thousand-file
  // walk on a timer is exactly the tile that is always showing you the last answer.
  {
    argv: ["catalog", "trees", "--json"],
    format: "json",
    lane: "slow",
    slug: "trees",
    stampsItsOwnTime: false,
    timeoutMs: SLOW_TIMEOUT_MS,
    title: "slopweaver catalog trees --json",
  },
  {
    // The Fleet page's folded history of its own state: the supervisor tick ledger read from its end. MEASURED
    // at 4.6s wall for a day, 5.1s and 1,697,191 bytes for a week over 397 ticks of a 250 MB ledger (`time
    // slopweaver fleet history --hours 168 --json | wc -c`). Inside the fast timeout, but a tick lands every twenty
    // minutes or so, so a page reads it once when it opens.
    argv: ["fleet", "history", "--hours", "24", "--json"],
    format: "json",
    lane: "slow",
    slug: "fleet-history",
    stampsItsOwnTime: true,
    timeoutMs: SLOW_TIMEOUT_MS,
    title: "slopweaver fleet history --hours 24 --json",
  },
  {
    // Slow, yet an open Queue re-reads it once a minute (`./queueRegisterPolls.ts`): read once per mount, a Queue left
    // open draws asks 18 hours old. Twenty seconds is ruled out by the cost stated there.
    argv: ["handover", "list", "--json"],
    format: "json",
    lane: "slow",
    slug: "board",
    stampsItsOwnTime: true,
    timeoutMs: SLOW_TIMEOUT_MS,
    title: "slopweaver handover list --json",
  },
  {
    // 2.23s wall MEASURED with `time ./bin/slopweaver queue list --json`, one item held for weeks; the register is a local ledger and the panel matches a thread to it by channel and thread ts.
    argv: ["queue", "list", "--json"],
    format: "json",
    lane: "fast",
    slug: "drafts",
    stampsItsOwnTime: false,
    timeoutMs: FAST_TIMEOUT_MS,
    title: "slopweaver queue list --json",
  },
  {
    // The as-me draft register: a message composed under the owner's name and parked, nothing sent. A local JSONL
    // fold plus a member-bronze read to name its ids, with no Slack call at all, so it sits on the fast lane
    // beside `queue list` above — the row it is
    // a sibling of. The two registers are deliberately separate verbs: one holds a reply the door withheld,
    // this one holds a post nobody has decided to make.
    argv: ["slack", "draft", "list", "--json"],
    format: "json",
    lane: "fast",
    slug: "slack-drafts",
    stampsItsOwnTime: false,
    timeoutMs: FAST_TIMEOUT_MS,
    title: "slopweaver slack draft list --json",
  },
  {
    // When each draft the owner reviewed went out — the Alignment page's baseline under the Slack-steers chart. The same
    // local JSONL fold as the row above, so the same lane.
    argv: ["slack", "draft", "corrections", "--json"],
    format: "json",
    lane: "fast",
    slug: "slack-draft-corrections",
    stampsItsOwnTime: false,
    timeoutMs: FAST_TIMEOUT_MS,
    title: "slopweaver slack draft corrections --json",
  },
  {
    // Which kind of correction each turn of the owner's names about Slack drafts — the Alignment page's chart. SLOW: it reads
    // every turn of the owner's in sixty days through `profile words`' own gather. MEASURED at 37.2s wall
    // (`/usr/bin/time -p slopweaver profile steers --json`), so it is read once when the page opens.
    argv: ["profile", "steers", "--json"],
    format: "json",
    lane: "slow",
    slug: "slack-steers",
    stampsItsOwnTime: true,
    timeoutMs: SLOW_TIMEOUT_MS,
    title: "slopweaver profile steers --json",
  },
  {
    // Each time what reads as the console's own progress line cut into an answer the voice was giving — the Alignment
    // page's cut-ins chart, under the Slack one. It reads every call file touched in sixty days, a cost that grows with the owner's calls:
    // MEASURED at 1.33s wall over 146 calls (`/usr/bin/time -p slopweaver talk cut-ins --json`). A weekly
    // chart has nothing to gain from a re-read every few seconds, so an open page re-reads it every five minutes.
    argv: ["talk", "cut-ins", "--json"],
    format: "json",
    lane: "slow",
    slug: "scripted-cut-ins",
    stampsItsOwnTime: true,
    timeoutMs: SLOW_TIMEOUT_MS,
    title: "slopweaver talk cut-ins --json",
  },
  {
    // The review-draft register: the owner's review of somebody else's pull request, parked as line comments with the
    // hunk each sits on, nothing posted. A local JSONL fold with no GitHub call — the hunks were captured when it
    // was recorded — so it sits on the fast lane beside its Slack sibling above.
    argv: ["github", "review-draft", "list", "--json"],
    format: "json",
    lane: "fast",
    slug: "review-drafts",
    stampsItsOwnTime: false,
    timeoutMs: FAST_TIMEOUT_MS,
    title: "slopweaver github review-draft list --json",
  },
  {
    // The staged import questions: one unanswered question per row a `store import --approve` staged and could not
    // apply on its own. A store read with no provider call, so it sits on the fast lane beside the review drafts; the
    // report carries its own `observedAtIso`.
    argv: ["store", "import-questions", "--json"],
    format: "json",
    lane: "fast",
    slug: "import-questions",
    stampsItsOwnTime: true,
    timeoutMs: FAST_TIMEOUT_MS,
    title: "slopweaver store import-questions --json",
  },
  {
    argv: ["hand", "list", "--json"],
    format: "jsonl",
    lane: "fast",
    slug: "hands",
    stampsItsOwnTime: false,
    timeoutMs: FAST_TIMEOUT_MS,
    title: "slopweaver hand list --json",
  },
  {
    // Value-free by construction (`src/secrets/status.ts`): name, stored, mode, when written — what a paste field's
    // receipt reads after a reload, so "set" survives the page rather than living in one press's response. `--all`
    // because the fields a connect affordance opens are exactly the ABSENT rows, which the default view leaves out, and
    // each field's hint is that row's `what` (`components/console/ConnectIntegration.tsx`).
    argv: ["secrets", "status", "--all", "--json"],
    format: "json",
    lane: "fast",
    slug: "secrets",
    stampsItsOwnTime: false,
    timeoutMs: FAST_TIMEOUT_MS,
    title: "slopweaver secrets status --all --json",
  },
  {
    argv: ["pane", "pr-status", "--json"],
    format: "json",
    lane: "slow",
    slug: "prs",
    // Its own instant is `measuredAtIso`, and it is a Measured wrapper rather than a bare string, so the
    // route cannot read it — the tile surfaces it separately and says which stamp is which.
    stampsItsOwnTime: false,
    timeoutMs: SLOW_TIMEOUT_MS,
    title: "slopweaver pane pr-status --json",
  },
  {
    argv: ["github", "landing", "--author", "@me", "--json", "--include-drafts"],
    format: "json",
    lane: "slow",
    slug: "landing",
    // The verb prints no instant of its own. `@me` is GitHub's own token-relative author, and a bare read covers
    // the organisation's own repositories plus this build's, so neither a login nor a repository is ever a
    // constant in this tree (AGENTS.md § tools in the codebase, state outside it).
    stampsItsOwnTime: false,
    timeoutMs: LANDING_TIMEOUT_MS,
    title: "slopweaver github landing --author @me --json --include-drafts",
  },
  {
    argv: ["reading", "last", "--producer", "github landing", "--json"],
    format: "json",
    lane: "fast",
    slug: "landing-reading",
    // The LAST reading of `github landing` anyone recorded — the supervisor tick, a seat, the page itself — as the
    // bytes that run printed, with who took it. `observedAtIso` is the instant the document was true, so
    // the stamp ages the READING, never the fetch of it; exit 3 is "no reading yet", which the tile prints
    // in the verb's own words rather than as an empty list.
    stampsItsOwnTime: true,
    timeoutMs: FAST_TIMEOUT_MS,
    title: 'slopweaver reading last --producer "github landing" --json',
  },
  {
    // 1.82s wall, MEASURED with `time ./bin/slopweaver github reviewer list --json` over 30 open
    // pull requests: the last landing reading joined with the reviewer register, no GitHub or Slack call, so
    // it polls. `observedAtIso` is the instant of the join; the document also names the landing reading it
    // joined, which the page compares with its own. Exit 3 is "no landing reading yet".
    argv: ["github", "reviewer", "list", "--json"],
    format: "json",
    lane: "fast",
    slug: "reviewers",
    stampsItsOwnTime: true,
    timeoutMs: FAST_TIMEOUT_MS,
    title: "slopweaver github reviewer list --json",
  },
  {
    // The owner's standing asks, which every Queue card no particular steer of theirs produced quotes (`./standingAskSource.ts`).
    // One small journal read; a defect is published as a reading, exit 0, so the cards can say why.
    argv: ["profile", "standing", "--json"],
    format: "json",
    lane: "fast",
    slug: "standing-asks",
    stampsItsOwnTime: false,
    timeoutMs: FAST_TIMEOUT_MS,
    title: "slopweaver profile standing --json",
  },
  // The recorded readings the state pages read — seats, the board reconcile, the listener and the
  // machine's capacity — and why every one is a LEDGER read rather than the verb itself.
  // MEASURED: `session watch --json-report` spawned from the live route printed NOTHING on
  // exit 0, twice, while the same argv from a shell printed 6,141 bytes minutes earlier. The verb is a
  // cursor DRAIN — it reads the cmux events after its stored cursor and advances it (`cmux_event_state`)
  // — so its stdout is only what arrived since the last drain, and a page polling it every twenty seconds
  // would draw an empty list most of the time. So the page reads the ledger: `supervisor tick-capture`
  // records every one of these as a reading while a tick runs, and the Fleet page's opening refresh records
  // its own seat and burn readings through the sync route (`syncVerbs.ts`), once per opening, never on this poll.
  // Reproduce the empty drain with `slopweaver session watch --json-report; slopweaver session watch --json-report`.
  {
    argv: ["reading", "last", "--producer", "session watch", "--json"],
    // A supervisor that has never recorded a session check leaves no reading, and the verb exits 3, `NO_READING`, to
    // say so: an answer the Fleet page draws as its empty state, never a failed read (`../components/live/reading.ts`).
    expectedEmpty: { code: "NO_READING", exitCode: 3 },
    format: "json",
    lane: "fast",
    slug: "watch-reading",
    // The last recorded drain — the tick's or the page's own opening refresh — as the bytes it printed: every open
    // seat by signal, judged at the document's `observedAtIso`, which is the instant the reading carries and the tile ages.
    stampsItsOwnTime: true,
    timeoutMs: FAST_TIMEOUT_MS,
    title: 'slopweaver reading last --producer "session watch" --json',
  },
  {
    argv: ["reading", "last", "--producer", "handover reconcile", "--json"],
    format: "json",
    lane: "fast",
    slug: "reconcile-reading",
    // The tick's own reconciliation, as the bytes it printed. The verb itself is NEVER a page's to run:
    // `time slopweaver handover reconcile --json` is 8.6s wall on this machine and its document runs past
    // two megabytes, so a page polling it would pay the tick's cost a second time and read a different
    // instant than the tick did.
    stampsItsOwnTime: true,
    timeoutMs: FAST_TIMEOUT_MS,
    title: 'slopweaver reading last --producer "handover reconcile" --json',
  },
  {
    argv: ["reading", "last", "--producer", "handover wake", "--json"],
    format: "json",
    lane: "fast",
    slug: "wake-reading",
    // The tick's own wake, as the bytes it printed: what each park's pull request WAS when the tick read it — CI still
    // running, finished, merged or closed — which the Fleet page splits its "parked on CI" count by. The verb is never a
    // page's to run: it reads every parked pull request off GitHub and may reseat seats. MEASURED at 21,758
    // bytes over 16 parks (`slopweaver reading last --producer "handover wake" --json | wc -c`).
    stampsItsOwnTime: true,
    timeoutMs: FAST_TIMEOUT_MS,
    title: 'slopweaver reading last --producer "handover wake" --json',
  },
  {
    argv: ["reading", "last", "--producer", "handover currency", "--json"],
    format: "json",
    lane: "fast",
    slug: "currency-reading",
    // Whether each Queue card is still the owner's: the latest recorded check, the tick's or the Queue opening's. The verb
    // reads Slack threads, GitHub bodies and the chair's transcripts, so it is never a poll here: the Queue takes one
    // through the closed sync row once per opening (`syncVerbs.ts`, `currencyOpeningRefresh.ts`), and this row reads
    // when the check ran, which is what the card says.
    stampsItsOwnTime: true,
    timeoutMs: FAST_TIMEOUT_MS,
    title: 'slopweaver reading last --producer "handover currency" --json',
  },
  {
    argv: ["reading", "last", "--producer", "listen status", "--json"],
    format: "json",
    lane: "fast",
    slug: "listener-reading",
    stampsItsOwnTime: true,
    timeoutMs: FAST_TIMEOUT_MS,
    title: 'slopweaver reading last --producer "listen status" --json',
  },
  {
    argv: ["reading", "last", "--producer", "machine capacity", "--json"],
    format: "json",
    lane: "fast",
    slug: "capacity-reading",
    // `machine capacity --json` exits 1 on a finding and prints its document anyway; each pass records the full
    // document off its step-8 read (`--record-reading tick-<n>`), so the page reads the verdict without reasoning
    // about the exit at all, and never takes a reading of its own.
    stampsItsOwnTime: true,
    timeoutMs: FAST_TIMEOUT_MS,
    title: 'slopweaver reading last --producer "machine capacity" --json',
  },
  {
    // The Fleet page's Past charts: the last hour of the machine, sampled by the verb itself rather than by a tick,
    // while Now's two-second live figures are the console's own read (`site/lib/liveMachineRead.ts`), never this row,
    // because the tick's `machine capacity` reading lands every 30 to 50 minutes and costs 16s to take. A poll inside
    // the verb's thirty-second gap prints the kept ring and runs no `top`, and a lock makes two pages share one
    // sample. MEASURED at load 23.9 on 15 cores: 3.93s wall when a sample was due, 1.54s when it was not,
    // about 2 KB a sample. Reproduce with `time slopweaver machine series --json | wc -c`.
    argv: ["machine", "series", "--json"],
    format: "json",
    lane: "fast",
    slug: "machine-series",
    stampsItsOwnTime: true,
    timeoutMs: FAST_TIMEOUT_MS,
    title: "slopweaver machine series --json",
  },
  {
    argv: ["reading", "last", "--producer", "fleet ceiling", "--json"],
    format: "json",
    lane: "fast",
    slug: "ceiling-reading",
    // The working seats the plans' week carries, as the tick measured it and the supervisor fills to — the
    // figure the Fleet page's glance sets the working seats against (`lib/fleetGlance.ts`).
    stampsItsOwnTime: true,
    timeoutMs: FAST_TIMEOUT_MS,
    title: 'slopweaver reading last --producer "fleet ceiling" --json',
  },
  {
    argv: ["reading", "last", "--producer", "fleet why", "--json"],
    format: "json",
    lane: "fast",
    slug: "why-reading",
    // Why the fleet is not running more working seats and what the machine measured over the last hour, as the tick
    // judged it — the sentences under the Fleet page's glance verdict (`components/live/Now.tsx`).
    stampsItsOwnTime: true,
    timeoutMs: FAST_TIMEOUT_MS,
    title: 'slopweaver reading last --producer "fleet why" --json',
  },
  {
    argv: ["reading", "last", "--producer", "fleet burn", "--json"],
    format: "json",
    lane: "fast",
    slug: "burn-reading",
    // Each host's tokens over the last 24 hours, the seven-day amount at that rate and the sessions drawing now, as
    // the tick or the Fleet page's own opening refresh measured them — the burn line under each host on the Fleet
    // page's plan usage (`lib/planMeters.ts`).
    stampsItsOwnTime: true,
    timeoutMs: FAST_TIMEOUT_MS,
    title: 'slopweaver reading last --producer "fleet burn" --json',
  },
  {
    argv: ["github", "watchers", "--json"],
    format: "json",
    lane: "fast",
    slug: "watchers",
    // A fold of the checks-read register under the home, no GitHub call: which sessions hold
    // `github checks --wait` on each pull request, and the last read of each. `observedAtIso` is the
    // instant the register was folded, so the stamp is the verb's own, and the STALE rule is the verb's
    // too — the page never judges a watcher's age itself.
    stampsItsOwnTime: true,
    timeoutMs: FAST_TIMEOUT_MS,
    title: "slopweaver github watchers --json",
  },
  {
    // 2.46s wall for 94 GitHub members, MEASURED with
    // `time ./bin/slopweaver identity avatars --source github --json`; the Slack roster is 5,336 rows and
    // 1.4 MB, so the row narrows to the one source the pull-request page draws. A member index changes
    // when someone joins, which is why this is read once.
    argv: ["identity", "avatars", "--source", "github", "--json"],
    format: "json",
    lane: "slow",
    slug: "avatars",
    stampsItsOwnTime: false,
    timeoutMs: SLOW_TIMEOUT_MS,
    title: "slopweaver identity avatars --source github --json",
  },
  {
    argv: ["autonomy", "list", "--json"],
    format: "jsonl",
    lane: "slow",
    slug: "autonomy",
    stampsItsOwnTime: false,
    timeoutMs: SLOW_TIMEOUT_MS,
    title: "slopweaver autonomy list --json",
  },
  {
    // What landed on main, each change beside the owner's words and its proof — the Fleet page's Past view. MEASURED
    // on this machine: 3.1s over 30 landings and 2,392 PR-ledger records, most of it reading the ledger whole.
    // Slow by that wall clock. Reproduce with `time slopweaver fleet landed --json`.
    argv: ["fleet", "landed", "--json"],
    format: "json",
    lane: "slow",
    slug: "landed",
    stampsItsOwnTime: true,
    timeoutMs: SLOW_TIMEOUT_MS,
    title: "slopweaver fleet landed --json",
  },
  {
    // MEASURED on this machine: 5.4s — a scan of 5,828 board rows, the run journal of every row that may
    // be a steer, and two repositories' main history back to the oldest steer. A whole-board walk, so read once. Reproduce with
    // `time slopweaver handover steers --json`.
    argv: ["handover", "steers", "--json"],
    format: "json",
    lane: "slow",
    slug: "steers",
    stampsItsOwnTime: true,
    timeoutMs: SLOW_TIMEOUT_MS,
    title: "slopweaver handover steers --json",
  },
  // The three rows below, MEASURED through `./bin/slopweaver`, and every one is
  // SLOW. Two of them are slow for the reason `catalog trees` above is — a whole-tree walk belongs on a
  // read-once lane whatever its wall clock says — and the third is slow for the opposite reason, which is
  // worth stating because it is the case the lane contract is easiest to get wrong on.
  {
    // 6.46s: reads every non-test `.ts` under `src/`, every committed baseline, and one `git log` per
    // baseline for its trend. Reproduce with `time ./bin/slopweaver catalog health --json`.
    argv: ["catalog", "health", "--json"],
    format: "json",
    lane: "slow",
    slug: "health",
    stampsItsOwnTime: true,
    timeoutMs: SLOW_TIMEOUT_MS,
    title: "slopweaver catalog health --json",
  },
  {
    // 4.63s: walks every home register it is asked to measure AND opens one database connection for
    // its row counts. Reproduce with `time ./bin/slopweaver store share --json`. The two directories it
    // declines to walk are why it is seconds rather than minutes — `src/store/homeShare.ts` § measure.
    argv: ["store", "share", "--json"],
    format: "json",
    lane: "slow",
    slug: "share",
    stampsItsOwnTime: true,
    timeoutMs: SLOW_TIMEOUT_MS,
    title: "slopweaver store share --json",
  },
  {
    // 2.93s, nearly all of it process start-up: it reads one small ledger. FAST would be well inside the
    // timeout and still wrong — the lane is a CADENCE contract, and "how long since the last hygiene pass"
    // moves at most a few times a day, so a 20-second timer would re-read an unchanged date 4,000 times
    // to catch one change. Reproduce with `time ./bin/slopweaver memory passes --json`.
    argv: ["memory", "passes", "--json"],
    format: "json",
    lane: "slow",
    slug: "hygiene",
    stampsItsOwnTime: true,
    timeoutMs: SLOW_TIMEOUT_MS,
    title: "slopweaver memory passes --json",
  },
  {
    // 1.30s, one small directory read. SLOW for its cadence, not its cost: an earlier call is finished, so one read on mount is the contract, and a
    // timer would only spawn during the next call. Reproduce with `time ./bin/slopweaver talk calls --json`.
    argv: ["talk", "calls", "--json"],
    format: "json",
    lane: "slow",
    slug: "talk-calls",
    stampsItsOwnTime: true,
    timeoutMs: SLOW_TIMEOUT_MS,
    title: "slopweaver talk calls --json",
  },
  {
    // SLOW for its cadence: the earlier conversation the messenger and the stage open on changes only when a
    // conversation ends, so it is read on mount and re-read when the next one opens (`./chatThread.ts`). Reproduce
    // with `time ./bin/slopweaver talk thread --json`.
    argv: ["talk", "thread", "--json"],
    format: "json",
    lane: "slow",
    slug: "talk-thread",
    stampsItsOwnTime: true,
    timeoutMs: SLOW_TIMEOUT_MS,
    title: "slopweaver talk thread --json",
  },
  {
    // `--routed` reads the register row a Talk call would spend, routed by `talk offer`'s own decision, so the row
    // never reports one plan while the call spends another. That is TWO live account batches in sequence — the
    // route's fleet read, then the routed store's own — past FAST_TIMEOUT_MS, so it takes SLOW_TIMEOUT_MS.
    // Both batches share ONE deadline, `ROUTED_QUOTA_DEADLINE_MS` (60s,
    // `src/cli/commands/codex/quotaRun.ts`), so a register of any size answers inside this timeout, a store past it
    // reported unreadable. MEASURED: 12.0s wall on five registered stores,
    // every one answering. FAST lane because
    // a call spends from the plan it reads: the call widget's "plan left" row (`../components/voice/CallPlanSettings.tsx`)
    // polls it every five minutes, and a poll falling during a call waits for hang-up (`../lib/liveQuiet.ts`).
    // Reproduce with `time ./bin/slopweaver codex quota show --routed`.
    argv: ["codex", "quota", "show", "--routed"],
    format: "json",
    lane: "fast",
    slug: "codex-quota",
    stampsItsOwnTime: false,
    timeoutMs: SLOW_TIMEOUT_MS,
    title: "slopweaver codex quota show --routed",
  },
  {
    // Every registered plan's recorded weekly usage, its reset and whether it needs a sign-in — the desktop menu bar's
    // plan lines (`desktop/src/planUsageShell.ts`). Local reads only, NO model-host call: the gauge snapshots, the probe
    // records, each Codex store's rollout logs (`src/plans/planUsageRead.ts`). MEASURED on this machine's
    // home, nine plans: 7.37s wall, 6.57s CPU, most of it the rollout scan. FAST lane because the menu bar polls it,
    // every five minutes for that CPU. An empty register exits 3. Reproduce with
    // `/usr/bin/time -p ./bin/slopweaver plans usage --json`.
    argv: ["plans", "usage", "--json"],
    expectedEmpty: { code: "NO_PLANS", exitCode: 3 },
    format: "json",
    lane: "fast",
    slug: "plan-usage",
    stampsItsOwnTime: true,
    timeoutMs: FAST_TIMEOUT_MS,
    title: "slopweaver plans usage --json",
  },
  {
    // One small append-only file read. FAST because it is a filter over the queue: a card the owner's words just landed on
    // should leave inside one poll, not at the next page open. Reproduce with `time ./bin/slopweaver talk cards --json`.
    argv: ["talk", "cards", "--json"],
    format: "json",
    lane: "fast",
    slug: "talk-cards",
    stampsItsOwnTime: true,
    timeoutMs: FAST_TIMEOUT_MS,
    title: "slopweaver talk cards --json",
  },
  {
    // MEASURED: 0.79s wall on this machine's home, one small append-only file. FAST because it orders the
    // queue: a card the owner just put off should step aside inside one poll. Reproduce with
    // `time ./bin/slopweaver queue deferred --json`.
    argv: ["queue", "deferred", "--json"],
    format: "json",
    lane: "fast",
    slug: "queue-deferred",
    stampsItsOwnTime: true,
    timeoutMs: FAST_TIMEOUT_MS,
    title: "slopweaver queue deferred --json",
  },
  {
    // MEASURED: 5.7s wall on this machine's home against 4.4s for `talk cards`, both startup-bound — the
    // relay ledger, the landings, the intake marks, and the chair's tick ledger only as an 8 MiB tail and only while
    // a steer is waiting. FAST because it decides whether a card the owner just steered stays collapsed or comes back, so a
    // verdict should land inside one poll. Reproduce with `time ./bin/slopweaver talk steers --json`.
    argv: ["talk", "steers", "--json"],
    format: "json",
    lane: "fast",
    slug: "talk-steers",
    stampsItsOwnTime: true,
    timeoutMs: FAST_TIMEOUT_MS,
    title: "slopweaver talk steers --json",
  },
  {
    // MEASURED: 8.3s wall on this machine's home — a fortnight of calls, console steers and supervisor
    // turns. SLOW because a lap is counted in half hours and days, so a minute's lag never changes a card's count.
    // Reproduce with `time ./bin/slopweaver talk laps --json`.
    argv: ["talk", "laps", "--json"],
    format: "json",
    lane: "slow",
    slug: "talk-laps",
    stampsItsOwnTime: true,
    timeoutMs: SLOW_TIMEOUT_MS,
    title: "slopweaver talk laps --json",
  },
  // Settings → Models' two reads, written in `./liveVerbsPlans.ts`.
  ...plansLiveVerbs({ fastTimeoutMs: FAST_TIMEOUT_MS }),
  // The Alignment page's four reads, written in `./liveVerbsAlignment.ts`.
  ...alignmentLiveVerbs({ slowTimeoutMs: SLOW_TIMEOUT_MS }),
] as const;

/**
 * Look one verb up by the slug a URL carried.
 *
 * @param slug the path segment, straight off the request and never trusted further than this lookup
 * @returns the row, or `undefined` when the slug names nothing — which the route answers with a 404
 */
export function liveVerbFor({ slug }: { slug: string }): LiveVerb | undefined {
  return LIVE_VERBS.find((verb) => verb.slug === slug);
}
