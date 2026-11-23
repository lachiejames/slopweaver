/**
 * Rendering `slopweaver access-review privileged` — the ISO A.8.2 evidence pack.
 *
 * ## An empty table prints its SUBJECT, never a bare zero
 *
 * Zero administrators and a renamed surface family produce the same empty list, and one of those readings is
 * "this organisation has no privileged accounts". So an empty table prints the platform, the kind, the read
 * stamp and how many rows were examined to reach zero — which is the difference between evidence and an
 * absence of it. `accessReview/privileged.ts` carries the same rule on the data side.
 */
import { ABSENT_FIELD_CLAUSE, readStampText, STORED_RECORDS_CLAUSE } from "../../../accessReview/boundary.js";
import type { PrivilegedRow, PrivilegedTable } from "../../../accessReview/privileged.js";
import {
  type AccessReviewReport,
  nothingRead,
  refusedPlatformsOf,
  reportBoundaryLines,
} from "../../../accessReview/report.js";

import { renderDisplay, renderLevel } from "./platformCore.js";

/** One administrator's line: role verbatim, every other level, and employment. */
function adminLine({ row }: { row: PrivilegedRow }): string {
  const levels = row.levels.map((level) => `${level.label}=${renderLevel({ value: level.value })}`).join("  ");
  const display = renderDisplay({ display: row.display });
  return `  ${row.role}  ·  ${display}  ·  ${row.email}  ·  ${employmentOf({ row })}  ·  ${levels}`;
}

/**
 * How one administrator's employment prints.
 *
 * @param row the administrator
 * @returns the roster's status and end date, or an explicit statement that the roster holds no person here
 */
export function employmentOf({ row }: { row: PrivilegedRow }): string {
  if (row.employmentStatuses.length === 0) {
    return "NO ROSTER ROW";
  }
  const statuses = [...new Set(row.employmentStatuses)].join("+");
  if (row.employmentEndIso === null) {
    return statuses;
  }
  if (row.stillEmployed === true) {
    return `${statuses} (REHIRED — an earlier spell ended ${row.employmentEndIso})`;
  }
  return `${statuses} (ended ${row.employmentEndIso})`;
}

/** One table's header, which is what makes an empty table readable. */
function tableHeader({ table, refused }: { table: PrivilegedTable; refused: readonly string[] }): string {
  const stamp = readStampText({ readStampIso: table.readStampIso });
  // A refused platform's administrators are missing from the whole table, so every count printed is a floor.
  const bound = refused.length === 0 ? "" : ` — a LOWER BOUND: ${refused.join(", ")} REFUSED its read`;
  return (
    `${table.platform}/${table.kind} · ${String(table.rows.length)} administrator(s) ` +
    `out of ${String(table.rowsExamined)} people examined · read ${stamp}${bound}`
  );
}

/**
 * The lines the privileged table prints.
 *
 * @param report the built report
 * @returns the lines, in reading order
 */
export function renderPrivileged({ report }: { report: AccessReviewReport }): readonly string[] {
  const refusal = privilegedRefusal({ report });
  if (report.privileged === null || refusal !== null) {
    return [
      `access-review privileged · REFUSED — ${String(refusal)}`,
      ...reportBoundaryLines({ report }).map((line) => `  ${line}`),
    ];
  }
  const refusedPlatforms = refusedPlatformsOf({ report });
  const refused = refusedPlatforms.map(
    (platform) => `REFUSED · ${platform} would not read, so its administrators are not listed here`,
  );
  if (report.privileged.length === 0 && refused.length === 0) {
    return [
      "access-review privileged · no platform in this report both read and declares a console role",
      ...reportBoundaryLines({ report }).map((line) => `  ${line}`),
    ];
  }
  return [
    ...refused,
    ...report.privileged.flatMap((table) => [
      tableHeader({ refused: refusedPlatforms, table }),
      ...table.rows.map((row) => adminLine({ row })),
    ]),
    "",
    ...reportBoundaryLines({ report }).map((line) => `  ${line}`),
    `  ${STORED_RECORDS_CLAUSE}`,
    `  ${ABSENT_FIELD_CLAUSE}`,
  ];
}

/**
 * The machine-readable table.
 *
 * @param report the built report
 * @returns the `--json` payload, with `tables: null` and a refusal when the spine or every platform would not
 *   read, and every refused platform named either way
 */
export function privilegedJson({ report }: { report: AccessReviewReport }): {
  readonly refusal: string | null;
  readonly refusedPlatforms: readonly string[];
  /** True when a platform refused: `tables` then lists only the administrators of the platforms that read. */
  readonly lowerBound: boolean;
  readonly tables: readonly PrivilegedTable[] | null;
  readonly boundary: readonly string[];
} {
  const boundary = [...reportBoundaryLines({ report }), STORED_RECORDS_CLAUSE, ABSENT_FIELD_CLAUSE];
  const refusedPlatforms = refusedPlatformsOf({ report });
  const refusal = privilegedRefusal({ report });
  if (report.privileged === null || refusal !== null) {
    return { boundary, lowerBound: false, refusal, refusedPlatforms, tables: null };
  }
  return {
    boundary,
    lowerBound: refusedPlatforms.length > 0,
    refusal: null,
    refusedPlatforms,
    tables: report.privileged,
  };
}

/** Why no administrator table can be printed at all, or `null` when at least one platform and the spine read. */
function privilegedRefusal({ report }: { report: AccessReviewReport }): string | null {
  if (report.privileged === null) {
    return "the Vanta roster spine would not read, so no administrator can be joined";
  }
  if (nothingRead({ report, refused: refusedPlatformsOf({ report }) })) {
    return "no access platform would read, so no administrator can be listed";
  }
  return null;
}
