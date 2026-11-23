/**
 * The token pass's running totals: every folded transcript's in-window usage, added into the per-model maps the
 * document and its drains are priced from.
 *
 * One transcript contributes to the whole fleet, to its seat kind, to its UTC day, and to the seat or the
 * subagent split the model and subagent drains reprice — except the chair, whose model rule 5 row 1 already
 * settles, so it joins neither split. A subagent also contributes its opening, the
 * smallest context any of its turns re-read, which is what the fork drain prices.
 *
 * Pure: folded transcripts in, totals out. `./spendReport.ts` assembles the document from them.
 */
import {
  type ClaudeUsageModelFamily,
  claudeUsageModelFamily,
  type ModelWeightCard,
  modelWeightedUsage,
} from "./modelWeight.js";
import { type ModelUsageTotals, sumUsage, type UsageTotals } from "./sessionCost.js";
import { REFUSAL_CLASSES, type RefusalClass, type SeatKind, type TranscriptSpend, zeroRefusals } from "./spendFold.js";

/** Usage keyed by the model that served it. */
type ModelMap = Map<string, UsageTotals>;

/** One subagent transcript's opening and its window turns, on the family that served most of them. */
export interface SubagentOpening {
  readonly floor: number;
  readonly turns: number;
  readonly family: ClaudeUsageModelFamily;
}

/**
 * One seat kind's running totals.
 *
 * @internal — reachable through {@link SpendTally}; nothing imports it by name.
 */
export interface SeatTally {
  transcripts: number;
  readonly byModel: ModelMap;
}

/** Everything the window's transcripts added up to. */
export interface SpendTally {
  readonly fleet: ModelMap;
  /**
   * Seats that are neither subagents nor the chair, which the model drain reprices onto the default family. The
   * chair is out because rule 5 row 1 already settles its model; its draw still counts everywhere else.
   */
  readonly seats: ModelMap;
  readonly subagents: ModelMap;
  readonly byDay: ReadonlyMap<string, ModelMap>;
  readonly bySeat: ReadonlyMap<SeatKind, SeatTally>;
  readonly refusals: Record<RefusalClass, number>;
  readonly openings: readonly SubagentOpening[];
  readonly unreadable: number;
  /** Transcripts with at least one turn in the window. */
  readonly transcripts: number;
}

/** Add one key's totals into a map of totals, the key's first totals standing alone. */
function addInto<Key>({ into, key, totals }: { into: Map<Key, UsageTotals>; key: Key; totals: UsageTotals }): void {
  const before = into.get(key);
  if (before === undefined) {
    into.set(key, totals);
    return;
  }
  into.set(key, sumUsage({ left: before, right: totals }));
}

/**
 * What a per-model map is worth in index units, zero when nothing in it could be weighed.
 *
 * @param byModel the usage, keyed by model
 * @param card the ratios in force
 * @returns the weighted units
 */
export function unitsOfModels({
  byModel,
  card,
}: {
  byModel: ReadonlyMap<string, UsageTotals>;
  card: ModelWeightCard;
}): number {
  const split: readonly ModelUsageTotals[] = [...byModel.entries()]
    .filter(([model]) => model !== "")
    .map(([model, totals]) => ({ model, totals }));
  const weighted = modelWeightedUsage({ card, usage: split });
  if (!weighted.known) {
    return 0;
  }
  return weighted.value.units;
}

/**
 * How many turns a per-model map holds.
 *
 * @param byModel the usage, keyed by model
 * @returns the turn count
 */
export function turnsOfModels({ byModel }: { byModel: ReadonlyMap<string, UsageTotals> }): number {
  return [...byModel.values()].reduce((sum, totals) => sum + totals.turns, 0);
}

/**
 * Per-family totals of a per-model map. Models the card does not name are left out, as the weighting does.
 *
 * @param byModel the usage, keyed by model
 * @returns the usage, keyed by family
 */
export function familiesOf({
  byModel,
}: {
  byModel: ReadonlyMap<string, UsageTotals>;
}): ReadonlyMap<ClaudeUsageModelFamily, UsageTotals> {
  const families = new Map<ClaudeUsageModelFamily, UsageTotals>();
  for (const [model, totals] of byModel) {
    const family = claudeUsageModelFamily({ model });
    if (family !== undefined) {
      addInto({ into: families, key: family, totals });
    }
  }
  return families;
}

/** The family that served most of a transcript's window turns, `undefined` when the card names none of them. */
function dominantFamily({ usage }: { usage: TranscriptSpend["usage"] }): ClaudeUsageModelFamily | undefined {
  const ranked = usage.toSorted((left, right) => right.totals.turns - left.totals.turns);
  for (const entry of ranked) {
    const family = claudeUsageModelFamily({ model: entry.model });
    if (family !== undefined) {
      return family;
    }
  }
  return undefined;
}

/** One seat kind's running entry, created on its first transcript. */
function seatEntry({ seat, bySeat }: { seat: SeatKind; bySeat: Map<SeatKind, SeatTally> }): SeatTally {
  const found = bySeat.get(seat);
  if (found !== undefined) {
    return found;
  }
  const created: SeatTally = { byModel: new Map(), transcripts: 0 };
  bySeat.set(seat, created);
  return created;
}

/** The subagent's opening, when it is a subagent whose opening and family are both known. */
function openingOf({
  transcript,
  usage,
}: {
  transcript: TranscriptSpend;
  usage: TranscriptSpend["usage"];
}): SubagentOpening | undefined {
  const family = dominantFamily({ usage });
  if (transcript.seat !== "subagent" || transcript.contextFloor === null || family === undefined) {
    return undefined;
  }
  return { family, floor: transcript.contextFloor, turns: usage.reduce((sum, entry) => sum + entry.totals.turns, 0) };
}

/** A tally while it is being added to. */
interface OpenTally {
  readonly fleet: ModelMap;
  readonly seats: ModelMap;
  readonly subagents: ModelMap;
  readonly byDay: Map<string, ModelMap>;
  readonly bySeat: Map<SeatKind, SeatTally>;
  readonly refusals: Record<RefusalClass, number>;
  readonly openings: SubagentOpening[];
  unreadable: number;
  transcripts: number;
}

/** Add one transcript's in-window usage, refusals and opening into the tally. */
function addTranscript({
  tally,
  transcript,
  usage,
}: {
  tally: OpenTally;
  transcript: TranscriptSpend;
  usage: TranscriptSpend["usage"];
}): void {
  tally.transcripts += 1;
  REFUSAL_CLASSES.forEach((refusal) => {
    tally.refusals[refusal] += transcript.refusals[refusal];
  });
  const opening = openingOf({ transcript, usage });
  if (opening !== undefined) {
    tally.openings.push(opening);
  }
  const seat = seatEntry({ bySeat: tally.bySeat, seat: transcript.seat });
  seat.transcripts += 1;
  const split = repricingSplit({ tally, seat: transcript.seat });
  for (const entry of usage) {
    [tally.fleet, ...split, seat.byModel, tally.byDay.get(entry.day)!].forEach((into) => {
      addInto({ into, key: entry.model, totals: entry.totals });
    });
  }
}

/**
 * The repricing map a seat kind's usage joins: a subagent's own, none for the chair — rule 5 row 1 settles the
 * chair's model as the owner's choice, so it is never a candidate to move — and the seat map for every other kind.
 */
function repricingSplit({ tally, seat }: { tally: OpenTally; seat: SeatKind }): readonly ModelMap[] {
  if (seat === "subagent") {
    return [tally.subagents];
  }
  if (seat === "chair") {
    return [];
  }
  return [tally.seats];
}

/**
 * Add up every transcript's usage inside the window.
 *
 * @param transcripts every transcript the walk folded
 * @param days the window's UTC days
 * @returns the totals
 */
export function tallySpend({
  transcripts,
  days,
}: {
  transcripts: readonly TranscriptSpend[];
  days: readonly string[];
}): SpendTally {
  const inWindow = new Set(days);
  const tally: OpenTally = {
    byDay: new Map(days.map((day) => [day, new Map()])),
    bySeat: new Map(),
    fleet: new Map(),
    openings: [],
    refusals: zeroRefusals(),
    seats: new Map(),
    subagents: new Map(),
    transcripts: 0,
    unreadable: 0,
  };
  for (const transcript of transcripts) {
    tally.unreadable += transcript.unreadable;
    const usage = transcript.usage.filter((entry) => inWindow.has(entry.day));
    if (usage.length > 0) {
      addTranscript({ tally, transcript, usage });
    }
  }
  return tally;
}
