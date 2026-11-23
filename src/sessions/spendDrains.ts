/**
 * Every drain the token pass can PRICE: a saving in index units over the window, with the ruling that takes it.
 *
 * ## Why a drain is a REPRICING, not a share
 *
 * "Fable took 8% of the draw" names no win: the question is what the same tokens would have drawn on the model
 * the rest of the fleet runs. So a model drain reprices one family's own token totals, over every seat but the
 * chair (whose model rule 5 row 1 already settles), onto the fleet's default family's weights (`./modelWeight.ts`), and a subagent drain reprices subagent turns onto Sonnet 5, rule 5's
 * model for a mechanical leaf. A cheaper family reprices negative and is never a drain. A fork drain prices a
 * subagent that opened on its parent's conversation: the context above the window's lower-quartile opening,
 * re-read on every one of its turns. A refusal drain prices each gate refusal as one turn at the window's mean.
 * Each is a CANDIDATE: the fix is a ruling, never an edit the verb makes.
 *
 * Pure: a tally in, drains out.
 */
import { type ClaudeUsageModelFamily, familyUnits, type ModelWeightCard } from "./modelWeight.js";
import { compactTokens, type UsageTotals, ZERO_USAGE } from "./sessionCost.js";
import { REFUSAL_CLASSES } from "./spendFold.js";
import { familiesOf, type SpendTally, type SubagentOpening } from "./spendTally.js";

/** The family a subagent drain is repriced onto: rule 5's model for a mechanical leaf. */
const LEAF_FAMILY: ClaudeUsageModelFamily = "sonnet-5";

/**
 * How many times a FRESH subagent's opening — the window's lower-quartile one — a subagent must open on to count
 * as FORKED, carrying its parent's conversation rather than a brief. The quartile, not the median, because forks
 * are subagents too: a week where most of them forked would lift a median to a fork's size and hide the drain
 * exactly when it was biggest. MEASURED over 852 subagent transcripts: median opening 47.3k,
 * p90 53.2k, and 2 at or over 100k; the five forks of one vulnerability-fix seat each opened on 144.6k. Twice a
 * fresh opening sits clear of that p90 and well under a fork. Repro, one opening per transcript:
 * `find ~/.claude/projects -path '*∕subagents∕*.jsonl' -newermt <day> -exec jq -nRc '[inputs | fromjson? |
 * .message.usage? // empty | .input_tokens + .cache_read_input_tokens + .cache_creation_input_tokens] | min'
 * {} \;` (the `∕` stands for `/`, which would close this comment).
 */
const FORK_OPENING_RATIO = 2;

/** A priced candidate: what it would save over the window, and the fix that would take it. */
export interface Drain {
  /** Stable across passes, so the next one can tell a drain it already posted from a new one. */
  readonly key: string;
  readonly savingUnits: number;
  /** The saving as a fraction of the window's whole draw, so windows of different lengths compare. */
  readonly share: number;
  readonly what: string;
  readonly fix: string;
}

/**
 * A fraction of the draw, zero over an empty window.
 *
 * @param units the part
 * @param total the window's whole draw
 * @returns the fraction
 */
export function shareOf({ units, total }: { units: number; total: number }): number {
  if (total === 0) {
    return 0;
  }
  return units / total;
}

/** Index units, compactly, always labelled. */
function unitsLabel({ units }: { units: number }): string {
  return `${compactTokens({ count: Math.round(units) })}u`;
}

/** Every drain a family priced above the one it is compared against. */
function repricedDrains({
  families,
  onto,
  keyPrefix,
  total,
  describe,
  fix,
  card,
}: {
  families: ReadonlyMap<ClaudeUsageModelFamily, UsageTotals>;
  onto: ClaudeUsageModelFamily;
  keyPrefix: string;
  total: number;
  describe: (args: { family: ClaudeUsageModelFamily; turns: number; saving: number }) => string;
  fix: string;
  card: ModelWeightCard;
}): readonly Drain[] {
  return [...families].flatMap(([family, totals]): readonly Drain[] => {
    const saving = familyUnits({ card, family, totals }) - familyUnits({ card, family: onto, totals });
    if (family === onto || saving <= 0) {
      return [];
    }
    const what = describe({ family, saving, turns: totals.turns });
    return [
      { fix, key: `${keyPrefix}:${family}`, savingUnits: saving, share: shareOf({ total, units: saving }), what },
    ];
  });
}

/** The fork drain: subagents that opened on their parent's conversation, priced above a fresh opening. */
function forkDrain({
  openings,
  total,
  card,
}: {
  openings: readonly SubagentOpening[];
  total: number;
  card: ModelWeightCard;
}): readonly Drain[] {
  const floors = openings.map((opening) => opening.floor).toSorted((left, right) => left - right);
  const fresh = floors[Math.floor(floors.length / 4)];
  if (fresh === undefined || fresh === 0) {
    return [];
  }
  const forks = openings.filter((opening) => opening.floor >= FORK_OPENING_RATIO * fresh);
  if (forks.length === 0) {
    return [];
  }
  const saving = forks.reduce(
    (sum, fork) =>
      sum +
      familyUnits({
        card,
        family: fork.family,
        totals: { ...ZERO_USAGE, cacheReadTokens: (fork.floor - fresh) * fork.turns },
      }),
    0,
  );
  const meanOpening = forks.reduce((sum, fork) => sum + fork.floor, 0) / forks.length;
  return [
    {
      fix: "a leaf subagent starts fresh on a written brief, not a fork of the whole conversation",
      key: "forks",
      savingUnits: saving,
      share: shareOf({ total, units: saving }),
      what:
        `${String(forks.length)} subagents opened on about ${compactTokens({ count: Math.round(meanOpening) })} of ` +
        `inherited context against a fresh one's ${compactTokens({ count: fresh })}; re-reading it cost ` +
        unitsLabel({ units: saving }),
    },
  ];
}

/** The refusal drain: each gate refusal priced as one more turn at the window's mean. */
function refusalDrain({
  refusals,
  meanTurn,
  total,
}: {
  refusals: SpendTally["refusals"];
  meanTurn: number;
  total: number;
}): readonly Drain[] {
  const count = REFUSAL_CLASSES.reduce((sum, refusal) => sum + refusals[refusal], 0);
  if (count === 0) {
    return [];
  }
  const classes = REFUSAL_CLASSES.filter((refusal) => refusals[refusal] > 0)
    .map((refusal) => `${refusal} ${String(refusals[refusal])}`)
    .join(", ");
  return [
    {
      fix: "a refusal that names what to use instead, so the retry is right first time (never a weaker gate)",
      key: "refusals",
      savingUnits: count * meanTurn,
      share: shareOf({ total, units: count * meanTurn }),
      what:
        `${String(count)} gate refusals, each a turn re-reading the context at about ` +
        `${unitsLabel({ units: meanTurn })}: ${classes}`,
    },
  ];
}

/**
 * Non-chair seat turns repriced onto the fleet's default family, none when the window has no default. The chair is
 * never priced here: rule 5 row 1 puts it on the model the owner chose, so moving it is no ruling the pass can ask
 * for, and counting it buried any real non-chair seat on a pricier family inside the chair's own number. The key
 * names the population, so a finding posted under the old chair-inclusive key never dedupes a non-chair one.
 */
function modelDrains({
  tally,
  defaultFamily,
  total,
  card,
}: {
  tally: SpendTally;
  defaultFamily: ClaudeUsageModelFamily | null;
  total: number;
  card: ModelWeightCard;
}): readonly Drain[] {
  if (defaultFamily === null) {
    return [];
  }
  return repricedDrains({
    card,
    describe: ({ family, turns, saving }) =>
      `${String(turns)} non-chair seat turns on ${family}; the same tokens on ${defaultFamily} would have drawn ` +
      `${unitsLabel({ units: saving })} less`,
    families: familiesOf({ byModel: tally.seats }),
    fix: `a ruling: rule 5 names each seat's model — moving these non-chair seats to ${defaultFamily}`,
    keyPrefix: "model:non-chair",
    onto: defaultFamily,
    total,
  });
}

/**
 * Every drain the window's tally prices, biggest first.
 *
 * @param tally the window's totals
 * @param units the window's whole draw
 * @param turns the window's whole turn count, for a refusal's price
 * @param defaultFamily the family that served the most turns, the model drains' comparison
 * @param card the ratios in force
 * @returns the drains, biggest saving first
 */
export function pricedDrains({
  tally,
  units,
  turns,
  defaultFamily,
  card,
}: {
  tally: SpendTally;
  units: number;
  turns: number;
  defaultFamily: ClaudeUsageModelFamily | null;
  card: ModelWeightCard;
}): readonly Drain[] {
  const subagentDrains = repricedDrains({
    card,
    describe: ({ family, turns: familyTurns, saving }) =>
      `${String(familyTurns)} subagent turns on ${family}; on ${LEAF_FAMILY} they would have drawn ` +
      `${unitsLabel({ units: saving })} less`,
    families: familiesOf({ byModel: tally.subagents }),
    fix: `a ruling: a subagent that names no model inherits its parent's; rule 5 puts a mechanical leaf on ${LEAF_FAMILY}`,
    keyPrefix: "subagents",
    onto: LEAF_FAMILY,
    total: units,
  });
  return [
    ...modelDrains({ card, defaultFamily, tally, total: units }),
    ...subagentDrains,
    ...forkDrain({ card, openings: tally.openings, total: units }),
    ...refusalDrain({ meanTurn: turns === 0 ? 0 : units / turns, refusals: tally.refusals, total: units }),
  ].toSorted((left, right) => right.savingUnits - left.savingUnits);
}
