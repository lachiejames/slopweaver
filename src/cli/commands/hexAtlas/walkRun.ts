/**
 * `slopweaver atlas hex walk [--json] [--home <dir>]` — fill the atlas's BROWSER surface by walking
 * app.hex.tech in the owner's own Chrome.
 *
 * The walk, the reduction and the publish are the domain's (`atlas/hex/walk.ts`, `webReduction.ts`,
 * `walkPublish.ts`) and every one of them is written against the transport SEAM, so all of them are settled
 * by unit tests over a fake. What is here is the effects: attaching to the owner's browser, and writing the
 * screenshots to disk.
 *
 * ## What this verb does when nobody is signed in
 *
 * It still RUNS. It grades the route `signed-out`, stops there rather than driving the owner's visible browser to
 * the same login page forty times, publishes one gap naming the wall, and refuses to advance the page kind's
 * `lastSuccessAt` — so the atlas records that it looked and reached nothing, which is a different fact from
 * never having looked and from having looked and found nothing. It does not prompt, does not retry and never
 * types a credential. The walk notes the sign-in wall (`browser/signInWalls.ts`), so a scheduled resync over
 * this exit 0 still fails its attempt and cards the owner's one sign-in.
 *
 * ## Every visit here is a READ, and on THIS platform that matters more than on any sibling
 *
 * The walk navigates and photographs; it clicks nothing and submits nothing. Hex has no slopweaver door, so
 * it is `refuse-every-write` by default under the owner's ruling and the browser guard refuses
 * a write taken here. The reason it matters more is the data: a signed-in Hex session is a window onto the
 * organisation's warehouse, and a stray click could run a notebook. `atlas/hex/webReduction.ts` is the
 * second half of the same care — what a page's own traffic is allowed to leave behind.
 *
 * ## The relay is released, always
 *
 * `walkHexApp` releases the transport on every exit path. The Playwright Extension serves one client at a
 * time and several sessions on this machine run atlas walks, so a verb that held the relay after finishing
 * would be denying it to the next one.
 */
import { HEX_APP_ORIGIN } from "../../../atlas/hex/browserPages.js";
import { type HexAtlasPaths, hexAtlasPaths } from "../../../atlas/hex/store.js";
import { type HexWalkResult, walkHexApp } from "../../../atlas/hex/walk.js";
import { type HexWalkOutcome, publishHexWalk } from "../../../atlas/hex/walkPublish.js";
import { verifiedArtifactWriter } from "../../../atlas/kit/artifactWriter.js";
import { resolveChromeAttachment } from "../../../atlas/kit/chromeAttach.js";
import { createPlaywrightCliTransport } from "../../../browser/playwrightCli.js";
import { recordedProfilePort } from "../../../browser/recordedProfile.js";
import { realRelayLeaseWait } from "../../../browser/relayLease.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlagTail, resolveHome, verbTail } from "../../optionParsers.js";

/** Where a Hex atlas verb sits: past the runtime, the script, the `atlas` noun and the `hex` platform. */
const HEX_VERB_INDEX = 4;

/**
 * Exported so a test can assert this equals the manifest's own copy.
 *
 * @internal
 */
export const HEX_WALK_USAGE = "usage: slopweaver atlas hex walk [--json] [--home <dir>]";

/** Parse the flag tail this verb accepts. */
function parseWalkOptions({ rest }: { rest: readonly string[] }): Result<{ home: string; json: boolean }> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home"] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  return ok({ home: resolveHome({ named: parsed.value.values["home"] }), json: parsed.value.flags.has("json") });
}

/**
 * Attach to the owner's Chrome and run the walk.
 *
 * The transport is constructed here rather than passed in because this is the only place that may construct
 * one — the walk itself takes the seam.
 *
 * @param paths the resolved atlas paths, whose directory is both the scratch and the artifact root
 * @param token the Playwright extension consent token the owner provisioned
 * @param chromePinPath the shim Chrome is launched through, so the connect page opens in the work profile
 * @param json whether the caller wants machine output, in which case no progress is printed
 * @param home the state home the machine-wide relay lease is taken under
 * @returns what the walk saw, or the reason it could not start
 */
async function runWalk({
  paths,
  token,
  chromePinPath,
  json,
  home,
}: {
  paths: HexAtlasPaths;
  token: string;
  chromePinPath: string;
  json: boolean;
  home: string;
}): Promise<Result<HexWalkResult>> {
  return walkHexApp({
    progress: json
      ? (): void => {}
      : ({ line }: { line: string }): void => {
          process.stderr.write(`${line}\n`);
        },
    transport: createPlaywrightCliTransport({
      deps: {
        chromePinPath,
        extensionToken: token,
        home,
        leaseWait: realRelayLeaseWait(),
        nowIso: () => new Date().toISOString(),
        origins: [HEX_APP_ORIGIN],
        platform: "hex",
        scratchDir: paths.directory,
      },
    }),
    writeArtifact: verifiedArtifactWriter({ directory: paths.directory }),
  });
}

/**
 * The lines the walk prints, leading with what it reached rather than with what it visited.
 *
 * @param outcome what the publish recorded
 * @returns the lines, in print order
 *
 * @internal
 */
export function renderHexWalk({ outcome }: { outcome: HexWalkOutcome }): readonly string[] {
  if (outcome.signedOut) {
    return [
      "hex web app — 0 pages reached: the app sent the first declared route to its own sign-in wall",
      "  sign in to app.hex.tech once in your own Chrome, then run this verb again",
    ];
  }
  return [
    `hex web app — ${String(outcome.landed)} page(s) landed and photographed from ` +
      `${String(outcome.declaredRoutes)} compiled static route(s) plus ${String(outcome.discoveredRoutes)} ` +
      "discovered from rendered navigation",
    `  ${String(outcome.methodRows)} operation(s) the app's own client called, ` +
      `${String(outcome.photographed)} screenshot(s) written`,
    `  ${String(outcome.withheldRows)} of those had their response body withheld — a query result, whose ` +
      "field names are the warehouse's own column names",
  ];
}

/**
 * Walk the app and publish what it saw.
 *
 * @param argv the whole process argv
 * @returns the process exit code
 */
export async function hexAtlasWalkCommand(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, at: HEX_VERB_INDEX, verbs: ["walk"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: HEX_WALK_USAGE });
    return EXIT_OK;
  }
  const options = parseWalkOptions({ rest });
  if (options.isErr()) {
    options.error.forEach((line) => {
      logger.error({ msg: line });
    });
    logger.error({ msg: HEX_WALK_USAGE });
    return EXIT_USAGE;
  }
  const { home, json } = options.value;
  const profiles = recordedProfilePort();
  const attached = await resolveChromeAttachment({ home, profiles });
  if (attached.isErr()) {
    attached.error.forEach((line) => {
      logger.error({ msg: line });
    });
    return EXIT_ERROR;
  }
  const paths = hexAtlasPaths({ home });
  const walked = await runWalk({
    chromePinPath: attached.value.chromePinPath,
    home,
    json,
    paths,
    token: attached.value.extensionToken,
  });
  if (walked.isErr()) {
    walked.error.forEach((line) => {
      logger.error({ msg: line });
    });
    return EXIT_ERROR;
  }
  const published = publishHexWalk({ at: new Date().toISOString(), paths, walk: walked.value });
  if (published.isErr()) {
    published.error.forEach((line) => {
      logger.error({ msg: line });
    });
    return EXIT_ERROR;
  }
  if (json) {
    logger.out({ line: JSON.stringify(published.value, null, 1) });
    return EXIT_OK;
  }
  for (const line of renderHexWalk({ outcome: published.value })) {
    logger.out({ line });
  }
  return EXIT_OK;
}
