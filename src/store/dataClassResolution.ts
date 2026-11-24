/**
 * The pure half of `store classify`: what one page of stored rows should be written with, and the count-only tally
 * the pass reports. The reads and writes are `./resolveDataClasses.ts`'s.
 *
 * ## The class is a function of a row's facts and the rules, so it is re-derived both ways
 *
 * Every row a classified table holds is sorted again by `./dataClassRules.ts`, and a row is written whenever its
 * derived class differs from the one stored, narrower or wider, exactly as `./resolveBots.ts` clears a flag an older
 * rule set: intake's own conflict refresh replaces `data_class` the same way, so no stored class is a verdict the
 * rules cannot revisit. A stored `NULL` always differs, because `unknown` is written EXPLICITLY: the comparison is on
 * the raw stored value, never through `effectiveDataClass`, which would read `NULL` and `unknown` as the same and
 * leave a row the pass reached indistinguishable from one it never did.
 *
 * ## What leaves this module is counts, plus ids only on request
 *
 * A tally carries numbers, class names and rule ids. A sample, collected only when asked for and only for the most
 * private classes, is `{ table, id }` and nothing else: no body, title, container, author or source value.
 */
import { err, ok, type Result } from "#lib/result.js";

import { DATA_CLASSES, type DataClass } from "./dataClass.js";
import {
  type DataClassFacts,
  type DataClassOutcome,
  type DataClassRule,
  type DataClassRuleTable,
  sortDataClass,
  storedDataClass,
} from "./dataClassRules.js";

/** One stored row, named by its table and its primary key. */
export interface DataClassRowRef {
  readonly table: DataClassRuleTable;
  readonly id: string;
}

/** One stored row as the pass reads it: its facts, and the class already stored (null when none). */
export interface DataClassCandidate {
  readonly ref: DataClassRowRef;
  readonly facts: DataClassFacts;
  readonly stored: DataClass | null;
}

/** What the pass decided for one stored row. */
export interface DataClassDecision {
  readonly ref: DataClassRowRef;
  readonly outcome: DataClassOutcome;
  readonly derived: DataClass;
  /** True when the stored value is not the derived one, a stored `NULL` included. */
  readonly shouldWrite: boolean;
}

/** The classes a sample is taken of: the most private, `unknown` included because it reads as `restricted`. */
export const SAMPLED_DATA_CLASSES: readonly DataClass[] = ["restricted", "personal", "unknown"];

/** The most row refs one sample holds per class, so a diagnostic can never become a corpus-sized id list. */
export const MAX_SAMPLE_PER_CLASS = 100;

/**
 * Decide one page: sort each row and say whether its stored class must be rewritten.
 *
 * @param page one keyset-ordered read
 * @param rules the run's composed rules, loaded once
 * @returns one decision per row, in page order
 */
export function dataClassPageDecisions({
  page,
  rules,
}: {
  page: readonly DataClassCandidate[];
  rules: readonly DataClassRule[];
}): readonly DataClassDecision[] {
  return page.map((row) => {
    const outcome = sortDataClass({ facts: row.facts, rules });
    const derived = storedDataClass({ outcome });
    return { derived, outcome, ref: row.ref, shouldWrite: row.stored !== derived };
  });
}

/** One rule outcome's count: which rule decided, how, and what class the row is written with. */
export interface DataClassOutcomeCount {
  readonly kind: DataClassOutcome["kind"];
  /** The rule that decided, or null when no rule matched. */
  readonly ruleId: string | null;
  readonly dataClass: DataClass;
  readonly rows: number;
}

/** A count for every class, zeroes included. */
export type DataClassCounts = Readonly<Record<DataClass, number>>;

/**
 * A count of zero for every class.
 *
 * @returns the zeroed counts
 */
export function zeroDataClassCounts(): Record<DataClass, number> {
  return { internal: 0, personal: 0, public: 0, restricted: 0, unknown: 0 };
}

/** The running tally of one table's pass. Mutable: {@link tallyPage} folds each page into it. */
export interface DataClassTableTally {
  readonly table: DataClassRuleTable;
  scanned: number;
  differing: number;
  written: number;
  /** The class every scanned row derived. */
  readonly derived: Record<DataClass, number>;
  /** Outcome counts, keyed by {@link outcomeKey}. */
  readonly outcomes: Map<string, DataClassOutcomeCount>;
}

/**
 * A fresh tally for one table.
 *
 * @param table the classified table the pass walks
 * @returns the empty tally
 */
export function emptyTally({ table }: { table: DataClassRuleTable }): DataClassTableTally {
  return { derived: zeroDataClassCounts(), differing: 0, outcomes: new Map(), scanned: 0, table, written: 0 };
}

/**
 * The rule id an outcome names, or null for no match.
 *
 * @param outcome the sorter's outcome
 * @returns the deciding rule's id, or null
 */
function outcomeRuleId({ outcome }: { outcome: DataClassOutcome }): string | null {
  if (outcome.kind === "unknown") {
    return null;
  }
  return outcome.ruleId;
}

/**
 * The key one outcome count is filed under.
 *
 * @param decision the decision being counted
 * @returns `kind|ruleId|class`
 */
function outcomeKey({ decision }: { decision: DataClassDecision }): string {
  const ruleId = outcomeRuleId({ outcome: decision.outcome });
  // `join` renders a null rule id as the empty string, so a rule-less outcome keys as `kind||class`.
  return [decision.outcome.kind, ruleId, decision.derived].join("|");
}

/**
 * Fold one decided page into a table's tally and the shared sample, in place.
 *
 * @param tally the table's running tally
 * @param decisions the page's decisions
 * @param written how many of the page's rows the write-back actually changed; 0 on a dry run
 * @param samples the run's sample per class, or undefined when no sample was asked for
 * @param sampleCap the most refs a sample class may hold
 */
export function tallyPage({
  tally,
  decisions,
  written,
  samples,
  sampleCap,
}: {
  tally: DataClassTableTally;
  decisions: readonly DataClassDecision[];
  written: number;
  samples: Map<DataClass, DataClassRowRef[]> | undefined;
  sampleCap: number;
}): void {
  tally.scanned += decisions.length;
  tally.written += written;
  for (const decision of decisions) {
    tally.derived[decision.derived] += 1;
    if (decision.shouldWrite) {
      tally.differing += 1;
    }
    const key = outcomeKey({ decision });
    const seen = tally.outcomes.get(key);
    tally.outcomes.set(key, {
      dataClass: decision.derived,
      kind: decision.outcome.kind,
      rows: seen === undefined ? 1 : seen.rows + 1,
      ruleId: outcomeRuleId({ outcome: decision.outcome }),
    });
    const bucket = samples === undefined ? undefined : samples.get(decision.derived);
    if (bucket !== undefined && bucket.length < sampleCap) {
      bucket.push(decision.ref);
    }
  }
}

/**
 * The empty sample buckets a run fills, one per sampled class.
 *
 * @returns the buckets, in {@link SAMPLED_DATA_CLASSES} order
 */
export function emptySamples(): Map<DataClass, DataClassRowRef[]> {
  return new Map(SAMPLED_DATA_CLASSES.map((dataClass) => [dataClass, []]));
}

/**
 * Decode one `count(*)::text` read strictly: anything but a non-negative whole number in text refuses, never reads
 * as zero.
 *
 * @param value the count column as the driver returned it
 * @param what what was counted, named in the fault
 * @returns the count, or why it is not one
 */
export function decodeRowCount({ value, what }: { value: unknown; what: string }): Result<number> {
  const count = Number(value);
  if (typeof value !== "string" || value.length === 0 || !Number.isInteger(count) || count < 0) {
    return err([`the row count of ${what} read back as ${String(value)}, not a whole number`]);
  }
  return ok(count);
}

/** One stored class count row as `group by data_class` returns it: the class text, or null, and a count. */
export interface StoredClassCountRow {
  readonly dataClass: unknown;
  readonly rows: unknown;
}

/** What a table's stored classes are once the pass has run. */
export interface StoredClassCounts {
  readonly classes: DataClassCounts;
  /** Rows still holding no class at all: zero on a complete pass. */
  readonly nulls: number;
}

/**
 * Decode a `group by data_class` read strictly: a count that is not a non-negative whole number, or a class the
 * vocabulary does not name, refuses the whole read rather than reading as zero.
 *
 * @param rows the grouped rows, class text (or null) and count text
 * @returns the counts per class and the rows with none, or the first fault found
 */
export function decodeStoredClassCounts({ rows }: { rows: readonly StoredClassCountRow[] }): Result<StoredClassCounts> {
  const classes = zeroDataClassCounts();
  let nulls = 0;
  for (const row of rows) {
    const decoded = decodeRowCount({ value: row.rows, what: "one data class" });
    if (decoded.isErr()) {
      return err(decoded.error);
    }
    const count = decoded.value;
    if (row.dataClass === null) {
      nulls += count;
      continue;
    }
    const named = DATA_CLASSES.find((one) => one === row.dataClass);
    if (named === undefined) {
      return err(["the store holds a data class the vocabulary does not name"]);
    }
    classes[named] += count;
  }
  return ok({ classes, nulls });
}
