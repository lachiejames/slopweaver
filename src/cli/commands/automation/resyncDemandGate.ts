/**
 * What `automation resync` does with a demand read before any step runs (`live/resync/demand.ts`): which exit
 * ends the slot unwalked, which line says why, and what a walked slot announces. Its own module so the verb
 * reads as the order of its phases.
 */
import { demandWords, type ResyncDemandRead, unwantedLine } from "../../../live/resync/demand.js";
import type { ResyncState } from "../../../live/resync/outcome.js";
import { EXIT_DEFERRED, EXIT_EXPECTED_EMPTY } from "../../exitCodes.js";

/**
 * The instant demand is judged against: the last SUCCESS, never the last attempt, so a demand walk that met the
 * sign-in page leaves its demand standing for the walk after the owner's Done.
 *
 * @param state the stored record, or `null` when the target has none
 * @returns the last success, or `null` when there is no record or it never succeeded
 */
export function lastSuccessOf({ state }: { readonly state: ResyncState | null }): string | null {
  if (state === null) {
    return null;
  }
  return state.lastSuccessAtIso;
}

/**
 * What a demand check makes of the slot before any step runs: the line it prints, and the exit that ends it unwalked.
 *
 * No demand is `EXIT_EXPECTED_EMPTY`: the slot did its work and there was none, so `run-due` and `claim` stamp
 * it. A check that could not read is `EXIT_DEFERRED`: nothing was decided, so the slot stays due — never a walk on
 * a store that did not answer, which would re-create the sign-in ask the gate exists to end. Neither writes the
 * resync record: nothing was read, so the last success must not move. A found demand prints who asked and walks;
 * an ungated target prints nothing, so its output stays exactly what it was before the gate existed.
 *
 * @param demand what the check found
 * @returns the words after the target label, and the exit code when the steps must not run
 */
export function demandGate({ demand }: { readonly demand: ResyncDemandRead }): {
  readonly line: string | undefined;
  readonly exitCode: number | undefined;
} {
  switch (demand.kind) {
    case "unwanted":
      return {
        exitCode: EXIT_EXPECTED_EMPTY,
        line: unwantedLine({ sinceIso: demand.sinceIso, terms: demand.terms }),
      };
    case "unreadable":
      return {
        exitCode: EXIT_DEFERRED,
        line: `DEFERRED · the demand check could not run, so nothing walked: ${demand.why}`,
      };
    case "wanted":
      return {
        exitCode: undefined,
        line: `WANTED by ${demandWords({ record: demand.record })} — ${demand.record.url}`,
      };
    case "ungated":
      return { exitCode: undefined, line: undefined };
    default: {
      const unhandled: never = demand;
      return unhandled;
    }
  }
}
