/**
 * The token pass as text: the report a seat reads, and the one sentence a board finding carries.
 *
 * Pure: a document and its verdict in, lines out.
 */
import { compactTokens } from "./sessionCost.js";
import { REFUSAL_CLASSES } from "./spendFold.js";
import type { SpendReport } from "./spendReport.js";
import type { SpendSignal } from "./spendSignal.js";

/** Index units, compactly, always labelled — never a currency. */
function units({ value }: { value: number }): string {
  return `${compactTokens({ count: Math.round(value) })}u`;
}

/** A fraction as a percentage, one decimal. */
function percent({ share }: { share: number }): string {
  return `${(100 * share).toFixed(1)}%`;
}

/** The window's headline cost of a landed change. */
function landingLine({ report }: { report: SpendReport }): string {
  if (!report.landingCost.known) {
    return `units per landed change NOT MEASURED — ${report.landingCost.why}`;
  }
  const cost = report.landingCost.value;
  return `${units({ value: cost.unitsPerLanding })} per landed change (${String(cost.landed)} landed, ${units({ value: cost.units })} drawn)`;
}

/**
 * Render the whole report.
 *
 * @param report the document
 * @param signal its verdict against the last reading
 * @returns the lines, in order
 */
export function renderSpendReport({ report, signal }: { report: SpendReport; signal: SpendSignal }): readonly string[] {
  const first = report.days[0];
  const last = report.days.at(-1);
  const span = first === undefined || last === undefined ? "no days" : `${first}..${last} UTC`;
  const refusalCount = REFUSAL_CLASSES.reduce((sum, refusal) => sum + report.refusals[refusal], 0);
  const refusalClasses = REFUSAL_CLASSES.filter((refusal) => report.refusals[refusal] > 0)
    .map((refusal) => `${refusal} ${String(report.refusals[refusal])}`)
    .join(", ");
  return [
    `token pass ${span} · ${String(report.transcripts)} transcripts · ${String(report.turns)} turns · ${units({ value: report.units })} (${report.rateCard.id})`,
    landingLine({ report }),
    `trend: ${signal.trend} — ${signal.because}`,
    "",
    "drains, priced (a saving over the window, and the fix that takes it):",
    ...(report.drains.length === 0
      ? ["  none priced"]
      : report.drains.map(
          (drain) =>
            `  ${percent({ share: drain.share }).padStart(6)}  ${drain.key}: ${drain.what} — fix: ${drain.fix}`,
        )),
    "",
    "by seat:",
    ...report.bySeat.map(
      (seat) =>
        `  ${seat.seat.padEnd(18)} ${percent({ share: seat.share }).padStart(6)}  ${units({ value: seat.units }).padStart(8)}  ${String(seat.transcripts)} transcripts`,
    ),
    "by model:",
    ...report.byFamily.map(
      (family) =>
        `  ${family.family.padEnd(18)} ${percent({ share: family.share }).padStart(6)}  ${units({ value: family.unitsPerTurn })} per turn over ${String(family.turns)} turns`,
    ),
    "by day:",
    ...report.byDay.map(
      (day) =>
        `  ${day.day}  ${units({ value: day.units }).padStart(8)}  landed ${day.landed === null ? "?" : String(day.landed)}  ${day.unitsPerLanding === null ? "" : `${units({ value: day.unitsPerLanding })} each`}`,
    ),
    refusalCount === 0 ? "gate refusals: 0" : `gate refusals: ${String(refusalCount)} (${refusalClasses})`,
    "",
    "Boot floor, re-read rate and the compaction window are `session compaction`'s, not this pass's.",
    ...(report.unreadable === 0
      ? []
      : [`${String(report.unreadable)} usage line(s) could not be read — that spend is missing above.`]),
  ];
}

/**
 * The ask a board finding row carries: what there is to show, in the fewest words, biggest first.
 *
 * @param report the document
 * @param signal its verdict
 * @returns one line
 */
export function spendFindingAsk({ report, signal }: { report: SpendReport; signal: SpendSignal }): string {
  const parts: string[] = [];
  if (signal.trend === "win" || signal.trend === "drain") {
    parts.push(`${landingLine({ report })}: ${signal.because}.`);
  }
  signal.post.forEach((drain) => {
    parts.push(`${percent({ share: drain.share })} of the window's draw: ${drain.what}. Fix: ${drain.fix}.`);
  });
  return `Token pass: ${parts.join(" ")}`;
}
