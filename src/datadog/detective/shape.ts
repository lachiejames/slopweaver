/**
 * One shape row, and the fold from a sample of events into the rows it describes. Pure.
 *
 * ## What a row holds, and the one sentence that decides it
 *
 * A row holds what a detective needs to write a query and nothing a detective could only use to identify a
 * person. Paths and types for every attribute; values only from {@link ./facets.FACET_ALLOWLIST} and only
 * under its cap; a message TEMPLATE whose per-event values have already been replaced; the volume, the
 * window it was seen in, and the query that reproduces it.
 *
 * **It never holds a message, a user, an email, a token, an IP, a session id or a stack trace.** Not because
 * those are dangerous to read — the owner's ruling settles that they are not, and the live ladder returns every
 * one of them — but because a row is kept forever and an event is kept for fifteen days, so a row carrying
 * event data is a retention decision nobody made.
 *
 * ## Volume comes from the aggregate, never from the sample
 *
 * The sample says which shapes exist and the aggregate says how big each service is; multiplying a sample
 * proportion by a service total would produce a per-shape volume that reads as measured and is not. So the
 * two numbers live in two places and neither pretends to be the other: {@link ShapeRow.sampled} is a count
 * this fold actually did, the manifest's own `volumes` are counts the aggregate actually returned, and there
 * is deliberately no field anywhere multiplying them together.
 */

import { readPath } from "./attributes.js";
import { withoutEnvelope } from "./facets.js";
import { ENV_ABSENT, SERVICE_ABSENT, type ShapeIdentity, type SiteOrigin } from "./shapeKey.js";

/**
 * Quote one value for a Datadog search term.
 *
 * Datadog's search syntax gives `"` its own meaning and offers no escape for it inside a quoted phrase, so a
 * value carrying one is truncated at the quote rather than escaped — which is the honest failure here: a
 * truncated phrase still SELECTS this shape's events (plus some others), whereas a mangled escape selects
 * nothing and reads as though the shape has stopped emitting.
 *
 * @param value the literal to quote
 * @returns the quoted term
 */
export function quoteTerm({ value }: { value: string }): string {
  // A split always yields at least one element, so the first is present — an honest assertion, not a
  // fallback to the unsplit value, which would put the quote back in.
  const upToQuote = value.split('"')[0]!;
  return `"${upToQuote}"`;
}

/**
 * Datadog's reserved facets — the ones queried bare, without the `@` sigil that marks a custom attribute.
 *
 * From `docs.datadoghq.com/logs/explorer/search_syntax` and the APM search reference. A
 * short closed list rather than a general rule because there is no general rule: which names are reserved is
 * Datadog's own decision per surface, and a heuristic would be wrong silently.
 */
const RESERVED_FACETS: ReadonlySet<string> = new Set([
  "env",
  "host",
  "operation_name",
  "resource_name",
  "service",
  "source",
  "status",
  "version",
]);

/**
 * The clause that selects one shape's own site, given where that site was read from.
 *
 * A site read from an ATTRIBUTE becomes an attribute match on that same attribute — the one the value
 * actually came from, not the family's first declared one, which is the whole reason {@link SiteOrigin} is
 * carried rather than re-derived. A site read from a message becomes a quoted phrase, which is the literal
 * form a detective would type. A site that is {@link SITE_ABSENT} becomes NO clause: there is nothing to
 * match on, so the query widens to the service and the row's own `site` field is what says why.
 *
 * The endpoint envelope is stripped from an attribute path because Datadog's search syntax spells the
 * attribute `operation_name`, never `attributes.operation_name` or `additionalProperties.operation_name` —
 * both prefixes are artefacts of the JSON the event arrived in, not part of the attribute's name.
 *
 * @returns the clause, or nothing when the site cannot be matched on
 */
export function siteClause({ site, origin }: { site: string; origin: SiteOrigin }): string | null {
  if (origin.kind === "absent") {
    return null;
  }
  if (origin.kind === "attribute") {
    const attribute = withoutEnvelope({ path: origin.path });
    // A RESERVED facet is queried bare; a custom attribute takes the `@` sigil. Getting this backwards does
    // not error — it silently matches nothing, which reads as a shape that has stopped emitting.
    // MEASURED: a span's site is `operation_name`, which is reserved, and the SDK parks it under
    // `additionalProperties`, so a clause built without both rules came out
    // `@additionalProperties.operation_name:"Internal"` and returned zero on a shape holding 260 spans.
    const sigil = RESERVED_FACETS.has(attribute) ? "" : "@";
    return `${sigil}${attribute}:${quoteTerm({ value: site })}`;
  }
  return quoteTerm({ value: site });
}

/**
 * The Datadog query that reproduces one shape's events.
 *
 * The env clause is omitted when the shape's env is {@link ENV_ABSENT}, because there is no query that means
 * "no env tag" — Datadog has no negated-existence operator on a reserved attribute — so the honest query is
 * the one without it, and the row's own `env` field is what says the events carried none. A query claiming
 * `env:(none)` would return zero and read as a shape that had stopped.
 *
 * @param identity the four fields that identify the shape
 * @param origin where the site was read from, which decides how it is matched
 * @returns the query, ready to paste into the Explorer
 */
export function reproducingQuery({ identity, origin }: { identity: ShapeIdentity; origin: SiteOrigin }): string {
  const site = siteClause({ origin, site: identity.site });
  return [
    ...(identity.env === ENV_ABSENT ? [] : [`env:${identity.env}`]),
    ...(identity.service === SERVICE_ABSENT ? [] : [`service:${identity.service}`]),
    ...(site === null ? [] : [site]),
  ].join(" ");
}

/**
 * Read one `key:value` out of an event's `tags` array.
 *
 * Datadog's RESERVED attributes — `env` above all — are carried in `tags` rather than as fields of the
 * attribute object on the logs surface, so a reader that only walked the object would conclude that every
 * log on this organisation has no environment. A tag's value may itself contain a colon (a URL in a custom
 * tag), so the split is bounded to the first one and the remainder is the value.
 *
 * @param attributes the event's own attribute tree
 * @param key the tag key to read
 * @returns the tag's value, or nothing when no tag carries that key
 */
export function tagValue({ attributes, key }: { attributes: unknown; key: string }): string | null {
  const tags = readPath({ path: "tags", value: attributes });
  if (!Array.isArray(tags)) {
    return null;
  }
  for (const tag of tags) {
    if (typeof tag !== "string" || !tag.startsWith(`${key}:`)) {
      continue;
    }
    const value = tag.slice(key.length + 1);
    if (value.length > 0) {
      return value;
    }
  }
  return null;
}

/**
 * Read one event's env, falling back to the value that says it declared none.
 *
 * Several spellings are tried because the three surfaces spell it differently and an event from a service
 * that sets only the OpenTelemetry key is not an event with no environment — the owner's scope rule is explicit that a
 * wrong or missing env key is a pre-existing bug rather than a reason to drop the row, so the reader tries
 * every spelling before it concludes there is none. The `tags` array is tried too, and on the logs surface
 * it is where the answer usually is.
 *
 * @param attributes the event's own attribute tree
 * @returns the env, or {@link ENV_ABSENT}
 */
export function envOf({ attributes }: { attributes: unknown }): string {
  for (const path of [
    "env",
    "attributes.env",
    "deployment.environment.name",
    "attributes.deployment.environment.name",
  ]) {
    const value = readPath({ path, value: attributes });
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  const tagged = tagValue({ attributes, key: "env" });
  if (tagged === null) {
    return ENV_ABSENT;
  }
  return tagged;
}

/**
 * Read one event's service, falling back to the value that says it declared none.
 *
 * @param attributes the event's own attribute tree
 * @returns the service, or {@link SERVICE_ABSENT}
 */
export function serviceOf({ attributes }: { attributes: unknown }): string {
  for (const path of ["service", "attributes.service", "service.name", "attributes.service.name"]) {
    const value = readPath({ path, value: attributes });
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  const tagged = tagValue({ attributes, key: "service" });
  if (tagged === null) {
    return SERVICE_ABSENT;
  }
  return tagged;
}
