/**
 * The PURE core of `slopweaver atlas vanta sync|reset`: flag parsing and the human/JSON rendering of a sync
 * report. No fs, no clock, no network — the shells ({@link ./syncRun}, {@link ./resetRun}) do every read,
 * write and credential resolution.
 */
import type { VantaSyncReport } from "../../../atlas/vanta/sync.js";
import type { VantaSyncRunError } from "../../../atlas/vanta/syncErrors.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { flagValueOr, parseFlagTail } from "../../optionParsers.js";

/** The validated invocation shared by both verbs. */
export interface VantaVerbOptions {
  readonly home: string;
  readonly json: boolean;
}

/**
 * Parse the verb tail into a validated {@link VantaVerbOptions}.
 *
 * @param rest the argv tail (after `slopweaver atlas vanta <verb>`)
 * @param defaultHome the home to use when `--home` is absent
 * @returns the validated options, or every rejection
 */
export function parseVantaVerbOptions({
  rest,
  defaultHome,
}: {
  rest: readonly string[];
  defaultHome: string;
}): Result<VantaVerbOptions> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home"] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { flags } = parsed.value;
  return ok({
    home: flagValueOr({ fallback: defaultHome, name: "home", parsed: parsed.value }),
    json: flags.has("json"),
  });
}

/**
 * The exit code a run that produced no report earns: deferred when a live holder had the sync lock, so the
 * scheduler gives the slot back rather than holding the recipe, and an error for every other refusal.
 *
 * @param error why the run produced no report
 * @param exitDeferred the code for "not yet — run again unchanged"
 * @param exitError the code for every refusal a rerun does not clear
 * @returns the exit code
 */
export function exitCodeForVantaSyncError({
  error,
  exitDeferred,
  exitError,
}: {
  error: VantaSyncRunError;
  exitDeferred: number;
  exitError: number;
}): number {
  return error.code === "SYNC_CONTENDED" ? exitDeferred : exitError;
}

/**
 * The exit code a sync report earns.
 *
 * @param report what the sync established
 * @param exitOk the code to return on a fully-complete sync
 * @param exitExpectedEmpty the code to return when credentials were genuinely absent
 * @param exitError the code to return when any kind synced incompletely
 * @returns the exit code
 */
export function exitCodeForVantaSyncReport({
  report,
  exitOk,
  exitExpectedEmpty,
  exitError,
}: {
  report: VantaSyncReport;
  exitOk: number;
  exitExpectedEmpty: number;
  exitError: number;
}): number {
  if (!report.credentialsConfigured) {
    return exitExpectedEmpty;
  }
  return report.kinds.every((kind) => kind.complete) ? exitOk : exitError;
}

/**
 * The human report lines for one sync run.
 *
 * @param report what the sync established
 * @returns the report lines, in display order
 */
export function renderVantaSyncLines({ report }: { report: VantaSyncReport }): readonly string[] {
  if (!report.credentialsConfigured) {
    return [
      "vanta sync: credentials are not configured",
      "  export VANTA_CLIENT_ID and VANTA_CLIENT_SECRET, or run `slopweaver secrets set vanta-client-id` and",
      "  `slopweaver secrets set vanta-client-secret` — see atlas/vanta/credentialFiles.ts",
    ];
  }
  return [
    ...report.kinds.flatMap((kind) => [
      `${kind.kind}: ${kind.complete ? "synced" : "INCOMPLETE"}, ${String(kind.entityCount)} record(s)`,
      ...kind.reasons.map((reason) => `  ${reason}`),
    ]),
    renderVantaSyncChangesLine({ changes: report.changes }),
  ];
}

/**
 * The one report line saying what became of this sync's change record.
 *
 * @param changes the sync report's change outcome
 * @returns the line, naming the record's path and the verb that reads it when one was written
 */
export function renderVantaSyncChangesLine({ changes }: { changes: VantaSyncReport["changes"] }): string {
  if (changes.outcome === "not-recorded") {
    return `changes: not recorded — ${changes.reason}`;
  }
  if (changes.outcome === "failed") {
    return `changes: NOT RECORDED — ${changes.reason}`;
  }
  const { added, removed, changed, baseline, incomplete } = changes.totals;
  return `changes: ${String(added)} added, ${String(removed)} removed, ${String(changed)} changed, ${String(baseline)} baseline kind(s), ${String(incomplete)} unread kind(s) — ${changes.path} (read with \`slopweaver atlas vanta changes\`)`;
}
