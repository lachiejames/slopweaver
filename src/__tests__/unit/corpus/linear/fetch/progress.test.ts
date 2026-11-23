/**
 * The Linear crawl's streamed progress: the pure issue and project preview builders, and the previews and
 * per-page heartbeats `fetchLinearActivity` emits while it walks.
 */
import { describe, expect, it } from "vitest";

import {
  fetchLinearActivity,
  type LinearApi,
  linearIssuePreview,
  linearProjectPreview,
} from "../../../../../corpus/linear/fetch.js";
import type { SourceProgressEvent } from "../../../../../corpus/progress.js";
import { issue, issuesPage } from "./harness.js";

describe("linear progress helpers (pure)", () => {
  it("builds an issue preview from its identifier + description/title", () => {
    expect(linearIssuePreview({ issue: issue({ identifier: "ENG-1" }) })).toEqual({
      lane: "content_preview",
      phase: "issues",
      preview: { snippet: "issue ENG-1", sourceContentId: "ENG-1", subject: "ENG-1" },
      source: "linear",
    });
  });

  it("previews an issue's description over its title when it has one", () => {
    const described = { ...issue({ identifier: "ENG-2" }), description: "the retriever drops old records" };
    expect(linearIssuePreview({ issue: described }).preview!.snippet).toBe("the retriever drops old records");
  });

  it("builds a project preview from its name + description", () => {
    expect(
      linearProjectPreview({ project: { description: "ship faster", id: "p1", name: "Quality", tsIso: "", url: "u" } }),
    ).toEqual({
      lane: "content_preview",
      phase: "projects",
      preview: { snippet: "ship faster", sourceContentId: "p1", subject: "Quality" },
      source: "linear",
    });
  });
});

describe("fetchLinearActivity streamed progress", () => {
  it("emits a first-item preview + a per-page heartbeat for issues and projects", async () => {
    const events: SourceProgressEvent[] = [];
    const api: LinearApi = {
      issues: async ({ cursor }) =>
        cursor === undefined
          ? issuesPage({ identifiers: ["ENG-1"], nextCursor: "c2" })
          : issuesPage({ identifiers: ["ENG-2"] }),
      projects: async () => ({ projects: [{ id: "p1", name: "Quality", tsIso: "", url: "u" }] }),
      users: async () => ({ nodes: [] }),
    };
    await fetchLinearActivity({
      api,
      onProgress: (e) => events.push(e),
      window: { since: "2026-01-01", until: "2026-06-01" },
    });
    const issuePreviews = events.filter((e) => e.lane === "content_preview" && e.phase === "issues");
    expect(issuePreviews.map((e) => e.preview!.subject)).toEqual(["ENG-1"]); // first page only
    const issueBeats = events.filter((e) => e.lane === "heartbeat" && e.phase === "issues");
    expect(issueBeats.map((e) => e.metrics!["issues"])).toEqual([1, 2]); // two pages, cumulative
    const projectBeats = events.filter((e) => e.lane === "heartbeat" && e.phase === "projects");
    expect(projectBeats.at(-1)!.metrics!["projects"]).toBe(1);
  });
});
