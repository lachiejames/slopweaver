/**
 * The four kinds a workstream row reads into — a tile, a linked gauge, a page-only entry and a closing one — off its
 * authored fields, its typed `detail` and what the verb `derived` for it. Split out of `./workstreamTiles.ts`.
 *
 * Each kind is read to the shape `src/workstreams/store/validation.ts` holds it to: a kind that states no status, or
 * carries no milestones, carries `null` there, and a row with a value where its kind holds `null` will not read.
 */

import { type Bag, bags, num, str, strings, sub } from "./bag";
import { everyRow, feedbackOf, milestoneGraphOf, progressOf, strOrNull } from "./workstreamTilesFields";
import {
  endingRead,
  involvedOf,
  placedOf,
  priorityOf,
  queueWorkstreamOf,
  type RowParts,
  waitingOf,
} from "./workstreamTilesPlaced";
import type { ClosingView, LinkedView, LocalView, StoryFields, TileView } from "./workstreamTilesViews";

/**
 * Whether every named field of a bag is `null`: what a kind that carries none of them writes.
 *
 * @returns true when each is `null`
 */
function allNull({ bag, keys }: { bag: Bag; keys: readonly string[] }): boolean {
  return keys.every((key) => bag[key] === null);
}

/** The derived fields a kind with no milestones and no gauge carries as `null`. */
const UNDRIVEN_DERIVED = ["progress", "progressLine", "milestoneGraph", "gauge"] as const;

/**
 * The fields a tile and a linked gauge share: the story its `detail` tells, and its progress against its own
 * milestones.
 *
 * @returns the fields, or `undefined`
 */
function storyOf({ parts }: { parts: RowParts }): StoryFields | undefined {
  const { derived, detail, row } = parts;
  const placed = placedOf({ parts });
  const outcome = str({ bag: row, key: "outcome" });
  const priority = priorityOf({ detail });
  const queueWorkstream = queueWorkstreamOf({ detail });
  const waitingOn = waitingOf({ detail });
  const ending = endingRead({ detail });
  const people = involvedOf({ detail });
  const initiative = strOrNull({ bag: detail, key: "initiative" });
  const numbers = str({ bag: detail, key: "numbers" });
  const skeptic = strOrNull({ bag: detail, key: "skeptic" });
  const tags = strings({ bag: detail, key: "tags" });
  const feedback = everyRow({ read: (one) => feedbackOf({ row: one }), rows: bags({ bag: detail, key: "feedback" }) });
  const milestoneGraph = milestoneGraphOf({ derived });
  const progress = progressOf({ derived });
  const progressLine = str({ bag: derived, key: "progressLine" });
  if (
    placed === undefined ||
    outcome === undefined ||
    priority === undefined ||
    queueWorkstream === undefined ||
    waitingOn === undefined ||
    ending === undefined ||
    people === undefined ||
    initiative === undefined ||
    numbers === undefined ||
    skeptic === undefined ||
    tags === undefined ||
    feedback === undefined ||
    milestoneGraph === undefined ||
    progress === undefined ||
    progressLine === undefined
  ) {
    return undefined;
  }
  return {
    ...placed,
    ending,
    feedback,
    initiative,
    milestoneGraph,
    numbers,
    outcome,
    people,
    priority,
    progress,
    progressLine,
    queueWorkstream: queueWorkstream.value,
    skeptic,
    tags,
    waitingOn,
  };
}

/**
 * An outcome or standing tile: the owner's own, so it states its status.
 *
 * @returns the tile, or `undefined`
 */
export function tileOf({ parts, kind }: { parts: RowParts; kind: "outcome" | "standing" }): TileView | undefined {
  const { derived, detail, row } = parts;
  const story = storyOf({ parts });
  const status = str({ bag: row, key: "status" });
  const agreedBy = str({ bag: detail, key: "agreedBy" });
  const statusNote = str({ bag: detail, key: "statusNote" });
  const team = str({ bag: detail, key: "team" });
  if (
    story === undefined ||
    status === undefined ||
    agreedBy === undefined ||
    statusNote === undefined ||
    team === undefined ||
    derived["gauge"] !== null
  ) {
    return undefined;
  }
  return { ...story, agreedBy, kind, status, statusNote, team };
}

/**
 * A linked gauge: somebody else leads it, so it states no status of the owner's, and its gauge is theirs.
 *
 * @returns the gauge tile, or `undefined`
 */
export function linkedOf({ parts }: { parts: RowParts }): LinkedView | undefined {
  const { derived, detail, row } = parts;
  const story = storyOf({ parts });
  const leads = str({ bag: detail, key: "leads" });
  const yourPart = str({ bag: detail, key: "yourPart" });
  const gauge = sub({ bag: detail, key: "gauge" });
  const reading = sub({ bag: derived, key: "gauge" });
  if (
    story === undefined ||
    leads === undefined ||
    yourPart === undefined ||
    gauge === undefined ||
    reading === undefined ||
    row["status"] !== null
  ) {
    return undefined;
  }
  const asOf = str({ bag: gauge, key: "asOf" });
  const gate = num({ bag: gauge, key: "gate" });
  const gateLabel = str({ bag: gauge, key: "gateLabel" });
  const of = num({ bag: gauge, key: "of" });
  const source = str({ bag: gauge, key: "source" });
  const value = num({ bag: gauge, key: "value" });
  const share = num({ bag: reading, key: "share" });
  const gateShare = num({ bag: reading, key: "gateShare" });
  const short = num({ bag: reading, key: "short" });
  if (
    asOf === undefined ||
    gate === undefined ||
    gateLabel === undefined ||
    of === undefined ||
    source === undefined ||
    value === undefined ||
    share === undefined ||
    gateShare === undefined ||
    short === undefined
  ) {
    return undefined;
  }
  return {
    ...story,
    gauge: { asOf, gate, gateLabel, of, source, value },
    kind: "linked",
    leads,
    reading: { gateShare, share, short },
    yourPart,
  };
}

/**
 * A page-only entry: the means rather than an outcome, so no outcome, no status, no milestones.
 *
 * @returns the view, or `undefined`
 */
export function localOf({ parts }: { parts: RowParts }): LocalView | undefined {
  const { derived, detail, row } = parts;
  const placed = placedOf({ parts });
  const note = str({ bag: detail, key: "note" });
  const undriven = allNull({ bag: derived, keys: UNDRIVEN_DERIVED });
  if (placed === undefined || note === undefined || !undriven || !allNull({ bag: row, keys: ["outcome", "status"] })) {
    return undefined;
  }
  return { ...placed, kind: "local", note };
}

/**
 * A closing entry: where it went, whether it holds, how it ended, and the evidence of the completion.
 *
 * @returns the view, or `undefined`
 */
export function closingOf({ parts }: { parts: RowParts }): ClosingView | undefined {
  const { derived, detail, row } = parts;
  const placed = placedOf({ parts });
  const outcome = strOrNull({ bag: row, key: "outcome" });
  const state = str({ bag: detail, key: "state" });
  const holding = str({ bag: detail, key: "holding" });
  const ending = endingRead({ detail });
  const closedOn = strOrNull({ bag: detail, key: "closedOn" });
  const people = involvedOf({ detail });
  const undriven = allNull({ bag: derived, keys: UNDRIVEN_DERIVED }) && row["status"] === null;
  if (
    placed === undefined ||
    outcome === undefined ||
    state === undefined ||
    holding === undefined ||
    ending === undefined ||
    closedOn === undefined ||
    people === undefined ||
    !undriven
  ) {
    return undefined;
  }
  return { ...placed, closedOn, ending, holding, kind: "closing", outcome, people, state };
}
