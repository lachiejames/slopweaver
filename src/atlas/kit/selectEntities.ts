/**
 * The pure selection over an atlas's normalized view (`read.ts`): which entities a caller asked to see, in a
 * stable order, one page at a time.
 */
import { atlasQueryTokens, entityCarriesTokens } from "./entityLabel.js";
import type { AtlasEntityView, AtlasKindView } from "./read.js";

/** What a caller asked to see. Every field narrows; none of them reorders. */
export interface AtlasEntitySelection {
  /** Only these kinds, when given. An unknown kind is an error rather than an empty result. */
  readonly kinds?: readonly string[];
  /** Only entities at least one of whose observations came from this surface. */
  readonly surface?: string;
  /** An exact match on either the atlas's own id or the provider's. */
  readonly id?: string;
  /** Case-insensitive token match over provider id, scope and string leaves of `detail`. Not a regex. */
  readonly query?: string;
  /** Include entities whose every observation is `stale`. Off by default. */
  readonly includeStale?: boolean;
  /** Resume after this entity id, in the stable sort order. */
  readonly after?: string;
  readonly limit?: number;
}

/** One page of entities, plus what it took to know the page was a page. */
export interface AtlasEntityPage {
  readonly entities: readonly AtlasEntityView[];
  /** The total that MATCHED, before the limit — so a caller can tell a short page from a last page. */
  readonly matched: number;
  readonly truncated: boolean;
  /** Pass back as `after` to continue; `null` when this is the last page. */
  readonly nextAfter: string | null;
}

/** The default page size, and the ceiling `--limit` is clamped to. */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 1000;

/**
 * Whether one entity matches a plain-text query.
 *
 * Token matching rather than a regex, deliberately: a caller passing `worker script` means both words, and
 * a caller who accidentally passes `(` gets a result rather than a syntax error from a language they did
 * not know they were writing in.
 *
 * Delegated to `entityLabel.ts` so the walk that DECIDES a row and the walk that says WHY it was selected
 * are the same one. A second copy here drifted the moment either changed, and a row selected with no
 * witness to show for it is the defect this pair exists to close.
 *
 * @param entity the entity to test
 * @param query the caller's words
 * @returns true when every token appears somewhere in the entity
 */
export function entityMatchesQuery({ entity, query }: { entity: AtlasEntityView; query: string }): boolean {
  return entityCarriesTokens({ entity, tokens: atlasQueryTokens({ query }) });
}

/**
 * Whether this entity has been observed by any surface recently enough to show without `--include-stale`.
 *
 * @param entity the entity to test
 * @returns true when at least one observation is `observed`
 */
export function entityIsCurrent({ entity }: { entity: AtlasEntityView }): boolean {
  return entity.observations.some((observation) => observation.state === "observed");
}

/**
 * Select, sort and page the entities a caller asked for.
 *
 * Sorted by kind then entity id, which is stable across runs because both are stable — that is what makes
 * `after` a usable cursor rather than an offset into a list that may have been rewritten underneath it.
 *
 * @param kinds every kind view to select across, already narrowed to the requested kinds
 * @param selection what the caller asked to see
 * @returns one page, and what it took to know it was one
 */
export function selectEntities({
  kinds,
  selection,
}: {
  kinds: readonly AtlasKindView[];
  selection: AtlasEntitySelection;
}): AtlasEntityPage {
  // A caller naming no page size gets the default one.
  const { limit: asked = DEFAULT_LIMIT } = selection;
  const limit = Math.min(Math.max(asked, 1), MAX_LIMIT);
  const all = kinds
    .flatMap((kind) => kind.entities)
    .toSorted((left, right) => left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id));

  const matched = all.filter((entity) => {
    if (selection.id !== undefined && entity.id !== selection.id && entity.providerId !== selection.id) {
      return false;
    }
    if (
      selection.surface !== undefined &&
      !entity.observations.some((observation) => observation.surface === selection.surface)
    ) {
      return false;
    }
    if (selection.includeStale !== true && !entityIsCurrent({ entity })) {
      return false;
    }
    if (selection.query !== undefined && !entityMatchesQuery({ entity, query: selection.query })) {
      return false;
    }
    return true;
  });

  const start = selection.after === undefined ? 0 : matched.findIndex((entity) => entity.id === selection.after) + 1;
  const page = matched.slice(start, start + limit);
  const consumed = start + page.length;
  const last = page.at(-1);
  return {
    entities: page,
    matched: matched.length,
    nextAfter: consumed < matched.length && last !== undefined ? last.id : null,
    truncated: consumed < matched.length,
  };
}
