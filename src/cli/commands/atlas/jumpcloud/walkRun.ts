/**
 * `slopweaver atlas jumpcloud walk [--json] [--home <dir>]` — fill the atlas's `admin-console` surface by
 * walking every page `browserPages.ts` declares, in the owner's own signed-in Chrome, photographing each.
 *
 * The walk, the page list, the reduction, the gap judgement and the fill check are the domain's, each written
 * against the transport SEAM and settled by unit tests. What is here is the effects: the consent token the owner
 * provisioned, the transport bound to their Chrome profile pin, and the writer that proves each screenshot
 * landed.
 *
 * ## What makes this read-only is construction
 *
 * `console.jumpcloud.com` is a refuse-every-write host: `slopweaver browser act` refuses a click, hover,
 * focus, scroll, fill or type there. This verb never reaches that surface at all. The transport's snippet
 * (`browser/playwrightCli.ts`) is a fixed constant that only navigates, waits, reads and screenshots, and
 * `browserPages.ts` declares no route that creates, imports, exports or deletes anything.
 *
 * ## A lost session stops the walk and says so
 *
 * A settle on `/login/…` or the end-user portal ends the walk (the kit's `sessionLostOn`), publishes what was
 * reached with the rest marked not attempted, and exits non-zero naming the one step only the owner can take: sign
 * in again. Nothing here ever types a credential.
 */

import { JUMPCLOUD_CONSOLE_ORIGIN } from "../../../../atlas/jumpcloud/browserPages.js";
import { publishJumpcloudConsoleWalk } from "../../../../atlas/jumpcloud/browserSurface.js";
import { type JumpcloudPageObservation, walkJumpcloudConsole } from "../../../../atlas/jumpcloud/browserWalk.js";
import { type JumpcloudConsolePaths, jumpcloudConsolePaths } from "../../../../atlas/jumpcloud/consoleStore.js";
import { verifiedArtifactWriter } from "../../../../atlas/kit/artifactWriter.js";
import type { PageWalkPublished } from "../../../../atlas/kit/walkPublish.js";
import { relayDepsAt } from "../../../../atlas/kit/walkTransport.js";
import type { BrowserPageTransport } from "../../../../browser/pageTransport.js";
import { createPlaywrightCliTransport } from "../../../../browser/playwrightCli.js";
import { type RecordedProfilePort, recordedProfilePort } from "../../../../browser/recordedProfile.js";
import { slopweaverHome } from "../../../../homeDir.js";
import { logger } from "../../../../lib/logger.js";
import { err, ok, type Result } from "../../../../lib/result.js";
import { defineCommand } from "../../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../exitCodes.js";
import { parseFlagTail, verbTail } from "../../../optionParsers.js";
import { jsonPage, pageLine } from "../walkReport.js";

/** Where a JumpCloud verb sits: past the runtime, the script, the `atlas` noun and the `jumpcloud` platform. */
const JUMPCLOUD_VERB_INDEX = 4;

/**
 * Exported so a test can assert this equals the registration's own copy.
 * @internal
 */
export const JUMPCLOUD_WALK_USAGE = "usage: slopweaver atlas jumpcloud walk [--json] [--home <dir>]";

/** Parse the flag tail this verb accepts. */
function parseWalkOptions({ rest }: { rest: readonly string[] }): Result<{ home: string; json: boolean }> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home"] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const home = parsed.value.values["home"];
  const json = parsed.value.flags.has("json");
  if (home === undefined) {
    return ok({ home: slopweaverHome(), json });
  }
  return ok({ home, json });
}

/** Print what the walk published, as JSON or as one line per declared page. */
function report({
  asJson,
  outcome,
  pages,
  sessionLost,
}: {
  asJson: boolean;
  outcome: PageWalkPublished;
  pages: readonly JumpcloudPageObservation[];
  sessionLost: boolean;
}): void {
  if (asJson) {
    logger.out({
      line: JSON.stringify(
        { pages: pages.map((page) => jsonPage({ page })), published: outcome, sessionLost },
        null,
        1,
      ),
    });
    return;
  }
  logger.out({
    line:
      `jumpcloud console walk — ${String(outcome.reachedCount)} of ${String(outcome.declaredCount)} declared page(s) ` +
      `reached, ${String(outcome.photographedCount)} photographed, ` +
      `${String(outcome.operationCount)} distinct operation(s) published`,
  });
  for (const page of pages) {
    logger.out({ line: pageLine({ page }) });
  }
}

/**
 * Resolve everything a walk needs before it opens anything: the consent token, the console's artifacts
 * directory, and the Chrome profile pin — so a missing pin stops the walk before Chrome is touched.
 *
 * @param home the resolved state home
 * @param profiles the door the recorded work profile is read through
 * @returns the console paths and a bound transport, or every reason the walk cannot start
 */
async function bindTransport({ home, profiles }: { home: string; profiles: RecordedProfilePort }): Promise<
  Result<{
    paths: JumpcloudConsolePaths;
    transport: BrowserPageTransport;
  }>
> {
  const paths = jumpcloudConsolePaths({ home });
  const deps = await relayDepsAt({
    home,
    origins: [JUMPCLOUD_CONSOLE_ORIGIN],
    platform: "jumpcloud",
    profiles,
    scratchDir: paths.pageArtifacts,
  });
  if (deps.isErr()) {
    return err(deps.error);
  }
  return ok({ paths, transport: createPlaywrightCliTransport({ deps: deps.value }) });
}

/**
 * Run the JumpCloud console walk.
 *
 * @param argv the whole process argv
 * @returns the process exit code
 * @internal
 */
export async function runJumpcloudWalk(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, at: JUMPCLOUD_VERB_INDEX, verbs: ["walk"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: JUMPCLOUD_WALK_USAGE });
    return EXIT_OK;
  }
  const options = parseWalkOptions({ rest });
  if (options.isErr()) {
    options.error.forEach((line) => {
      logger.error({ msg: line });
    });
    logger.error({ msg: JUMPCLOUD_WALK_USAGE });
    return EXIT_USAGE;
  }
  const { home, json: asJson } = options.value;
  const profiles = recordedProfilePort();
  const bound = await bindTransport({ home, profiles });
  if (bound.isErr()) {
    bound.error.forEach((line) => {
      logger.error({ msg: line });
    });
    return EXIT_ERROR;
  }
  const { paths, transport } = bound.value;
  const walked = await walkJumpcloudConsole({
    progress: ({ line }) => {
      logger.error({ msg: line });
    },
    transport,
    writeArtifact: verifiedArtifactWriter({ directory: paths.directory }),
  });
  await transport.release();
  if (walked.isErr()) {
    walked.error.forEach((line) => {
      logger.error({ msg: line });
    });
    return EXIT_ERROR;
  }
  const published = publishJumpcloudConsoleWalk({ at: new Date().toISOString(), paths, walk: walked.value });
  if (published.isErr()) {
    published.error.forEach((line) => {
      logger.error({ msg: line });
    });
    return EXIT_ERROR;
  }
  report({ asJson, outcome: published.value, pages: walked.value.pages, sessionLost: walked.value.sessionLost });
  if (walked.value.sessionLost) {
    logger.error({
      msg: "the administrator session was lost mid-walk — sign in to the JumpCloud admin console in your own Chrome and run the walk again",
    });
    return EXIT_ERROR;
  }
  return EXIT_OK;
}

/** The `atlas jumpcloud walk` verb. */
export const jumpcloudWalkCommand = defineCommand({ run: runJumpcloudWalk });
