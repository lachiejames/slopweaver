/**
 * The pure projection behind `slopweaver atlas <platform> page` — what an atlas holds, and what it never
 * went to get.
 *
 * ## The question this exists to answer honestly
 *
 * The owner needs one view across the API service and the browser surface that is honest about what has been
 * looked at and what has not: which API endpoints exist but were never hit, and which browser URLs exist but
 * were never hit. The reason is that a problem is noticed far sooner when the owner can see what is in the
 * atlas. So this is a DEFECT DETECTOR, and every judgement below leans towards showing a problem.
 *
 * ## Exists-but-never-hit is computed, never asserted
 *
 * A surface whose {@link AtlasSurface.acquisition} is `compiled` is the provider's own statement of what
 * exists — `kit/contract.ts`'s {@link compiledSurfaceMapSurfaces} says so in as many words: _"a declared
 * operation IS the provider's own statement of its surface"_. A surface acquired by `api` or
 * `driven-browser` is a VISIT. So the denominator is not a number anyone types: an entity observed by a
 * compiled surface and by no visiting surface EXISTS AND WAS NEVER HIT, and the count falls out of
 * `observations[].surface` alone.
 *
 * MEASURED over the published generations in `$SLOPWEAVER_HOME` (reproduce with
 * `slopweaver atlas google-admin page --json | jq .reachability`): google-admin holds entities
 * **declared by its compiled `discovery` surface and never touched by `admin-api`**. Vanta
 * **declares no compiled surface at all**, so its true figure is not zero — it is unknown,
 * and {@link AtlasPageReachability.denominator} says `absent` rather than letting a zero read as coverage.
 * That distinction is the whole point: a page that counted only what was touched would report every
 * API-only atlas as fully covered, which is the exact dishonesty the owner is trying to catch.
 *
 * ## Nothing here reads a platform's vocabulary
 *
 * Every input is {@link AtlasReadSnapshot}, which `registry.ts` produces for all of them, so one page verb
 * renders any atlas. A judgement that needed to know what a Vanta control is would be a judgement that
 * could not ship for the other thirty-nine.
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import { type AtlasKindReason, kindReason } from "./kindReason.js";
import { type AtlasPageExclusion, pageExclusion } from "./pageExclusion.js";
import { type AtlasPageReachability, atlasPageReachability } from "./pageReachability.js";
import { type AtlasPageScreenshot, atlasPageScreenshots } from "./pageScreenshots.js";
import { type AtlasPageSurface, isPhotographed, pageSurfaces, tallySurfaces } from "./pageSurfaces.js";
import { type AtlasPageDetailTableView, pageDetailTables } from "./pageTable.js";
import type { AtlasEntityView, AtlasGapView, AtlasKindView, AtlasReadSnapshot } from "./read.js";

// `AtlasPageScreenshot` lives with the pass that builds it in `./pageScreenshots.ts`; re-exported so the
// screenshot section and the render verb keep reading it from the page model they already import.
export type { AtlasPageScreenshot } from "./pageScreenshots.js";

/** One entity, as the page tabulates it — never its `detail`, which is the platform's own payload. */
export interface AtlasPageEntityRow {
  readonly id: string;
  readonly providerId: string;
  readonly scope: string;
  /** One `surface@endpoint` per observation, so a reader sees which channel proved this row. */
  readonly seenBy: readonly string[];
  readonly observedAt: string | null;
  readonly state: string;
  readonly deepLink: string | null;
  readonly photographed: boolean;
}

/** One kind, reduced to what a reader scanning for a hole needs. */
export interface AtlasPageKind {
  readonly kind: string;
  readonly entityCount: number;
  readonly publishedCount: number;
  readonly lastSuccessAt: string | null;
  readonly openGapCount: number;
  readonly surfaces: readonly string[];
  /**
   * WHY this kind holds what it holds, in one word plus its own sentence — `./kindReason.ts`'s verdict,
   * carried whole rather than re-derived here.
   *
   * The page is the surface the owner actually looks at, so it is the one that most has to satisfy the
   * owner's ruling that an agent never has to guess whether missing coverage is because the atlas is wrong
   * or because of permissions. {@link AtlasPageKind.darkWithoutReason} below answers a
   * NEARBY question and not this one — see its own note.
   *
   * Not called `reachability`, deliberately: {@link AtlasPageModel.reachability} one type over is
   * `./pageReachability.ts`'s exists-but-never-hit measurement, a different question entirely, and two
   * fields on one page spelling the same word would be read as the same thing.
   */
  readonly reason: AtlasKindReason;
  /** The boundary as one printable clause, or `null` — the `permission-boundary` arm of {@link reason}. */
  readonly permissionBlockedReason: string | null;
  /**
   * True when the kind holds nothing and NOTHING explains why.
   *
   * A Codex pre-mortem blocked the first cut for reading every empty kind as dark: an
   * exhaustive sync that legitimately found nothing has a `lastSuccessAt`, and calling that a defect trains
   * a reader to ignore the row. So emptiness is only dark when there is no success stamp, no permission
   * block, no coverage cell giving a reason and no open gap — every explanation this snapshot could carry.
   *
   * It is deliberately NOT {@link AtlasPageKind.reason}`.reason === "gap"`, and the difference is the two
   * extra terms: a coverage cell and an open gap are explanations the PAGE can see and the kit's kind-reason
   * predicate cannot, because they live beside the kind rather than on it. A kind can be a `gap` by that
   * predicate and still be fully explained by an open gap row, and the page should not shout at a reader
   * about a hole the atlas has already written down.
   */
  readonly darkWithoutReason: boolean;
  /** Whether the LATEST acquisition of this kind failed, even though a previous generation still stands. */
  readonly latestAttemptFailed: boolean;
  /** The entity rows the page prints, capped; {@link entityCount} is always the whole figure. */
  readonly rows: readonly AtlasPageEntityRow[];
}

/**
 * One counted defect, in the words the page prints.
 *
 * A row exists whether or not its count is zero, so a reader sees the whole checklist and can tell "checked,
 * clean" from "never checked" — the distinction this atlas's own coverage vocabulary is built on.
 */
export interface AtlasPageDefect {
  readonly id: string;
  readonly label: string;
  readonly count: number;
  readonly detail: string;
  /**
   * True when the count is not a measurement at all, because the atlas holds nothing to measure against.
   *
   * The field exists because of the one shape that would otherwise put the dishonesty straight back: an
   * atlas with no declared denominator reports ZERO endpoints that exist and were never hit, and a zero
   * beside a green tick reads as "clean" when it means "never checked". A row marked unknown prints as a
   * question rather than a count.
   */
  readonly unknown: boolean;
}

/** Everything one atlas's page renders, computed once. */
export interface AtlasPageModel {
  readonly platform: string;
  readonly question: string;
  readonly visibilityScope: string;
  readonly resyncCommand: string;
  readonly liveReadCommand: string | null;
  readonly freshnessWindow: string | null;
  readonly writePolicy: string;
  readonly generationUpdatedAt: string | null;
  readonly schemaVersion: number;
  readonly generationDisagreements: readonly string[];
  readonly surfaces: readonly AtlasPageSurface[];
  readonly reachability: AtlasPageReachability;
  readonly kinds: readonly AtlasPageKind[];
  readonly detailTables: readonly AtlasPageDetailTableView[];
  readonly entityCount: number;
  /** The open gaps the page prints, capped; {@link openGapCount} is always the whole figure. */
  readonly openGaps: readonly AtlasGapView[];
  readonly openGapCount: number;
  readonly closedGapCount: number;
  readonly exclusions: readonly AtlasPageExclusion[];
  readonly defects: readonly AtlasPageDefect[];
  /** Every screenshot the atlas holds, deduplicated by digest, smallest first so a byte budget fits more. */
  readonly screenshots: readonly AtlasPageScreenshot[];
}

/** Every entity of every kind, flattened once so each pass below is one loop rather than two. */
function allEntities({ kinds }: { kinds: readonly AtlasKindView[] }): readonly AtlasEntityView[] {
  return kinds.flatMap((kind) => kind.entities);
}

/** One entity's printable row. */
function entityRow({ entity }: { entity: AtlasEntityView }): AtlasPageEntityRow {
  const linked = entity.observations.find((observation) => observation.deepLink !== null);
  const { observedAt, state } = firstSighting({ entity });
  return {
    deepLink: unsetFieldAsNull({ key: "deepLink", record: linked }),
    id: entity.id,
    observedAt,
    photographed: entity.observations.some((observation) => isPhotographed({ observation })),
    providerId: entity.providerId,
    scope: entity.scope,
    seenBy: entity.observations.map((observation) => `${observation.surface}@${observation.endpoint}`),
    state,
  };
}

/**
 * When, and in what state, an entity's first observation saw it. An entity can hold no observation at all —
 * `read.ts`'s `channelObservations` projects one whose every channel slot is empty to none — and the page
 * names that `unobserved` rather than hiding the row, because a defect is what this page exists to show.
 */
function firstSighting({ entity }: { entity: AtlasEntityView }): { observedAt: string | null; state: string } {
  const first = entity.observations[0];
  if (first === undefined) {
    return { observedAt: null, state: "unobserved" };
  }
  return { observedAt: first.observedAt, state: first.state };
}

/**
 * Whether a kind holding nothing has anything at all to explain the emptiness.
 *
 * @param kind the kind as the store handed it back
 * @returns `true` when it is empty and no success, permission block, product absence, coverage reason or
 *   gap says why
 */
function darkWithoutReason({ kind }: { kind: AtlasKindView }): boolean {
  if (kind.entities.length > 0) {
    return false;
  }
  const explained =
    kind.permissionBlocked !== null ||
    kind.productAbsent != null ||
    kind.lastSuccessAt !== null ||
    kind.gaps.some((gap) => gap.status === "open") ||
    kind.coverage.some((cell) => cell.reason !== "");
  return !explained;
}

/** One kind's row. */
function pageKind({ kind, rowCap }: { kind: AtlasKindView; rowCap: number }): AtlasPageKind {
  const surfaces = new Set(kind.entities.flatMap((entity) => entity.observations.map((o) => o.surface)));
  const reason = kindReason({ ...kind, entityCount: kind.entities.length });
  const blockedClause =
    reason.reason === "permission-boundary" ? `${reason.detail} — unblocked by ${reason.unblockedBy}` : null;
  return {
    rows: kind.entities.slice(0, rowCap).map((entity) => entityRow({ entity })),
    darkWithoutReason: darkWithoutReason({ kind }),
    entityCount: kind.entities.length,
    kind: kind.kind,
    lastSuccessAt: kind.lastSuccessAt,
    latestAttemptFailed: kind.latestAttemptFailed,
    openGapCount: kind.gaps.filter((gap) => gap.status === "open").length,
    permissionBlockedReason: blockedClause,
    publishedCount: kind.publishedCount,
    reason,
    surfaces: [...surfaces].toSorted(),
  };
}

/** Every way this generation disagrees with its own manifest, in one printable list. */
function generationDisagreements({ generation }: { generation: AtlasReadSnapshot["generation"] }): readonly string[] {
  return [
    ...generation.missing.map((kind) => `${kind}: the manifest vouches for it and the file is gone`),
    ...generation.mismatched.map((kind) => `${kind}: the file on disk is not the one the manifest published`),
    ...generation.superseded.map((kind) => `${kind}: the records are under the previous format's name`),
    ...generation.unpublished.map((kind) => `${kind}: a file the manifest does not vouch for`),
  ];
}

/**
 * The whole defect checklist, every row present whether or not it fired.
 *
 * @param model the model built so far, minus this field
 * @returns one row per defect class, in the order the page prints them
 */
function pageDefects({ model }: { model: Omit<AtlasPageModel, "defects"> }): readonly AtlasPageDefect[] {
  return [...reachabilityDefects({ model }), ...structuralDefects({ model })];
}

/**
 * The two rows about what this atlas can and cannot measure, which lead the strip because they qualify
 * every other figure on the page.
 *
 * @param model the model built so far, minus this field
 * @returns the reachability rows, in the order the page prints them
 */
function reachabilityDefects({ model }: { model: Omit<AtlasPageModel, "defects"> }): readonly AtlasPageDefect[] {
  const measurable = model.reachability.denominator === "declared";
  const undetermined = model.reachability.undeterminedKinds;
  return [
    {
      count: undetermined.length,
      detail: undetermined.slice(0, 8).join(", "),
      id: "denominator-absent",
      label: "kinds with nothing declaring what exists",
      unknown: false,
    },
    {
      count: model.reachability.neverHitCount,
      detail: measurable
        ? "declared by a filled compiled surface and never reached by any visit"
        : model.reachability.unknownBecause!,
      id: "never-hit",
      label: "endpoints or URLs that exist and were never hit",
      unknown: !measurable,
    },
  ];
}

/**
 * The six rows about the generation itself — what failed, what is refused, what is dark, what disagrees.
 *
 * Each is present whether or not it fired, so a reader can tell "checked, clean" from "never checked".
 *
 * @param model the model built so far, minus this field
 * @returns the structural rows, in the order the page prints them
 */
function structuralDefects({ model }: { model: Omit<AtlasPageModel, "defects"> }): readonly AtlasPageDefect[] {
  const unfilled = model.surfaces.filter((surface) => surface.status === "declared-unfilled");
  const undeclared = model.surfaces.filter((surface) => !surface.declared);
  const dark = model.kinds.filter((kind) => kind.darkWithoutReason);
  const refused = model.exclusions.filter((exclusion) => exclusion.refused);
  const failing = model.kinds.filter((kind) => kind.latestAttemptFailed);
  return [
    {
      count: failing.length,
      detail: failing.map((kind) => kind.kind).join(", "),
      id: "latest-attempt-failed",
      label: "kinds whose latest acquisition failed",
      unknown: false,
    },
    {
      count: refused.length,
      detail: refused.map((exclusion) => exclusion.ground).join(", "),
      id: "refused-exclusions",
      label: "exclusions the coverage gate refuses",
      unknown: false,
    },
    {
      count: unfilled.length,
      detail: unfilled.map((surface) => surface.name).join(", "),
      id: "unfilled-surfaces",
      label: "surfaces declared and never filled",
      unknown: false,
    },
    {
      count: model.openGapCount,
      detail: "questions this atlas could not answer and has not closed",
      id: "open-gaps",
      label: "open gaps",
      unknown: false,
    },
    {
      count: dark.length,
      detail: dark.map((kind) => kind.kind).join(", "),
      id: "dark-kinds",
      label: "kinds holding nothing with no permission block to explain it",
      unknown: false,
    },
    {
      count: undeclared.length,
      detail: undeclared.map((surface) => surface.name).join(", "),
      id: "undeclared-surfaces",
      label: "surfaces the entities cite that the descriptor never declared",
      unknown: false,
    },
    {
      count: model.generationDisagreements.length,
      detail: "the generation on disk disagrees with its own manifest",
      id: "generation-disagreements",
      label: "generation disagreements",
      unknown: false,
    },
  ];
}

/**
 * Build the whole page model from one atlas snapshot.
 *
 * @param snapshot the atlas as `registry.ts` read it
 * @param neverHitCap how many never-hit rows to carry into the model; the COUNT is always the true figure,
 *   so a cap bounds the page's size without ever bounding what it claims
 * @param rowCap how many entity rows each kind carries, bounded for the same reason
 * @param gapCap how many open gaps the page prints. MEASURED: the open-gap count of the JumpCloud
 *   generation on this machine, and the JSON it serialises to, were the whole reason an unbounded list
 *   could not stand. Re-derive with `slopweaver atlas jumpcloud render --json | jq \'.openGapCount\'`
 * @returns everything the page renders
 */
export function atlasPageModel({
  snapshot,
  neverHitCap = 2000,
  rowCap = 250,
  gapCap = 500,
}: {
  snapshot: AtlasReadSnapshot;
  neverHitCap?: number;
  rowCap?: number;
  gapCap?: number;
}): AtlasPageModel {
  const { descriptor, generation, kinds } = snapshot;
  const entities = allEntities({ kinds });
  const openGaps = kinds.flatMap((kind) => kind.gaps).filter((gap) => gap.status === "open");
  const tallies = tallySurfaces({ entities });
  const withoutDefects: Omit<AtlasPageModel, "defects"> = {
    closedGapCount: kinds.flatMap((kind) => kind.gaps).filter((gap) => gap.status === "closed").length,
    detailTables: pageDetailTables({ rowCap, tables: snapshot.pageDetailTables }),
    entityCount: entities.length,
    exclusions: descriptor.excludes.map((exclusion) => pageExclusion({ exclusion })),
    freshnessWindow: unsetFieldAsNull({ key: "freshnessWindow", record: descriptor }),
    generationDisagreements: generationDisagreements({ generation }),
    generationUpdatedAt: generation.updatedAt,
    kinds: kinds.map((kind) => pageKind({ kind, rowCap })),
    liveReadCommand: unsetFieldAsNull({ key: "liveReadCommand", record: descriptor }),
    openGapCount: openGaps.length,
    openGaps: openGaps.slice(0, gapCap),
    platform: descriptor.platform,
    question: descriptor.question,
    reachability: atlasPageReachability({ descriptor, kinds, neverHitCap }),
    resyncCommand: descriptor.resyncCommand,
    schemaVersion: generation.schemaVersion,
    screenshots: atlasPageScreenshots({ entities }),
    surfaces: pageSurfaces({ descriptor, tallies }),
    visibilityScope: descriptor.visibilityScope,
    writePolicy: descriptor.writePolicy,
  };
  return { ...withoutDefects, defects: pageDefects({ model: withoutDefects }) };
}
