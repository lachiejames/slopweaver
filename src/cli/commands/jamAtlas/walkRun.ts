/**
 * `slopweaver atlas jam walk [--json] [--home <dir>]` — fill the atlas's BROWSER surface by walking the Jam
 * application in the owner's own Chrome.
 *
 * The walk and the publish are the domain's (`atlas/jam/browserWalk.ts`, `browserPages.ts`,
 * `browserSurface.ts`) and both are written against the transport SEAM, so both are settled by unit tests.
 * What is here is the effects: attaching to the owner's browser, and writing the screenshots to disk.
 *
 * ## This verb IS the door
 *
 * Rule 3's own answer to "may an agent drive a browser" is that a `slopweaver` verb which drives one is the
 * door. So this is how the Jam application is reached, and a hand-driven browser session is not — the
 * difference being that this navigates a DECLARED list under a read-only posture and records what it saw,
 * where a hand-driven session has a keystroke one missed click away from it (`docs/browser-route/provider-arms.md`).
 *
 * It also refuses three families outright rather than trusting the posture: a credential page, whose
 * screenshot would carry a working token; a `/v/<jamId>` recording, whose payload this atlas withholds on
 * disclosure and where arriving on a shared link may mark it seen; and the sign-in surface. All three live
 * in `browserPages.ts` with their reasons, computed from the path rather than listed.
 *
 * ## There is no page cap, because the denominator is DECLARED
 *
 * A walk whose denominator is a frontier needs one, because it cannot know in advance how many pages it will
 * find. This one visits a list `browserPages.ts` declares, which is why a coverage fraction
 * here is checkable at all, and a cap over a fixed list would only be a way to publish a short walk.
 */
import { JAM_WEB_ORIGIN } from "../../../atlas/jam/browserPages.js";
import { type JamWebOutcome, publishJamWebWalk } from "../../../atlas/jam/browserSurface.js";
import { walkJamApplication } from "../../../atlas/jam/browserWalk.js";
import { type JamAtlasPaths, jamAtlasPaths } from "../../../atlas/jam/store.js";
import { verifiedArtifactWriter } from "../../../atlas/kit/artifactWriter.js";
import { attachWalkTransport } from "../../../atlas/kit/walkTransport.js";
import type { BrowserPageTransport } from "../../../browser/pageTransport.js";
import { type RecordedProfilePort, recordedProfilePort } from "../../../browser/recordedProfile.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlagTail, resolveHome, verbTail } from "../../optionParsers.js";

/** Where a Jam atlas verb sits: past the runtime, the script, the `atlas` noun and the `jam` platform. */
const JAM_VERB_INDEX = 4;

/**
 * Exported so a test can assert this equals the manifest's own copy.
 *
 * @internal
 */
export const JAM_WALK_USAGE = "usage: slopweaver atlas jam walk [--json] [--home <dir>]";

/** Parse the flag tail this verb accepts. */
function parseWalkOptions({ rest }: { rest: readonly string[] }): Result<{ home: string; json: boolean }> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home"] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  return ok({ home: resolveHome({ named: parsed.value.values["home"] }), json: parsed.value.flags.has("json") });
}

/**
 * Everything a walk needs before it can visit a page: the atlas paths and a transport already attached to
 * the owner's own Chrome.
 *
 * The attach itself is `kit/walkTransport.ts`, shared with every other walking atlas — this verb owns only
 * WHERE its generation lives.
 *
 * @param home the state home holding the consent token, the recorded profile and the atlas
 * @param profiles the door the recorded work profile is read through
 * @returns the paths and an attached transport, or every reason the walk cannot start
 */
async function prepareWalk({
  home,
  profiles,
}: {
  home: string;
  profiles: RecordedProfilePort;
}): Promise<Result<{ paths: JamAtlasPaths; transport: BrowserPageTransport }>> {
  const paths = jamAtlasPaths({ home });
  const transport = await attachWalkTransport({
    directory: paths.directory,
    home,
    origins: [JAM_WEB_ORIGIN],
    platform: "jam",
    profiles,
  });
  if (transport.isErr()) {
    return err(transport.error);
  }
  return ok({ paths, transport: transport.value });
}

/** Print what the walk established: the whole document under `--json`, otherwise two lines. */
function report({ json, outcome }: { json: boolean; outcome: JamWebOutcome }): void {
  if (json) {
    logger.out({ line: JSON.stringify(outcome, null, 2) });
    return;
  }
  logger.out({
    line:
      `jam application: ${String(outcome.reachedCount)} of ${String(outcome.declaredCount)} declared page(s) ` +
      `reached, ${String(outcome.photographedCount)} photographed`,
  });
  logger.out({
    line:
      `recorded ${String(outcome.callCount)} distinct first-party endpoint shape(s); ` +
      `${String(outcome.reachedCount - outcome.photographedCount)} reached page(s) carry no picture`,
  });
}

/**
 * Run the `atlas jam walk` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 * @internal
 */
export async function runJamWalk(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, at: JAM_VERB_INDEX, verbs: ["walk"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: JAM_WALK_USAGE });
    return EXIT_OK;
  }
  const options = parseWalkOptions({ rest });
  if (options.isErr()) {
    options.error.forEach((reason: string) => {
      logger.error({ msg: reason });
    });
    logger.error({ msg: JAM_WALK_USAGE });
    return EXIT_USAGE;
  }
  const { home, json } = options.value;
  const profiles = recordedProfilePort();
  const ready = await prepareWalk({ home, profiles });
  if (ready.isErr()) {
    ready.error.forEach((reason: string) => {
      logger.error({ msg: reason });
    });
    return EXIT_EXPECTED_EMPTY;
  }
  const walked = await walkJamApplication({
    transport: ready.value.transport,
    writeArtifact: verifiedArtifactWriter({ directory: ready.value.paths.directory }),
    ...(json
      ? {}
      : {
          progress: ({ line }: { line: string }) => {
            logger.out({ line });
          },
        }),
  });
  await ready.value.transport.release();
  if (walked.isErr()) {
    walked.error.forEach((reason: string) => {
      logger.error({ msg: reason });
    });
    return EXIT_EXPECTED_EMPTY;
  }
  const published = publishJamWebWalk({ at: new Date().toISOString(), paths: ready.value.paths, walk: walked.value });
  if (published.isErr()) {
    published.error.forEach((reason: string) => {
      logger.error({ msg: reason });
    });
    return EXIT_ERROR;
  }
  report({ json, outcome: published.value });
  return published.value.reachedCount === 0 ? EXIT_EXPECTED_EMPTY : EXIT_OK;
}
