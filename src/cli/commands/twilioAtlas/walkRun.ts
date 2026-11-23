/**
 * `slopweaver atlas twilio walk [--json] [--home <dir>]` — fill the atlas's BROWSER surface by walking the
 * Twilio console in the owner's own Chrome.
 *
 * The walk, the reduction and the publish are the domain's (`atlas/twilio/walk.ts`, `webReduction.ts`,
 * `walkPublish.ts`) and every one of them is written against the transport SEAM, so all of them are settled
 * by unit tests over a fake. What is here is the effects: attaching to the owner's browser, and writing the
 * screenshots to disk.
 *
 * ## What this verb does when nobody is signed in, which is no longer today
 *
 * MEASURED against the owner's signed-in console: 210 pages landed and were photographed in
 * region `us1`, from 80 declared routes plus 165 the rendered navigation discovered, over 3 rounds. The
 * signed-out path is kept because a session expires — the walk still RUNS, grades the route `signed-out`,
 * stops there rather than driving the owner's visible browser to the same login page eighty times, publishes one
 * gap naming the wall, and refuses to advance the page kind's `lastSuccessAt` — so the atlas records that
 * it looked and reached nothing, which is a different fact from never having looked and from having looked
 * and found nothing. It does not prompt, does not retry and never types a credential. The walk notes the
 * sign-in wall (`browser/signInWalls.ts`), so a scheduled resync over this exit 0 still fails its attempt
 * and cards the owner's one sign-in.
 *
 * ## Every visit here is a READ, and on Twilio that is a decision rather than a property
 *
 * The walk navigates and photographs; it clicks nothing and submits nothing. That matters more on this
 * platform than on its siblings: Twilio has no slopweaver door, so no guard would refuse a write taken
 * here. `atlas/twilio/sync.ts`'s `TWILIO_ENTITY_UNBLOCKED_BY` is why the entity surface stays empty with the
 * console open — filling it needs an API key minted, and minting one is a write.
 *
 * ## The relay is released, always
 *
 * `walkTwilioConsole` releases the transport on every exit path. The Playwright Extension serves one client
 * at a time and several sessions on this machine run atlas walks, so a verb that held the relay after
 * finishing would be denying it to the next one.
 */
import { verifiedArtifactWriter } from "../../../atlas/kit/artifactWriter.js";
import { resolveChromeAttachment } from "../../../atlas/kit/chromeAttach.js";
import { TWILIO_CONSOLE_ORIGIN } from "../../../atlas/twilio/browserPages.js";
import { type TwilioAtlasPaths, twilioAtlasPaths } from "../../../atlas/twilio/store.js";
import { type TwilioWalkResult, walkTwilioConsole } from "../../../atlas/twilio/walk.js";
import { publishTwilioWalk, type TwilioWalkOutcome } from "../../../atlas/twilio/walkPublish.js";
import { createPlaywrightCliTransport } from "../../../browser/playwrightCli.js";
import { recordedProfilePort } from "../../../browser/recordedProfile.js";
import { realRelayLeaseWait } from "../../../browser/relayLease.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlagTail, resolveHome, verbTail } from "../../optionParsers.js";

/** Where a Twilio atlas verb sits: past the runtime, the script, the `atlas` noun and the `twilio` platform. */
const TWILIO_VERB_INDEX = 4;

/**
 * Exported so a test can assert this equals the manifest's own copy.
 *
 * @internal
 */
export const TWILIO_WALK_USAGE = "usage: slopweaver atlas twilio walk [--json] [--home <dir>]";

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
  paths: TwilioAtlasPaths;
  token: string;
  chromePinPath: string;
  json: boolean;
  home: string;
}): Promise<Result<TwilioWalkResult>> {
  return walkTwilioConsole({
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
        origins: [TWILIO_CONSOLE_ORIGIN],
        platform: "twilio",
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
export function renderTwilioWalk({ outcome }: { outcome: TwilioWalkOutcome }): readonly string[] {
  if (outcome.signedOut) {
    return [
      "twilio console — 0 pages reached: every declared route settled on Twilio's sign-in wall",
      "  sign in to console.twilio.com once in your own Chrome, then run this verb again",
    ];
  }
  return [
    `twilio console — ${String(outcome.landed)} page(s) landed and photographed from ` +
      `${String(outcome.declaredRoutes)} declared plus ${String(outcome.discoveredRoutes)} discovered, ` +
      `region ${outcome.region}`,
    `  ${String(outcome.methodRows)} operation(s) the console's own client called, ` +
      `${String(outcome.photographed)} screenshot(s) written`,
  ];
}

/**
 * Walk the console and publish what it saw.
 *
 * @param argv the whole process argv
 * @returns the process exit code
 */
export async function twilioAtlasWalkCommand(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, at: TWILIO_VERB_INDEX, verbs: ["walk"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: TWILIO_WALK_USAGE });
    return EXIT_OK;
  }
  const options = parseWalkOptions({ rest });
  if (options.isErr()) {
    options.error.forEach((line) => {
      logger.error({ msg: line });
    });
    logger.error({ msg: TWILIO_WALK_USAGE });
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
  const paths = twilioAtlasPaths({ home });
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
  const published = publishTwilioWalk({ at: new Date().toISOString(), paths, walk: walked.value });
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
  for (const line of renderTwilioWalk({ outcome: published.value })) {
    logger.out({ line });
  }
  return EXIT_OK;
}
