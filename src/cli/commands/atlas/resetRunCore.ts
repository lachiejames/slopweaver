/**
 * `atlas <platform> reset --confirm archive`, once, for every atlas that has one.
 *
 * Two atlases' reset verbs were byte-identical apart from three names, which is what the clone detector
 * found. What genuinely differs between two atlases is only how their paths resolve and what an
 * empty generation looks like — both of which sit behind the `reset` callback here — so everything else is
 * shared: the argv tail, the exact confirmation word, the two output shapes and the exit codes.
 *
 * `--confirm archive` is required and is the whole guard: this is the only verb in the noun that makes an
 * atlas forget, and the word names what actually happens — nothing is deleted, the generation is moved
 * under `atlas/_superseded/<platform>/`.
 */
import type { AtlasResetOutcome } from "../../../atlas/kit/reset.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlagTail, resolveHome, verbTail } from "../../optionParsers.js";
import { type AtlasCommandError, AtlasCommandErrors, atlasCommandErrorLines } from "./errors.js";

/**
 * The usage line this verb prints, for one platform.
 *
 * It is DERIVED rather than declared because it was declared 33 times, once per platform, and every copy
 * was this sentence with the platform name swapped. `cli/manifests/atlasPlatformMeta.ts` advertises the same
 * flag tail from its own constant, and `unit/atlas/registryVerbs.test.ts` is what holds the two together.
 *
 * @returns the usage line, with no trailing newline
 */
export function atlasResetUsage({ platform }: { platform: string }): string {
  return `usage: slopweaver atlas ${platform} reset --confirm archive [--json] [--home <dir>]`;
}

/** Where a platform's atlas verb sits: past the runtime, the script, the `atlas` noun and the platform. */
const PLATFORM_VERB_INDEX = 4;

/** Parse the flag tail this verb accepts, and refuse anything but the exact confirmation word. */
function parseResetOptions({
  rest,
}: {
  rest: readonly string[];
}): Result<{ home: string; json: boolean }, AtlasCommandError> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["confirm", "home"] } });
  if (parsed.isErr()) {
    return err(AtlasCommandErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const confirm = parsed.value.values["confirm"];
  if (confirm !== "archive") {
    if (confirm === undefined) {
      return err(AtlasCommandErrors.resetConfirmRequired());
    }
    return err(AtlasCommandErrors.confirmMismatch({ confirm, expected: "archive" }));
  }
  return ok({ home: resolveHome({ named: parsed.value.values["home"] }), json: parsed.value.flags.has("json") });
}

/**
 * Archive one atlas's current generation and install a fresh, empty one.
 *
 * @param argv the whole process argv
 * @param platform the platform name, which names the verb in the usage line and the success line
 * @param usage the usage block to print, which {@link atlasResetUsage} derives
 * @param reset how this platform archives — the one thing that genuinely differs between two atlases
 * @returns the process exit code
 */
export function runAtlasReset({
  argv,
  platform,
  usage,
  reset,
}: {
  argv: readonly string[];
  platform: string;
  usage: string;
  reset: (input: { home: string; at: string }) => Result<AtlasResetOutcome>;
}): number {
  const rest = verbTail({ argv, at: PLATFORM_VERB_INDEX, verbs: ["reset"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: usage });
    return EXIT_OK;
  }
  const options = parseResetOptions({ rest });
  if (options.isErr()) {
    atlasCommandErrorLines({ error: options.error }).forEach((line) => {
      logger.error({ msg: line });
    });
    logger.error({ msg: usage });
    return EXIT_USAGE;
  }
  const { home, json: asJson } = options.value;
  const outcome = reset({ at: new Date().toISOString(), home });
  if (outcome.isErr()) {
    outcome.error.forEach((line) => {
      logger.error({ msg: line });
    });
    return EXIT_ERROR;
  }
  if (asJson) {
    logger.out({
      line: JSON.stringify(
        {
          ...outcome.value,
          restoreCommand: `slopweaver atlas ${platform} restore --archive ${outcome.value.archiveId} --confirm archive-current`,
        },
        null,
        1,
      ),
    });
    return EXIT_OK;
  }
  logger.out({
    line: `${platform} atlas HARD reset — the prior generation is archived at ${outcome.value.archivedTo}`,
  });
  logger.out({
    line: `restore it: slopweaver atlas ${platform} restore --archive ${outcome.value.archiveId} --confirm archive-current`,
  });
  return EXIT_OK;
}
