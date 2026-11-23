/**
 * `slopweaver atlas aether walk [--json] [--home <dir>]` — fill the atlas by walking every route the portal
 * registry declares, in the owner's own signed-in Chrome, and publish a generation.
 *
 * The walk, the reduction and the publish are the domain's (`atlas/aether/walk.ts`, `reduction.ts`,
 * `surface.ts`), every one written against the transport SEAM, so all are settled by unit tests over a fake.
 * What is here is the effects: attaching to the owner's browser, and writing screenshots to disk under the atlas's
 * own directory in `$SLOPWEAVER_HOME` (its only filesystem seam — `src/admit/coverage.ts` classes it
 * `local-state`).
 *
 * ## This verb IS the door
 *
 * Rule 3's own answer to "may an agent drive a browser" is that a `slopweaver` verb which drives one is the
 * door. So this is how the Aether portal is reached, and a hand-driven browser session is not — this
 * navigates a declared list under the host's read-only default and records what it saw, holding no cookie.
 */
import { join } from "node:path";

import { AETHER_PORTAL_ORIGIN, AETHER_PORTAL_ROUTES } from "../../../../atlas/aether/pages.js";
import { type AetherAtlasPaths, aetherAtlasPaths } from "../../../../atlas/aether/store.js";
import { type AetherWalkOutcome, publishAetherWalk } from "../../../../atlas/aether/surface.js";
import { walkAetherPortal } from "../../../../atlas/aether/walk.js";
import { verifiedArtifactWriter } from "../../../../atlas/kit/artifactWriter.js";
import { relayDepsAt } from "../../../../atlas/kit/walkTransport.js";
import type { BrowserPageTransport } from "../../../../browser/pageTransport.js";
import { createPlaywrightCliTransport } from "../../../../browser/playwrightCli.js";
import { type RecordedProfilePort, recordedProfilePort } from "../../../../browser/recordedProfile.js";
import { slopweaverHome } from "../../../../homeDir.js";
import { logger } from "../../../../lib/logger.js";
import { err, ok, type Result } from "../../../../lib/result.js";
import { defineCommand } from "../../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../exitCodes.js";
import { parseFlagTail, verbTail } from "../../../optionParsers.js";

/** Where an Aether verb sits: past the runtime, the script, the `atlas` noun and the `aether` platform. */
const AETHER_VERB_INDEX = 4;

/**
 * Exported so a test can assert this equals the manifest's own copy.
 *
 * @internal
 */
export const AETHER_WALK_USAGE = "usage: slopweaver atlas aether walk [--json] [--home <dir>]";

/**
 * Run the `atlas aether walk` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 * @internal
 */
export async function runAetherWalk(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, at: AETHER_VERB_INDEX, verbs: ["walk"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: AETHER_WALK_USAGE });
    return EXIT_OK;
  }
  const options = parseWalkOptions({ rest });
  if (options.isErr()) {
    printErrors({ errors: [...options.error, AETHER_WALK_USAGE] });
    return EXIT_USAGE;
  }
  const { home, json } = options.value;

  const profiles = recordedProfilePort();
  const ready = await prepareWalk({ home, profiles });
  if (ready.isErr()) {
    printErrors({ errors: ready.error });
    return EXIT_EXPECTED_EMPTY;
  }
  const { paths, transport } = ready.value;
  if (!json) {
    logger.out({ line: `aether portal: ${String(AETHER_PORTAL_ROUTES.length)} declared route(s); walking all` });
  }

  const walked = await walkAetherPortal({
    origin: AETHER_PORTAL_ORIGIN,
    routes: AETHER_PORTAL_ROUTES,
    transport,
    writeArtifact: verifiedArtifactWriter({ directory: paths.directory }),
    ...(json
      ? {}
      : {
          progress: ({ line }: { line: string }) => {
            logger.out({ line });
          },
        }),
  });
  if (walked.isErr()) {
    printErrors({ errors: walked.error });
    return EXIT_ERROR;
  }

  const published = publishAetherWalk({ at: new Date().toISOString(), paths, walk: walked.value });
  if (published.isErr()) {
    printErrors({ errors: published.error });
    return EXIT_ERROR;
  }
  reportOutcome({ artifactsWritten: walked.value.artifactsWritten, json, outcome: published.value });
  return aetherWalkExitCode({ outcome: published.value });
}

/**
 * The exit code a published walk ends on: expected-empty when the walk hit the sign-in wall or recorded no
 * finding, success otherwise.
 *
 * @param outcome the published walk's sign-in state and finding count
 * @returns the process exit code
 * @internal
 */
export function aetherWalkExitCode({
  outcome,
}: {
  outcome: Pick<AetherWalkOutcome, "findingCount" | "loggedOut">;
}): number {
  return outcome.loggedOut || outcome.findingCount === 0 ? EXIT_EXPECTED_EMPTY : EXIT_OK;
}

/** Print a list of failure lines to stderr, so the runner's guards read as one call each. */
function printErrors({ errors }: { errors: readonly string[] }): void {
  errors.forEach((error) => {
    logger.error({ msg: error });
  });
}

/** Report what the walk published — the whole document under `--json`, otherwise a line or two. */
function reportOutcome({
  outcome,
  artifactsWritten,
  json,
}: {
  outcome: AetherWalkOutcome;
  artifactsWritten: number;
  json: boolean;
}): void {
  if (json) {
    logger.out({ line: JSON.stringify({ ...outcome, artifactsWritten }, null, 2) });
    return;
  }
  logger.out({
    line: `aether portal: ${String(outcome.landedCount)}/${String(outcome.pageCount)} route(s) rendered; ${String(outcome.findingCount)} finding(s), ${String(outcome.projectCount)} project(s); ${String(artifactsWritten)} screenshot(s)`,
  });
  if (outcome.loggedOut) {
    logger.out({
      line: "aether portal: the walk hit the sign-in wall — nothing was read; sign in to app.tryaether.ai in the work profile and walk again",
    });
  }
}

/** Parse this verb's whole flag tail, so the runner reads as steps rather than as a wall of guards. */
function parseWalkOptions({ rest }: { rest: readonly string[] }): Result<{ home: string; json: boolean }> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home"] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values, flags } = parsed.value;
  let home = slopweaverHome();
  const homeFlag = values["home"];
  if (homeFlag !== undefined) {
    home = homeFlag;
  }
  return ok({ home, json: flags.has("json") });
}

/**
 * Everything a walk needs before it can visit a page: the atlas paths, and a transport already bound to the
 * owner's own Chrome and to the portal's one origin.
 *
 * Grouped into one function so the verb reads as a sequence of steps, and so every way this can refuse — no
 * consent token, no recorded profile, a browser that could not be reached — is reported in the same shape.
 *
 * @param home the state home holding the token, the pin and the atlas
 * @param profiles the door the recorded work profile is read through
 * @returns the paths and attached transport, or every reason the walk cannot start
 */
async function prepareWalk({
  home,
  profiles,
}: {
  home: string;
  profiles: RecordedProfilePort;
}): Promise<Result<{ paths: AetherAtlasPaths; transport: BrowserPageTransport }>> {
  const paths = aetherAtlasPaths({ home });
  const scratchDir = join(paths.directory, "artifacts", "_incoming");
  const deps = await relayDepsAt({ home, origins: [AETHER_PORTAL_ORIGIN], platform: "aether", profiles, scratchDir });
  if (deps.isErr()) {
    return err(deps.error);
  }
  // No eager attach: the machine-wide relay lease is taken on the first `visit`, so a pre-flight attach
  // would open a connect tab before anything checked whether this walk may run — the first visit reports
  // the same typed `TRANSPORT_UNAVAILABLE`, which the walk already stops on.
  return ok({ paths, transport: createPlaywrightCliTransport({ deps: deps.value }) });
}

export const aetherWalkCommand = defineCommand({ run: runAetherWalk });
