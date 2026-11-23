/**
 * Assembling the whole access-review report out of snapshots, purely.
 *
 * Every function here takes snapshots that a caller has already read and returns a document. No home
 * directory, no clock and no atlas read happens in this file, which is what makes the three sections
 * testable against hand-built views rather than against this install's own data.
 *
 * ## One gather, three sections
 *
 * MEASURED on this install, `--limit 1` on one kind so this is pure read cost: jumpcloud 6.15s, cloudflare
 * 4.98s, 1password 2.74s, vanta 2.37s. Reproduce with
 * `/usr/bin/time -p slopweaver atlas jumpcloud read --kind systemusers --limit 1`. `readAtlas`
 * (`atlas/kit/store.ts`) takes no kind filter, so reading one kind reads the platform. Three sections each
 * taking their own snapshot would pay that three times, which is why {@link buildAccessReview} takes the
 * snapshots once and every section is a pure function over them.
 *
 * ## A platform that will not read is REFUSED, and the report continues
 *
 * `readSnapshot` legitimately answers `generationUnpublished` or `storeUnreadable`. A report that threw on
 * one atlas would stop being the ISO artifact for the other three, so an unreadable platform becomes a
 * refused section carrying the error's own message and the others are still built.
 */
import type { AtlasGenerationView, AtlasKindView, AtlasReadSnapshot } from "../atlas/kit/read.js";

import { attemptedCells, boundaryLines, type KindBoundary, kindBoundaryOf } from "./boundary.js";
import { type FormerStaffJoin, type JoinSubject, joinFormerStaff } from "./join.js";
import { ACCESS_LEVEL_TABLE, type AccessPlatformSpec, ROSTER_SPINE } from "./levels.js";
import { CONSOLE_ROLE_LABEL, type PrivilegedTable, privilegedTableOf } from "./privileged.js";
import { type Roster, rosterOf } from "./roster.js";
import { type AccessPlatformRows, accessRowsOf, inFamily } from "./rows.js";

/** One platform's snapshot, or why it could not be read. */
export interface PlatformSource {
  readonly platform: string;
  /** The snapshot, or `null` when the atlas refused to read. */
  readonly snapshot: AtlasReadSnapshot | null;
  /** The refusal's own message, or `null` when the snapshot read. */
  readonly refusal: string | null;
}

/** One platform's whole section of the report. */
export interface PlatformSection {
  readonly platform: string;
  readonly display: string;
  /** The refusal's message when the atlas would not read; every other field is then empty. */
  readonly refusal: string | null;
  readonly rows: AccessPlatformRows | null;
  readonly boundary: KindBoundary | null;
}

/** The whole report. */
export interface AccessReviewReport {
  readonly sections: readonly PlatformSection[];
  readonly spine: PlatformSection;
  readonly roster: Roster | null;
  readonly join: FormerStaffJoin | null;
  /** `null` when the spine would not read: nothing was measured, which an empty list would hide. */
  readonly privileged: readonly PrivilegedTable[] | null;
}

/** The kind view one spec names, or `null` when the snapshot holds no such kind. */
function kindViewOf({
  snapshot,
  spec,
}: {
  snapshot: AtlasReadSnapshot;
  spec: AccessPlatformSpec;
}): AtlasKindView | null {
  const found = snapshot.kinds.find((view) => view.kind === spec.kind);
  if (found === undefined) {
    return null;
  }
  return found;
}

/** A refusal message, or the sentence that says the atlas gave none. */
function refusalOf({ refusal }: { refusal: string | null }): string {
  if (refusal === null) {
    return "the atlas would not read and gave no reason";
  }
  return refusal;
}

/**
 * Build one platform's section from its source.
 *
 * @param spec the platform's own spec
 * @param source what the gather got back for it
 * @returns the section, refused when the atlas would not read or does not hold the kind
 */
export function platformSectionOf({
  spec,
  source,
}: {
  spec: AccessPlatformSpec;
  source: PlatformSource;
}): PlatformSection {
  if (source.snapshot === null) {
    return {
      boundary: null,
      display: spec.display,
      platform: spec.platform,
      refusal: refusalOf({ refusal: source.refusal }),
      rows: null,
    };
  }
  const view = kindViewOf({ snapshot: source.snapshot, spec });
  if (view === null) {
    return {
      boundary: null,
      display: spec.display,
      platform: spec.platform,
      refusal: `this build's ${spec.platform} atlas declares no \`${spec.kind}\` kind`,
      rows: null,
    };
  }
  const refusal = unmeasuredKindRefusal({ generation: source.snapshot.generation, spec, view });
  if (refusal !== null) {
    return { boundary: null, display: spec.display, platform: spec.platform, refusal, rows: null };
  }
  return {
    boundary: kindBoundaryOf({ platform: spec.platform, view }),
    display: spec.display,
    platform: spec.platform,
    refusal: null,
    rows: accessRowsOf({ entities: view.entities, spec }),
  };
}

/**
 * Why a present kind still measured nothing this report may rely on, or `null` when it did.
 *
 * Each state is refused like an unreadable store, because its rows would read as "nobody holds an account
 * here" and let the join call its people clean: a generation that disagrees with its manifest about the kind's
 * file, a kind — or one of its attempted coverage cells — that has never read successfully, a kind the
 * credential is currently fenced out of — a
 * permission block is the atlas saying it cannot see this surface NOW, whatever an earlier read stored — and a
 * kind holding records only from families other than the one its spec declares carries the level.
 *
 * A kind, or a coverage cell, whose latest attempt FAILED after an earlier success is deliberately NOT refused:
 * the failure leaves the last good read intact, every bucket is judged against the earliest such stamp
 * (`measuredAsOf` in `boundary.ts`; a departure after it is
 * UNMEASURED, never clean), and its boundary prints DEGRADED. Refusing it would blank the whole report each
 * time 1Password's interactive `op signin` lapses (`boundary.ts`), for a read that is still true as of its
 * stamp.
 */
function unmeasuredKindRefusal({
  generation,
  spec,
  view,
}: {
  generation: AtlasGenerationView;
  spec: AccessPlatformSpec;
  view: AtlasKindView;
}): string | null {
  const name = `${spec.platform}/${spec.kind}`;
  // The generation disagrees with its own manifest about this kind's file: what was read is not what was
  // published, so the rows on hand are not the surface and an empty or short list must not read as one.
  if (generation.missing.includes(spec.kind)) {
    return `${name}'s file is missing though the manifest vouches for it, so it measured nothing`;
  }
  if (generation.superseded.includes(spec.kind)) {
    return `${name}'s records are on disk in a previous format this build does not read — re-sync it`;
  }
  if (generation.mismatched.includes(spec.kind)) {
    return `${name}'s file is not the one the manifest published, so its rows are not the surface it vouches for`;
  }
  if (view.entities.length < view.publishedCount) {
    return `${name} read back ${String(view.entities.length)} records of the ${String(view.publishedCount)} the manifest vouches for, so the read is incomplete`;
  }
  if (view.permissionBlocked !== null) {
    return `${spec.platform}/${spec.kind} is permission-blocked — ${view.permissionBlocked.detail} (unblocked by ${view.permissionBlocked.unblockedBy})`;
  }
  if (view.lastSuccessAt === null) {
    return `${spec.platform}/${spec.kind} has never read successfully, so it measured nothing`;
  }
  // A fresh kind stamp beside a cell that failed and never read is a read that cell did not make.
  const unread = attemptedCells({ view }).find((cell) => cell.lastSuccessAt === null);
  if (unread !== undefined) {
    return `${name}'s ${unread.surface}/${unread.scope} coverage is ${unread.state} and has never read successfully — ${unread.reason}`;
  }
  // The kind's stamp covers every family it holds, so records from another family alone would pass every check
  // above while the family carrying the level read nothing — and an empty row list reads as "nobody holds".
  if (
    spec.surfaceFamily !== null &&
    view.entities.length > 0 &&
    !view.entities.some((entity) => inFamily({ entity, spec }))
  ) {
    return `${name} holds ${String(view.entities.length)} records and none from ${spec.surfaceFamily}, the family carrying its access level, so that surface measured nothing`;
  }
  return null;
}

/** The subjects the join runs over: every section that actually read, with its own read stamp. */
function joinSubjectsOf({ sections }: { sections: readonly PlatformSection[] }): readonly JoinSubject[] {
  return sections.flatMap((section): readonly JoinSubject[] => {
    if (section.rows === null || section.boundary === null) {
      return [];
    }
    return [{ readStampIso: section.boundary.readStampIso, rows: section.rows }];
  });
}

/**
 * Build the whole report from one gather.
 *
 * @param sources one entry per platform in {@link ACCESS_LEVEL_TABLE}, plus the spine
 * @returns the report, with every section that could be built built and every refusal carried
 */
export function buildAccessReview({ sources }: { sources: readonly PlatformSource[] }): AccessReviewReport {
  const sourceFor = ({ platform }: { platform: string }): PlatformSource => {
    const found = sources.find((source) => source.platform === platform);
    if (found === undefined) {
      return { platform, refusal: "no snapshot was gathered for this platform", snapshot: null };
    }
    return found;
  };
  // Only the platforms this invocation actually gathered get a section. A verb that deliberately skips a
  // platform — `privileged` never reads Cloudflare, which names no console role — must not then print it as
  // REFUSED in the boundary, because a deliberate non-read and a failed one are different reports.
  const sections = ACCESS_LEVEL_TABLE.filter((spec) => sources.some((source) => source.platform === spec.platform)).map(
    (spec) => platformSectionOf({ source: sourceFor({ platform: spec.platform }), spec }),
  );
  const spine = platformSectionOf({ source: sourceFor({ platform: ROSTER_SPINE.platform }), spec: ROSTER_SPINE });
  const spineView = spineRosterOf({ source: sourceFor({ platform: ROSTER_SPINE.platform }) });
  const subjects = joinSubjectsOf({ sections });
  return {
    join: spineView === null ? null : joinFormerStaff({ roster: spineView, subjects }),
    privileged: spineView === null ? null : privilegedTablesOf({ roster: spineView, sections }),
    roster: spineView,
    sections,
    spine,
  };
}

/** The roster the spine's snapshot yields, or `null` when it would not read. */
function spineRosterOf({ source }: { source: PlatformSource }): Roster | null {
  if (source.snapshot === null) {
    return null;
  }
  const view = kindViewOf({ snapshot: source.snapshot, spec: ROSTER_SPINE });
  if (view === null) {
    return null;
  }
  // A roster never read, or fenced out now, is no roster: the same fail-closed rule as every section.
  if (unmeasuredKindRefusal({ generation: source.snapshot.generation, spec: ROSTER_SPINE, view }) !== null) {
    return null;
  }
  return rosterOf({ entities: view.entities, spec: ROSTER_SPINE });
}

/** One privileged table per section whose platform declares a console role at all. */
function privilegedTablesOf({
  sections,
  roster,
}: {
  sections: readonly PlatformSection[];
  roster: Roster;
}): readonly PrivilegedTable[] {
  return sections.flatMap((section): readonly PrivilegedTable[] => {
    if (section.rows === null || section.boundary === null) {
      return [];
    }
    const declares = ACCESS_LEVEL_TABLE.find((spec) => spec.platform === section.platform);
    if (declares === undefined || !declares.levels.some((level) => level.label === CONSOLE_ROLE_LABEL)) {
      return [];
    }
    return [privilegedTableOf({ readStampIso: section.boundary.readStampIso, roster, rows: section.rows })];
  });
}

/**
 * Every boundary clause the report's own sections support, in reading order — including, per platform, the
 * stored records its last complete read no longer returned, which no row and no bucket carries.
 *
 * @param report the built report
 * @returns the lines, one clause each
 */
export function reportBoundaryLines({ report }: { report: AccessReviewReport }): readonly string[] {
  const sections = [...report.sections, report.spine];
  return sections.flatMap((section): readonly string[] => {
    if (section.boundary === null) {
      return [`read stamp · ${section.platform} REFUSED — ${String(section.refusal)}`];
    }
    return [...boundaryLines({ boundary: section.boundary }), ...staleLines({ report, section })];
  });
}

/**
 * The stale-record clause one access section owes, or none when it stores no such record. Never the spine's:
 * the roster is built from every stored person, stale ones included, so "read as no account" is not true of it.
 */
function staleLines({ report, section }: { report: AccessReviewReport; section: PlatformSection }): readonly string[] {
  if (section === report.spine || section.rows === null || section.rows.stale === 0) {
    return [];
  }
  return [
    `stale · ${String(section.rows.stale)} ${section.platform}/${section.rows.kind} record(s) the last complete read no longer returned — deleted at the provider, so read as no account`,
  ];
}

/**
 * The access platforms this report gathered whose read was refused — including a kind that has never read
 * successfully. A claim over every platform (CLEAN, an empty administrator table) cannot be made past one of
 * these, while a finding from a platform that DID read stays true, as a lower bound.
 *
 * @param report the built report
 * @returns each refused platform, in the report's section order
 */
export function refusedPlatformsOf({ report }: { report: AccessReviewReport }): readonly string[] {
  return report.sections
    .filter((section) => section.rows === null || section.boundary === null)
    .map((section) => section.platform);
}

/**
 * Whether this report gathered access platforms and none of them read, so it measured nothing either way. A
 * report that gathered none is not this: it deliberately asked for nothing, which no refusal describes.
 *
 * @param report the built report
 * @param refused what {@link refusedPlatformsOf} answered for it
 * @returns true when at least one platform was gathered and every one refused
 */
export function nothingRead({ report, refused }: { report: AccessReviewReport; refused: readonly string[] }): boolean {
  return report.sections.length > 0 && refused.length === report.sections.length;
}
