/**
 * The PURE core of `slopweaver notion verify` — argument parsing, the report, and the exit code. No I/O and
 * no browser, which is true of the whole verb rather than only this half: the page is
 * measured in the owner's own Chrome by the visible session, and what arrives here is the document it
 * returned (`docs/browser-route.md`, `docs/browser-route/proof-and-capture-verbs.md`).
 *
 * ## The exit code is the contract, and it has three states rather than two
 *
 * `0` the page rendered and nothing is wrong. `3` the check RAN and the page is wrong — a legitimate
 * non-success status, exactly as `../../exitCodes.ts` describes. `1` the check could not run at all.
 *
 * The third is the one that matters. This verb exists because "I could not check" was being reported as
 * fine: a session published a table, could not read a block's children through any door verb, and said the
 * page was good on the strength of the markdown it had sent. So a run that fails to reach the page must
 * look like a FAULT, never like a clean bill — that is the entire defect, encoded in a number.
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import { err, ok, type Result } from "../../../lib/result.js";
import {
  DEFAULT_CELL_LINE_BUDGET,
  type RenderFinding,
  type RenderObservation,
} from "../../../outbound/notion/renderFindings.js";
import type { NotionVerifyError } from "../../../outbound/notion/verify.errors.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../exitCodes.js";
import { booleanFlagsOf, type FlagSpec, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { type NotionCommandError, NotionCommandErrors } from "./errors.js";

/** A parsed `notion verify` invocation. */
export interface NotionVerifyArgs {
  /** The page's address, as given: a Notion URL or a bare id. */
  readonly page: string;
  /**
   * The observation document to judge, or `undefined` to print the brief instead.
   *
   * The two modes are one verb rather than two sub-verbs because they are one operation split across two
   * processes: without it the verb says what to measure, with it the verb judges the measurement.
   */
  readonly observation: string | undefined;
  /** Where the session is told to write its screenshots; defaults to a per-page directory under the home. */
  readonly out: string | undefined;
  readonly cellLines: number;
  readonly json: boolean;
  readonly home: string | undefined;
}

/**
 * The flags this verb accepts.
 *
 * Exported so `helpTruth.test.ts` can compare it against the manifest usage string in both directions.
 * @internal
 */
export const NOTION_VERIFY_FLAGS: FlagSpec = {
  boolean: ["json"],
  string: ["out", "cell-lines", "observation", "home"],
};

/**
 * Every accepted flag, WITH the `--`, for the help-truth ratchet.
 *
 * @internal
 */
export const NOTION_VERIFY_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: NOTION_VERIFY_FLAGS }),
  ...booleanFlagsOf({ spec: NOTION_VERIFY_FLAGS }),
].map((name) => `--${name}`);

/**
 * Parse `notion verify <page> [...]`.
 *
 * @param argv the verb's arguments, excluding the noun and the verb
 * @returns the parsed arguments, or the operator-facing errors
 */
export function parseNotionVerifyArgs({
  argv,
}: {
  argv: readonly string[];
}): Result<NotionVerifyArgs, NotionCommandError> {
  const parsed = parseFlags({ allowPositionals: true, args: argv, spec: NOTION_VERIFY_FLAGS });
  if (parsed.isErr()) {
    return err(NotionCommandErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const { values, positionals } = parsed.value;
  const page = positionals[0];
  if (page === undefined) {
    return err(NotionCommandErrors.verifyAddressMissing());
  }
  if (positionals.length > 1) {
    return err(NotionCommandErrors.tooManyAddresses({ count: positionals.length }));
  }
  const text = ({ name }: { name: string }): string | undefined =>
    typeof values[name] === "string" ? values[name] : undefined;
  const rawBudget = text({ name: "cell-lines" });
  const budget = rawBudget === undefined ? DEFAULT_CELL_LINE_BUDGET : Number(rawBudget);
  if (!Number.isInteger(budget) || budget < 1) {
    return err(NotionCommandErrors.cellLinesInvalid({ got: rawBudget }));
  }
  return ok({
    cellLines: budget,
    home: text({ name: "home" }),
    json: values["json"] === true,
    observation: text({ name: "observation" }),
    out: text({ name: "out" }),
    page,
  });
}

/** One measured page, ready to be reported: what it said about itself, and where its shots were saved. */
export interface JudgedRender {
  /** The page's address, as the brief told the session to open it. */
  readonly url: string;
  readonly observation: RenderObservation;
  /** Every screenshot the session saved, in the order the brief asked for them. */
  readonly screenshots: readonly string[];
}

/**
 * How many text blocks outside a table a render observed. An older capture predates the `prose` list and
 * measured none, so it counts as zero rather than failing to parse.
 *
 * @returns the number of observed prose blocks
 */
export function proseBlockCount({ observation }: { observation: RenderObservation }): number {
  const prose = unsetFieldAsNull({ key: "prose", record: observation });
  if (prose === null) {
    return 0;
  }
  return prose.length;
}

/** Group findings by kind so a report reads as a short list of problems rather than a wall of lines. */
function findingLines({ findings }: { findings: readonly RenderFinding[] }): readonly string[] {
  return findings.map((finding) => `  - [${finding.kind}] ${finding.message}`);
}

/**
 * The operator-facing report for a completed check.
 *
 * @param judged the page's own measurement, and where its screenshots were saved
 * @param findings what is wrong with it, already judged
 * @param cellLines the line budget the cells were judged against, so the report states its own threshold
 * @returns the lines to print
 */
export function notionVerifyReportLines({
  judged,
  findings,
  cellLines,
}: {
  judged: JudgedRender;
  findings: readonly RenderFinding[];
  cellLines: number;
}): readonly string[] {
  const header = [
    `verified: ${judged.url}`,
    `  ${String(judged.observation.cells.length)} table cell(s), ${String(proseBlockCount({ observation: judged.observation }))} text block(s), ${String(judged.observation.mermaid.length)} mermaid block(s), judged at a ${String(cellLines)}-line cell budget`,
    ...judged.screenshots.map((path) => `  shot: ${path}`),
  ];
  if (findings.length === 0) {
    return [
      ...header,
      "no findings: every link rendered as a link, in cells and in prose, and every mermaid block shows its diagram.",
    ];
  }
  return [...header, `${String(findings.length)} finding(s) — this page is NOT ready:`, ...findingLines({ findings })];
}

/**
 * The lines a typed failure prints. The check did not run, and the report says exactly that.
 *
 * @param error why nothing could be captured
 * @returns the lines to print, leading with the fact that this is not a pass
 */
export function notionVerifyFailureLines({ error }: { error: NotionVerifyError }): readonly string[] {
  return ["the render check did NOT run, so this page is unverified — do not read this as a pass.", error.message];
}

/**
 * The exit code for a completed check.
 *
 * @param findings what the check found
 * @returns `EXIT_OK` when the page is clean, `EXIT_EXPECTED_EMPTY` when it is not
 */
export function notionVerifyExitCode({ findings }: { findings: readonly RenderFinding[] }): number {
  return findings.length === 0 ? EXIT_OK : EXIT_EXPECTED_EMPTY;
}

/**
 * The exit code for a check that could not run.
 *
 * Always the genuine-fault channel, never the expected-empty one. A caller must not be able to confuse an
 * unverified page with a verified one, and code `3` is the code a caller learns to tolerate.
 *
 * @returns `EXIT_ERROR`
 */
export function notionVerifyFailureCode(): number {
  return EXIT_ERROR;
}
