/**
 * The capacity verdict's subject when a WATCHED daemon is what holds the memory — `./daemonWatch.ts`'s list,
 * read by exact binary path, never a session.
 *
 * MEASURED: the verdict read `HOLD on memory
 * (14 swapfiles) · SUBJECT session <session-id> — 16% cpu across 31 processes; end it with \`kill 59894\`` while
 * fseventsd held 32 GB and that session's own `claude` held 1 GB. The named fix freed nothing, because
 * `./fleetCulprit.ts` only ever weighs fleet processes, and a session at 16% cpu is the top of a flat list,
 * not a cause. Reproduce: `slopweaver machine capacity --json` and compare `topForeign` with `culprit`.
 *
 * So this step runs FIRST, and only on a reading that HELD on memory: the heaviest watched daemon becomes the
 * subject when it is over the foreign-footprint alert line AND it outweighs EVERY row of the ranked read. Its end
 * command is the spec's relief, which only the owner can run (the daemon is root), so `endedBy` says so and the
 * verdict words it as a hand step rather than a `kill` a seat may run. A daemon under the line, or any heavier
 * process beside it, leaves the subject to `./fleetCulprit.ts` exactly as before.
 *
 * Every row, not only the foreign ones, and that is what makes the claim provable from a partial read. The ranked
 * read keeps `topN` rows (`top -n`), so a process below the cut weighs at most the lightest kept row, which a
 * daemon at least as heavy as every kept row already outweighs. And a row's classification can be wrong — a stale
 * session record on a reused pid marks a foreign process `fleet` — so a check over foreign rows alone would let
 * a heavier misclassified one through. The same cut bounds the daemon itself: one the ranked read left out weighed
 * no more than its lightest kept row then, which proves nothing, so the subject is only ever a daemon the
 * memory-ranked read printed. An EMPTY ranked read (the read failed) proves nothing and names nobody.
 * Both the cut and the misclassified cases are pinned by tests.
 */
import { overThresholdGb, type RankedProcess } from "./capacityRank.js";
import { WATCHED_DAEMONS } from "./daemonWatch.js";
import type { FleetCulprit } from "./fleetCulprit.js";

/**
 * The watched daemon a memory reading blames, with its relief, or `undefined` when none qualifies.
 *
 * @param watched the watched daemons as read by pid (`MachineCapacityReport.watchedProcesses`) — identity proven
 *   by binary path, so a label match here cannot admit a lookalike
 * @param ranked the ordinary memory-ranked read, every row of which the daemon must at least equal
 * @param memoryHeld whether this reading HELD on memory — an alert alone names no daemon
 * @param foreignAlertGb the footprint line the daemon must be strictly over, in GB, judged on exact bytes
 * @returns the daemon as the subject, its relief as the end command and `endedBy: "owner"`
 */
export function daemonCulprit({
  watched,
  ranked,
  memoryHeld,
  foreignAlertGb,
}: {
  watched: readonly RankedProcess[];
  ranked: readonly RankedProcess[];
  memoryHeld: boolean;
  foreignAlertGb: number;
}): FleetCulprit | undefined {
  if (!memoryHeld) {
    return undefined;
  }
  // The ranked and watched reads are two snapshots taken one after the other, so a daemon printed in both is
  // judged by the LESSER footprint: a balloon between them must not outweigh a row the ranked read itself
  // showed heavier. A daemon the memory-ranked cut left out weighed no more than its lightest kept
  // row at that instant, which can never prove it outweighed every row, so only a daemon the ranked read printed
  // is judged at all: a balloon between the two snapshots cannot make it the subject. Every one is
  // judged BEFORE the heaviest is picked, so one pid shrunk by its ranked row cannot mask another that qualifies.
  const judged = watched.flatMap((process) => {
    const rankedSelf = ranked.find((row) => row.pid === process.pid);
    if (rankedSelf === undefined) {
      return [];
    }
    return [{ bytes: Math.min(process.footprintBytes, rankedSelf.footprintBytes), process }];
  });
  const heaviestJudged = judged.toSorted((a, b) => b.bytes - a.bytes)[0];
  if (heaviestJudged === undefined) {
    return undefined;
  }
  const { bytes, process: heaviest } = heaviestJudged;
  if (!overThresholdGb({ bytes, gb: foreignAlertGb })) {
    return undefined;
  }
  if (ranked.length === 0 || ranked.some((process) => process.footprintBytes > bytes)) {
    return undefined;
  }
  const spec = WATCHED_DAEMONS.find((daemon) => daemon.label === heaviest.label);
  if (spec === undefined) {
    return undefined;
  }
  return {
    endedBy: "owner",
    kill: spec.relief,
    // The label alone, no pid: `./anomaly.ts` signs on this string, and a restart yields a new pid every time.
    subject: spec.label,
    why:
      `${spec.label} (pid ${String(heaviest.pid)}, root) holds ${String(heaviest.footprintGb)} GB, the heaviest ` +
      "foreign process on the machine, so no session kill frees this memory",
  };
}
