/**
 * The fleet-wide read of {@link ../sessions/modelFallback}: which live seats a safeguard fallback moved off
 * the model they were seated with, of ANY tier, and which were moved back.
 *
 * ## The class this makes visible
 *
 * `supervisor/chairGate.ts` guards ONE seat and asks one question — is the chair on Fable. A fallback is not
 * Fable-specific. MEASURED on one transcript: `claude-opus-5` to `claude-opus-4-8`, category `cyber`, and all 1,042
 * assistant records after it ran on the fallback model. Nothing anywhere reported that seat as demoted, and
 * `session depth` printed it as `deep on claude-opus-4-8` with no hint that no one chose that model.
 *
 * The owner's ruling took option D alongside B for exactly this: the chair is where the cost is,
 * and the class is wider than the chair.
 *
 * ## Why this is a verb and not a column on `session depth`
 *
 * That fallback record sits at LINE 32 of 3,691. `session depth` reads a 1 MiB TAIL
 * (`./tokenDepth.ts` `DEPTH_TAIL_BYTES`), so a column there would have reported the one transcript this
 * exists for as clean — the comforting-zero failure `tokenDepth.ts`'s own header forbids. A complete answer
 * costs a whole-file stream per session, which is a cost an operator opts into by typing the verb, not one
 * every tick pays silently.
 *
 * Pure: readings in, rows and lines out. The streaming is `cli/commands/session/fallbacksRun.ts`.
 */
import type { SeatFallbackVerdict } from "./modelFallback.js";

/** One live session, and what its whole transcript said about safeguard fallbacks. */
export interface SeatFallbackReading {
  readonly sessionId: string;
  readonly pid: number;
  readonly cwd: string;
  /** The cmux workspace title for this seat, when one resolved — what the owner actually reads. */
  readonly title: string | undefined;
  /** The verdict, or the reason the transcript could not be judged. */
  readonly verdict: SeatFallbackVerdict | undefined;
  readonly unreadable: string | undefined;
}

/** What the whole fleet read came to. */
export interface SeatFallbackReport {
  readonly demoted: readonly SeatFallbackReading[];
  readonly restored: readonly SeatFallbackReading[];
  readonly unreadable: readonly SeatFallbackReading[];
  readonly scanned: number;
}

/**
 * Fold every reading into the three buckets a reader acts on differently.
 *
 * `none` is not a bucket: a seat no fallback ever touched is the ordinary case and listing it would bury the
 * ones that matter. `scanned` is what keeps the empty report honest — zero demoted out of zero scanned is a
 * read that saw nothing, and zero out of thirteen is a clean fleet.
 *
 * @param readings one per live session
 * @returns the demoted, the restored, the unreadable, and how many seats were looked at
 */
export function seatFallbackReport({ readings }: { readings: readonly SeatFallbackReading[] }): SeatFallbackReport {
  return {
    demoted: readings.filter((reading) => reading.verdict?.kind === "demoted"),
    restored: readings.filter((reading) => reading.verdict?.kind === "restored"),
    scanned: readings.length,
    unreadable: readings.filter((reading) => reading.unreadable !== undefined),
  };
}

/** How a seat is named on a row: its workspace title when it has one, its cwd when it does not. */
function seatName({ reading }: { reading: SeatFallbackReading }): string {
  if (reading.title === undefined) {
    return reading.cwd;
  }
  return reading.title;
}

/**
 * One row, naming the seat, the switch, and the instant.
 *
 * @param reading the seat and its verdict
 * @returns the line
 */
export function seatFallbackLine({ reading }: { reading: SeatFallbackReading }): string {
  const who = `${seatName({ reading })}\t${reading.sessionId} (pid ${String(reading.pid)})`;
  if (reading.unreadable !== undefined) {
    return `UNREAD\t${who}\t${reading.unreadable}`;
  }
  if (reading.verdict === undefined || reading.verdict.kind === "none") {
    return `clean\t${who}`;
  }
  const { fallback } = reading.verdict;
  let category = fallback.category;
  if (category === "") {
    category = "unnamed";
  }
  const switched = `${fallback.originalModel} -> ${fallback.fallbackModel} at ${fallback.atIso} (category ${category})`;
  if (reading.verdict.kind === "restored") {
    return `restored\t${who}\t${switched}; a later turn ran on ${reading.verdict.model}`;
  }
  return `DEMOTED\t${who}\t${switched}; nothing has run on ${fallback.originalModel} since`;
}

/**
 * Render the whole report.
 *
 * The headline states what was SCANNED as well as what was found, because "no demoted seats" off a read that
 * reached no transcripts is the one sentence this verb must never be able to print by accident.
 *
 * @param report the folded report
 * @returns every line, headline first
 */
export function renderSeatFallbackReport({ report }: { report: SeatFallbackReport }): readonly string[] {
  const headline =
    `${String(report.demoted.length)} seat(s) DEMOTED by a safeguard fallback, ` +
    `${String(report.restored.length)} restored since, ` +
    `${String(report.unreadable.length)} unread, of ${String(report.scanned)} live session(s) scanned`;
  const rows = [...report.demoted, ...report.restored, ...report.unreadable].map((reading) =>
    seatFallbackLine({ reading }),
  );
  if (rows.length === 0) {
    return [headline];
  }
  return [headline, "", ...rows];
}
