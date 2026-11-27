/**
 * Which loosened rows a pull request may land, given the bump records in the home — the pure half of the landing
 * read (`./baselineBumpWitnessRun.ts` resolves every git and ledger fact first, then asks this).
 *
 * ## Coverage per ROW, not a witness for every record
 *
 * The store is append-only and shared by every branch, so it holds abandoned attempts: a record declared against
 * an earlier base, a record whose reason was wrong and was re-declared, a subset of what a later change loosens.
 * A pull request clears when EVERY row it loosens is declared by at least one ELIGIBLE record that has a
 * qualifying Codex witness, and no eligible record carries a CURRENT, unretired BROKEN review. Requiring every
 * applicable record to be witnessed would let one abandoned record hold every later change that happens to
 * loosen the same rows; it buys no safety, since an unwitnessed record covers nothing.
 *
 * A multi-row record is witnessed as a whole or not at all: its claim names every row, so one witness answers for
 * all of them, and an unwitnessed one covers none.
 *
 * ## Which records count
 *
 * - **Applicable**: every row it declares is a row this change loosens ({@link recordApplies}). One that declares
 *   anything else is history, and inert.
 * - **Eligible**: applicable, anchored (its base is main's or an ancestor main holds), reproduced against its own
 *   base when that is older, and every `widening` row it declares names a file this change leaves untouched. An
 *   applicable record that fails one of these covers nothing, and the refusal names why when a row it declares is
 *   left uncovered.
 */

import { type BumpRow, provenUnchanged, rowKey } from "../devLint/baselineBump.js";
import type { Loosening } from "../devLint/baselineRegistry.js";
import { type UnwitnessedManifest, unwitnessedDetail } from "./baselineBumpWitness.js";
import type { BumpRecord } from "./bumpRecordStore.js";

/**
 * Whether every row a record declares is one the change loosened. Pure.
 *
 * @param record the bump record
 * @param loosenedKeys the change's loosenings, by {@link rowKey}
 * @returns `true` when the record declares nothing the change does not loosen
 */
export function recordApplies({
  record,
  loosenedKeys,
}: {
  record: BumpRecord;
  loosenedKeys: ReadonlySet<string>;
}): boolean {
  return record.manifest.loosenings.every((row) => loosenedKeys.has(rowKey({ row })));
}

/**
 * The lines naming each `widening` row a record declares on a file the change touches — a claim the change
 * disproves, so the record covers nothing. Pure.
 *
 * @param record the bump record
 * @param changedPaths every path the change touched against main
 * @returns one line per disproved row; empty when every widening row holds
 */
export function unprovenWideningLines({
  record,
  changedPaths,
}: {
  record: BumpRecord;
  changedPaths: ReadonlySet<string>;
}): readonly string[] {
  return record.manifest.loosenings
    .filter(
      (row: BumpRow) =>
        row.cause === "widening" &&
        !provenUnchanged({ changedPaths, entry: row.entry, identityTuple: row.identityTuple }),
    )
    .map(
      (row) =>
        `  ${record.path}: declares ${row.file} ${row.entry} as widening, but the change touches the file it ` +
        "names, so this record cannot cover the row",
    );
}

/** One applicable record as the landing read resolved it. */
export interface JudgedRecord {
  readonly record: BumpRecord;
  /** Why it covers nothing — its own-base mismatch or a disproved widening row; empty when it is eligible. */
  readonly ineligible: readonly string[];
  /**
   * The witness verdict for an eligible record: `witnessed`, or the detail line naming what was found instead and
   * whether a CURRENT BROKEN review contradicts it. `undefined` for an ineligible one, which is never asked.
   */
  readonly witness:
    | { readonly kind: "witnessed" }
    | { readonly kind: "unwitnessed"; readonly detail: string; readonly contradicted: boolean }
    | undefined;
}

/**
 * Resolve each placed record against the witness read: an ineligible one is never asked, and an eligible one is
 * witnessed unless the read named it without a qualifying witness. Pure.
 *
 * @param placed every applicable record that is not inert, with why it covers nothing
 * @param unwitnessed the eligible records the witness read found unwitnessed, keyed by record path
 * @returns the records as {@link coverageRefusalLines} judges them
 */
export function judgeRecords({
  placed,
  unwitnessed,
}: {
  placed: readonly { readonly record: BumpRecord; readonly ineligible: readonly string[] }[];
  unwitnessed: ReadonlyMap<string, UnwitnessedManifest>;
}): readonly JudgedRecord[] {
  return placed.map(({ ineligible, record }): JudgedRecord => {
    const found = unwitnessed.get(record.path);
    if (ineligible.length > 0) {
      return { ineligible, record, witness: undefined };
    }
    if (found === undefined) {
      return { ineligible, record, witness: { kind: "witnessed" } };
    }
    const detail = unwitnessedDetail({ unwitnessed: found });
    return {
      ineligible,
      record,
      witness: { contradicted: found.contradictedBy.length > 0, detail, kind: "unwitnessed" },
    };
  });
}

/**
 * Render one uncovered row. Pure.
 *
 * @param row the loosening
 * @param declared whether any applicable record declares it at all
 * @returns the indented line
 */
function uncoveredLine({ row, declared }: { row: Loosening; declared: boolean }): string {
  const why = declared
    ? "no applicable store bump record declaring it has a qualifying Codex witness"
    : "no applicable store bump record declares this loosening";
  return `  ${row.file} ${row.entry}: ${String(row.from)} -> ${String(row.to)} (${why})`;
}

/**
 * Every line the landing refuses on, or none when the change may land. Pure.
 *
 * Ordered: each eligible record a CURRENT BROKEN review contradicts, then each uncovered row in the order the
 * comparison computed it, then — once each, in record order — why every applicable record declaring an
 * uncovered row could not cover it.
 *
 * @param loosened every row the change loosened against main
 * @param judged every applicable record, resolved
 * @returns the indented refusal lines; empty when every row is covered and nothing is contradicted
 */
export function coverageRefusalLines({
  loosened,
  judged,
}: {
  loosened: readonly Loosening[];
  judged: readonly JudgedRecord[];
}): readonly string[] {
  const contradicted = judged.flatMap((one) =>
    one.witness?.kind === "unwitnessed" && one.witness.contradicted ? [`  ${one.witness.detail}`] : [],
  );
  const keysOf = ({ one }: { one: JudgedRecord }): ReadonlySet<string> =>
    new Set(one.record.manifest.loosenings.map((row) => rowKey({ row })));
  const covering = new Set(
    judged.filter((one) => one.witness?.kind === "witnessed").flatMap((one) => [...keysOf({ one })]),
  );
  const declaring = new Set(judged.flatMap((one) => [...keysOf({ one })]));
  const uncovered = loosened.filter((row) => !covering.has(rowKey({ row })));
  const uncoveredKeys = new Set(uncovered.map((row) => rowKey({ row })));
  const reasons = judged
    .filter((one) => [...keysOf({ one })].some((key) => uncoveredKeys.has(key)))
    .flatMap((one) => {
      if (one.ineligible.length > 0) {
        return one.ineligible;
      }
      return one.witness?.kind === "unwitnessed" && !one.witness.contradicted ? [`  ${one.witness.detail}`] : [];
    });
  return [
    ...contradicted,
    ...uncovered.map((row) => uncoveredLine({ declared: declaring.has(rowKey({ row })), row })),
    ...reasons,
  ];
}
