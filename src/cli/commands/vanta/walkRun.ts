/**
 * `slopweaver atlas vanta walk [--json] [--home <dir>]` — fill the atlas's BROWSER surface by walking every
 * page `browserPages.ts` declares, in the owner's own Chrome.
 *
 * The walk, the page inventory and the reduction are the domain's (`atlas/vanta/browserWalk.ts`,
 * `browserPages.ts`, `browserReduction.ts`) and each is written against the transport SEAM, so all of them
 * are settled by unit tests over a fake. What is here is the effects: resolving the consent token the owner
 * provisioned, and binding the transport that attaches to their browser.
 *
 * ## What makes this read-only is construction, not the door guard
 *
 * `src/admit/browserSurface.ts` matches `mcp__claude-in-chrome__*` tool calls, so it does not see this path
 * at all and a grant here would be a record rather than an enforced gate. What actually holds the property
 * is the snippet in `browser/playwrightCli.ts`, whose every statement is written there and whose whole call set is `goto`, `waitForTimeout`, `$$eval` for hrefs,
 * `screenshot`, `bringToFront`, `title` and `url` — every one a read, save the tab activation a wedged
 * capture needs (`playwrightCli.ts`); the interpolated values vary, never a call. Playwright separates reading a page from acting on one
 * at the API, which the `computer` tool — where `screenshot` and `type` are the same call — cannot. That is
 * a stronger guarantee than the guard offers, and it is stated here rather than claimed as coverage.
 */

import { verifiedArtifactWriter } from "../../../atlas/kit/artifactWriter.js";
import { notHeldBecause } from "../../../atlas/kit/pageWalk.js";
import { attachTransportAt } from "../../../atlas/kit/walkTransport.js";
import { VANTA_WEB_ORIGIN, vantaTenantRootFromSlug } from "../../../atlas/vanta/browserPages.js";
import { publishVantaBrowserWalk, type VantaBrowserSurfaceOutcome } from "../../../atlas/vanta/browserSurface.js";
import { type VantaPageObservation, walkVantaBrowser } from "../../../atlas/vanta/browserWalk.js";
import { vantaAtlasPaths } from "../../../atlas/vanta/store.js";
import { resolveVantaTenantSlug } from "../../../atlas/vanta/tenantSlug.js";
import { recordedProfilePort } from "../../../browser/recordedProfile.js";
import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { flagValue, flagValueOr, parseFlagTail, verbTail } from "../../optionParsers.js";

/** Where a Vanta verb sits: past the runtime, the script, the `atlas` noun and the `vanta` platform. */
const VANTA_VERB_INDEX = 4;

/**
 * Exported so a test can assert this equals the manifest's own copy, for the same reason
 * {@link ../vanta/resetRun.js}'s is.
 *
 * @internal
 */
export const VANTA_WALK_USAGE = "usage: slopweaver atlas vanta walk [--tenant <slug>] [--json] [--home <dir>]";

/**
 * One page's row, as the human-readable report prints it.
 *
 * A reached page with no picture prints `NO-SCREENSHOT` rather than `reached`, because those are different
 * outcomes and the whole reason this walk was rewritten is that they used to print the same.
 */
function pageLine({ page }: { page: VantaPageObservation }): string {
  const counts = `${String(page.responseAccounting.bodySucceeded)} kept / ${String(page.responseAccounting.eligible)} eligible`;
  const redirect = page.redirected ? ", the client chose a different view" : "";
  const why = notHeldBecause({ page });
  const suffix = why === null ? "" : ` — ${why}`;
  return `  ${page.surface.padEnd(26)} ${reachWord({ page })}  ${String(page.calls.length)} call(s), ${counts}${redirect}${suffix}`;
}

/** Which of the four outcomes this page came to: never asked for, unreachable, unphotographed, or held. */
function reachWord({ page }: { page: VantaPageObservation }): string {
  if (!page.attempted) {
    return "NOT ASKED  ";
  }
  if (page.unreachableBecause !== null) {
    return "UNREACHABLE";
  }
  return page.screenshotMissingBecause === null ? "held       " : "NO-SCREENSHOT";
}

/** Parse the flag tail this verb accepts. */
function parseWalkOptions({
  rest,
}: {
  rest: readonly string[];
}): Result<{ home: string; json: boolean; tenant: string | null }> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home", "tenant"] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  return ok({
    home: flagValueOr({ fallback: slopweaverHome(), name: "home", parsed: parsed.value }),
    json: parsed.value.flags.has("json"),
    tenant: flagValue({ name: "tenant", parsed: parsed.value }),
  });
}

/**
 * The tenant root to seed the walk with, or `null` to let it probe for one.
 *
 * ## It saves one page load. It does NOT fix the navigation failures, and that was measured
 *
 * The honest scope of this, because the first draft of this comment claimed more and was wrong within the
 * hour. The probe is one navigation in front of the work, and for a ONE-page run it is half the run and a
 * single point of failure ahead of it — a retry of one control was measured spending its whole budget on
 * `could not reach the Vanta web client to learn its tenant: … ETIMEDOUT` and never reaching the control.
 * That is the whole benefit and it is real.
 *
 * What it is NOT is a cure for the navigate failures this walk sees. A control that had failed twice
 * photographed on its first seeded attempt, which looked like causation; two SEEDED twelve-page walks then
 * failed 3 and 4 pages anyway. A peer session predicted that before the runs landed, from the right
 * evidence: probe damage would be POSITIONAL, clustered behind the probe and decaying, and the failures sit
 * at ordinals 2/7/11, 2/4/8/12, 2/9/11 and 3/5 across four runs — spread, not decaying. Both readings can
 * be true at different scales without being one cause: in a twelve-page walk the probe is one load of
 * thirteen, and in a one-page shot a probe failure IS the run failing.
 *
 * ## What those four runs canNOT tell you, which is more than it looks
 *
 * They rule out the probe cleanly and separate nothing else, and the reason is worth stating so nobody
 * re-derives the same non-finding. `controls-collection` failed in three of the four, which reads as a page
 * property — but it is ordinal 2 in {@link ../../../atlas/vanta/browserPages.js#VANTA_BROWSER_PAGES} and has
 * never sat anywhere else, so "heaviest page" and "second page" are perfectly confounded and a
 * second-position mechanism predicts the identical table. There is a plausible one: every visit is a
 * separate client process against the same daemon and the same tab, so anything not fully released across
 * that handover is paid at ordinal 2 whatever page is there.
 *
 * Nor can they separate either from machine LOAD. `NAVIGATION_TIMEOUT_MS` is 45s, and those runs took 419s
 * and 549s with 3 and 4 failures — about 31s and 46s per successful page, against the 7.7s
 * `../../../browser/playwrightCli.ts` measured. Successes were landing either side of the ceiling on a
 * machine stamped at load average 12.68-15.20 with 44 users, so there was no headroom and the heaviest page
 * crossing first is exactly what that predicts.
 *
 * Two cheap experiments settle it and neither has been run: REORDER the declared list so
 * `controls-collection` is late and something else is second — if controls follows its identity it is the
 * page, if whatever is second fails it is the position — and re-run once on a QUIET machine, where
 * successes near 7.7s would make the whole thing load. More runs in the current order answer neither.
 *
 * A failure to resolve the slug is deliberately not an error: the probe still works and remains the
 * fallback, so an install that has never set a slug walks exactly as it did.
 *
 * @param flag the `--tenant` value, or `null` when it was not passed
 * @param home the state home whose `secrets/` directory is the last route
 * @returns the tenant root, or `null` when no slug could be resolved
 */
function seededRootFor({ flag, home }: { flag: string | null; home: string }): string | null {
  const slug = resolveVantaTenantSlug({ env: process.env, flag, home });
  return slug.isErr() ? null : vantaTenantRootFromSlug({ tenantSlug: slug.value });
}

/**
 * Run the Vanta browser walk.
 *
 * @param argv the whole process argv
 * @returns the process exit code
 */
export async function vantaWalkCommand(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, at: VANTA_VERB_INDEX, verbs: ["walk"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: VANTA_WALK_USAGE });
    return EXIT_OK;
  }
  const options = parseWalkOptions({ rest });
  if (options.isErr()) {
    options.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: VANTA_WALK_USAGE });
    return EXIT_USAGE;
  }
  const { home, json: asJson, tenant } = options.value;
  const atlas = vantaAtlasPaths({ home });
  // The pin is resolved before anything launches (`src/browser/profilePin.ts`). The scratch is the atlas's own
  // artifact directory, where the verified writer stores the digest-addressed copy beside the raw capture.
  const attached = await attachTransportAt({
    home,
    origins: [VANTA_WEB_ORIGIN],
    platform: "vanta",
    profiles: recordedProfilePort(),
    scratchDir: atlas.pageArtifacts,
  });
  if (attached.isErr()) {
    return refuse({ lines: attached.error });
  }
  const transport = attached.value;
  const walked = await walkVantaBrowser({
    seededRoot: seededRootFor({ flag: tenant, home }),
    transport,
    writeArtifact: verifiedArtifactWriter({ directory: atlas.directory }),
    ...(asJson
      ? {}
      : {
          progress: ({ line }) => {
            logger.error({ msg: line });
          },
        }),
  });
  await transport.release();
  if (walked.isErr()) {
    return refuse({ lines: walked.error });
  }
  const published = publishVantaBrowserWalk({
    at: new Date().toISOString(),
    paths: atlas,
    walk: walked.value,
  });
  if (published.isErr()) {
    published.error.forEach((line) => {
      logger.error({ msg: line });
    });
    return EXIT_ERROR;
  }
  report({ asJson, outcome: published.value, pages: walked.value.pages });
  return EXIT_OK;
}

/** Print each refusal line to stderr and answer the error exit code. */
function refuse({ lines }: { lines: readonly string[] }): number {
  for (const line of lines) {
    logger.error({ msg: line });
  }
  return EXIT_ERROR;
}

/** Print what the walk published, as JSON or as one line per declared page. */
function report({
  asJson,
  outcome,
  pages,
}: {
  asJson: boolean;
  outcome: VantaBrowserSurfaceOutcome;
  pages: readonly VantaPageObservation[];
}): void {
  if (asJson) {
    // The tenant root is the organisation's own name and never leaves this process — see `browserPages.ts`.
    logger.out({ line: JSON.stringify({ pages, published: outcome }, null, 1) });
    return;
  }
  logger.out({
    line:
      `vanta browser walk — ${String(outcome.reachedCount)} of ${String(outcome.declaredCount)} declared ` +
      `page(s) reached, ${String(outcome.photographedCount)} photographed, ` +
      `${String(outcome.operationCount)} distinct operation(s) published`,
  });
  for (const page of pages) {
    logger.out({ line: pageLine({ page }) });
  }
  if (outcome.sessionLost) {
    logger.out({
      line: "  the browser session was lost part-way through — sign in to Vanta in your own Chrome and run this again",
    });
  }
}
