/**
 * `slopweaver handover backfill-rulings` — write the rulings a reviewed manifest names, as reconstructions of
 * the answers that recorded them.
 *
 * The third piece of the ruling backfill. It plans by default and writes only with `--apply`,
 * and every decision it makes is `../../../handover/rulingBackfill.ts`'s; this edge parses flags, acquires the
 * state and prints.
 *
 * **Rollout order is a prerequisite, not a flag.** A build whose decoder predates the `ruling` kind reads a
 * ruling line as unreadable, so it cannot see the decision — but it is no longer DISARMED by one, since
 * `../../../handover/ledger.ts`'s `ownershipAmbiguousLines` forgives a well-formed unknown kind that names no
 * writer. So the reader should still be deployed everywhere that shares this home before this is applied to
 * it, and a checkout that lags now loses legibility rather than the use of its lifecycle verbs. A
 * `--readers-ready` flag was considered and left out: nothing this process can see establishes what other
 * checkouts are running, and an assertion that looks like a check is worse than a stated prerequisite.
 */

import { readRulingAuditInput } from "../../../handover/rulingAuditStore.js";
import {
  applyRulingBackfill,
  reportRulingBackfillPlan,
  rulingBackfillExitCode,
} from "../../../handover/rulingBackfill.js";
import { rulingBackfillDeps } from "../../../handover/rulingBackfillStore.js";
import type { RulingBackfillEntry, RulingBackfillReport } from "../../../handover/rulingBackfillTypes.js";
import { logger } from "../../../lib/logger.js";
import { stateHomePaths } from "../../../stateHome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { booleanFlagsOf, type FlagSpec, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { resolveHandoverDir } from "./commandSupport.js";

/** How many argv entries precede a verb's own arguments. Four: `[node, cli, noun, verb, …]`. */
const VERB_ARG_OFFSET = 4;

/** The flags `handover backfill-rulings` accepts. */
const BACKFILL_FLAGS: FlagSpec = { boolean: ["apply", "json"], string: ["manifest", "dir", "home"] };

/** `--`-prefixed, for the help-truth ratchet. */
export const HANDOVER_BACKFILL_RULINGS_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: BACKFILL_FLAGS }),
  ...booleanFlagsOf({ spec: BACKFILL_FLAGS }),
]
  .map((name) => `--${name}`)
  .toSorted();

export const HANDOVER_BACKFILL_RULINGS_USAGE =
  "usage: slopweaver handover backfill-rulings --manifest <path> [--apply] [--json] [--dir <path>] [--home <dir>]\n" +
  "\n" +
  "Records each reviewed answer in the manifest as a `ruling` event on its own row, reconstructed from that\n" +
  "answer. Without --apply it plans and writes nothing. Re-running the same manifest appends only what is\n" +
  "still missing, so a partial run is resumed by running it again.\n" +
  "\n" +
  "An entry is written only when the row's own journal carries exactly one answer at its instant whose text\n" +
  "equals the manifest's words, and no ruling already names it. A row whose input is not fully readable\n" +
  "refuses ITS entries and no others, and an unreadable doc or directory refuses every entry.\n" +
  "\n" +
  "BEFORE APPLYING: every build reading this home must already decode the `ruling` kind, or it will read the\n" +
  "lines this writes as unreadable. Check `handover audit-rulings --manifest <path>` after, which is the\n" +
  "proof: it reads each written row as decided.\n" +
  "\n" +
  "example: slopweaver handover backfill-rulings --manifest ~/.slopweaver/rulings/backfill.json --apply --json";

/**
 * Parse `handover backfill-rulings`' own flags — exported for the help-truth ratchet. No positionals.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or the parser's own refusals
 */
export function parseHandoverBackfillRulingsArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: BACKFILL_FLAGS });
}

/** A string flag's value, `undefined` when absent. */
function pathFlag({ key, values }: { key: string; values: Readonly<Record<string, unknown>> }): string | undefined {
  const value = values[key];
  return typeof value === "string" ? value : undefined;
}

/** Every usage refusal this verb makes, before it touches any state. */
function usageProblems({ values }: { values: Readonly<Record<string, unknown>> }): readonly string[] {
  const blank = ["manifest", "dir", "home"].filter((key) => pathFlag({ key, values })?.trim().length === 0);
  const missing = pathFlag({ key: "manifest", values }) === undefined ? ["--manifest is required"] : [];
  return [...missing, ...blank.map((key) => `--${key} must not be blank`)];
}

/**
 * Plan or apply the backfill.
 *
 * @param argv the full process argv
 * @returns 0 when nothing was refused, nothing failed and every input was read, 1 otherwise, 2 on a usage error
 */
export function runHandoverBackfillRulings(argv: readonly string[]): number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: HANDOVER_BACKFILL_RULINGS_USAGE });
    return EXIT_OK;
  }
  const parsed = parseHandoverBackfillRulingsArgs({ rest });
  const values = parsed.isOk() ? parsed.value.values : {};
  const refusals = parsed.isErr() ? parsed.error : usageProblems({ values });
  if (refusals.length > 0) {
    refusals.forEach((refusal) => {
      logger.error({ msg: `handover backfill-rulings: ${refusal}` });
    });
    logger.error({ msg: HANDOVER_BACKFILL_RULINGS_USAGE });
    return EXIT_USAGE;
  }
  const home = resolveHome({ named: pathFlag({ key: "home", values }) });
  const input = readRulingAuditInput({
    handoverDir: resolveHandoverDir({ dir: pathFlag({ key: "dir", values }), home }),
    manifestPath: pathFlag({ key: "manifest", values }),
    runsDir: stateHomePaths({ home }).runs,
  });
  const report =
    values["apply"] === true
      ? applyRulingBackfill({ deps: rulingBackfillDeps({ input }), input })
      : reportRulingBackfillPlan({ input });
  emit({ json: values["json"] === true, report });
  return rulingBackfillExitCode({ report });
}

/** Print the report, as one JSON document or as the human read. */
function emit({ json, report }: { json: boolean; report: RulingBackfillReport }): void {
  if (json) {
    logger.out({ line: JSON.stringify(report) });
    return;
  }
  humanLines({ report }).forEach((line) => {
    logger.out({ line });
  });
}

/**
 * The human read: what mode this was, what each reviewed answer came to, and every problem in full.
 *
 * @param report the finished report
 * @returns the lines to print
 */
function humanLines({ report }: { report: RulingBackfillReport }): readonly string[] {
  const { counts } = report;
  return [
    `RULING BACKFILL — ${report.mode.toUpperCase()}${report.complete ? "" : " — INCOMPLETE"}`,
    `  ${String(counts.manifestEntries)} entries · ${String(counts.append)} to append · ` +
      `${String(counts.appended)} appended · ${String(counts.alreadyRecorded)} already recorded · ` +
      `${String(counts.refused)} refused · ${String(counts.failed)} failed`,
    "ENTRIES",
    ...report.entries.map((entry) => `  ${entryLine({ entry })}`),
    ...problemLines({ report }),
  ];
}

/** Every problem the audit observed, which are true whether or not they stopped an entry. */
function problemLines({ report }: { report: RulingBackfillReport }): readonly string[] {
  if (report.problems.length === 0) {
    return [];
  }
  return ["PROBLEMS", ...report.problems.map((problem) => `  ${problem.code}: ${problem.message}`)];
}

/**
 * Why a refused entry was refused: the append seam's own refusal when it gave one, else the audit codes that
 * stopped it before any append was considered.
 */
function refusedWhy({ entry }: { entry: Extract<RulingBackfillEntry, { status: "refused" }> }): string {
  const { failure } = entry;
  if (failure === null) {
    return entry.codes.join(", ");
  }
  return failure.message;
}

/** One entry's outcome on one line. */
function entryLine({ entry }: { entry: RulingBackfillEntry }): string {
  const identity = `${entry.entry.slug} #${entry.entry.sourceAtIso}`;
  switch (entry.status) {
    case "append":
      return `would append   ${identity}`;
    case "appended":
      return `appended       ${identity} (recorded ${entry.recordedAtIso})`;
    case "already-recorded":
      return `already there  ${identity} (${entry.placement}, recorded ${entry.recordedAtIso})`;
    case "refused":
      return `REFUSED        ${identity} — ${refusedWhy({ entry })}`;
    case "failed":
      return `FAILED         ${identity} — ${entry.failure.message}`;
    default: {
      const unreachable: never = entry;
      return unreachable;
    }
  }
}

export const handoverBackfillRulingsCommand = defineCommand({ run: runHandoverBackfillRulings });
