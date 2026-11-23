/**
 * `slopweaver atlas twilio reset --confirm archive [--json] [--home <dir>]` — archive the current
 * generation and install a fresh, empty one.
 *
 * The whole verb is `atlas/resetRunCore.ts`; what is Twilio's own is where its paths resolve and what an
 * empty generation looks like.
 */
import { resetTwilioAtlas } from "../../../atlas/twilio/reset.js";
import { twilioAtlasPaths } from "../../../atlas/twilio/store.js";
import { runAtlasReset } from "../atlas/resetRunCore.js";

/**
 * Exported so a test can assert this equals the manifest's own copy.
 *
 * @internal
 */
export const TWILIO_RESET_USAGE = "usage: slopweaver atlas twilio reset --confirm archive [--json] [--home <dir>]";

/**
 * Archive the Twilio atlas's current generation.
 *
 * @param argv the whole process argv
 * @returns the process exit code
 */
export function twilioAtlasResetCommand(argv: readonly string[]): number {
  return runAtlasReset({
    argv,
    platform: "twilio",
    reset: ({ home, at }) => resetTwilioAtlas({ at, paths: twilioAtlasPaths({ home }) }),
    usage: TWILIO_RESET_USAGE,
  });
}
