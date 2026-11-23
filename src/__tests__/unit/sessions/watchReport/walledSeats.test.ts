/* Seats behind a wall: the screens a watch reads to find one, and how a logged-out or limit-walled seat is signalled. */
import { describe, expect, it } from "vitest";

import { foldSessionActivity } from "../../../../cmux/sessionActivity.js";
import { type SeatWall, seatRecoveryScreenTargets } from "../../../../sessions/seatRecovery.js";
import {
  renderSessionWatchRow,
  type SessionWatchRow,
  sessionWatchRows,
  withWalledSeats,
} from "../../../../sessions/watchReport.js";
import { event, workspace } from "./harness.js";

// The instant the measured seats 2..19 reopened logged out.
const REOPENED_AT = "2026-09-19T11:15:00.000Z";

const LOGGED_OUT: SeatWall = { kind: "logged-out" };
const LIMITED: SeatWall = {
  banner: "✻ Weekly limit reached · Retrying in 5h (Sep 13 at 8am) · attempt 1/300",
  kind: "limit-retrying",
};

describe("the screens a watch reads", () => {
  const rows = sessionWatchRows({
    activities: foldSessionActivity({
      events: [
        event({ atIso: "2026-09-19T11:14:30.000Z", name: "agent.hook.PreToolUse", seq: 1, workspaceId: "busy" }),
        event({ atIso: "2026-09-19T10:00:00.000Z", name: "agent.hook.Stop", seq: 2, workspaceId: "idle" }),
      ],
    }),
    idleAfterMs: 10 * 60_000,
    nowIso: REOPENED_AT,
    workspaces: [],
  });

  it("includes a seat the fold calls working, and one it never saw, but never a pinned one or the caller", () => {
    expect(rows.map((row) => [row.workspaceId, row.signal])).toEqual([
      ["idle", "idle"],
      ["busy", "working"],
    ]);
    const targets = seatRecoveryScreenTargets({
      chairWorkspaceId: undefined,
      ownWorkspaceId: "mine",
      workspaces: [
        workspace({ title: "busy", workspaceId: "busy" }),
        { ...workspace({ title: "chair", workspaceId: "chair" }), pinned: true },
        workspace({ title: "idle", workspaceId: "idle" }),
        workspace({ title: "mine", workspaceId: "mine" }),
        workspace({ title: "reopened", workspaceId: "reopened" }),
      ],
    });
    expect(targets.map((target) => target.workspaceId)).toEqual(["busy", "idle", "reopened"]);
  });
});

describe("withWalledSeats", () => {
  const rows = sessionWatchRows({
    activities: foldSessionActivity({
      events: [
        event({ atIso: "2026-09-19T10:00:00.000Z", name: "agent.hook.Stop", seq: 1, workspaceId: "seat-9" }),
        event({ atIso: "2026-09-19T11:14:50.000Z", name: "agent.hook.PreToolUse", seq: 2, workspaceId: "port" }),
      ],
    }),
    idleAfterMs: 10 * 60_000,
    nowIso: REOPENED_AT,
    workspaces: [
      workspace({ title: "seat 9", workspaceId: "seat-9" }),
      workspace({ title: "archive port", workspaceId: "port" }),
    ],
  });

  it("re-signals a known row logged-out and adds a row for a live workspace the fold never saw", () => {
    const marked = withWalledSeats({
      rows,
      wallsByWorkspaceId: new Map<string, SeatWall>([
        ["seat-9", LOGGED_OUT],
        ["seat-2", LOGGED_OUT],
      ]),
      workspaces: [
        workspace({ title: "seat 9", workspaceId: "seat-9" }),
        workspace({ title: "seat 2", workspaceId: "seat-2" }),
      ],
    });
    expect(marked.map((row) => [row.workspaceId, row.signal, row.lastEventName])).toEqual([
      ["seat-9", "logged-out", "agent.hook.Stop"],
      ["seat-2", "logged-out", "no hook event"],
      ["port", "working", "agent.hook.PreToolUse"],
    ]);
  });

  it("re-signals a WORKING row limit-retrying, and adds one for a limit-walled seat the fold never saw", () => {
    const marked = withWalledSeats({
      rows,
      wallsByWorkspaceId: new Map<string, SeatWall>([
        ["port", LIMITED],
        ["loop", LIMITED],
      ]),
      workspaces: [workspace({ title: "live loop", workspaceId: "loop" })],
    });
    expect(marked.map((row) => [row.workspaceId, row.signal, row.lastEventName])).toEqual([
      ["port", "limit-retrying", "agent.hook.PreToolUse"],
      ["loop", "limit-retrying", "no hook event"],
      ["seat-9", "idle", "agent.hook.Stop"],
    ]);
  });

  it("ranks both walls under one waiting on the owner and above one merely quiet", () => {
    const waiting: SessionWatchRow = { ...rows[0]!, signal: "needs-input", workspaceId: "asking" };
    const quiet: SessionWatchRow = { ...rows[0]!, signal: "silent", workspaceId: "quiet" };
    const marked = withWalledSeats({
      rows: [quiet, ...rows, waiting],
      wallsByWorkspaceId: new Map<string, SeatWall>([
        ["seat-9", LOGGED_OUT],
        ["port", LIMITED],
      ]),
      workspaces: [],
    });
    expect(marked.map((row) => row.signal)).toEqual(["needs-input", "logged-out", "limit-retrying", "silent"]);
  });

  it("names the one verb that re-seats a logged-out seat", () => {
    const [row] = withWalledSeats({ rows, wallsByWorkspaceId: new Map([["seat-9", LOGGED_OUT]]), workspaces: [] });
    expect(renderSessionWatchRow({ row: row! })).toBe(
      "logged-out\tseat 9\tNot logged in on screen — reopened without its setup token; run slopweaver session re-seat\t0 tool call(s)",
    );
  });

  it("names the one verb that re-seats a limit-walled seat", () => {
    const [row] = withWalledSeats({ rows, wallsByWorkspaceId: new Map([["port", LIMITED]]), workspaces: [] });
    expect(renderSessionWatchRow({ row: row! })).toBe(
      "limit-retrying\tarchive port\tusage-limit retry banner on screen — it answers nothing until its plan resets; run slopweaver session re-seat\t1 tool call(s)",
    );
  });

  it("returns the rows untouched when no screen showed a wall", () => {
    expect(withWalledSeats({ rows, wallsByWorkspaceId: new Map(), workspaces: [] })).toBe(rows);
  });
});
