/**
 * The weekly value sample: five asks settled in the last week, drawn at random, each with what it cost and what it
 * produced, so the owner can say whether each one was used. Pure: every read is supplied, never performed.
 *
 * ## Why five at random, and why only settled asks
 *
 * The question is whether the fleet's work gets used, and nothing measures that but the owner's answer. Asking about
 * every ask costs more attention than the answer is worth; five drawn at random each week is a sample the owner can
 * answer in a minute and that no session can choose to flatter. Only an ask that ENDED is drawn — `filed` (it became
 * work) or `answered` (it was answered on the spot) — because an open one has produced nothing to be used yet, and a
 * `declined` one was never going to be.
 *
 * ## The draw is seeded by the week
 *
 * Each ask is ranked by the SHA-256 of its week and slug, so the same week over the same board draws the same five:
 * a retry of the Monday firing shows the same sample rather than a new one, even before the store's own reuse
 * (`./store.ts`) is reached, and no session can re-roll a week it does not like.
 *
 * ## Cost is joined by the seat's working directory, and says when it cannot be
 *
 * A seat's transcripts carry the working directory it ran in, and the session ledger's `spawned` row carries the
 * slug that seat was for and that same directory. So an ask's cost is every transcript whose directory is one its
 * own seat, or the doc it was filed as, ran in, weighted by model (`../sessions/modelWeight.ts`). An ask the chair
 * answered itself had no seat of its own, so its cost is NOT MEASURED with that reason, never a zero.
 */
import { createHash } from "node:crypto";

import { type Measured, measured, unmeasurable } from "../measurement/status.js";
import { modelWeightedUsage } from "../sessions/modelWeight.js";
import type { TranscriptSpend } from "../sessions/spendFold.js";

/** How many asks one week's sample draws. */
export const SAMPLE_SIZE = 5;

/** How many days back an ask's settle may lie and still be drawn. */
const SAMPLE_WINDOW_DAYS = 7;

/** Milliseconds in a day. */
const DAY_MS = 86_400_000;

/** How a drawn ask ended: the two settlements that produced something. */
type DrawnSettlement = "filed" | "answered";

/** The board-row fields a sample reads, as `handover list --json` publishes them. */
export interface BoardAskRow {
  readonly slug: string;
  readonly kind: string;
  readonly summary: string | undefined;
  readonly settlement: string | undefined;
  readonly settlementWitness: string | undefined;
  readonly settledIso: string | undefined;
  readonly prUrls: readonly string[];
  readonly artifact: string | undefined;
}

/** One ask that ended in the window, as the sample carries it. */
export interface SettledAsk {
  readonly slug: string;
  /** The row's summary, or its slug when it carries none. */
  readonly summary: string;
  readonly settlement: DrawnSettlement;
  /** The doc slug a `filed` ask became, or the permalink an `answered` one was answered at. */
  readonly witness: string | undefined;
  readonly settledIso: string;
  readonly prUrls: readonly string[];
  readonly artifact: string | undefined;
}

/** A seat the session ledger recorded: which slug it was spawned for, and the directory it ran in. */
export interface SeatSpawn {
  readonly slug: string;
  readonly cwd: string;
}

/** What one ask cost, in model-weighted units, over how many transcripts. */
export interface AskSpend {
  readonly units: number;
  readonly transcripts: number;
  /** Turns a recognised model served, of all turns counted — the coverage the units stand on. */
  readonly coveredTurns: number;
  readonly totalTurns: number;
}

/** One pull request an ask names, and how it ended when that could be read. */
export interface PrOutcome {
  readonly url: string;
  readonly state: "OPEN" | "MERGED" | "CLOSED" | "UNREAD";
}

/** One drawn ask with its cost and outcome. */
export interface SampledAsk extends SettledAsk {
  readonly cost: Measured<AskSpend>;
  readonly prs: readonly PrOutcome[];
}

/** Narrow a raw settlement to one a sample draws. */
function drawnSettlement({ value }: { value: string | undefined }): DrawnSettlement | undefined {
  if (value === "filed" || value === "answered") {
    return value;
  }
  return undefined;
}

/**
 * The asks that ended `filed` or `answered` within {@link SAMPLE_WINDOW_DAYS} of `nowIso`. An undated settle is left
 * out rather than guessed into the window.
 *
 * @param rows the board's rows
 * @param nowIso the instant the window ends at
 * @returns the eligible asks, in board order
 */
export function settledAsksOf({
  rows,
  nowIso,
}: {
  rows: readonly BoardAskRow[];
  nowIso: string;
}): readonly SettledAsk[] {
  const now = Date.parse(nowIso);
  const since = now - SAMPLE_WINDOW_DAYS * DAY_MS;
  return rows.flatMap((row) => {
    const settlement = drawnSettlement({ value: row.settlement });
    if (row.kind !== "ask" || settlement === undefined || row.settledIso === undefined) {
      return [];
    }
    const settled = Date.parse(row.settledIso);
    if (Number.isNaN(settled) || settled < since || settled > now) {
      return [];
    }
    let summary = row.slug;
    if (row.summary !== undefined && row.summary.trim() !== "") {
      summary = row.summary;
    }
    return [
      {
        artifact: row.artifact,
        prUrls: row.prUrls,
        settledIso: row.settledIso,
        settlement,
        slug: row.slug,
        summary,
        witness: row.settlementWitness,
      },
    ];
  });
}

/** An ask's rank in one week's draw: the SHA-256 of the week and slug. */
function rankOf({ slug, week }: { slug: string; week: string }): string {
  return createHash("sha256").update(`${week}\n${slug}`).digest("hex");
}

/**
 * The week's draw: the {@link SAMPLE_SIZE} asks ranking lowest by {@link rankOf}, or every ask when fewer ended.
 *
 * @param asks the eligible asks
 * @param week the ISO week the draw is seeded by
 * @returns the drawn asks, in rank order
 */
export function drawSample({ asks, week }: { asks: readonly SettledAsk[]; week: string }): readonly SettledAsk[] {
  return asks
    .map((ask) => ({ ask, rank: rankOf({ slug: ask.slug, week }) }))
    .toSorted((left, right) => left.rank.localeCompare(right.rank))
    .slice(0, SAMPLE_SIZE)
    .map((entry) => entry.ask);
}

/** Whether a transcript ran in `cwd` or a directory beneath it. */
function ranIn({ cwd, transcript }: { cwd: string; transcript: TranscriptSpend }): boolean {
  return transcript.cwd === cwd || transcript.cwd.startsWith(`${cwd}/`);
}

/**
 * What one ask cost: every transcript run in a directory a seat for it, or for the doc it was filed as, was spawned
 * in, weighted by model.
 *
 * @param ask the drawn ask
 * @param spawns every seat the session ledger recorded
 * @param transcripts the transcripts read for the window
 * @returns the weighted units, or why there are none
 */
export function askCostOf({
  ask,
  spawns,
  transcripts,
}: {
  ask: SettledAsk;
  spawns: readonly SeatSpawn[];
  transcripts: readonly TranscriptSpend[];
}): Measured<AskSpend> {
  const seatSlugs = [ask.slug];
  if (ask.settlement === "filed" && ask.witness !== undefined) {
    seatSlugs.push(ask.witness);
  }
  const cwds = [
    ...new Set(spawns.filter((spawn) => spawn.cwd !== "" && seatSlugs.includes(spawn.slug)).map((spawn) => spawn.cwd)),
  ];
  if (cwds.length === 0) {
    return unmeasurable({ why: "no seat was spawned for it, so no transcript is joined to it" });
  }
  const matched = transcripts.filter((transcript) => cwds.some((cwd) => ranIn({ cwd, transcript })));
  if (matched.length === 0) {
    return unmeasurable({ why: "its seat's transcripts were not among those read for the window" });
  }
  const weighted = modelWeightedUsage({
    usage: matched.flatMap((transcript) => transcript.usage.map(({ model, totals }) => ({ model, totals }))),
  });
  if (!weighted.known) {
    return unmeasurable({ why: weighted.why });
  }
  const { coveredTurns, totalTurns, units } = weighted.value;
  return measured({ value: { coveredTurns, totalTurns, transcripts: matched.length, units } });
}
