/**
 * How the Fleet page words a machine hold (`./fleetState.ts` lays out the rest): each hold subject as a phrase, when
 * the hold lets go, the hold's own lines under the working count, and the Capacity tile's disk caption.
 */
import type { Capacity } from "../components/live/readNow";

/**
 * One figure as the page prints it: one decimal place.
 *
 * @returns the figure
 */
export function oneDecimal({ value }: { value: number }): string {
  return value.toFixed(1);
}

/**
 * What a machine hold subject means, in a phrase.
 *
 * @returns the phrase
 */
function subjectPhrase({ subject, capacity }: { subject: string; capacity: Capacity }): string {
  if (subject === "cpu") {
    return `load is ${oneDecimal({ value: capacity.load1 })} against the ${String(capacity.loadHold)} it holds at`;
  }
  if (subject === "memory") {
    return "memory is under pressure";
  }
  if (subject === "boots") {
    return "several sessions have just started";
  }
  // Free GB against the floor, never a percentage: a volume 85% full with 150 GB free is no reason to hold
  // and only the two figures let the owner judge that at a glance.
  if (subject === "disk" && capacity.diskHoldFreeGb !== undefined) {
    return `the disk has ${oneDecimal({ value: capacity.diskFreeGb })} GB free, under the ${String(capacity.diskHoldFreeGb)} GB it holds at`;
  }
  if (subject === "disk") {
    return `the disk has ${oneDecimal({ value: capacity.diskFreeGb })} GB free`;
  }
  return `${subject} is over its limit`;
}

/**
 * The Capacity tile's disk caption: the floor the free figure is judged against, never a percentage, for the same
 * reason as the hold phrase above.
 *
 * @returns `disk free, hold below 28 GB`, or `disk free` on a capture from before the floor was carried
 */
export function diskCaption({ capacity }: { capacity: Pick<Capacity, "diskHoldFreeGb"> }): string {
  if (capacity.diskHoldFreeGb === undefined) {
    return "disk free";
  }
  return `disk free, hold below ${String(capacity.diskHoldFreeGb)} GB`;
}

/**
 * Every hold subject as one phrase.
 *
 * @returns the phrase
 */
export function holdPhrase({ capacity }: { capacity: Capacity }): string {
  if (capacity.holdSubjects.length === 0) {
    return "the capacity reading says hold without naming why";
  }
  return capacity.holdSubjects.map((subject) => subjectPhrase({ capacity, subject })).join(" and ");
}

/**
 * When a machine hold lets go.
 *
 * @returns the release clause
 */
function machineRelease({ capacity }: { capacity: Capacity }): string {
  if (capacity.holdSubjects.length === 1 && capacity.holdSubjects[0] === "cpu") {
    return `load is back under ${String(capacity.loadHold)}`;
  }
  if (
    capacity.holdSubjects.length === 1 &&
    capacity.holdSubjects[0] === "disk" &&
    capacity.diskHoldFreeGb !== undefined
  ) {
    return `at least ${String(capacity.diskHoldFreeGb)} GB is free again`;
  }
  return "that clears";
}

/**
 * A clause as a line of its own: capitalised, closed with a full stop.
 *
 * @returns the sentence
 */
function asLine({ clause }: { clause: string }): string {
  return `${clause.charAt(0).toUpperCase()}${clause.slice(1)}.`;
}

/**
 * A machine hold, one line per thing it is holding on: what holds, each reason, and when it lets go.
 *
 * @returns the lines
 */
export function machineLines({ capacity }: { capacity: Capacity }): readonly string[] {
  const reasons =
    capacity.holdSubjects.length === 0
      ? ["the capacity reading says hold without naming why"]
      : capacity.holdSubjects.map((subject) => subjectPhrase({ capacity, subject }));
  return [
    "The machine is too busy for another session.",
    ...reasons.map((clause) => asLine({ clause })),
    asLine({ clause: `more start once ${machineRelease({ capacity })}` }),
  ];
}
