import { describe, expect, it } from "vitest";

import type { CrowdstrikeClientDeps, CrowdstrikeFetch } from "../../../../atlas/crowdstrike/client.js";
import { CrowdstrikeErrors } from "../../../../atlas/crowdstrike/errors.js";
import type { ProjectionContext } from "../../../../atlas/crowdstrike/projectionEnvelope.js";
import { readCrowdstrikeDetections } from "../../../../atlas/crowdstrike/syncPostureReaders.js";
import { readCrowdstrikeVulnerabilities, readQueryThenEntities } from "../../../../atlas/crowdstrike/syncReaders.js";
import { isRecord } from "../../../../lib/parsers.js";
import { err, ok, type Result, unwrap, unwrapErr } from "../../../../lib/result.js";

/** One request the scripted seam received. */
interface CapturedRequest {
  readonly url: string;
  readonly method: "GET" | "POST";
  readonly body: string | null;
}

/** A scripted HTTP seam: one answer per call, in order, and a record of every request made. */
function seam({ answers }: { answers: readonly { status: number; text: string }[] }): {
  deps: CrowdstrikeClientDeps;
  requests: CapturedRequest[];
} {
  const requests: CapturedRequest[] = [];
  const fetch: CrowdstrikeFetch = async ({ url, method, body }) => {
    const answer = answers[requests.length];
    requests.push({ body, method, url });
    if (answer === undefined) {
      throw new Error(`the seam was asked for request ${String(requests.length)}, beyond its script`);
    }
    return answer;
  };
  return {
    deps: {
      apiHost: "https://api.example-cloud.test",
      fetch,
      nowMs: () => 0,
      tokens: { invalidate: () => {}, mintCount: () => 1, token: async () => ok("bearer") },
    },
    requests,
  };
}

/** A 200 page carrying the given resources and, when given, a pagination total. */
function page({ resources, total }: { resources: readonly unknown[]; total?: number }): {
  status: number;
  text: string;
} {
  return {
    status: 200,
    text: JSON.stringify({ meta: total === undefined ? {} : { pagination: { total } }, resources }),
  };
}

/** What the test projection produces: the record's id plus the context it was handed. */
interface ProjectedProbe {
  readonly id: string;
  readonly context: ProjectionContext;
}

/** Projects `hg-1` and refuses anything else with a literal reason. */
function probeProjection({ raw, context }: { raw: unknown; context: ProjectionContext }): Result<ProjectedProbe> {
  const id = isRecord(raw) && typeof raw["id"] === "string" ? raw["id"] : "";
  if (id === "hg-1") {
    return ok({ context, id });
  }
  return err([`refused ${id}`]);
}

describe("readQueryThenEntities", () => {
  it("batches the retained query ids, keeps the projected entity and records the refusal and the short count", async () => {
    const { deps, requests } = seam({
      answers: [
        page({ resources: ["hg-1", "", 7, "hg-2"], total: 2 }),
        page({ resources: [{ id: "hg-1" }, { id: "hg-2" }] }),
      ],
    });

    const read = unwrap(
      await readQueryThenEntities({
        at: "2026-10-13T00:00:00.000Z",
        batchLimit: 100,
        deps,
        entityCallId: "host-group-entities",
        kind: "host-group",
        label: "host group",
        project: probeProjection,
        queryCallId: "host-group-ids",
      }),
    );

    expect(read).toEqual({
      complete: null,
      entities: [
        {
          context: {
            at: "2026-10-13T00:00:00.000Z",
            source: {
              endpoint: "/devices/entities/host-groups/v1",
              observedAt: "2026-10-13T00:00:00.000Z",
              surface: "falcon-api",
            },
          },
          id: "hg-1",
        },
      ],
      problems: ["refused hg-2", "the host-group read produced 1 of the 2 the provider reported, so it is incomplete"],
      reason: "read 1 host group(s)",
    });
    expect(requests).toEqual([
      {
        body: null,
        method: "GET",
        url: "https://api.example-cloud.test/devices/queries/host-groups/v1?limit=500&offset=0",
      },
      {
        body: null,
        method: "GET",
        url: "https://api.example-cloud.test/devices/entities/host-groups/v1?ids=hg-1&ids=hg-2",
      },
    ]);
  });

  it("returns ROUTE_ABSENT when the entity call answers 404, after the one query request", async () => {
    const { deps, requests } = seam({
      answers: [page({ resources: ["hg-1"], total: 1 }), { status: 404, text: "{}" }],
    });

    const error = unwrapErr(
      await readQueryThenEntities({
        at: "2026-10-13T00:00:00.000Z",
        batchLimit: 100,
        deps,
        entityCallId: "host-group-entities",
        kind: "host-group",
        label: "host group",
        project: probeProjection,
        queryCallId: "host-group-ids",
      }),
    );

    expect(error.code).toBe("ROUTE_ABSENT");
    expect(error).toEqual(
      CrowdstrikeErrors.routeAbsent({ callId: "host-group-entities", path: "/devices/entities/host-groups/v1" }),
    );
    expect(requests.map(({ url }) => url)).toEqual([
      "https://api.example-cloud.test/devices/queries/host-groups/v1?limit=500&offset=0",
      "https://api.example-cloud.test/devices/entities/host-groups/v1?ids=hg-1",
    ]);
  });
});

describe("readCrowdstrikeVulnerabilities", () => {
  it("asks Spotlight for open findings with the cve facet, at 400 per page", async () => {
    const { deps, requests } = seam({ answers: [page({ resources: [] })] });

    const read = unwrap(await readCrowdstrikeVulnerabilities({ at: "2026-10-13T00:00:00.000Z", deps }));

    expect(requests).toHaveLength(1);
    const url = new URL(requests[0]!.url);
    expect(url.pathname).toBe("/spotlight/combined/vulnerabilities/v1");
    expect(Object.fromEntries(url.searchParams)).toEqual({ facet: "cve", filter: "status:'open'", limit: "400" });
    expect(read.reason).toBe("read 0 open Spotlight finding(s); closed findings are deliberately not read");
  });
});

describe("readCrowdstrikeDetections", () => {
  it("sends the alert ids as composite_ids in a POST body after the GET query", async () => {
    const { deps, requests } = seam({ answers: [page({ resources: ["c1", "c2"] }), page({ resources: [] })] });

    const read = unwrap(await readCrowdstrikeDetections({ at: "2026-10-13T00:00:00.000Z", deps }));

    expect(requests).toEqual([
      { body: null, method: "GET", url: "https://api.example-cloud.test/alerts/queries/alerts/v2?limit=500&offset=0" },
      {
        body: '{"composite_ids":["c1","c2"]}',
        method: "POST",
        url: "https://api.example-cloud.test/alerts/entities/alerts/v2",
      },
    ]);
    expect(read).toEqual({
      complete: {
        kind: "detection",
        observed: 0,
        proof:
          "read 0 detection record(s) to the end of paging, the provider reported no total, so completeness rests on paging alone",
        provenBy: "provenCompleteRead",
      },
      entities: [],
      problems: [],
      reason: "read 0 detection(s)",
    });
  });
});
