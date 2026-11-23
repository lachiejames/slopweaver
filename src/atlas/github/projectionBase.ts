/**
 * The shared reading helpers every GitHub projection uses, and the provenance every stored entity carries.
 *
 * Split from the projections themselves for size rather than for taste: `projection.ts` holds the surface
 * kinds and the configuration modules it re-exports the configuration kinds, and both need exactly
 * this. Keeping one copy is what stops the files drifting on how a `null` is read — which is load-bearing here,
 * because a `null` in this atlas means "this token did not see it" rather than "GitHub says it is off".
 *
 * ## Reaching in, not filtering out
 *
 * Every reader here names the field it wants. That is the boundary: a field GitHub adds next month is not
 * dropped by a denial list, it is never read at all, and the strict schema beside it refuses anything that
 * got past. The sibling atlases that store provider payloads wholesale need a denial list precisely because
 * they do not do this.
 */
import { parseIsoMs } from "../../lib/date.js";
import { isRecord } from "../../lib/parsers.js";
import type { GithubRestOperation } from "./entities.js";
import { githubEntityId } from "./identity.js";
import type { GithubKind, GithubScopeLevel, GithubSurface } from "./model.js";

/** What every projection needs about the run producing it. */
export interface ProjectionContext {
  readonly at: string;
  readonly source: {
    readonly endpoint: string;
    readonly observedAt: string;
    readonly surface: GithubSurface;
  };
}

/**
 * A string field, or `null` when it is absent or not a string.
 *
 * @param raw the response body
 * @param key the field to read
 * @returns the value, or `null`
 *
 * @internal
 */
export function str({ raw, key }: { raw: Record<string, unknown>; key: string }): string | null {
  const value = raw[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * A boolean field, or `null` when it is absent or not a boolean.
 *
 * An absent administrative flag is `null` rather than `false`: on GitHub it means this token did not see
 * it, and a reader that collapsed the two would read "two-factor is not required" out of "you may not ask".
 *
 * @param raw the response body
 * @param key the field to read
 * @returns the value, or `null`
 *
 * @internal
 */
export function bool({ raw, key }: { raw: Record<string, unknown>; key: string }): boolean | null {
  const value = raw[key];
  return typeof value === "boolean" ? value : null;
}

/**
 * An integer field, or `null` when it is absent or not a number.
 *
 * @param raw the response body
 * @param key the field to read
 * @returns the value truncated to an integer, or `null`
 *
 * @internal
 */
export function int({ raw, key }: { raw: Record<string, unknown>; key: string }): number | null {
  const value = raw[key];
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;
}

/**
 * An ISO timestamp field, NORMALISED to UTC, or `null`.
 *
 * GitHub returns ISO-8601 strings and they are not all the same ISO-8601. MEASURED against a
 * live organisation: a ruleset's `updated_at` comes back with a numeric offset rather than a `Z`, which the
 * strict schema's `z.iso.datetime()` refuses — so every ruleset carrying an offset failed to store and the whole kind was
 * dropped, with the refusal naming only the field. Normalising HERE rather than loosening the schema keeps
 * the stored shape one thing: every timestamp in a generation is UTC with a `Z`, whatever a provider sent.
 *
 * Nothing is scaled: `parseIsoMs` reads a string that already carries its own instant, which is the case
 * `epoch-arithmetic` exists to distinguish from multiplying a number by 1000.
 *
 * @param raw the response body
 * @param key the field to read
 * @returns the instant as UTC ISO, or `null` when the field is absent or is not a time
 */
export function iso({ raw, key }: { raw: Record<string, unknown>; key: string }): string | null {
  const value = str({ key, raw });
  if (value === null) {
    return null;
  }
  const ms = parseIsoMs({ tsIso: value });
  return ms === undefined ? null : new Date(ms).toISOString();
}

/**
 * Every string in an array field, sorted and de-duplicated; anything non-string is dropped.
 *
 * @param raw the response body
 * @param key the field to read
 * @returns the strings, sorted
 *
 * @internal
 */
export function strings({ raw, key }: { raw: Record<string, unknown>; key: string }): string[] {
  const value = raw[key];
  if (!Array.isArray(value)) {
    return [];
  }
  const kept = value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
  return [...new Set(kept)].toSorted();
}

/**
 * Every id in an array of objects carrying one, as strings, sorted.
 *
 * Ids only, never the objects: a ruleset's bypass actors and an app installation's selected repositories
 * are references to things the CORPUS owns, and copying their payloads here is the failure the surface-map
 * criterion exists to prevent.
 *
 * @param raw the response body
 * @param key the field to read
 * @returns the ids, as strings, sorted
 *
 * @internal
 */
export function idsOf({ raw, key }: { raw: Record<string, unknown>; key: string }): string[] {
  const value = raw[key];
  if (!Array.isArray(value)) {
    return [];
  }
  const ids = value.flatMap((entry: unknown): readonly string[] => {
    if (!isRecord(entry)) {
      return [];
    }
    const id = entry["id"];
    if (typeof id === "number") {
      return [String(id)];
    }
    return typeof id === "string" && id.length > 0 ? [id] : [];
  });
  return [...new Set(ids)].toSorted();
}

/**
 * A nested record field, or an empty record.
 *
 * @param raw the response body
 * @param key the field to read
 * @returns the nested object, or an empty one when the field is absent or is not an object
 *
 * @internal
 */
export function nested({ raw, key }: { raw: Record<string, unknown>; key: string }): Record<string, unknown> {
  const value = raw[key];
  return isRecord(value) ? value : {};
}

/**
 * GitHub's own id as a string — it returns numbers for most resources and strings for a few.
 *
 * @param raw the response body
 * @param fallback what to use when the body carries no id, which is the ordinary case for a settings
 *   document: GitHub hands back the settings rather than an identifier for them
 * @returns the provider id, as a string
 *
 * @internal
 */
export function providerIdOf({ raw, fallback }: { raw: Record<string, unknown>; fallback: string }): string {
  const id = raw["id"];
  if (typeof id === "number") {
    return String(id);
  }
  return typeof id === "string" && id.length > 0 ? id : fallback;
}

/**
 * The stored provenance for one observation.
 *
 * @param context the run's provenance
 * @param deepLink the URL a human opens to see this, or `null` when the provider handed none back
 * @returns the source record every stored entity carries
 *
 * @internal
 */
export function sourceOf({
  context,
  deepLink,
}: {
  context: ProjectionContext;
  deepLink: string | null;
}): GithubRestOperation["source"] {
  return {
    artifacts: [],
    deepLink,
    deepLinkStatus: deepLink === null ? "unavailable" : "provider-provided",
    endpoint: context.source.endpoint,
    observedAt: context.source.observedAt,
    surface: context.source.surface,
  };
}

/**
 * The fields every stored entity carries, filled for one observation.
 *
 * @param context the run's provenance
 * @param kind the entity kind, which is part of the derived identity
 * @param scopeRef which organisation, repository or environment the entity belongs to — part of the
 *   identity rather than a field, because most configuration kinds have no provider id of their own
 * @param providerId GitHub's own id where one exists
 * @param deepLink the URL a human opens to see this
 * @returns the base fields
 *
 * @internal
 */
export function baseOf({
  context,
  kind,
  scopeRef,
  providerId,
  deepLink,
}: {
  context: ProjectionContext;
  kind: GithubKind;
  scopeRef: string;
  providerId: string;
  deepLink: string | null;
}): {
  firstSeenAt: string;
  id: string;
  providerId: string;
  source: GithubRestOperation["source"];
  state: "observed";
} {
  return {
    firstSeenAt: context.at,
    id: githubEntityId({ kind, providerId, scopeRef }),
    providerId,
    source: sourceOf({ context, deepLink }),
    state: "observed",
  };
}

/**
 * The fields every CONFIGURATION entity carries, filled for one observation.
 *
 * @param context the run's provenance
 * @param kind the entity kind
 * @param scopeLevel where in GitHub's hierarchy this setting lives
 * @param scopeRef which object at that level
 * @param providerId GitHub's own id where one exists
 * @param deepLink the URL a human opens to see this
 * @returns the base fields plus the scope
 *
 * @internal
 */
export function scopedOf({
  context,
  kind,
  scopeLevel,
  scopeRef,
  providerId,
  deepLink,
}: {
  context: ProjectionContext;
  kind: GithubKind;
  scopeLevel: GithubScopeLevel;
  scopeRef: string;
  providerId: string;
  deepLink: string | null;
}): ReturnType<typeof baseOf> & { scopeLevel: GithubScopeLevel; scopeRef: string } {
  return { ...baseOf({ context, deepLink, kind, providerId, scopeRef }), scopeLevel, scopeRef };
}
