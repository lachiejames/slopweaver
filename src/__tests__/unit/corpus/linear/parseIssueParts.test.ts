import { describe, expect, it } from "vitest";
import { issueRaw, parseIssueLifecycle, parseIssueScalars } from "../../../../corpus/linear/parseIssueParts.js";

describe("issueRaw", () => {
  it("replaces each completed connection, drops both history streams and keeps every other field", () => {
    const node = {
      history: { nodes: [{ id: "h1" }] },
      identifier: "ENG-42",
      labels: { nodes: [{ name: "inline" }] },
      stateHistory: { nodes: [{ id: "s1" }] },
    };
    const nested = { history: [{ id: "h1" }], labels: [{ name: "inline" }, { name: "paged-in" }] };
    expect(issueRaw({ nested, node })).toEqual({
      identifier: "ENG-42",
      labels: { nodes: [{ name: "inline" }, { name: "paged-in" }] },
    });
  });
});

describe("parseIssueScalars", () => {
  it("keeps a priority of zero, which an absent one must not be confused with", () => {
    expect(parseIssueScalars({ node: { priority: 0 } })).toEqual({ priority: 0 });
    expect(parseIssueScalars({ node: {} })).toEqual({});
  });
});

describe("parseIssueLifecycle", () => {
  it("omits a timestamp that is null rather than carrying it", () => {
    expect(parseIssueLifecycle({ node: { completedAt: null, triagedAt: "2026-05-01" } })).toEqual({
      triagedAtIso: "2026-05-01",
    });
  });
});
