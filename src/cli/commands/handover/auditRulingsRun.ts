/**
 * `slopweaver handover audit-rulings` — account for every ruling the register holds, and, given a manifest,
 * say of each reviewed answer whether its row now reads it as decided.
 *
 * The reader the ruling backfill's gold proof runs through (*the audit reading every backfilled row as
 * decided*). Read-only: it writes nothing, anywhere. What counts as decided, complete and unrepresented is
 * `../../../handover/rulingAudit.ts`'s to say; this edge parses flags, acquires the input and prints.
 */

import { rulingAnchor, rulingBackfilledFrom } from "../../../handover/ruling.js";
import { auditRulings, rulingAuditExitCode } from "../../../handover/rulingAudit.js";
import { readRulingAuditInput } from "../../../handover/rulingAuditStore.js";
import type { RulingAuditReport, RulingManifestCheck } from "../../../handover/rulingAuditTypes.js";
import { logger } from "../../../lib/logger.js";
import { stateHomePaths } from "../../../stateHome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { booleanFlagsOf, type FlagSpec, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { resolveHandoverDir } from "./commandSupport.js";

/** How many argv entries precede a verb's own arguments. Four: `[node, cli, noun, verb, …]`. */
const VERB_ARG_OFFSET = 4;

/** The flags `handover audit-rulings` accepts. */
const AUDIT_RULINGS_FLAGS: FlagSpec = { boolean: ["json"], string: ["manifest", "dir", "home"] };

/** `--`-prefixed, for the help-truth ratchet. */
export const HANDOVER_AUDIT_RULINGS_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: AUDIT_RULINGS_FLAGS }),
  ...booleanFlagsOf({ spec: AUDIT_RULINGS_FLAGS }),
]
  .map((name) => `--${name}`)
  .toSorted();

export const HANDOVER_AUDIT_RULINGS_USAGE =
  "usage: slopweaver handover audit-rulings [--manifest <path>] [--json] [--dir <path>] [--home <dir>]\n" +
  "\n" +
  "Accounts for every ruling on the board, its archive and every journal under runs/: what each row reads as\n" +
  "decided, every earlier ruling, and each recorded answer no reconstruction names. Writes nothing.\n" +
  "\n" +
  "--manifest checks a reviewed list of rulings ({ schemaVersion: 1, entries: [{ slug, sourceAtIso, words,\n" +
  "anchor }] }). An entry is DECIDED only when exactly one ruling names its source answer in backfilledFrom\n" +
  "with the manifest's exact words and anchor; a live ruling with the same words does not count.\n" +
  "\n" +
  "Exit 1 when any input could not be read (a directory, a doc, an undecodable journal line, the manifest)\n" +
  "or any manifest entry is unrepresented; 0 otherwise. --dir moves the docs only; journals stay in --home.\n" +
  "\n" +
  "example: slopweaver handover audit-rulings --manifest ~/.slopweaver/rulings/backfill.json --json";

/**
 * Parse `handover audit-rulings`' own flags — exported for the help-truth ratchet. No positionals.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or the parser's own refusals
 */
export function parseHandoverAuditRulingsArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: AUDIT_RULINGS_FLAGS });
}

/** A string flag's value, `undefined` when absent; a blank one is a usage error the caller reports. */
function pathFlag({ values, key }: { values: Readonly<Record<string, unknown>>; key: string }): string | undefined {
  const value = values[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * Run the audit and print it.
 *
 * @param argv the full process argv
 * @returns 0 when every input was read and every manifest entry is decided, 1 otherwise, 2 on a usage error
 */
export function runHandoverAuditRulings(argv: readonly string[]): number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: HANDOVER_AUDIT_RULINGS_USAGE });
    return EXIT_OK;
  }
  const parsed = parseHandoverAuditRulingsArgs({ rest });
  const values = parsed.isOk() ? parsed.value.values : {};
  const blank = ["manifest", "dir", "home"].filter((key) => pathFlag({ key, values })?.trim().length === 0);
  if (parsed.isErr() || blank.length > 0) {
    const errors = parsed.isErr() ? parsed.error : blank.map((key) => `--${key} must not be blank`);
    errors.forEach((error) => {
      logger.error({ msg: `handover audit-rulings: ${error}` });
    });
    logger.error({ msg: HANDOVER_AUDIT_RULINGS_USAGE });
    return EXIT_USAGE;
  }
  const home = resolveHome({ named: pathFlag({ key: "home", values }) });
  const report = auditRulings({
    input: readRulingAuditInput({
      handoverDir: resolveHandoverDir({ dir: pathFlag({ key: "dir", values }), home }),
      manifestPath: pathFlag({ key: "manifest", values }),
      runsDir: stateHomePaths({ home }).runs,
    }),
  });
  if (values["json"] === true) {
    logger.out({ line: JSON.stringify(report) });
  } else {
    humanLines({ report }).forEach((line) => {
      logger.out({ line });
    });
  }
  return rulingAuditExitCode({ report });
}

/**
 * The human read: completeness first, then every manifest verdict and every problem in full, then one line
 * per ruling. The owner's words are long and live in `--json`; this read says where each ruling stands.
 *
 * @param report the finished report
 * @returns the lines to print
 */
function humanLines({ report }: { report: RulingAuditReport }): readonly string[] {
  return [
    ...headlineLines({ report }),
    ...manifestSection({ report }),
    ...problemSection({ report }),
    "EFFECTIVE RULINGS",
    ...report.rows.flatMap((row) => (row.effective === null ? [] : [`  ${effectiveLine({ row })}`])),
    report.candidateNotice.message,
  ];
}

/** Whether the input was whole, and the counts it produced. */
function headlineLines({ report }: { report: RulingAuditReport }): readonly string[] {
  const { counts } = report;
  return [
    `RULING AUDIT — ${report.complete ? "COMPLETE INPUT" : "INCOMPLETE INPUT; any missing-ruling total is unknown"}`,
    `  ${String(counts.rows)} rows · ${String(counts.effective)} read a ruling · ${String(counts.historical)} earlier ` +
      `rulings · ${String(counts.unclassifiedAnswers)} unclassified answers · ${String(counts.incompleteInputs)} problems`,
  ];
}

/** Every manifest verdict, when a manifest was given. */
function manifestSection({ report }: { report: RulingAuditReport }): readonly string[] {
  const { counts } = report;
  if (report.scope.manifestPath === null) {
    return [];
  }
  return [
    `  manifest ${report.scope.manifestPath}: ${String(counts.manifestEntries)} entries · ${String(counts.decided)} ` +
      `decided · ${String(counts.confirmedUnrepresented)} unrepresented · ${String(counts.manifestIncomplete)} incomplete`,
    "MANIFEST",
    ...report.manifest.map((check) => `  ${checkLine({ check })}`),
  ];
}

/** Every problem, in full, because each one is a claim the report will not make. */
function problemSection({ report }: { report: RulingAuditReport }): readonly string[] {
  if (report.problems.length === 0) {
    return [];
  }
  return ["INCOMPLETE INPUT", ...report.problems.map((problem) => `  ${problem.code}: ${problem.message}`)];
}

/** One row's current ruling, with where it came from. The owner's words are long and live in `--json`. */
function effectiveLine({ row }: { row: RulingAuditReport["rows"][number] }): string {
  const evidence = row.effective!;
  const source = rulingBackfilledFrom({ evidence });
  const provenance = evidence.from === "authored" ? "authored" : `recorded ${evidence.event.atIso}`;
  const decided = evidence.from === "register" ? `, decided ${evidence.decidedIso}` : "";
  const backfill = source === undefined ? "" : `, backfilled from the answer of ${source}`;
  return `${row.slug}: ${provenance}${decided}${backfill} (${rulingAnchor({ evidence })})`;
}

/** One manifest verdict on one line. */
function checkLine({ check }: { check: RulingManifestCheck }): string {
  const identity = `${check.slug} #${check.sourceAtIso}`;
  switch (check.status) {
    case "decided":
      return `decided        ${identity} (${check.placement}, recorded ${check.recordedAtIso})`;
    case "confirmed-unrepresented":
      return `UNREPRESENTED  ${identity} — the answer checks out and no ruling names it`;
    case "incomplete":
      return `INCOMPLETE     ${identity} — ${check.codes.join(", ")}`;
    default: {
      const unreachable: never = check;
      return unreachable;
    }
  }
}

export const handoverAuditRulingsCommand = defineCommand({ run: runHandoverAuditRulings });
