/**
 * The readers for what every workstream carries and what its `detail` adds beside it: placement, priority, the queue
 * workstream, waiting, the ending and the people. Split out of `./workstreamTiles.ts`.
 */

import { type Bag, bags, bool, num, str, sub } from "./bag";
import { entriesOf, everyRow, linksOf, strOrNull } from "./workstreamTilesFields";
import type { EndingView, InvolvedView, PlacedFields, PriorityView, WaitingView } from "./workstreamTilesViews";

/** One workstream row split the way the document carries it: the row itself, its `detail` and its `derived`. */
export interface RowParts {
  readonly row: Bag;
  readonly detail: Bag;
  readonly derived: Bag;
}

/**
 * The fields every kind carries: its identity and stated workspace, its entries and links, and the lane and dates
 * the verb derived.
 *
 * @returns the fields, or `undefined`
 */
export function placedOf({ parts }: { parts: RowParts }): PlacedFields | undefined {
  const { derived, row } = parts;
  const id = str({ bag: row, key: "id" });
  const name = str({ bag: row, key: "name" });
  const workspace = str({ bag: row, key: "workspace" });
  const entries = entriesOf({ row });
  const linked = linksOf({ row });
  const lane = str({ bag: derived, key: "lane" });
  const atRisk = bool({ bag: derived, key: "atRisk" });
  const startedOn = strOrNull({ bag: derived, key: "startedOn" });
  const lastMovedOn = strOrNull({ bag: derived, key: "lastMovedOn" });
  if (
    id === undefined ||
    name === undefined ||
    entries === undefined ||
    linked === undefined ||
    lane === undefined ||
    atRisk === undefined ||
    startedOn === undefined ||
    lastMovedOn === undefined
  ) {
    return undefined;
  }
  if (workspace !== "team" && workspace !== "self") {
    return undefined;
  }
  return {
    atRisk,
    entries,
    id,
    lane,
    lastMovedOn,
    links: linked.links,
    name,
    related: linked.related,
    startedOn,
    workspace,
  };
}

/**
 * A priority: `null` when no steer of the owner's is on record.
 *
 * @returns the priority, `null`, or `undefined` for one that will not read
 */
export function priorityOf({ detail }: { detail: Bag }): PriorityView | null | undefined {
  if (detail["priority"] === null) {
    return null;
  }
  const raw = sub({ bag: detail, key: "priority" });
  if (raw === undefined) {
    return undefined;
  }
  const level = str({ bag: raw, key: "level" });
  const because = str({ bag: raw, key: "because" });
  const anchor = str({ bag: raw, key: "anchor" });
  if (level === undefined || because === undefined || anchor === undefined) {
    return undefined;
  }
  if (!("rank" in raw)) {
    return { anchor, because, level, rank: undefined };
  }
  const rank = num({ bag: raw, key: "rank" });
  if (rank === undefined || !Number.isInteger(rank) || rank < 1) {
    return undefined;
  }
  return { anchor, because, level, rank };
}

/**
 * The shape a board tag value has: lower-case kebab with no doubled or trailing hyphen, exactly the pattern
 * `src/handover/rowTags.ts` validates a `workstream=` with.
 */
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/**
 * The Queue's workstream tag value: absent when the register names none, which is the only way it is missing.
 *
 * @returns the value read, its own `undefined` when absent, or `undefined` for one that will not read
 */
export function queueWorkstreamOf({ detail }: { detail: Bag }): { readonly value: string | undefined } | undefined {
  if (!("queueWorkstream" in detail)) {
    return { value: undefined };
  }
  const value = detail["queueWorkstream"];
  if (typeof value !== "string" || !KEBAB.test(value)) {
    return undefined;
  }
  return { value };
}

/**
 * Whose move it is: `null` when nothing holds it.
 *
 * @returns the hold, `null`, or `undefined` for one that will not read
 */
export function waitingOf({ detail }: { detail: Bag }): WaitingView | null | undefined {
  if (detail["waitingOn"] === null) {
    return null;
  }
  const raw = sub({ bag: detail, key: "waitingOn" });
  if (raw === undefined) {
    return undefined;
  }
  const on = str({ bag: raw, key: "on" });
  const what = str({ bag: raw, key: "what" });
  if (what === undefined) {
    return undefined;
  }
  if (on === "you") {
    return { on, what };
  }
  const who = str({ bag: raw, key: "who" });
  if (on !== "someone" || who === undefined) {
    return undefined;
  }
  return { on, what, who };
}

/**
 * How it ended: `null` while it is live.
 *
 * @returns the ending, `null`, or `undefined` for one that will not read
 */
export function endingRead({ detail }: { detail: Bag }): EndingView | null | undefined {
  if (detail["ending"] === null) {
    return null;
  }
  const raw = sub({ bag: detail, key: "ending" });
  if (raw === undefined) {
    return undefined;
  }
  const kind = str({ bag: raw, key: "kind" });
  const reason = str({ bag: raw, key: "reason" });
  const on = str({ bag: raw, key: "on" });
  const anchor = str({ bag: raw, key: "anchor" });
  if (kind !== "abandoned" || reason === undefined || on === undefined || anchor === undefined) {
    return undefined;
  }
  return { anchor, kind, on, reason };
}

/**
 * The people involved, every one of them or nothing: each a Slack member id and the part they play.
 *
 * @returns the people, or `undefined`
 */
export function involvedOf({ detail }: { detail: Bag }): readonly InvolvedView[] | undefined {
  return everyRow({
    read: (one) => {
      const slack = str({ bag: one, key: "slack" });
      const part = str({ bag: one, key: "part" });
      return slack === undefined || part === undefined ? undefined : { part, slack };
    },
    rows: bags({ bag: detail, key: "people" }),
  });
}
