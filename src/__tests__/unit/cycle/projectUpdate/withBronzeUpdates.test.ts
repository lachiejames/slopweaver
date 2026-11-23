/*
 * `withBronzeUpdates` — folding the update records bronze holds into the projects they name, by project id or by
 * the slug id a URL shares, ordered by instant. It moved here when the project-update tests were split by
 * behaviour.
 */
import { describe, expect, it } from "vitest";

import { withBronzeUpdates } from "../../../../cycle/projectHistory.js";
import { project } from "./harness.js";

describe("withBronzeUpdates", () => {
  // Measured: a project record written since the SDK migration carries no projectUpdates in its raw,
  // so the project read as never updated while its update record sat in the same bronze.
  it("gives a project whose own record carries no history the newest update naming it", () => {
    const bare = project({ id: "project:p1", lastUpdateIso: undefined, updateCount: 0 });
    const [folded] = withBronzeUpdates({
      projects: [bare],
      updates: [
        {
          createdAt: "2026-06-11T00:33:46.464Z",
          id: "projectUpdate:u1",
          projectId: "project:p1",
          projectSlugId: undefined,
        },
        {
          createdAt: "2026-08-30T11:16:04.713Z",
          id: "projectUpdate:u2",
          projectId: "project:p1",
          projectSlugId: undefined,
        },
        {
          createdAt: "2026-09-10T00:00:00.000Z",
          id: "projectUpdate:u3",
          projectId: "project:other",
          projectSlugId: undefined,
        },
      ],
    });
    expect(folded!.lastUpdateIso).toBe("2026-08-30T11:16:04.713Z");
    expect(folded!.updateCount).toBe(2);
  });

  it("keeps the record's own later update when the update records are older", () => {
    const recorded = project({ id: "project:p1", lastUpdateIso: "2026-08-30T11:16:04.713Z", updateCount: 3 });
    const [folded] = withBronzeUpdates({
      projects: [recorded],
      updates: [
        {
          createdAt: "2026-06-11T00:33:46.464Z",
          id: "projectUpdate:u1",
          projectId: "project:p1",
          projectSlugId: undefined,
        },
      ],
    });
    expect(folded!.lastUpdateIso).toBe("2026-08-30T11:16:04.713Z");
    expect(folded!.updateCount).toBe(3);
  });

  it("matches an update that names no project id by the slug id its URL shares with the project's", () => {
    const bare = project({
      id: "project:p1",
      lastUpdateIso: undefined,
      updateCount: 0,
      url: "https://linear.app/example/project/renamed-project-92f14fe7e9a9",
    });
    const [folded] = withBronzeUpdates({
      projects: [bare],
      updates: [
        {
          createdAt: "2026-09-01T00:00:00.000Z",
          id: "projectUpdate:u1",
          projectId: undefined,
          projectSlugId: "92f14fe7e9a9",
        },
        {
          createdAt: "2026-09-20T00:00:00.000Z",
          id: "projectUpdate:u2",
          projectId: undefined,
          projectSlugId: "0123456789ab",
        },
      ],
    });
    expect(folded!.lastUpdateIso).toBe("2026-09-01T00:00:00.000Z");
    expect(folded!.updateCount).toBe(1);
  });

  // Counterexample: compared as text, an instant at a `-12:00` offset sorts before one at `+14:00`
  // though it is 25 hours later.
  it("orders an offset timestamp by the instant it names, not by its spelling", () => {
    const recorded = project({ id: "project:p1", lastUpdateIso: "2026-09-21T00:00:00+14:00", updateCount: 1 });
    const [folded] = withBronzeUpdates({
      projects: [recorded],
      updates: [
        {
          createdAt: "2026-09-20T23:00:00-12:00",
          id: "projectUpdate:u1",
          projectId: "project:p1",
          projectSlugId: undefined,
        },
      ],
    });
    expect(folded!.lastUpdateIso).toBe("2026-09-20T23:00:00-12:00");
  });

  it("returns a project no update names untouched", () => {
    const bare = project({ id: "project:p1" });
    expect(withBronzeUpdates({ projects: [bare], updates: [] })).toEqual([bare]);
  });
});
