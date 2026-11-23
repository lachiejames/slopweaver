/**
 * Which attribute VALUES a shape row may keep, and the cap that stops a facet becoming a value dump. Pure.
 *
 * ## An allowlist, because the default has to be "no"
 *
 * A shape row that kept every value it saw would be an event store with extra steps, and the whole reason
 * this catalogue exists is that storing the events is twenty stores a fortnight. So the rule is inverted
 * from the usual redaction shape: nothing is kept unless a path is named here, which means a field nobody
 * has thought about is withheld by construction rather than by a denylist somebody has to remember to grow.
 *
 * **This is not the masking the owner refused.** That rule is about what a detective sees when
 * it opens a LIVE Datadog hit, and the answer there is everything — see {@link ./ladder}. What is here is a
 * size decision about a row kept forever: a `usr.id` in a stored shape would be a user id retained past the
 * fifteen days Datadog keeps it, which is a different thing from a detective reading one mid-investigation.
 * The two rules point opposite ways because they answer opposite questions.
 *
 * ## The cap, and why it is on DISTINCT values rather than on length
 *
 * A facet earns its values by being closed. `status` has four values on this organisation and knowing them
 * is most of what a detective needs; `requestId` has one per request and knowing fifty of them is worth
 * nothing at all. {@link MAX_DISTINCT_VALUES} is the line between the two, and a path that crosses it keeps
 * its PATH and loses its values — the row still says the attribute exists, which is what makes the query
 * writable.
 */
import { addInto } from "#lib/collections.js";

/**
 * Every attribute path whose values a shape row may keep, matched on the flattened path's own tail.
 *
 * Matched on the tail rather than the whole path because Datadog nests the same facet differently across
 * surfaces: a log's status is `status`, a span's is `attributes.status`, a RUM view's `view.url_path_group`
 * sits under `attributes` on one endpoint and at the root on another. A tail match makes one entry cover
 * every nesting, and the {@link MAX_DISTINCT_VALUES} cap is what keeps a coincidental tail match harmless.
 *
 * @internal
 */
export const FACET_ALLOWLIST: readonly string[] = [
  "status",
  "level",
  "severity",
  "env",
  "service",
  "source",
  "host",
  "operation_name",
  "span.kind",
  "http.method",
  "http.status_code",
  "http.route",
  "err.code",
  "error.kind",
  "error.type",
  "error.source",
  "eventName",
  "parsedEventName",
  "view.url_path_group",
  "application.id",
  "application.name",
  "type",
];

/**
 * The most distinct values one allowlisted path may have before the row keeps none of them.
 *
 * Fifty rather than a rounder ten, because a facet genuinely worth enumerating runs past ten: `@err.code`
 * produced sixteen across a whole production day, and a cap of ten would have lost it.
 */
export const MAX_DISTINCT_VALUES = 50;

/**
 * The JSON envelopes the three endpoints wrap an event's real attributes in.
 *
 * Stripped before the allowlist is consulted, so one entry covers every nesting — a log's `status` and a
 * span's `attributes.status` are the same facet under two envelopes, and declaring both would put the same
 * knowledge in two places.
 */
const ENVELOPES: readonly string[] = ["attributes.", "additionalProperties."];

/**
 * The longest a kept facet value may be.
 *
 * A facet is a small closed vocabulary, so a long value is evidence the path is not one however it is
 * spelled. MEASURED, and it is why this cap exists rather than being obvious: a build with a
 * pure tail match kept `custom.graphql.source` — because the path ENDS in `.source`, which is allowlisted —
 * and wrote a multi-kilobyte GraphQL document into a stored shape row. The prefix rule below is the real
 * fix; this is the defence that catches the next one nobody predicted.
 */
export const MAX_VALUE_CHARS = 200;

/**
 * Strip whichever endpoint envelope a path is nested under.
 *
 * @param path the flattened attribute path
 * @returns the path with a leading envelope removed, or the path unchanged
 */
export function withoutEnvelope({ path }: { path: string }): string {
  for (const envelope of ENVELOPES) {
    if (path.startsWith(envelope)) {
      return path.slice(envelope.length);
    }
  }
  return path;
}

/**
 * Whether one flattened path's values may be kept.
 *
 * Matched on the path with its envelope stripped, and then **exactly** — not on its tail. A tail match is
 * what a first cut used, on the reasoning that it would cover every nesting with one entry; what it actually
 * did was match `custom.graphql.source` against the `source` entry and keep a whole GraphQL query as a facet
 * value. Every nesting that is real is an envelope, and the envelopes are enumerable, so stripping them is
 * the precise version of what the tail match was reaching for.
 *
 * @param path the flattened attribute path
 * @returns true when the path is allowlisted
 */
export function isFacetPath({ path }: { path: string }): boolean {
  const bare = withoutEnvelope({ path });
  return FACET_ALLOWLIST.some((allowed) => bare === allowed);
}

/** One allowlisted path's kept values, or the reason it kept none. */
export interface FacetValues {
  readonly path: string;
  /** The distinct values, sorted, or nothing when the path crossed the cap. */
  readonly values: readonly string[] | null;
  /** How many distinct values the sample actually held, kept or not — a reader needs this either way. */
  readonly distinct: number;
}

/**
 * The values one facet kept, as a list a caller can iterate.
 *
 * A facet that crossed the distinct-value cap stores `null` rather than a list, which is a different fact
 * from "this facet had no values" — the path is still known and still queryable. Every reader that only
 * wants the values it can enumerate asks here, so the two cases are collapsed in ONE place that says which
 * one it is collapsing, rather than at each call site with an operator.
 *
 * @param facet one path's kept values
 * @returns the values, empty when the path crossed the cap
 */
export function facetValues({ facet }: { facet: FacetValues }): readonly string[] {
  if (facet.values === null) {
    return [];
  }
  return facet.values;
}

/**
 * Render one facet value as the string a row stores.
 *
 * A non-primitive would stringify to `[object Object]`, which is a value nobody can search for, so it is
 * rendered through `JSON.stringify` instead — the same choice `groupedAggregate.ts` makes for a bucket's
 * facet value, and for the same reason. In practice Datadog returns primitives here; this is what makes
 * "in practice" safe to rely on.
 *
 * **A value that cannot be rendered at all is refused rather than invented**, and that is a measured
 * correction. `JSON.stringify` is TYPED as returning a string and returns `undefined` at runtime for
 * `undefined`, a function or a symbol; the old comment here said Datadog would never send one, and the
 * defect was on this side of the wire — a facet path was re-read with {@link ./attributes.readPath}, which
 * cannot address a key containing a dot, so `http.method` resolved to `undefined` and a live catalogue build
 * crashed reading `.length` of it. The walk-side fix is in {@link ./attributes.flattenLeafValues}; this is
 * the second half, so an unrenderable value can never again become a row's stored string.
 *
 * @param value the raw attribute value
 * @returns the string to store, or nothing when the value cannot be rendered
 */
function renderFacetValue({ value }: { value: unknown }): string | null {
  if (value === null) {
    return "null";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return `${value}`;
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  // Everything left is `undefined`, a function, a symbol or a bigint. None has a JSON form — the first three
  // make `JSON.stringify` answer `undefined` despite its `string` return type, and a bigint makes it THROW —
  // so there is nothing here to store and the observation is refused rather than rendered.
  return null;
}

/**
 * Fold a sample's allowlisted values into one entry per path.
 *
 * A non-string value is rendered with `String(…)` rather than skipped: `http.status_code` is a number on
 * this organisation and it is one of the most useful facets there is, so dropping it for being the wrong
 * JSON type would lose the facet to a detail of how the emitter wrote it.
 *
 * @param observations every allowlisted (path, value) pair the sample produced, in any order
 * @returns one entry per path, sorted by path
 */
export function foldFacetValues({
  observations,
}: {
  observations: readonly { readonly path: string; readonly value: unknown }[];
}): readonly FacetValues[] {
  const byPath = new Map<string, Set<string>>();
  for (const seen of observations) {
    if (!isFacetPath({ path: seen.path })) {
      continue;
    }
    const rendered = renderFacetValue({ value: seen.value });
    if (rendered === null || rendered.length > MAX_VALUE_CHARS) {
      continue;
    }
    // Counted in full rather than capped as it grows, so `distinct` is the real number rather than the cap
    // plus one. Safe because the caller's input is one bounded SAMPLE — a set here can never hold more
    // entries than the sample held events, and the sampling plan is what bounds that.
    addInto({ key: seen.path, sets: byPath, value: rendered });
  }
  return [...byPath.entries()]
    .map(([path, values]) => ({
      distinct: values.size,
      path,
      values: values.size > MAX_DISTINCT_VALUES ? null : [...values].toSorted(),
    }))
    .toSorted((left, right) => left.path.localeCompare(right.path));
}
