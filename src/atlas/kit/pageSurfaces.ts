/**
 * The surface rows an atlas page prints: what each surface actually produced, counted from the entities that
 * cite it, plus a synthetic row for every surface only the entities know about.
 *
 * Apart from `./pageModel.ts` because it is one whole pass with its own vocabulary — a tally per cited surface,
 * then the declared rows beside it — and the page model only calls it.
 */
import type { AtlasDescriptor } from "./contract.js";
import { type AtlasSurfacePurpose, surfacePurpose } from "./pageReachability.js";
import type { AtlasEntityView, AtlasObservationView } from "./read.js";

/** One surface of the atlas, with what it actually produced counted from the entities themselves. */
export interface AtlasPageSurface {
  readonly name: string;
  readonly acquisition: string;
  readonly role: string;
  readonly status: string;
  readonly documented: boolean;
  readonly unfilledBecause: string | null;
  readonly purpose: AtlasSurfacePurpose;
  /**
   * Whether the descriptor declares this surface.
   *
   * `false` is a DEFECT and the reason this field exists: an observation may cite a surface name the
   * descriptor never declared, and measured: every entity the Knock atlas held cited `api` while
   * its descriptor declares `spec-declared`, `unauthenticated-probe`, `browser-routes`, `dashboard-walk`
   * and `api-entities`. Nothing had ever compared the two.
   */
  readonly declared: boolean;
  readonly distinctEndpoints: number;
  readonly entityCount: number;
  readonly artifactCount: number;
  /** How many of this surface's observations kept a page screenshot — what "we looked" is proved by. */
  readonly photographedCount: number;
}

/** What one surface produced, accumulated across every observation citing it. */
interface SurfaceTally {
  readonly endpoints: Set<string>;
  entities: number;
  artifacts: number;
  photographed: number;
}

/**
 * What one surface has produced so far. The tallies are keyed only by surfaces an observation cites, so a
 * declared surface missing from them is one no entity came from — it produced nothing, which the page shows.
 */
function tallyFor({ tallies, surface }: { tallies: ReadonlyMap<string, SurfaceTally>; surface: string }): SurfaceTally {
  const tally = tallies.get(surface);
  if (tally === undefined) {
    return { artifacts: 0, endpoints: new Set<string>(), entities: 0, photographed: 0 };
  }
  return tally;
}

/**
 * Whether an observation kept at least one page screenshot.
 *
 * @returns `true` when any of its artifacts is a `page-png`
 */
export function isPhotographed({ observation }: { observation: AtlasObservationView }): boolean {
  return observation.artifacts.some((artifact) => artifact.kind === "page-png");
}

/**
 * Count what every surface produced, keyed by the surface name the ENTITIES cite.
 *
 * Keyed on the observation rather than on the descriptor deliberately: a surface the descriptor forgot still
 * gets a row, which is how an undeclared surface becomes visible instead of being silently dropped.
 *
 * @param entities every entity in the atlas
 * @returns one tally per observed surface name
 */
export function tallySurfaces({ entities }: { entities: readonly AtlasEntityView[] }): Map<string, SurfaceTally> {
  const tallies = new Map<string, SurfaceTally>();
  for (const entity of entities) {
    for (const observation of entity.observations) {
      const tally = tallyFor({ surface: observation.surface, tallies });
      tally.endpoints.add(observation.endpoint);
      tally.entities += 1;
      tally.artifacts += observation.artifacts.length;
      tally.photographed += isPhotographed({ observation }) ? 1 : 0;
      tallies.set(observation.surface, tally);
    }
  }
  return tallies;
}

/**
 * The declared surfaces, plus a synthetic row for every surface only the entities know about.
 *
 * @returns the declared rows in descriptor order, then one `undeclared` row per surface only an entity cites
 */
export function pageSurfaces({
  descriptor,
  tallies,
}: {
  descriptor: AtlasDescriptor;
  tallies: ReadonlyMap<string, SurfaceTally>;
}): readonly AtlasPageSurface[] {
  const declared = descriptor.surfaces.map((surface): AtlasPageSurface => {
    const tally = tallyFor({ surface: surface.name, tallies });
    return {
      acquisition: surface.acquisition,
      artifactCount: tally.artifacts,
      declared: true,
      distinctEndpoints: tally.endpoints.size,
      documented: surface.documented,
      entityCount: tally.entities,
      name: surface.name,
      photographedCount: tally.photographed,
      purpose: surfacePurpose({ surface }),
      role: surface.role,
      status: surface.status,
      unfilledBecause: surface.unfilledBecause,
    };
  });
  const declaredNames = new Set(descriptor.surfaces.map((surface) => surface.name));
  const undeclared = [...tallies.entries()]
    .filter(([name]) => !declaredNames.has(name))
    .map(([name, tally]): AtlasPageSurface => ({
      acquisition: "unknown",
      artifactCount: tally.artifacts,
      declared: false,
      distinctEndpoints: tally.endpoints.size,
      documented: false,
      entityCount: tally.entities,
      name,
      photographedCount: tally.photographed,
      purpose: "visits" as AtlasSurfacePurpose,
      role: "unknown",
      status: "undeclared",
      unfilledBecause: null,
    }));
  return [...declared, ...undeclared];
}
