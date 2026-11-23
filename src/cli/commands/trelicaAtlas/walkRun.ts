/**
 * `slopweaver atlas trelica walk [--limit <n>] [--json] [--home <dir>]` — fill the atlas's BROWSER surface
 * by walking every page `browserPages.ts` declares, in the owner's own Chrome, photographing each.
 *
 * The walk, the page inventory, the reduction and the gap judgement are the domain's, and each is written
 * against the transport SEAM, so all of them are settled by unit tests over a fake. What is here is the
 * effects: resolving the tenant and the consent token the owner provisioned, binding the transport that
 * attaches to the owner's browser, and the writer that proves each screenshot landed.
 *
 * ## What makes this read-only is construction, not the door guard
 *
 * `src/admit/browserSurface.ts` matches `mcp__claude-in-chrome__*` tool calls, so it does not see this path
 * at all. What holds the property is the snippet in `browser/playwrightCli.ts`: a fixed constant that only
 * ever calls `goto`, `waitForTimeout`, `$$eval` for hrefs, `screenshot`, `bringToFront`, `title` and
 * `url` — every one a read, save the tab activation a wedged capture needs (`playwrightCli.ts`).
 *
 * ## No URL is ever printed, in either report shape
 *
 * A tenant address carries the organisation's own name. Both the human report and `--json` name the
 * declared SURFACE and its outcome and never the address.
 */

import { verifiedArtifactWriter } from "../../../atlas/kit/artifactWriter.js";
import { relayDepsAt } from "../../../atlas/kit/walkTransport.js";
import { TRELICA_BROWSER_PAGES } from "../../../atlas/trelica/browserPages.js";
import { publishTrelicaBrowserSurface } from "../../../atlas/trelica/browserSurface.js";
import { type TrelicaPageObservation, walkTrelicaWebApp } from "../../../atlas/trelica/browserWalk.js";
import { type TrelicaAtlasPaths, trelicaAtlasPaths } from "../../../atlas/trelica/store.js";
import { resolveTrelicaTenantOrigin, TRELICA_LOGIN_ORIGIN } from "../../../atlas/trelica/tenant.js";
import type { BrowserPageTransport } from "../../../browser/pageTransport.js";
import { createPlaywrightCliTransport } from "../../../browser/playwrightCli.js";
import { type RecordedProfilePort, recordedProfilePort } from "../../../browser/recordedProfile.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";

import { parseTrelicaWalkOptions, TRELICA_VERB_INDEX, TRELICA_WALK_USAGE } from "./core.js";

/** The one word a page's row leads with. */
function pageVerdict({ page }: { page: TrelicaPageObservation }): string {
  if (!page.attempted) {
    return "NOT-ATTEMPTED";
  }
  if (page.unreachableBecause !== null) {
    return "NOT-HELD";
  }
  return page.screenshotMissingBecause === null ? "HELD" : "NO-SHOT";
}

/**
 * One page's row. Names the declared surface and what became of it — never its URL.
 *
 * @param page the observation to render
 * @returns the line, carrying the verdict, the call and body counts, and every reason the page is not held
 *
 * @internal
 */
export function trelicaPageLine({ page }: { page: TrelicaPageObservation }): string {
  const counts = `${String(page.responseAccounting.bodySucceeded)} kept / ${String(page.responseAccounting.eligible)} eligible`;
  const why = page.unreachableBecause === null ? "" : ` — ${page.unreachableBecause}`;
  const shot = page.screenshotMissingBecause === null ? "" : ` — ${page.screenshotMissingBecause}`;
  return `  ${page.surface.padEnd(20)} ${pageVerdict({ page }).padEnd(14)} ${String(page.calls.length)} call(s), ${counts}${why}${shot}`;
}

/**
 * Run the Trelica browser walk.
 *
 * @param argv the whole process argv
 * @returns the process exit code
 */
export async function trelicaAtlasWalkCommand(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, at: TRELICA_VERB_INDEX, verbs: ["walk"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: TRELICA_WALK_USAGE });
    return EXIT_OK;
  }
  const options = parseTrelicaWalkOptions({ rest });
  if (options.isErr()) {
    return refuse({ problems: options.error, usage: true });
  }
  const { home, json: asJson, limit } = options.value;
  const profiles = recordedProfilePort();
  const ready = await prepareWalk({ home, profiles });
  if (ready.isErr()) {
    return refuse({ problems: ready.error, usage: false });
  }
  const { paths, tenantOrigin, transport } = ready.value;

  const walked = await walkTrelicaWebApp({
    nowIso: () => new Date().toISOString(),
    pages: limit === undefined ? TRELICA_BROWSER_PAGES : TRELICA_BROWSER_PAGES.slice(0, limit),
    tenantOrigin,
    transport,
    writeArtifact: verifiedArtifactWriter({ directory: paths.directory }),
    ...(asJson
      ? {}
      : {
          progress: ({ line }: { line: string }) => {
            logger.out({ line });
          },
        }),
  });
  await transport.release();
  if (walked.isErr()) {
    return refuse({ problems: walked.error, usage: false });
  }
  const published = publishTrelicaBrowserSurface({ at: new Date().toISOString(), paths, walk: walked.value });
  if (published.isErr()) {
    return refuse({ problems: published.error, usage: false });
  }
  if (asJson) {
    logger.out({ line: JSON.stringify(published.value, null, 1) });
    return EXIT_OK;
  }
  logger.out({
    line:
      `trelica web-app surface — ${String(published.value.pagesReached)} of ` +
      `${String(published.value.pagesDeclared)} declared page(s) reached, ` +
      `${String(published.value.pagesPhotographed)} photographed, ` +
      `${String(published.value.operationsObserved)} operation(s) observed, ` +
      `${String(published.value.openGaps)} open gap(s)`,
  });
  walked.value.pages.forEach((page) => {
    logger.out({ line: trelicaPageLine({ page }) });
  });
  return EXIT_OK;
}

/**
 * Resolve the tenant, the consent token and the artifact directory, and attach the transport.
 *
 * @param home the state home to read configuration and write the generation under
 * @param profiles the door the recorded work profile is read through
 * @returns everything the walk needs, or every reason it cannot start
 */
async function prepareWalk({ home, profiles }: { home: string; profiles: RecordedProfilePort }): Promise<
  Result<{
    paths: TrelicaAtlasPaths;
    tenantOrigin: string;
    transport: BrowserPageTransport;
  }>
> {
  const tenantOrigin = resolveTrelicaTenantOrigin({ home });
  if (tenantOrigin.isErr()) {
    return err(tenantOrigin.error);
  }
  const paths = trelicaAtlasPaths({ home });
  // The token and the profile pin resolve inside `relayDepsAt`, so a missing recorded profile stops the walk
  // BEFORE anything launches: without it Chrome opens the connect page in whichever profile it was last used
  // in, which is what `src/browser/profilePin.ts` exists to prevent.
  const deps = await relayDepsAt({
    home,
    origins: [tenantOrigin.value, TRELICA_LOGIN_ORIGIN],
    platform: "trelica",
    profiles,
    scratchDir: paths.pageArtifacts,
  });
  if (deps.isErr()) {
    return err(deps.error);
  }
  return ok({
    paths,
    tenantOrigin: tenantOrigin.value,
    transport: createPlaywrightCliTransport({ deps: deps.value }),
  });
}

/** Print every reason this verb will not run, and pick the exit code that says which kind it was. */
function refuse({ problems, usage }: { problems: readonly string[]; usage: boolean }): number {
  problems.forEach((line) => {
    logger.error({ msg: line });
  });
  if (usage) {
    logger.error({ msg: TRELICA_WALK_USAGE });
  }
  return usage ? EXIT_USAGE : EXIT_ERROR;
}
