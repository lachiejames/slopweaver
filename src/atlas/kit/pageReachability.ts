/**
 * The one question the owner asked for by name: **which endpoints and URLs exist that were never hit** —
 * and, where an atlas cannot answer it, saying so instead of reporting a zero.
 *
 * ## What a denominator is, and why it is not a number anybody types
 *
 * A surface whose {@link AtlasSurface.acquisition} is `compiled` is the provider's OWN statement of what
 * exists — `kit/contract.ts`'s `compiledSurfaceMapSurfaces` says it in as many words: _"a declared operation
 * IS the provider's own statement of its surface"_. A surface acquired by `api` or `driven-browser` is a
 * VISIT. So an entity observed by a compiled surface and by no visiting surface EXISTS AND WAS NEVER HIT,
 * and the figure falls out of `observations[].surface` with nothing asserted.
 *
 * A compiled surface only counts when its `status` is `filled`. A `declared-unfilled` one is an atlas
 * saying it has not compiled the inventory yet, and treating that as a denominator would divide by a
 * promise.
 *
 * ## The verdict is per KIND, and that is the correction that matters
 *
 * A Codex pre-mortem blocked the first cut of this file for computing one verdict for a whole
 * atlas, and it was right. Google Admin compiles a complete `discovery` denominator for its API and has
 * NOTHING declaring what its admin console contains; one atlas-wide `declared` verdict would have let its
 * measured never-hit API operations imply something about console pages it says nothing about.
 *
 * So each kind is judged against the surfaces that actually observed IT, and {@link AtlasPageReachability}
 * carries `partial` for the mixed case. `absent` and `partial` both print as an unknown rather than a count.
 *
 * ## The limit this carries, stated rather than discovered
 *
 * `acquisition` is the only declaration available, and it is coarse. The same pre-mortem named GraphQL
 * Hive's `registry-graphql-schema`: obtained by live introspection, so declared `api`, while its contents
 * ARE the provider's own schema — 26 root fields and 257 types. This file classifies it as a visit, so that
 * atlas's kinds report `absent` where a richer declaration would let them report a real figure. The error
 * is one-directional and it is the safe direction: an atlas reports UNKNOWN where it could have reported a
 * number, never a number where the truth is unknown. Closing it properly means per-surface reachability
 * metadata on the descriptor, which is a change to all forty descriptors rather than to this projection.
 */
import type { AtlasDescriptor } from "./contract.js";
import type { AtlasEntityView, AtlasKindView } from "./read.js";

/**
 * What a surface contributes to the exists-versus-hit question.
 *
 * `declares-existence` is a FILLED `compiled` surface. `visits` is everything else, including a compiled
 * surface nobody has populated — see this file's header on why an unfilled inventory is not a denominator.
 */
export type AtlasSurfacePurpose = "declares-existence" | "visits";

/** One entity a declaring surface names and no visiting surface has ever reached.
 * @internal
 */
export interface AtlasPageNeverHit {
  readonly kind: string;
  readonly providerId: string;
  readonly endpoint: string;
  readonly surface: string;
  readonly deepLink: string | null;
}

/** How well one kind — or the whole atlas — can answer the exists-versus-hit question.
 * @internal
 */
export type AtlasDenominator = "declared" | "partial" | "absent";

/** One kind's own exists-versus-hit verdict.
 * @internal
 */
export interface AtlasKindReachability {
  readonly kind: string;
  readonly denominator: AtlasDenominator;
  readonly neverHitCount: number;
  readonly corroboratedCount: number;
  readonly undeclaredFindCount: number;
}

/**
 * The exists-versus-hit verdict for the whole atlas.
 *
 * `denominator` is the field a reader checks first, and only `declared` makes {@link neverHitCount} a
 * measurement. `partial` means some kinds can be judged and others cannot; `absent` means none can.
 */
export interface AtlasPageReachability {
  readonly denominator: AtlasDenominator;
  /** The declared-and-never-reached entities, capped. Empty when nothing declares what the provider offers. */
  readonly neverHit: readonly AtlasPageNeverHit[];
  readonly neverHitCount: number;
  /** Entities both declared and reached — the only ones whose contents are evidenced twice. */
  readonly corroboratedCount: number;
  /** Entities a visit found that nothing declares — undocumented surface, and a real finding. */
  readonly undeclaredFindCount: number;
  /** Every kind whose exists-versus-hit question cannot be answered at all, sorted. */
  readonly undeterminedKinds: readonly string[];
  /** Why the figure is not a measurement, when it is not. `null` only when every kind can be judged. */
  readonly unknownBecause: string | null;
  readonly kinds: readonly AtlasKindReachability[];
}

/**
 * Which purpose one declared surface serves.
 *
 * @param surface the descriptor's own declaration for it
 * @returns whether it states what exists, or proves a visit
 */
export function surfacePurpose({
  surface,
}: {
  surface: Pick<AtlasDescriptor["surfaces"][number], "acquisition" | "status">;
}): AtlasSurfacePurpose {
  if (surface.acquisition !== "compiled") {
    return "visits";
  }
  return surface.status === "filled" ? "declares-existence" : "visits";
}

/** The names of every surface this atlas declares AND has filled as an inventory of what exists. */
function declaringSurfaceNames({ descriptor }: { descriptor: AtlasDescriptor }): ReadonlySet<string> {
  return new Set(
    descriptor.surfaces
      .filter((surface) => surfacePurpose({ surface }) === "declares-existence")
      .map((surface) => surface.name),
  );
}

/** How one entity stands against the declaring surfaces: declared only, both, or found by visiting alone. */
type EntityStanding = "never-hit" | "corroborated" | "undeclared-find";

/** Judge one entity. */
function standingOf({
  entity,
  declaring,
}: {
  entity: AtlasEntityView;
  declaring: ReadonlySet<string>;
}): EntityStanding {
  const declaredBy = entity.observations.some((observation) => declaring.has(observation.surface));
  const visited = entity.observations.some((observation) => !declaring.has(observation.surface));
  if (!declaredBy) {
    return "undeclared-find";
  }
  return visited ? "corroborated" : "never-hit";
}

/** The declaring observation a never-hit row is built from. */
function neverHitRow({
  entity,
  declaring,
}: {
  entity: AtlasEntityView;
  declaring: ReadonlySet<string>;
}): AtlasPageNeverHit | null {
  const first = entity.observations.find((observation) => declaring.has(observation.surface));
  if (first === undefined) {
    return null;
  }
  return {
    deepLink: first.deepLink,
    endpoint: first.endpoint,
    kind: entity.kind,
    providerId: entity.providerId,
    surface: first.surface,
  };
}

/**
 * One kind's verdict from its three tallies.
 *
 * `declared` requires that NOTHING in the kind was found by visiting alone. A kind holding one declared
 * operation beside five hundred entities nothing declares is not a measured kind — it is a mostly unmeasured
 * one with a foothold, and reporting it `declared` would let its one figure stand for the other five
 * hundred. That is the same over-claim, one level down, that made the atlas-wide verdict wrong.
 *
 * @param neverHitCount entities declared and never reached
 * @param corroboratedCount entities declared and reached
 * @param undeclaredFindCount entities nothing declares
 * @returns how far this kind's exists-versus-hit question can be answered
 */
function kindDenominator({
  neverHitCount,
  corroboratedCount,
  undeclaredFindCount,
}: {
  neverHitCount: number;
  corroboratedCount: number;
  undeclaredFindCount: number;
}): AtlasDenominator {
  const declared = neverHitCount + corroboratedCount;
  if (declared === 0) {
    return "absent";
  }
  return undeclaredFindCount === 0 ? "declared" : "partial";
}

/** One kind's verdict, and the never-hit rows it contributes. */
function judgeKind({ kind, declaring }: { kind: AtlasKindView; declaring: ReadonlySet<string> }): {
  readonly verdict: AtlasKindReachability;
  readonly rows: readonly AtlasPageNeverHit[];
} {
  let neverHitCount = 0;
  let corroboratedCount = 0;
  let undeclaredFindCount = 0;
  const rows: AtlasPageNeverHit[] = [];
  for (const entity of kind.entities) {
    const standing = standingOf({ declaring, entity });
    if (standing === "corroborated") {
      corroboratedCount += 1;
      continue;
    }
    if (standing === "undeclared-find") {
      undeclaredFindCount += 1;
      continue;
    }
    neverHitCount += 1;
    const row = neverHitRow({ declaring, entity });
    if (row !== null) {
      rows.push(row);
    }
  }
  return {
    rows,
    verdict: {
      corroboratedCount,
      denominator: kindDenominator({ corroboratedCount, neverHitCount, undeclaredFindCount }),
      kind: kind.kind,
      neverHitCount,
      undeclaredFindCount,
    },
  };
}

/** The atlas-wide verdict, from what each kind could and could not be judged on. */
function aggregate({ kinds }: { kinds: readonly AtlasKindReachability[] }): AtlasDenominator {
  if (kinds.length === 0) {
    return "absent";
  }
  if (kinds.every((kind) => kind.denominator === "declared")) {
    return "declared";
  }
  return kinds.every((kind) => kind.denominator === "absent") ? "absent" : "partial";
}

/**
 * Say why the figure is not a measurement, naming the kinds it cannot cover.
 *
 * @param denominator the atlas-wide verdict
 * @param undetermined every kind that could not be judged, sorted
 * @param platform the platform, so the sentence names what is not declared
 * @returns the sentence the page prints, or `null` when every kind was judged
 */
function unknownBecause({
  denominator,
  undetermined,
  platform,
}: {
  denominator: AtlasDenominator;
  undetermined: readonly string[];
  platform: string;
}): string | null {
  if (denominator === "declared") {
    return null;
  }
  const named = undetermined.slice(0, 12).join(", ");
  const more = undetermined.length > 12 ? ` and ${String(undetermined.length - 12)} more` : "";
  if (denominator === "absent") {
    return (
      `no filled surface of this atlas is compiled from ${platform}'s own specification, route inventory or ` +
      "SDK, so nothing here states what the provider offers. What it never hit cannot be named — not because " +
      "there is none, but because this atlas holds no denominator to subtract from"
    );
  }
  return (
    `only some of this atlas is measurable. Nothing declares what exists for ${named}${more}, so the figure ` +
    `beside it covers the rest of ${platform} and says nothing at all about those`
  );
}

/**
 * Judge the whole atlas, kind by kind.
 *
 * @param descriptor the atlas's own declaration, which says which surfaces state what exists
 * @param kinds every kind, with the entities each holds
 * @param neverHitCap how many rows to carry; the COUNT is always the whole figure, so a cap bounds the page
 *   without ever bounding what it claims
 * @returns the verdict, with `absent` or `partial` wherever a count would be a claim the data cannot support
 */
export function atlasPageReachability({
  descriptor,
  kinds,
  neverHitCap,
}: {
  descriptor: AtlasDescriptor;
  kinds: readonly AtlasKindView[];
  neverHitCap: number;
}): AtlasPageReachability {
  const declaring = declaringSurfaceNames({ descriptor });
  const judged = kinds.filter((kind) => kind.entities.length > 0).map((kind) => judgeKind({ declaring, kind }));
  const verdicts = judged.map((one) => one.verdict);
  const denominator = aggregate({ kinds: verdicts });
  const undetermined = verdicts
    .filter((verdict) => verdict.denominator !== "declared")
    .map((verdict) => verdict.kind)
    .toSorted();
  return {
    corroboratedCount: verdicts.reduce((total, verdict) => total + verdict.corroboratedCount, 0),
    denominator,
    kinds: verdicts,
    neverHit: judged.flatMap((one) => one.rows).slice(0, neverHitCap),
    neverHitCount: verdicts.reduce((total, verdict) => total + verdict.neverHitCount, 0),
    undeclaredFindCount: verdicts.reduce((total, verdict) => total + verdict.undeclaredFindCount, 0),
    undeterminedKinds: undetermined,
    unknownBecause: unknownBecause({ denominator, platform: descriptor.platform, undetermined }),
  };
}
