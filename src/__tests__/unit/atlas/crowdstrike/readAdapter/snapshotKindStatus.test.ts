/*
 * `readCrowdstrikeSnapshot` keeps each kind's manifest status its own: its success instant, a failed latest
 * attempt, a permission block and its published count, never another kind's.
 */
import { describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";
import { readCrowdstrikeSnapshot } from "../../../../../atlas/crowdstrike/readAdapter.js";
import { publishClean, scratchHome, useScratchHomes } from "./harness.js";

useScratchHomes();

describe("readCrowdstrikeSnapshot", () => {
  it("gives each kind its own success instant, never another kind's", () => {
    const home = scratchHome();
    publishClean({ home });

    expect(unwrap(readCrowdstrikeSnapshot({ home })).kinds.map((view) => view.lastSuccessAt)).toEqual([
      "2026-10-02T00:00:00.000Z",
      "2026-10-02T00:01:00.000Z",
      "2026-10-02T00:02:00.000Z",
      "2026-10-02T00:03:00.000Z",
      "2026-10-02T00:04:00.000Z",
      "2026-10-02T00:05:00.000Z",
      "2026-10-02T00:06:00.000Z",
      "2026-10-02T00:07:00.000Z",
      "2026-10-02T00:08:00.000Z",
      "2026-10-02T00:09:00.000Z",
    ]);
  });

  it("flags a failed latest attempt on the failing kind alone, without discarding its last success", () => {
    const home = scratchHome();
    publishClean({ home });
    const views = unwrap(readCrowdstrikeSnapshot({ home })).kinds;

    expect(views.filter((view) => view.latestAttemptFailed).map((view) => [view.kind, view.lastSuccessAt])).toEqual([
      ["vulnerability", "2026-10-02T00:04:00.000Z"],
    ]);
  });

  it("carries the permission block on the blocked kind alone", () => {
    const home = scratchHome();
    publishClean({ home });
    const views = unwrap(readCrowdstrikeSnapshot({ home })).kinds;

    expect(
      views.filter((view) => view.permissionBlocked !== null).map((view) => [view.kind, view.permissionBlocked]),
    ).toEqual([
      [
        "detection",
        {
          at: "2026-10-10T00:00:00.000Z",
          detail: "the API client may not read alerts",
          unblockedBy: "the Alerts: Read scope on the API client",
        },
      ],
    ]);
  });

  it("counts the entities each kind published, a different number for every kind", () => {
    const home = scratchHome();
    publishClean({ home });

    expect(unwrap(readCrowdstrikeSnapshot({ home })).kinds.map((view) => view.publishedCount)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
  });
});
