/**
 * The two policy tables whose rows each describe one integration, derived from its manifest: the browser write-policy
 * register (`src/admit/browserSurface.ts`) and the access review's platforms (`src/accessReview/levels.ts`).
 *
 * A module of its own for the reason `./connections.ts` is: the corpus source lists are about ingesting integrations,
 * and these rows are about platforms a browser reaches or an auditor reads. Only type imports, as with every projector
 * here.
 */
import type { AccessPlatformSpec } from "../accessReview/levels.js";
import type { RegisteredPlatform } from "../admit/browserSurface.js";
import type { IntegrationManifest } from "./manifest.js";

/** One row of a table whose order is declared, one `ordinal` per row. */
interface OrdinalRow {
  readonly ordinal: number;
}

/**
 * Rows in ordinal order, refusing a shared number: a tie would leave the order to whichever manifest loaded first.
 *
 * @param rows the rows to order
 * @param table the table's name, for the refusal
 * @returns the rows, sorted
 * @throws when two rows share an ordinal
 */
function inOrdinalOrder<Row extends OrdinalRow>({
  rows,
  table,
}: {
  rows: readonly Row[];
  table: string;
}): readonly Row[] {
  const sorted = rows.toSorted((left, right) => left.ordinal - right.ordinal);
  if (new Set(sorted.map((row) => row.ordinal)).size !== sorted.length) {
    throw new Error(`${table}: two rows share an ordinal: ${sorted.map((row) => String(row.ordinal)).join(", ")}`);
  }
  return sorted;
}

/**
 * Every platform a browser may write to, in register order, frozen.
 *
 * @param manifests the integrations to derive from, in any order
 * @returns one register row per integration that declares one
 */
export function browserWriteRowsOf({
  manifests,
}: {
  manifests: readonly IntegrationManifest[];
}): readonly RegisteredPlatform[] {
  const rows = manifests.flatMap((manifest) => (manifest.browserWrite === undefined ? [] : [manifest.browserWrite]));
  const register = inOrdinalOrder({ rows, table: "browser write register" }).map((entry) => entry.row);
  Object.freeze(register);
  return register;
}

/** The access review's platforms, the spine held apart because every other row is judged against it. */
export interface AccessReviewRows {
  readonly accessLevels: readonly AccessPlatformSpec[];
  readonly rosterSpine: AccessPlatformSpec;
}

/**
 * The access review's platforms, in report order, frozen.
 *
 * @param manifests the integrations to derive from, in any order
 * @returns the rows that carry a per-user level, and the one roster spine
 * @throws when the manifests declare no spine or more than one, since the report has nothing to judge against
 */
export function accessReviewRowsOf({ manifests }: { manifests: readonly IntegrationManifest[] }): AccessReviewRows {
  const rows = inOrdinalOrder({
    rows: manifests.flatMap((manifest) => (manifest.accessReview === undefined ? [] : [manifest.accessReview])),
    table: "access review",
  });
  const spines = rows.filter((row) => row.role === "roster-spine");
  if (spines.length !== 1) {
    throw new Error(`access review: expected exactly one roster spine, found ${String(spines.length)}`);
  }
  const accessLevels = rows.filter((row) => row.role === "access-level").map((row) => row.spec);
  Object.freeze(accessLevels);
  return { accessLevels, rosterSpine: spines[0]!.spec };
}
