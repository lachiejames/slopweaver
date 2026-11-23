/*
 * `cycleIssueOf`, for the one field the project join needs: the project id read off a hydrated raw project. It
 * moved here when the project-update tests were split by behaviour.
 */
import { describe, expect, it } from "vitest";

import { cycleIssueOf } from "../../../../cycle/issue.js";

describe("cycleIssueOf project id", () => {
  it("reads the project id off a hydrated raw project", () => {
    const line = JSON.stringify({
      kind: "issue",
      raw: { project: { id: "p1", name: "Example project" }, state: { name: "Todo", type: "unstarted" } },
      sourceId: "EXA-1",
      tsIso: "2026-09-20T00:00:00.000Z",
    });
    const read = cycleIssueOf({ line })!;
    expect(read.projectId).toBe("p1");
    expect(read.projectName).toBe("Example project");
  });
});
