/**
 * Every Datadog host in this file reads the synthetic `ap1` site rather than the install's own.
 */

import { describe, expect, it } from "vitest";

import { censusCiPipelines, censusCiTests } from "../../../../datadog/census/ci.js";
import { censusLogs } from "../../../../datadog/census/logs.js";
import { censusMetrics } from "../../../../datadog/census/metrics.js";
import { censusRum } from "../../../../datadog/census/rum.js";
import type { CensusClient } from "../../../../datadog/census/scope.js";
import { censusSpans } from "../../../../datadog/census/spans.js";
import { presentOr } from "../../../../datadog/detective/envelope.js";
import { type RawRequester, rawRequesterFrom } from "../../../../datadog/rawRequest.js";
import { rawTransportFrom } from "../../../../datadog/rawTransport.js";
import { createLogger } from "../../../../lib/logger.js";
import { ok } from "../../../../lib/result.js";

/** The window every case reads over. */
const WINDOW = { fromMs: 1_789_500_000_000, toMs: 1_789_503_600_000 };

/** A logger that keeps its lines instead of printing them. */
function quiet(): ReturnType<typeof createLogger> {
  return createLogger({ sink: () => undefined });
}

/** One grouped bucket in the `by`/`computes` shape logs, RUM and both CI products share. */
function bucket({ by, count }: { by: Readonly<Record<string, string>>; count: number }): unknown {
  return { by, computes: { c0: count } };
}

/** What a fake client answers for each product, per call, in order. */
interface FakeAnswers {
  readonly logs?: readonly unknown[];
  readonly spans?: readonly unknown[];
  readonly rum?: readonly unknown[];
  readonly ciPipelines?: readonly unknown[];
  readonly ciTests?: readonly unknown[];
  readonly metricNames?: readonly string[];
  readonly metricTags?: readonly string[];
}

/**
 * A client that answers each product's aggregate from a queue — a plain fake, not a mock.
 *
 * Every entry is one call's whole response. The last entry repeats, so a pass that makes more calls than the
 * case declared reads the same answer rather than crashing on an exhausted queue.
 *
 * @param answers what each product's successive calls answer
 * @returns a client the census readers accept, plus how many calls each product took
 */
function fakeClient({ answers }: { answers: FakeAnswers }): { client: CensusClient; calls: Record<string, number> } {
  const calls: Record<string, number> = { ciPipelines: 0, ciTests: 0, logs: 0, metrics: 0, rum: 0, spans: 0 };
  const next = ({ queue, product }: { queue: readonly unknown[] | undefined; product: string }): unknown => {
    const index = calls[product]!;
    calls[product] = index + 1;
    if (queue === undefined || queue.length === 0) {
      return { data: { buckets: [] } };
    }
    return queue[Math.min(index, queue.length - 1)];
  };
  const names = presentOr({ absent: [], value: answers.metricNames });
  const tags = presentOr({ absent: [], value: answers.metricTags });
  // oxlint-disable-next-line no-unsafe-type-assertion
  const client = {
    ciPipelines: {
      aggregateCIAppPipelineEvents: async () => next({ product: "ciPipelines", queue: answers.ciPipelines }),
    },
    ciTests: { aggregateCIAppTestEvents: async () => next({ product: "ciTests", queue: answers.ciTests }) },
    config: {
      apiHost: "api.ap1.datadoghq.com",
      apiKey: "0".repeat(32),
      appKey: "a".repeat(40),
      consoleHost: "ap1.datadoghq.com",
      site: "ap1.datadoghq.com",
    },
    logs: { aggregateLogs: async () => next({ product: "logs", queue: answers.logs }) },
    metrics: {
      listTagConfigurations: async () => {
        calls["metrics"] = calls["metrics"]! + 1;
        return { data: names.map((id) => ({ id, type: "metrics" })) };
      },
      listTagsByMetricName: async () => ({ data: { attributes: { tags } } }),
    },
    rum: { aggregateRUMEvents: async () => next({ product: "rum", queue: answers.rum }) },
    spans: { aggregateSpans: async () => next({ product: "spans", queue: answers.spans }) },
  } as unknown as CensusClient;
  return { calls, client };
}

/**
 * A requester whose transport answers every exemplar read, as JSON text the REAL track boundary reads, with one
 * event carrying the given attributes.
 */
function fakeRequester({ attributes }: { attributes: Readonly<Record<string, unknown>> }): RawRequester {
  const page = {
    hitCount: 1,
    result: { count: 1, events: [{ event: { ...attributes, timestamp: "2026-09-15T10:00:00.000Z" }, id: "i1" }] },
  };
  const transport = rawTransportFrom({
    lastRateLimit: () => null,
    requestRawTextWithStatus: async () => ok({ bodyText: JSON.stringify(page), rateLimit: null, status: 200 }),
  });
  return rawRequesterFrom({ transport });
}

describe("censusLogs", () => {
  it("counts every service's patterns and turns each into a row, labelled by its template", async () => {
    const fake = fakeClient({
      answers: {
        logs: [
          { data: { buckets: [bucket({ by: { service: "jobs-api" }, count: 18_806_693 })] } },
          {
            data: {
              buckets: [
                bucket({ by: { "__dd.log_identity.raw_msg_fingerprint": "abc" }, count: 861_782 }),
                bucket({ by: { "__dd.log_identity.raw_msg_fingerprint": "def" }, count: 4 }),
              ],
            },
          },
        ],
      },
    });
    const census = await censusLogs({
      client: fake.client,
      logger: quiet(),
      requester: fakeRequester({ attributes: { message: "boom 42", service: "jobs-api", status: "error" } }),
      window: WINDOW,
    });
    expect(census.services).toEqual([{ events: 18_806_693, service: "jobs-api" }]);
    expect(census.rows.map((row) => row.identity)).toEqual(["abc", "def"]);
    expect(census.rows[0]!.label).toBe("boom <n>");
    expect(census.rows[0]!.count).toBe(861_782);
    expect(census.rows[0]!.query).toBe('service:"jobs-api" __dd.log_identity.raw_msg_fingerprint:abc');
  });

  it("states a service listing that reached its own limit rather than implying it saw every service", async () => {
    const many = Array.from({ length: 1000 }, (_, index) => bucket({ by: { service: `s${String(index)}` }, count: 1 }));
    const fake = fakeClient({ answers: { logs: [{ data: { buckets: many } }, { data: { buckets: [] } }] } });
    const census = await censusLogs({
      client: fake.client,
      logger: quiet(),
      requester: fakeRequester({ attributes: {} }),
      window: WINDOW,
    });
    expect(census.notMeasured[0]!).toContain("group limit");
  });
});

describe("censusSpans", () => {
  it("keys a row on the operation and the kind, with the resources under it", async () => {
    const fake = fakeClient({
      answers: {
        spans: [
          { data: [{ attributes: { by: { service: "core-api" }, compute: { c0: 90_902_984 } } }] },
          {
            data: [
              {
                attributes: {
                  by: { "@span.kind": "client", operation_name: "postgresql.query" },
                  compute: { c0: 45_855_806 },
                },
              },
            ],
          },
          {
            data: [
              {
                attributes: {
                  by: { operation_name: "postgresql.query", resource_name: "SELECT * FROM Customer" },
                  compute: { c0: 900 },
                },
              },
            ],
          },
        ],
      },
    });
    const census = await censusSpans({
      client: fake.client,
      logger: quiet(),
      requester: fakeRequester({ attributes: { operation_name: "postgresql.query", service: "core-api" } }),
      window: WINDOW,
    });
    expect(census.rows).toHaveLength(1);
    expect(census.rows[0]!.label).toBe("postgresql.query (client)");
    expect(census.rows[0]!.members).toEqual([{ count: 900, name: "SELECT * FROM Customer" }]);
    expect(census.rows[0]!.query).toBe('service:"core-api" operation_name:"postgresql.query" @span.kind:"client"');
  });
});

describe("censusRum", () => {
  it("keys a row on the application and the event type, with the route groups under it", async () => {
    const fake = fakeClient({
      answers: {
        rum: [
          { data: { buckets: [bucket({ by: { service: "customer-ui" }, count: 12_685_319 })] } },
          { data: { buckets: [bucket({ by: { "@type": "view" }, count: 56_304 })] } },
          {
            data: {
              buckets: [bucket({ by: { "@type": "view", "@view.url_path_group": "/overview" }, count: 842_606 })],
            },
          },
        ],
      },
    });
    const census = await censusRum({
      client: fake.client,
      logger: quiet(),
      requester: fakeRequester({ attributes: { service: "customer-ui" } }),
      window: WINDOW,
    });
    expect(census.rows[0]!.label).toBe("customer-ui view");
    expect(census.rows[0]!.members).toEqual([{ count: 842_606, name: "/overview" }]);
    expect(census.rows[0]!.query).toBe('service:"customer-ui" @type:"view"');
  });
});

describe("censusCiPipelines / censusCiTests", () => {
  it("sums a pipeline across its jobs and keeps the jobs as members", async () => {
    const fake = fakeClient({
      answers: {
        ciPipelines: [
          {
            data: {
              buckets: [
                bucket({ by: { "@ci.job.name": "run", "@ci.pipeline.name": "PR checks" }, count: 57_954 }),
                bucket({ by: { "@ci.job.name": "integration", "@ci.pipeline.name": "PR checks" }, count: 20_237 }),
              ],
            },
          },
        ],
      },
    });
    const census = await censusCiPipelines({
      client: fake.client,
      logger: quiet(),
      requester: fakeRequester({ attributes: { ci_level: "pipeline" } }),
      window: WINDOW,
    });
    expect(census.rows).toHaveLength(1);
    expect(census.rows[0]!.count).toBe(78_191);
    expect(census.rows[0]!.members.map((member) => member.name)).toEqual(["run", "integration"]);
  });

  it("keys a test row on the service and the suite", async () => {
    const fake = fakeClient({
      answers: {
        ciTests: [
          { data: { buckets: [bucket({ by: { "@test.service": "acme-admin-e2e-staging" }, count: 4890 })] } },
          {
            data: {
              buckets: [
                bucket({
                  by: { "@test.name": "deposits and onboards", "@test.suite": "e2e/NewCustomerJourney.spec.ts" },
                  count: 215,
                }),
              ],
            },
          },
        ],
      },
    });
    const census = await censusCiTests({
      client: fake.client,
      logger: quiet(),
      requester: fakeRequester({ attributes: { test_level: "test" } }),
      window: WINDOW,
    });
    expect(census.services).toEqual([{ events: 4890, service: "acme-admin-e2e-staging" }]);
    expect(census.rows[0]!.identity).toBe("e2e/NewCustomerJourney.spec.ts");
    expect(census.rows[0]!.members).toEqual([{ count: 215, name: "deposits and onboards" }]);
  });

  it("states a refused pipeline aggregate rather than reporting a CI estate with no pipelines", async () => {
    const fake = fakeClient({ answers: { ciPipelines: [{ nothing: true }] } });
    const census = await censusCiPipelines({
      client: fake.client,
      logger: quiet(),
      requester: fakeRequester({ attributes: {} }),
      window: WINDOW,
    });
    expect(census.rows).toEqual([]);
  });
});

describe("censusMetrics", () => {
  it("makes one row per metric name, with its tag keys as members and no event count", async () => {
    const fake = fakeClient({
      answers: {
        metricNames: ["trace.http.server.request.hits", "booking.create.route"],
        metricTags: ["env:production", "env:staging", "host:localhost"],
      },
    });
    const census = await censusMetrics({ client: fake.client, logger: quiet() });
    expect(census.rows).toHaveLength(2);
    expect(census.rows.map((row) => row.identity).toSorted()).toEqual([
      "booking.create.route",
      "trace.http.server.request.hits",
    ]);
    expect(census.rows[0]!.count).toBeNull();
    expect(census.rows[0]!.countFrom).toBe("none");
    expect(census.rows[0]!.members).toEqual([
      { count: 2, name: "env" },
      { count: 1, name: "host" },
    ]);
    expect(census.rows[0]!.query).toContain("{*}");
  });

  it("keeps the values of an allowlisted tag key and none of an unlisted one", async () => {
    const fake = fakeClient({ answers: { metricNames: ["m"], metricTags: ["env:production", "pod_name:api-7f9"] } });
    const census = await censusMetrics({ client: fake.client, logger: quiet() });
    expect(census.rows[0]!.facets.map((facet) => facet.path)).toEqual(["env"]);
  });
});
