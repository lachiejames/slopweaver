/**
 * `slopweaver atlas datadog walk [--limit <n>] [--skip-nav] [--skip-palette] [--json] [--home <dir>]` — fill
 * the atlas's CONSOLE surface by walking every page the left nav declares, in the owner's own Chrome, then
 * re-reading that nav and opening the command palette.
 *
 * The walk, the reduction and the publish are the domain's (`atlas/datadog/consoleWalk.ts`,
 * `consoleReduction.ts`, `consoleSurface.ts`) and every one of them is written against two seams, so all
 * of them are settled by unit tests over fakes. What is here is the effects: attaching to the owner's browser
 * twice — the page transport and the console transport are two relay clients on one lease, taken in
 * turn — and writing the screenshots to disk.
 *
 * ## This verb IS the door
 *
 * Rule 3's own answer to "may an agent drive a browser" is that a `slopweaver` verb which drives one is the
 * door. This navigates a declared list under a read-only posture, hovers the nav's own entries, presses one
 * fixed key chord, and records what it saw; a hand-driven session has a keystroke one missed click away
 * from it (`docs/browser-route/provider-arms.md`). The console it opens is only ever this install's `DD_SITE`
 * (`src/datadog/config.ts`), never a doc example.
 *
 * ## `--limit` is for proving the lane, never for a real generation
 *
 * It stops after n routes and the published coverage says so (`deferred`, with the fraction), because a
 * partial walk reporting itself as complete is the failure the sibling Slack walk shipped once.
 */
import { DATADOG_CONSOLE_ROUTES } from "../../../atlas/datadog/consolePages.js";
import { type DatadogConsoleOutcome, publishDatadogConsoleWalk } from "../../../atlas/datadog/consoleSurface.js";
import { boundedRoutes, walkDatadogConsole } from "../../../atlas/datadog/consoleWalk.js";
import type { DatadogAtlasError } from "../../../atlas/datadog/errors.js";
import { datadogAtlasPaths } from "../../../atlas/datadog/store.js";
import { verifiedArtifactWriter } from "../../../atlas/kit/artifactWriter.js";
import { relayDepsFor } from "../../../atlas/kit/walkTransport.js";
import { createDatadogConsoleTransport, type DatadogConsoleTransport } from "../../../browser/datadogConsole.js";
import type { BrowserPageTransport } from "../../../browser/pageTransport.js";
import { createPlaywrightCliTransport } from "../../../browser/playwrightCli.js";
import { type RecordedProfilePort, recordedProfilePort } from "../../../browser/recordedProfile.js";
import { consoleHostFor, resolveSite } from "../../../datadog/config.js";
import { datadogConfigErrorLines } from "../../../datadog/configErrors.js";
import { datadogSite } from "../../../datadog/source.js";
import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlagTail, verbTail } from "../../optionParsers.js";

/** Where a Datadog atlas verb sits: past the runtime, the script, `atlas` and the `datadog` platform. */
const DATADOG_VERB_INDEX = 4;

/**
 * Exported so a test can assert this equals the manifest's own copy.
 * @internal
 */
export const DATADOG_WALK_USAGE =
  "usage: slopweaver atlas datadog walk [--limit <n>] [--skip-nav] [--skip-palette] [--json] [--home <dir>]";

/** Parse this verb's whole flag tail, so the runner reads as steps rather than as a wall of guards. */
function parseWalkOptions({ rest }: { rest: readonly string[] }): Result<{
  home: string;
  json: boolean;
  limit: number | null;
  skipNav: boolean;
  skipPalette: boolean;
}> {
  const parsed = parseFlagTail({
    rest,
    spec: { boolean: ["json", "skip-nav", "skip-palette"], value: ["home", "limit"] },
  });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values, flags } = parsed.value;
  const limit = parseLimit({ raw: values["limit"] });
  if (limit.isErr()) {
    return err(limit.error);
  }
  const { home = slopweaverHome() } = values;
  return ok({
    home,
    json: flags.has("json"),
    limit: limit.value,
    skipNav: flags.has("skip-nav"),
    skipPalette: flags.has("skip-palette"),
  });
}

/** Parse `--limit`, which must be a positive integer when it is present at all. */
function parseLimit({ raw }: { raw: string | undefined }): Result<number | null> {
  if (raw === undefined) {
    return ok(null);
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return err([`--limit must be a positive integer, not ${raw}`]);
  }
  return ok(parsed);
}

/**
 * Everything a walk needs before it can visit a page: the console origin from `DD_SITE`, and two transports
 * on the owner's own Chrome, neither attached until its first operation.
 *
 * @param home the state home holding the consent token, the recorded profile and the atlas
 * @param skipNav whether to leave the nav leg out
 * @param skipPalette whether to leave the palette leg out
 * @param profiles the door the recorded work profile is read through
 * @returns the origin and both transports, or every reason the walk cannot start
 */
async function prepareWalk({
  home,
  skipNav,
  skipPalette,
  profiles,
}: {
  home: string;
  skipNav: boolean;
  skipPalette: boolean;
  profiles: RecordedProfilePort;
}): Promise<Result<{ origin: string; transport: BrowserPageTransport; console: DatadogConsoleTransport | null }>> {
  const site = resolveSite({ raw: datadogSite({ home }) });
  if (site.isErr()) {
    return err(datadogConfigErrorLines({ error: site.error }));
  }
  const origin = `https://${consoleHostFor({ site: site.value })}`;
  const paths = datadogAtlasPaths({ home });
  const deps = await relayDepsFor({
    directory: paths.directory,
    home,
    origins: [origin],
    platform: "datadog",
    profiles,
  });
  if (deps.isErr()) {
    return err(deps.error);
  }
  // No eager attach here: the machine-wide lease is taken on the first operation, so a pre-flight attach
  // could take the relay off a walk that legitimately holds it before anything had checked this one may run.
  const transport = createPlaywrightCliTransport({ deps: deps.value });
  const consoleTransport =
    skipNav && skipPalette ? null : createDatadogConsoleTransport({ deps: deps.value, url: `${origin}/` });
  return ok({ console: consoleTransport, origin, transport });
}

/** Print what the walk established: the whole document under `--json`, otherwise a few lines. */
function report({
  json,
  outcome,
  artifactsWritten,
}: {
  json: boolean;
  outcome: DatadogConsoleOutcome;
  artifactsWritten: number;
}): void {
  if (json) {
    logger.out({ line: JSON.stringify({ ...outcome, artifactsWritten }, null, 2) });
    return;
  }
  logger.out({
    line: `datadog console: ${String(outcome.landedCount)} of ${String(outcome.declaredCount)} declared page(s) rendered (${String(outcome.attemptedCount)} attempted, ${String(outcome.omittedCount)} left out by --limit, ${String(outcome.notAttemptedCount)} never reached); ${String(artifactsWritten)} screenshot(s) kept`,
  });
  logger.out({
    line: `recorded ${String(outcome.requestCount)} distinct first-party endpoint(s); ${String(outcome.corroboratedKinds.length)} registry kind(s) corroborated; ${String(outcome.undeclaredCount)} landing(s) the registry does not declare`,
  });
  if (outcome.navDrift !== null) {
    logger.out({
      line: `live nav: ${String(outcome.navDrift.undeclared.length)} undeclared page(s), ${String(outcome.navDrift.gone.length)} declared page(s) no longer offered`,
    });
  }
  if (outcome.palette !== null) {
    const buckets = outcome.palette.buckets.map((bucket) => `${bucket.bucket}×${String(bucket.count)}`).join(", ");
    logger.out({
      line: `palette: ${String(outcome.palette.filterNames.length)} filter(s), ${String(outcome.palette.optionCount)} suggestion(s); entity body ${outcome.palette.bodyRead ? `lists ${buckets}` : `not reduced (fields: ${outcome.palette.unreadShape.join(", ")})`}`,
    });
  }
}

/**
 * Resolve the bound against the declared registry and say, before anything is visited, how much of it this
 * run will cover.
 *
 * The line is printed here rather than after the walk on purpose: a bounded run that says so only in its
 * published coverage leaves the operator watching 239 declared pages scroll past with no idea the verb
 * intends to stop at three.
 *
 * @param limit the parsed `--limit`, or `null` for the whole registry
 * @param json whether the caller wants only the document, in which case nothing is narrated
 * @param origin the console origin the line names
 * @returns nothing on success, or the reason the bound is unusable
 */
function announceBound({
  limit,
  json,
  origin,
}: {
  limit: number | null;
  json: boolean;
  origin: string;
}): Result<null, DatadogAtlasError> {
  const bounded = boundedRoutes({ limit, routes: DATADOG_CONSOLE_ROUTES });
  if (bounded.isErr()) {
    return err(bounded.error);
  }
  if (!json) {
    logger.out({
      line: `datadog console at ${origin}: ${String(DATADOG_CONSOLE_ROUTES.length)} declared page(s); walking ${String(bounded.value.visiting.length)}`,
    });
  }
  return ok(null);
}

/**
 * Run the `atlas datadog walk` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 * @internal
 */
export async function runDatadogWalk(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, at: DATADOG_VERB_INDEX, verbs: ["walk"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: DATADOG_WALK_USAGE });
    return EXIT_OK;
  }
  const options = parseWalkOptions({ rest });
  if (options.isErr()) {
    options.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: DATADOG_WALK_USAGE });
    return EXIT_USAGE;
  }
  const { home, json, limit, skipNav, skipPalette } = options.value;
  const profiles = recordedProfilePort();
  const ready = await prepareWalk({ home, profiles, skipNav, skipPalette });
  if (ready.isErr()) {
    ready.error.forEach((error) => {
      logger.error({ msg: error });
    });
    return EXIT_EXPECTED_EMPTY;
  }
  const { console: consoleTransport, origin, transport } = ready.value;
  const announced = announceBound({ json, limit, origin });
  if (announced.isErr()) {
    logger.error({ msg: announced.error.message });
    return EXIT_USAGE;
  }
  const walked = await walkDatadogConsole({
    console: consoleTransport,
    legs: { nav: !skipNav, palette: !skipPalette },
    limit,
    origin,
    routes: DATADOG_CONSOLE_ROUTES,
    transport,
    writeArtifact: verifiedArtifactWriter({ directory: datadogAtlasPaths({ home }).directory }),
    ...(json
      ? {}
      : {
          progress: ({ line }: { line: string }) => {
            logger.out({ line });
          },
        }),
  });
  if (walked.isErr()) {
    logger.error({ msg: walked.error.message });
    return EXIT_ERROR;
  }
  const published = publishDatadogConsoleWalk({ at: new Date().toISOString(), home, origin, walk: walked.value });
  if (published.isErr()) {
    published.error.forEach((error) => {
      logger.error({ msg: error });
    });
    return EXIT_ERROR;
  }
  report({ artifactsWritten: walked.value.artifactsWritten, json, outcome: published.value });
  return published.value.landedCount === 0 ? EXIT_EXPECTED_EMPTY : EXIT_OK;
}

export const datadogAtlasWalkCommand = defineCommand({ run: runDatadogWalk });
