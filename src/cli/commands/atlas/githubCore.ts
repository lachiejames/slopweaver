/**
 * Pure argument handling and rendering for the GitHub atlas's own verbs.
 *
 * Split from the run shells so every parse and every rendered line is testable without a network, a clock,
 * a browser or a filesystem — the shells own only the effects.
 *
 * ## The exit code is a judgement, and it is made here
 *
 * A sync in which one kind was refused for want of a permission is NOT a failed sync: the atlas did its
 * job, which is to say what it could not see. What IS a failure is a mandatory kind that is neither read
 * nor honestly absent, because that is the shape a reader would take for coverage it does not have.
 * {@link exitCodeForGithubSync} is where that judgement lives rather than being re-derived at each call
 * site, and it is deliberately UNIVERSAL where the kit's own `hasUsableCoverage` is existential.
 */
import type { GithubSyncSummary } from "../../../atlas/github/sync.js";
import type { WebSurfaceOutcome } from "../../../atlas/github/webSurface.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import { flagValueOr, parseFlagTail } from "../../optionParsers.js";

/** Exported so a test can assert this equals the manifest's own copy. */
export const GITHUB_SYNC_USAGE =
  "usage: slopweaver atlas github sync [--orgs <login,...>] [--repos <owner/repo,...>] [--json] [--home <dir>]";

/** Exported so a test can assert this equals the manifest's own copy. */
export const GITHUB_WALK_USAGE =
  "usage: slopweaver atlas github walk [--orgs <login,...>] [--repos <owner/repo,...>] [--rounds <n>] [--json] [--home <dir>]";

/** Exported so a test can assert this equals the manifest's own copy. */
export const GITHUB_REPORT_USAGE = "usage: slopweaver atlas github report [--json] [--home <dir>]";

/**
 * Every flag `atlas github sync` accepts, derived from its spec so the two cannot drift.
 *
 * @internal
 */
export const GITHUB_SYNC_FLAG_NAMES: readonly string[] = ["--home", "--json", "--orgs", "--repos"];

/**
 * Every flag `atlas github walk` accepts.
 *
 * @internal
 */
export const GITHUB_WALK_FLAG_NAMES: readonly string[] = ["--home", "--json", "--orgs", "--repos", "--rounds"];

/**
 * Every flag `atlas github reset` accepts.
 *
 * @internal
 */
export const GITHUB_RESET_FLAG_NAMES: readonly string[] = ["--confirm", "--home", "--json"];

/**
 * Every flag `atlas github report` accepts.
 *
 * @internal
 */
export const GITHUB_REPORT_FLAG_NAMES: readonly string[] = ["--home", "--json"];

/**
 * The scopes a verb was asked to cover.
 *
 * @internal
 */
export interface GithubScopeOptions {
  readonly organisations: readonly string[];
  readonly repositories: readonly string[];
}

/**
 * The resolved `atlas github sync` invocation.
 *
 * @internal
 */
export interface GithubSyncOptions extends GithubScopeOptions {
  readonly json: boolean;
  readonly home: string;
}

/**
 * The resolved `atlas github walk` invocation.
 *
 * @internal
 */
export interface GithubWalkOptions extends GithubScopeOptions {
  readonly json: boolean;
  readonly home: string;
  /** How many rounds of frontier expansion to run; `null` takes the walk's own default. */
  readonly rounds: number | null;
}

/**
 * Split a comma-separated flag value into its entries, dropping empties.
 *
 * @param value the raw flag value, or `undefined` when the flag was absent
 * @returns the entries, trimmed, in the order given
 *
 * @internal
 */
export function splitList({ value }: { value: string | undefined }): readonly string[] {
  if (value === undefined) {
    return [];
  }
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * Check every `--repos` entry looks like a coordinate rather than a bare name.
 *
 * A bare repository name would silently build a route with an empty owner, which GitHub answers 404 — so
 * the atlas would record a `route-absent` gap against a repository that exists. Refusing at the parse is
 * the difference between a usage error and a false finding.
 *
 * @param repositories the parsed `--repos` entries
 * @returns the problems found, empty when every entry is a coordinate
 *
 * @internal
 */
export function repositoryCoordinateProblems({ repositories }: { repositories: readonly string[] }): readonly string[] {
  return repositories
    .filter((value) => value.split("/").filter((part) => part.length > 0).length !== 2)
    .map((value) => `--repos takes owner/repo entries, not "${value}"`);
}

/**
 * Parse the `sync` verb's arguments.
 *
 * @param rest the argv tail after `atlas github sync`
 * @param defaultHome the state home to use when `--home` is absent
 * @returns the resolved options, or every usage problem found
 */
export function parseGithubSyncOptions({
  rest,
  defaultHome,
}: {
  rest: readonly string[];
  defaultHome: string;
}): Result<GithubSyncOptions> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home", "orgs", "repos"] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values, flags } = parsed.value;
  const repositories = splitList({ value: values["repos"] });
  const problems = repositoryCoordinateProblems({ repositories });
  if (problems.length > 0) {
    return err([...problems, GITHUB_SYNC_USAGE]);
  }
  return ok({
    home: flagValueOr({ fallback: defaultHome, name: "home", parsed: parsed.value }),
    json: flags.has("json"),
    organisations: splitList({ value: values["orgs"] }),
    repositories,
  });
}

/**
 * Parse the `walk` verb's arguments.
 *
 * @param rest the argv tail after `atlas github walk`
 * @param defaultHome the state home to use when `--home` is absent
 * @returns the resolved options, or every usage problem found
 */
export function parseGithubWalkOptions({
  rest,
  defaultHome,
}: {
  rest: readonly string[];
  defaultHome: string;
}): Result<GithubWalkOptions> {
  const parsed = parseFlagTail({
    rest,
    spec: { boolean: ["json"], value: ["home", "orgs", "repos", "rounds"] },
  });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values, flags } = parsed.value;
  const repositories = splitList({ value: values["repos"] });
  const problems = [...repositoryCoordinateProblems({ repositories })];
  const roundsRaw = values["rounds"];
  // `Number.parseInt` reads the leading integer prefix, so `2x` and `1.5` are taken as 2 and 1; only a value
  // with no numeric prefix, or a prefix below 1, is refused.
  const rounds = roundsRaw === undefined ? null : Number.parseInt(roundsRaw, 10);
  if (roundsRaw !== undefined && rounds !== null && (!Number.isInteger(rounds) || rounds < 1)) {
    problems.push(`--rounds takes a positive integer, not "${roundsRaw}"`);
  }
  if (problems.length > 0) {
    return err([...problems, GITHUB_WALK_USAGE]);
  }
  return ok({
    home: flagValueOr({ fallback: defaultHome, name: "home", parsed: parsed.value }),
    json: flags.has("json"),
    organisations: splitList({ value: values["orgs"] }),
    repositories,
    rounds,
  });
}

/**
 * The exit code a finished sync earns.
 *
 * Non-zero when a MANDATORY kind is neither read nor honestly absent. Deliberately not the kit's
 * `hasUsableCoverage`, which succeeds as soon as any one cell synced: under that predicate a sync in which
 * every kind but one failed reports success, publishes, and leaves the routing layer offering the atlas as
 * a current-truth source.
 *
 * @param summary what the sync produced
 * @returns the process exit code
 */
export function exitCodeForGithubSync({ summary }: { summary: GithubSyncSummary }): number {
  return summary.uncovered.length > 0 ? EXIT_ERROR : EXIT_OK;
}

/**
 * The lines a finished sync prints when the caller did not ask for JSON.
 *
 * Counts first, then what was refused, then the uncovered kinds — worst last, so a skimming reader's eye
 * lands on what the atlas could not see rather than on what worked.
 *
 * @param summary what the sync produced
 * @returns the lines to print, in order
 */
export function renderGithubSync({ summary }: { summary: GithubSyncSummary }): readonly string[] {
  const lines = [`github atlas synced at ${summary.at}`];
  for (const [kind, count] of Object.entries(summary.counts).toSorted(([left], [right]) => left.localeCompare(right))) {
    lines.push(`  ${kind}: ${String(count)}`);
  }
  for (const failure of summary.failures) {
    lines.push(`  REFUSED ${failure.route}: ${failure.reason}`);
  }
  if (summary.uncovered.length > 0) {
    lines.push(
      `  UNCOVERED: ${summary.uncovered.join(", ")} — a mandatory kind that is neither read nor honestly absent`,
    );
  }
  return lines;
}

/**
 * The lines a finished walk prints when the caller did not ask for JSON.
 *
 * The undeclared-endpoint count is given its own line because it is the browser half's whole point: an
 * endpoint GitHub's own client calls that its published description does not declare is exactly the
 * unknown unknown the two-surface design exists to surface.
 *
 * @param outcome what the walk published
 * @returns the lines to print, in order
 */
export function renderGithubWalk({ outcome }: { outcome: WebSurfaceOutcome }): readonly string[] {
  return [
    `github admin walk: ${String(outcome.pageCount)} page(s) attempted, ${String(outcome.landedCount)} landed, ${String(outcome.photographedCount)} photographed`,
    `  ${String(outcome.requestCount)} distinct endpoint(s) observed, ${String(outcome.undeclaredRequestCount)} of them not declared in GitHub's own published description`,
    ...outcome.written.map((path) => `  wrote ${path}`),
  ];
}
