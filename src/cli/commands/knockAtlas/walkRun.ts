/**
 * `slopweaver atlas knock walk [--root <account>/<environment>] [--json] [--home <dir>]` — fill the atlas's
 * DASHBOARD surface by visiting every page `browserPages.ts` declares, in the owner's own Chrome,
 * photographing each.
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
 * claimed as coverage. `browserPages.ts`'s second rule is the other half: no declared route DOES anything,
 * and the auth and OAuth-callback routes are excluded from the denominator precisely because they would.
 *
 * ## No URL is ever printed, in either report shape
 *
 * A Knock dashboard URL carries the account slug, which identifies the organisation. Both the human report
 * and `--json` name the declared ROUTE PATTERN and its outcome and never the address, so redirecting this
 * verb's output into a file cannot put a private identifier somewhere it does not belong.
 */
import { verifiedArtifactWriter } from "../../../atlas/kit/artifactWriter.js";
import { attachWalkTransport } from "../../../atlas/kit/walkTransport.js";
import { type KnockWalkOutcome, publishKnockWalk } from "../../../atlas/knock/browserSurface.js";
import {
  type KnockDashboardRoot,
  type KnockPageObservation,
  type KnockRootSeed,
  walkKnockDashboard,
} from "../../../atlas/knock/browserWalk.js";
import { type KnockAtlasPaths, knockAtlasPaths } from "../../../atlas/knock/store.js";
import { KNOCK_DASHBOARD_ORIGIN } from "../../../atlas/knock/surfaceNaming.js";
import type { BrowserPageTransport } from "../../../browser/pageTransport.js";
import { type RecordedProfilePort, recordedProfilePort } from "../../../browser/recordedProfile.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { flagValue, parseFlagTail, resolveHome, verbTail } from "../../optionParsers.js";

import { jsonPage, pageLine } from "../atlas/walkReport.js";

/** Where a Knock atlas verb sits: past the runtime, the script, the `atlas` noun and the `knock` platform. */
const KNOCK_VERB_INDEX = 4;

/**
 * Exported so a test can assert this equals the manifest's own copy.
 *
 * @internal
 */
export const KNOCK_WALK_USAGE =
  "usage: slopweaver atlas knock walk [--root <account>/<environment>] [--json] [--home <dir>]";

/**
 * A slug the dashboard would accept: what a URL path segment may hold, and nothing that could escape one.
 *
 * Validated rather than trusted because this value is interpolated into an address the browser is then sent
 * to. A slug carrying a slash, a dot-segment or a scheme would let a typo — or a paste — point the walk at
 * a host this atlas never declared.
 */
const SLUG = /^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/;

/**
 * Parse the flag tail this verb accepts.
 *
 * `--root` is the manual seed, and it is `<account>/<environment>` because that is exactly what the
 * dashboard's own address bar shows: copy the two segments before the page name. Left out, the walk probes the
 * dashboard's landing for it instead — a {@link KnockRootSeed} says which, so no `null` root leaves the parse.
 */
function parseWalkOptions({
  rest,
}: {
  rest: readonly string[];
}): Result<{ home: string; json: boolean; seed: KnockRootSeed }> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home", "root"] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const given = flagValue({ name: "root", parsed: parsed.value });
  const root = given === null ? null : parseRoot({ given });
  if (given !== null && root === null) {
    return err([
      `--root must read <account>/<environment>, exactly as the dashboard's own address does; got "${given}"`,
    ]);
  }
  return ok({
    home: resolveHome({ named: parsed.value.values["home"] }),
    json: parsed.value.flags.has("json"),
    seed: root === null ? { from: "probe" } : { from: "flag", root },
  });
}

/**
 * The two slugs a `--root` names, or `null` when it is not two slugs.
 *
 * @param given what the invocation supplied
 * @returns the root, or `null` when it cannot be one
 * @internal
 */
export function parseRoot({ given }: { given: string }): KnockDashboardRoot | null {
  const parts = given.split("/").filter((part) => part.length > 0);
  const [account, environment] = parts;
  if (parts.length !== 2 || account === undefined || environment === undefined) {
    return null;
  }
  return SLUG.test(account) && SLUG.test(environment) ? { account, environment } : null;
}

/** Print what the walk published, as JSON or as one line per declared page. */
function report({
  asJson,
  outcome,
  pages,
}: {
  asJson: boolean;
  outcome: KnockWalkOutcome;
  pages: readonly KnockPageObservation[];
}): void {
  if (asJson) {
    logger.out({
      line: JSON.stringify({ pages: pages.map((page) => jsonPage({ page })), published: outcome }, null, 1),
    });
    return;
  }
  logger.out({
    line:
      `knock dashboard walk — ${String(outcome.reached)} of ${String(outcome.declared)} declared page(s) ` +
      `reached, ${String(outcome.photographed)} photographed, ` +
      `${String(outcome.operationsObserved)} distinct operation(s) observed, ` +
      `${String(outcome.undocumented)} of them undeclared by either pinned document`,
  });
  for (const page of pages) {
    logger.out({ line: pageLine({ page }) });
  }
}

/**
 * Resolve the atlas paths and bind the transport that attaches to the owner's own Chrome.
 *
 * The attach itself is the kit's ({@link attachWalkTransport}), which resolves the consent token, makes the
 * scratch directory under this atlas's own generation directory and — before anything launches — resolves
 * the recorded Chrome profile. That last one is the reason it is not inlined here: without the pin, Chrome
 * opens the connect page in whichever profile it was last used in, which is exactly what
 * `src/browser/profilePin.ts` exists to prevent.
 *
 * @param home the resolved state home
 * @param profiles the door the recorded work profile is read through
 * @returns the atlas paths and a bound transport, or every reason the walk cannot start
 */
async function bindTransport({
  home,
  profiles,
}: {
  home: string;
  profiles: RecordedProfilePort;
}): Promise<Result<{ paths: KnockAtlasPaths; transport: BrowserPageTransport }>> {
  const paths = knockAtlasPaths({ home });
  const transport = await attachWalkTransport({
    directory: paths.directory,
    home,
    origins: [KNOCK_DASHBOARD_ORIGIN],
    platform: "knock",
    profiles,
  });
  if (transport.isErr()) {
    return err(transport.error);
  }
  return ok({ paths, transport: transport.value });
}

/** Print every reason a leg failed, and answer the exit code that says so. */
function complain({ reasons }: { reasons: readonly string[] }): number {
  reasons.forEach((line) => {
    logger.error({ msg: line });
  });
  return EXIT_ERROR;
}

/**
 * Run the Knock dashboard walk.
 *
 * @param argv the whole process argv
 * @returns the process exit code
 */
export async function knockAtlasWalkCommand(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, at: KNOCK_VERB_INDEX, verbs: ["walk"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: KNOCK_WALK_USAGE });
    return EXIT_OK;
  }
  const options = parseWalkOptions({ rest });
  if (options.isErr()) {
    options.error.forEach((line) => {
      logger.error({ msg: line });
    });
    logger.error({ msg: KNOCK_WALK_USAGE });
    return EXIT_USAGE;
  }
  const { home, json: asJson, seed } = options.value;
  const profiles = recordedProfilePort();
  const bound = await bindTransport({ home, profiles });
  if (bound.isErr()) {
    return complain({ reasons: bound.error });
  }
  const { paths, transport } = bound.value;
  const walked = await walkKnockDashboard({
    progress: ({ line }) => {
      logger.error({ msg: line });
    },
    seed,
    transport,
    writeArtifact: verifiedArtifactWriter({ directory: paths.directory }),
  });
  await transport.release();
  if (walked.isErr()) {
    return complain({ reasons: walked.error });
  }
  const published = publishKnockWalk({
    at: new Date().toISOString(),
    pages: walked.value.pages,
    paths,
    sessionLost: walked.value.sessionLost,
  });
  if (published.isErr()) {
    return complain({ reasons: published.error });
  }
  report({ asJson, outcome: published.value, pages: walked.value.pages });
  return EXIT_OK;
}
