/**
 * `slopweaver store assessment-record` — the daily reader writes down its verdicts on the stored rows
 * `store assessment-due` printed: one class per row, each with its reason, bound to the digest it was printed with.
 *
 * Each row is read again from the store before its verdict is written — its facts and its digest in one statement, never
 * its words — and is recorded only when it is still sent for assessment by the same rule and still holds the same
 * words. A row that moved is refused and named, and the others are still recorded: each verdict stands alone, so one
 * row edited since the read never costs the session the rest of its work. The register is
 * `src/store/recordedDataClassAssessment.ts`; it holds no text.
 *
 * The verdicts file is `{"verdicts":[{"table":"content|owner_capture|owner_turn","rowId":"…","ruleId":"…",
 * "requestSha256":"…","class":"public|internal|personal|restricted|undecided","reason":"…"}]}`
 * (`src/store/storedRowAssessment.ts`).
 *
 * Exit codes: a malformed flag or verdicts file is {@link EXIT_USAGE}, and nothing is recorded; a file, register,
 * rules file or store that cannot be read, or any row refused, is {@link EXIT_ERROR}, after every other row is recorded.
 */
import { readFileSync } from "node:fs";

import { err, ok, type Result } from "#lib/result.js";

import { logger } from "../../../lib/logger.js";
import { connectStore } from "../../../store/client.js";
import type { DataClassRule, DataClassRuleTable } from "../../../store/dataClassRules.js";
import { loadDataClassRules } from "../../../store/dataClassRulesFile.js";
import { type StoreError, StoreErrors } from "../../../store/errors.js";
import {
  type RecordedAssessmentError,
  type RecordedStoredRowAssessment,
  recordStoredRowAssessment,
} from "../../../store/recordedDataClassAssessment.js";
import {
  parseStoredRowVerdictsFile,
  type StoredRowVerdict,
  storedRowMismatchLine,
  storedRowVerdictMismatch,
} from "../../../store/storedRowAssessment.js";
import { readStoredRowsCurrent, type StoredRowCurrent } from "../../../store/storedRowAssessmentRead.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { parseStoreAssessmentRecordArgs } from "./assessmentArgs.js";
import { STORE_ASSESSMENT_RECORD_USAGE } from "./assessmentUsage.js";
import { storeFailureLine } from "./classifyCore.js";

/** How many argv entries precede the verb's own flags: `[node, bin, "store", "assessment-record", ...]`. */
const VERB_ARG_OFFSET = 4;

/** The verb, as every line it prints names it. */
const VERB = "store assessment-record";

/** One row's current facts and digest, never its words; `undefined` when the store does not hold it. */
type CurrentRow = StoredRowCurrent | undefined;

/** The store read the verb makes, over one open connection. */
export interface StoredRowCurrentReader {
  /**
   * Read one row's current facts and digest under a row lock and run `act` while the lock still holds, so a verdict
   * is checked against, and recorded over, words the row cannot change in between.
   */
  readonly withCurrent: <T>(input: {
    table: DataClassRuleTable;
    rowId: string;
    act: (current: CurrentRow) => T;
  }) => Promise<T>;
  readonly close: () => Promise<void>;
}

/**
 * The seams the verb performs its effects through.
 *
 * @internal — exported so a test builds plain seams of the same shape.
 */
export interface StoreAssessmentRecordDeps {
  /** A file's text; throws when it cannot be read. */
  readonly readText: (input: { path: string }) => string;
  readonly loadRules: (input: {
    home: string | undefined;
  }) => Result<readonly DataClassRule[], { readonly message: string }>;
  readonly openReader: (input: { home: string | undefined }) => Promise<Result<StoredRowCurrentReader, StoreError>>;
  /** Append the assessment, or answer the identical one already held. */
  readonly record: (input: {
    home: string | undefined;
    assessment: RecordedStoredRowAssessment;
  }) => Result<{ readonly record: RecordedStoredRowAssessment; readonly written: boolean }, RecordedAssessmentError>;
  readonly nowMs: () => number;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/** What happened to one row's verdict. */
type RowOutcome =
  | { readonly kind: "recorded"; readonly verdict: StoredRowVerdict; readonly written: boolean }
  | { readonly kind: "refused"; readonly line: string };

/**
 * Run `store assessment-record` against injected edges.
 *
 * @param rest argv after `store assessment-record`
 * @param deps the read, write and output seams
 * @returns the process exit code
 * @internal — exported so a test drives the verb over plain seams.
 */
export async function runStoreAssessmentRecord({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: StoreAssessmentRecordDeps;
}): Promise<number> {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(STORE_ASSESSMENT_RECORD_USAGE);
    return EXIT_OK;
  }
  const parsed = parseStoreAssessmentRecordArgs({ rest });
  if (parsed.isErr()) {
    for (const problem of [parsed.error.message, STORE_ASSESSMENT_RECORD_USAGE]) {
      deps.writeDiagnostic(problem);
    }
    return EXIT_USAGE;
  }
  const { home, json, verdictsFile } = parsed.value;
  let nowMs = deps.nowMs();
  if (parsed.value.nowMs !== undefined) {
    nowMs = parsed.value.nowMs;
  }
  const verdicts = loadVerdicts({ deps, verdictsFile });
  if (verdicts.isErr()) {
    deps.writeDiagnostic(verdicts.error.line);
    return verdicts.error.exit;
  }
  const rules = deps.loadRules({ home });
  if (rules.isErr()) {
    deps.writeDiagnostic(`${VERB}: ${rules.error.message}`);
    return EXIT_ERROR;
  }
  const reader = await deps.openReader({ home });
  if (reader.isErr()) {
    deps.writeDiagnostic(storeFailureLine({ error: reader.error, verb: VERB }));
    return EXIT_ERROR;
  }
  let run: RecordRun;
  try {
    run = await recordAll({ deps, home, nowMs, reader: reader.value, rules: rules.value, verdicts: verdicts.value });
  } finally {
    await reader.value.close();
  }
  if (run.failure !== undefined) {
    deps.writeDiagnostic(run.failure);
  }
  printOutcomes({ deps, json, outcomes: run.outcomes });
  const anyRefused = run.outcomes.some((outcome) => outcome.kind === "refused");
  if (run.failure !== undefined || anyRefused) {
    return EXIT_ERROR;
  }
  return EXIT_OK;
}

/**
 * Read and parse the verdicts file: an unreadable file is a failure, a malformed one a usage error.
 *
 * @param verdictsFile the path `--verdicts-file` named
 * @returns the verdicts, or the line to print and the exit code
 */
function loadVerdicts({
  deps,
  verdictsFile,
}: {
  deps: StoreAssessmentRecordDeps;
  verdictsFile: string;
}): Result<readonly StoredRowVerdict[], { readonly line: string; readonly exit: number }> {
  let text: string;
  try {
    text = deps.readText({ path: verdictsFile });
  } catch (cause) {
    return err({
      exit: EXIT_ERROR,
      line: `${VERB}: the verdicts file ${verdictsFile} could not be read (${String(cause)})`,
    });
  }
  return parseStoredRowVerdictsFile({ text }).mapErr((error) => ({
    exit: EXIT_USAGE,
    line: `${VERB}: ${error.message}`,
  }));
}

/** What a run recorded, and the failure that stopped it early, if one did. */
interface RecordRun {
  readonly outcomes: readonly RowOutcome[];
  readonly failure: string | undefined;
}

/**
 * Check and record every verdict in file order, stopping at a register or store failure with what was done so far.
 *
 * @param verdicts the parsed verdicts file
 * @returns each row's outcome, and the failure line when the run stopped early
 */
async function recordAll({
  deps,
  home,
  nowMs,
  reader,
  rules,
  verdicts,
}: {
  deps: StoreAssessmentRecordDeps;
  home: string | undefined;
  nowMs: number;
  reader: StoredRowCurrentReader;
  rules: readonly DataClassRule[];
  verdicts: readonly StoredRowVerdict[];
}): Promise<RecordRun> {
  const outcomes: RowOutcome[] = [];
  try {
    for (const verdict of verdicts) {
      const outcome = await recordOne({ deps, home, nowMs, reader, rules, verdict });
      if (outcome.isErr()) {
        return { failure: `${VERB}: ${outcome.error}`, outcomes };
      }
      outcomes.push(outcome.value);
    }
  } catch (cause) {
    return {
      failure: storeFailureLine({ error: StoreErrors.queryFailed({ cause, what: VERB }), verb: VERB }),
      outcomes,
    };
  }
  return { failure: undefined, outcomes };
}

/**
 * Check one verdict against the row as the store holds it now, and record it when it still applies — both while the
 * row is locked.
 *
 * @param verdict the session's verdict on one row
 * @returns what happened to it, or the register's failure, which stops the run
 */
async function recordOne({
  deps,
  home,
  nowMs,
  reader,
  rules,
  verdict,
}: {
  deps: StoreAssessmentRecordDeps;
  home: string | undefined;
  nowMs: number;
  reader: StoredRowCurrentReader;
  rules: readonly DataClassRule[];
  verdict: StoredRowVerdict;
}): Promise<Result<RowOutcome, string>> {
  return reader.withCurrent({
    act: (current) => checkAndRecord({ current, deps, home, nowMs, rules, verdict }),
    rowId: verdict.rowId,
    table: verdict.table,
  });
}

/**
 * The check and the append, run while the row's lock holds.
 *
 * @param current the row's facts and digest as the store holds them under the lock
 * @param verdict the session's verdict on that row
 * @returns what happened to it, or the register's failure
 */
function checkAndRecord({
  current,
  deps,
  home,
  nowMs,
  rules,
  verdict,
}: {
  current: CurrentRow;
  deps: StoreAssessmentRecordDeps;
  home: string | undefined;
  nowMs: number;
  rules: readonly DataClassRule[];
  verdict: StoredRowVerdict;
}): Result<RowOutcome, string> {
  const mismatch = storedRowVerdictMismatch({ current, rules, verdict });
  if (mismatch !== undefined) {
    return ok({ kind: "refused", line: storedRowMismatchLine({ mismatch, verdict }) });
  }
  const recorded = deps.record({
    assessment: {
      recordedAtIso: new Date(nowMs).toISOString(),
      requestSha256: verdict.requestSha256,
      ruleId: verdict.ruleId,
      subject: { kind: "stored-row", rowId: verdict.rowId, table: verdict.table },
      verdict: verdict.verdict,
      version: 2,
    },
    home,
  });
  if (recorded.isErr()) {
    if (recorded.error.code === "ASSESSMENT_CONFLICT") {
      return ok({ kind: "refused", line: recorded.error.message });
    }
    return err(recorded.error.message);
  }
  return ok({ kind: "recorded", verdict, written: recorded.value.written });
}

/**
 * The line one recorded verdict prints: the row, its class and whether this run wrote it. Never the reason, which
 * the session wrote and may echo the row's words.
 *
 * @param verdict the recorded verdict
 * @param written whether this run appended it
 * @returns the line
 */
export function recordedLine({ verdict, written }: { verdict: StoredRowVerdict; written: boolean }): string {
  let outcome: string = verdict.verdict.kind;
  if (verdict.verdict.kind === "classified") {
    outcome = verdict.verdict.dataClass;
  }
  let prefix = "already recorded";
  if (written) {
    prefix = "recorded";
  }
  return `${prefix}  ${verdict.table}/${verdict.rowId}  ${outcome}`;
}

/**
 * Print every row's outcome: one JSON document, or one line each, then a counts line.
 *
 * @param outcomes what happened to each row so far
 * @param json whether `--json` was passed
 */
function printOutcomes({
  deps,
  json,
  outcomes,
}: {
  deps: StoreAssessmentRecordDeps;
  json: boolean;
  outcomes: readonly RowOutcome[];
}): void {
  const recorded = outcomes.filter((outcome) => outcome.kind === "recorded");
  const refused = outcomes.filter((outcome) => outcome.kind === "refused");
  if (json) {
    deps.writeOut(
      JSON.stringify({
        recorded: recorded.map((outcome) => ({
          rowId: outcome.verdict.rowId,
          table: outcome.verdict.table,
          verdict: outcome.verdict.verdict.kind,
          written: outcome.written,
        })),
        refused: refused.map((outcome) => outcome.line),
      }),
    );
    return;
  }
  for (const outcome of recorded) {
    deps.writeOut(recordedLine({ verdict: outcome.verdict, written: outcome.written }));
  }
  for (const outcome of refused) {
    deps.writeOut(`refused  ${outcome.line}`);
  }
  deps.writeOut(`${String(recorded.length)} row verdict(s) recorded · ${String(refused.length)} refused`);
}

/**
 * The production seams: the disk, the rules and register under the resolved home, the store opened without a
 * migration catch-up, the wall clock, the logger.
 *
 * @returns the seams
 */
function productionStoreAssessmentRecordDeps(): StoreAssessmentRecordDeps {
  return {
    loadRules: ({ home }) => loadDataClassRules(home === undefined ? {} : { home }),
    nowMs: () => Date.now(),
    openReader: async ({ home }) => {
      const opened = await connectStore({ ...(home === undefined ? {} : { home }), catchUp: false });
      return opened.map((client) => ({
        close: () => client.close(),
        withCurrent: async ({ table, rowId, act }) =>
          client.db.transaction(async (tx) => {
            const current = await readStoredRowsCurrent({ ids: [rowId], lock: true, reader: { db: tx }, table });
            return act(current.get(rowId));
          }),
      }));
    },
    readText: ({ path }) => readFileSync(path, "utf8"),
    record: ({ home, assessment }) => recordStoredRowAssessment({ assessment, home: resolveHome({ named: home }) }),
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/**
 * `slopweaver store assessment-record` on the real home, store and clock.
 *
 * @param argv the whole argv, noun and verb first
 * @returns the exit code
 */
async function runStoreAssessmentRecordVerb(argv: readonly string[]): Promise<number> {
  return runStoreAssessmentRecord({
    deps: productionStoreAssessmentRecordDeps(),
    rest: argv.slice(VERB_ARG_OFFSET),
  });
}

/** `slopweaver store assessment-record`. */
export const storeAssessmentRecordCommand = defineCommand({ run: runStoreAssessmentRecordVerb });
