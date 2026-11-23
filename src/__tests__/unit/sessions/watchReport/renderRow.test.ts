/* One rendered watch line: the signal, then the name, then why, with a flag on a row the inventory does not hold. */
import { describe, expect, it } from "vitest";

import { foldSessionActivity } from "../../../../cmux/sessionActivity.js";
import { renderSessionWatchRow, sessionWatchRows } from "../../../../sessions/watchReport.js";
import { event, NOW, workspace } from "./harness.js";

describe("renderSessionWatchRow", () => {
  it("leads with the signal, then the name, then why", () => {
    const activities = foldSessionActivity({
      events: [
        event({ atIso: "2026-08-23T00:50:00.000Z", name: "agent.hook.AskUserQuestion", seq: 1, workspaceId: "W1" }),
      ],
    });
    const rows = sessionWatchRows({
      activities,
      idleAfterMs: 600_000,
      nowIso: NOW,
      workspaces: [workspace({ title: "a-doc", workspaceId: "W1" })],
    });

    expect(renderSessionWatchRow({ row: rows[0]! })).toBe(
      "needs-input\ta-doc\twaiting on you (question)\t0 tool call(s)",
    );
  });

  it("says it cannot tell what a waiting row waits on when its attention kind is absent", () => {
    const activities = foldSessionActivity({
      events: [
        event({ atIso: "2026-08-23T00:50:00.000Z", name: "agent.hook.AskUserQuestion", seq: 1, workspaceId: "W1" }),
      ],
    });
    const rows = sessionWatchRows({
      activities,
      idleAfterMs: 600_000,
      nowIso: NOW,
      workspaces: [workspace({ title: "a-doc", workspaceId: "W1" })],
    });

    expect(renderSessionWatchRow({ row: { ...rows[0]!, attentionKind: undefined } })).toBe(
      "needs-input\ta-doc\twaiting on you (unknown)\t0 tool call(s)",
    );
  });

  it("says how long a quiet session has been quiet, and after what", () => {
    const activities = foldSessionActivity({
      events: [event({ atIso: "2026-08-23T00:00:00.000Z", name: "agent.hook.Stop", seq: 1, workspaceId: "W1" })],
    });
    const rows = sessionWatchRows({ activities, idleAfterMs: 600_000, nowIso: NOW, workspaces: [] });

    expect(renderSessionWatchRow({ row: rows[0]! })).toContain("quiet 60m after agent.hook.Stop");
  });

  it("flags an unmapped row with its id and cwd rather than rendering a bare workspace id as the name", () => {
    const activities = foldSessionActivity({
      events: [
        event({ atIso: "2026-08-23T00:50:00.000Z", name: "agent.hook.Notification", seq: 1, workspaceId: "W-orphan" }),
      ],
    });
    const rows = sessionWatchRows({ activities, idleAfterMs: 600_000, nowIso: NOW, workspaces: [] });

    expect(renderSessionWatchRow({ row: rows[0]! })).toBe(
      "needs-input\t/repo/W-orphan [unmapped: id W-orphan not in cmux inventory — check `cmux list --json` / `session list --json`]\twaiting on you (notification)\t0 tool call(s)",
    );
  });
});
