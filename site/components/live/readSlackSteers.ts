/**
 * The readers for the Alignment page's Slack-steers chart: `profile steers --json` (which kind of correction each
 * turn of the owner's names, `src/profile/steerKinds.ts`) and `slack draft corrections --json` (when each draft the owner reviewed
 * went out, the baseline that keeps a quiet week from reading as an improvement).
 *
 * Strict in `./read.ts`'s sense: a payload that does not read is `undefined`, and one point that does not read refuses
 * the whole reading — a chart missing a point would draw a fall that did not happen.
 */

import { type Bag, bags, isBag, num, str, strings } from "../../lib/bag";

/** One turn of the owner's on one kind's chart. */
export interface SteerPoint {
  readonly anchor: string;
  readonly atIso: string;
  readonly says: "corrects" | "stopped";
  /** The words about this kind, verbatim. */
  readonly quote: string;
  /** The turn whole, when the verb read it inside its window. */
  readonly text: string | undefined;
}

/** One kind's trail. */
export interface SteerKindTrail {
  readonly kind: string;
  readonly title: string;
  readonly points: readonly SteerPoint[];
  readonly lastCorrectedIso: string | undefined;
  readonly stoppedIso: string | undefined;
}

/** The whole reading. */
export interface SlackSteers {
  readonly observedAtIso: string;
  readonly sinceIso: string;
  readonly kinds: readonly SteerKindTrail[];
  readonly read: number;
  readonly unread: number;
  /** The verdict journal's lines that would not read, 1-based — a verdict each may have held. */
  readonly unparsed: readonly number[];
  readonly gaps: readonly string[];
  readonly residue: readonly string[];
}

/** A list of 1-based line numbers, or `undefined` when absent or any entry is not one. */
function lineNumbers({ bag, key }: { bag: Bag; key: string }): readonly number[] | undefined {
  const value = bag[key];
  if (!Array.isArray(value)) {
    return undefined;
  }
  const lines: number[] = [];
  for (const one of value) {
    if (typeof one !== "number" || !Number.isInteger(one) || one < 1) {
      return undefined;
    }
    lines.push(one);
  }
  return lines;
}

/** An instant field, or `undefined` when absent or not an instant. */
function instant({ bag, key }: { bag: Bag; key: string }): string | undefined {
  const value = str({ bag, key });
  if (value === undefined || Number.isNaN(Date.parse(value))) {
    return undefined;
  }
  return value;
}

/** One point, or `undefined` when any field will not read. */
function pointOf({ bag }: { bag: Bag }): SteerPoint | undefined {
  const anchor = str({ bag, key: "anchor" });
  const atIso = instant({ bag, key: "atIso" });
  const quote = str({ bag, key: "quote" });
  const says = bag["says"];
  const text = bag["text"];
  if (anchor === undefined || atIso === undefined || quote === undefined) {
    return undefined;
  }
  if ((says !== "corrects" && says !== "stopped") || (text !== undefined && typeof text !== "string")) {
    return undefined;
  }
  return { anchor, atIso, quote, says, text };
}

/** An optional instant: absent is a fact, present and malformed refuses. */
function optionalInstant({ bag, key }: { bag: Bag; key: string }): { readonly value: string | undefined } | undefined {
  if (bag[key] === undefined) {
    return { value: undefined };
  }
  const value = instant({ bag, key });
  if (value === undefined) {
    return undefined;
  }
  return { value };
}

/** One trail, or `undefined` when it or any point on it will not read. */
function trailOf({ bag }: { bag: Bag }): SteerKindTrail | undefined {
  const kind = str({ bag, key: "kind" });
  const title = str({ bag, key: "title" });
  const list = bags({ bag, key: "points" });
  const last = optionalInstant({ bag, key: "lastCorrectedIso" });
  const stopped = optionalInstant({ bag, key: "stoppedIso" });
  if (kind === undefined || title === undefined || list === undefined || last === undefined || stopped === undefined) {
    return undefined;
  }
  const points: SteerPoint[] = [];
  for (const one of list) {
    const point = pointOf({ bag: one });
    if (point === undefined) {
      return undefined;
    }
    points.push(point);
  }
  return { kind, lastCorrectedIso: last.value, points, stoppedIso: stopped.value, title };
}

/**
 * Project `profile steers --json`.
 *
 * @returns the reading, or `undefined` when the payload or any trail or point in it does not read
 */
export function readSlackSteers(payload: unknown): SlackSteers | undefined {
  if (!isBag(payload)) {
    return undefined;
  }
  const observedAtIso = instant({ bag: payload, key: "observedAtIso" });
  const sinceIso = instant({ bag: payload, key: "sinceIso" });
  const list = bags({ bag: payload, key: "kinds" });
  const read = num({ bag: payload, key: "read" });
  const unread = num({ bag: payload, key: "unread" });
  const gaps = strings({ bag: payload, key: "gaps" });
  const residue = strings({ bag: payload, key: "residue" });
  const unparsed = lineNumbers({ bag: payload, key: "unparsed" });
  if (observedAtIso === undefined || sinceIso === undefined || list === undefined || read === undefined) {
    return undefined;
  }
  if (unread === undefined || gaps === undefined || residue === undefined || unparsed === undefined) {
    return undefined;
  }
  const kinds: SteerKindTrail[] = [];
  for (const one of list) {
    const trail = trailOf({ bag: one });
    if (trail === undefined) {
      return undefined;
    }
    kinds.push(trail);
  }
  return { gaps, kinds, observedAtIso, read, residue, sinceIso, unparsed, unread };
}

/**
 * Project `slack draft corrections --json` to the instants the owner said yes to a draft, oldest first.
 *
 * @returns the instants, or `undefined` when the payload or any instant in it does not read
 */
export function readDraftReviews(payload: unknown): readonly string[] | undefined {
  if (!isBag(payload)) {
    return undefined;
  }
  const reviewed = strings({ bag: payload, key: "reviewed" });
  if (reviewed === undefined || reviewed.some((iso) => Number.isNaN(Date.parse(iso)))) {
    return undefined;
  }
  return reviewed;
}
