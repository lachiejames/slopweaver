/**
 * `slopweaver store assessment-due` — the stored rows the data-class rules send for assessment whose current words no
 * visible session has classified yet, newest first and bounded to the day's slice, each with its words, for the daily
 * reader to classify. Nothing written, the store's own migration catch-up included.
 *
 * Which rows are due, and why a day reads a slice rather than the backlog, is `src/store/storedRowAssessment.ts`'s; the
 * store reads are `src/store/storedRowAssessmentRead.ts`'s. Two modes:
 *
 * - **read** (default) — each row of the day's slice: its table and key, the rule that sent it, the digest of its words
 *   and the words themselves; then one counts line. The visible session classifies from this.
 * - **`--check`** — counts only, never a word: this is the line `automation run-due` runs after the seat, and a
 *   scheduler's output is no place for the owner's mail. A row still due inside the day's slice exits
 *   {@link EXIT_DEFERRED}, so the firing is not stamped and the next pass seats the reader again; a slice that is
 *   done — every due row recorded, or the day's capacity reached — exits {@link EXIT_OK} with the backlog reported.
 *   `--with-calls` defers while a call is due as well (`talk assessment-due`), so one daily row settles both halves.
 *
 * A store failure the database raised prints its SQLSTATE and nothing it said, as `store classify` does.
 */
import { err, ok, type Result } from "#lib/result.js";

import { logger } from "../../../lib/logger.js";
import { connectStore } from "../../../store/client.js";
import type { DataClassRule } from "../../../store/dataClassRules.js";
import { loadDataClassRules } from "../../../store/dataClassRulesFile.js";
import type { StoreError } from "../../../store/errors.js";
import {
  type RecordedDataClassAssessment,
  readRecordedAssessments,
} from "../../../store/recordedDataClassAssessment.js";
import type { DueStoredRow, StoredRowAssessmentSlice } from "../../../store/storedRowAssessment.js";
import { type DueStoredRowWithText, readDueStoredRowTexts } from "../../../store/storedRowAssessmentRead.js";
import { readStoredRowAssessmentSlice } from "../../../store/storedRowAssessmentSlice.js";
import { readCallAssessmentWorklist } from "../../../talk/callAssessmentRead.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { parseStoreAssessmentDueArgs, type StoreAssessmentDueArgs } from "./assessmentArgs.js";
import { STORE_ASSESSMENT_DUE_USAGE } from "./assessmentUsage.js";
import { storeFailureLine } from "./classifyCore.js";

/** How many argv entries precede the verb's own flags: `[node, bin, "store", "assessment-due", ...]`. */
const VERB_ARG_OFFSET = 4;

/** The verb, as every line it prints names it. */
const VERB = "store assessment-due";

/** The store reads the verb makes, over one open connection. */
export interface StoredRowAssessmentReader {
  readonly slice: (input: {
    rules: readonly DataClassRule[];
    records: readonly RecordedDataClassAssessment[];
    nowMs: number;
    limit: number;
  }) => Promise<Result<StoredRowAssessmentSlice, StoreError>>;
  readonly texts: (input: {
    due: readonly DueStoredRow[];
  }) => Promise<Result<readonly DueStoredRowWithText[], StoreError>>;
  readonly close: () => Promise<void>;
}

/**
 * The seams the verb performs its effects through.
 *
 * @internal — exported so a test builds plain seams of the same shape.
 */
export interface StoreAssessmentDueDeps {
  readonly readRegister: (input: {
    home: string | undefined;
  }) => Result<readonly RecordedDataClassAssessment[], { readonly message: string }>;
  readonly loadRules: (input: {
    home: string | undefined;
  }) => Result<readonly DataClassRule[], { readonly message: string }>;
  readonly openReader: (input: { home: string | undefined }) => Promise<Result<StoredRowAssessmentReader, StoreError>>;
  /** How many calls are due for a verdict now: read only under `--with-calls`. */
  readonly callsDue: (input: {
    home: string | undefined;
    nowMs: number;
  }) => Result<number, { readonly message: string }>;
  readonly nowMs: () => number;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * Run `store assessment-due` against injected edges.
 *
 * @param rest argv after `store assessment-due`
 * @param deps the read and output seams
 * @returns the process exit code
 * @internal — exported so a test drives the verb over plain seams.
 */
export async function runStoreAssessmentDue({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: StoreAssessmentDueDeps;
}): Promise<number> {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(STORE_ASSESSMENT_DUE_USAGE);
    return EXIT_OK;
  }
  const parsed = parseStoreAssessmentDueArgs({ rest });
  if (parsed.isErr()) {
    for (const problem of [parsed.error.message, STORE_ASSESSMENT_DUE_USAGE]) {
      deps.writeDiagnostic(problem);
    }
    return EXIT_USAGE;
  }
  const args = parsed.value;
  let nowMs = deps.nowMs();
  if (args.nowMs !== undefined) {
    nowMs = args.nowMs;
  }
  const inputs = readDueInputs({ deps, home: args.home, nowMs, withCalls: args.withCalls });
  if (inputs.isErr()) {
    deps.writeDiagnostic(`${VERB}: ${inputs.error}`);
    return EXIT_ERROR;
  }
  const reader = await deps.openReader({ home: args.home });
  if (reader.isErr()) {
    deps.writeDiagnostic(storeFailureLine({ error: reader.error, verb: VERB }));
    return EXIT_ERROR;
  }
  try {
    return await answerOverReader({ args, deps, inputs: inputs.value, nowMs, reader: reader.value });
  } finally {
    await reader.value.close();
  }
}

/** What the verb reads before it opens the store. */
interface DueInputs {
  readonly records: readonly RecordedDataClassAssessment[];
  readonly rules: readonly DataClassRule[];
  /** The calls due, or null when `--with-calls` was not passed. */
  readonly callsDue: number | null;
}

/**
 * Read the register, the rules and (under `--with-calls`) the calls due, stopping at the first that fails.
 *
 * @param withCalls whether the call worklist is read too
 * @returns the inputs, or the failing read's message
 */
function readDueInputs({
  deps,
  home,
  nowMs,
  withCalls,
}: {
  deps: StoreAssessmentDueDeps;
  home: string | undefined;
  nowMs: number;
  withCalls: boolean;
}): Result<DueInputs, string> {
  const records = deps.readRegister({ home });
  if (records.isErr()) {
    return err(records.error.message);
  }
  const rules = deps.loadRules({ home });
  if (rules.isErr()) {
    return err(rules.error.message);
  }
  if (!withCalls) {
    return ok({ callsDue: null, records: records.value, rules: rules.value });
  }
  return deps
    .callsDue({ home, nowMs })
    .map((callsDue) => ({ callsDue, records: records.value, rules: rules.value }))
    .mapErr((error) => error.message);
}

/**
 * Read the day's slice over an open reader and print it: counts alone under `--check`, else each row with its words.
 *
 * @param args the parsed invocation
 * @param inputs the register, rules and calls due
 * @param nowMs the instant the local day is judged at
 * @returns the exit code
 */
async function answerOverReader({
  args,
  deps,
  inputs,
  nowMs,
  reader,
}: {
  args: StoreAssessmentDueArgs;
  deps: StoreAssessmentDueDeps;
  inputs: DueInputs;
  nowMs: number;
  reader: StoredRowAssessmentReader;
}): Promise<number> {
  const { check, json, limit } = args;
  const { callsDue } = inputs;
  const slice = await reader.slice({ limit, nowMs, records: inputs.records, rules: inputs.rules });
  if (slice.isErr()) {
    deps.writeDiagnostic(storeFailureLine({ error: slice.error, verb: VERB }));
    return EXIT_ERROR;
  }
  if (check) {
    printCounts({ callsDue, deps, json, limit, slice: slice.value });
    return checkExit({ callsDue, slice: slice.value });
  }
  const withText = await reader.texts({ due: slice.value.due });
  if (withText.isErr()) {
    deps.writeDiagnostic(storeFailureLine({ error: withText.error, verb: VERB }));
    return EXIT_ERROR;
  }
  printRows({ callsDue, deps, json, limit, rows: withText.value, slice: slice.value });
  return EXIT_OK;
}

/**
 * What `--check` exits with: deferred while the day's slice or (under `--with-calls`) a call is still due.
 *
 * @param callsDue the calls due, or null when not asked
 * @returns the exit code
 */
export function checkExit({ slice, callsDue }: { slice: StoredRowAssessmentSlice; callsDue: number | null }): number {
  if (slice.due.length > 0) {
    return EXIT_DEFERRED;
  }
  if (callsDue !== null && callsDue > 0) {
    return EXIT_DEFERRED;
  }
  return EXIT_OK;
}

/** The counts one invocation reports, never a word. */
interface DueCounts {
  readonly due: number;
  readonly assessedToday: number;
  readonly limit: number;
  readonly moreDue: boolean;
  readonly callsDue?: number;
}

/**
 * The slice's counts.
 *
 * @param callsDue the calls due, or null when not asked
 * @returns the counts
 */
function dueCounts({
  slice,
  limit,
  callsDue,
}: {
  slice: StoredRowAssessmentSlice;
  limit: number;
  callsDue: number | null;
}): DueCounts {
  return {
    assessedToday: slice.assessedToday,
    due: slice.due.length,
    limit,
    moreDue: slice.moreDue,
    ...(callsDue === null ? {} : { callsDue }),
  };
}

/**
 * The counts as the one line a person reads.
 *
 * @returns the line
 */
export function countsLine({ counts }: { counts: DueCounts }): string {
  let backlog = "nothing due beyond today's slice";
  if (counts.moreDue) {
    backlog = "more rows due beyond today's slice, read on a later day";
  }
  let calls = "";
  if (counts.callsDue !== undefined) {
    calls = ` · ${String(counts.callsDue)} call(s) due`;
  }
  return (
    `${String(counts.due)} stored row(s) due in today's slice · ${String(counts.assessedToday)} of ` +
    `${String(counts.limit)} assessed today · ${backlog}${calls}`
  );
}

/**
 * Print the counts: one JSON document, or one line.
 *
 * @param callsDue the calls due, or null when not asked
 */
function printCounts({
  deps,
  json,
  slice,
  limit,
  callsDue,
}: {
  deps: StoreAssessmentDueDeps;
  json: boolean;
  slice: StoredRowAssessmentSlice;
  limit: number;
  callsDue: number | null;
}): void {
  const counts = dueCounts({ callsDue, limit, slice });
  if (json) {
    deps.writeOut(JSON.stringify(counts));
    return;
  }
  deps.writeOut(countsLine({ counts }));
}

/**
 * The lines one due row prints: its key, rule and digest, then its title and body, indented.
 *
 * @param row the row with its words
 * @returns the lines
 */
export function dueRowLines({ row }: { row: DueStoredRowWithText }): readonly string[] {
  const lines = [`row ${row.table}/${row.rowId}  rule ${row.ruleId}  request ${row.requestSha256}`];
  if (row.title !== null) {
    lines.push(`  title: ${row.title}`);
  }
  for (const line of row.body.split("\n")) {
    lines.push(`  | ${line}`);
  }
  return lines;
}

/**
 * Print the slice with its words: one JSON document, or each row's lines, then the counts.
 *
 * @param rows the slice's rows with their words
 * @param callsDue the calls due, or null when not asked
 */
function printRows({
  deps,
  json,
  rows,
  slice,
  limit,
  callsDue,
}: {
  deps: StoreAssessmentDueDeps;
  json: boolean;
  rows: readonly DueStoredRowWithText[];
  slice: StoredRowAssessmentSlice;
  limit: number;
  callsDue: number | null;
}): void {
  const counts = dueCounts({ callsDue, limit, slice });
  if (json) {
    deps.writeOut(
      JSON.stringify({
        counts,
        due: rows.map((row) => ({
          body: row.body,
          requestSha256: row.requestSha256,
          rowId: row.rowId,
          ruleId: row.ruleId,
          table: row.table,
          title: row.title,
        })),
      }),
    );
    return;
  }
  for (const row of rows) {
    for (const line of dueRowLines({ row })) {
      deps.writeOut(line);
    }
  }
  deps.writeOut(countsLine({ counts }));
}

/**
 * The production seams: the register and rules under the resolved home, the store opened without a migration
 * catch-up, the call worklist, the wall clock, the logger.
 *
 * @returns the seams
 */
function productionStoreAssessmentDueDeps(): StoreAssessmentDueDeps {
  return {
    callsDue: ({ home, nowMs }) =>
      readCallAssessmentWorklist({ home: resolveHome({ named: home }), nowMs }).map((worklist) => worklist.due.length),
    loadRules: ({ home }) => loadDataClassRules(home === undefined ? {} : { home }),
    nowMs: () => Date.now(),
    openReader: async ({ home }) => {
      const opened = await connectStore({ ...(home === undefined ? {} : { home }), catchUp: false });
      return opened.map((client) => ({
        close: () => client.close(),
        slice: (input) => readStoredRowAssessmentSlice({ ...input, client }),
        texts: ({ due }) => readDueStoredRowTexts({ client, due }),
      }));
    },
    readRegister: ({ home }) => readRecordedAssessments({ home: resolveHome({ named: home }) }),
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/**
 * `slopweaver store assessment-due` on the real home, store and clock.
 *
 * @param argv the whole argv, noun and verb first
 * @returns the exit code
 */
async function runStoreAssessmentDueVerb(argv: readonly string[]): Promise<number> {
  return runStoreAssessmentDue({ deps: productionStoreAssessmentDueDeps(), rest: argv.slice(VERB_ARG_OFFSET) });
}

/** `slopweaver store assessment-due`. */
export const storeAssessmentDueCommand = defineCommand({ run: runStoreAssessmentDueVerb });
