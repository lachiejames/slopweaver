/** `slopweaver route plan` — print a source plan without calling a source or a model. */
import { readFileSync } from "node:fs";

import { recordedProfilePort } from "../../../browser/recordedProfile.js";
import { slopweaverHome } from "../../../homeDir.js";
import { parseJson } from "../../../lib/jsonParse.js";
import { logger } from "../../../lib/logger.js";
import { bundledLauncherPath, installedTreeRoot } from "../../../lib/pluginRoot.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { safeFs } from "../../../lib/safeBoundary.js";
import { withDerivedAtlasCapabilities } from "../../../route/atlasCapability.js";
import { atlasRouteReadings } from "../../../route/atlasReadings.js";
import { registeredAtlasSources } from "../../../route/atlasSources.js";
import type { CensusServiceMatch } from "../../../route/censusReading.js";
import { censusRouteReading } from "../../../route/censusReadings.js";
import { commandRouteReadings } from "../../../route/commandReadings.js";
import { connectionRouteReadings } from "../../../route/connectionReadings.js";
import { type CapabilityProfile, parseCapabilityProfile } from "../../../route/profile.js";
import { buildSourcePlan, GENERIC_SOURCE_CAPABILITIES, mergedCapabilities } from "../../../route/sourcePlan.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type ParsedFlags, parseFlags } from "../../parseFlags.js";
import { type RouteCommandError, RouteCommandErrors, routeCommandErrorLines } from "./errors.js";

/** The public usage contract. JSON is required because this verb exists as a host-neutral hand-off. */
export const ROUTE_PLAN_USAGE = "usage: slopweaver route plan --question <text> [--profile <capabilities.json>] --json";

/** Every accepted flag, exported for the help-truth ratchet. */
export const ROUTE_PLAN_FLAG_NAMES = ["--question", "--profile", "--json"] as const;

/** Where this verb's arguments begin in `[node, cli, route, plan, ...]`. */
const VERB_ARG_OFFSET = 4;

/** The values required after flag tokenisation. */
interface RoutePlanRequest {
  readonly question: string;
  readonly profilePath?: string;
}

/**
 * Parse the route-plan argv tail without performing I/O.
 *
 * @param rest the argv tail after `route plan`
 * @returns parsed flags or their syntax errors
 */
export function parseRoutePlanArgs({ rest }: { rest: readonly string[] }): Result<ParsedFlags> {
  return parseFlags({ args: rest, spec: { boolean: ["json"], string: ["question", "profile"] } });
}

/** Turn parsed flags into the required request, reporting every missing contract field. */
function requestFromFlags({
  values,
}: {
  values: Readonly<Record<string, string | boolean>>;
}): Result<RoutePlanRequest> {
  const question = values["question"];
  const profilePath = values["profile"];
  const errors = [
    typeof question !== "string" || question.trim().length === 0 ? "--question is required" : undefined,
    values["json"] !== true ? "--json is required" : undefined,
  ].filter((problem): problem is string => problem !== undefined);
  if (errors.length > 0 || typeof question !== "string") {
    return err(errors);
  }
  return ok({ question, ...(typeof profilePath === "string" ? { profilePath } : {}) });
}

/** Read and validate the explicitly named private profile. */
function loadCapabilityProfile({ path }: { path: string }): Result<CapabilityProfile, RouteCommandError> {
  const read = safeFs({ execute: () => readFileSync(path, "utf8"), operation: "route.readCapabilityProfile", path });
  if (read.isErr()) {
    return err(RouteCommandErrors.fileUnreadable({ detail: read.error.message, label: "capability profile", path }));
  }
  const decoded = parseJson({ text: read.value });
  if (decoded.isErr()) {
    return err(RouteCommandErrors.fileNotJson({ label: "capability profile", path }));
  }
  const parsed = parseCapabilityProfile({ value: decoded.value });
  if (parsed.isErr()) {
    return err(RouteCommandErrors.profileInvalid({ label: "capability profile", path, problems: parsed.error }));
  }
  return ok(parsed.value);
}

/**
 * The census matches one question has, as a spreadable argument — nothing to spread when this install holds
 * no census or the question names no service it knows.
 *
 * A question naming a service the Datadog census holds OFFERS the telemetry rows, even when it never says
 * "logs". The manifest alone is read, so this costs milliseconds. A name is a HINT: it
 * rides `optional` and never outranks the question's own words — `route/sourcePlan.ts`'s `matchedLegs`.
 *
 * @param question the question as asked
 * @returns `{ censusMatches }`, or nothing to spread
 */
function censusArgument({ question }: { question: string }): { censusMatches?: readonly CensusServiceMatch[] } {
  const census = censusRouteReading({ home: slopweaverHome(), nowMs: Date.now(), question });
  if (census === null) {
    return {};
  }
  return { censusMatches: census.reading.matches };
}

/**
 * Build the plan for one question, with every row graded against what this host can really reach.
 *
 * Its own function rather than the tail of {@link runRoutePlan}, along the seam
 * `turn/briefCapabilities.ts` already sits on: everything above it is argv, and everything here is the
 * routing decision. Both hosts therefore derive, merge and grade the same way.
 *
 * @param profile the validated private overlay, when `--profile` named one
 * @param question the question as asked
 * @returns the ordered source plan
 */
async function plannedFor({
  profile,
  question,
}: {
  profile: CapabilityProfile | undefined;
  question: string;
}): Promise<ReturnType<typeof buildSourcePlan>> {
  // Every REGISTERED atlas gets a row, derived from `atlasPlatforms()` rather than hand-authored into an
  // install's own profile — `route/atlasCapability.ts` carries the 24-unroutable measurement. Computed once
  // and handed to both the merge and `buildSourcePlan`, so neither can grade a different table.
  const baseCapabilities = withDerivedAtlasCapabilities({
    atlases: registeredAtlasSources(),
    baseCapabilities: GENERIC_SOURCE_CAPABILITIES,
    overlay: profile === undefined ? [] : profile.capabilities,
  });
  const merged = mergedCapabilities({ baseCapabilities, profile });
  // The atlas rows are graded against their own published generations before anything is planned, so a
  // mostly-empty atlas stops advertising itself as reachable current truth. The rule:
  // "a profile that reads answerability" — see `route/atlasReading.ts` for the 29 rows this closes.
  const atlasReadings = await atlasRouteReadings({ capabilities: merged.capabilities });
  const slopweaverCommand = bundledLauncherPath({ importMetaUrl: import.meta.url });
  return buildSourcePlan({
    atlasReadings,
    baseCapabilities,
    ...censusArgument({ question }),
    commandReadings: commandRouteReadings({
      capabilities: merged.capabilities,
      slopweaverCommand,
      treeRoot: installedTreeRoot({ importMetaUrl: import.meta.url }),
    }),
    // A Google door with no stored grant is planned as unavailable carrying its connect verb, rather than as
    // a reachable leg whose first act would be to open a consent page in front of whoever ran the plan.
    connectionReadings: await connectionRouteReadings({
      capabilities: merged.capabilities,
      home: slopweaverHome(),
      profiles: recordedProfilePort(),
    }),
    question,
    slopweaverCommand,
    ...(profile === undefined ? {} : { profile }),
  });
}

/**
 * Run the read-only planning verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runRoutePlan(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: ROUTE_PLAN_USAGE });
    return EXIT_OK;
  }
  const parsed = parseRoutePlanArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    logger.error({ msg: ROUTE_PLAN_USAGE });
    return EXIT_USAGE;
  }
  const request = requestFromFlags({ values: parsed.value.values });
  if (request.isErr()) {
    request.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    logger.error({ msg: ROUTE_PLAN_USAGE });
    return EXIT_USAGE;
  }
  const loaded =
    request.value.profilePath === undefined
      ? ok<CapabilityProfile | undefined, RouteCommandError>(undefined)
      : loadCapabilityProfile({ path: request.value.profilePath });
  if (loaded.isErr()) {
    routeCommandErrorLines({ error: loaded.error }).forEach((problem) => {
      logger.error({ msg: problem });
    });
    return EXIT_ERROR;
  }
  const plan = await plannedFor({ profile: loaded.value, question: request.value.question });
  logger.out({ line: JSON.stringify(plan, null, 2) });
  return EXIT_OK;
}

export const routePlanCommand = defineCommand({ run: runRoutePlan });
