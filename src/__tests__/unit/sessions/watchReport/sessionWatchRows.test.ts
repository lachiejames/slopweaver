/* The supervisor's per-session view: the join against the inventory, the classification, and the order it reports them in. */
import { describe, expect, it } from "vitest";

import { foldSessionActivity } from "../../../../cmux/sessionActivity.js";
import { sessionWatchRows } from "../../../../sessions/watchReport.js";
import { event, NOW, workspace } from "./harness.js";

describe("sessionWatchRows", () => {
  it("names a session by its cmux title rather than its workspace id", () => {
    const activities = foldSessionActivity({
      events: [event({ atIso: NOW, name: "agent.hook.Stop", seq: 1, workspaceId: "W1" })],
    });

    const rows = sessionWatchRows({
      activities,
      idleAfterMs: 600_000,
      nowIso: NOW,
      workspaces: [workspace({ title: "a-doc", workspaceId: "W1" })],
    });

    expect(rows[0]!.title).toBe("a-doc");
    expect(rows[0]!.workspaceRef).toBe("workspace:1");
  });

  it("carries the agent CLI the hooks named as the seat's host, and undefined when none was named", () => {
    const activities = foldSessionActivity({
      events: [
        { ...event({ atIso: NOW, name: "agent.hook.Stop", seq: 1, workspaceId: "W1" }), agentSource: "codex" },
        event({ atIso: NOW, name: "agent.hook.Stop", seq: 2, workspaceId: "W2" }),
      ],
    });

    const rows = sessionWatchRows({ activities, idleAfterMs: 600_000, nowIso: NOW, workspaces: [] });

    expect(rows.map((row) => [row.workspaceId, row.host])).toEqual([
      ["W1", "codex"],
      ["W2", undefined],
    ]);
  });

  it("still reports a session whose workspace has since closed, rather than dropping it", () => {
    const activities = foldSessionActivity({
      events: [event({ atIso: NOW, name: "agent.hook.Stop", seq: 1, workspaceId: "W-gone" })],
    });

    const rows = sessionWatchRows({ activities, idleAfterMs: 600_000, nowIso: NOW, workspaces: [] });

    expect(rows.length).toBe(1);
    expect(rows[0]!.title).toBe(undefined);
    expect(rows[0]!.cwd).toBe("/repo/W-gone");
  });

  it("labels a row unmapped when its workspace id is absent from the inventory, rather than reporting a bare id", () => {
    const activities = foldSessionActivity({
      events: [event({ atIso: NOW, name: "agent.hook.Notification", seq: 1, workspaceId: "W-orphan" })],
    });

    const rows = sessionWatchRows({ activities, idleAfterMs: 600_000, nowIso: NOW, workspaces: [] });

    expect(rows.length).toBe(1);
    expect(rows[0]!.mapped).toBe(false);
    expect(rows[0]!.workspaceId).toBe("W-orphan");
  });

  it("marks a row mapped when its workspace id is present in the inventory", () => {
    const activities = foldSessionActivity({
      events: [event({ atIso: NOW, name: "agent.hook.Stop", seq: 1, workspaceId: "W1" })],
    });

    const rows = sessionWatchRows({
      activities,
      idleAfterMs: 600_000,
      nowIso: NOW,
      workspaces: [workspace({ title: "a-doc", workspaceId: "W1" })],
    });

    expect(rows[0]!.mapped).toBe(true);
  });

  it("puts a session waiting on the owner ahead of one that is merely quiet", () => {
    const activities = foldSessionActivity({
      events: [
        event({ atIso: "2026-08-23T00:00:00.000Z", name: "agent.hook.Stop", seq: 1, workspaceId: "W-quiet" }),
        event({ atIso: "2026-08-23T00:59:00.000Z", name: "agent.hook.Notification", seq: 2, workspaceId: "W-asking" }),
      ],
    });

    const rows = sessionWatchRows({ activities, idleAfterMs: 600_000, nowIso: NOW, workspaces: [] });

    expect(rows.map((row) => row.signal)).toEqual(["needs-input", "idle"]);
  });

  it("reports how long a session has been quiet, in whole minutes", () => {
    const activities = foldSessionActivity({
      events: [event({ atIso: "2026-08-23T00:30:00.000Z", name: "agent.hook.Stop", seq: 1, workspaceId: "W1" })],
    });

    const rows = sessionWatchRows({ activities, idleAfterMs: 600_000, nowIso: NOW, workspaces: [] });

    expect(rows[0]!.quietMinutes).toBe(30);
  });

  it("copies the session id, the last activity and the boot instant from the fold", () => {
    const activities = foldSessionActivity({
      events: [
        {
          ...event({ atIso: "2026-08-23T00:10:00.000Z", name: "agent.hook.SessionStart", seq: 1, workspaceId: "W1" }),
          sessionId: "S-1",
        },
        event({ atIso: "2026-08-23T00:40:00.000Z", name: "agent.hook.PreToolUse", seq: 2, workspaceId: "W1" }),
      ],
    });

    const rows = sessionWatchRows({ activities, idleAfterMs: 600_000, nowIso: NOW, workspaces: [] });

    expect(rows.map((row) => [row.sessionId, row.lastActivityAtIso, row.openedAtIso])).toEqual([
      ["S-1", "2026-08-23T00:40:00.000Z", "2026-08-23T00:10:00.000Z"],
    ]);
  });

  it("spells an activity instant canonically, and carries none when cmux stamped the event unknown", () => {
    const activities = foldSessionActivity({
      events: [
        event({ atIso: "2026-08-23T00:40:00+10:00", name: "agent.hook.SessionStart", seq: 1, workspaceId: "W1" }),
        event({ atIso: "unknown", name: "agent.hook.SessionStart", seq: 2, workspaceId: "W2" }),
      ],
    });

    const rows = sessionWatchRows({ activities, idleAfterMs: 600_000, nowIso: NOW, workspaces: [] });

    expect(new Map(rows.map((row) => [row.workspaceId, [row.lastActivityAtIso, row.openedAtIso]]))).toEqual(
      new Map([
        ["W1", ["2026-08-22T14:40:00.000Z", "2026-08-22T14:40:00.000Z"]],
        ["W2", [undefined, undefined]],
      ]),
    );
  });

  it("names the manager only for a pinned workspace titled /slopweaver:supervisor, and knows none for an unmapped row", () => {
    const activities = foldSessionActivity({
      events: ["W-sup", "W-unpinned", "W-other", "W-gone"].map((workspaceId, index) =>
        event({ atIso: NOW, name: "agent.hook.Stop", seq: index + 1, workspaceId }),
      ),
    });
    const supervisorTitle = "/slopweaver:supervisor";

    const rows = sessionWatchRows({
      activities,
      idleAfterMs: 600_000,
      nowIso: NOW,
      workspaces: [
        { ...workspace({ title: supervisorTitle, workspaceId: "W-sup" }), pinned: true },
        workspace({ title: supervisorTitle, workspaceId: "W-unpinned" }),
        { ...workspace({ title: "a-doc", workspaceId: "W-other" }), pinned: true },
      ],
    });

    expect(new Map(rows.map((row) => [row.workspaceId, row.manager]))).toEqual(
      new Map([
        ["W-sup", true],
        ["W-unpinned", false],
        ["W-other", false],
        ["W-gone", undefined],
      ]),
    );
  });
});
