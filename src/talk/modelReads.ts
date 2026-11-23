/**
 * Which `slopweaver` verbs the console voice may run by name — the closed, fail-closed list behind its `verb`
 * tool, and the pure resolver that turns one request into the argv the gateway runs.
 *
 * ## Why a curated list, and not the manifest's `effect`
 *
 * The voice must be able to call all the different slopweaver verbs that everything else in the setup can call. The
 * caller here is a MODEL that
 * has just read third-party text, so what it can call is what a page, a row or a pull request could ask it to
 * call. `CommandMeta.effect` cannot carry that decision: `github checks` is `external-read` and appends a ledger
 * row, `talk offer` is `external-read` and mints a model session, and `handover list` is `local-state` and runs
 * every doc's `command:` probe. Each row below was
 * traced to its run module and found to write nothing, spawn nothing and finish on its own — bar the two kept
 * knowingly and named in {@link MODEL_READS}'s own comment, where no argument aims what is written; a verb that is not
 * on it is refused, so a new verb is unreachable until somebody adds it here, deliberately, in a diff.
 *
 * ## What else holds
 *
 * - **Flags that choose a path or a lifetime are refused on every row** ({@link REFUSED_FLAGS}): `--home` would
 *   aim a read at another state home, `--dir`/`--file`/`--out` at an arbitrary path, `--follow`/`--wait` at a
 *   read that never ends, and the write-shaped ones (`--apply`, `--record`, …) at the half of a verb that acts.
 * - **A noun whose verbs take a subverb** (`atlas jumpcloud read`) lists the subverbs it allows, and the first
 *   argument must be one of them, so `atlas jumpcloud sync` is refused though `atlas jumpcloud read` is not.
 * - **The gateway runs the verb as a child `slopweaver` process** (`cli/commands/talk/verbRun.ts`), so every
 *   standing ruling gate, the stale-seat warning and the verb's own parser apply exactly as from a seat.
 * - **This list is what the voice says it can run**: `./voiceReach.ts` derives both prompts' reach lines and
 *   `talk capabilities` from it, so a row added here is offered, and a refused verb is explained, with no second edit.
 */
import { canonicalNoun } from "../cli/nounAliases.js";
import { err, ok, type Result } from "../lib/result.js";

/** One verb the voice may run. */
export interface ModelRead {
  readonly noun: string;
  readonly verb: string;
  /** When set, the first argument must be one of these (the verb's own subcommand). */
  readonly subverbs?: readonly string[];
  /** Flags refused on this row only — one whose name is harmless elsewhere but takes a directory here. */
  readonly refuses?: readonly string[];
  /** What the voice reaches for it to answer, for the prompt's list. */
  readonly for: string;
  /**
   * Set on a read of the local corpus, which holds every ingested source hours behind. The reach inventory
   * (`./voiceReach.ts`) offers it under each source's own noun — `store query --source slack` is how the voice reads
   * a Slack channel's OLDER history, hours behind. A channel's latest is the `slack_channel` tool's, read live
   * (`./slackToolSchemas.ts`).
   */
  readonly readsCorpus?: true;
}

/**
 * Every verb the voice may run. Traced: each writes nothing under any flag outside
 * {@link REFUSED_FLAGS}, spawns no model, session, browser or server, and ends on its own. Six candidates were
 * traced and left off because they do not: `slack read-thread` and `slack read-file` save attachments,
 * `store hits` and `store around` append a Datadog hit cache, `hand list` settles pending markers, and
 * `github review-state`/`github bottleneck` fetch into a checkout. `handover list`/`prune` run probe commands; `talk find-card` is
 * the whole-board read the voice runs instead, composing only the rows the owner's words reach and running no `command:` probe.
 *
 * **Two exceptions are kept, knowingly, and this is the first**: a `gmail`, `calendar` or `drive` read whose access token has expired refreshes
 * it and rewrites that product's own grant under `$SLOPWEAVER_HOME/secrets/` (`src/secrets/googleGrant.ts`), exactly
 * as the same read does from a seat. It is the credential keeping itself current, not a state the model can aim —
 * no argument changes what is written or where — which is the line the `store hits` cache write is on the wrong
 * side of.
 *
 * **The second: `codex route` keeps a child and a provider write, knowingly, on the same line.** A measured call showed
 * the owner asking the voice what the Codex plans had left: it tried `codex quota`, was refused, and told the owner
 * it could not see the meter — while every plan sat at its weekly cap. `codex route` is that meter: per plan, the week
 * used, when it resets, why it is excluded and the free resets held. What it keeps, all of it what the same verb
 * does from a seat and every Codex pass does on its way in:
 *
 * - ONE bounded `spawnSync` reaching each store's vendored `codex app-server` with `account/read` and
 *   `account/rateLimits/read` (`../codex/accountLive.ts`) — no model turn. The read grows with the register, so
 *   the gateway hands its kill instant down (`../lib/childDeadline.ts`) and the batch sizes itself to answer before
 *   it, keeping its standing cleanup margin; no rollout log is opened under that deadline — no gauge scan, no
 *   quota tail — and every row says so (`../codex/fleetRead.ts`);
 * - the app-server's own `installation_id` and SQLite state inside the store it was launched into;
 * - one `codex_sign_in_observation` row per store in this home's local store (`../codex/fleetRead.ts`), whose
 *   contents are the provider's answer. The store's `codex_fleet_cap` row is never filed from here: a read under a
 *   deadline files none.
 *
 * No argument changes what is written or where — `--home` is refused on every row — which is the Google refresh's line.
 */
export const MODEL_READS: readonly ModelRead[] = [
  {
    for: "one issue or pull request in full: state, merged, body, activity, comments; --files adds whether its diff is already on its base",
    noun: "github",
    verb: "read",
  },
  {
    for: "one pull request's standing: who approved (people vs bots), who is asked, what its base requires, CI, CodeRabbit, merge",
    noun: "github",
    subverbs: ["standing"],
    verb: "pr",
  },
  { for: "find issues or pull requests by words", noun: "github", verb: "search" },
  { for: "what a failed CI job printed", noun: "github", verb: "run-log" },
  {
    for: "the owner's own open pull requests, ranked, with why each is blocked",
    noun: "pane",
    refuses: ["--repo"],
    verb: "pr-status",
  },
  { for: "one Linear issue, project or document", noun: "linear", verb: "read" },
  { for: "find Linear issues and projects by words", noun: "linear", verb: "search" },
  { for: "one Notion page or database", noun: "notion", verb: "read" },
  { for: "the owner's mail, metadata only", noun: "gmail", verb: "list" },
  { for: "one message or thread in full", noun: "gmail", verb: "read" },
  { for: "events in a window", noun: "calendar", verb: "list" },
  { for: "one event in full", noun: "calendar", verb: "read" },
  { for: "open stretches across calendars", noun: "calendar", verb: "free" },
  { for: "Drive files, metadata only", noun: "drive", verb: "list" },
  { for: "one Drive file, with a document's text", noun: "drive", verb: "read" },
  { for: "log events counted by service and status", noun: "datadog", verb: "logs" },
  { for: "APM spans counted by service, operation and resource", noun: "datadog", verb: "apm" },
  { for: "one grouped metrics query", noun: "datadog", verb: "metrics" },
  { for: "one metrics query across two environments", noun: "datadog", verb: "compare-envs" },
  { for: "browser (RUM) events", noun: "datadog", verb: "rum" },
  { for: "CI pipeline events", noun: "datadog", verb: "ci" },
  { for: "test events", noun: "datadog", verb: "tests" },
  { for: "database query samples", noun: "datadog", verb: "dbm" },
  { for: "profiles by service", noun: "datadog", verb: "profiles" },
  { for: "Hex projects by words", noun: "hex", verb: "projects" },
  { for: "one Hex project's configuration", noun: "hex", verb: "project" },
  { for: "a Hex project's SQL cells", noun: "hex", verb: "cells" },
  { for: "a Hex project's run history", noun: "hex", verb: "runs" },
  { for: "the rows a Hex SQL cell last produced", noun: "hex", verb: "output" },
  { for: "which warehouses Hex reads", noun: "hex", verb: "connections" },
  { for: "what the fleet has learned about some words", noun: "knowledge", verb: "recall" },
  { for: "the knowledge register, filtered", noun: "knowledge", verb: "list" },
  {
    for: "the local corpus by source, kind, channel, thread, author, time or text",
    noun: "store",
    readsCorpus: true,
    verb: "query",
  },
  { for: "named corpus records whole", noun: "store", readsCorpus: true, verb: "open" },
  { for: "a window of named records around a match", noun: "store", readsCorpus: true, verb: "peek" },
  // `--regex` is a pattern the model would write, run as a full-table match with no statement budget — a
  // Postgres statement outlives the child the deadline kills.
  { for: "keyword counts across the whole corpus", noun: "store", refuses: ["--regex"], verb: "probe" },
  { for: "one corpus row whole by source and id", noun: "store", verb: "detail" },
  { for: "corpus row counts grouped by one column", noun: "store", verb: "facets" },
  { for: "where a search's hits live", noun: "store", verb: "groups" },
  { for: "what the corpus holds and how current it is", noun: "store", verb: "status" },
  { for: "a question's keywords counted across every atlas", noun: "atlas", verb: "probe" },
  { for: "which atlases are stale", noun: "atlas", verb: "freshness" },
  { for: "the atlas exclusion backlog", noun: "atlas", verb: "backlog" },
  { for: "the JumpCloud atlas", noun: "atlas", subverbs: ["read", "coverage"], verb: "jumpcloud" },
  { for: "the Vanta atlas", noun: "atlas", subverbs: ["read", "coverage"], verb: "vanta" },
  { for: "who a name, handle or email is", noun: "identity", verb: "resolve" },
  { for: "every colleague and their ids", noun: "identity", verb: "show" },
  { for: "who may address the bot (the responder whitelist), by name and Slack id", noun: "responders", verb: "list" },
  // `catalog list` takes no noun and prints every verb, far past what one answer carries; `talk capabilities <noun>`
  // is the bounded read of one noun, and the one that says what the voice itself may run.
  { for: "every slopweaver verb at once; for one noun use talk capabilities", noun: "catalog", verb: "list" },
  {
    for: "which verbs of a noun YOU can run, which only a seat can and why — before telling the owner you cannot",
    noun: "talk",
    verb: "capabilities",
  },
  {
    for: "whether a card or a held draft on the owner's Queue already exists for a topic, with where it stands — pass the owner's words AND two or three other ways of saying it",
    noun: "talk",
    verb: "find-card",
  },
  { for: "the codebase's trees and their entry verbs", noun: "catalog", verb: "trees" },
  { for: "the turns a person took in a session", noun: "transcripts", verb: "turns" },
  { for: "one session's latest turn", noun: "transcripts", verb: "last-turn" },
  { for: "every Claude session on this machine", noun: "transcripts", verb: "sessions" },
  { for: "every cmux workspace", noun: "cmux", verb: "list" },
  { for: "a cmux seat's live terminal text", noun: "cmux", verb: "read-screen" },
  { for: "the fleet at a glance: branches, checks, runs", noun: "fleet", verb: "status" },
  { for: "how much context each live session carries", noun: "session", verb: "depth" },
  {
    for: "every Codex plan's usage: the week used, when it resets, which are capped, free resets held; --full adds who each is signed in as, your own included",
    noun: "codex",
    verb: "route",
  },
  { for: "which credentials exist, never a value", noun: "secrets", verb: "status" },
  { for: "which automations are due", noun: "automation", verb: "due" },
  { for: "every ask standing against the owner", noun: "turn", verb: "blocked" },
  { for: "one row per bot ask with its timings", noun: "turn", verb: "ledger" },
  { for: "the fleet's merge and landing pace", noun: "velocity", refuses: ["--repo"], verb: "run" },
  { for: "merged pull requests still owing gold proof", noun: "gold", verb: "debts" },
  { for: "acts taken under graduated autonomy", noun: "autonomy", verb: "list" },
  {
    for: "each time what reads as the console's own progress line cut into one of your answers, and how often: --since 1h for this call",
    noun: "talk",
    verb: "cut-ins",
  },
  {
    for: "the owner's check-ins past the pack, or fresh after a ruling — --skip <n> passes the rules already read",
    noun: "talk",
    verb: "check-ins",
  },
  // `--fragment` writes a page file; the voice reads, never writes. `--json` is the whole document, unbounded,
  // where the text form is fitted to one verb answer and says what it left out. A voice that reads the raw files
  // instead walks the owner into a candidate they have already settled.
  {
    for: "mined workstream candidates: --unruled lists only those the owner has not ruled on, --ruled names each ruling",
    noun: "workstreams",
    refuses: ["--fragment", "--json"],
    verb: "candidates",
  },
  { for: "recorded grants and their fate", noun: "grant", verb: "list" },
  { for: "tracked proposals", noun: "proposal", verb: "list" },
  { for: "one proposal's register entry", noun: "proposal", verb: "show" },
  { for: "replies the door held instead of sending", noun: "queue", verb: "list" },
  { for: "one held reply whole", noun: "queue", verb: "show" },
  { for: "what the world model knows about the owner", noun: "profile", verb: "show" },
  { for: "the instant a Slack ts names", noun: "slack", verb: "when" },
  { for: "one owner turn by anchor", noun: "supervisor", verb: "owner-turn-show" },
  { for: "the owner's published pages by the owner's words, with titles, newest first", noun: "page", verb: "find" },
];

/**
 * Flags refused on every row, in either spelling (`--flag value` or `--flag=value`).
 *
 * @internal exported for the resolver test
 */
export const REFUSED_FLAGS: readonly string[] = [
  "--home",
  "--dir",
  "--file",
  "--path",
  "--corpus",
  "--projects",
  "--artifact",
  "--html",
  "--client-id-file",
  "--client-secret-file",
  "--out",
  "--output",
  "--follow",
  "--wait",
  "--watch",
  "--apply",
  "--write",
  "--record",
  "--record-reading",
  "--fix",
  "--repair",
  "--submit",
  "--force",
];

/** The most arguments one request carries. */
export const MAX_VERB_ARGS = 32;

/**
 * The most UTF-8 bytes one argument carries.
 *
 * @internal exported for the resolver test
 */
export const MAX_VERB_ARG_BYTES = 2000;

/** A request as the voice's `verb` tool sends it. */
export interface ModelReadRequest {
  readonly noun: string;
  readonly verb: string;
  readonly args: readonly string[];
}

/**
 * Resolve one request to the argv the gateway runs after `slopweaver`, or the one reason it may not run.
 *
 * @param request the noun, verb and literal arguments the model asked for
 * @param reads the allowlist to check against
 * @returns the argv, or every reason it was refused
 */
export function resolveModelRead({
  request,
  reads = MODEL_READS,
}: {
  request: ModelReadRequest;
  reads?: readonly ModelRead[];
}): Result<readonly string[]> {
  // A noun's earlier name asks for the same read (`cli/nounAliases.ts`): `recipe due` is `automation due`.
  const noun = canonicalNoun({ noun: request.noun });
  const row = reads.find((read) => read.noun === noun && read.verb === request.verb);
  if (row === undefined) {
    // Says nothing about WHY: this resolver cannot see the catalog, so it cannot tell a verb that writes from one that
    // does not exist. It once told the voice `slack history` "may write, spawn or never end", and there is no
    // such verb. The gateway adds the derived reason (`cli/commands/talk/verbRun.ts`).
    return err([
      `${request.noun} ${request.verb} is not a verb the voice may run; talk capabilities ${request.noun} says which are`,
    ]);
  }
  const { refuses: rowRefuses = [] } = row;
  const problems: string[] = [];
  if (request.args.length > MAX_VERB_ARGS) {
    problems.push(`at most ${String(MAX_VERB_ARGS)} arguments, got ${String(request.args.length)}`);
  }
  request.args.forEach((arg, index) => {
    problems.push(...argProblems({ arg, index, refused: [...REFUSED_FLAGS, ...rowRefuses] }));
  });
  if (row.subverbs !== undefined) {
    const [first] = request.args;
    if (first === undefined || !row.subverbs.includes(first)) {
      problems.push(`${row.noun} ${row.verb} takes ${row.subverbs.join(" or ")} as its first argument here`);
    }
  }
  if (problems.length > 0) {
    return err(problems);
  }
  return ok([row.noun, row.verb, ...request.args]);
}

/** Why one argument may not be passed, empty when it may. */
function argProblems({
  arg,
  index,
  refused,
}: {
  arg: string;
  index: number;
  refused: readonly string[];
}): readonly string[] {
  const at = `argument ${String(index + 1)}`;
  if (arg === "") {
    return [`${at} is empty`];
  }
  if (Buffer.byteLength(arg, "utf8") > MAX_VERB_ARG_BYTES) {
    return [`${at} is over ${String(MAX_VERB_ARG_BYTES)} bytes`];
  }
  // A control character in an argv element is never a word someone asked about; a NUL cannot even be passed.
  // oxlint-disable-next-line no-control-regex -- matching control characters is the point
  if (/[\u0000-\u001f\u007f]/u.test(arg)) {
    return [`${at} carries a control character`];
  }
  const name = arg.split("=")[0]!;
  if (refused.includes(name)) {
    return [`${name} is refused: it would aim the read at another home, a path, a write or a read that never ends`];
  }
  if (pathShaped({ arg })) {
    return [`${at} looks like a filesystem path, and the voice never names one`];
  }
  return [];
}

/**
 * Belt to the refused flags: a flag the list has not met can still take a path, so an argument SHAPED like one —
 * absolute, home-relative, dot-relative, a file URL, or climbing with `..` — is refused whatever flag it follows.
 * The value is looked for everywhere a verb or the tool under it would find one: after `--flag=`, under any
 * stack of `kind:` prefixes (a web address's own scheme excepted), and inside a bundle of short flags, where
 * `-pO/x` is `-p -O/x` to git.
 */
function pathShaped({ arg }: { arg: string }): boolean {
  if (arg.includes("/../")) {
    return true;
  }
  const equals = arg.indexOf("=");
  const pending = equals === -1 ? [arg] : [arg, arg.slice(equals + 1)];
  // Every peel is strictly shorter than its value, so this ends; a dash bundle peels one letter a step.
  for (let value = pending.pop(); value !== undefined; value = pending.pop()) {
    if (/^(?:\/|~|\.{1,2}(?:\/|$)|file:)/iu.test(value)) {
      return true;
    }
    pending.push(...peeled({ value }));
  }
  return false;
}

/** What one `kind:` prefix (a web scheme excepted) or one short-flag letter leaves of a value, when it carries one. */
function peeled({ value }: { value: string }): readonly string[] {
  const found: string[] = [];
  const colon = /^([a-z][a-z0-9+.-]*):/iu.exec(value);
  if (colon !== null && !/^https?$/iu.test(colon[1]!)) {
    found.push(value.slice(colon[0].length));
  }
  if (/^-[^-]/u.test(value)) {
    // The letter's own value (`-O/x` → `/x`), and the rest of the bundle as a flag again (`-pO/x` → `-O/x`).
    found.push(value.slice(2));
    if (value.length > 2) {
      found.push(`-${value.slice(2)}`);
    }
  }
  return found;
}
