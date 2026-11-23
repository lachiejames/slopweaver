/**
 * Rendering `slopweaver access-review platform <name>` — one roster row per person, the platform's own level
 * field VERBATIM, the per-kind read stamp and the declared boundary.
 *
 * Pure: every function takes a built report and returns lines or a document, so the shape of the page is
 * testable without a home directory.
 *
 * ## A level prints as the platform wrote it, and an absent one prints as absent
 *
 * `—` means the record does not carry the field at all; `""` means the platform stored an empty string,
 * which is a real and different state on JumpCloud (`department` and `jobTitle` are empty strings on people
 * nobody filled them in for). Folding the two would turn "nothing was stored" into "the setting is off",
 * which is the exact clause `accessReview/boundary.ts` makes the report state out loud.
 */

import { boundaryLines } from "../../../accessReview/boundary.js";
import type { PlatformSection } from "../../../accessReview/report.js";
import type { AccessRow } from "../../../accessReview/rows.js";

/** How an absent field prints, so it is never mistaken for a stored empty value. */
export const ABSENT_MARK = "—";

/**
 * One level, rendered.
 *
 * A stored empty string prints as itself — `label=` with nothing after it — so it is the stored value verbatim
 * and still never reads as the absent mark, nor as a stored `null`, which `levelValuesOf` carries as the text `null`.
 *
 * @param value the verbatim value, or `null` when the record does not carry the field
 * @returns the platform's own value, verbatim, or the absent mark
 */
export function renderLevel({ value }: { value: string | null }): string {
  if (value === null) {
    return ABSENT_MARK;
  }
  return value;
}

/**
 * How a display name prints when the platform stores none.
 *
 * @param display the platform's own display name, or `null` when it stores none
 * @returns the name, or the absent mark
 */
export function renderDisplay({ display }: { display: string | null }): string {
  if (display === null) {
    return ABSENT_MARK;
  }
  return display;
}

/** One person's row: their address, name and every declared level in the spec's order. */
function rowLine({ row }: { row: AccessRow }): string {
  const levels = row.levels.map((level) => `${level.label}=${renderLevel({ value: level.value })}`).join("  ");
  return `  ${row.emailVerbatim}  ·  ${renderDisplay({ display: row.display })}  ·  ${levels}`;
}

/** What a section prints when the atlas refused and named no reason. */
function refusalText({ refusal }: { refusal: string | null }): string {
  if (refusal === null) {
    return "no reason given";
  }
  return refusal;
}

/**
 * The lines one platform's section prints.
 *
 * @param section the built section
 * @returns the lines, in reading order — the refusal alone when the atlas would not read
 */
export function renderPlatformSection({ section }: { section: PlatformSection }): readonly string[] {
  if (section.rows === null || section.boundary === null) {
    return [`${section.display} (${section.platform}) · REFUSED`, `  ${refusalText({ refusal: section.refusal })}`];
  }
  const counts =
    `${String(section.rows.rows.length)} people · ` +
    `${String(section.rows.otherFamily)} records of another declared surface family · ` +
    `${String(section.rows.addressless)} carrying no readable address · ` +
    `${String(section.rows.stale)} the last complete read no longer returned`;
  const collisions =
    section.rows.collidingAddresses.length === 0
      ? []
      : [`  two or more records claimed one address: ${section.rows.collidingAddresses.join(", ")}`];
  return [
    `${section.display} (${section.platform}/${section.rows.kind}) · ${counts}`,
    ...collisions,
    ...section.rows.rows.map((row) => rowLine({ row })),
    "",
    ...boundaryLines({ boundary: section.boundary }).map((line) => `  ${line}`),
  ];
}

/**
 * The machine-readable section.
 *
 * @param section the built section
 * @returns the `--json` payload
 */
export function platformSectionJson({ section }: { section: PlatformSection }): {
  readonly platform: string;
  readonly display: string;
  readonly refusal: string | null;
  readonly kind: string | null;
  readonly readStampIso: string | null;
  readonly latestAttemptFailed: boolean | null;
  readonly declaredBoundary: readonly string[] | null;
  readonly publishedCount: number | null;
  readonly readCount: number | null;
  readonly otherFamily: number | null;
  readonly addressless: number | null;
  readonly stale: number | null;
  readonly collidingAddresses: readonly string[] | null;
  readonly rows: readonly AccessRow[] | null;
  /** The boundary clauses the text prints — DEGRADED among them — so `former` and `privileged` JSON match. */
  readonly boundary: readonly string[];
} {
  // A refusal read nothing, so every measured field is `null` rather than an empty list a reader could take
  // for "nobody holds access here".
  if (section.rows === null || section.boundary === null) {
    return {
      addressless: null,
      boundary: [`read stamp · ${section.platform} REFUSED — ${String(section.refusal)}`],
      collidingAddresses: null,
      declaredBoundary: null,
      display: section.display,
      kind: null,
      latestAttemptFailed: null,
      otherFamily: null,
      platform: section.platform,
      publishedCount: null,
      readCount: null,
      readStampIso: null,
      refusal: section.refusal,
      rows: null,
      stale: null,
    };
  }
  return {
    addressless: section.rows.addressless,
    boundary: boundaryLines({ boundary: section.boundary }),
    collidingAddresses: section.rows.collidingAddresses,
    declaredBoundary: section.boundary.declaredBoundary,
    display: section.display,
    kind: section.rows.kind,
    latestAttemptFailed: section.boundary.latestAttemptFailed,
    otherFamily: section.rows.otherFamily,
    platform: section.platform,
    publishedCount: section.boundary.publishedCount,
    readCount: section.boundary.readCount,
    readStampIso: section.boundary.readStampIso,
    refusal: null,
    rows: section.rows.rows,
    stale: section.rows.stale,
  };
}
