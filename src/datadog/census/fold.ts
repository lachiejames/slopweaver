/**
 * Folding a handful of exemplar events into the SHAPE half of a census row. Pure.
 *
 * The count half never passes through here: it comes from the product's own analytics endpoint and is
 * carried beside this, exactly as {@link ./row} describes. What this file answers is the other question —
 * what does an event of this shape look like, and what can a detective search it on.
 *
 * Paths keep the query spelling {@link ./event} produced (`@db.rows`, `status`), while the facet allowlist
 * is consulted on the BARE name: `@status` and `status` are the same facet under two spellings, and the
 * allowlist is a list of facets rather than of spellings.
 */

import { flattenAttributes, flattenLeafValues, foldLeafPaths, type LeafPath } from "../detective/attributes.js";
import { type FacetValues, foldFacetValues, isFacetPath } from "../detective/facets.js";
import { tagValue } from "../detective/shape.js";
import { templateOf } from "../detective/shapeKey.js";
import type { TrackEvent } from "./event.js";

/** Everything a row's exemplars established about the shape. */
export interface FoldedShape {
  readonly paths: readonly LeafPath[];
  readonly facets: readonly FacetValues[];
  readonly template: string | null;
  readonly envs: readonly string[];
  readonly statuses: readonly string[];
  readonly firstSeenIso: string | null;
  readonly lastSeenIso: string | null;
  readonly exemplars: number;
}

/** The shape of a row that was counted and never exemplified — every field empty, and saying so. */
const NO_EXEMPLARS: FoldedShape = {
  envs: [],
  exemplars: 0,
  facets: [],
  firstSeenIso: null,
  lastSeenIso: null,
  paths: [],
  statuses: [],
  template: null,
};

/**
 * Strip the `@` sigil a custom attribute's path carries, so the facet allowlist sees the facet's own name.
 *
 * @param path the query-spelled path
 * @returns the path without its sigil
 */
export function withoutSigil({ path }: { path: string }): string {
  if (path.startsWith("@")) {
    return path.slice(1);
  }
  return path;
}

/**
 * Every environment a set of exemplars declared, from the field and from the tag list alike.
 *
 * Both sources, because the tracks disagree: a span carries `env` at its root, a log carries it only in
 * `tags`, and a RUM event carries it in neither until the tag is read. A shape whose events declared none at
 * all keeps an EMPTY list rather than an invented `(none)` entry — the row's own query is what a reader
 * checks, and claiming an environment nothing reported would be worse than saying nothing.
 *
 * @param events the exemplars
 * @returns the environments, sorted
 */
export function envsOf({ events }: { events: readonly TrackEvent[] }): readonly string[] {
  const found = new Set<string>();
  for (const event of events) {
    const direct = event.attributes["env"];
    if (typeof direct === "string" && direct.length > 0) {
      found.add(direct);
    }
    const deployment = event.attributes["@deployment.environment.name"];
    if (typeof deployment === "string" && deployment.length > 0) {
      found.add(deployment);
    }
    const tagged = tagValue({ attributes: event.attributes, key: "env" });
    if (tagged !== null) {
      found.add(tagged);
    }
  }
  return [...found].toSorted();
}

/**
 * Every status a set of exemplars declared.
 *
 * @param events the exemplars
 * @returns the statuses, sorted
 */
export function statusesOf({ events }: { events: readonly TrackEvent[] }): readonly string[] {
  const found = new Set<string>();
  for (const event of events) {
    const status = event.attributes["status"];
    if (typeof status === "string" && status.length > 0) {
      found.add(status);
    }
  }
  return [...found].toSorted();
}

/**
 * The template a set of exemplars agrees on — the first message seen, normalised.
 *
 * The FIRST rather than the most common, which is the same cheap choice the sampling catalogue made and for
 * the same reason: within one shape the messages are near-identical by construction, since the shape's
 * identity is the fingerprint Datadog computed off the message itself.
 *
 * @param events the exemplars
 * @returns the template, or nothing when no exemplar carried a message
 */
export function templateFrom({ events }: { events: readonly TrackEvent[] }): string | null {
  for (const event of events) {
    if (event.message !== null && event.message.length > 0) {
      return templateOf({ message: event.message });
    }
  }
  return null;
}

/**
 * Fold every exemplar of one shape into the fields a row stores.
 *
 * @param events the exemplars, in any order
 * @returns the shape half of the row
 */
export function foldExemplars({ events }: { events: readonly TrackEvent[] }): FoldedShape {
  if (events.length === 0) {
    return NO_EXEMPLARS;
  }
  const observations: { path: string; value: unknown }[] = [];
  for (const event of events) {
    for (const [path, value] of flattenLeafValues({ value: event.attributes })) {
      const bare = withoutSigil({ path });
      if (isFacetPath({ path: bare })) {
        observations.push({ path: bare, value });
      }
    }
  }
  const instants = events.map((event) => event.occurredAtIso).toSorted();
  return {
    envs: envsOf({ events }),
    exemplars: events.length,
    facets: foldFacetValues({ observations }),
    firstSeenIso: instants[0]!,
    lastSeenIso: instants[instants.length - 1]!,
    paths: foldLeafPaths({ events: events.map((event) => flattenAttributes({ value: event.attributes })) }),
    statuses: statusesOf({ events }),
    template: templateFrom({ events }),
  };
}
