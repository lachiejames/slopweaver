/**
 * The one set of live verb reads this server has under way, shared by the live route that rides them and the act route
 * that forgets them after a write (`./liveFlights.ts` `forgetFlights`). A route file may export only its handlers, so
 * the map lives here rather than in either route.
 *
 * It hangs off `globalThis` under a registered symbol, exactly as `./talkCallRegistry.ts` does: the two routes are
 * separate module graphs and `next dev` re-evaluates a module when it recompiles it, so a module-level `Map` could
 * leave the act route clearing one map while the live route rides another.
 */
import type { Flights } from "./liveFlights";
import type { LiveResult } from "./liveVerbRun";

/** The process-global slot every evaluation of this module reads. */
const KEY = Symbol.for("slopweaver.liveFlights");

/**
 * The process-global map, made on first use.
 *
 * @returns the one map every route and every re-evaluation shares
 */
function sharedFlights(): Flights<LiveResult> {
  const holder = globalThis as typeof globalThis & { [KEY]?: Flights<LiveResult> };
  let found = holder[KEY];
  if (found === undefined) {
    found = new Map();
    holder[KEY] = found;
  }
  return found;
}

/**
 * Every verb read this server has under way. A second reader of the same verb rides the first one's child process
 * and gets its answer, stamp included — never a later instant on an earlier reading (`./liveFlights.ts`).
 */
export const LIVE_FLIGHTS: Flights<LiveResult> = sharedFlights();
