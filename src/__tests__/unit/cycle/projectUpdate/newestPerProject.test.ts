/*
 * `newestPerProject` — collapsing several records of one project into one, the later record's fields with the
 * fullest history any of them held. It moved here when the project-update tests were split by behaviour.
 */
import { describe, expect, it } from "vitest";

import { newestPerProject } from "../../../../cycle/projectHistory.js";
import { project } from "./harness.js";

describe("newestPerProject", () => {
  it("keeps the newest row for one project id", () => {
    const old = project({ recordTsIso: "2026-08-01T00:00:00.000Z", status: "Backlog" });
    const now = project({ recordTsIso: "2026-08-28T00:00:00.000Z", status: "In Progress" });
    expect(newestPerProject({ projects: [now, old] }).map((row) => row.status)).toEqual(["In Progress"]);
  });

  // Measured: a status update does not move the project's own updatedAt, so a re-landed record
  // ties the stale one on timestamp and the first read used to win.
  it("breaks a timestamp tie by the later last update, in either read order", () => {
    const stale = project({ lastUpdateIso: "2026-06-29T00:00:00.000Z", updateCount: 2 });
    const fresh = project({ lastUpdateIso: "2026-08-30T11:16:20.584Z", updateCount: 3 });
    expect(newestPerProject({ projects: [stale, fresh] })[0]!.lastUpdateIso).toBe("2026-08-30T11:16:20.584Z");
    expect(newestPerProject({ projects: [fresh, stale] })[0]!.lastUpdateIso).toBe("2026-08-30T11:16:20.584Z");
  });

  it("prefers any update over none on a timestamp tie", () => {
    const never = project({ lastUpdateIso: undefined, updateCount: 0 });
    const updated = project({ lastUpdateIso: "2026-08-30T11:16:20.584Z", updateCount: 1 });
    expect(newestPerProject({ projects: [never, updated] })[0]!.updateCount).toBe(1);
    expect(newestPerProject({ projects: [updated, never] })[0]!.updateCount).toBe(1);
  });

  it("keeps the later record's fields but the history an older record held", () => {
    const older = project({
      lastUpdateIso: "2026-08-30T11:16:20.584Z",
      name: "Old name",
      recordTsIso: "2026-08-01T00:00:00.000Z",
      updateCount: 3,
    });
    const newer = project({ lastUpdateIso: undefined, recordTsIso: "2026-08-28T00:00:00.000Z", updateCount: 0 });
    const [kept] = newestPerProject({ projects: [older, newer] });
    expect(kept!.recordTsIso).toBe("2026-08-28T00:00:00.000Z");
    expect(kept!.name).toBe("Example project");
    expect(kept!.lastUpdateIso).toBe("2026-08-30T11:16:20.584Z");
    expect(kept!.updateCount).toBe(3);
  });

  it("takes the latest update and the largest count from different records", () => {
    const a = project({
      lastUpdateIso: "2026-09-10T00:00:00.000Z",
      recordTsIso: "2026-09-01T00:00:00.000Z",
      updateCount: 2,
    });
    const b = project({
      lastUpdateIso: "2026-08-01T00:00:00.000Z",
      recordTsIso: "2026-09-20T00:00:00.000Z",
      updateCount: 5,
    });
    const [kept] = newestPerProject({ projects: [b, a] });
    expect(kept!.recordTsIso).toBe("2026-09-20T00:00:00.000Z");
    expect(kept!.lastUpdateIso).toBe("2026-09-10T00:00:00.000Z");
    expect(kept!.updateCount).toBe(5);
  });
});
