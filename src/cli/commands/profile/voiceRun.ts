/**
 * `slopweaver profile voice measure` — measure their voice length register from the Slack messages they sent, write it,
 * and refresh the context cache the send door reads. The thin shell over {@link runVoiceMeasurement}, which the
 * Slack refresh lane calls too, so the hand-run verb and the automatic one can never measure differently.
 *
 * Human report → stdout, `--json` → one document on stdout; a failure → stderr.
 */
import { logger } from "../../../lib/logger.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import type { SlackVoiceMeasurement } from "../../../profile/voiceMeasure.js";
import { runVoiceMeasurement, type VoiceMeasureWriteOutcome } from "../../../profile/voiceMeasureWrite.js";
import { voiceCohortLine } from "../../../store/profile/core.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../exitCodes.js";
import { talkHomeOf } from "../talk/args.js";

/**
 * The lines a measurement prints: one per cohort, then what was left out and why.
 *
 * @param measurement what was measured
 * @returns the report lines
 */
export function measurementLines({ measurement }: { measurement: SlackVoiceMeasurement }): readonly string[] {
  const { counts } = measurement;
  return [
    ...measurement.cohorts.map((cohort) => `  ${voiceCohortLine({ cohort })}`),
    `  from ${String(counts.ownerMessageVersions)} message version(s) authored as them ` +
      `(${String(counts.supersededVersions)} superseded by a later edit)`,
    `  left out: ${String(counts.excludedAppBotId)} app-posted (bot_id), ${String(counts.excludedAppId)} app-posted ` +
      `(app_id), ${String(counts.excludedBroadcastCopy)} broadcast copy, ${String(counts.excludedSubtype)} system ` +
      `subtype, ${String(counts.excludedNoRawText)} no text, ${String(counts.excludedNoProseWords)} no words`,
  ];
}

/**
 * The headline a successful outcome prints above its cohort lines.
 *
 * @param outcome a measured outcome, written or not
 * @returns the headline
 */
export function measurementHeadline({
  outcome,
}: {
  outcome: Exclude<VoiceMeasureWriteOutcome, { kind: "skipped" }>;
}): string {
  const count = String(outcome.measurement.cohorts.length);
  switch (outcome.kind) {
    case "written": {
      return `profile voice measure: ${count} cohort(s) written from ${String(outcome.filesRead)} Slack file(s); context cache refreshed`;
    }
    case "dry-run": {
      return `profile voice measure (dry run): ${count} cohort(s) measured from ${String(outcome.filesRead)} Slack file(s); nothing written`;
    }
    case "no-store": {
      return `profile voice measure: ${count} cohort(s) measured; nothing written — ${outcome.message}`;
    }
    default: {
      const unreachable: never = outcome;
      return unreachable;
    }
  }
}

/**
 * Run `profile voice measure`.
 *
 * @param dryRun measure and print, selecting no store
 * @param json print one JSON document instead of lines
 * @param home the `--home` given, absent for the environment's
 * @returns the process exit code: 0 measured, 3 nothing to measure, 1 a read or write failed
 */
export async function runProfileVoiceMeasure({
  dryRun,
  json,
  home,
}: {
  dryRun: boolean;
  json: boolean;
  home: string | undefined;
}): Promise<number> {
  const outcome = await runVoiceMeasurement({ dryRun, home: talkHomeOf({ home }), nowIso: new Date().toISOString() });
  if (outcome.isErr()) {
    logger.error({ msg: outcome.error.message });
    return EXIT_ERROR;
  }
  const value = outcome.value;
  if (json) {
    logger.out({ line: safeJsonStringify({ label: "profile voice measure", value }) });
    return value.kind === "skipped" ? EXIT_EXPECTED_EMPTY : EXIT_OK;
  }
  // A path the protect list kept out of the walk is said on stderr, so a cohort measured without it never reads as whole.
  value.notRead.forEach((msg) => {
    logger.error({ msg });
  });
  if (value.kind === "skipped") {
    logger.out({ line: `profile voice measure: nothing measured; no cohorts written — ${value.message}` });
    if (value.measurement !== undefined) {
      measurementLines({ measurement: value.measurement }).forEach((line) => {
        logger.out({ line });
      });
    }
    return EXIT_EXPECTED_EMPTY;
  }
  logger.out({ line: measurementHeadline({ outcome: value }) });
  measurementLines({ measurement: value.measurement }).forEach((line) => {
    logger.out({ line });
  });
  return EXIT_OK;
}
