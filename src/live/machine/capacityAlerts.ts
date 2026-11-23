/**
 * The ALERT half of `./capacity.ts`'s grade: which alert thresholds one reading crossed, each as the clause
 * the summary prints. Split out of that file, which assembles the report; nothing here reads anything.
 */
import type { SwapUsage } from "./capacityParse.js";
import { overThresholdGb, type RankedProcess } from "./capacityRank.js";
import type { GradeReason } from "./capacityVerdict.js";
import { deadSeatOrphans, type FleetLoadReading } from "./fleetLoad.js";
import { type RunawaySearch, searchCpuPct } from "./runawaySearch.js";
import { sessionPhrase } from "./sessionOwner.js";

/**
 * The foreign-hog, session-child, swap and fleet halves of the summary, and which ALERT thresholds they crossed.
 * A session's child names the session in the clause itself, because that name is the whole point of reading it.
 *
 * @param topForeign the heaviest process no fleet session owns
 * @param fleetChildren the session-spawned processes over the foreign footprint line
 * @param foreignAlertGb the footprint line, in GB, both foreign and session children are judged against
 * @param fleet the fleet attribution, for orphans and in-flight calls
 * @param searches the runaway searches inside live seats (`./runawaySearch.ts`)
 * @returns one reason per crossed alert, in summary order
 */
export function alertReasons({
  topForeign,
  fleetChildren,
  swap,
  foreignAlertGb,
  swapAlertGb,
  fleet,
  parallelCallAlert,
  searches,
}: {
  topForeign: RankedProcess | undefined;
  fleetChildren: readonly RankedProcess[];
  swap: SwapUsage | undefined;
  foreignAlertGb: number;
  swapAlertGb: number;
  fleet: FleetLoadReading;
  parallelCallAlert: number;
  searches: readonly RunawaySearch[];
}): readonly GradeReason[] {
  const reasons: GradeReason[] = [];
  if (topForeign !== undefined && overThresholdGb({ bytes: topForeign.footprintBytes, gb: foreignAlertGb })) {
    reasons.push({ subject: "memory", text: `foreign footprint over ${String(foreignAlertGb)} GB` });
  }
  // One clause per child, never only the largest: two sessions' runaway heredocs at once must both be named
  // (a count of one is not enough), or the second is left to the hand search this clause exists to end.
  for (const child of fleetChildren) {
    if (child.session !== undefined) {
      reasons.push({
        subject: "memory",
        text: `'${child.label}' (pid ${String(child.pid)}) at ${String(child.footprintGb)} GB, over ${String(foreignAlertGb)} GB, spawned by ${sessionPhrase({ session: child.session })}`,
      });
    }
  }
  if (swap !== undefined && swap.usedGb > swapAlertGb) {
    reasons.push({ subject: "memory", text: `swap over ${String(swapAlertGb)} GB` });
  }
  // An orphan alerts at ONE, with no threshold to argue about: `machine reap` is supposed to have taken it,
  // so the first one standing is already evidence the tick that should have reaped it did not run.
  if (fleet.orphanCount > 0) {
    reasons.push({
      subject: "cpu",
      text: `${String(fleet.orphanCount)} orphaned fleet shell(s) from ${String(deadSeatOrphans({ reading: fleet }).length)} dead seat(s) at ${String(fleet.orphanCpuPct)}% cpu — slopweaver machine reap`,
    });
  }
  // Alerts at ONE for the same reason an orphan does: the criterion is already past a ceiling no correct call
  // reaches, so the first one standing is a search no session will ever read and `machine reap` should take.
  if (searches.length > 0) {
    reasons.push({
      subject: "cpu",
      text: `${String(searches.length)} runaway search(es) inside live seats at ${String(searchCpuPct({ searches }))}% cpu — slopweaver machine reap`,
    });
  }
  for (const session of fleet.sessions.filter((row) => row.parallelToolCalls >= parallelCallAlert)) {
    reasons.push({
      subject: "cpu",
      text: `session ${session.sessionId} has ${String(session.parallelToolCalls)} tool calls in flight, alert at ${String(parallelCallAlert)}`,
    });
  }
  return reasons;
}
