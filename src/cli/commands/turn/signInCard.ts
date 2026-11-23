/**
 * Fire the `turn-signed-out` monitor for one turn verb, the moment its block on a browser sign-in is recorded or
 * lifted — so the note and the top-of-queue card arrive with the block and settle with it, never a supervisor tick
 * later.
 *
 * In-process through `monitor check --only turn-signed-out --fire` rather than through `hand post`: only the pinned
 * chair posts a note by hand (`../../../hand/seatPost.ts`), and the monitor lane is the sanctioned route for a note
 * a ledger raises. A pass that refuses is REPORTED and changes nothing above it: the block is already recorded and
 * shown, and the chair's next tick runs the same pass.
 */
import { logger } from "../../../lib/logger.js";
import { runMonitorCheck } from "../monitor/check.js";
import { hostedPassDeps, type MonitorDeps } from "../monitor/deps.js";

/**
 * Run the `turn-signed-out` pass once, posting what newly arrived and settling what left.
 *
 * @param home the state home the block was recorded in
 * @param bySession who the pass records as acting — the supervisor session the turn verb resolved
 * @param verb the turn verb firing it, named on the one line a refused pass prints
 * @param deps the monitor seams — `productionMonitorDeps()` from a verb, plain fakes from a test
 * @returns the pass's exit code, which the turn verbs report and never return as their own
 */
export async function fireTurnSignedOut({
  home,
  bySession,
  verb,
  deps,
}: {
  home: string;
  bySession: string;
  verb: string;
  deps: MonitorDeps;
}): Promise<number> {
  const code = await runMonitorCheck({
    // The turn verb owns stdout, so the pass reports on stderr.
    deps: hostedPassDeps({ deps }),
    rest: ["--only", "turn-signed-out", "--fire", "--by-session", bySession, "--home", home],
  });
  if (code !== 0) {
    logger.error({
      msg:
        `${verb}: the sign-in card pass exited ${String(code)} — the block stands; ` +
        "the chair's next tick runs `slopweaver monitor check --only turn-signed-out --fire` again",
    });
  }
  return code;
}
