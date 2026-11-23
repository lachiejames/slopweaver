import { describe, expect, it } from "vitest";

import { liveProjectUpdates } from "../../../../cycle/projectHistory.js";
import { ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import { readLinearProjectUpdates } from "../../../../live/linear/read.js";

const PROJECT_URL = "https://linear.app/example/project/backend-and-jobs-performance-0123abcd";

describe("readLinearProjectUpdates", () => {
  // The defect this reader exists for: the object document never selected the connection at all, so the verify
  // leg read "never updated" off every project. The query this sends must be the updates connection itself.
  it("asks for the projectUpdates connection by the URL's id, ordered by creation", async () => {
    const sent: { query: string; variables: Readonly<Record<string, unknown>> }[] = [];
    const connection = {
      nodes: [{ createdAt: "2026-08-30T11:16:20.584Z" }],
      pageInfo: { hasNextPage: false },
    };
    const result = await readLinearProjectUpdates({
      address: PROJECT_URL,
      limit: 250,
      request: ({ query, variables }) => {
        sent.push({ query, variables });
        return Promise.resolve(ok({ project: { projectUpdates: connection } }));
      },
    });
    expect(unwrap(result)).toEqual(connection);
    expect(sent.length).toBe(1);
    expect(sent[0]!.query).toContain("query project_projectUpdates");
    expect(sent[0]!.variables).toEqual({
      first: 250,
      id: "backend-and-jobs-performance-0123abcd",
      orderBy: "createdAt",
    });
    expect(liveProjectUpdates({ connection: unwrap(result) })!.lastUpdateIso).toBe("2026-08-30T11:16:20.584Z");
  });

  it("refuses an issue address rather than asking for a project's updates on it", async () => {
    const result = await readLinearProjectUpdates({
      address: "ENG-123",
      limit: 250,
      request: () => Promise.resolve(ok({})),
    });
    expect(unwrapErr(result).code).toBe("INVALID_ADDRESS");
  });

  it("names a project Linear did not return as not found", async () => {
    const result = await readLinearProjectUpdates({
      address: PROJECT_URL,
      limit: 250,
      request: () => Promise.resolve(ok({ project: null })),
    });
    expect(unwrapErr(result).code).toBe("NOT_FOUND");
  });

  it("hands back an absent connection as absent, so the parser refuses it", async () => {
    const result = await readLinearProjectUpdates({
      address: PROJECT_URL,
      limit: 250,
      request: () => Promise.resolve(ok({ project: { id: "p1" } })),
    });
    expect(liveProjectUpdates({ connection: unwrap(result) })).toBe(undefined);
  });
});
