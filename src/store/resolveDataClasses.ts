/**
 * The pass that classifies every row the store ALREADY holds: `slopweaver store classify`.
 *
 * ## Why a pass, and not part of the migration that added the column
 *
 * The same reason `./resolveBots.ts` gives: the migration adding `data_class` is a catalog change that finishes
 * instantly, while sorting every stored row is a data pass that must be safe to interrupt and safe to run again.
 * Intake writes a class on every new `content` row (`./ingest.ts`); this exists for the rows written before it did,
 * for `owner_capture` and `owner_turn`, which are not sorted at write yet, for a rules change, and for the verdicts the
 * daily visible session recorded since (`store assessment-record`): a row a rule sends for assessment takes the class
 * the assessment port answers for the digest of its current words (`./storedRowAssessmentRead.ts`), `unknown` without
 * one. The port's register is read once per pass, and a register that cannot be read refuses the pass.
 *
 * ## The sorting is NOT repeated here
 *
 * Every class comes from `./dataClassRules.ts`'s sorter, over facts built by `./dataClassIntake.ts`'s builders, the
 * same functions intake calls: the reads in `./dataClassStatements.ts` select exactly those facts back and nothing
 * else. The page decisions and the tally are `./dataClassResolution.ts`'s, pure.
 *
 * ## What "nothing left unclassified" means, table by table
 *
 * The three tables with a `data_class` column end with an EXPLICIT class on every row, `unknown` written where no
 * rule decides or an assessment would, and an applying pass reads them back and reports any `NULL` still standing.
 * Every other table the census (`./dataClassCensus.ts`) declares has no class column: it is counted, row for row,
 * and reported as failing closed, which is what the census already says a consumer does with it. A home register or
 * home path is a place, never a record: it is listed by its declared name and never read.
 *
 * ## Safe to interrupt, and idempotent
 *
 * Each page commits on its own, so an interrupted pass is finished by running it again, and a second complete pass
 * under unchanged rules writes nothing. A write only touches a row whose stored class still differs, so a row an
 * ingest rewrote between the read and the write is left as intake wrote it.
 */
import { err, ok, type Result } from "#lib/result.js";

import type { StoreClient, StoreReader } from "./client.js";
import type { DataClass } from "./dataClass.js";
import { dataClassCensus } from "./dataClassCensus.js";
import {
  type DataClassCandidate,
  type DataClassCounts,
  type DataClassDecision,
  type DataClassOutcomeCount,
  type DataClassRowRef,
  type DataClassTableTally,
  dataClassAssessmentAsks,
  dataClassPageDecisions,
  emptySamples,
  emptyTally,
  MAX_SAMPLE_PER_CLASS,
  tallyPage,
} from "./dataClassResolution.js";
import {
  type AssignedDataClass,
  type DataClassAssessment,
  type DataClassRule,
  type DataClassRuleTable,
  sortDataClass,
} from "./dataClassRules.js";
import {
  CLASSIFY_BATCH_ROWS,
  countRows,
  countUnclassifiedTables,
  PAGE_READERS,
  storedCounts,
  type UnclassifiedTableCount,
  writeClasses,
} from "./dataClassStatements.js";
import { declaredTableNames } from "./declared.js";
import { type StoreError, StoreErrors } from "./errors.js";
import { HOME_REGISTERS } from "./homeRegisters.js";
import { readStoredRowsCurrent } from "./storedRowAssessmentRead.js";

/** The classified tables, in the order the pass walks them. */
const CLASSIFIED_TABLES: readonly DataClassRuleTable[] = ["content", "owner_capture", "owner_turn"];

/** One classified table's part of the report. */
export interface DataClassTableReport {
  readonly table: DataClassRuleTable;
  readonly scanned: number;
  /** Rows whose stored class differed from the derived one when read. */
  readonly differing: number;
  /** Rows the write-back changed; 0 on a dry run. */
  readonly written: number;
  /** Stored counts read back after an applying pass, or the derived counts a dry run projects. */
  readonly classes: DataClassCounts;
  /** Rows still holding no class after an applying pass; on a dry run, the rows that hold none today. */
  readonly nulls: number;
  readonly outcomes: readonly DataClassOutcomeCount[];
}

/** What one `store classify` pass did, counts and declared names only. */
export interface DataClassificationReport {
  readonly dryRun: boolean;
  readonly tables: readonly DataClassTableReport[];
  /** Every census table with no class column: each row of it is treated as `unknown`, which is `restricted`. */
  readonly unclassifiedTables: readonly UnclassifiedTableCount[];
  /** Every home register and home path the census names: places, never read, never classified. */
  readonly places: readonly string[];
  /** Row refs of the most private classes, only when a sample was asked for; empty otherwise. */
  readonly samples: readonly { readonly dataClass: DataClass; readonly refs: readonly DataClassRowRef[] }[];
}

/** A progress callback: how far through which table the pass is. Counts only. */
export type DataClassProgress = (event: { table: DataClassRuleTable; done: number; total: number }) => void;

/** What one classified table's walk needs, beside the table itself. */
interface WalkSettings {
  readonly client: StoreClient;
  readonly rules: readonly DataClassRule[];
  readonly assessment: DataClassAssessment;
  readonly dryRun: boolean;
  readonly batch: number;
  /** The run's sample buckets, or undefined when none was asked for. */
  readonly samples: Map<DataClass, DataClassRowRef[]> | undefined;
  /** The most refs per sampled class. */
  readonly sampleCap: number;
  readonly onProgress: DataClassProgress | undefined;
}

/**
 * Ask the assessment port about every row of one page the rules send for assessment. Those rows are read again, facts
 * and digest together and locked (`./storedRowAssessmentRead.ts`), and routed again over what that read returned, so
 * the port is asked about the rule and words the row holds while the page's write runs. Never their words.
 *
 * @param settings the run's rules and assessment port
 * @param reader the transaction the page's write runs in, or the pool on a dry run
 * @param table the classified table
 * @param page the page just read
 * @returns the class answered for each row the port classified, by row id, or the port's failure
 */
async function assessedClasses({
  settings,
  reader,
  table,
  page,
}: {
  settings: WalkSettings;
  reader: StoreReader;
  table: DataClassRuleTable;
  page: readonly DataClassCandidate[];
}): Promise<Result<ReadonlyMap<string, AssignedDataClass>>> {
  const { assessment, rules } = settings;
  const asks = dataClassAssessmentAsks({ page, rules });
  const classes = new Map<string, AssignedDataClass>();
  if (asks.length === 0) {
    return ok(classes);
  }
  const ids = asks.map((ask) => ask.ref.id);
  const current = await readStoredRowsCurrent({ ids, lock: !settings.dryRun, reader, table });
  for (const ask of asks) {
    const row = current.get(ask.ref.id);
    // A row gone since the page read has nothing to class; one whose facts moved off this rule keeps the page's
    // fail-closed `unknown`. Either way the port is never asked about a rule or words the row no longer holds.
    if (row === undefined) {
      continue;
    }
    const routed = sortDataClass({ facts: row.facts, rules });
    if (routed.kind !== "needs-assessment" || routed.ruleId !== ask.ruleId) {
      continue;
    }
    const verdict = await assessment({
      request: {
        subject: { kind: "stored-row", requestSha256: row.requestSha256, rowId: ask.ref.id, ruleId: ask.ruleId, table },
      },
    });
    if (verdict.isErr()) {
      return err([verdict.error.message]);
    }
    if (verdict.value.kind === "classified") {
      classes.set(ask.ref.id, verdict.value.dataClass);
    }
  }
  return ok(classes);
}

/**
 * Decide one page and, unless a dry run, write it — over one reader, so on an applying pass the assessed rows' lock
 * holds from their re-read until their class is written.
 *
 * @param settings the run's rules, assessment port and mode
 * @param reader the transaction the page runs in, or the pool on a dry run
 * @param table the classified table
 * @param page the page just read
 * @returns the page's decisions and how many rows the write changed, or the assessment port's failure
 */
async function decidePage({
  settings,
  reader,
  table,
  page,
}: {
  settings: WalkSettings;
  reader: StoreReader;
  table: DataClassRuleTable;
  page: readonly DataClassCandidate[];
}): Promise<Result<{ readonly decisions: readonly DataClassDecision[]; readonly written: number }>> {
  const assessed = await assessedClasses({ page, reader, settings, table });
  if (assessed.isErr()) {
    return err(assessed.error);
  }
  const decisions = dataClassPageDecisions({ assessed: assessed.value, page, rules: settings.rules });
  const toWrite = decisions.filter((decision) => decision.shouldWrite);
  const skipWrite = settings.dryRun || toWrite.length === 0;
  const written = skipWrite ? 0 : await writeClasses({ client: reader, decisions: toWrite, table });
  return ok({ decisions, written });
}

/**
 * Walk one classified table, page by page, deciding and (unless a dry run) writing each page.
 *
 * @param settings the run's store, rules, assessment port, mode, page size, sample buckets and progress callback
 * @param table the classified table
 * @param total the table's row count, for progress
 * @returns the table's tally, or the assessment port's failure
 */
async function walkTable({
  settings,
  table,
  total,
}: {
  settings: WalkSettings;
  table: DataClassRuleTable;
  total: number;
}): Promise<Result<DataClassTableTally>> {
  const { batch, client, dryRun, onProgress, sampleCap, samples } = settings;
  const tally = emptyTally({ table });
  let after: string | null = null;
  for (;;) {
    const page: readonly DataClassCandidate[] = await PAGE_READERS[table]({ after, batch, client });
    const last = page.at(-1);
    if (last === undefined) {
      return ok(tally);
    }
    const decided = dryRun
      ? await decidePage({ page, reader: client, settings, table })
      : await client.db.transaction(async (tx) => decidePage({ page, reader: { db: tx }, settings, table }));
    if (decided.isErr()) {
      return err(decided.error);
    }
    const { decisions, written } = decided.value;
    tallyPage({ decisions, sampleCap, samples, tally, written });
    onProgress?.({ done: tally.scanned, table, total });
    after = last.ref.id;
  }
}

/**
 * One classified table's report from its tally: stored counts read back after an applying pass, or the derived
 * counts projected by a dry run, with the rows that held no class when read standing as its `nulls`.
 *
 * @param client the open store
 * @param tally the walked table's tally
 * @param dryRun whether the pass wrote nothing
 * @param nullsBefore how many rows held no class before the walk, reported by a dry run
 * @returns the report row
 */
async function tableReport({
  client,
  tally,
  dryRun,
  nullsBefore,
}: {
  client: StoreClient;
  tally: DataClassTableTally;
  dryRun: boolean;
  nullsBefore: number;
}): Promise<Result<DataClassTableReport>> {
  const base = {
    differing: tally.differing,
    outcomes: [...tally.outcomes.values()].toSorted((a, b) => b.rows - a.rows),
    scanned: tally.scanned,
    table: tally.table,
    written: tally.written,
  };
  if (dryRun) {
    return ok({ ...base, classes: { ...tally.derived }, nulls: nullsBefore });
  }
  const stored = await storedCounts({ client, table: tally.table });
  return stored.map(({ classes, nulls }) => ({ ...base, classes, nulls }));
}

/**
 * Count, walk and report one classified table.
 *
 * @param settings the run's store, rules, mode, page size, sample buckets and progress callback
 * @param table the classified table
 * @returns the table's report, or why a count or read-back failed
 */
async function classifyTable({
  settings,
  table,
}: {
  settings: WalkSettings;
  table: DataClassRuleTable;
}): Promise<Result<DataClassTableReport>> {
  const { client, dryRun } = settings;
  const total = await countRows({ client, table });
  if (total.isErr()) {
    return err(total.error);
  }
  const before = await storedCounts({ client, table });
  if (before.isErr()) {
    return err(before.error);
  }
  const tally = await walkTable({ settings, table, total: total.value });
  if (tally.isErr()) {
    return err(tally.error);
  }
  return tableReport({ client, dryRun, nullsBefore: before.value.nulls, tally: tally.value });
}

/**
 * Classify every row the store holds, and count everything the census says cannot hold a class.
 *
 * @param client the open store
 * @param rules the composed rules, loaded once for the whole pass
 * @param assessment the port answering a row the rules send for assessment, its register read once for the pass
 * @param dryRun compute and report everything, write nothing
 * @param batch rows per page
 * @param sample how many row refs to keep per most-private class; absent keeps none
 * @param onProgress the progress callback
 * @returns the report, or the store's typed failure
 */
export async function resolveDataClasses({
  client,
  rules,
  assessment,
  dryRun,
  batch = CLASSIFY_BATCH_ROWS,
  sample,
  onProgress,
}: {
  client: StoreClient;
  rules: readonly DataClassRule[];
  assessment: DataClassAssessment;
  dryRun: boolean;
  batch?: number;
  sample?: number;
  onProgress?: DataClassProgress;
}): Promise<Result<DataClassificationReport, StoreError>> {
  const census = dataClassCensus({ declaredTables: declaredTableNames(), registers: HOME_REGISTERS });
  const fail = ({ cause }: { cause: string }): Result<DataClassificationReport, StoreError> =>
    err(StoreErrors.queryFailed({ cause, what: "store classify" }));
  if (census.undeclaredTables.length > 0) {
    const undeclared = census.undeclaredTables.join(", ");
    return fail({ cause: `the data-class census declares no decision for ${undeclared}` });
  }
  const samples = sample === undefined ? undefined : emptySamples();
  const sampleCap = sample === undefined ? 0 : Math.min(sample, MAX_SAMPLE_PER_CLASS);
  const settings: WalkSettings = { assessment, batch, client, dryRun, onProgress, rules, sampleCap, samples };
  try {
    const tables: DataClassTableReport[] = [];
    for (const table of CLASSIFIED_TABLES) {
      const report = await classifyTable({ settings, table });
      if (report.isErr()) {
        return fail({ cause: report.error.join("; ") });
      }
      tables.push(report.value);
    }
    const unclassified = await countUnclassifiedTables({
      client,
      tables: census.tables.filter((row) => row.entry?.kind === "unclassified").map((row) => row.name),
    });
    if (unclassified.isErr()) {
      return fail({ cause: unclassified.error.join("; ") });
    }
    return ok({
      dryRun,
      places: [...census.registers.map((row) => row.name), ...census.homePaths.map((row) => row.name)],
      samples: samples === undefined ? [] : [...samples].map(([dataClass, refs]) => ({ dataClass, refs })),
      tables,
      unclassifiedTables: unclassified.value,
    });
  } catch (error: unknown) {
    return err(StoreErrors.queryFailed({ cause: error, what: "store classify" }));
  }
}
