/**
 * Pure argument handling and rendering for the `crowdstrike` verbs.
 *
 * Split from the run shells so every parse and every rendered line is testable without a network, a clock
 * or a filesystem — the shells own only the effects.
 *
 * ## The exit code is a judgement, and it is made here
 *
 * A sync where one kind was refused for want of a scope is NOT a failed sync: the atlas did its job, which
 * is to say what it could not see. So the code distinguishes "nothing could be read at all" from "some kind
 * did not sync completely", and {@link exitCodeForCrowdstrikeSync} is where that judgement lives rather
 * than being re-derived at each call site.
 */
import type { CrowdstrikeSyncOutcome } from "../../../atlas/crowdstrike/sync.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { flagValueOr, parseFlagTail } from "../../optionParsers.js";
import { type CrowdstrikeVerbError, CrowdstrikeVerbErrors } from "./errors.js";

/** Exported so a test can assert this equals the manifest's own copy. */
export const CROWDSTRIKE_SYNC_USAGE = "usage: slopweaver crowdstrike sync [--json] [--home <dir>]";

/** Exported so a test can assert this equals the manifest's own copy. */
export const CROWDSTRIKE_WALK_USAGE = "usage: slopweaver crowdstrike walk [--limit <n>] [--json] [--home <dir>]";

/** Exported so a test can assert this equals the manifest's own copy. */
export const CROWDSTRIKE_RESET_USAGE = "usage: slopweaver crowdstrike reset --confirm archive [--json] [--home <dir>]";

/** Every flag `crowdstrike sync` accepts, derived from its spec so the two cannot drift. */
export const CROWDSTRIKE_SYNC_FLAG_NAMES: readonly string[] = ["--home", "--json"];

/** Every flag `crowdstrike walk` accepts. */
export const CROWDSTRIKE_WALK_FLAG_NAMES: readonly string[] = ["--home", "--json", "--limit"];

/** Exported so a test can assert this equals the manifest's own copy. */
export const CROWDSTRIKE_RECONCILE_USAGE =
  "usage: slopweaver crowdstrike reconcile [--fleet <file>] [--json] [--home <dir>]";

/** Every flag `crowdstrike reconcile` accepts. */
export const CROWDSTRIKE_RECONCILE_FLAG_NAMES: readonly string[] = ["--fleet", "--home", "--json"];

/** Every flag `crowdstrike reset` accepts. */
export const CROWDSTRIKE_RESET_FLAG_NAMES: readonly string[] = ["--confirm", "--home", "--json"];

/**
 * The resolved `crowdstrike sync` invocation.
 *
 * @internal
 */
export interface CrowdstrikeSyncOptions {
  readonly json: boolean;
  readonly home: string;
}

/**
 * Parse the `sync` verb's arguments.
 *
 * @param rest the argv tail after `crowdstrike sync`
 * @param defaultHome the state home to use when `--home` is absent
 * @returns the resolved options, or every usage problem found
 */
export function parseCrowdstrikeSyncOptions({
  rest,
  defaultHome,
}: {
  rest: readonly string[];
  defaultHome: string;
}): Result<CrowdstrikeSyncOptions> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home"] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  return ok({
    home: flagValueOr({ fallback: defaultHome, name: "home", parsed: parsed.value }),
    json: parsed.value.flags.has("json"),
  });
}

/** The reason a kind's line shows: its first recorded one, or the words saying the sync recorded none. */
function firstReason({ reasons }: { reasons: readonly string[] }): string {
  const first = reasons[0];
  if (first === undefined) {
    return "no detail recorded";
  }
  return first;
}

/**
 * The lines a finished sync prints when the caller did not ask for JSON.
 *
 * One line per kind, worst last, so a skimming reader's eye lands on what was refused rather than on what
 * worked. The reasons are the coverage cells' own words, which is what a reader will see again in
 * `atlas crowdstrike coverage`.
 *
 * @param outcome what the sync established
 * @returns the lines to print, in order
 */
export function renderCrowdstrikeSyncLines({ outcome }: { outcome: CrowdstrikeSyncOutcome }): readonly string[] {
  const ordered = [...outcome.kinds].toSorted((left, right) => Number(right.ok) - Number(left.ok));
  const kinds = ordered.map(
    (kind) =>
      `  ${kind.ok ? "ok  " : "FAIL"} ${kind.kind.padEnd(22)} ${String(kind.entityCount).padStart(6)}  ${firstReason({ reasons: kind.reasons })}`,
  );
  const failed = outcome.kinds.filter((kind) => !kind.ok).length;
  const tail =
    failed === 0
      ? `crowdstrike: every kind synced — ${String(outcome.written.length)} file(s) written`
      : `crowdstrike: ${String(failed)} of ${String(outcome.kinds.length)} kind(s) did not sync — run \`slopweaver atlas crowdstrike coverage\` for what each one says`;
  return [...kinds, tail];
}

/**
 * The exit code a finished sync earns.
 *
 * @param outcome what the sync established
 * @param exitOk the code for a run where every kind synced
 * @param exitError the code for a run where some kind did not
 * @param exitExpectedEmpty the code for a run where NO kind synced at all
 * @returns the process exit code
 */
export function exitCodeForCrowdstrikeSync({
  outcome,
  exitOk,
  exitError,
  exitExpectedEmpty,
}: {
  outcome: CrowdstrikeSyncOutcome;
  exitOk: number;
  exitError: number;
  exitExpectedEmpty: number;
}): number {
  const succeeded = outcome.kinds.filter((kind) => kind.ok).length;
  if (succeeded === 0) {
    return exitExpectedEmpty;
  }
  return succeeded === outcome.kinds.length ? exitOk : exitError;
}

/**
 * The resolved `crowdstrike walk` invocation.
 *
 * @internal
 */
export interface CrowdstrikeWalkOptions {
  readonly json: boolean;
  readonly home: string;
  /** Stop after this many declared routes. Absent means the whole sitemap. */
  readonly limit: number | undefined;
}

/**
 * Parse the `walk` verb's arguments.
 *
 * @param rest the argv tail after `crowdstrike walk`
 * @param defaultHome the state home to use when `--home` is absent
 * @returns the resolved options, or every usage problem found
 */
export function parseCrowdstrikeWalkOptions({
  rest,
  defaultHome,
}: {
  rest: readonly string[];
  defaultHome: string;
}): Result<CrowdstrikeWalkOptions, CrowdstrikeVerbError> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home", "limit"] } });
  if (parsed.isErr()) {
    return err(CrowdstrikeVerbErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const { values, flags } = parsed.value;
  const raw = values["limit"];
  if (raw !== undefined && !/^[1-9][0-9]*$/u.test(raw)) {
    return err(CrowdstrikeVerbErrors.limitNotPositive({ got: raw }));
  }
  return ok({
    home: flagValueOr({ fallback: defaultHome, name: "home", parsed: parsed.value }),
    json: flags.has("json"),
    limit: raw === undefined ? undefined : Number.parseInt(raw, 10),
  });
}

/**
 * The resolved `crowdstrike reset` invocation.
 *
 * @internal
 */
export interface CrowdstrikeResetOptions {
  readonly json: boolean;
  readonly home: string;
}

/**
 * Parse the `reset` verb's arguments, refusing a reset nobody confirmed.
 *
 * `--confirm archive` is required so a bare `slopweaver crowdstrike reset` cannot archive a generation by
 * accident, and it is checked HERE rather than in the shell so the refusal is a pure, tested behaviour.
 *
 * @param rest the argv tail after `crowdstrike reset`
 * @param defaultHome the state home to use when `--home` is absent
 * @returns the resolved options, or every usage problem found
 */
export function parseCrowdstrikeResetOptions({
  rest,
  defaultHome,
}: {
  rest: readonly string[];
  defaultHome: string;
}): Result<CrowdstrikeResetOptions, CrowdstrikeVerbError> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home", "confirm"] } });
  if (parsed.isErr()) {
    return err(CrowdstrikeVerbErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const { values, flags } = parsed.value;
  if (values["confirm"] !== "archive") {
    return err(CrowdstrikeVerbErrors.confirmationMissing());
  }
  return ok({
    home: flagValueOr({ fallback: defaultHome, name: "home", parsed: parsed.value }),
    json: flags.has("json"),
  });
}

/**
 * The resolved `crowdstrike reconcile` invocation.
 *
 * @internal
 */
export interface CrowdstrikeReconcileOptions {
  readonly json: boolean;
  readonly home: string;
  /** A second fleet source to join against. Absent means the cross-atlas half is not run at all. */
  readonly fleet: string | undefined;
}

/**
 * Parse the `reconcile` verb's arguments.
 *
 * @param rest the argv tail after `crowdstrike reconcile`
 * @param defaultHome the state home to use when `--home` is absent
 * @returns the resolved options, or every usage problem found
 */
export function parseCrowdstrikeReconcileOptions({
  rest,
  defaultHome,
}: {
  rest: readonly string[];
  defaultHome: string;
}): Result<CrowdstrikeReconcileOptions> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home", "fleet"] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values, flags } = parsed.value;
  return ok({
    fleet: values["fleet"],
    home: flagValueOr({ fallback: defaultHome, name: "home", parsed: parsed.value }),
    json: flags.has("json"),
  });
}

/**
 * What a reconciliation established, in the shape the renderer takes.
 *
 * @internal
 */
export interface CrowdstrikeReconciliationReport {
  readonly surfaces: readonly { method: string; pathShape: string; observedOnPages: readonly string[] }[];
  readonly fleet: {
    readonly matched: readonly { crowdstrikeProviderId: string; joinedOn: string; disagreements: readonly string[] }[];
    readonly onlyInCrowdstrike: readonly string[];
    readonly onlyInForeign: readonly string[];
    readonly unjoinable: readonly string[];
  } | null;
}

/**
 * Render a reconciliation for a reader.
 *
 * The fleet half prints "not run" when no second source was given, rather than an empty result — an empty
 * disagreement list and an unasked question look identical on the page and mean opposite things.
 *
 * @param report what the reconciliation established
 * @param hostCount how many hosts the atlas holds, so a reader can size the fleet numbers against it
 * @returns the lines to print, in order
 */
export function renderCrowdstrikeReconciliation({
  report,
  hostCount,
}: {
  report: CrowdstrikeReconciliationReport;
  hostCount: number;
}): readonly string[] {
  const lines = [
    `API vs CONSOLE — ${String(report.surfaces.length)} endpoint(s) the console calls that this credential has no admitted call for.`,
    "  Each is evidence Falcon HOLDS the data, never that this installation may ask for it.",
    ...report.surfaces
      .slice(0, RECONCILE_ROW_CAP)
      .map((row) => `  ${row.method} ${row.pathShape}  (seen on ${String(row.observedOnPages.length)} page(s))`),
  ];
  if (report.surfaces.length > RECONCILE_ROW_CAP) {
    lines.push(`  … ${String(report.surfaces.length - RECONCILE_ROW_CAP)} more; --json for all of them`);
  }
  if (report.fleet === null) {
    lines.push(
      "",
      `CROWDSTRIKE vs ANOTHER FLEET — not run: no --fleet export was given, so the ${String(hostCount)} host(s) this atlas holds were compared against nothing.`,
    );
    return lines;
  }
  const disagreeing = report.fleet.matched.filter((match) => match.disagreements.length > 0);
  return [
    ...lines,
    "",
    `CROWDSTRIKE vs ANOTHER FLEET — ${String(report.fleet.matched.length)} machine(s) matched against ${String(hostCount)} host(s).`,
    `  ${String(report.fleet.onlyInForeign.length)} device(s) the other source lists carry NO Falcon sensor — the coverage gap.`,
    `  ${String(report.fleet.onlyInCrowdstrike.length)} sensored machine(s) the other source does not list at all.`,
    `  ${String(disagreeing.length)} matched machine(s) the two sources describe differently.`,
    `  ${String(report.fleet.unjoinable.length)} Falcon host(s) carried no serial, hostname or MAC, so they could never be matched.`,
    ...disagreeing
      .slice(0, RECONCILE_ROW_CAP)
      .map(
        (match) => `  ${match.crowdstrikeProviderId} (joined on ${match.joinedOn}): ${match.disagreements.join(", ")}`,
      ),
  ];
}

/** How many rows each half prints before deferring to `--json`. Rule 7: never a wall of text. */
const RECONCILE_ROW_CAP = 20;
