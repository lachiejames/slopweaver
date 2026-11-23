/**
 * The page's half of the live machine reading: the route's wire shape, the narrow reader that accepts it, what the
 * page holds between two-second reads, and how old a held reading may look before it says so. Pure.
 *
 * The age rule: the page shows how long ago it was last read, and since it is basically live it should rarely
 * pass a minute. A reading ten seconds old or less is
 * live; past ten it turns amber, so a missed read or two shows; past a minute it says it has stopped updating, and
 * why when a read said why.
 */
import { type Bag, bags, every, instant, isBag, num, str, sub } from "./bag";
import type { LiveMachineReading, LiveOtherUse, LiveSessionUse } from "./liveMachine";

/** What `/api/live-machine` answers. */
export type LiveMachineWire =
  | { readonly kind: "read"; readonly reading: LiveMachineReading }
  | { readonly kind: "not-measured"; readonly attemptedAtIso: string; readonly why: string };

/** What the page holds: the newest reading that answered, and the newest failure since it. */
export interface LiveMachineHeld {
  readonly reading: LiveMachineReading | undefined;
  /** Why the latest read did not answer, cleared by the next one that does. */
  readonly why: string | undefined;
  /** The route never answered at all yet, nor failed: the page is opening. */
  readonly opening: boolean;
}

/** The page before its first read lands. */
export const LIVE_MACHINE_OPENING: LiveMachineHeld = { opening: true, reading: undefined, why: undefined };

/** The oldest a reading may be and still read as live, in milliseconds. */
export const LIVE_FOR_MS = 10_000;

/** The age past which a reading says it has stopped updating, in milliseconds. */
export const STOPPED_AFTER_MS = 60_000;

/** How often the page reads the machine (two-second updates). */
export const LIVE_MACHINE_EVERY_MS = 2_000;

/**
 * A figure the wire may omit (JSON drops an `undefined`): absent is `undefined`, present must be a finite figure.
 *
 * @returns the figure, `undefined` when absent, or `false` when present and not a figure
 */
function optional({ bag, key }: { bag: Bag; key: string }): number | undefined | false {
  if (!Object.hasOwn(bag, key)) {
    return undefined;
  }
  const value = num({ bag, key });
  if (value === undefined || value < 0) {
    return false;
  }
  return value;
}

/**
 * One session's tree off the wire.
 *
 * @returns the tree, or `undefined`
 */
function sessionOf(bag: Bag): LiveSessionUse | undefined {
  const sessionId = str({ bag, key: "sessionId" });
  const cpuCores = optional({ bag, key: "cpuCores" });
  const memoryBytes = num({ bag, key: "memoryBytes" });
  const processCount = num({ bag, key: "processCount" });
  if (sessionId === undefined || cpuCores === false || memoryBytes === undefined || processCount === undefined) {
    return undefined;
  }
  return { cpuCores, memoryBytes, processCount, sessionId };
}

/**
 * The heaviest outside group off the wire.
 *
 * @returns the group, `undefined` when absent, or `false` when present and malformed
 */
function otherOf({ bag, key }: { bag: Bag; key: string }): LiveOtherUse | undefined | false {
  if (!Object.hasOwn(bag, key)) {
    return undefined;
  }
  const other = sub({ bag, key });
  const label = other === undefined ? undefined : str({ bag: other, key: "label" });
  const memoryBytes = other === undefined ? undefined : num({ bag: other, key: "memoryBytes" });
  const cpuCores = other === undefined ? false : optional({ bag: other, key: "cpuCores" });
  if (label === undefined || memoryBytes === undefined || cpuCores === false) {
    return false;
  }
  return { cpuCores, label, memoryBytes };
}

/**
 * The reading off the wire, every required figure present.
 *
 * @returns the reading, or `undefined` when the shape is not one
 */
function readingOf({ bag }: { bag: Bag }): LiveMachineReading | undefined {
  const observedAtIso = instant({ bag, key: "observedAtIso" });
  const cores = num({ bag, key: "cores" });
  const load1 = num({ bag, key: "load1" });
  const cpu = sub({ bag, key: "cpu" });
  const memory = sub({ bag, key: "memory" });
  const sessions = every({ list: bags({ bag, key: "sessions" }), read: sessionOf });
  const topOtherCpu = otherOf({ bag, key: "topOtherCpu" });
  const topOtherMemory = otherOf({ bag, key: "topOtherMemory" });
  if (observedAtIso === undefined || cores === undefined || load1 === undefined || cpu === undefined) {
    return undefined;
  }
  if (memory === undefined || sessions === undefined || topOtherCpu === false || topOtherMemory === false) {
    return undefined;
  }
  const busyCores = optional({ bag: cpu, key: "busyCores" });
  const fleetCores = optional({ bag: cpu, key: "fleetCores" });
  const idlePct = optional({ bag: cpu, key: "idlePct" });
  const otherCores = optional({ bag: cpu, key: "otherCores" });
  if (busyCores === false || fleetCores === false || idlePct === false || otherCores === false) {
    return undefined;
  }
  const usedBytes = num({ bag: memory, key: "usedBytes" });
  const totalBytes = num({ bag: memory, key: "totalBytes" });
  const fleetBytes = num({ bag: memory, key: "fleetBytes" });
  const compressorSegmentsPct = optional({ bag: memory, key: "compressorSegmentsPct" });
  const swapfileCount = optional({ bag: memory, key: "swapfileCount" });
  const diagnostics = Reflect.get(bag, "diagnostics");
  if (compressorSegmentsPct === false || swapfileCount === false) {
    return undefined;
  }
  if (usedBytes === undefined || totalBytes === undefined || fleetBytes === undefined || usedBytes > totalBytes) {
    return undefined;
  }
  if (!Array.isArray(diagnostics) || !diagnostics.every((line) => typeof line === "string")) {
    return undefined;
  }
  return {
    cores,
    cpu: { busyCores, fleetCores, idlePct, otherCores },
    diagnostics,
    load1,
    memory: { compressorSegmentsPct, fleetBytes, swapfileCount, totalBytes, usedBytes },
    observedAtIso,
    sessions,
    topOtherCpu,
    topOtherMemory,
  };
}

/**
 * Narrow what `/api/live-machine` answered. A shape this page does not recognise is `undefined`, never a plausible
 * reading.
 *
 * @param payload the route's parsed JSON body
 * @returns the wire, or `undefined`
 */
export function readLiveMachineWire({ payload }: { payload: unknown }): LiveMachineWire | undefined {
  if (!isBag(payload)) {
    return undefined;
  }
  const kind = str({ bag: payload, key: "kind" });
  if (kind === "not-measured") {
    const attemptedAtIso = instant({ bag: payload, key: "attemptedAtIso" });
    const why = str({ bag: payload, key: "why" });
    if (attemptedAtIso === undefined || why === undefined) {
      return undefined;
    }
    return { attemptedAtIso, kind, why };
  }
  const readingBag = sub({ bag: payload, key: "reading" });
  if (kind !== "read" || readingBag === undefined) {
    return undefined;
  }
  const reading = readingOf({ bag: readingBag });
  if (reading === undefined) {
    return undefined;
  }
  return { kind, reading };
}

/**
 * What the page holds after one answer or failure: a reading replaces the held one and clears the failure; a failure
 * keeps the held reading, which goes on ageing, and records why.
 *
 * @param held what the page held before
 * @param answer the route's answer, or the reason the fetch itself failed
 * @returns what the page holds now
 */
export function liveMachineHeldAfter({
  held,
  answer,
}: {
  held: LiveMachineHeld;
  answer: { readonly wire: LiveMachineWire } | { readonly failed: string };
}): LiveMachineHeld {
  if ("failed" in answer) {
    return { opening: false, reading: held.reading, why: answer.failed };
  }
  if (answer.wire.kind === "not-measured") {
    return { opening: false, reading: held.reading, why: answer.wire.why };
  }
  return { opening: false, reading: answer.wire.reading, why: undefined };
}

/** How fresh a held reading looks. */
export interface LiveFreshness {
  readonly tone: "live" | "amber" | "stopped";
  readonly words: string;
}

/**
 * A whole-second age in words.
 *
 * @returns the words
 */
function secondsWords({ ageMs }: { ageMs: number }): string {
  const seconds = Math.max(0, Math.floor(ageMs / 1000));
  if (seconds < 60) {
    return `${String(seconds)}s ago`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${String(minutes)}m ago`;
  }
  return `${String(Math.floor(minutes / 60))}h ago`;
}

/**
 * The stamp a held reading carries: its age, green while live, amber past ten seconds, and past a minute a plain
 * statement that the page has stopped updating, with the last failure's reason when one was given.
 *
 * @param observedAtIso when the held reading was taken
 * @param nowMs the page's clock
 * @param why why the latest read did not answer, when one did not
 * @returns the stamp
 */
export function liveFreshnessOf({
  observedAtIso,
  nowMs,
  why,
}: {
  observedAtIso: string;
  nowMs: number;
  why: string | undefined;
}): LiveFreshness {
  const ageMs = nowMs - Date.parse(observedAtIso);
  const age = secondsWords({ ageMs });
  if (ageMs <= LIVE_FOR_MS) {
    return { tone: "live", words: `read ${age} · every ${String(LIVE_MACHINE_EVERY_MS / 1000)}s` };
  }
  if (ageMs <= STOPPED_AFTER_MS) {
    return { tone: "amber", words: `read ${age} · a newer reading is late` };
  }
  let reason = "no newer reading has answered";
  if (why !== undefined) {
    reason = why;
  }
  return { tone: "stopped", words: `stopped updating · last read ${age} · ${reason}` };
}
