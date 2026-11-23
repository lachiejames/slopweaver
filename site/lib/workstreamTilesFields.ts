/**
 * The field readers the workstreams document is narrowed with: nullable scalars, every-row lists, entries, links, the
 * milestone graph, feedback and progress. Split out of `./workstreamTiles.ts`.
 */

import { type Bag, bags, bool, num, str, strings, sub } from "./bag";
import type {
  EntryView,
  FeedbackView,
  LinkKind,
  LinkView,
  MilestoneGraphView,
  MilestoneNodeView,
  MilestoneRefView,
  MilestoneState,
  ProgressView,
  RelatedView,
} from "./workstreamTilesViews";

/**
 * A string-or-null field: `null` when the verb wrote null, `undefined` when it is absent or the wrong type.
 *
 * @returns the value, `null`, or `undefined` for a field that will not read
 */
export function strOrNull({ bag, key }: { bag: Bag; key: string }): string | null | undefined {
  if (bag[key] === null) {
    return null;
  }
  return str({ bag, key });
}

/**
 * Read every row of a list with one reader, refusing the whole list if one row will not read.
 *
 * @returns the rows, or `undefined`
 */
export function everyRow<T>({
  rows,
  read,
}: {
  rows: readonly Bag[] | undefined;
  read: (row: Bag) => T | undefined;
}): readonly T[] | undefined {
  if (rows === undefined) {
    return undefined;
  }
  const out: T[] = [];
  for (const row of rows) {
    const one = read(row);
    if (one === undefined) {
      return undefined;
    }
    out.push(one);
  }
  return out;
}

/** One entry as read, with the position its story order comes from. */
interface PositionedEntry {
  readonly entry: EntryView;
  readonly position: number;
}

/**
 * One dated entry. One that finishes a milestone names the milestone it finishes, else it will not read.
 *
 * @returns the entry and its position, or `undefined`
 */
function entryOf({ row }: { row: Bag }): PositionedEntry | undefined {
  const id = str({ bag: row, key: "id" });
  const date = str({ bag: row, key: "date" });
  const href = strOrNull({ bag: row, key: "href" });
  const kind = str({ bag: row, key: "kind" });
  const text = str({ bag: row, key: "text" });
  const milestoneId = strOrNull({ bag: row, key: "milestoneId" });
  const done = bool({ bag: row, key: "done" });
  const position = num({ bag: row, key: "position" });
  if (
    id === undefined ||
    date === undefined ||
    href === undefined ||
    kind === undefined ||
    text === undefined ||
    milestoneId === undefined ||
    done === undefined ||
    position === undefined
  ) {
    return undefined;
  }
  if (done && milestoneId === null) {
    return undefined;
  }
  return { entry: { date, done, href, id, kind, milestoneId, text }, position };
}

/**
 * A workstream's dated entries, every one of them or nothing, in story order: by `position`, as the store orders them.
 *
 * @returns the entries, or `undefined`
 */
export function entriesOf({ row }: { row: Bag }): readonly EntryView[] | undefined {
  const read = everyRow({ read: (one) => entryOf({ row: one }), rows: bags({ bag: row, key: "entries" }) });
  if (read === undefined) {
    return undefined;
  }
  return read.toSorted((a, b) => a.position - b.position).map((one) => one.entry);
}

const LINK_KINDS: readonly LinkKind[] = [
  "queue_card",
  "alignment_card",
  "automation",
  "pull_request",
  "linear_project",
];

/**
 * Whether a string is one of the link kinds the page draws as a chip.
 *
 * @returns true for one
 */
function isLinkKind(value: string | undefined): value is LinkKind {
  return LINK_KINDS.some((kind) => kind === value);
}

/** A workstream's links, split as the page draws them: chips, and the other workstreams it relates to. */
interface LinksRead {
  readonly links: readonly LinkView[];
  readonly related: readonly RelatedView[];
}

/**
 * A workstream's links, every one of them or nothing: a `workstream` link is a related workstream, by its id and why;
 * every other kind the store declares is a chip. A kind the store does not declare will not read.
 *
 * @returns the links and the related workstreams, or `undefined`
 */
export function linksOf({ row }: { row: Bag }): LinksRead | undefined {
  const rows = bags({ bag: row, key: "links" });
  if (rows === undefined) {
    return undefined;
  }
  const links: LinkView[] = [];
  const related: RelatedView[] = [];
  for (const one of rows) {
    const id = str({ bag: one, key: "id" });
    const kind = str({ bag: one, key: "kind" });
    const target = str({ bag: one, key: "target" });
    const label = strOrNull({ bag: one, key: "label" });
    const milestoneId = strOrNull({ bag: one, key: "milestoneId" });
    if (id === undefined || target === undefined || label === undefined || milestoneId === undefined) {
      return undefined;
    }
    if (kind === "workstream") {
      related.push({ id: target, milestoneId, why: label });
    } else if (isLinkKind(kind)) {
      links.push({ id, kind, label, milestoneId, target });
    } else {
      return undefined;
    }
  }
  return { links, related };
}

const MILESTONE_STATES: readonly MilestoneState[] = ["done", "moving", "ready", "waiting"];

/**
 * Whether a string is one of the states the verb derives.
 *
 * @returns true for a known state
 */
function isMilestoneState(value: string | undefined): value is MilestoneState {
  return MILESTONE_STATES.some((state) => state === value);
}

/**
 * One node of a workstream's milestone graph.
 *
 * @returns the node, or `undefined`
 */
function milestoneNodeOf({ row }: { row: Bag }): MilestoneNodeView | undefined {
  const id = str({ bag: row, key: "id" });
  const name = str({ bag: row, key: "name" });
  const anchor = str({ bag: row, key: "anchor" });
  const after = strings({ bag: row, key: "after" });
  const state = str({ bag: row, key: "state" });
  const column = num({ bag: row, key: "column" });
  const startedOn = strOrNull({ bag: row, key: "startedOn" });
  const lastMovedOn = strOrNull({ bag: row, key: "lastMovedOn" });
  const doneOn = strOrNull({ bag: row, key: "doneOn" });
  const href = strOrNull({ bag: row, key: "href" });
  const waitingFor = strings({ bag: row, key: "waitingFor" });
  if (
    id === undefined ||
    name === undefined ||
    anchor === undefined ||
    after === undefined ||
    !isMilestoneState(state) ||
    column === undefined ||
    startedOn === undefined ||
    lastMovedOn === undefined ||
    doneOn === undefined ||
    href === undefined ||
    waitingFor === undefined
  ) {
    return undefined;
  }
  return { after, anchor, column, doneOn, href, id, lastMovedOn, name, startedOn, state, waitingFor };
}

/**
 * A workstream's derived milestone graph, every node of it, or nothing.
 *
 * @param derived the workstream's `derived` block
 * @returns the graph, or `undefined`
 */
export function milestoneGraphOf({ derived }: { derived: Bag }): MilestoneGraphView | undefined {
  const raw = sub({ bag: derived, key: "milestoneGraph" });
  if (raw === undefined) {
    return undefined;
  }
  const columns = num({ bag: raw, key: "columns" });
  const milestones = everyRow({
    read: (one) => milestoneNodeOf({ row: one }),
    rows: bags({ bag: raw, key: "milestones" }),
  });
  if (columns === undefined || milestones === undefined) {
    return undefined;
  }
  return { columns, milestones };
}

/**
 * One feedback line.
 *
 * @returns the line, or `undefined`
 */
export function feedbackOf({ row }: { row: Bag }): FeedbackView | undefined {
  const date = str({ bag: row, key: "date" });
  const href = strOrNull({ bag: row, key: "href" });
  const response = strOrNull({ bag: row, key: "response" });
  const sign = str({ bag: row, key: "sign" });
  const text = str({ bag: row, key: "text" });
  const who = str({ bag: row, key: "who" });
  if (date === undefined || href === undefined || response === undefined || text === undefined || who === undefined) {
    return undefined;
  }
  if (sign !== "positive" && sign !== "negative") {
    return undefined;
  }
  return { date, href, response, sign, text, who };
}

/**
 * A milestone as progress names it: its id and name, off the stored milestone the verb copied in.
 *
 * @returns the reference, or `undefined`
 */
function milestoneRefOf({ row }: { row: Bag }): MilestoneRefView | undefined {
  const id = str({ bag: row, key: "id" });
  const name = str({ bag: row, key: "name" });
  if (id === undefined || name === undefined) {
    return undefined;
  }
  return { id, name };
}

/**
 * A workstream's derived progress against its own milestones.
 *
 * @param derived the workstream's `derived` block
 * @returns the progress, or `undefined`
 */
export function progressOf({ derived }: { derived: Bag }): ProgressView | undefined {
  const raw = sub({ bag: derived, key: "progress" });
  if (raw === undefined) {
    return undefined;
  }
  const doneCount = num({ bag: raw, key: "doneCount" });
  const totalCount = num({ bag: raw, key: "totalCount" });
  const complete = bool({ bag: raw, key: "complete" });
  const ready = everyRow({ read: (row) => milestoneRefOf({ row }), rows: bags({ bag: raw, key: "ready" }) });
  if (doneCount === undefined || totalCount === undefined || complete === undefined || ready === undefined) {
    return undefined;
  }
  if (raw["next"] === null) {
    return { complete, doneCount, next: null, ready, totalCount };
  }
  const rawNext = sub({ bag: raw, key: "next" });
  const next = rawNext === undefined ? undefined : milestoneRefOf({ row: rawNext });
  if (next === undefined) {
    return undefined;
  }
  return { complete, doneCount, next, ready, totalCount };
}
