/**
 * The history capability DERIVES what it advertises from the store it would actually read.
 *
 * ## The failure this closes, measured
 *
 * MEASURED on one checkout: a bot turn went to local markdown files when it should have gone to the local
 * Supabase store, which is the failure mode the owner named, here with a mechanism under it.
 *
 * Three things were true at once and each one alone was survivable.
 *
 * 1. `GENERIC_SOURCE_CAPABILITIES`' `corpus` row declares `availability: { kind: "available" }` as a
 *    literal, and its command named a `--store` flag that no longer exists.
 * 2. That command REFUSED, every time, in every bot turn: nothing under `src/live/`,
 *    `src/cli/commands/turn/` or `skills/` set `SLOPWEAVER_STORE_URL`, so the read printed "refusing
 *    to reach the store" and exited 1. ({@link ../store/config} is the other half of the fix — the
 *    selection is remembered now.)
 * 3. `buildRoutingCapabilities` filters to `truthMode === "current"`, so the row never reached a brief at
 *    all — and nothing anywhere populated `RoutingJudgementInput.historicalCapabilities`, while
 *    `decisionShapeLines()` told the judging session to "name a capability listed above — AVAILABLE or
 *    HISTORICAL". The brief named a category it never printed.
 *
 * So a bot turn could not name the corpus as a need, was told by
 * `skills/loop-bot/reference/investigating.md` to read the corpus anyway, and reached for the one
 * spelling that worked: a whole-corpus read over bronze files. The third is
 * closed independently by the routing partition; this module closes the first two on top of it, grading the
 * row BEFORE that partition buckets it.
 *
 * ## Why the reading is injected, exactly as an atlas grading is
 *
 * `src/route/` plans; it calls no source. Opening a Postgres connection here would make planning perform
 * I/O and would couple the router to the driver. So a caller observes the store ({@link
 * ../store/reading.observeStore}) and hands the observation in as data, and everything below stays pure.
 * This is the same split {@link ./atlasReading} makes, for the same reason.
 *
 * ## What it does NOT touch
 *
 * `truthMode` stays `history`. A loaded store is still a record of what WAS true, and the invariant that a
 * current-state claim may not be assembled from history alone (`../live/turn/judgement.ts`) is the whole
 * reason history is a separate list rather than a merged one. Grading it never promotes it.
 */
import type { SourceCapability } from "./profile.js";

/** What was observed about the store the history capability would read. */
export type StoreRouteReading =
  /** No database is selected — neither the environment nor the remembered selection named one. */
  | { readonly kind: "unselected"; readonly because: string }
  /** A database is selected and could not be reached, or answered nothing in the time allowed. */
  | { readonly kind: "unreachable"; readonly because: string }
  /** Reached, and it holds no content rows at all. */
  | { readonly kind: "empty"; readonly because: string }
  /**
   * Reached and holding rows.
   *
   * `rows` is the total and `bySource` its breakdown, both `null` when reachability succeeded and the
   * count did not finish in the budget. Availability and coverage are separate answers: a store that is
   * demonstrably readable but whose census timed out is USABLE history of UNKNOWN extent, and reporting a
   * zero there would be a lie of exactly the kind this module exists to stop.
   */
  | {
      readonly kind: "loaded";
      readonly because: string;
      readonly rows: number | null;
      readonly bySource:
        | readonly {
            readonly source: string;
            readonly rows: number;
            /** ISO instant of that source's newest record, or null when it holds none datable. */
            readonly newest: string | null;
          }[]
        | null;
    };

/**
 * The generic corpus row's id — the one history row `GENERIC_SOURCE_CAPABILITIES` ships.
 *
 * Grading is NOT keyed on it: a copy of the row under a second id would stay AVAILABLE beside a command that
 * refused with `STORE_URL_MISSING` while the original turned UNAVAILABLE. What the probe measures is the database a
 * command OPENS, so {@link opensTheStore} is the criterion and any history row it matches is graded. The
 * judgement invariant keys on `truthMode`, not on any id, so an overlay's history row is still refused as
 * proof of present state.
 */
export const HISTORY_CAPABILITY_ID = "corpus";

/**
 * The `store` verbs that open a connection. `store collect` is the one that does not — it folds reply files
 * into a plan and never touches a database — so a row naming it is not the probe's to grade.
 */
const STORE_OPENING_VERBS: ReadonlySet<string> = new Set([
  "query",
  "facets",
  "detail",
  "ingest",
  "identity",
  "status",
  "read",
  "cite",
  "load",
]);

/**
 * Whether a row's command opens the store the probe measured — this repository's launcher running a store
 * verb that connects ({@link STORE_OPENING_VERBS}). Every one of them is store-only, so none needs a flag to say which leg it reads.
 *
 * Keyed on the command rather than on an id because the probe's verdict is about a DATABASE: every argv
 * that resolves the same selection under the same home opens the same one, whatever its row is called.
 * A foreign launcher is left alone for the reason {@link withHome} leaves it alone — its flags are not ours
 * to read — and a history row with some other command of ours (`handover list`, say) reads no store at all.
 * Every verb this matches accepts the `--home` {@link withHome} appends, which is the contract: a graded
 * row's command must RUN against the database the row describes.
 *
 * @param command the row's materialised argv
 * @returns true when the probe's verdict describes what this command will open
 */
export function opensTheStore({ command }: { command: readonly string[] }): boolean {
  const launcher = command[0];
  if (launcher === undefined || !isOurLauncher({ launcher })) {
    return false;
  }
  const verb = command[2];
  if (command[1] !== "store") {
    return false;
  }
  return verb !== undefined && STORE_OPENING_VERBS.has(verb);
}

/**
 * Whether an argv's first token is this repository's own `slopweaver` launcher, by path or bare name.
 *
 * @param launcher the argv's first token
 * @returns true for `slopweaver` or any path ending in `/slopweaver`
 */
function isOurLauncher({ launcher }: { launcher: string }): boolean {
  return launcher.endsWith("/slopweaver") || launcher === "slopweaver";
}

/**
 * Grade the history capability against what the store actually holds.
 *
 * @param capability the declared row, whose `what` and `truthMode` are kept unchanged
 * @param reading what a caller observed about the store
 * @param home the Slopweaver home the observation was taken under, appended to the printed command so
 *   the session runs it against the database that was actually graded
 * @returns the same row with availability, coverage, freshness and the command's home replaced
 */
export function gradeHistoryCapability({
  capability,
  reading,
  home,
}: {
  capability: SourceCapability;
  reading: StoreRouteReading;
  home?: string;
}): SourceCapability {
  if (reading.kind === "unselected" || reading.kind === "unreachable") {
    return {
      ...capability,
      // An unavailable capability may declare no runnable command — the profile schema refuses one — and
      // that is right here rather than merely required: printing `store read <question>` beside a store
      // nothing can reach is how a session spends a turn on a verb that was always going to refuse.
      availability: { kind: "unavailable", reason: reading.because },
      command: [],
      coverage: { detail: reading.because, kind: "unknown" },
      freshness: { detail: reading.because, kind: "unknown" },
    };
  }
  if (reading.kind === "empty") {
    return {
      ...capability,
      availability: { kind: "unavailable", reason: reading.because },
      command: [],
      coverage: { detail: reading.because, kind: "complete" },
      freshness: { detail: reading.because, kind: "unknown" },
    };
  }
  return {
    ...capability,
    availability: { kind: "available" },
    // The home is APPENDED, and a Codex review pass is why. The grading resolves the selection under the
    // home the brief was taken with; the printed argv carried none, so `slopweaver` resolving it would
    // fall back to `slopweaverHome()`. Its counterexample: with `SLOPWEAVER_HOME=/tmp/home-a` holding no
    // selection and `/tmp/home-b/secrets/store-url` holding a good one, `turn brief --contracts --home
    // /tmp/home-b` reported the row AVAILABLE while the `ask --store <q>` it printed refused with
    // STORE_URL_MISSING. Reproduced exactly as written, and that inversion — available here, refusing
    // there — is the one thing this whole module exists to make impossible.
    command: withHome({ command: capability.command, home }),
    coverage: { detail: loadedCoverage({ reading }), kind: "bounded" },
    freshness: { detail: reading.because, kind: "snapshot" },
  };
}

/**
 * A source's newest instant as the coverage clause prints it. A source holding no record with a datable
 * timestamp has no newest instant to name, so its freshness reads as an unknown date.
 */
function newestShown({ newest }: { newest: string | null }): string {
  if (newest == null) {
    return "an unknown date";
  }
  return newest;
}

/**
 * What a loaded store's coverage says — the counts when they were measured, and their absence when not.
 *
 * @param reading the loaded observation
 * @returns one clause naming what is in the store and what the numbers do not establish
 */
function loadedCoverage({ reading }: { reading: Extract<StoreRouteReading, { kind: "loaded" }> }): string {
  const census =
    reading.rows === null || reading.bySource === null
      ? "the row census did not finish in the time allowed, so how much it holds is UNKNOWN — read it with `slopweaver store status`"
      : `${String(reading.rows)} row(s): ${reading.bySource
          .map((row) => `${row.source} ${String(row.rows)} to ${newestShown({ newest: row.newest })}`)
          .join(", ")}`;
  return (
    `what the store holds right now — ${census}. Each "to <date>" is that source's NEWEST record, and it ` +
    `is the number to judge staleness by: the store can only be as fresh as the last bronze refresh that ` +
    `fed it, and a refresh leg can sit frozen for days while the row count looks healthy. This is HISTORY ` +
    `as it was captured, never current operational state, and an empty answer to a question means these ` +
    `records say nothing about it rather than that the org does not`
  );
}

/**
 * Make a history row's command resolve the home it was GRADED under, replacing any home it declared.
 *
 * ## Why the home is appended to every history row
 *
 * The grading resolves the store under the brief's `--home`, so the printed argv must carry it: without it
 * `slopweaver` falls back to `slopweaverHome()`, and a brief under `--home /tmp/home-b` would report the row
 * AVAILABLE beside a command that refuses with `STORE_URL_MISSING`. The append applies to every history row,
 * not one id, because a private overlay may declare a second history row. A command that already names a
 * `--home` is not skipped either: the brief would measure database B, print B's counts and dates, and hand
 * over a command that resolves A.
 *
 * So the measured home WINS. Any `--home <dir>` pair the row declared is dropped and the graded one
 * appended, because the whole contract is that the numbers printed beside a command describe the database
 * that command will open. An overlay that wants a different database wants a different capability.
 *
 * Keyed on the command actually being one this repository's launcher will run: a private overlay's own
 * executable is not ours to pass flags to, and a row with no command has nothing to append to.
 *
 * ## Where this stops, and why a wrapped launcher is not a defect
 *
 * An overlay can still point its command at another install by wrapping the launcher — `["/usr/bin/env", "SLOPWEAVER_HOME=/tmp/home-a", "/opt/slopweaver/bin/slopweaver", …]` —
 * so a brief graded under `/tmp/home-b` advertises B's census beside a command that opens A. That is
 * TRUE and it is deliberately not fixed here, because it is no longer this module lying: it is an overlay
 * declaring a command that does something other than what its row says, which every capability row in the
 * table can already do (an atlas row's argv is arbitrary, and `capabilityProfileSchema` validates SHAPE,
 * never truthfulness). Chasing it would mean this module parsing and rewriting arbitrary argv to police a
 * config file the installation owns.
 *
 * The line is whether the SHIPPED generic table can produce a row that misstates its own database. It cannot
 * through `GENERIC_SOURCE_CAPABILITIES` plus an ordinary `--home`; a wrapped launcher, or an overlay declaring
 * `--home=/tmp/home-a` and a `--` terminator so the appended pair lands after `--` as question text, needs a
 * hand-built hostile overlay. State the property that way rather than as "the command always matches", which
 * is the stronger claim this does not make.
 *
 * Five properties hold the rest of the line:
 *
 * - Grading is keyed on what a row's command opens ({@link opensTheStore}), never the row's id, and every
 *   connecting store verb takes the `--home` this appends.
 * - A MALFORMED remembered URL cannot throw out of `postgres()` before the probe's guard and take the whole
 *   brief down: `../store/reading.ts` builds the client inside it.
 * - Only SQLSTATE 57014 (`query_canceled`), read off drizzle's `cause`, is the "did not finish in the budget"
 *   arm. Any other census failure is UNAVAILABLE carrying the driver's reason, so a role with CONNECT but no
 *   SELECT never prints AVAILABLE beside a command that cannot read `content`.
 * - `observeStore` reads one whole row, because the census reads three COLUMNS while retrieval reads the
 *   record, and a role granted `select (source, occurred_at)` would pass the probe and fail `ask --store`
 *   with SQLSTATE 42501. That is what makes AVAILABLE mean "what this command reads is readable".
 * - Readability is proven FIRST and a cancelled row read is a REFUSAL, because a cancelled statement proves
 *   nothing about permission.
 *
 * A question is substituted into argv verbatim, so one of `-h` or `-x` would print as a FLAG and the command
 * would refuse before opening anything while its row read AVAILABLE. A flag-shaped question is fenced behind
 * `--` at materialisation (`./sourcePlan.ts`), `withHome` inserts before that fence, and the strip stops at
 * it, so a question of exactly `--home` or `--store` survives. `parseFlags` refuses a `--text` value beginning
 * with `--` before a brief ever runs, so that case is not reachable through `turn brief`; the rewrite is
 * wrong either way, and a counterexample's REACHABILITY is worth weighing before spending effort on this class.
 *
 * A brief asked "What's the history?" once printed a `run:` line whose apostrophe never closed, so the command
 * a turn was told to run could not launch (`bash -n` exits 2, `zsh -n` exits 1). Argv is rendered through
 * `#lib/shellCommandLine.js`, which quotes a token only where it needs it, for every capability row's line.
 *
 * @param command the row's materialised argv
 * @param home the home the observation was taken under, when one was named
 * @returns the argv resolving that home, or the argv unchanged when it is not ours to touch
 */
function withHome({ command, home }: { command: readonly string[]; home: string | undefined }): readonly string[] {
  const launcher = command[0];
  if (home === undefined || launcher === undefined) {
    return command;
  }
  if (!isOurLauncher({ launcher })) {
    return command;
  }
  // BEFORE any `--` fence. Everything after one is question text, so appending there would turn the home
  // into search terms — the fence exists because a flag-shaped question is substituted verbatim
  // (`./sourcePlan.ts`'s `materialiseCommand`).
  const stripped = withoutHome({ command });
  const fence = stripped.indexOf("--");
  if (fence === -1) {
    return [...stripped, "--home", home];
  }
  return [...stripped.slice(0, fence), "--home", home, ...stripped.slice(fence)];
}

/**
 * Drop every `--home <dir>` pair from an argv, so the graded one is the only one left.
 *
 * Walks pairwise rather than filtering the flag alone: dropping `--home` and leaving its value would turn
 * the directory into a stray positional, which for `store read` is more search terms.
 *
 * @param command the argv to strip
 * @returns the argv with no `--home` flag or value
 */
function withoutHome({ command }: { command: readonly string[] }): readonly string[] {
  const kept: string[] = [];
  let fenced = false;
  for (let at = 0; at < command.length; at += 1) {
    // Everything after a `--` is question TEXT, never a flag, so a question of exactly "--home" must
    // survive here, or the command prints with no question at all.
    if (command[at] === "--") {
      fenced = true;
    }
    if (!fenced && command[at] === "--home") {
      at += 1;
      continue;
    }
    // The loop bound proves the index is in range; `noUncheckedIndexedAccess` cannot see that, and the
    // house rule is explicit that an honest assertion beats coalescing a real token to an empty string.
    kept.push(command[at]!);
  }
  return kept;
}

/**
 * Grade every history row that opens the store against what the store holds, give every other history row
 * of ours the graded home, and leave current-truth rows exactly as they came.
 *
 * Runs BEFORE the routing partition in `./routingCapabilities.ts`, and that order is what lets this compose
 * with the partition rather than fight it. The partition files any row whose `availability` is not
 * `available` into `unavailable`, whatever its truth mode. So a store the probe could not reach turns its row
 * unavailable HERE, and the partition's own rule files it correctly. Grading after the partition would have
 * needed its own bucket move, and a second place to get that wrong.
 *
 * @param capabilities the merged, materialised rows, reserved ids already removed
 * @param reading what the caller observed about the store, or undefined when nobody looked
 * @param home the home that observation was taken under, carried into every history row's command
 * @returns the same rows in the same order, with history rows graded or re-homed
 */
export function gradeHistoryRows({
  capabilities,
  reading,
  home,
}: {
  capabilities: readonly SourceCapability[];
  reading: StoreRouteReading | undefined;
  home: string | undefined;
}): readonly SourceCapability[] {
  return capabilities.map((capability) => {
    if (capability.truthMode !== "history") {
      return capability;
    }
    if (reading !== undefined && opensTheStore({ command: capability.command })) {
      return gradeHistoryCapability({ capability, reading, ...(home === undefined ? {} : { home }) });
    }
    // Not graded. A caller that did not look publishes no verdict, and a history row whose command opens
    // something other than the store is an overlay's own claim about a source this module cannot probe. Its
    // command still resolves the brief's home.
    return { ...capability, command: withHome({ command: capability.command, home }) };
  });
}
