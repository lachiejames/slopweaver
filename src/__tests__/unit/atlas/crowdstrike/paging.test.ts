import { describe, expect, it } from "vitest";

import type { CrowdstrikeClientDeps, CrowdstrikeFetch } from "../../../../atlas/crowdstrike/client.js";
import { idBatches, readCursorPaged, readIdBatches, readOffsetPaged } from "../../../../atlas/crowdstrike/paging.js";
import { ok, unwrap, unwrapErr } from "../../../../lib/result.js";

/** A scripted HTTP seam: one answer per call, and a record of every URL asked for. */
function seam({ answers }: { answers: readonly { status: number; text: string }[] }): {
  deps: CrowdstrikeClientDeps;
  urls: string[];
  bodies: (string | null)[];
} {
  const urls: string[] = [];
  const bodies: (string | null)[] = [];
  let index = 0;
  const fetch: CrowdstrikeFetch = async ({ url, body }) => {
    urls.push(url);
    bodies.push(body);
    const answer = answers[Math.min(index, answers.length - 1)]!;
    index += 1;
    return answer;
  };
  return {
    bodies,
    deps: {
      apiHost: "https://api.example-cloud.test",
      fetch,
      nowMs: () => 0,
      tokens: { invalidate: () => {}, mintCount: () => 1, token: async () => ok("bearer") },
    },
    urls,
  };
}

const page = ({
  resources,
  total,
}: {
  resources: readonly unknown[];
  total?: number;
}): { status: number; text: string } => ({
  status: 200,
  text: JSON.stringify({ meta: total === undefined ? {} : { pagination: { total } }, resources }),
});

describe("readOffsetPaged", () => {
  it("stops when a page is shorter than the limit and calls the read complete", async () => {
    const { deps, urls } = seam({ answers: [page({ resources: ["a", "b"], total: 2 })] });
    const read = unwrap(await readOffsetPaged({ callId: "hosts-visible-ids", deps, pageSize: 500, query: {} }));
    expect(read.resources).toEqual(["a", "b"]);
    expect(read.pagesExhausted).toBe(true);
    expect(read.reportedTotal).toBe(2);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("limit=500");
    expect(urls[0]).toContain("offset=0");
  });

  it("advances the offset by what it has already collected", async () => {
    const { deps, urls } = seam({
      answers: [page({ resources: ["a", "b"], total: 3 }), page({ resources: ["c"], total: 3 })],
    });
    const read = unwrap(await readOffsetPaged({ callId: "hosts-visible-ids", deps, pageSize: 2, query: {} }));
    expect(read.resources).toEqual(["a", "b", "c"]);
    expect(urls[1]).toContain("offset=2");
  });

  it("carries a caller's fixed query onto every page", async () => {
    const { deps, urls } = seam({ answers: [page({ resources: [], total: 0 })] });
    await readOffsetPaged({ callId: "zta-assessment-ids", deps, pageSize: 500, query: { filter: "score:>0" } });
    expect(urls[0]).toContain("filter=score%3A%3E0");
  });
});

describe("readCursorPaged", () => {
  const cursorPage = ({ resources, after }: { resources: readonly unknown[]; after: string | null }) => ({
    status: 200,
    text: JSON.stringify({ meta: { pagination: after === null ? {} : { after } }, resources }),
  });

  it("follows the cursor until the provider offers none", async () => {
    const { deps, urls } = seam({
      answers: [cursorPage({ after: "c1", resources: ["a"] }), cursorPage({ after: null, resources: ["b"] })],
    });
    const read = unwrap(await readCursorPaged({ callId: "open-vulnerabilities", deps, pageSize: 400, query: {} }));
    expect(read.resources).toEqual(["a", "b"]);
    expect(read.pagesExhausted).toBe(true);
    expect(urls[1]).toContain("after=c1");
  });

  it("keeps the last total a page reported when a later page reports none", async () => {
    const { deps } = seam({
      answers: [
        { status: 200, text: JSON.stringify({ meta: { pagination: { after: "c1", total: 2 } }, resources: ["a"] }) },
        cursorPage({ after: null, resources: ["b"] }),
      ],
    });
    const read = unwrap(await readCursorPaged({ callId: "open-vulnerabilities", deps, pageSize: 400, query: {} }));
    expect(read.resources).toEqual(["a", "b"]);
    expect(read.reportedTotal).toBe(2);
  });

  it("REFUSES a cursor the provider repeats rather than looping", async () => {
    const { deps } = seam({ answers: [cursorPage({ after: "same", resources: ["a"] })] });
    const error = unwrapErr(await readCursorPaged({ callId: "open-vulnerabilities", deps, pageSize: 400, query: {} }));
    expect(error.code).toBe("INCOMPLETE_READ");
    expect(error.message).toContain("already returned");
  });
});

describe("idBatches", () => {
  it("splits a list into batches no larger than the endpoint accepts", () => {
    expect(idBatches({ ids: ["a", "b", "c"], size: 2 })).toEqual([["a", "b"], ["c"]]);
  });

  it("returns nothing for an empty list", () => {
    expect(idBatches({ ids: [], size: 100 })).toEqual([]);
  });
});

describe("readIdBatches", () => {
  it("sends the whole batch as a REPEATED query parameter", async () => {
    const { deps, urls } = seam({ answers: [page({ resources: [{ device_id: "a" }] })] });
    await readIdBatches({
      batchLimit: 100,
      byBody: false,
      callId: "host-entities",
      deps,
      idParam: "ids",
      ids: ["a", "b"],
    });
    expect(urls[0]).toContain("ids=a&ids=b");
  });

  it("carries the batch in a POST body when the endpoint takes one", async () => {
    const { deps, bodies } = seam({ answers: [page({ resources: [] })] });
    await readIdBatches({
      batchLimit: 100,
      byBody: true,
      callId: "alert-entities",
      deps,
      idParam: "composite_ids",
      ids: ["x"],
    });
    expect(bodies[0]).toBe('{"composite_ids":["x"]}');
  });

  it("fails the whole read when one batch fails, rather than returning a shorter fleet", async () => {
    const { deps } = seam({ answers: [{ status: 404, text: "{}" }] });
    const error = unwrapErr(
      await readIdBatches({
        batchLimit: 1,
        byBody: false,
        callId: "host-entities",
        deps,
        idParam: "ids",
        ids: ["a", "b"],
      }),
    );
    expect(error.code).toBe("ROUTE_ABSENT");
  });
});
