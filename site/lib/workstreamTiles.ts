/**
 * Reading `slopweaver workstreams list --json` into what the Workstreams page draws.
 *
 * The document is schema version 2 (`src/workstreams/store/projection.ts`): every workstream exactly as the store
 * holds it — its authored fields, its typed `detail`, its own milestones, its dated entries and its links — with what
 * the verb derived for it under `derived`, and the register document under `meta`, `null` before one is written.
 * Progress is counted against each workstream's OWN milestones, so there is no generic bar here at all.
 *
 * The site cannot import `src/`, so this only narrows the document. It REFUSES rather than repairs: any other schema
 * version, or a document missing a field it should carry, reads as `undefined`, which the page shows as a failed
 * read — never as a tile with a blank where a fact was. The one tolerance is per workstream KIND: an unknown kind is
 * skipped and counted, so a register written by a newer verb still draws every tile this page knows how to draw and
 * says how many it could not.
 */

import { type Bag, bags, bool, isBag, num, str, strings, sub } from "./bag";
import { everyRow } from "./workstreamTilesFields";
import type { RowParts } from "./workstreamTilesPlaced";
import { closingOf, linkedOf, localOf, tileOf } from "./workstreamTilesStory";
import type {
  EndingView,
  GroupingView,
  LaneView,
  LinkKind,
  LinkView,
  MilestoneNodeView,
  ProgressView,
  WorkstreamsView,
  WorkstreamView,
} from "./workstreamTilesViews";

export type {
  ClosingView,
  EndingView,
  EntryView,
  FeedbackView,
  GroupingView,
  InvolvedView,
  LaneView,
  LinkedView,
  LinkKind,
  LinkView,
  LocalView,
  MilestoneGraphView,
  MilestoneNodeView,
  MilestoneRefView,
  MilestoneState,
  PriorityView,
  ProgressView,
  RelatedView,
  TileView,
  WaitingView,
  WorkstreamsView,
  WorkstreamView,
  WorkstreamWorkspace,
} from "./workstreamTilesViews";

/** The one schema version this reader takes. */
export const WORKSTREAMS_SCHEMA_VERSION = 2;

/**
 * The register's channel names: every value a string, else the whole map will not read.
 *
 * @param meta the register document
 * @returns the names by conversation id, or `undefined`
 */
function channelsOf({ meta }: { meta: Bag }): ReadonlyMap<string, string> | undefined {
  const raw = sub({ bag: meta, key: "channels" });
  if (raw === undefined) {
    return undefined;
  }
  const out = new Map<string, string>();
  for (const [id, name] of Object.entries(raw)) {
    if (typeof name !== "string") {
      return undefined;
    }
    out.set(id, name);
  }
  return out;
}

/** What the register document gives the page. */
type MetaRead = Pick<WorkstreamsView, "channels" | "grouping" | "initiatives">;

/**
 * The register document. A register with no document written yet names no channel, no grouping and no initiative,
 * which is what it says rather than a default standing in for one.
 *
 * @returns what it gives the page, or `undefined` when it is present and will not read
 */
function metaOf({ payload }: { payload: Bag }): MetaRead | undefined {
  if (payload["meta"] === null) {
    return { channels: new Map(), grouping: null, initiatives: [] };
  }
  const meta = sub({ bag: payload, key: "meta" });
  if (meta === undefined) {
    return undefined;
  }
  const channels = channelsOf({ meta });
  const rawGrouping = sub({ bag: meta, key: "grouping" });
  const initiatives = everyRow({
    read: (row) => {
      const id = str({ bag: row, key: "id" });
      const name = str({ bag: row, key: "name" });
      return id === undefined || name === undefined ? undefined : { id, name };
    },
    rows: bags({ bag: meta, key: "initiatives" }),
  });
  if (channels === undefined || rawGrouping === undefined || initiatives === undefined) {
    return undefined;
  }
  const label = str({ bag: rawGrouping, key: "label" });
  const why = str({ bag: rawGrouping, key: "why" });
  const builtFrom = str({ bag: rawGrouping, key: "builtFrom" });
  const anchor = str({ bag: rawGrouping, key: "anchor" });
  if (label === undefined || why === undefined || builtFrom === undefined || anchor === undefined) {
    return undefined;
  }
  const grouping: GroupingView = { anchor, builtFrom, label, why };
  return { channels, grouping, initiatives };
}

/** What reading one workstream came to: a view, a kind this page does not draw, or a row that will not read. */
type RowOutcome = { readonly view: WorkstreamView } | "unknown-kind" | undefined;

/**
 * One workstream of a kind this page draws, read off its row, its `detail` and its `derived`.
 *
 * @returns the view, or `undefined` for a row that will not read
 */
function viewOf({ kind, parts }: { kind: WorkstreamView["kind"]; parts: RowParts }): WorkstreamView | undefined {
  switch (kind) {
    case "outcome":
    case "standing":
      return tileOf({ kind, parts });
    case "linked":
      return linkedOf({ parts });
    case "local":
      return localOf({ parts });
    case "closing":
      return closingOf({ parts });
    default: {
      const unhandled: never = kind;
      return unhandled;
    }
  }
}

/** The kinds this page draws. */
const KINDS: readonly WorkstreamView["kind"][] = ["outcome", "standing", "linked", "local", "closing"];

/**
 * One workstream of any kind.
 *
 * @returns the view, `"unknown-kind"`, or `undefined` for a known kind that will not read
 */
function workstreamOf({ row }: { row: Bag }): RowOutcome {
  const raw = str({ bag: row, key: "kind" });
  const kind = KINDS.find((one) => one === raw);
  if (kind === undefined) {
    return "unknown-kind";
  }
  const detail = sub({ bag: row, key: "detail" });
  const derived = sub({ bag: row, key: "derived" });
  if (detail === undefined || derived === undefined) {
    return undefined;
  }
  const view = viewOf({ kind, parts: { derived, detail, row } });
  return view === undefined ? undefined : { view };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/**
 * A date the way a dot shows it: `YYYY-MM-DD` → `D Mon`. The full date stays on the dot's title.
 *
 * @param date a `YYYY-MM-DD` date, as the register's schema requires
 * @returns the short form, or the input unchanged when it is not that shape
 */
export function shortDate({ date }: { date: string }): string {
  const match = /^\d{4}-(\d{2})-(\d{2})$/u.exec(date);
  if (match === null) {
    return date;
  }
  const monthIndex = Number(match[1]) - 1;
  if (monthIndex < 0 || monthIndex >= MONTHS.length) {
    return date;
  }
  return `${String(Number(match[2]))} ${MONTHS[monthIndex]}`;
}

/**
 * How a workstream ended, whatever its kind: a page-only entry is the means rather than an outcome, so never ends.
 *
 * @returns the ending, or `null` while it is live
 */
export function endingOf({ one }: { one: WorkstreamView }): EndingView | null {
  if (one.kind === "local") {
    return null;
  }
  return one.ending;
}

/**
 * An ending in the words a card says it in: `Abandoned <short date>: <the owner's reason>`.
 *
 * @returns the line
 */
export function endingLine({ ending }: { ending: EndingView }): string {
  return `Abandoned ${shortDate({ date: ending.on })}: ${ending.reason}`;
}

/**
 * When a closing entry closed, in the words a card says it in: `closed <short date>`, or that the day was never recorded.
 *
 * @param closedOn the `YYYY-MM-DD` day it closed, or `null` when none is recorded
 * @returns the words
 */
export function closedWords({ closedOn }: { closedOn: string | null }): string {
  if (closedOn === null) {
    return "closed date not recorded";
  }
  return `closed ${shortDate({ date: closedOn })}`;
}

/**
 * A workstream's own milestones as a share done: what a tile's meter fills to, never a generic phase.
 *
 * @returns the share, 0 to 1
 */
export function doneShare({ progress }: { progress: ProgressView }): number {
  if (progress.totalCount === 0) {
    return 0;
  }
  return progress.doneCount / progress.totalCount;
}

/** What each link kind is called on its chip. */
const LINK_KIND_WORDS: Readonly<Record<LinkKind, string>> = {
  alignment_card: "Alignment card",
  automation: "Automation",
  linear_project: "Linear project",
  pull_request: "Pull request",
  queue_card: "Queue card",
};

/**
 * A link's chip words: what it points at and its canonical target, `Pull request acme/app#<number>`.
 *
 * @returns the words
 */
export function linkChipText({ link }: { link: LinkView }): string {
  return `${LINK_KIND_WORDS[link.kind]} ${link.target}`;
}

/**
 * A link chip's hover words: why it is linked, and which of the workstream's own milestones it serves —
 * `the first batch · for First batch`.
 *
 * @param milestones the workstream's own milestones, to name the one the link serves
 * @returns the words, or `undefined` when there is nothing to say beyond the chip
 */
export function linkChipTitle({
  link,
  milestones,
}: {
  link: LinkView;
  milestones: readonly MilestoneNodeView[];
}): string | undefined {
  const parts: string[] = [];
  if (link.label !== null) {
    parts.push(link.label);
  }
  const served = milestones.find((one) => one.id === link.milestoneId);
  if (served !== undefined) {
    parts.push(`for ${served.name}`);
  }
  if (parts.length === 0) {
    return undefined;
  }
  return parts.join(" · ");
}

/**
 * One lane.
 *
 * @returns the lane, or `undefined`
 */
function laneViewOf({ row }: { row: Bag }): LaneView | undefined {
  const id = str({ bag: row, key: "id" });
  const label = str({ bag: row, key: "label" });
  const rule = str({ bag: row, key: "rule" });
  const atRisk = bool({ bag: row, key: "atRisk" });
  if (id === undefined || label === undefined || rule === undefined || atRisk === undefined) {
    return undefined;
  }
  return { atRisk, id, label, rule };
}

/**
 * Whether a workstream's lane, and its priority's level when it has one, are among the values the document itself
 * declares. A lane the page has no entry for would draw as a chip carrying its bare id, counted by no hero number
 * and selected by no filter, so the document is refused rather than drawn with one.
 *
 * @returns true when both are declared
 */
function declared({
  view,
  lanes,
  priorities,
}: {
  view: WorkstreamView;
  lanes: readonly LaneView[];
  priorities: readonly string[];
}): boolean {
  if (!lanes.some((lane) => lane.id === view.lane)) {
    return false;
  }
  if (view.kind === "local" || view.kind === "closing" || view.priority === null) {
    return true;
  }
  return priorities.includes(view.priority.level);
}

/**
 * Read the verb's document into the page's view.
 *
 * @param payload the parsed `workstreams list --json` document
 * @returns the view, or `undefined` when the document will not read as one — any schema version but 2 included
 */
export function readWorkstreamTiles({ payload }: { payload: unknown }): WorkstreamsView | undefined {
  if (!isBag(payload) || num({ bag: payload, key: "schemaVersion" }) !== WORKSTREAMS_SCHEMA_VERSION) {
    return undefined;
  }
  const meta = metaOf({ payload });
  const baseline = str({ bag: payload, key: "baseline" });
  const priorities = strings({ bag: payload, key: "priorities" });
  const lanes = everyRow({ read: (row) => laneViewOf({ row }), rows: bags({ bag: payload, key: "lanes" }) });
  const rows = bags({ bag: payload, key: "workstreams" });
  if (
    meta === undefined ||
    baseline === undefined ||
    priorities === undefined ||
    lanes === undefined ||
    rows === undefined
  ) {
    return undefined;
  }
  const workstreams: WorkstreamView[] = [];
  let skipped = 0;
  for (const row of rows) {
    const outcome = workstreamOf({ row });
    if (outcome === undefined) {
      return undefined;
    }
    if (outcome === "unknown-kind") {
      skipped += 1;
      continue;
    }
    if (!declared({ lanes, priorities, view: outcome.view })) {
      return undefined;
    }
    workstreams.push(outcome.view);
  }
  return { ...meta, lanes, priorities, skipped, workstreams };
}
