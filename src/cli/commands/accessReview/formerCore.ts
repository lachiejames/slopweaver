/**
 * Rendering `slopweaver access-review former` — the three-bucket join, and the residue the buckets do not
 * cover.
 *
 * ## The unmeasured bucket is PRINTED, and that is the point of the verb
 *
 * A report that printed only the confirmed bucket would make the next resync look like a spike of new
 * violations when it is really the unmeasured bucket resolving. So the unmeasured rows print in full, with
 * the read stamp that put each of them there, and the summary line names both numbers.
 *
 * ## Exit code
 *
 * Non-zero when the confirmed bucket is non-empty, so a scheduled ISO row can act on it without parsing
 * prose. That is not a failure of the verb — it did exactly what it was asked — which is why the whole
 * report still prints on the way out.
 */
import { ABSENT_FIELD_CLAUSE, REHIRE_LIMIT_CLAUSE, STORED_RECORDS_CLAUSE } from "../../../accessReview/boundary.js";
import type { FormerStaffJoin, FormerStaffRow, PlatformFinding } from "../../../accessReview/join.js";
import {
  type AccessReviewReport,
  nothingRead,
  refusedPlatformsOf,
  reportBoundaryLines,
} from "../../../accessReview/report.js";

/**
 * When a person left, exactly as the roster stored it, or the statement that it stored none. Never cut to a
 * date: the bucket compares this instant against a full-precision read stamp, and a truncated one printed
 * beside that stamp hides the comparison that decided the row.
 */
function leftText({ endDateIso }: { endDateIso: string | null }): string {
  if (endDateIso === null) {
    return "no end date";
  }
  return endDateIso;
}

/** The name to print, falling back on the address the roster joined them by. */
function nameText({ row }: { row: FormerStaffRow }): string {
  if (row.display === null) {
    return row.email;
  }
  return row.display;
}

/**
 * One platform's part of a person's line. A person is CONFIRMED when any one platform confirms, so a second
 * platform on the same row may have been read BEFORE they left — that finding says so, rather than reading
 * as confirmed because of the heading it sits under.
 */
function findingText({ finding, row }: { finding: PlatformFinding; row: FormerStaffRow }): string {
  const own = finding.bucket === row.bucket ? "" : ` (${finding.bucket.toUpperCase()} — read before they left)`;
  return `${finding.platform}[${finding.levels.join(" ")}]${own}`;
}

/** One person's line: when they left, and what each platform still shows. */
function personLine({ row }: { row: FormerStaffRow }): string {
  // An unmeasured person with no live account anywhere is one whose departure postdates some platform's read.
  const found =
    row.findings.length === 0
      ? "no live account, but a platform was read before they left"
      : row.findings.map((finding) => findingText({ finding, row })).join("  ");
  return `  ${leftText({ endDateIso: row.endDateIso })}  ·  ${nameText({ row })}  ·  ${row.email}  ·  ${found}`;
}

/**
 * The lines the join prints.
 *
 * @param report the built report
 * @returns the lines, in reading order
 */
export function renderFormerStaff({ report }: { report: AccessReviewReport }): readonly string[] {
  const join = report.join;
  if (join === null) {
    return [
      "access-review former · REFUSED — the Vanta roster spine would not read, so nothing can be joined",
      ...reportBoundaryLines({ report }).map((line) => `  ${line}`),
    ];
  }
  const refused = refusedPlatformsOf({ report });
  if (nothingRead({ report, refused })) {
    return [
      "access-review former · REFUSED — no access platform would read, so nothing can be joined",
      ...reportBoundaryLines({ report }).map((line) => `  ${line}`),
    ];
  }
  const bound = lowerBoundText({ refused });
  return [
    `CONFIRMED · ${String(join.confirmed.length)} former staff still holding a live account at that platform's own read${bound}`,
    ...join.confirmed.map((row) => personLine({ row })),
    "",
    `UNMEASURED · ${String(join.unmeasured.length)} who left AFTER the platform was read — a resync resolves each into confirmed or clean${provisionalText({ refused })}`,
    ...join.unmeasured.map((row) => personLine({ row })),
    "",
    cleanLine({ clean: join.clean, refused }),
    ...residueLines({ join, refused }),
    "",
    ...reportBoundaryLines({ report }).map((line) => `  ${line}`),
    `  ${STORED_RECORDS_CLAUSE}`,
    `  ${ABSENT_FIELD_CLAUSE}`,
    `  ${REHIRE_LIMIT_CLAUSE}`,
  ];
}

/**
 * The suffix a finding count carries when a platform refused. A finding from a platform that read is still
 * true, so the count is printed — but as a floor, beside the platform that could raise it, so a zero there is
 * never read as all-clear.
 */
function lowerBoundText({ refused }: { refused: readonly string[] }): string {
  if (refused.length === 0) {
    return "";
  }
  return ` — a LOWER BOUND: ${refused.join(", ")} REFUSED its read`;
}

/**
 * The suffix UNMEASURED carries when a platform refused. It is NOT a floor: the refused platform's read could
 * move a person here into CONFIRMED, which outranks it, as well as add people who are missing — so the count
 * can move either way and is labelled so.
 */
function provisionalText({ refused }: { refused: readonly string[] }): string {
  if (refused.length === 0) {
    return "";
  }
  return ` — PROVISIONAL either way: ${refused.join(", ")} REFUSED its read, which could confirm anyone here or add more`;
}

/** The clean bucket's line, which names the refused platforms instead of a count when any refused. */
function cleanLine({ clean, refused }: { clean: number; refused: readonly string[] }): string {
  if (refused.length > 0) {
    return `CLEAN · not computed — ${refused.join(", ")} REFUSED its read, so nobody can be called clean`;
  }
  return `CLEAN · ${String(clean)} former staff hold no live account on any platform read`;
}

/**
 * Every residue the three buckets cannot hold, printed rather than counted away. The unjoinable residue is the
 * one read off the platforms, so a refused platform makes it a floor too, and names the platform that is missing
 * from it; the rest are the roster's own and stay exact.
 */
function residueLines({ join, refused }: { join: FormerStaffJoin; refused: readonly string[] }): readonly string[] {
  const unjoinable = join.unjoinable
    .filter((entry) => entry.addresses.length > 0)
    .map(
      (entry) =>
        `  RESIDUE · ${entry.platform} holds ${String(entry.addresses.length)} addresses the roster spine does not — neither confirmed, unmeasured nor clean${lowerBoundText({ refused })}`,
    );
  // Printed whether or not any readable platform held residue: with none, this line is the only floor marker.
  const unjoinableUnread =
    refused.length === 0
      ? []
      : [
          `  RESIDUE · not computed for ${refused.join(", ")} — REFUSED its read, so the addresses it holds that the roster spine does not are not counted`,
        ];
  const rehired =
    join.rehired.length === 0
      ? []
      : [
          `  RESIDUE · ${String(join.rehired.length)} addresses carry a departed spell AND a live one — REHIRES, which this report does not count as findings`,
        ];
  const statuses = join.nonDepartureStatuses.map(
    (entry) =>
      `  RESIDUE · ${String(entry.addresses)} addresses carry status ${entry.status}, which is not a departure in the roster's own vocabulary — no bucket is computed for them`,
  );
  const unbucketable =
    join.unbucketable.length === 0
      ? []
      : [
          `  RESIDUE · ${String(join.unbucketable.length)} departed people carry no end date, so no bucket can be computed for them`,
        ];
  return [...unjoinable, ...unjoinableUnread, ...rehired, ...statuses, ...unbucketable];
}

/** The `--json` payload of `access-review former`. */
export interface FormerStaffJson {
  readonly refusal: string | null;
  readonly refusedPlatforms: readonly string[];
  /** True when a platform refused: `confirmed` and `unjoinable` are then floors, not the whole answer. */
  readonly lowerBound: boolean;
  /**
   * True when a platform refused: `unmeasured` can then move EITHER way, since the refused read could confirm
   * anyone in it as well as add more, so it is neither a floor nor the answer.
   */
  readonly unmeasuredProvisional: boolean;
  readonly confirmed: readonly FormerStaffRow[] | null;
  readonly unmeasured: readonly FormerStaffRow[] | null;
  readonly clean: number | null;
  readonly unbucketable: readonly string[] | null;
  readonly rehired: readonly string[] | null;
  readonly nonDepartureStatuses: readonly { readonly status: string; readonly addresses: number }[] | null;
  readonly unjoinable: readonly { readonly platform: string; readonly addresses: readonly string[] }[] | null;
  readonly boundary: readonly string[];
}

/**
 * A refusal measured nothing, so every bucket is `null` rather than a zero or an empty list a reader could take
 * for "nobody left with access".
 */
function refusalDocument({
  boundary,
  refusal,
  refused,
}: {
  boundary: readonly string[];
  refusal: string;
  refused: readonly string[];
}): FormerStaffJson {
  return {
    boundary,
    clean: null,
    confirmed: null,
    lowerBound: false,
    nonDepartureStatuses: null,
    refusal,
    refusedPlatforms: refused,
    rehired: null,
    unbucketable: null,
    unjoinable: null,
    unmeasured: null,
    unmeasuredProvisional: false,
  };
}

/**
 * The machine-readable join.
 *
 * @param report the built report
 * @returns the `--json` payload, or a refusal document when the spine would not read
 */
export function formerStaffJson({ report }: { report: AccessReviewReport }): FormerStaffJson {
  const join = report.join;
  const boundary = [
    ...reportBoundaryLines({ report }),
    STORED_RECORDS_CLAUSE,
    ABSENT_FIELD_CLAUSE,
    REHIRE_LIMIT_CLAUSE,
  ];
  const refused = refusedPlatformsOf({ report });
  if (join === null) {
    return refusalDocument({
      boundary,
      refusal: "the Vanta roster spine would not read, so nothing can be joined",
      refused,
    });
  }
  if (nothingRead({ report, refused })) {
    return refusalDocument({ boundary, refusal: "no access platform would read, so nothing can be joined", refused });
  }
  // One refused platform leaves CLEAN uncomputable; the findings from the platforms that read still stand.
  let clean: number | null = join.clean;
  if (refused.length > 0) {
    clean = null;
  }
  return {
    boundary,
    clean,
    confirmed: join.confirmed,
    lowerBound: refused.length > 0,
    nonDepartureStatuses: join.nonDepartureStatuses,
    refusal: null,
    refusedPlatforms: refused,
    rehired: join.rehired,
    unbucketable: join.unbucketable,
    unjoinable: join.unjoinable,
    unmeasured: join.unmeasured,
    unmeasuredProvisional: refused.length > 0,
  };
}
