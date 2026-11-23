/**
 * `slopweaver atlas clerk walk [--json] [--home <dir>]` — fill the atlas's DASHBOARD surface by walking
 * every page `browserPages.ts` declares, in the owner's own Chrome, photographing each.
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
 * A Clerk dashboard URL carries the application and instance identifiers. Both the human report and
 * `--json` name the declared SURFACE and its outcome and never the address, so redirecting this verb's
 * output into a file cannot put a private identifier somewhere it does not belong.
 */
import { type ClerkWalkOutcome, publishClerkWalk } from "../../../atlas/clerk/browserSurface.js";
import { type ClerkPageObservation, walkClerkDashboard } from "../../../atlas/clerk/browserWalk.js";
import { CLERK_DASHBOARD_ORIGIN } from "../../../atlas/clerk/dashboardAddress.js";
import { clerkAtlasErrorLines } from "../../../atlas/clerk/errors.js";
import {
  isClerkInstanceRoot,
  readClerkInstanceRoot,
  writeClerkInstanceRoot,
} from "../../../atlas/clerk/instanceRoot.js";
import { type ClerkAtlasPaths, clerkAtlasPaths } from "../../../atlas/clerk/store.js";
import { verifiedArtifactWriter } from "../../../atlas/kit/artifactWriter.js";
import { attachWalkTransport } from "../../../atlas/kit/walkTransport.js";
import type { BrowserPageTransport } from "../../../browser/pageTransport.js";
import { type RecordedProfilePort, recordedProfilePort } from "../../../browser/recordedProfile.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { flagValue, parseFlagTail, resolveHome, verbTail } from "../../optionParsers.js";

import { jsonPage, pageLine } from "../atlas/walkReport.js";

/** Where a Clerk atlas verb sits: past the runtime, the script, the `atlas` noun and the `clerk` platform. */
const CLERK_VERB_INDEX = 4;

/**
 * Exported so a test can assert this equals the manifest's own copy.
 *
 * @internal
 */
export const CLERK_WALK_USAGE =
  "usage: slopweaver atlas clerk walk [--root /apps/<application>/instances/<instance>] [--json] [--home <dir>]";

/**
 * Where this walk's instance root comes from, decided once at the flag parse so no `null` root leaves it: a
 * `--root` the invocation supplied, or — when it supplied none — the walk's own discovery (landing, then
 * traffic, then what an earlier walk remembered). Mirrors the Knock walk's `KnockRootSeed`.
 *
 * @internal
 */
export type ClerkRootSeed = { readonly from: "flag"; readonly root: string } | { readonly from: "discover" };

/**
 * Parse the flag tail this verb accepts.
 *
 * `--root` is the manual seed for the instance root, and it is a path rather than two identifiers because
 * that is exactly what the dashboard's own address bar shows: copy the part before the page name. It is
 * validated to the same shape a remembered root must have, so nothing that is not a path can reach a URL.
 *
 * @param rest the verb's argv tail
 * @returns the state home, the output shape and where the root comes from, or every reason the tail was refused
 * @internal
 */
export function parseWalkOptions({
  rest,
}: {
  rest: readonly string[];
}): Result<{ home: string; json: boolean; seed: ClerkRootSeed }> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home", "root"] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const home = resolveHome({ named: parsed.value.values["home"] });
  const json = parsed.value.flags.has("json");
  const root = flagValue({ name: "root", parsed: parsed.value });
  if (root === null) {
    return ok({ home, json, seed: { from: "discover" } });
  }
  if (!isClerkInstanceRoot({ root })) {
    return err([
      `--root must read /apps/<application>/instances/<instance>, exactly as the dashboard's own address does; got "${root}"`,
    ]);
  }
  return ok({ home, json, seed: { from: "flag", root } });
}

/** Print what the walk published, as JSON or as one line per declared page. */
function report({
  asJson,
  outcome,
  pages,
}: {
  asJson: boolean;
  outcome: ClerkWalkOutcome;
  pages: readonly ClerkPageObservation[];
}): void {
  if (asJson) {
    logger.out({
      line: JSON.stringify({ pages: pages.map((page) => jsonPage({ page })), published: outcome }, null, 1),
    });
    return;
  }
  logger.out({
    line:
      `clerk dashboard walk — ${String(outcome.reached)} of ${String(outcome.declared)} declared page(s) ` +
      `reached, ${String(outcome.photographed)} photographed, ` +
      `${String(outcome.operationsObserved)} distinct operation(s) observed, ` +
      `${String(outcome.undocumented)} of them undeclared by any pinned document`,
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
 * @param paths the atlas paths, resolved before the attach so local state is checked first
 * @param profiles the door the recorded work profile is read through
 * @returns a bound transport, or every reason the walk cannot start
 */
async function bindTransport({
  home,
  paths,
  profiles,
}: {
  home: string;
  paths: ClerkAtlasPaths;
  profiles: RecordedProfilePort;
}): Promise<Result<BrowserPageTransport>> {
  const transport = await attachWalkTransport({
    directory: paths.directory,
    home,
    origins: [CLERK_DASHBOARD_ORIGIN],
    platform: "clerk",
    profiles,
  });
  if (transport.isErr()) {
    return err(transport.error);
  }
  return ok(transport.value);
}

/**
 * Write a `--root` into the remembered file before the walk reads it, so the two paths never disagree.
 *
 * Seeding rather than passing it straight through is deliberate: a root the owner typed once should not have
 * to be typed again, and there is exactly one place a root is read from either way.
 *
 * @param paths the resolved atlas paths
 * @param seed where the root comes from — only a `--root` is written
 * @returns nothing when there was nothing to seed or it was written, or why it could not be
 */
function seedRoot({ paths, seed }: { paths: ClerkAtlasPaths; seed: ClerkRootSeed }): Result<null> {
  if (seed.from === "discover") {
    return ok(null);
  }
  return writeClerkInstanceRoot({ at: new Date().toISOString(), directory: paths.directory, root: seed.root });
}

/** Print every reason a leg failed, and answer the exit code that says so. */
function complain({ reasons }: { reasons: readonly string[] }): number {
  reasons.forEach((line) => {
    logger.error({ msg: line });
  });
  return EXIT_ERROR;
}

/**
 * Drive the walk itself, handing it the remembered root and somewhere to put a freshly-resolved one.
 *
 * Split out of the command so the command reads as its own control flow — parse, bind, seed, drive, publish
 * — rather than carrying the walk's four dependencies inline.
 *
 * @param paths the resolved atlas paths
 * @param remembered the root an earlier walk remembered, already read and trusted, or `null` when none was
 * @param transport the bound page transport, released by the caller rather than here
 * @returns every declared page's observation, or why the walk could not start at all
 */
async function driveWalk({
  paths,
  remembered,
  transport,
}: {
  paths: ClerkAtlasPaths;
  remembered: string | null;
  transport: BrowserPageTransport;
}): Promise<Awaited<ReturnType<typeof walkClerkDashboard>>> {
  return walkClerkDashboard({
    progress: ({ line }) => {
      logger.error({ msg: line });
    },
    remembered,
    rememberRoot: ({ root }) => {
      const written = writeClerkInstanceRoot({ at: new Date().toISOString(), directory: paths.directory, root });
      if (written.isErr()) {
        written.error.forEach((line) => {
          logger.error({ msg: line });
        });
      }
    },
    transport,
    writeArtifact: verifiedArtifactWriter({ directory: paths.directory }),
  });
}

/**
 * Run the Clerk dashboard walk.
 *
 * @param argv the whole process argv
 * @returns the process exit code
 */
export async function clerkAtlasWalkCommand(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, at: CLERK_VERB_INDEX, verbs: ["walk"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: CLERK_WALK_USAGE });
    return EXIT_OK;
  }
  const options = parseWalkOptions({ rest });
  if (options.isErr()) {
    options.error.forEach((line) => {
      logger.error({ msg: line });
    });
    logger.error({ msg: CLERK_WALK_USAGE });
    return EXIT_USAGE;
  }
  const { home, json: asJson, seed: rootSeed } = options.value;
  // Local state first — seed, then read what is remembered — so a corrupt file stops the walk before Chrome is
  // attached, and a --root repairs it on the way.
  const paths = clerkAtlasPaths({ home });
  const seed = seedRoot({ paths, seed: rootSeed });
  if (seed.isErr()) {
    return complain({ reasons: seed.error });
  }
  const remembered = readClerkInstanceRoot({ directory: paths.directory });
  if (remembered.isErr()) {
    return complain({ reasons: clerkAtlasErrorLines({ error: remembered.error }) });
  }
  const profiles = recordedProfilePort();
  const transport = await bindTransport({ home, paths, profiles });
  if (transport.isErr()) {
    return complain({ reasons: transport.error });
  }
  const walked = await driveWalk({ paths, remembered: remembered.value, transport: transport.value });
  await transport.value.release();
  if (walked.isErr()) {
    return complain({ reasons: walked.error });
  }
  const published = publishClerkWalk({
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
