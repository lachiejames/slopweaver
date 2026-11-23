/**
 * What `store import --apply` prints: the outcome of one staged batch's apply, or why none of its rows was written. An
 * append-only difference is reported row by row — both sides, whether it was acknowledged, and the one command that
 * acknowledges it — since the live row is what stands either way and the imported one stays staged, unapplied. Pure.
 */
import { STORE_URL_ENV, type StoreUrlOrigin } from "../../../store/config.js";
import type { ApplyStagedImportOutcome } from "../../../store/transfer/importApply.js";
import type { AppendOnlyDifference, StoreImportApplyError } from "../../../store/transfer/importApplyErrors.js";

import { importApplyCommand, importResolveCommand } from "./importResolveCommand.js";

/**
 * A line that IS a command to paste: the label this file gives one, at the start of the line, before the command.
 * Anchored to the line's start, so a row's own content — printed after `current:` or `imported:` — never matches.
 */
const PRINTED_COMMAND = /^ *(?:acknowledge|run again): slopweaver store import/;

/**
 * An apply's lines, followed, when its store came from `SLOPWEAVER_STORE_URL` rather than the home and a command was
 * printed to paste, by the one note that keeps that command on the same store. A printed command names only the home,
 * because the store's connection string carries a password and is never printed, and the variable wins over any home.
 *
 * @param origin where this run's connection string came from
 * @returns the lines unchanged, or with the note after them
 */
export function withStoreOrigin({
  lines,
  origin,
}: {
  lines: readonly string[];
  origin: StoreUrlOrigin;
}): readonly string[] {
  if (origin !== "environment" || !lines.some((line) => PRINTED_COMMAND.test(line))) {
    return lines;
  }
  return [
    ...lines,
    `  this run's store came from ${STORE_URL_ENV}, which wins over --home: paste a command above with that same variable set`,
  ];
}

/** One difference as the lines a person reads: the row, both sides, and how to acknowledge it if nobody has. */
function differenceLines({ difference, home }: { difference: AppendOnlyDifference; home: string }): readonly string[] {
  const state = difference.resolved ? "acknowledged" : "not acknowledged";
  const command = importResolveCommand({ action: "keep-current", home, questionId: difference.questionId });
  const acknowledge = difference.resolved ? [] : [`      acknowledge: ${command}`];
  return [
    `    ${difference.part} ${difference.key} (${difference.questionId}, ${state})`,
    `      current:  ${difference.current}`,
    `      imported: ${difference.imported}`,
    ...acknowledge,
  ];
}

/**
 * The lines a person reads for one apply that wrote, or found the batch already written.
 *
 * @param home the absolute home the apply used, which every printed command names so it acts under the same home
 * @returns the heading, then every append-only difference the apply kept the live row for
 */
export function importApplyLines({
  outcome,
  home,
}: {
  outcome: ApplyStagedImportOutcome;
  home: string;
}): readonly string[] {
  if (outcome.outcome === "already-applied") {
    return [
      `store import: batch ${outcome.batchId} was already applied under plan ${outcome.planDigest}; none of its rows ` +
        `written now, and its receipt records ${String(outcome.receiptWrites)} written`,
    ];
  }
  const heading =
    `store import: applied batch ${outcome.batchId} under plan ${outcome.planDigest}: ` +
    `${String(outcome.writes)} row(s) of the batch written, its receipt included, from ${String(outcome.items)} staged`;
  const differences = outcome.appendOnlyDifferences;
  if (differences.length === 0) {
    return [heading, "  no append-only difference: every staged row the plan writes was written"];
  }
  return [
    heading,
    `  ${String(differences.length)} append-only difference(s): the current row stands, and the imported one stays staged, unapplied:`,
    ...differences.flatMap((difference) => differenceLines({ difference, home })),
    "  --stop-on-conflict refuses the whole apply on any of these instead",
  ];
}

/**
 * The lines a person reads for an apply that wrote nothing.
 *
 * @param home the absolute home the apply used, which every printed command names so it acts under the same home
 * @param stopOnConflict whether the apply ran with --stop-on-conflict, which a printed re-run carries again
 * @returns the refusal, with every difference a strict apply stopped on, or the one re-run to try after a commit whose
 *   outcome is unknown
 */
export function importApplyRefusalLines({
  refusal,
  home,
  stopOnConflict,
}: {
  refusal: StoreImportApplyError;
  home: string;
  stopOnConflict: boolean;
}): readonly string[] {
  if (refusal.code === "IMPORT_STAGED_PAYLOAD_INVALID" || refusal.code === "IMPORT_STAGED_BATCH_INCOMPLETE") {
    return [
      `store import: ${refusal.message}`,
      "  this is damage to what staging wrote, not a question to answer: none of its rows was applied, and the batch is left as it is; no verb repairs it",
    ];
  }
  if (refusal.code === "IMPORT_COMMIT_UNCONFIRMED") {
    return [
      `store import: ${refusal.message}`,
      `  run again: ${importApplyCommand({ batchId: refusal.batchId, home, stopOnConflict })}`,
    ];
  }
  if (refusal.code !== "IMPORT_APPEND_ONLY_CONFLICT") {
    return [`store import: ${refusal.message}`];
  }
  return [
    `store import: batch ${refusal.batchId} was not applied, and none of its rows was written: --stop-on-conflict stops ` +
      `on any append-only difference, and it met ${String(refusal.differences.length)}:`,
    ...refusal.differences.flatMap((difference) => differenceLines({ difference, home })),
    "  without --stop-on-conflict, a difference like these does not stop the apply: it keeps the current row and " +
      "leaves the imported one staged",
  ];
}
