/**
 * The one text a supervisor reads to decide who should hand over — depth, spend and the economics together.
 *
 * ## Why one command rather than three
 *
 * The owner's ruling: _"I want it to just be one command that returns all the text that's
 * needed for a good decision."_ Before this, a supervisor could learn how DEEP a session was (`session
 * depth`) and, separately, how many tokens the console said it had spent — and neither number was weighted,
 * so a Fable session and a Sonnet session with the same token count looked identical while differing by
 * more than 6x in what they actually drew down.
 *
 * ## Why it recommends nothing
 *
 * It says `review`, never `respawn`. MEASURED: a restart saves roughly $0.37 of notional spend
 * per remaining turn at 800k against 150k, and costs a pickup — so it repays only once more than about a
 * THIRD of the pickup's own turn count still lies ahead. At 600k, 41 of the 62 sessions that crossed were
 * past that line and 21 were not. A verdict that read `respawn` would therefore be wrong about a third of
 * the time, on a fact — how much work is LEFT — that no gauge can see and a supervisor can.
 *
 * So the report hands over the arithmetic and the evidence, and the judgement stays where the same ruling
 * put it: _"gut tells me purely supervisor should be the one who probably looks at session depth and token
 * spend."_
 *
 * Pure: rows in, lines out. Every effectful read lives in `cli/commands/session/depth.ts`.
 */
import type { Measured } from "../measurement/status.js";
import type { SessionDepthRow } from "./depthReport.js";
import {
  CLAUDE_MODEL_WEIGHT_CARD,
  type ModelWeightCard,
  type ModelWeightedUsage,
  modelWeightedUsage,
} from "./modelWeight.js";
import { compactTokens, type ModelUsageTotals, type UsageTotals, ZERO_USAGE } from "./sessionCost.js";

/** The whole fleet's spend, folded across every row whose transcript could be read. */
export interface SessionDepthSummary {
  readonly measuredSessions: number;
  readonly totalSessions: number;
  readonly totals: UsageTotals;
  readonly byModel: readonly ModelUsageTotals[];
  readonly weighted: Measured<ModelWeightedUsage>;
  readonly unreadableUsageLines: number;
}

/**
 * The restart arithmetic, carried as data so the line a reader sees and the numbers behind it cannot drift.
 *
 * MEASURED over 822 transcripts touched recently, deduplicated by `message.id`. Reproduce
 * the bands and the per-turn figures with `slopweaver session depth --json`.
 */
export interface DepthEconomicsEvidence {
  /** Notional spend per 1,000 turns at each depth band, in US dollars at list prices. */
  readonly dollarsPerThousandTurnsShallow: number;
  readonly dollarsPerThousandTurnsDeep: number;
  /** The fraction of a pickup's own turn count beyond which a restart repays. */
  readonly breakEvenFractionOfPickup: number;
  /** How many of the sessions that crossed 600k had enough work left for a restart to repay. */
  readonly pastBreakEvenAtSixHundred: number;
  readonly crossedSixHundred: number;
}

/** The measurement that decides what the report says about restarting. */
export const DEPTH_ECONOMICS_EVIDENCE: DepthEconomicsEvidence = {
  breakEvenFractionOfPickup: 1 / 3,
  crossedSixHundred: 62,
  dollarsPerThousandTurnsDeep: 500,
  dollarsPerThousandTurnsShallow: 128,
  pastBreakEvenAtSixHundred: 41,
};

/** Fold two totals together. */
function addTotals({ left, right }: { left: UsageTotals; right: UsageTotals }): UsageTotals {
  return {
    cacheCreationTokens: left.cacheCreationTokens + right.cacheCreationTokens,
    cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    turns: left.turns + right.turns,
  };
}

/** The fleet's totals so far for one model, zero before that model's first row. */
function foldedFor({ byModel, model }: { byModel: ReadonlyMap<string, UsageTotals>; model: string }): UsageTotals {
  const folded = byModel.get(model);
  if (folded === undefined) {
    return ZERO_USAGE;
  }
  return folded;
}

/**
 * Fold every row's usage into one fleet figure.
 *
 * A row whose transcript could not be folded is counted in `totalSessions` and absent from everything else,
 * so `measuredSessions` against `totalSessions` says how much of the fleet the number speaks for.
 *
 * @param rows the rows to summarise
 * @returns the fleet summary
 */
export function summarizeSessionDepth({ rows }: { rows: readonly SessionDepthRow[] }): SessionDepthSummary {
  const byModel = new Map<string, UsageTotals>();
  let totals = ZERO_USAGE;
  let measuredSessions = 0;
  let unreadableUsageLines = 0;
  for (const row of rows) {
    if (!row.usage.known) {
      continue;
    }
    measuredSessions += 1;
    totals = addTotals({ left: totals, right: row.usage.value.totals });
    unreadableUsageLines += row.usage.value.unreadable;
    for (const entry of row.usage.value.byModel) {
      byModel.set(entry.model, addTotals({ left: foldedFor({ byModel, model: entry.model }), right: entry.totals }));
    }
  }
  const split = [...byModel.entries()]
    .map(([model, modelTotals]) => ({ model, totals: modelTotals }))
    .toSorted((left, right) => left.model.localeCompare(right.model));
  return {
    byModel: split,
    measuredSessions,
    totals,
    totalSessions: rows.length,
    unreadableUsageLines,
    weighted: modelWeightedUsage({ usage: split }),
  };
}

/** Everything one `session depth` call resolved, as one document. */
export interface SupervisorUsageReport {
  readonly observedAtIso: string;
  readonly thresholdTokens: number;
  readonly rateCard: Pick<ModelWeightCard, "id" | "asOf" | "basis">;
  readonly rows: readonly SessionDepthRow[];
  readonly summary: SessionDepthSummary;
  readonly economics: DepthEconomicsEvidence;
}

/**
 * Assemble the report.
 *
 * @param observedAtIso when the underlying reads were taken — a gauge is only as good as its own timestamp
 * @param thresholdTokens the review line the rows were judged against
 * @param rows the joined session rows
 * @param card the ratios in force (defaults to {@link CLAUDE_MODEL_WEIGHT_CARD})
 * @returns the report
 */
export function supervisorUsageReport({
  observedAtIso,
  thresholdTokens,
  rows,
  card = CLAUDE_MODEL_WEIGHT_CARD,
}: {
  observedAtIso: string;
  thresholdTokens: number;
  rows: readonly SessionDepthRow[];
  card?: ModelWeightCard;
}): SupervisorUsageReport {
  return {
    economics: DEPTH_ECONOMICS_EVIDENCE,
    observedAtIso,
    rateCard: { asOf: card.asOf, basis: card.basis, id: card.id },
    rows,
    summary: summarizeSessionDepth({ rows }),
    thresholdTokens,
  };
}

/** Index units rendered compactly, always labelled, never with a currency sign. */
function renderUnits({ units }: { units: number }): string {
  return `${compactTokens({ count: Math.round(units) })}u`;
}

/** One row's spend fragment, or why there is none. */
function usageFragment({ row }: { row: SessionDepthRow }): string {
  if (!row.usage.known) {
    return `spend NOT MEASURED — ${row.usage.why}`;
  }
  const { totals, weighted } = row.usage.value;
  if (!weighted.known) {
    return `${String(totals.turns)} turns, weighting NOT MEASURED — ${weighted.why}`;
  }
  const coverage =
    weighted.value.coveredTurns === weighted.value.totalTurns
      ? ""
      : ` (${String(weighted.value.coveredTurns)}/${String(weighted.value.totalTurns)} turns priced)`;
  return `${String(totals.turns)} turns, ${renderUnits({ units: weighted.value.units })}${coverage}`;
}

/**
 * The fleet's model mix, biggest contributor first — the line that shows a small share of turns taking a
 * large share of the draw.
 *
 * @param summary the fleet summary
 * @returns one line per family, or a single line saying nothing could be weighted
 */
function mixLines({ summary }: { summary: SessionDepthSummary }): readonly string[] {
  if (!summary.weighted.known) {
    return [`  model mix NOT MEASURED — ${summary.weighted.why}`];
  }
  const total = summary.weighted.value.units;
  return summary.weighted.value.byFamily.map((entry) => {
    const share = total === 0 ? 0 : (100 * entry.units) / total;
    const turnShare = summary.totals.turns === 0 ? 0 : (100 * entry.totals.turns) / summary.totals.turns;
    return (
      `  ${entry.family.padEnd(10)} ${renderUnits({ units: entry.units }).padStart(8)}` +
      `  ${share.toFixed(1).padStart(5)}% of draw   ${turnShare.toFixed(1).padStart(5)}% of turns`
    );
  });
}

/**
 * Render the whole report as the text a supervisor acts on.
 *
 * @param report the assembled report
 * @param renderRow how one session row renders (injected so the row format stays owned by `./depthReport.ts`)
 * @returns the lines, in order
 */
export function renderSupervisorUsageReport({
  report,
  renderRow,
}: {
  report: SupervisorUsageReport;
  renderRow: (input: { row: SessionDepthRow }) => string;
}): readonly string[] {
  const { economics, summary } = report;
  return [
    `sessions ${String(summary.totalSessions)} (${String(summary.measuredSessions)} with a readable transcript) · observed ${report.observedAtIso}`,
    "",
    ...report.rows.map((row) => `${renderRow({ row })}  ${usageFragment({ row })}`),
    "",
    `fleet draw, model-weighted (${report.rateCard.id}, as of ${report.rateCard.asOf}; ${report.rateCard.basis}):`,
    ...mixLines({ summary }),
    "",
    "Index units, NOT dollars: these plans are flat-rate, so nothing here is a bill. The ratios rank sessions",
    "against each other; the absolute number means nothing on its own.",
    "",
    `A row reads \`review\` past ${String(Math.round(report.thresholdTokens / 1000))}k. It never reads \`respawn\`, because whether a restart repays`,
    `depends on how much work is LEFT: it saves about $${String(economics.dollarsPerThousandTurnsDeep - economics.dollarsPerThousandTurnsShallow)} per 1,000 remaining turns and costs a`,
    "pickup, so it pays only once more than about a third of the pickup's own turn count still lies ahead.",
    `MEASURED: of ${String(economics.crossedSixHundred)} sessions that crossed 600k, ${String(economics.pastBreakEvenAtSixHundred)} were past that line and ${String(economics.crossedSixHundred - economics.pastBreakEvenAtSixHundred)} were not.`,
    ...(summary.unreadableUsageLines === 0
      ? []
      : [
          "",
          `${String(summary.unreadableUsageLines)} usage line(s) mentioned usage and could not be read — that spend is missing from the totals above.`,
        ]),
  ];
}
