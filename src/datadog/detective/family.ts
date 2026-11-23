/**
 * The five telemetry families a Datadog shape catalogue holds, and what each one is keyed on. Pure.
 *
 * ## Why five families and not one
 *
 * A shape row is "what a thing from this service looks like", and the four telemetry surfaces this
 * organisation actually emits do not share a notion of what "a thing" is. A log line is identified by the
 * code that wrote it; a span by the operation it names; a RUM session by the app and the route the user was
 * on; a RUM error by the app and the error's own kind. Folding them into one family forces one key, and any
 * one key is wrong for three of the four.
 *
 * `error` is the fifth and it is a CROSS-CUT rather than a surface: a log at `status:error` is already a
 * `log`, but the attributes an error carries (`@err.code`, `@error.kind`, the stack) are absent from the
 * info lines that dominate the sample, so folding them together loses exactly the rows a detective wants.
 * The owner's own measurement is the argument — sixteen `@err.code` values cover an entire day, and none of
 * them is visible in a sample the chatty info site wins.
 *
 * ## Spans are catalogued in the same pass, on the owner's word
 *
 * Spans are just as important as logs and sessions, so they go in the same pass: there is plenty to learn from
 * spans that the others do not carry.
 *
 * So `span` is not a later lane and there is no flag that defers it: every family is in the pass, and the
 * census that replaced the sampled catalogue keeps the property by running every PRODUCT by default.
 */

/** One telemetry surface the catalogue holds shapes for. */
export const SHAPE_FAMILIES = ["log", "span", "rum-session", "rum-error", "error"] as const;

/** One family's id. */
export type ShapeFamily = (typeof SHAPE_FAMILIES)[number];

/** What one family is, and how a reader is meant to understand its key. */
export interface ShapeFamilySpec {
  readonly family: ShapeFamily;
  /** One line naming what a row of this family describes. */
  readonly meaning: string;
  /** The attribute paths, in priority order, whose first present value becomes the shape's site. */
  readonly siteFrom: readonly string[];
  /** The Datadog query fragment that selects this family's events out of its own surface. */
  readonly selector: string;
}

/**
 * Every family, declared once.
 *
 * `siteFrom` is a PRIORITY LIST rather than one path because a family's identifying attribute is not always
 * present: a span carries `resource_name` on an HTTP call and not on an internal one, and a RUM error
 * carries `error.type` on a thrown Error and not on a network failure. The first present value wins and the
 * fallback is the family's own last resort, which {@link ./shapeKey.siteOf} computes.
 *
 * @internal
 */
export const SHAPE_FAMILY_SPECS: readonly ShapeFamilySpec[] = [
  {
    family: "log",
    meaning: "a log line, keyed on the emitting site its own message names",
    selector: "",
    siteFrom: [],
  },
  {
    family: "span",
    meaning: "a span, keyed on the operation it names and the resource it names underneath",
    selector: "",
    siteFrom: ["operation_name", "resource_name"],
  },
  {
    family: "rum-session",
    meaning: "a browser session, keyed on the application and the route group the view was on",
    selector: "@type:view",
    siteFrom: ["view.url_path_group", "view.url_path"],
  },
  {
    family: "rum-error",
    meaning: "a browser error, keyed on the application and the error's own kind",
    selector: "@type:error",
    siteFrom: ["error.type", "error.source"],
  },
  {
    family: "error",
    meaning: "an error log, keyed on the error code it carries rather than on the line that wrote it",
    selector: "status:error",
    siteFrom: ["err.code", "error.kind", "error.type"],
  },
];

/** The spec for one family, by id. */
const SPEC_BY_FAMILY: ReadonlyMap<ShapeFamily, ShapeFamilySpec> = new Map(
  SHAPE_FAMILY_SPECS.map((spec) => [spec.family, spec]),
);

/**
 * What one family is, by id.
 *
 * @returns the declared spec
 */
export function shapeFamilySpec({ family }: { family: ShapeFamily }): ShapeFamilySpec {
  // `!` rather than a fallback: the map is built from SHAPE_FAMILY_SPECS, whose entries are typed as
  // ShapeFamily, so a miss would be a fault in this module rather than in a caller's input.
  return SPEC_BY_FAMILY.get(family)!;
}

/**
 * Whether a family's events come from the logs surface rather than the spans or RUM surface.
 *
 * Two of the five do, which is why this is a predicate rather than a per-family transport field: `log` and
 * `error` are two cuts of the same index, and the difference between them is the selector, not the endpoint.
 *
 * @returns true when the events are fetched from the logs API
 */
export function isLogSurface({ family }: { family: ShapeFamily }): boolean {
  return family === "log" || family === "error";
}
