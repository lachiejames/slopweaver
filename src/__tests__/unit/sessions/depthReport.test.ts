/** {@link sessionDepthRows} and {@link renderSessionDepthRow} — pure, joining already-read facts. */
import { describe, expect, it } from "vitest";

import type { CmuxWorkspaceSummary } from "../../../cmux/client.js";
import { type Measured, measured, unmeasurable } from "../../../measurement/status.js";
import { renderSessionDepthRow, type StandingSessions, sessionDepthRows } from "../../../sessions/depthReport.js";
import type { SessionRecord } from "../../../sessions/liveSessions.js";
import type { SessionItem } from "../../../sessions/session.js";
import type { ContextDepth } from "../../../sessions/tokenDepth.js";

/** One live session, as its registry file describes it. */
function record({ sessionId, cwd, pid = 100 }: { sessionId: string; cwd: string; pid?: number }): SessionRecord {
  return {
    cwd,
    entrypoint: "cli",
    kind: "interactive",
    name: "a-session",
    pid,
    sessionId,
    startedAtMs: 0,
    status: "busy",
  };
}

/** One cmux workspace summary, with only the fields this join reads set to anything meaningful. */
function workspace({ cwd, ref, title }: { cwd: string; ref: string; title: string | undefined }): CmuxWorkspaceSummary {
  return {
    currentDirectory: cwd,
    description: undefined,
    latestConversationMessage: undefined,
    latestSubmittedAtIso: undefined,
    latestSubmittedMessage: undefined,
    pinned: false,
    selected: false,
    title,
    windowId: "window-1",
    workspaceId: `id-${ref}`,
    workspaceRef: ref,
  };
}

/** One open ledger item for a cwd. */
function tracked({ cwd, sessionKey }: { cwd: string; sessionKey: string }): SessionItem {
  return { cwd, lastEventIso: "t", sessionKey, slug: sessionKey, status: "open" };
}

/** A measured depth. */
function depth({ tokens }: { tokens: number }): Measured<ContextDepth> {
  return measured({ value: { depthTokens: tokens, messageId: `msg_${String(tokens)}`, model: "claude-opus-5" } });
}

const NO_STANDING: StandingSessions = { loopCwd: undefined };

describe("sessionDepthRows", () => {
  it("joins the workspace title and the ledger key onto a session by its cwd", () => {
    const rows = sessionDepthRows({
      callerSessionId: undefined,
      depths: { s1: depth({ tokens: 120_000 }) },
      ledger: [tracked({ cwd: "/wt/a", sessionKey: "a-doc" })],
      records: [record({ cwd: "/wt/a", sessionId: "s1" })],
      standing: NO_STANDING,
      thresholdTokens: 300_000,
      workspaces: [workspace({ cwd: "/wt/a", ref: "workspace:7", title: "A doc" })],
    });

    expect(rows.length).toBe(1);
    expect(rows[0]!.title).toBe("A doc");
    expect(rows[0]!.workspaceRef).toBe("workspace:7");
    expect(rows[0]!.sessionKey).toBe("a-doc");
    expect(rows[0]!.slug).toBe("a-doc");
    expect(rows[0]!.verdict).toEqual(measured({ value: "under-threshold" }));
  });

  it("orders the deepest session first", () => {
    const rows = sessionDepthRows({
      callerSessionId: undefined,
      depths: { deep: depth({ tokens: 600_000 }), shallow: depth({ tokens: 10_000 }) },
      ledger: [],
      records: [record({ cwd: "/wt/a", sessionId: "shallow" }), record({ cwd: "/wt/b", sessionId: "deep" })],
      standing: NO_STANDING,
      thresholdTokens: 300_000,
      workspaces: [],
    });

    expect(rows.map((row) => row.sessionId)).toEqual(["deep", "shallow"]);
  });

  it("sorts an unmeasurable depth LAST rather than treating it as shallow", () => {
    const rows = sessionDepthRows({
      callerSessionId: undefined,
      depths: { known: depth({ tokens: 1 }), unknown: unmeasurable({ why: "no transcript yet" }) },
      ledger: [],
      records: [record({ cwd: "/wt/a", sessionId: "unknown" }), record({ cwd: "/wt/b", sessionId: "known" })],
      standing: NO_STANDING,
      thresholdTokens: 300_000,
      workspaces: [],
    });

    expect(rows.map((row) => row.sessionId)).toEqual(["known", "unknown"]);
    expect(rows[1]!.verdict).toEqual(unmeasurable({ why: "no transcript yet" }));
  });

  it("carries the reason forward when the caller measured no depth for a session at all", () => {
    const rows = sessionDepthRows({
      callerSessionId: undefined,
      depths: {},
      ledger: [],
      records: [record({ cwd: "/wt/a", sessionId: "s1" })],
      standing: NO_STANDING,
      thresholdTokens: 300_000,
      workspaces: [],
    });

    expect(rows[0]!.depth).toEqual({ known: false, why: "the transcript was not read this call" });
  });

  it("marks a session past the threshold as a respawn candidate", () => {
    const rows = sessionDepthRows({
      callerSessionId: undefined,
      depths: { s1: depth({ tokens: 595_000 }) },
      ledger: [],
      records: [record({ cwd: "/wt/a", sessionId: "s1" })],
      standing: NO_STANDING,
      thresholdTokens: 300_000,
      workspaces: [],
    });

    expect(rows[0]!.verdict).toEqual(measured({ value: "review" }));
  });

  it("says when two live sessions share one worktree, rather than silently labelling both the same", () => {
    const rows = sessionDepthRows({
      callerSessionId: undefined,
      depths: { s1: depth({ tokens: 5 }), s2: depth({ tokens: 6 }) },
      ledger: [],
      records: [record({ cwd: "/wt/a", pid: 1, sessionId: "s1" }), record({ cwd: "/wt/a", pid: 2, sessionId: "s2" })],
      standing: NO_STANDING,
      thresholdTokens: 300_000,
      workspaces: [],
    });

    expect(rows.map((row) => row.cwdShared)).toEqual([true, true]);
  });

  it("leaves cwdShared false for the only session in a worktree", () => {
    const rows = sessionDepthRows({
      callerSessionId: undefined,
      depths: { s1: depth({ tokens: 5 }) },
      ledger: [],
      records: [record({ cwd: "/wt/a", sessionId: "s1" })],
      standing: NO_STANDING,
      thresholdTokens: 300_000,
      workspaces: [],
    });

    expect(rows[0]!.cwdShared).toBe(false);
  });

  it("marks the loop by its resolved working directory", () => {
    const rows = sessionDepthRows({
      callerSessionId: undefined,
      depths: { s1: depth({ tokens: 5 }) },
      ledger: [],
      records: [record({ cwd: "/wt/loop", sessionId: "s1" })],
      standing: { loopCwd: "/wt/loop" },
      thresholdTokens: 300_000,
      workspaces: [],
    });

    expect(rows[0]!.standing).toBe("loop");
  });

  it("still judges a standing session's depth rather than exempting it", () => {
    const rows = sessionDepthRows({
      callerSessionId: undefined,
      depths: { s1: depth({ tokens: 616_000 }) },
      ledger: [],
      records: [record({ cwd: "/wt/loop", sessionId: "s1" })],
      standing: { loopCwd: "/wt/loop" },
      thresholdTokens: 300_000,
      workspaces: [],
    });

    expect(rows[0]!.standing).toBe("loop");
    expect(rows[0]!.verdict).toEqual(measured({ value: "review" }));
  });

  it("marks the caller's own row by session id, even where the worktree is shared", () => {
    const rows = sessionDepthRows({
      callerSessionId: "s2",
      depths: { s1: depth({ tokens: 9 }), s2: depth({ tokens: 8 }) },
      ledger: [],
      records: [record({ cwd: "/wt/a", pid: 1, sessionId: "s1" }), record({ cwd: "/wt/a", pid: 2, sessionId: "s2" })],
      standing: NO_STANDING,
      thresholdTokens: 300_000,
      workspaces: [],
    });

    expect(rows.filter((row) => row.self).map((row) => row.sessionId)).toEqual(["s2"]);
  });

  it("marks nothing self when the caller has no session id of its own", () => {
    const rows = sessionDepthRows({
      callerSessionId: undefined,
      depths: { s1: depth({ tokens: 9 }) },
      ledger: [],
      records: [record({ cwd: "/wt/a", sessionId: "s1" })],
      standing: NO_STANDING,
      thresholdTokens: 300_000,
      workspaces: [],
    });

    expect(rows[0]!.self).toBe(false);
  });

  it("ignores a ledger entry that has already been closed", () => {
    const rows = sessionDepthRows({
      callerSessionId: undefined,
      depths: { s1: depth({ tokens: 9 }) },
      ledger: [{ ...tracked({ cwd: "/wt/a", sessionKey: "a-doc" }), status: "closed" }],
      records: [record({ cwd: "/wt/a", sessionId: "s1" })],
      standing: NO_STANDING,
      thresholdTokens: 300_000,
      workspaces: [],
    });

    expect(rows[0]!.sessionKey).toBe(undefined);
  });

  it("reports no rows when no session is live", () => {
    expect(
      sessionDepthRows({
        callerSessionId: undefined,
        depths: {},
        ledger: [],
        records: [],
        standing: NO_STANDING,
        thresholdTokens: 300_000,
        workspaces: [],
      }),
    ).toEqual([]);
  });
});

describe("renderSessionDepthRow", () => {
  it("leads with the verdict and names the workspace title", () => {
    const rows = sessionDepthRows({
      callerSessionId: undefined,
      depths: { s1: depth({ tokens: 594_752 }) },
      ledger: [],
      records: [record({ cwd: "/wt/a", pid: 61_317, sessionId: "s1" })],
      standing: NO_STANDING,
      thresholdTokens: 300_000,
      workspaces: [workspace({ cwd: "/wt/a", ref: "workspace:157", title: "Research bundle refresh" })],
    });

    expect(renderSessionDepthRow({ row: rows[0]! })).toBe(
      "review\tResearch bundle refresh\t595k deep on claude-opus-5\tpid 61317",
    );
  });

  it("names an untitled, untracked workspace by its ref rather than its cwd", () => {
    const rows = sessionDepthRows({
      callerSessionId: undefined,
      depths: { s1: depth({ tokens: 10_000 }) },
      ledger: [],
      records: [record({ cwd: "/wt/a", pid: 9, sessionId: "s1" })],
      standing: NO_STANDING,
      thresholdTokens: 300_000,
      workspaces: [workspace({ cwd: "/wt/a", ref: "workspace:12", title: undefined })],
    });

    expect(renderSessionDepthRow({ row: rows[0]! })).toBe(
      "under-threshold\tworkspace:12\t10.0k deep on claude-opus-5\tpid 9",
    );
  });

  it("shows every mark a row carries", () => {
    const rows = sessionDepthRows({
      callerSessionId: "s1",
      depths: { s1: depth({ tokens: 10_000 }), s2: depth({ tokens: 1 }) },
      ledger: [],
      records: [
        record({ cwd: "/wt/loop", pid: 7, sessionId: "s1" }),
        record({ cwd: "/wt/loop", pid: 8, sessionId: "s2" }),
      ],
      standing: { loopCwd: "/wt/loop" },
      thresholdTokens: 300_000,
      workspaces: [],
    });

    expect(renderSessionDepthRow({ row: rows[0]! })).toBe(
      "under-threshold self standing:loop cwd-shared\t/wt/loop\t10.0k deep on claude-opus-5\tpid 7",
    );
  });

  it("says the depth was not measured rather than printing a zero", () => {
    const rows = sessionDepthRows({
      callerSessionId: undefined,
      depths: { s1: unmeasurable({ why: "no transcript file exists for this session id yet" }) },
      ledger: [tracked({ cwd: "/wt/a", sessionKey: "a-doc" })],
      records: [record({ cwd: "/wt/a", pid: 42, sessionId: "s1" })],
      standing: NO_STANDING,
      thresholdTokens: 300_000,
      workspaces: [],
    });

    expect(renderSessionDepthRow({ row: rows[0]! })).toBe(
      "no-verdict\ta-doc\tdepth NOT MEASURED — no transcript file exists for this session id yet\tpid 42",
    );
  });
});
