/**
 * Where each applicable bump record stands against main's history — the git half of deciding which records are
 * ELIGIBLE (`./baselineBumpCoverage.ts` § "Which records count"). `./baselineBumpWitnessRun.ts` asks this once it
 * has measured what a pull request loosens, then asks the witness question of the eligible ones only.
 *
 * - A record declared against main's own commit is judged in full by the comparison that found the loosenings.
 * - A record whose base this full-history checkout does not hold, or that main's history does not contain, is
 *   INERT: history from another line of work, never a refusal and never a cover.
 * - A record declared against an OLDER main commit covers its rows only when the change measures every one of
 *   them against that commit too, so a record cannot name one commit and carry rows measured against another.
 *
 * An ancestry question git could not answer, or a measurement against a record's own base that failed, is a
 * refusal for the whole read: either could hide the record that covers a row, or one a BROKEN review contradicts.
 */

import { rowsUnmeasured } from "../devLint/baselineBump.js";
import { loosenedBetween } from "../devLint/baselineComparison.js";
import { gitAncestry, gitSucceeds } from "../devLint/gitAtCommit.js";
import { unprovenWideningLines } from "./baselineBumpCoverage.js";
import type { BumpRecord } from "./bumpRecordStore.js";

/** One record placed, with why it covers nothing; `ineligible` empty means it is eligible. */
interface PlacedRecord {
  readonly record: BumpRecord;
  readonly ineligible: readonly string[];
}

/** Every applicable record that is not inert, or the one reason the placement could not be made. */
export type Placement =
  | { readonly kind: "placed"; readonly records: readonly PlacedRecord[] }
  | { readonly kind: "refused"; readonly detail: string };

/**
 * Why a record declared against an older main commit does not hold there: one line per row the change does not
 * measure against that commit. IO edge.
 *
 * @param candidate the merge commit landing would produce
 * @returns the lines (empty when it holds), or the reason the measurement itself failed
 */
function ownBaseLines({
  root,
  candidate,
  record,
}: {
  root: string;
  candidate: string;
  record: BumpRecord;
}):
  | { readonly kind: "measured"; readonly lines: readonly string[] }
  | { readonly kind: "failed"; readonly detail: string } {
  const { base } = record.manifest;
  const measured = loosenedBetween({ base, head: candidate, root });
  if (measured.isErr()) {
    return {
      detail: `${record.path} could not be measured against its own base ${base}: ${measured.error.message}`,
      kind: "failed",
    };
  }
  const lines = rowsUnmeasured({ manifest: record.manifest, measured: measured.value }).map(
    (row) =>
      `  ${record.path}: declares ${row.file} ${row.entry} ${String(row.from)} -> ${String(row.to)}, which the ` +
      `change does not measure against its own base ${base.slice(0, 12)}`,
  );
  return { kind: "measured", lines };
}

/**
 * Place every applicable record against main's commit, dropping the inert ones. IO edge.
 *
 * @param applicable the records whose every row the change loosens
 * @param baseSha main's commit the change is judged against
 * @param candidate the merge commit landing would produce
 * @param changedPaths every path the change touched against main, which a `widening` row must leave alone
 * @param root a full-history checkout holding `baseSha` and `candidate`
 * @returns the placed records, or why the placement could not be made
 */
export function placeRecords({
  applicable,
  baseSha,
  candidate,
  changedPaths,
  root,
}: {
  applicable: readonly BumpRecord[];
  baseSha: string;
  candidate: string;
  changedPaths: ReadonlySet<string>;
  root: string;
}): Placement {
  const records: PlacedRecord[] = [];
  for (const record of applicable) {
    const { base } = record.manifest;
    const widening = unprovenWideningLines({ changedPaths, record });
    if (base === baseSha) {
      records.push({ ineligible: widening, record });
      continue;
    }
    // `root` has its whole history and holds `baseSha`, so a base it lacks is not in main's history.
    if (!gitSucceeds({ args: ["cat-file", "-e", `${base}^{commit}`], root })) {
      continue;
    }
    const ancestry = gitAncestry({ ancestor: base, descendant: baseSha, root });
    if (ancestry === "error") {
      return {
        detail: `git could not say whether ${record.path}'s base ${base} is in main's history`,
        kind: "refused",
      };
    }
    if (ancestry === "no") {
      continue;
    }
    const own = ownBaseLines({ candidate, record, root });
    if (own.kind === "failed") {
      return { detail: own.detail, kind: "refused" };
    }
    records.push({ ineligible: [...own.lines, ...widening], record });
  }
  return { kind: "placed", records };
}
