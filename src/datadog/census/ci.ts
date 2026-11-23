/**
 * The CI census: every pipeline with the jobs under it, and every test suite with the tests under it.
 *
 * ## `@ci.level` is not a facet on this organisation, and the census is shaped around what is
 *
 * MEASURED on this install's site: grouping pipeline events by `@ci.pipeline.name × @ci.level` returns ZERO
 * buckets, while `@ci.pipeline.name × @ci.job.name` returns the real tree (`PR checks` →
 * `PR / Checks — core / run`, tens of thousands of events over seven days) and `@ci.status` enumerates
 * success/skipped/canceled/error/unstable. So a pipeline row's members are its JOBS rather than its levels,
 * and the level is left to the exemplar's own `ci_level` field, which every event carries.
 *
 * Tests are keyed `(@test.service, @test.suite)` with the test NAMES as members — measured on the same day,
 * `acme-admin-e2e-staging` runs `e2e/BookingLateChangeFee.spec.ts` over a thousand times a week — and `@test.status`
 * is the facet that separates a suite that passes from one that is red.
 */

import type { Logger } from "../../lib/logger.js";
import { presentOr } from "../detective/envelope.js";
import { quoteTerm } from "../detective/shape.js";
import type { RawRequester } from "../rawRequest.js";
import type { AbsoluteWindow } from "../window.js";
import { ciPipelineGroups, ciTestGroups, type ProductBuckets } from "./aggregate.js";
import { type CountedShape, exemplifyShapes } from "./exemplify.js";
import { type CensusMember, SERVICE_ABSENT } from "./row.js";
import type { CensusClient, ProductCensus, ServiceVolume } from "./scope.js";

/** How many pipelines, suites or services one request asks for. */
const OUTER_LIMIT = 200;

/** How many jobs or test names one request asks for, per outer group. */
const INNER_LIMIT = 50;

/** The facets the two halves are keyed on, named once so a row's query and its aggregate cannot disagree. */
const PIPELINE_FACET = "@ci.pipeline.name";
const JOB_FACET = "@ci.job.name";
const TEST_SERVICE_FACET = "@test.service";
const TEST_SUITE_FACET = "@test.suite";
const TEST_NAME_FACET = "@test.name";

/** One outer thing a CI aggregate named, with its total and the things under it. */
interface TwoLevelGroup {
  readonly outer: string;
  readonly count: number;
  readonly members: readonly CensusMember[];
}

/**
 * Fold a two-facet grouped answer into an outer count and the inner members under each outer value.
 *
 * Both CI halves have the same shape — a named thing with named things under it — so the fold is written
 * once here rather than twice with the facet names changed.
 *
 * @param buckets what the aggregate returned
 * @param outerFacet the facet naming the thing a row is
 * @param innerFacet the facet naming the things under it
 * @returns one entry per outer value, carrying its total and its members
 */
export function foldTwoLevel({
  buckets,
  outerFacet,
  innerFacet,
}: {
  buckets: ProductBuckets;
  outerFacet: string;
  innerFacet: string;
}): readonly TwoLevelGroup[] {
  const totals = new Map<string, number>();
  const members = new Map<string, CensusMember[]>();
  for (const bucket of buckets.buckets) {
    const outer = bucket.by[outerFacet];
    if (outer === undefined || outer.length === 0) {
      continue;
    }
    const seen = totals.get(outer);
    totals.set(outer, seen === undefined ? bucket.count : seen + bucket.count);
    addMember({ bucket: { count: bucket.count, inner: bucket.by[innerFacet] }, members, outer });
  }
  return [...totals.entries()]
    .map(([outer, count]) => {
      const list = members.get(outer);
      return { count, members: presentOr({ absent: [], value: list }), outer };
    })
    .toSorted((left, right) => right.count - left.count || left.outer.localeCompare(right.outer));
}

/**
 * Record one bucket's inner value under its outer one, ignoring a bucket that named no inner value.
 *
 * @param members the accumulating map
 * @param outer the outer value this bucket belongs to
 * @param bucket the inner value and its count
 */
function addMember({
  members,
  outer,
  bucket,
}: {
  members: Map<string, CensusMember[]>;
  outer: string;
  bucket: { count: number; inner: string | undefined };
}): void {
  const { inner } = bucket;
  if (inner === undefined || inner.length === 0) {
    return;
  }
  const list = members.get(outer);
  if (list === undefined) {
    members.set(outer, [{ count: bucket.count, name: inner }]);
    return;
  }
  list.push({ count: bucket.count, name: inner });
}

/**
 * Build the CI PIPELINES census — one row per pipeline, its jobs as members.
 *
 * @param client the shared client
 * @param requester the read-only raw path, for the exemplars
 * @param window the absolute window
 * @param logger where progress goes
 * @returns the rows and everything the pass could not reach
 */
export async function censusCiPipelines({
  client,
  requester,
  window,
  logger,
}: {
  client: CensusClient;
  requester: RawRequester;
  window: AbsoluteWindow;
  logger: Logger;
}): Promise<ProductCensus> {
  const grouped = await ciPipelineGroups({
    client,
    facets: [
      { facet: PIPELINE_FACET, limit: OUTER_LIMIT },
      { facet: JOB_FACET, limit: INNER_LIMIT },
    ],
    query: "*",
    window,
  });
  if (grouped.isErr()) {
    return {
      notMeasured: [`the CI pipeline census — not counted: ${grouped.error.join("; ")}`],
      rows: [],
      services: [],
    };
  }
  const folded = foldTwoLevel({ buckets: grouped.value, innerFacet: JOB_FACET, outerFacet: PIPELINE_FACET });
  logger.info({ msg: `census ci-pipelines → ${String(folded.length)} pipeline(s)` });
  const shapes = folded.map((group): CountedShape => {
    return {
      count: group.count,
      identity: group.outer,
      label: group.outer,
      members: group.members,
      membersTruncated: grouped.value.truncated,
      query: `${PIPELINE_FACET}:${quoteTerm({ value: group.outer })}`,
      service: SERVICE_ABSENT,
    };
  });
  const exemplified = await exemplifyShapes({
    logger,
    product: "ci-pipelines",
    requester,
    shapes,
    track: "cipipeline",
    window,
  });
  return {
    notMeasured: [
      ...(grouped.value.truncated
        ? ["the CI pipeline census reached its own group ceiling — the rarest pipelines and jobs are absent from it"]
        : []),
      ...exemplified.notMeasured,
    ],
    rows: exemplified.rows,
    services: [],
  };
}

/**
 * The suites one test service runs, with the test names under each.
 *
 * @param client the shared client
 * @param service the test service
 * @param window the absolute window
 * @returns the shapes an exemplar pass consumes, and the line for a failed read
 */
async function readTestSuites({
  client,
  service,
  window,
}: {
  client: CensusClient;
  service: string;
  window: AbsoluteWindow;
}): Promise<{ shapes: readonly CountedShape[]; missed: string | null }> {
  const grouped = await ciTestGroups({
    client,
    facets: [
      { facet: TEST_SUITE_FACET, limit: OUTER_LIMIT },
      { facet: TEST_NAME_FACET, limit: INNER_LIMIT },
    ],
    query: `${TEST_SERVICE_FACET}:${quoteTerm({ value: service })}`,
    window,
  });
  if (grouped.isErr()) {
    return { missed: `${service}'s test suites — not counted: ${grouped.error.join("; ")}`, shapes: [] };
  }
  const shapes = foldTwoLevel({
    buckets: grouped.value,
    innerFacet: TEST_NAME_FACET,
    outerFacet: TEST_SUITE_FACET,
  }).map((suite): CountedShape => {
    return {
      count: suite.count,
      identity: suite.outer,
      label: `${service} ${suite.outer}`,
      members: suite.members,
      membersTruncated: grouped.value.truncated,
      query: `${TEST_SERVICE_FACET}:${quoteTerm({ value: service })} ${TEST_SUITE_FACET}:${quoteTerm({ value: suite.outer })}`,
      service,
    };
  });
  return { missed: null, shapes };
}

/**
 * Build the CI TESTS census — one row per `(test service, suite)`, its test names as members.
 *
 * @param client the shared client
 * @param requester the read-only raw path, for the exemplars
 * @param window the absolute window
 * @param logger where progress goes
 * @returns the rows, the test services and everything the pass could not reach
 */
export async function censusCiTests({
  client,
  requester,
  window,
  logger,
}: {
  client: CensusClient;
  requester: RawRequester;
  window: AbsoluteWindow;
  logger: Logger;
}): Promise<ProductCensus> {
  const listing = await ciTestGroups({
    client,
    facets: [{ facet: TEST_SERVICE_FACET, limit: OUTER_LIMIT }],
    query: "*",
    window,
  });
  if (listing.isErr()) {
    return { notMeasured: [`the CI test services — not counted: ${listing.error.join("; ")}`], rows: [], services: [] };
  }
  const services: ServiceVolume[] = listing.value.buckets.flatMap((bucket) => {
    const service = bucket.by[TEST_SERVICE_FACET];
    if (service === undefined || service.length === 0) {
      return [];
    }
    return [{ events: bucket.count, service }];
  });
  const notMeasured: string[] = [];
  const shapes: CountedShape[] = [];
  for (const entry of services) {
    const suites = await readTestSuites({ client, service: entry.service, window });
    if (suites.missed !== null) {
      notMeasured.push(suites.missed);
    }
    shapes.push(...suites.shapes);
    logger.info({ msg: `census ci-tests ${entry.service} → ${String(suites.shapes.length)} suite(s)` });
  }
  const exemplified = await exemplifyShapes({
    logger,
    product: "ci-tests",
    requester,
    shapes,
    track: "citest",
    window,
  });
  return { notMeasured: [...notMeasured, ...exemplified.notMeasured], rows: exemplified.rows, services };
}
