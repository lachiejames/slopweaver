/* Which rows a watch reports: an unmapped row quiet past the window collapses into a count, and the line naming that count. */
import { describe, expect, it } from "vitest";

import { foldSessionActivity } from "../../../../cmux/sessionActivity.js";
import {
  renderSuppressedSessionWatchRows,
  reportedSessionWatchRows,
  STALE_UNMAPPED_AFTER_MS,
  sessionWatchRows,
} from "../../../../sessions/watchReport.js";
import { event, NOW, workspace } from "./harness.js";

describe("reportedSessionWatchRows", () => {
  /** Rows joined against an inventory holding only `mapped`, at a `now` an hour and a half past `staleIso`. */
  function rowsWithOneCorpse(): ReturnType<typeof sessionWatchRows> {
    const activities = foldSessionActivity({
      events: [
        event({ atIso: "2026-08-22T23:00:00.000Z", name: "agent.hook.Notification", seq: 1, workspaceId: "W-dead" }),
        event({ atIso: "2026-08-22T23:00:00.000Z", name: "agent.hook.Notification", seq: 2, workspaceId: "W-live" }),
        event({ atIso: "2026-08-23T00:30:00.000Z", name: "agent.hook.Notification", seq: 3, workspaceId: "W-fresh" }),
      ],
    });
    return sessionWatchRows({
      activities,
      idleAfterMs: 600_000,
      nowIso: NOW,
      workspaces: [workspace({ title: "live", workspaceId: "W-live" })],
    });
  }

  it("collapses an unmapped row quiet past the window, and counts what it collapsed", () => {
    const report = reportedSessionWatchRows({
      inventoryRead: true,
      rows: rowsWithOneCorpse(),
      staleAfterMs: STALE_UNMAPPED_AFTER_MS,
    });

    expect(report.suppressed).toBe(1);
    expect(report.suppressedOldestQuietMinutes).toBe(120);
    expect(report.rows.map((row) => row.workspaceId)).toEqual(["W-live", "W-fresh"]);
  });

  it("never collapses a mapped row, however long it has been quiet", () => {
    const report = reportedSessionWatchRows({
      inventoryRead: true,
      rows: rowsWithOneCorpse(),
      staleAfterMs: 1,
    });

    expect(report.rows.map((row) => row.workspaceId)).toEqual(["W-live"]);
    expect(report.suppressed).toBe(2);
  });

  it("keeps an unmapped row that has been quiet for less than the window", () => {
    const report = reportedSessionWatchRows({
      inventoryRead: true,
      rows: rowsWithOneCorpse(),
      staleAfterMs: STALE_UNMAPPED_AFTER_MS,
    });

    expect(report.rows.map((row) => row.workspaceId)).toContain("W-fresh");
  });

  it("collapses nothing when the cmux inventory could not be read, because every row is unmapped then", () => {
    const rows = rowsWithOneCorpse();
    const failed = reportedSessionWatchRows({ inventoryRead: false, rows, staleAfterMs: STALE_UNMAPPED_AFTER_MS });
    const succeeded = reportedSessionWatchRows({ inventoryRead: true, rows, staleAfterMs: STALE_UNMAPPED_AFTER_MS });

    expect(failed.suppressed).toBe(0);
    expect(failed.rows.length).toBe(3);
    expect(succeeded.suppressed).toBe(1);
  });

  it("collapses nothing when the caller asked to see the stale rows", () => {
    const report = reportedSessionWatchRows({
      includeStale: true,
      inventoryRead: true,
      rows: rowsWithOneCorpse(),
      staleAfterMs: STALE_UNMAPPED_AFTER_MS,
    });

    expect(report.suppressed).toBe(0);
    expect(report.rows.length).toBe(3);
  });

  it("reports no suppressed minutes when it suppressed nothing", () => {
    const report = reportedSessionWatchRows({ inventoryRead: true, rows: [], staleAfterMs: STALE_UNMAPPED_AFTER_MS });

    expect(report.suppressed).toBe(0);
    expect(report.suppressedOldestQuietMinutes).toBe(undefined);
  });
});

describe("renderSuppressedSessionWatchRows", () => {
  it("renders nothing when no row was collapsed", () => {
    const line = renderSuppressedSessionWatchRows({
      report: { rows: [], suppressed: 0, suppressedOldestQuietMinutes: undefined },
    });

    expect(line).toBe(undefined);
  });

  it("names the count, the oldest, and the flag that brings them back", () => {
    const line = renderSuppressedSessionWatchRows({
      report: { rows: [], suppressed: 385, suppressedOldestQuietMinutes: 8786 },
    });

    expect(line).toBe(
      "suppressed\t385 unmapped row(s) quiet over an hour, oldest 8786m — closed workspaces the fold still remembers; `--include-stale` to see them",
    );
  });
});
