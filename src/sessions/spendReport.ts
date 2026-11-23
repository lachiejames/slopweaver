/**
 * The token pass's document: where the fleet's draw went over a window of whole UTC days, what each landed
 * change cost, and every drain the pass can PRICE — a saving in index units with the fix that would take it.
 *
 * ## The question it answers, and the one it leaves to `session compaction`
 *
 * The owner's rule is that a token-optimisation pass runs regularly and finds the fifty-percent wins across the
 * fleet — measured by seat kind, model and gate, with the proof a before/after reading of tokens per landed
 * change. Boot floor, re-read rate and the compaction window are `session compaction`'s, recorded weekly by
 * `context-cost-weekly`; this document never recomputes them, so the two readings cannot disagree.
 *
 * The totals are `./spendTally.ts`'s and the drains `./spendDrains.ts`'s, which says why each is a repricing.
 *
 * MEASURED over 1,508 transcripts (6.85B units): the Opus 5 → 5.5 move had already halved the
 * cost of a turn (about 55.7k → 26k units) and of a landed change (about 32M → 12.8M units); the remaining
 * spend was each single-digit percent — the Fable chair (rule 5's, shown by seat, never priced as a drain), Opus
 * subagents, and gate refusals near 1%.
 * Re-measure: `slopweaver session spend --days 7`.
 *
 * Pure: transcripts and landings in, a document and lines out.
 */
import { type Measured, measured, unmeasurable } from "../measurement/status.js";
import {
  CLAUDE_MODEL_WEIGHT_CARD,
  type ClaudeUsageModelFamily,
  familyUnits,
  type ModelWeightCard,
} from "./modelWeight.js";
import { type UsageTotals } from "./sessionCost.js";
import { type Drain, pricedDrains, shareOf } from "./spendDrains.js";
import { type RefusalClass, SEAT_KINDS, type SeatKind, type TranscriptSpend } from "./spendFold.js";
import { familiesOf, type SpendTally, tallySpend, turnsOfModels, unitsOfModels } from "./spendTally.js";

/** Milliseconds in a day, for stepping back whole UTC days from the observation. */
const DAY_MS = 86_400_000;

/** Changes landed on one UTC day, across every repository the pass counted. */
export interface LandedDay {
  readonly day: string;
  readonly landed: number;
}

/**
 * One seat kind's share of the draw.
 *
 * @internal — reachable through {@link SpendReport}; nothing imports it by name.
 */
export interface SeatSpend {
  readonly seat: SeatKind;
  readonly transcripts: number;
  readonly turns: number;
  readonly units: number;
  readonly share: number;
}

/**
 * One model family's share of the draw, and what one of its turns cost on average.
 *
 * @internal — reachable through {@link SpendReport}; nothing imports it by name.
 */
export interface FamilySpend {
  readonly family: ClaudeUsageModelFamily;
  readonly turns: number;
  readonly units: number;
  readonly unitsPerTurn: number;
  readonly share: number;
}

/**
 * One UTC day of the window.
 *
 * @internal — reachable through {@link SpendReport}; nothing imports it by name.
 */
export interface DaySpend {
  readonly day: string;
  readonly units: number;
  readonly turns: number;
  /** Changes landed that day, or `null` when landings could not be counted. */
  readonly landed: number | null;
  /** `units / landed`, or `null` when nothing landed or landings could not be counted — never Infinity. */
  readonly unitsPerLanding: number | null;
}

/**
 * Units per landed change over the whole window.
 *
 * @internal — reachable through {@link SpendReport}; nothing imports it by name.
 */
export interface LandingCost {
  readonly units: number;
  readonly landed: number;
  readonly unitsPerLanding: number;
}

/** The pass's document — recorded in the readings ledger, and compared against by the next pass. */
export interface SpendReport {
  readonly observedAtIso: string;
  readonly days: readonly string[];
  readonly repos: readonly string[];
  readonly rateCard: { readonly id: string; readonly asOf: string };
  readonly transcripts: number;
  readonly turns: number;
  readonly units: number;
  readonly unreadable: number;
  readonly defaultFamily: ClaudeUsageModelFamily | null;
  readonly landingCost: Measured<LandingCost>;
  readonly bySeat: readonly SeatSpend[];
  readonly byFamily: readonly FamilySpend[];
  readonly byDay: readonly DaySpend[];
  readonly refusals: Readonly<Record<RefusalClass, number>>;
  readonly drains: readonly Drain[];
}

/**
 * The window: the `days` whole UTC days before the one the pass is observed on.
 *
 * Today is left out on purpose — a partial day would make every reading depend on the hour it ran at.
 *
 * @param observedAtIso when the pass ran
 * @param days how many whole days back it reaches
 * @returns the `YYYY-MM-DD` days, oldest first
 */
export function windowDays({ observedAtIso, days }: { observedAtIso: string; days: number }): readonly string[] {
  const todayMs = Date.parse(`${observedAtIso.slice(0, 10)}T00:00:00.000Z`);
  return Array.from({ length: days }, (_, index) =>
    new Date(todayMs - (days - index) * DAY_MS).toISOString().slice(0, 10),
  );
}

/** The family that served the most turns — what "the rest of the fleet runs". */
function defaultFamilyOf({
  families,
}: {
  families: ReadonlyMap<ClaudeUsageModelFamily, UsageTotals>;
}): ClaudeUsageModelFamily | null {
  const ranked = [...families.entries()].toSorted((left, right) => right[1].turns - left[1].turns);
  const first = ranked[0];
  if (first === undefined) {
    return null;
  }
  return first[0];
}

/**
 * Changes landed on one day, or `null` when landings could not be counted at all.
 *
 * A day the count left out is a measured zero: the counter asks once per day of the window, so a missing day
 * means GitHub answered none for it.
 */
function landedOn({ day, landings }: { day: string; landings: Measured<readonly LandedDay[]> }): number | null {
  if (!landings.known) {
    return null;
  }
  const found = landings.value.find((entry) => entry.day === day);
  if (found === undefined) {
    return 0;
  }
  return found.landed;
}

/** Every day of the window, with what landed on it. */
function byDayOf({
  tally,
  days,
  landings,
  card,
}: {
  tally: SpendTally;
  days: readonly string[];
  landings: Measured<readonly LandedDay[]>;
  card: ModelWeightCard;
}): readonly DaySpend[] {
  return days.map((day): DaySpend => {
    const dayModels = tally.byDay.get(day)!;
    const units = unitsOfModels({ byModel: dayModels, card });
    const landed = landedOn({ day, landings });
    const unitsPerLanding = landed === null || landed === 0 ? null : units / landed;
    return { day, landed, turns: turnsOfModels({ byModel: dayModels }), units, unitsPerLanding };
  });
}

/** Every family's share of the draw, biggest first. */
function byFamilyOf({
  families,
  total,
  card,
}: {
  families: ReadonlyMap<ClaudeUsageModelFamily, UsageTotals>;
  total: number;
  card: ModelWeightCard;
}): readonly FamilySpend[] {
  return [...families.entries()]
    .map(([family, totals]): FamilySpend => {
      const units = familyUnits({ card, family, totals });
      const unitsPerTurn = totals.turns === 0 ? 0 : units / totals.turns;
      return { family, share: shareOf({ total, units }), turns: totals.turns, units, unitsPerTurn };
    })
    .toSorted((left, right) => right.units - left.units);
}

/** Every seat kind's share of the draw, biggest first. */
function bySeatOf({
  tally,
  total,
  card,
}: {
  tally: SpendTally;
  total: number;
  card: ModelWeightCard;
}): readonly SeatSpend[] {
  return SEAT_KINDS.flatMap((seat): readonly SeatSpend[] => {
    const found = tally.bySeat.get(seat);
    if (found === undefined) {
      return [];
    }
    const units = unitsOfModels({ byModel: found.byModel, card });
    const turns = turnsOfModels({ byModel: found.byModel });
    return [{ seat, share: shareOf({ total, units }), transcripts: found.transcripts, turns, units }];
  }).toSorted((left, right) => right.units - left.units);
}

/** Units per landed change over the window, or why it has no value. */
function landingCostOf({
  landings,
  byDay,
  units,
}: {
  landings: Measured<readonly LandedDay[]>;
  byDay: readonly DaySpend[];
  units: number;
}): Measured<LandingCost> {
  if (!landings.known) {
    return unmeasurable({ why: `landings could not be counted: ${landings.why}` });
  }
  const landed = byDay.reduce((sum, day) => (day.landed === null ? sum : sum + day.landed), 0);
  if (landed === 0) {
    return unmeasurable({ why: "nothing landed in the window, so a change has no cost to divide" });
  }
  return measured({ value: { landed, units, unitsPerLanding: units / landed } });
}

/**
 * Assemble the document.
 *
 * @param transcripts every transcript the walk folded
 * @param landings changes landed per UTC day, or why they could not be counted
 * @param days the window, from {@link windowDays}
 * @param repos the repositories whose landings were counted, named in the document
 * @param observedAtIso when the pass ran
 * @param card the ratios in force (defaults to {@link CLAUDE_MODEL_WEIGHT_CARD})
 * @returns the document
 */
export function spendReport({
  transcripts,
  landings,
  days,
  repos,
  observedAtIso,
  card = CLAUDE_MODEL_WEIGHT_CARD,
}: {
  transcripts: readonly TranscriptSpend[];
  landings: Measured<readonly LandedDay[]>;
  days: readonly string[];
  repos: readonly string[];
  observedAtIso: string;
  card?: ModelWeightCard;
}): SpendReport {
  const tally = tallySpend({ days, transcripts });
  const units = unitsOfModels({ byModel: tally.fleet, card });
  const turns = turnsOfModels({ byModel: tally.fleet });
  const families = familiesOf({ byModel: tally.fleet });
  const defaultFamily = defaultFamilyOf({ families });
  const byDay = byDayOf({ card, days, landings, tally });
  return {
    byDay,
    byFamily: byFamilyOf({ card, families, total: units }),
    bySeat: bySeatOf({ card, tally, total: units }),
    days,
    defaultFamily,
    drains: pricedDrains({ card, defaultFamily, tally, turns, units }),
    landingCost: landingCostOf({ byDay, landings, units }),
    observedAtIso,
    rateCard: { asOf: card.asOf, id: card.id },
    refusals: tally.refusals,
    repos,
    transcripts: tally.transcripts,
    turns,
    units,
    unreadable: tally.unreadable,
  };
}
