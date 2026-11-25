/**
 * `machine capacity`'s supervisor-stream half: the report as `machine` stream events, their publication, and the
 * `--wait` poll that publishes the first and the last reading. Its own leaf so `./capacity.ts` stays one a reader
 * can hold; the machine is read only through the seam a caller passes.
 */
import type { SupervisorEvent } from "../../../events/event.js";
import { publishSupervisorEvent } from "../../../events/store.js";
import type { Logger } from "../../../lib/logger.js";
import type { MachineCapacityReport } from "../../../live/machine/capacity.js";
import { waitForCapacityClear } from "../../../live/machine/capacityWait.js";
import { machineHoldStands } from "../../../live/machine/recentBoots.js";
import type { WaitClock } from "../../../wait/loop.js";

/**
 * The report as `machine` stream events: a `capacity-hold` when the compressor, the swapfile count or the
 * 1-minute load crossed its hold threshold, a `capacity-alert` when a foreign hog or swap crossed its alert
 * threshold, both when both did, and nothing when neither — the sweep reads the newest of each kind.
 *
 * `holdOn` carries which SUBJECT held, because a stream row whose `where` column always read `compressor`
 * would reproduce, one hop out, the exact defect the subject-naming verdict fixes.
 *
 * A hold on boots in flight or the disk floor ALONE publishes nothing: boots clear themselves inside their
 * window, the disk floor is cleared by `worktree prune`, and a sweep reacting to either would seat an
 * investigation that is one more boot on one more worktree (`../../../live/machine/recentBoots.ts`).
 */
function streamEvents({
  report,
  nowIso,
}: {
  report: MachineCapacityReport;
  nowIso: string;
}): readonly SupervisorEvent[] {
  const fleetChild = report.fleetChildAlert ? report.topFleetChild : undefined;
  // A root daemon's relief is the owner's hand step, never a command react-now offers a seat; `why` carries it.
  const seatKill = report.culprit?.endedBy === "seat" ? report.culprit.kill : undefined;
  const shared = {
    atIso: nowIso,
    culpritKill: seatKill,
    culpritSubject: report.culprit?.subject,
    fleetChildLabel: fleetChild?.label,
    fleetChildSessionId: fleetChild?.session?.sessionId,
    holdOn: report.holdSubjects.length === 0 ? undefined : report.holdSubjects.join(" and "),
    load1: report.load?.load1,
    segmentsPct: report.compressor?.segmentsPct,
    source: "machine",
    swapUsedGb: report.swap?.usedGb,
    swapfileCount: report.swapfileCount,
    topForeignGb: report.topForeign?.footprintGb,
    topForeignLabel: report.topForeign?.label,
    why: report.verdict,
  } as const;
  const events: SupervisorEvent[] = [];
  if (machineHoldStands({ hold: report.hold, holdSubjects: report.holdSubjects })) {
    events.push({ ...shared, kind: "capacity-hold" });
  }
  if (report.alert) {
    events.push({ ...shared, kind: "capacity-alert" });
  }
  return events;
}

/**
 * Publish the report's stream events, when it has any. A publish that fails is said on the diagnostic channel
 * and never changes the run's exit: the reading itself was taken.
 *
 * @param report the finished machine report the events are derived from
 * @param home the state home whose supervisor stream receives them
 * @param nowIso the instant each event carries
 * @param log where a failed publish is said
 */
export function publishCapacityEvents({
  report,
  home,
  nowIso,
  log,
}: {
  report: MachineCapacityReport;
  home: string;
  nowIso: string;
  log: Pick<Logger, "error">;
}): void {
  for (const event of streamEvents({ nowIso, report })) {
    const failure = publishSupervisorEvent({ event, home });
    if (failure !== undefined) {
      log.error({ msg: `machine capacity: could not publish its ${event.kind} to the supervisor stream: ${failure}` });
    }
  }
}

/**
 * Wait for a HOLD to clear, publishing what a single read would: the FIRST reading's events, and the final
 * reading's too when the wait took more than one read, so the stream sees the state the wait ended on without a
 * row per re-read.
 *
 * @param read takes one machine reading, once per poll
 * @param home the state home whose supervisor stream receives the events
 * @param nowIso the instant each published event carries, read at each publish
 * @param log where a failed publish is said
 * @param clock the wait's time source
 * @param timeoutSeconds how long a standing hold is waited on before the wait gives up
 * @param emit receives each changed hold line
 * @returns the wait's outcome, carrying the reading it ended on and how many reads it took
 */
export async function waitPublishingCapacityEvents({
  read,
  home,
  nowIso,
  log,
  clock,
  timeoutSeconds,
  emit,
}: {
  read: () => MachineCapacityReport;
  home: string;
  nowIso: () => string;
  log: Pick<Logger, "error">;
  clock: WaitClock;
  timeoutSeconds: number;
  emit: (line: string) => void;
}): Promise<Awaited<ReturnType<typeof waitForCapacityClear>>> {
  let published = false;
  const outcome = await waitForCapacityClear({
    clock,
    emit,
    read: () => {
      const report = read();
      if (!published) {
        publishCapacityEvents({ home, log, nowIso: nowIso(), report });
        published = true;
      }
      return report;
    },
    timeoutSeconds,
  });
  if (outcome.reads > 1) {
    publishCapacityEvents({ home, log, nowIso: nowIso(), report: outcome.reading });
  }
  return outcome;
}
