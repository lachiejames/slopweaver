/**
 * `slopweaver supervisor successor-summary` — derive the outcomes half of a handover from one reconciliation, whose
 * outcomes are the ones the owner kept on the owner's Workstreams register, and seal it.
 *
 * The edge only: it reads one document, calls two pure functions and writes one file.
 * `../../../supervisor/outcomes/successorSummary.ts` renders,
 * `../../../supervisor/outcomes/summaryMarker.ts` seals, and
 * `./stateDocEditRun.ts` refuses to archive a boot block without the result.
 */
import { readFileSync, writeFileSync } from "node:fs";

import { logger } from "../../../lib/logger.js";
import { isRecord } from "../../../lib/parsers.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { safeJsonParse } from "../../../lib/safeJson.js";
import { readReconciledOutcomes } from "../../../supervisor/outcomes/reconciledOutcomes.js";
import {
  renderSuccessorSummary,
  type SummaryOutcome,
  type SummaryRow,
} from "../../../supervisor/outcomes/successorSummary.js";
import { sealSummary } from "../../../supervisor/outcomes/summaryMarker.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlagTail, verbTail } from "../../optionParsers.js";
import { type SupervisorError, SupervisorErrors } from "./errors.js";

export const SUCCESSOR_SUMMARY_USAGE =
  "usage: slopweaver supervisor successor-summary --reconcile <json|-> [--out <path>] [--now <iso>] [--json]\n" +
  "\n" +
  "Derives the outcomes half of a successor handover: every outcome the owner kept on their Workstreams register, in\n" +
  "their own words with its anchor and this tick's coverage, then the WHOLE ready set ranked. Never authored — `state-archive`\n" +
  "verifies the marker hash before it will archive a boot block.\n" +
  "\n" +
  "example: slopweaver handover reconcile --json > r.json && slopweaver supervisor successor-summary --reconcile r.json --out summary.md";

/** The verb's flag tail. */
export const SUCCESSOR_SUMMARY_FLAG_SPEC = {
  boolean: ["json"],
  value: ["reconcile", "out", "now"],
} as const satisfies { boolean: readonly string[]; value: readonly string[] };

/** `--`-prefixed, for the help-truth ratchet. */
export const SUPERVISOR_SUCCESSOR_SUMMARY_FLAG_NAMES: readonly string[] = [
  ...SUCCESSOR_SUMMARY_FLAG_SPEC.value,
  ...SUCCESSOR_SUMMARY_FLAG_SPEC.boolean,
]
  .map((name) => `--${name}`)
  .toSorted();

/** A string field on a record, or "" when it is absent or not a string. */
function str({ key, on }: { key: string; on: Record<string, unknown> }): string {
  const value = on[key];
  return typeof value === "string" ? value : "";
}

/** The ready set on a reconciliation document, ranked as it already is. */
function summaryRows({ document }: { document: unknown }): readonly SummaryRow[] {
  if (!isRecord(document) || !Array.isArray(document["ready"])) {
    return [];
  }
  return document["ready"].flatMap((row: unknown, index): SummaryRow[] =>
    isRecord(row)
      ? [
          {
            id: str({ key: "id", on: row }),
            kind: str({ key: "kind", on: row }),
            label: str({ key: "label", on: row }),
            priority: str({ key: "priority", on: row }),
            rank: index + 1,
          },
        ]
      : [],
  );
}

/**
 * Read the reconciliation named on the command line.
 *
 * @param source a path, or `-` for stdin
 * @returns the parsed document, or the reason it could not be read
 */
function readReconciliation({ source }: { source: string }): Result<unknown, SupervisorError> {
  try {
    return ok(
      safeJsonParse({
        label: "the reconciliation",
        text: source === "-" ? readFileSync(0, "utf8") : readFileSync(source, "utf8"),
      }),
    );
  } catch (cause: unknown) {
    return err(SupervisorErrors.reconciliationUnreadable({ cause }));
  }
}

/**
 * Derive the summary and emit it, once the flags are settled.
 *
 * @param document the parsed reconciliation
 * @param values the parsed flag values
 * @param json whether to print the machine-readable line
 * @returns the process exit code
 */
function emitSummary({
  document,
  values,
  json,
}: {
  document: unknown;
  values: Readonly<Record<string, string | undefined>>;
  json: boolean;
}): number {
  // The reconciliation's own rows, read strictly: a missing or malformed field refuses rather than printing an
  // outcome with an empty id or anchor.
  const read = readReconciledOutcomes({ reconciliation: document });
  if (read.isErr()) {
    logger.error({ msg: `supervisor successor-summary: ${read.error.message}` });
    return EXIT_ERROR;
  }
  const outcomes: readonly SummaryOutcome[] = read.value.outcomes;
  const ready = summaryRows({ document });
  const sealed = sealSummary({
    body: renderSuccessorSummary({
      generatedIso: nowOf({ values }),
      headline: isRecord(document) ? str({ key: "headline", on: document }) : "",
      outcomes,
      ready,
    }),
    outcomes: outcomes.length,
    ready: ready.length,
  });
  const out = values["out"];
  if (out === undefined) {
    logger.out({ line: sealed });
    return EXIT_OK;
  }
  try {
    writeFileSync(out, sealed, { encoding: "utf8", mode: 0o600 });
  } catch (cause: unknown) {
    logger.error({
      msg: `supervisor successor-summary: could not write ${out} — ${cause instanceof Error ? cause.message : "unknown error"}`,
    });
    return EXIT_ERROR;
  }
  const uncovered = outcomes.filter((outcome) => outcome.liveSessions.length === 0 && outcome.unspawned.length > 0);
  logger.out({
    line: json
      ? JSON.stringify({
          outcomes: outcomes.length,
          path: out,
          ready: ready.length,
          uncovered: uncovered.map((outcome) => outcome.id),
        })
      : `supervisor successor-summary: wrote ${out} — ${String(outcomes.length)} outcome(s), ${String(ready.length)} ready row(s), ${String(uncovered.length)} outcome(s) with nobody on them`,
  });
  return EXIT_OK;
}

/**
 * When the summary says it was derived: the caller's `--now`, or the clock.
 *
 * @param values the parsed flag values
 * @returns the instant to stamp it with
 */
function nowOf({ values }: { values: Readonly<Record<string, string | undefined>> }): string {
  const named = values["now"];
  if (named === undefined) {
    return new Date().toISOString();
  }
  return named;
}

/**
 * Run the verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export function runSupervisorSuccessorSummary(argv: readonly string[]): number {
  const rest = verbTail({ argv, verbs: ["successor-summary"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: SUCCESSOR_SUMMARY_USAGE });
    return EXIT_OK;
  }
  const parsed = parseFlagTail({ rest, spec: SUCCESSOR_SUMMARY_FLAG_SPEC });
  if (parsed.isErr()) {
    parsed.error.forEach((message) => {
      logger.error({ msg: message });
    });
    logger.error({ msg: SUCCESSOR_SUMMARY_USAGE });
    return EXIT_USAGE;
  }
  const { values, flags } = parsed.value;
  const source = values["reconcile"];
  if (source === undefined) {
    logger.error({
      msg: "supervisor successor-summary: --reconcile <json|-> is required — the coverage is derived from it, never typed",
    });
    logger.error({ msg: SUCCESSOR_SUMMARY_USAGE });
    return EXIT_USAGE;
  }
  const document = readReconciliation({ source });
  if (document.isErr()) {
    logger.error({ msg: `supervisor successor-summary: ${document.error.message}` });
    return EXIT_ERROR;
  }
  return emitSummary({ document: document.value, json: flags.has("json"), values });
}

/** `slopweaver supervisor successor-summary`. */
export const supervisorSuccessorSummaryCommand = defineCommand({ run: runSupervisorSuccessorSummary });
