/**
 * What each investigation verb IS: one product, the facets it counts by, and the track its rows come from.
 *
 * ## Why one declaration per product rather than one verb per product
 *
 * Each service gets its own command, so the owner can query all of it and root-cause very effectively
 * because the commands do the heavy lifting. So the SURFACE is one verb per product — `datadog logs`, `datadog apm`,
 * `datadog rum`, `datadog ci`, `datadog tests`, `datadog dbm`, `datadog profiles` — and the ENGINE is one,
 * because what differs between them is a list of facet names and which analytics endpoint answers, not what
 * an investigation does.
 *
 * ## Counts first, then rows — the progressive disclosure is in the engine, not in each verb
 *
 * The reason: a command shows the counts of what is asked for before putting waves of data into the context
 * window, and makes it easy to filter out noise and to correlate and corroborate. So every verb answers with
 * counts by default, takes `--not` to cut the noise, and only prints events when `--rows` asks for them.
 * A count is what Datadog reported: `apm`'s is a sampled lower bound and says so (`./counts.ts`).
 */

import type { UnifiedTrack } from "../census/boundaries.js";
import type { CensusProduct } from "../census/product.js";

/** Every product an investigation verb covers. */
export const INVESTIGATE_PRODUCTS = ["logs", "apm", "rum", "ci", "tests", "dbm", "profiles"] as const;

/** One investigation verb's id, which is also the verb's own name. */
export type InvestigateProduct = (typeof INVESTIGATE_PRODUCTS)[number];

/** Which analytics endpoint counts a product, or `track` when only the event track can. */
type CountedBy = "logs" | "spans" | "rum" | "ci-pipelines" | "ci-tests" | "track";

/** One product's declaration. */
export interface InvestigateSpec {
  readonly product: InvestigateProduct;
  /** The event track rows and exemplars come from. */
  readonly track: UnifiedTrack;
  /** Which analytics endpoint answers a count. */
  readonly countedBy: CountedBy;
  /** The facets a count groups by when the caller names none. */
  readonly defaultFacets: readonly string[];
  /** The census product whose rows label this one's groups, or nothing when the census holds none. */
  readonly census: CensusProduct | null;
  /** One line naming what this verb is for, as its own `--help` prints it. */
  readonly meaning: string;
  /** The facet whose value identifies one event's own shape, used to label a group from the census. */
  readonly shapeFacet: string | null;
}

/**
 * Every product, declared once.
 *
 * The default facets are the ones a person actually asks by. Logs count by service and status because "what
 * is erroring" is the question; APM by service, operation and resource because a slow endpoint is a
 * resource; CI by pipeline and status; tests by suite and status, since `@test.status` is what separates a
 * red suite from a green one.
 *
 * @internal
 */
export const INVESTIGATE_SPECS: readonly InvestigateSpec[] = [
  {
    census: "logs",
    countedBy: "logs",
    defaultFacets: ["service", "status"],
    meaning: "log events, counted by service and status before any line is printed",
    product: "logs",
    shapeFacet: "__dd.log_identity.raw_msg_fingerprint",
    track: "logs",
  },
  {
    census: "spans",
    countedBy: "spans",
    defaultFacets: ["service", "operation_name", "resource_name"],
    meaning:
      "APM indexed spans, counted by service, operation and resource — a sampled lower bound, never a population",
    product: "apm",
    shapeFacet: "operation_name",
    track: "trace",
  },
  {
    census: "rum",
    countedBy: "rum",
    defaultFacets: ["service", "@type"],
    meaning: "browser events, counted by application and event type",
    product: "rum",
    shapeFacet: "@type",
    track: "rum",
  },
  {
    census: "ci-pipelines",
    countedBy: "ci-pipelines",
    defaultFacets: ["@ci.pipeline.name", "@ci.status"],
    meaning: "CI pipeline events, counted by pipeline and status",
    product: "ci",
    shapeFacet: "@ci.pipeline.name",
    track: "cipipeline",
  },
  {
    census: "ci-tests",
    countedBy: "ci-tests",
    defaultFacets: ["@test.service", "@test.suite", "@test.status"],
    meaning: "test events, counted by service, suite and status",
    product: "tests",
    shapeFacet: "@test.suite",
    track: "citest",
  },
  {
    census: "dbm",
    countedBy: "track",
    defaultFacets: ["@db.query_signature"],
    meaning: "database query samples, grouped by query signature — statements are never printed",
    product: "dbm",
    shapeFacet: "@db.query_signature",
    track: "databasequery",
  },
  {
    census: "profiles",
    countedBy: "track",
    defaultFacets: ["service", "family"],
    meaning: "profiles, grouped by service and profiler family",
    product: "profiles",
    shapeFacet: "family",
    track: "profile",
  },
];

/**
 * One product's declaration.
 *
 * @returns its spec
 */
export function investigateSpec({ product }: { product: InvestigateProduct }): InvestigateSpec {
  const found = INVESTIGATE_SPECS.find((spec) => spec.product === product);
  if (found === undefined) {
    // Unreachable while both lists derive from the same union, and asserted rather than defaulted: a silent
    // fallback here would run one product's query against another product's endpoint.
    throw new Error(`no investigation spec for ${product}`);
  }
  return found;
}
