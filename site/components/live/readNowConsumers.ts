/**
 * What `machine capacity` names beside its verdict — the culprit, the heaviest processes by CPU and memory, and the
 * dispatch register — and the readers for each. A sibling of `./readNow.ts`, under every rule its module doc states.
 */

import { type Bag, bags, bool, instant, num, str, strings, sub } from "../../lib/bag";
import { count, optionalStr } from "./readNowFields";

/** The session `machine capacity` would end first, and the one command that ends it. */
export interface CapacityCulprit {
  readonly subject: string;
  readonly why: string;
  readonly kill: string;
}

/** One of the machine's heaviest processes by `%CPU`, named by its `comm`, never its argv. */
export interface CpuConsumer {
  readonly pid: number;
  readonly label: string;
  /** 100 is one whole core. */
  readonly cpuPct: number;
  /** `fleet`, `foreign` — the verb's own word. */
  readonly classification: string;
  readonly sessionId: string | undefined;
}

/** One of the machine's heaviest processes by memory footprint. */
export interface MemoryConsumer {
  readonly pid: number;
  readonly label: string;
  readonly footprintGb: number;
  readonly classification: string;
  /** The worktree of the Claude session it belongs to, when one owns it. */
  readonly sessionCwd: string | undefined;
}

/** The `%CPU` sample: whether it attributed anything, and the heaviest processes it named. */
export interface CpuConsumers {
  readonly attributed: boolean;
  readonly hogs: readonly CpuConsumer[];
}

/** One covering dispatch: a load finding that seated a visible session on a board row. */
export interface CapacityInvestigation {
  readonly id: string;
  /** When the reading that raised it was taken — when the investigation started. */
  readonly observedIso: string;
  /** The board row the seat was opened on. */
  readonly slug: string;
  readonly subjectLabel: string;
  readonly subjectWhy: string;
  readonly triggers: readonly string[];
}

/** The dispatch register at the reading. */
export interface CapacityDispatch {
  readonly open: number;
  readonly covering: number;
  /** Absent on a capture from before the field; an empty list is a measured none. */
  readonly investigations: readonly CapacityInvestigation[] | undefined;
  readonly investigationsOmitted: number | undefined;
}

/**
 * A list a newer capture carries and an older one lacks: `undefined` when the key is missing, `false` when a present
 * one or any of its rows will not read.
 *
 * @returns the rows, `undefined`, or `false`
 */
export function laterRows<T>({
  bag,
  key,
  read,
}: {
  bag: Bag;
  key: string;
  read: (row: Bag) => T | undefined;
}): readonly T[] | undefined | false {
  if (!Object.hasOwn(bag, key)) {
    return undefined;
  }
  const rows = bags({ bag, key });
  if (rows === undefined) {
    return false;
  }
  const parsed: T[] = [];
  for (const row of rows) {
    const value = read(row);
    if (value === undefined) {
      return false;
    }
    parsed.push(value);
  }
  return parsed;
}

/**
 * One `cpuHogs.hogs` row.
 *
 * @returns the consumer, or `undefined` when a field will not read
 */
function cpuConsumerOf(bag: Bag): CpuConsumer | undefined {
  const pid = num({ bag, key: "pid" });
  const label = str({ bag, key: "label" });
  const cpuPct = num({ bag, key: "cpuPct" });
  const classification = str({ bag, key: "classification" });
  const sessionId = optionalStr({ bag, key: "sessionId" });
  if (
    pid === undefined ||
    label === undefined ||
    cpuPct === undefined ||
    classification === undefined ||
    sessionId === false
  ) {
    return undefined;
  }
  return { classification, cpuPct, label, pid, sessionId };
}

/**
 * One `processes` row.
 *
 * @returns the consumer, or `undefined` when a field will not read
 */
export function memoryConsumerOf(bag: Bag): MemoryConsumer | undefined {
  const pid = num({ bag, key: "pid" });
  const label = str({ bag, key: "label" });
  const footprintGb = num({ bag, key: "footprintGb" });
  const classification = str({ bag, key: "classification" });
  if (pid === undefined || label === undefined || footprintGb === undefined || classification === undefined) {
    return undefined;
  }
  let sessionCwd: string | undefined;
  if (Object.hasOwn(bag, "session")) {
    const session = sub({ bag, key: "session" });
    const cwd = session === undefined ? undefined : str({ bag: session, key: "cwd" });
    if (cwd === undefined) {
      return undefined;
    }
    sessionCwd = cwd;
  }
  return { classification, footprintGb, label, pid, sessionCwd };
}

/**
 * One `dispatch.investigations` row.
 *
 * @returns the investigation, or `undefined` when a field will not read
 */
function investigationOf(bag: Bag): CapacityInvestigation | undefined {
  const id = str({ bag, key: "id" });
  const observedIso = instant({ bag, key: "observedIso" });
  const slug = str({ bag, key: "slug" });
  const subject = sub({ bag, key: "subject" });
  const triggers = strings({ bag, key: "triggers" });
  if (id === undefined || observedIso === undefined || slug === undefined || subject === undefined) {
    return undefined;
  }
  const subjectLabel = str({ bag: subject, key: "label" });
  const subjectWhy = str({ bag: subject, key: "why" });
  if (subjectLabel === undefined || subjectWhy === undefined || triggers === undefined) {
    return undefined;
  }
  return { id, observedIso, slug, subjectLabel, subjectWhy, triggers };
}

/**
 * The `%CPU` sample: `undefined` on a capture without one, `false` when a present one will not read.
 *
 * @returns the consumers, `undefined`, or `false`
 */
export function cpuConsumersOf({ payload }: { payload: Bag }): CpuConsumers | undefined | false {
  if (!Object.hasOwn(payload, "cpuHogs")) {
    return undefined;
  }
  const reading = sub({ bag: payload, key: "cpuHogs" });
  if (reading === undefined) {
    return false;
  }
  const attributed = bool({ bag: reading, key: "cpuAttributed" });
  const hogs = laterRows({ bag: reading, key: "hogs", read: cpuConsumerOf });
  if (attributed === undefined || hogs === undefined || hogs === false) {
    return false;
  }
  return { attributed, hogs };
}

/**
 * The dispatch block: `undefined` on a capture without one, `false` when a present one will not read.
 *
 * @returns the block, `undefined`, or `false`
 */
export function dispatchOf({ payload }: { payload: Bag }): CapacityDispatch | undefined | false {
  if (!Object.hasOwn(payload, "dispatch")) {
    return undefined;
  }
  const block = sub({ bag: payload, key: "dispatch" });
  if (block === undefined) {
    return false;
  }
  const open = count({ bag: block, key: "open" });
  const covering = count({ bag: block, key: "covering" });
  const investigations = laterRows({ bag: block, key: "investigations", read: investigationOf });
  const omittedPresent = Object.hasOwn(block, "investigationsOmitted");
  const investigationsOmitted = count({ bag: block, key: "investigationsOmitted" });
  if (
    open === undefined ||
    covering === undefined ||
    investigations === false ||
    (omittedPresent && investigationsOmitted === undefined)
  ) {
    return false;
  }
  return { covering, investigations, investigationsOmitted, open };
}
