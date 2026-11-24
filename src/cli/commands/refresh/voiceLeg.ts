/**
 * The refresh leg that measures their voice length register from the Slack they sent — so connecting Slack fills the
 * Alignment page's voice profile with no verb typed (the voice profile is
 * inferred from the connected Slack messages, never asked).
 *
 * It runs after the store replay and before hydration, only when this run's Slack ingest SUCCEEDED: a failed
 * ingest leaves a corpus nobody can vouch for, and remeasuring over it would replace a good register with a worse
 * one. Measuring nothing — no owner id, no corpus, no message of theirs, no store selected — is a printed skip that
 * keeps the exit code; a read or write that FAILS is a failure that reaches the closing line, because a register
 * that silently stops refreshing is the stale numbers the send door would then warn against for ever.
 *
 * The measurement itself is {@link runVoiceMeasurement}, the same service `profile voice measure` calls.
 */
import { WITHHELD } from "#lib/numbersOnly.js";
import { safeFsAsync } from "#lib/safeBoundary.js";
import { err, type Result } from "../../../lib/result.js";
import type { VoiceMeasureError } from "../../../profile/voiceMeasureErrors.js";
import { runVoiceMeasurement, type VoiceMeasureWriteOutcome } from "../../../profile/voiceMeasureWrite.js";
import type { RefreshResult, RefreshSummaryLine } from "./core.js";
import type { RefreshDeps } from "./deps.js";
import type { RefreshLegFailures } from "./failureClosingLine.js";
import { emitSummaryLine } from "./summary.js";

/** The seam that measures and writes their voice register under one home, a missing store answered `no-store`. */
export type MeasureVoice = (args: {
  home: string;
  nowIso: string;
}) => Promise<Result<VoiceMeasureWriteOutcome, VoiceMeasureError | { readonly message: string }>>;

/**
 * The production seam: measure, write when a store is selected, and answer `no-store` when none is.
 *
 * @returns what the measurement did, or why it failed
 */
export const productionMeasureVoice: MeasureVoice = ({ home, nowIso }) =>
  runVoiceMeasurement({ dryRun: false, home, nowIso, storeOptional: true });

/**
 * What one measurement outcome prints, and whether it is a failure. Pure.
 *
 * @param outcome the seam's result, a thrown measurement already folded into an Err
 * @param numbersOnly whether a failure's free-prose reason is withheld
 * @returns the lines in print order, and the leg's failures
 */
export function voiceLegVerdict({
  outcome,
  numbersOnly,
}: {
  outcome: Result<VoiceMeasureWriteOutcome, { readonly message: string }>;
  numbersOnly: boolean;
}): RefreshLegFailures & { readonly lines: readonly RefreshSummaryLine[] } {
  if (outcome.isErr()) {
    const reason = outcome.error.message;
    return {
      failures: [{ reason, source: "slack" }],
      lines: [{ level: "error", text: `voice: ${numbersOnly ? WITHHELD : reason}` }],
    };
  }
  const value = outcome.value;
  // Every outcome carries what the protect list kept out of the walk, so the count rides whichever line is printed.
  const notRead =
    value.notRead.length === 0 ? "" : `; ${String(value.notRead.length)} path(s) on the protect list not read`;
  switch (value.kind) {
    case "written": {
      const counts = value.measurement.cohorts
        .map((cohort) => `${cohort.surface}/${cohort.cohort} n=${String(cohort.sampleCount)}`)
        .join(", ");
      return {
        failures: [],
        lines: [{ level: "out", text: `voice: measured their sent Slack — ${counts}${notRead}` }],
      };
    }
    case "skipped":
    case "no-store": {
      return { failures: [], lines: [{ level: "out", text: `voice: nothing measured — ${value.message}${notRead}` }] };
    }
    case "dry-run": {
      return { failures: [], lines: [{ level: "out", text: `voice: dry run, nothing written${notRead}` }] };
    }
    default: {
      const unreachable: never = value;
      return unreachable;
    }
  }
}

/**
 * Measure their voice register when this run's Slack ingest succeeded, printing one line, and say whether it failed.
 *
 * @param deps the logger and the optional `measureVoice` seam; a deck that wires none runs no leg
 * @param home the Slopweaver home
 * @param results the per-source ingest results, in run order
 * @param numbersOnly whether a failure's reason is withheld from the printed line
 * @returns the leg's failures; none when it measured, skipped or did not run
 */
export async function runRefreshVoiceStep({
  deps,
  home,
  results,
  numbersOnly,
}: {
  readonly deps: Pick<RefreshDeps, "logger" | "measureVoice" | "nowDate">;
  readonly home: string;
  readonly results: readonly RefreshResult[];
  readonly numbersOnly: boolean;
}): Promise<RefreshLegFailures> {
  const slackIngested = results.some((result) => result.source === "slack" && result.ok);
  const measure = deps.measureVoice;
  if (!slackIngested || measure === undefined) {
    return { failures: [] };
  }
  const nowIso = deps.nowDate().toISOString();
  const ran = await safeFsAsync({ execute: () => measure({ home, nowIso }), operation: "measureVoice" });
  const outcome: Result<VoiceMeasureWriteOutcome, { readonly message: string }> = ran.isErr()
    ? err({ message: ran.error.message })
    : ran.value;
  const verdict = voiceLegVerdict({ numbersOnly, outcome });
  for (const line of verdict.lines) {
    emitSummaryLine({ level: line.level, sink: deps.logger, text: line.text });
  }
  return { failures: verdict.failures };
}
