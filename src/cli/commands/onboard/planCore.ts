/** `slopweaver onboard plan` — pure parsing and rendering for the concurrent refresh plan. */
import type { ConnectSource } from "../../../connect/types.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { type BackfillChoice, buildRefreshCommands, parseBackfillChoice } from "../../../onboard/plan.js";
import { ONBOARD_SOURCES } from "../../../onboard/sources.js";
import { booleanFlagsOf, type FlagSpec, type ParsedFlags, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { type OnboardError, OnboardErrors, type OnboardInvalidFlagValueError, onboardErrorLines } from "./errors.js";

const SPEC: FlagSpec = {
  boolean: ["json"],
  string: ["backfill", "github-org", "repo", "sources"],
};

/** `--`-prefixed flag names, for the help-truth ratchet. */
export const ONBOARD_PLAN_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: SPEC }),
  ...booleanFlagsOf({ spec: SPEC }),
]
  .map((name) => `--${name}`)
  .toSorted();

/** What a valid invocation asks the renderer to produce. */
export interface OnboardPlanOptions {
  readonly backfill: BackfillChoice;
  readonly json: boolean;
  readonly org: string;
  readonly repo: string;
  readonly sources: readonly ConnectSource[];
}

/**
 * Parse the verb's own flag tail.
 *
 * @param rest arguments after `onboard plan`
 * @returns parsed flags, or every syntax error
 */
export function parseOnboardPlanArgs({ rest }: { rest: readonly string[] }): Result<ParsedFlags> {
  return parseFlags({ args: rest, spec: SPEC });
}

/** Read one required string flag. */
function requiredString({ parsed, name }: { parsed: ParsedFlags; name: string }): Result<string, OnboardError> {
  const value = parsed.values[name];
  return typeof value === "string" && value.length > 0
    ? ok(value)
    : err(OnboardErrors.flagMissing({ flag: `--${name}` }));
}

/**
 * Narrow one source token to the connector vocabulary.
 *
 * Asked of {@link ONBOARD_SOURCES} rather than of a literal chain, so a source added to the onboarding set
 * is planned by this verb without a second edit. That is not hypothetical tidiness: `gmail` shipped as a
 * corpus source while this function still listed four names, so the documented way to plan a cold start
 * refused the fifth by name and the only route to it was to hand-write the refresh command.
 */
function connectSource({ value }: { value: string }): Result<ConnectSource, OnboardInvalidFlagValueError> {
  const match = ONBOARD_SOURCES.find((source) => source === value);
  return match === undefined
    ? err(OnboardErrors.sourceUnrecognised({ expected: ONBOARD_SOURCES, got: value }))
    : ok(match);
}

/** Parse a comma-separated, non-empty, duplicate-free source list. */
function sourceList({ value }: { value: string }): Result<readonly ConnectSource[], OnboardError> {
  const parsed = value
    .split(",")
    .map((source) => source.trim().toLowerCase())
    .filter((source) => source.length > 0)
    .map((source) => connectSource({ value: source }));
  const refusals = parsed.flatMap((source) => (source.isErr() ? [source.error] : []));
  if (refusals.length > 0) {
    return err(OnboardErrors.sourcesUnrecognised({ refusals }));
  }
  const sources = parsed.flatMap((source) => (source.isOk() ? [source.value] : []));
  if (sources.length === 0) {
    return err(OnboardErrors.sourcesEmpty({ got: value }));
  }
  return ok([...new Set(sources)]);
}

/** Validate an `owner/repo` slug before it is rendered as a shell word. */
function repoSlug({ value }: { value: string }): Result<string, OnboardError> {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(value) ? ok(value) : err(OnboardErrors.repoNotSlug({ got: value }));
}

/** Validate an organisation slug before it is rendered as a shell word. */
function orgSlug({ value }: { value: string }): Result<string, OnboardError> {
  return /^[A-Za-z0-9_.-]+$/u.test(value) ? ok(value) : err(OnboardErrors.orgNotSlug({ got: value }));
}

/** Use an explicit GitHub org, otherwise the owner of an already-validated repo slug. */
function githubOrgValue({ explicit, repo }: { explicit: unknown; repo: string }): string {
  return typeof explicit === "string" ? explicit : repo.slice(0, repo.indexOf("/"));
}

/** The lines one leg of the plan's validation refused, one per problem — none when it passed. */
function problemLines({ result }: { result: Result<unknown, OnboardError> }): readonly string[] {
  return result.isErr() ? onboardErrorLines({ error: result.error }) : [];
}

/**
 * Parse the flag map into the complete plan options.
 *
 * @param parsed the syntactically valid flags
 * @returns complete plan options, or every semantic error
 */
export function onboardPlanOptions({ parsed }: { parsed: ParsedFlags }): Result<OnboardPlanOptions, OnboardError> {
  const rawSources = requiredString({ name: "sources", parsed });
  const rawBackfill = requiredString({ name: "backfill", parsed });
  const sources = rawSources.andThen((value) => sourceList({ value }));
  const backfill = rawBackfill
    .mapErr((error) => onboardErrorLines({ error }))
    .andThen((value) => parseBackfillChoice({ value }));
  const needsGithub = sources.isOk() && sources.value.includes("github");
  const rawRepo = typeof parsed.values["repo"] === "string" ? parsed.values["repo"] : "";
  const repo = needsGithub ? repoSlug({ value: rawRepo }) : ok(rawRepo);
  const rawOrg = repo.isOk() ? githubOrgValue({ explicit: parsed.values["github-org"], repo: repo.value }) : "";
  const org = needsGithub && repo.isOk() ? orgSlug({ value: rawOrg }) : ok(rawOrg);
  const reasons = [
    ...problemLines({ result: sources }),
    ...(backfill.isErr() ? backfill.error : []),
    ...problemLines({ result: repo }),
    ...problemLines({ result: org }),
  ];
  if (reasons.length > 0) {
    return err(OnboardErrors.planRefused({ reasons }));
  }
  if (!(sources.isOk() && backfill.isOk() && repo.isOk() && org.isOk())) {
    return err(OnboardErrors.planInvalid());
  }
  return ok({
    backfill: backfill.value,
    json: parsed.values["json"] === true,
    org: org.value,
    repo: repo.value,
    sources: sources.value,
  });
}

/**
 * Render one JSON plan whose command arrays can be launched without reparsing shell text.
 *
 * @param options the complete onboarding plan
 * @returns one formatted JSON document
 */
export function renderOnboardPlanJson({ options }: { options: OnboardPlanOptions }): string {
  return JSON.stringify(
    {
      commands: buildRefreshCommands(options),
      concurrency: "parallel",
      schemaVersion: 1,
    },
    null,
    2,
  );
}

/**
 * Render the human plan. Every variable word was validated to be shell-safe above.
 *
 * @param options the complete onboarding plan
 * @returns the heading and one command line per source
 */
export function renderOnboardPlan({ options }: { options: OnboardPlanOptions }): readonly string[] {
  const commands = buildRefreshCommands(options);
  return [
    `launch these ${String(commands.length)} refresh command(s) concurrently:`,
    ...commands.map((command) => `slopweaver ${command.argv.join(" ")}`),
  ];
}
