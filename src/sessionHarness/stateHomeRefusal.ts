/**
 * What a `BAD_REQUEST` on a launch carrying `stateHome` most likely means. The field was added WITHOUT a protocol bump
 * (`./launchSpecWire.ts`), so an app one release behind refuses only the confined launch that carries it, and its
 * strict key check says only `BAD_REQUEST` — this names the probable cause rather than leaving it to be guessed.
 *
 * Pure: no I/O.
 */
import type { AppLaunchSpec } from "./appProtocol.js";
import type { AppTransportFailure } from "./appSocketTransport.js";

const STATE_HOME_PREDATES =
  " — this launch carries stateHome (cmux spawn --home), so the installed app most likely predates stateHome: " +
  "install the current desktop app before a confined seat can open on it";

/**
 * The clause a prepare refusal's message gains when it is the one an app from before `stateHome` gives a launch
 * carrying it.
 *
 * @param appSpec the launch the app was asked to prepare
 * @param error the app's refusal, or the transport's failure
 * @returns the clause to append, or the empty string when the refusal is any other
 */
export function stateHomeRefusalClause({
  appSpec,
  error,
}: {
  appSpec: AppLaunchSpec;
  error: AppTransportFailure;
}): string {
  if (appSpec.stateHome !== undefined && error.kind === "refused" && error.code === "BAD_REQUEST") {
    return STATE_HOME_PREDATES;
  }
  return "";
}
