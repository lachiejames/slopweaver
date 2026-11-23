/*
 * `cycleProjectOf` — reading one bronze project line into a `CycleProject`, its update history out of the
 * `projectUpdates` connection. It moved here when the project-update tests were split by behaviour.
 */
import { describe, expect, it } from "vitest";

import { cycleProjectOf } from "../../../../cycle/projectHistory.js";
import { OWNER } from "./harness.js";

describe("cycleProjectOf", () => {
  it("reads the updates out of the projectUpdates CONNECTION, not as a bare array", () => {
    const line = JSON.stringify({
      kind: "project",
      raw: {
        id: "p1",
        lead: { id: OWNER },
        name: "Example project",
        projectUpdates: {
          nodes: [{ createdAt: "2026-06-01T00:00:00.000Z" }, { createdAt: "2026-07-01T00:00:00.000Z" }],
        },
        status: { name: "In Progress" },
        url: "https://linear.app/example/project/example-project",
      },
      sourceId: "project:p1",
      tsIso: "2026-08-28T00:00:00.000Z",
    });
    const read = cycleProjectOf({ line })!;
    expect(read.updateCount).toBe(2);
    expect(read.lastUpdateIso).toBe("2026-07-01T00:00:00.000Z");
    expect(read.leadId).toBe(OWNER);
  });

  it("reads zero updates when the connection carries an empty nodes list", () => {
    const line = JSON.stringify({
      kind: "project",
      raw: { name: "p", projectUpdates: { nodes: [] }, status: { name: "In Progress" }, url: "u" },
      sourceId: "project:p1",
      tsIso: "2026-08-28T00:00:00.000Z",
    });
    expect(cycleProjectOf({ line })!.updateCount).toBe(0);
  });

  it("answers undefined for a row that is not a project", () => {
    expect(cycleProjectOf({ line: JSON.stringify({ kind: "issue", sourceId: "EXA-1" }) })).toBe(undefined);
  });

  it("answers undefined rather than throwing on an unparseable line", () => {
    expect(cycleProjectOf({ line: "}{" })).toBe(undefined);
  });
});
