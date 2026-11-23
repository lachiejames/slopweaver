"use client";

/**
 * The installation's two health readings the supervisor tick records — whether a Slack tag would be
 * answered, and what the machine can carry — as the one line the Fleet page keeps. Both read the readings LEDGER,
 * never the verb: `listen status` and `machine capacity` are the tick's to run, and a page polling them would pay a
 * verb every twenty seconds (`liveVerbs.ts`).
 */
import type { ReactElement, ReactNode } from "react";

import { ReadMark, ReadStandIn } from "./LiveMarks";
import type { Reading } from "./reading";
import { type Capacity, type Listener, readCapacityReading, readListenerReading } from "./readNow";
import { useLive } from "./useLive";

/** The fast lane's poll interval: a cadence for noticing a NEW tick's reading, not a verb run. */
const FAST_POLL_MS = 20_000;

/**
 * The capacity verdict as one word, in the verb's own terms.
 *
 * @returns `HOLD on <subjects>`, `ALERT` or `clear`
 */
function capacityTag({ capacity }: { capacity: Capacity }): string {
  if (capacity.hold) {
    return `HOLD on ${capacity.holdSubjects.join(", ")}`;
  }
  if (capacity.alert) {
    return "ALERT";
  }
  return "clear";
}

/**
 * The listener's grade and the machine's verdict in one line. A reading still loading draws its spinner, and one not
 * read its staleness mark, rather than reading as healthy.
 *
 * @param fixture the capture name a `?fixture=` page froze its readings to
 * @returns the line
 */
export function MachineHealthLine({ fixture }: { fixture: string | undefined }): ReactElement {
  const listener = useLive<Reading<Listener>>({
    everyMs: FAST_POLL_MS,
    fixture,
    read: readListenerReading,
    slug: "listener-reading",
  });
  const capacity = useLive<Reading<Capacity>>({
    everyMs: FAST_POLL_MS,
    fixture,
    read: readCapacityReading,
    slug: "capacity-reading",
  });
  let listenerFact: ReactNode;
  if (listener.phase === "ready") {
    listenerFact = (
      <>
        {listener.value.value.grade} <ReadMark state={listener} subject="The listener" />
      </>
    );
  } else {
    listenerFact = <ReadStandIn state={listener} subject="the listener" />;
  }
  let capacityFact: ReactNode;
  if (capacity.phase !== "ready") {
    capacityFact = <ReadStandIn state={capacity} subject="the machine" />;
  } else {
    const machine = capacity.value.value;
    capacityFact = (
      <>
        {capacityTag({ capacity: machine })}, load {String(machine.load1)} of {String(machine.loadHold)}{" "}
        <ReadMark state={capacity} subject="The machine" />
      </>
    );
  }
  return (
    <p className="mt-2 mb-0 text-[0.8rem] text-muted-foreground">
      {fixture !== undefined && <strong>FIXTURE {fixture} · </strong>}
      listener {listenerFact} · machine {capacityFact}
    </p>
  );
}
