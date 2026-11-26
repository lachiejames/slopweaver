/**
 * The host-neutral takeover decisions: which predecessor holds the seat with cmux's own pin still the authority for a
 * cmux one, whether an app caller's picture shows its sweep armed, and which one ledger row an app predecessor
 * answers to. Plain values in, plain values out.
 */
import { describe, expect, it } from "vitest";

import type { CmuxWorkspaceSummary } from "../../../cmux/client.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import type { AppSessionPicture, AppToolFact } from "../../../sessionHarness/pictureWire.js";
import { isAppSessionPicture } from "../../../sessionHarness/pictureWire.js";
import type { SessionItem } from "../../../sessions/session.js";
import type { SupervisorPinDisposition } from "../../../sessions/supervisorPinStore.js";
import {
  appPredecessorLedgerRow,
  appSweepGateOutcome,
  appSweepLeg,
  resolveTakeoverPredecessor,
  TakeoverResolutionErrors,
} from "../../../supervisor/takeoverSeat.js";

const APP_ID = "5f0c2a1e-7d3b-4c8e-9a6f-1b2c3d4e5f60";
const OTHER_APP_ID = "5f0c2a1e-7d3b-4c8e-9a6f-1b2c3d4e5f61";
const SESSION = { host: "claude-code", id: "a0000013-0000-4000-8000-000000000014" } as const;
const AT = "2026-11-09T01:00:00.000Z";
const ABSENT: SupervisorPinDisposition = { kind: "absent" };
const APP_RECORD: SupervisorPinDisposition = {
  kind: "pin",
  record: { appSessionId: APP_ID, pinnedAtIso: AT, session: SESSION },
};
const CMUX_CALLER = { kind: "cmux", workspaceId: "own" } as const;

/** One workspace row with just the fields these decisions read. */
function workspace(
  over: Partial<CmuxWorkspaceSummary> & { workspaceId: string; workspaceRef: string },
): CmuxWorkspaceSummary {
  return {
    currentDirectory: "/repo",
    description: undefined,
    latestConversationMessage: undefined,
    latestSubmittedAtIso: undefined,
    latestSubmittedMessage: undefined,
    pinned: false,
    selected: false,
    title: undefined,
    windowId: "window:1",
    ...over,
  };
}

describe("resolveTakeoverPredecessor, a cmux caller (the path before the app arm)", () => {
  it("refuses when nothing is pinned and nothing is recorded, in the words it always used", () => {
    const refused = unwrapErr(
      resolveTakeoverPredecessor({
        caller: CMUX_CALLER,
        disposition: ABSENT,
        workspaces: [workspace({ workspaceId: "own", workspaceRef: "workspace:1" })],
      }),
    );
    expect(refused.message).toBe("no workspace is currently pinned — there is no predecessor to take over from");
  });

  it("refuses when more than one workspace is pinned, naming both refs", () => {
    const refused = unwrapErr(
      resolveTakeoverPredecessor({
        caller: CMUX_CALLER,
        disposition: ABSENT,
        workspaces: [
          workspace({ pinned: true, workspaceId: "own", workspaceRef: "workspace:1" }),
          workspace({ pinned: true, workspaceId: "other", workspaceRef: "workspace:2" }),
        ],
      }),
    );
    expect(refused).toEqual(TakeoverResolutionErrors.multiple({ workspaceRefs: ["workspace:1", "workspace:2"] }));
  });

  it("refuses when the one pinned workspace is this session's own", () => {
    const refused = unwrapErr(
      resolveTakeoverPredecessor({
        caller: CMUX_CALLER,
        disposition: ABSENT,
        workspaces: [workspace({ pinned: true, workspaceId: "own", workspaceRef: "workspace:1" })],
      }),
    );
    expect(refused.message).toBe("workspace:1 is already this session's own workspace — nothing to take over");
  });

  it("resolves the one pinned workspace that is not this session's own, from cmux's pin with no record at all", () => {
    const predecessor = workspace({ pinned: true, workspaceId: "predecessor", workspaceRef: "workspace:2" });
    const resolved = resolveTakeoverPredecessor({
      caller: CMUX_CALLER,
      disposition: ABSENT,
      workspaces: [workspace({ workspaceId: "own", workspaceRef: "workspace:1" }), predecessor],
    });
    expect(unwrap(resolved)).toEqual({ kind: "cmux", workspace: predecessor });
  });

  it("resolves cmux's pin beside an unreadable record, which never decided a cmux predecessor", () => {
    const predecessor = workspace({ pinned: true, workspaceId: "predecessor", workspaceRef: "workspace:2" });
    const resolved = resolveTakeoverPredecessor({
      caller: CMUX_CALLER,
      disposition: { kind: "unreadable", why: "it does not parse" },
      workspaces: [predecessor],
    });
    expect(unwrap(resolved)).toEqual({ kind: "cmux", workspace: predecessor });
  });

  it("resolves a cmux record whose workspace cmux no longer lists as a GONE predecessor, never as absent", () => {
    const record = { pinnedAtIso: AT, session: SESSION, workspaceId: "gone", workspaceRef: "workspace:9" };
    const resolved = resolveTakeoverPredecessor({
      caller: CMUX_CALLER,
      disposition: { kind: "pin", record },
      workspaces: [workspace({ workspaceId: "own", workspaceRef: "workspace:1" })],
    });
    expect(unwrap(resolved)).toEqual({ kind: "gone-cmux", pin: record });
  });

  it("still refuses a cmux record whose workspace cmux lists unpinned, since that chair is not gone", () => {
    const stale: SupervisorPinDisposition = {
      kind: "pin",
      record: { pinnedAtIso: AT, session: SESSION, workspaceId: "unpinned", workspaceRef: "workspace:9" },
    };
    const refused = unwrapErr(
      resolveTakeoverPredecessor({
        caller: CMUX_CALLER,
        disposition: stale,
        workspaces: [workspace({ workspaceId: "unpinned", workspaceRef: "workspace:9" })],
      }),
    );
    expect(refused.code).toBe("NO_PREDECESSOR");
  });
});

describe("resolveTakeoverPredecessor, the app arm", () => {
  it("refuses one cmux pin beside an app record as two supervisors, never picking one by precedence", () => {
    const refused = unwrapErr(
      resolveTakeoverPredecessor({
        caller: CMUX_CALLER,
        disposition: APP_RECORD,
        workspaces: [workspace({ pinned: true, workspaceId: "predecessor", workspaceRef: "workspace:2" })],
      }),
    );
    expect(refused).toEqual(
      TakeoverResolutionErrors.crossHost({ appLabel: `app:${APP_ID}`, workspaceRef: "workspace:2" }),
    );
  });

  it("resolves the app record when cmux has nothing pinned", () => {
    const resolved = resolveTakeoverPredecessor({ caller: CMUX_CALLER, disposition: APP_RECORD, workspaces: [] });
    expect(unwrap(resolved)).toEqual({
      kind: "app",
      pin: { appSessionId: APP_ID, pinnedAtIso: AT, session: SESSION },
    });
  });

  it("resolves cmux's pin for an app caller, which cmux can never name as its own", () => {
    const predecessor = workspace({ pinned: true, workspaceId: APP_ID, workspaceRef: "workspace:2" });
    const resolved = resolveTakeoverPredecessor({
      caller: { appSessionId: APP_ID, kind: "app" },
      disposition: ABSENT,
      workspaces: [predecessor],
    });
    expect(unwrap(resolved)).toEqual({ kind: "cmux", workspace: predecessor });
  });

  it("refuses an app caller whose own session is the one recorded", () => {
    const refused = unwrapErr(
      resolveTakeoverPredecessor({
        caller: { appSessionId: APP_ID, kind: "app" },
        disposition: APP_RECORD,
        workspaces: [],
      }),
    );
    expect(refused.message).toBe(`app:${APP_ID} is already this session's own app session — nothing to take over`);
  });

  it("refuses an unreadable record when cmux has nothing pinned, since it could name an app session", () => {
    const refused = unwrapErr(
      resolveTakeoverPredecessor({
        caller: { appSessionId: OTHER_APP_ID, kind: "app" },
        disposition: { kind: "unreadable", why: "it does not parse" },
        workspaces: [],
      }),
    );
    expect(refused.code).toBe("PIN_RECORD_UNREADABLE");
  });
});

/** One ended or running tool call, named as the vendor reported it. */
function fact({ name, status }: { name: string; status: AppToolFact["status"] }): AppToolFact {
  return {
    lastObservedAtIso: AT,
    name,
    startedAtIso: AT,
    status,
    toolCallId: `sha256:${"a".repeat(64)}`,
    toolKind: "other",
  };
}

/** A picture of the caller's own session, holding the calls given. */
function picture({
  sessionId = APP_ID,
  inFlight = [],
  lastCompleted = [],
  droppedActivityEvents = 0,
}: {
  sessionId?: string;
  inFlight?: readonly AppToolFact[];
  lastCompleted?: readonly AppToolFact[];
  droppedActivityEvents?: number;
}): AppSessionPicture {
  return {
    facts: {
      countsByKind: {
        delegate: 0,
        delete: 0,
        edit: 0,
        execute: 0,
        fetch: 0,
        move: 0,
        other: inFlight.length + lastCompleted.length,
        read: 0,
        search: 0,
        switch_mode: 0,
        think: 0,
      },
      droppedActivityEvents,
      inFlight,
      lastCompleted,
    },
    readAtIso: AT,
    session: { handle: `app:${sessionId}`, sessionId, state: "running", title: "chair", vendor: "claude" },
  };
}

describe("appSweepLeg", () => {
  it("witnesses a ScheduleWakeup call the app reported as ended, and the name survives the wire's own check", () => {
    const seen = picture({ lastCompleted: [fact({ name: "ScheduleWakeup", status: "completed" })] });
    expect(isAppSessionPicture(JSON.parse(JSON.stringify(seen)))).toBe(true);
    expect(appSweepLeg({ appSessionId: APP_ID, picture: seen })).toEqual({ kind: "witnessed", where: "completed" });
  });

  it("witnesses one still in flight", () => {
    const seen = picture({ inFlight: [fact({ name: "ScheduleWakeup", status: "in_progress" })] });
    expect(appSweepLeg({ appSessionId: APP_ID, picture: seen })).toEqual({ kind: "witnessed", where: "in flight" });
  });

  it("never accepts some other tool in its place", () => {
    const seen = picture({ lastCompleted: [fact({ name: "Bash", status: "completed" })] });
    expect(appSweepLeg({ appSessionId: APP_ID, picture: seen })).toEqual({
      kind: "not-seen",
      why: "no ScheduleWakeup among 0 call(s) in flight and the last 1 ended; the picture keeps only the newest ended calls",
    });
  });

  it("names dropped activity reports, which make the absence weaker still", () => {
    const leg = appSweepLeg({ appSessionId: APP_ID, picture: picture({ droppedActivityEvents: 3 }) });
    expect(leg).toEqual({
      kind: "not-seen",
      why: "no ScheduleWakeup among 0 call(s) in flight and the last 0 ended, and 3 activity report(s) dropped; the picture keeps only the newest ended calls",
    });
  });

  it("refuses to read another session's picture as this one's", () => {
    const seen = picture({
      lastCompleted: [fact({ name: "ScheduleWakeup", status: "completed" })],
      sessionId: OTHER_APP_ID,
    });
    expect(appSweepLeg({ appSessionId: APP_ID, picture: seen })).toEqual({
      kind: "unread",
      why: `the picture names app:${OTHER_APP_ID}, not this session`,
    });
  });
});

describe("appSweepGateOutcome", () => {
  it("passes on the picture alone, saying the transcript was not read", () => {
    expect(appSweepGateOutcome({ picture: { kind: "witnessed", where: "completed" }, transcript: undefined })).toEqual({
      armed: true,
      witness: "ScheduleWakeup completed in the app's picture; transcript: not read, the app's picture decided",
    });
  });

  it("passes on the transcript when the picture did not see it", () => {
    expect(
      appSweepGateOutcome({
        picture: { kind: "not-seen", why: "nothing in it" },
        transcript: { kind: "witnessed", lineNumber: 12 },
      }),
    ).toEqual({ armed: true, witness: "ScheduleWakeup tool_use at line 12; app picture: nothing in it" });
  });

  it("refuses when neither witnessed, naming both", () => {
    const outcome = appSweepGateOutcome({
      picture: { kind: "unread", why: "the app is gone" },
      transcript: { kind: "unread", why: "a Codex thread" },
    });
    expect(outcome).toEqual({
      armed: false,
      refusal:
        "neither this session's app picture nor its transcript shows a ScheduleWakeup call yet — arm the § 7 sweep " +
        "before taking over the pin — app picture: not read: the app is gone; transcript: not read: a Codex thread",
    });
  });
});

/** One ledger row, open unless said otherwise. */
function row(over: Partial<SessionItem> & { sessionKey: string }): SessionItem {
  return {
    cwd: "/w/chair",
    harness: "app",
    lastEventIso: AT,
    sessionId: APP_ID,
    slug: over.sessionKey,
    status: "open",
    ...over,
  };
}

const literalDir = ({ dir }: { dir: string }): string => dir;

describe("appPredecessorLedgerRow", () => {
  it("finds the one open app row carrying the id, in the directory the app reports", () => {
    const chair = row({ sessionKey: "chair" });
    const found = appPredecessorLedgerRow({
      appSessionId: APP_ID,
      canonicalDir: literalDir,
      directory: "/w/chair",
      rows: [chair, row({ sessionId: OTHER_APP_ID, sessionKey: "seat" })],
    });
    expect(unwrap(found)).toEqual({ ...chair, sessionId: APP_ID });
  });

  it("refuses two open rows carrying the id, since step 5's close would reach both", () => {
    const refused = unwrapErr(
      appPredecessorLedgerRow({
        appSessionId: APP_ID,
        canonicalDir: literalDir,
        directory: "/w/chair",
        rows: [row({ sessionKey: "chair" }), row({ sessionKey: "chair-again" })],
      }),
    );
    expect(refused.message).toContain("2 open rows carry its id");
  });

  it("refuses an open row carrying the id under another host", () => {
    const refused = unwrapErr(
      appPredecessorLedgerRow({
        appSessionId: APP_ID,
        canonicalDir: literalDir,
        directory: "/w/chair",
        rows: [row({ harness: "cmux", sessionKey: "chair" })],
      }),
    );
    expect(refused.message).toContain("an open row carries its id under another host");
  });

  it("refuses a row recorded in another directory than the app reports now", () => {
    const refused = unwrapErr(
      appPredecessorLedgerRow({
        appSessionId: APP_ID,
        canonicalDir: literalDir,
        directory: "/w/elsewhere",
        rows: [row({ sessionKey: "chair" })],
      }),
    );
    expect(refused.code).toBe("APP_PREDECESSOR_ROW_UNMATCHED");
    expect(refused.message).toContain("(/w/elsewhere)");
  });

  it("ignores a closed row carrying the id", () => {
    const refused = unwrapErr(
      appPredecessorLedgerRow({
        appSessionId: APP_ID,
        canonicalDir: literalDir,
        directory: "/w/chair",
        rows: [row({ sessionKey: "chair", status: "closed" })],
      }),
    );
    expect(refused.message).toContain("0 open rows carry its id");
  });
});
