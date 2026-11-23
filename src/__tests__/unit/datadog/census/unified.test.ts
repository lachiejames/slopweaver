import { describe, expect, it } from "vitest";

import { exemplifyShapes } from "../../../../datadog/census/exemplify.js";
import { censusPageProduct, foldPageProduct, type PageProductSpec } from "../../../../datadog/census/tracks.js";
import { readExemplars, readTrackPage, trackListBody } from "../../../../datadog/census/unified.js";
import { type RawRequester, rawRequesterFrom } from "../../../../datadog/rawRequest.js";
import { rawTransportFrom } from "../../../../datadog/rawTransport.js";
import { createLogger } from "../../../../lib/logger.js";
import { err, ok } from "../../../../lib/result.js";

/** The window every case reads over. */
const WINDOW = { fromMs: 1_789_500_000_000, toMs: 1_789_503_600_000 };

/** A logger that keeps its lines instead of printing them. */
function quietLogger(): { logger: ReturnType<typeof createLogger>; lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    logger: createLogger({
      sink: (line) => {
        lines.push(line);
      },
    }),
  };
}

/** One track event as the endpoint returns it, wrapped in its envelope. */
function trackEvent({ fingerprint, message }: { fingerprint: string; message: string }): unknown {
  return {
    "datadog.index": "main",
    event: {
      __dd: { log_identity: { raw_msg_fingerprint: fingerprint } },
      custom: { level: 30 },
      message,
      service: "jobs-api",
      status: "error",
      tags: ["env:production"],
      timestamp: "2026-09-15T10:00:00.000Z",
    },
  };
}

/**
 * A requester whose transport answers each call from a queue of bodies as JSON text, so the REAL track boundary
 * reads every page — a plain fake function, not a mock.
 *
 * @param pages what each successive call answers, or a failure for one that should not come back
 */
function fakeRequester({ pages }: { pages: readonly (unknown | { failure: readonly string[] })[] }): {
  requester: RawRequester;
  bodies: unknown[];
} {
  const bodies: unknown[] = [];
  let call = 0;
  const transport = rawTransportFrom({
    lastRateLimit: () => null,
    requestRawTextWithStatus: async (input) => {
      bodies.push(input.body);
      const page = pages[Math.min(call, pages.length - 1)];
      call += 1;
      if (page !== null && typeof page === "object" && "failure" in page) {
        return err({ rateLimit: null, reasons: page.failure as readonly string[], status: null });
      }
      return ok({ bodyText: JSON.stringify(page), rateLimit: null, status: 200 });
    },
  });
  return { bodies, requester: rawRequesterFrom({ transport }) };
}

/** One page of the track, as the endpoint's envelope carries it: no `paging` at all on the last one. */
function trackPageBody({ events, after }: { events: readonly unknown[]; after: string | null }): unknown {
  const result = { count: events.length, events };
  return {
    elapsed: 12,
    hitCount: 4821,
    requestId: "example-request-id",
    result: after === null ? result : { ...result, paging: { after, values: ["v"] } },
    status: "done",
    type: "logs",
  };
}

describe("readTrackPage", () => {
  it("sends the `list` envelope the endpoint demands and reads the events back", async () => {
    const fake = fakeRequester({
      pages: [trackPageBody({ after: null, events: [trackEvent({ fingerprint: "abc", message: "boom 42" })] })],
    });
    const read = await readTrackPage({
      limit: 3,
      query: "service:jobs-api",
      requester: fake.requester,
      track: "logs",
      window: WINDOW,
    });
    expect(read.isOk()).toBe(true);
    const value = read._unsafeUnwrap();
    expect(value.events).toHaveLength(1);
    expect(value.events[0]!.message).toBe("boom 42");
    expect(value.fingerprints).toEqual(["abc"]);
    expect(value.hitCount).toBe(4821);
    expect(fake.bodies[0]).toEqual(trackListBody({ after: null, limit: 3, query: "service:jobs-api", window: WINDOW }));
  });

  it("answers the cursor when the page carried one, and nothing when it did not", async () => {
    const withCursor = fakeRequester({ pages: [trackPageBody({ after: "AwAAA", events: [] })] });
    const firstRead = await readTrackPage({
      limit: 1,
      query: "*",
      requester: withCursor.requester,
      track: "logs",
      window: WINDOW,
    });
    expect(firstRead._unsafeUnwrap().after).toBe("AwAAA");
    const without = fakeRequester({ pages: [trackPageBody({ after: null, events: [] })] });
    const secondRead = await readTrackPage({
      limit: 1,
      query: "*",
      requester: without.requester,
      track: "logs",
      window: WINDOW,
    });
    expect(secondRead._unsafeUnwrap().after).toBeNull();
  });

  it("carries the failure through rather than reporting an empty page", async () => {
    const fake = fakeRequester({ pages: [{ failure: ["HTTP 403: forbidden"] }] });
    const read = await readTrackPage({
      limit: 1,
      query: "*",
      requester: fake.requester,
      track: "logs",
      window: WINDOW,
    });
    expect(read.isErr()).toBe(true);
    expect(read._unsafeUnwrapErr()[0]!).toContain("403");
  });

  it("refuses a page whose wrapper gained a key, naming the key and the track's route, never reading it empty", async () => {
    const drifted = { event: { message: "sentinel-value-9f3c" }, id: "i1", added: 1 };
    const fake = fakeRequester({ pages: [trackPageBody({ after: null, events: [drifted] })] });
    const read = await readTrackPage({
      limit: 1,
      query: "*",
      requester: fake.requester,
      track: "trace",
      window: WINDOW,
    });
    const reasons = read._unsafeUnwrapErr();
    expect(reasons[0]!).toContain('new field "result.events[0].added"');
    expect(reasons[0]!).toContain("POST /api/v1/logs-analytics/list?type=trace");
    expect(reasons.join("\n")).not.toContain("sentinel-value-9f3c");
  });
});

describe("readExemplars — a failed read is an empty one PLUS the line saying so", () => {
  it("states the failure instead of failing the pass", async () => {
    const fake = fakeRequester({ pages: [{ failure: ["HTTP 500"] }] });
    const read = await readExemplars({
      limit: 3,
      logger: quietLogger().logger,
      query: "service:x",
      requester: fake.requester,
      track: "logs",
      window: WINDOW,
    });
    expect(read.events).toEqual([]);
    expect(read.missed!).toContain("no exemplar");
  });
});

describe("exemplifyShapes", () => {
  it("assembles one row per counted shape, folding the exemplar's own paths into it", async () => {
    const fake = fakeRequester({
      pages: [trackPageBody({ after: null, events: [trackEvent({ fingerprint: "abc", message: "boom 42" })] })],
    });
    const out = await exemplifyShapes({
      logger: quietLogger().logger,
      product: "logs",
      requester: fake.requester,
      shapes: [
        {
          count: 861_782,
          identity: "abc",
          label: "pattern abc",
          members: [],
          membersTruncated: false,
          query: 'service:"jobs-api" __dd.log_identity.raw_msg_fingerprint:abc',
          service: "jobs-api",
        },
      ],
      track: "logs",
      window: WINDOW,
    });
    expect(out.rows).toHaveLength(1);
    const row = out.rows[0]!;
    expect(row.key).toBe("logs|jobs-api|abc");
    expect(row.count).toBe(861_782);
    expect(row.countFrom).toBe("aggregate");
    expect(row.exemplars).toBe(1);
    expect(row.template).toBe("boom <n>");
    expect(row.paths.map((path) => path.path)).toContain("@level");
  });

  it("marks a shape with no count as counting no events at all", async () => {
    const fake = fakeRequester({ pages: [trackPageBody({ after: null, events: [] })] });
    const out = await exemplifyShapes({
      logger: quietLogger().logger,
      product: "metrics",
      requester: fake.requester,
      shapes: [
        {
          count: null,
          identity: "m",
          label: "m",
          members: [],
          membersTruncated: false,
          query: "m{*}",
          service: "(none)",
        },
      ],
      track: "logs",
      window: WINDOW,
    });
    expect(out.rows[0]!.countFrom).toBe("none");
    expect(out.rows[0]!.exemplars).toBe(0);
  });

  it("collects the line for every shape whose exemplar did not come back", async () => {
    const fake = fakeRequester({ pages: [{ failure: ["HTTP 429"] }] });
    const out = await exemplifyShapes({
      logger: quietLogger().logger,
      product: "logs",
      requester: fake.requester,
      shapes: [{ count: 1, identity: "a", label: "a", members: [], membersTruncated: false, query: "q", service: "s" }],
      track: "logs",
      window: WINDOW,
    });
    expect(out.notMeasured).toHaveLength(1);
    expect(out.notMeasured[0]!).toContain("429");
  });
});

describe("censusPageProduct — the products counted from pages", () => {
  const dbmSpec: PageProductSpec = {
    identityFacet: "@db.query_signature",
    identityFrom: ["@db.query_signature"],
    membersFrom: "@db.metadata.tables",
    product: "dbm",
    serviceFrom: ["@db.instance"],
    track: "databasequery",
  };

  /** One database-query event, as the track returns it. */
  function dbEvent({ signature }: { signature: string }): unknown {
    return {
      event: {
        custom: {
          "db.instance": "production-acme-postgres",
          "db.metadata": { tables: ["Customer"] },
          "db.query_signature": signature,
          "db.statement": "SELECT * FROM Customer WHERE email = 'someone@example.com'",
        },
        status: "info",
        timestamp: "2026-09-15T10:00:00.000Z",
      },
    };
  }

  it("reads pages until the cursor runs out and folds them into rows", async () => {
    const fake = fakeRequester({
      pages: [
        trackPageBody({ after: "cursor-1", events: [dbEvent({ signature: "a1" }), dbEvent({ signature: "a1" })] }),
        trackPageBody({ after: null, events: [dbEvent({ signature: "b2" })] }),
      ],
    });
    const census = await censusPageProduct({
      logger: quietLogger().logger,
      product: "dbm",
      requester: fake.requester,
      window: WINDOW,
    });
    expect(census.rows.map((row) => row.identity)).toEqual(["a1", "b2"]);
    expect(census.rows[0]!.count).toBe(2);
    expect(census.services).toEqual([{ events: 3, service: "production-acme-postgres" }]);
  });

  it("says the counts are a floor whenever the window held more than the pages did", async () => {
    const fake = fakeRequester({ pages: [trackPageBody({ after: null, events: [dbEvent({ signature: "a1" })] })] });
    const census = await censusPageProduct({
      logger: quietLogger().logger,
      product: "dbm",
      requester: fake.requester,
      window: WINDOW,
    });
    expect(census.notMeasured[0]!).toContain("floor");
  });

  it("states a page that did not come back rather than reporting an empty product", async () => {
    const fake = fakeRequester({ pages: [{ failure: ["HTTP 502"] }] });
    const census = await censusPageProduct({
      logger: quietLogger().logger,
      product: "profiles",
      requester: fake.requester,
      window: WINDOW,
    });
    expect(census.rows).toEqual([]);
    expect(census.notMeasured[0]!).toContain("502");
  });

  it("never stores the statement, only its path", async () => {
    const rows = foldPageProduct({
      events: [
        {
          attributes: {
            "@db.query_signature": "a1",
            "@db.statement": "SELECT * FROM Customer WHERE email = 'someone@example.com'",
          },
          message: null,
          occurredAtIso: "2026-09-15T10:00:00.000Z",
        },
      ],
      spec: dbmSpec,
    });
    expect(JSON.stringify(rows)).not.toContain("someone@example.com");
    expect(rows[0]!.paths.map((path) => path.path)).toContain("@db.statement");
  });
});
