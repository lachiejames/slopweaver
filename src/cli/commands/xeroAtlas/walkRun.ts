/**
 * `slopweaver atlas xero walk [--json] [--home <dir>]` — fill the atlas's BROWSER surface by walking every
 * page `browserPages.ts` declares, in the owner's own Chrome, photographing each.
 *
 * The walk, the page inventory, the reduction and the gap judgement are the domain's, and each is written
 * against the transport SEAM, so all of them are settled by unit tests over a fake. What is here is the
 * effects: resolving the consent token the owner provisioned, binding the transport that attaches to the owner's
 * browser, and the writer that proves each screenshot landed.
 *
 * ## What makes this read-only is construction, not the door guard
 *
 * `src/admit/browserSurface.ts` matches `mcp__claude-in-chrome__*` tool calls, so it does not see this path
 * at all. What holds the property is the snippet in `browser/playwrightCli.ts`: a fixed constant that only
 * ever calls `goto`, `waitForTimeout`, `$$eval` for hrefs, `screenshot`, `bringToFront`, `title` and
 * `url` — every one a read, save the tab activation a wedged capture needs (`playwrightCli.ts`). Playwright separates reading a page
 * from acting on one at the API, which the `computer` tool — where `screenshot` and `type` are the same
 * call — cannot. That is a stronger guarantee than the guard offers, and it is stated here rather than
 * claimed as coverage. `browserPages.ts`'s fourth rule is the other half: no declared route DOES anything.
 *
 * ## No URL is ever printed, in either report shape
 *
 * A Xero app URL carries the organisation's own short code. Both the human report and `--json` name the
 * declared SURFACE and its outcome and never the address, so redirecting this verb's output into a file
 * cannot put a private identifier somewhere it does not belong.
 */

import { verifiedArtifactWriter } from "../../../atlas/kit/artifactWriter.js";
import { relayDepsAt } from "../../../atlas/kit/walkTransport.js";
import { publishXeroBrowserWalk, type XeroBrowserSurfaceOutcome } from "../../../atlas/xero/browserSurface.js";
import { walkXeroBrowser, type XeroPageObservation } from "../../../atlas/xero/browserWalk.js";
import { type XeroAtlasPaths, xeroAtlasPaths } from "../../../atlas/xero/store.js";
import { XERO_WALK_LEASE_ORIGINS } from "../../../atlas/xero/walkLease.js";
import type { BrowserPageTransport } from "../../../browser/pageTransport.js";
import { createPlaywrightCliTransport } from "../../../browser/playwrightCli.js";
import { type RecordedProfilePort, recordedProfilePort } from "../../../browser/recordedProfile.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlagTail, resolveHome, verbTail } from "../../optionParsers.js";
import { jsonPage, pageLine } from "../atlas/walkReport.js";

/** Where a Xero atlas verb sits: past the runtime, the script, the `atlas` noun and the `xero` platform. */
const XERO_VERB_INDEX = 4;

/**
 * Exported so a test can assert this equals the manifest's own copy.
 *
 * @internal
 */
export const XERO_WALK_USAGE = "usage: slopweaver atlas xero walk [--json] [--home <dir>]";

/** Parse the flag tail this verb accepts. */
function parseWalkOptions({ rest }: { rest: readonly string[] }): Result<{ home: string; json: boolean }> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home"] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  return ok({ home: resolveHome({ named: parsed.value.values["home"] }), json: parsed.value.flags.has("json") });
}

/** Print what the walk published, as JSON or as one line per declared page. */
function report({
  asJson,
  outcome,
  pages,
}: {
  asJson: boolean;
  outcome: XeroBrowserSurfaceOutcome;
  pages: readonly XeroPageObservation[];
}): void {
  if (asJson) {
    logger.out({
      line: JSON.stringify({ pages: pages.map((page) => jsonPage({ page })), published: outcome }, null, 1),
    });
    return;
  }
  logger.out({
    line:
      `xero browser walk — ${String(outcome.reachedCount)} of ${String(outcome.declaredCount)} declared page(s) ` +
      `reached, ${String(outcome.photographedCount)} photographed, ` +
      `${String(outcome.operationCount)} distinct operation(s) published`,
  });
  for (const page of pages) {
    logger.out({ line: pageLine({ page }) });
  }
}

/**
 * Resolve everything a walk needs before it opens anything: the consent token, the atlas's own artifacts
 * directory, and the Chrome profile pin.
 *
 * The pin is resolved HERE rather than inside the transport, so a missing recorded profile stops the walk
 * BEFORE anything launches — without it Chrome opens the connect page in whichever profile it was last used
 * in, which is exactly what `src/browser/profilePin.ts` exists to prevent.
 *
 * @param home the resolved state home
 * @param profiles the door the recorded work profile is read through
 * @returns the atlas paths and a bound transport, or every reason the walk cannot start
 */
async function bindTransport({ home, profiles }: { home: string; profiles: RecordedProfilePort }): Promise<
  Result<{
    paths: XeroAtlasPaths;
    transport: BrowserPageTransport;
  }>
> {
  const paths = xeroAtlasPaths({ home });
  const deps = await relayDepsAt({
    home,
    origins: XERO_WALK_LEASE_ORIGINS,
    platform: "xero",
    profiles,
    scratchDir: paths.pageArtifacts,
  });
  if (deps.isErr()) {
    return err(deps.error);
  }
  return ok({ paths, transport: createPlaywrightCliTransport({ deps: deps.value }) });
}

/**
 * Run the Xero browser walk.
 *
 * @param argv the whole process argv
 * @returns the process exit code
 */
export async function xeroAtlasWalkCommand(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, at: XERO_VERB_INDEX, verbs: ["walk"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: XERO_WALK_USAGE });
    return EXIT_OK;
  }
  const options = parseWalkOptions({ rest });
  if (options.isErr()) {
    options.error.forEach((line) => {
      logger.error({ msg: line });
    });
    logger.error({ msg: XERO_WALK_USAGE });
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
  const walked = await walkXeroBrowser({
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
  const published = publishXeroBrowserWalk({ at: new Date().toISOString(), paths, walk: walked.value });
  if (published.isErr()) {
    published.error.forEach((line) => {
      logger.error({ msg: line });
    });
    return EXIT_ERROR;
  }
  report({ asJson, outcome: published.value, pages: walked.value.pages });
  return EXIT_OK;
}
