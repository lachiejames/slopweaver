/**
 * phantomDispatch — a `dispatched` ask with nothing behind it, from both ends.
 *
 * The defect these cover, measured: `turn dispatch --poll` answered `{"kind":"working"}` and
 * `--sweep` counted the same ask among "still working", for a dispatch whose liveness NOTHING had checked.
 * `working` is the screen's default arm and says only "no completion marker rendered"; it was being read as
 * "a session is alive". Two sessions then spent an hour proving a negative with the wrong oracle — a per-ask
 * worktree and a handover run journal, neither of which a `fresh-visible-session` dispatch ever creates.
 *
 * Every case here is pure or a real temp-home round trip: the liveness check, the surface reader and the
 * sweep's own effects are all injected plain fakes, so nothing is mocked and nothing touches a live cmux.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { recordDispatchNeverLanded } from "../../../../cli/commands/turn/dispatch.js";
import { type DispatchSweepDeps, sweepDispatchedAsks } from "../../../../cli/commands/turn/dispatchSweep.js";
import { liveScreenRead } from "../../../../cli/commands/turn/liveScreenRead.js";
import { CmuxErrors } from "../../../../cmux/errors.js";
import type { WorkspaceLivenessCheck } from "../../../../cmux/liveness.js";
import { classifyWorkspaceLiveness, isWorkspaceNotFound, workspaceGone } from "../../../../cmux/liveness.js";
import { activeAsks } from "../../../../live/ask/burst.js";
import type { AskIdentity } from "../../../../live/ask/identity.js";
import type { AppendableDispatchedEvent } from "../../../../live/ask/lifecycle.js";
import { askLifecycleKey, foldAskLifecycle, parseAskLifecycleLog } from "../../../../live/ask/lifecycle.js";
import { appendAskLifecycleEvent, readAskLifecycleText } from "../../../../live/ask/store.js";
import type { FreshDispatchRecord } from "../../../../live/turn/dispatch.js";
import { dispatchIdOf, sweepDecision, uncarriedAnswerDetail } from "../../../../live/turn/dispatch.js";
import { writeDispatchRecord } from "../../../../live/turn/dispatchStore.js";
import { quietReviewerSweepDeps } from "../../../reviewerSweepFakes.js";

/** The instant every active-ask read in this file is judged at — inside the fixtures' own window. */
const NOW_ISO = "2026-08-24T03:25:30.000Z";

const ASK: AskIdentity = { channel: "C1", messageTs: "1787541790.572479", threadTs: "1783755021.356589" };
const DISPATCH_ID = dispatchIdOf({ askIdentity: ASK });
const WORKSPACE_ID = "a0000011-0000-4000-8000-000000000012";
const SURFACE_ID = "44444444-4444-4444-8444-444444444444";
const LEASE = "2099-01-01T00:00:00.000Z";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

const DECISION = {
  confidence: "high",
  needs: [],
  rationale: "an open-ended live investigation",
  response: "respond",
  schemaVersion: 1,
  tier: "fresh-visible-session",
  truthMode: "current",
} as const;

const DISPATCHED: AppendableDispatchedEvent = {
  ...ASK,
  decision: DECISION,
  kind: "dispatched",
  leaseExpiresAt: LEASE,
  tier: "fresh-visible-session",
  tsIso: "2026-08-24T03:24:33.307Z",
};

/** A temp state home with one ask captured, dispatched, and its dispatch record written. */
function dispatchedHome(): string {
  const home = mkdtempSync(join(tmpdir(), "phantom-dispatch-"));
  fixtureDirs.push(home);
  appendAskLifecycleEvent({
    event: { ...ASK, kind: "captured", surface: "channel", tsIso: "2026-08-24T03:23:11.131Z", userId: "U1" },
    home,
  });
  appendAskLifecycleEvent({ event: DISPATCHED, home });
  const record: FreshDispatchRecord = {
    ...ASK,
    askPermalink: `https://example.slack.com/archives/C1/p1787541790572479?thread_ts=1783755021.356589&cid=C1`,
    briefPath: join(home, "brief.json"),
    decision: DECISION,
    dispatchId: DISPATCH_ID,
    execution: { mode: "continuous-drain", supervisorHost: "claude-code" },
    leaseExpiresAt: LEASE,
    schemaVersion: 3,
    session: {
      cwd: "/tmp/checkout",
      host: "claude-code",
      surfaceId: SURFACE_ID,
      surfaceRef: "surface:145",
      workspaceId: WORKSPACE_ID,
      workspaceRef: "workspace:136",
    },
  };
  writeDispatchRecord({ home, record });
  return home;
}

/** A liveness check that always answers the same verdict, whatever it is asked. */
function fixedLiveness({ verdict }: { verdict: "alive" | "gone" | "host-exited" | "unknown" }): WorkspaceLivenessCheck {
  return ({ workspaceId }) => {
    if (verdict === "alive") {
      return Promise.resolve({ kind: "alive", pid: 75199, process: "2.1.241", workspaceId } as const);
    }
    if (verdict === "gone") {
      return Promise.resolve(workspaceGone({ workspaceId }));
    }
    if (verdict === "host-exited") {
      return Promise.resolve(
        classifyWorkspaceLiveness({ processes: [{ children: [], name: "zsh", pid: 1 }], workspaceId }),
      );
    }
    return Promise.resolve({ kind: "unknown", reason: "the cmux socket did not answer", workspaceId } as const);
  };
}

describe("phantomDispatch — classifyWorkspaceLiveness", () => {
  it("calls a workspace running the host alive, naming the process that proves it", () => {
    const liveness = classifyWorkspaceLiveness({
      // Measured live: cmux reports a Claude Code process by its VERSION, never as `claude`.
      processes: [
        { children: [{ children: [], name: "caffeinate", pid: 2 }], name: "2.1.241", pid: 75199 },
        { children: [], name: "sleep", pid: 3 },
        { children: [{ children: [], name: "zsh", pid: 5 }], name: "zsh", pid: 4 },
      ],
      workspaceId: WORKSPACE_ID,
    });
    expect(liveness.kind).toBe("alive");
    expect(liveness).toStrictEqual({ kind: "alive", pid: 75199, process: "2.1.241", workspaceId: WORKSPACE_ID });
  });

  it("calls a workspace holding only an idle shell a host-exited phantom", () => {
    const liveness = classifyWorkspaceLiveness({
      processes: [
        { children: [], name: "sleep", pid: 3 },
        { children: [{ children: [], name: "zsh", pid: 5 }], name: "-zsh", pid: 4 },
      ],
      workspaceId: WORKSPACE_ID,
    });
    expect(liveness.kind).toBe("phantom");
    expect(liveness).toStrictEqual({
      kind: "phantom",
      reason: `cmux still lists workspace ${WORKSPACE_ID}, but nothing is running in it beyond an idle shell — the host exited`,
      why: "host-exited",
      workspaceId: WORKSPACE_ID,
    });
  });

  it("calls an empty tree a host-exited phantom too", () => {
    expect(classifyWorkspaceLiveness({ processes: [], workspaceId: WORKSPACE_ID }).kind).toBe("phantom");
  });

  it("finds a host nested under the surface's own shell rather than calling it a phantom", () => {
    const liveness = classifyWorkspaceLiveness({
      processes: [{ children: [{ children: [], name: "2.1.240", pid: 99 }], name: "zsh", pid: 4 }],
      workspaceId: WORKSPACE_ID,
    });
    expect(liveness.kind).toBe("alive");
  });

  it("names a workspace cmux no longer lists a workspace-gone phantom", () => {
    expect(workspaceGone({ workspaceId: WORKSPACE_ID })).toStrictEqual({
      kind: "phantom",
      reason: `cmux has no workspace ${WORKSPACE_ID} — the workspace this dispatch recorded is gone`,
      why: "workspace-gone",
      workspaceId: WORKSPACE_ID,
    });
  });

  it("reads a not_found by its code, and every other cmux failure as a broken oracle", () => {
    const notFound = CmuxErrors.callFailed({
      cmuxCode: "not_found",
      message: `no live cmux workspace answers to ${WORKSPACE_ID}`,
      method: "workspace.list",
    });
    expect(isWorkspaceNotFound({ error: notFound })).toBe(true);
    expect(
      isWorkspaceNotFound({
        error: CmuxErrors.callFailed({ cmuxCode: "internal_error", message: "boom", method: "workspace.list" }),
      }),
    ).toBe(false);
  });
});

describe("liveScreenRead — a recorded-dispatched ask with no live session", () => {
  it("reports phantom rather than working when the workspace is gone", async () => {
    const read = await liveScreenRead({
      askIdentity: ASK,
      checkLiveness: fixedLiveness({ verdict: "gone" }),
      dispatchId: DISPATCH_ID,
      home: dispatchedHome(),
      readSurface: () => Promise.resolve({ screen: "some shell prompt, no marker\n$ " }),
      surfaceId: SURFACE_ID,
      workspaceId: WORKSPACE_ID,
    });
    expect(read.truth.kind).toBe("phantom");
    expect(read.truth).toStrictEqual({
      kind: "phantom",
      reason: `cmux has no workspace ${WORKSPACE_ID} — the workspace this dispatch recorded is gone`,
      workspaceId: WORKSPACE_ID,
    });
  });

  it("reports phantom when an unreadable surface turns out to hold no session either", async () => {
    const read = await liveScreenRead({
      askIdentity: ASK,
      checkLiveness: fixedLiveness({ verdict: "host-exited" }),
      dispatchId: DISPATCH_ID,
      home: dispatchedHome(),
      readSurface: () => Promise.resolve({ unreachable: "Failed to read terminal text" }),
      surfaceId: SURFACE_ID,
      workspaceId: WORKSPACE_ID,
    });
    expect(read.truth.kind).toBe("phantom");
  });

  it("keeps working when the session IS alive", async () => {
    const read = await liveScreenRead({
      askIdentity: ASK,
      checkLiveness: fixedLiveness({ verdict: "alive" }),
      dispatchId: DISPATCH_ID,
      home: dispatchedHome(),
      readSurface: () => Promise.resolve({ screen: "esc to interrupt\n" }),
      surfaceId: SURFACE_ID,
      workspaceId: WORKSPACE_ID,
    });
    expect(read.truth).toStrictEqual({ kind: "working" });
  });

  it("never manufactures a phantom out of a broken oracle", async () => {
    const read = await liveScreenRead({
      askIdentity: ASK,
      checkLiveness: fixedLiveness({ verdict: "unknown" }),
      dispatchId: DISPATCH_ID,
      home: dispatchedHome(),
      readSurface: () => Promise.resolve({ unreachable: "Failed to read terminal text" }),
      surfaceId: SURFACE_ID,
      workspaceId: WORKSPACE_ID,
    });
    expect(read.truth).toStrictEqual({ kind: "unreachable", reason: "Failed to read terminal text" });
  });

  it("lets a session's own ready marker outrank a later phantom — a finished turn is done, not missing", async () => {
    const read = await liveScreenRead({
      askIdentity: ASK,
      checkLiveness: fixedLiveness({ verdict: "gone" }),
      dispatchId: DISPATCH_ID,
      home: dispatchedHome(),
      readSurface: () =>
        Promise.resolve({
          screen: `SLOPWEAVER_TURN_READY {"dispatchId":${JSON.stringify(DISPATCH_ID)},"answerPath":"/tmp/a.json"}`,
        }),
      surfaceId: SURFACE_ID,
      workspaceId: WORKSPACE_ID,
    });
    expect(read.truth).toStrictEqual({ answerPath: "/tmp/a.json", dispatchId: DISPATCH_ID, kind: "ready" });
  });
});

describe("sweepDecision", () => {
  it("reports phantom for a dispatch inside its lease whose workspace holds nothing", () => {
    expect(
      sweepDecision({
        ask: ASK,
        dispatched: DISPATCHED,
        nowIso: "2026-08-24T04:00:00.000Z",
        review: { hasUsableVerdict: false, inFlight: false, recordOpen: false, spawnedAt: undefined },
        screenTruth: { kind: "phantom", reason: "the workspace is gone", workspaceId: WORKSPACE_ID },
      }),
    ).toStrictEqual({ ask: ASK, kind: "phantom", reason: "the workspace is gone" });
  });

  it("still reports lease-expired for a phantom that is ALSO past its lease", () => {
    expect(
      sweepDecision({
        ask: ASK,
        dispatched: { ...DISPATCHED, leaseExpiresAt: "2026-08-24T05:24:24.490Z" },
        nowIso: "2026-08-24T06:00:00.000Z",
        review: { hasUsableVerdict: false, inFlight: false, recordOpen: false, spawnedAt: undefined },
        screenTruth: { kind: "phantom", reason: "the workspace is gone", workspaceId: WORKSPACE_ID },
      }),
    ).toStrictEqual({ ask: ASK, kind: "lease-expired" });
  });
});

describe("turn dispatch --sweep", () => {
  it("finalises a worker's own FAILED report as a terminal `failed`, never as still working or abandoned", async () => {
    const home = dispatchedHome();
    const lines: string[] = [];
    const deps: DispatchSweepDeps = {
      latestSubmittedMessage: () => Promise.resolve(undefined),
      reviewer: quietReviewerSweepDeps(),
      workerLiveness: ({ workspaceId }) =>
        Promise.resolve({ kind: "unknown", reason: "no cmux in a unit test", workspaceId }),
      freshScreenRead: ({ entry }) =>
        Promise.resolve({
          record: {
            ...ASK,
            askPermalink: "https://example.slack.com/archives/C1/p1787541790572479",
            briefPath: join(home, "brief.json"),
            decision: DECISION,
            dispatchId: dispatchIdOf({ askIdentity: entry }),
            execution: { mode: "continuous-drain", supervisorHost: "claude-code" },
            leaseExpiresAt: LEASE,
            schemaVersion: 3,
            session: {
              host: "claude-code",
              surfaceId: SURFACE_ID,
              surfaceRef: "surface:145",
              workspaceId: WORKSPACE_ID,
              workspaceRef: "workspace:136",
            },
          },
          screen: "",
          truth: { dispatchId: DISPATCH_ID, kind: "failed", reason: "the vendor portal needs a login I do not have" },
        }),
      // No reaction assertion in this case: the sweep is being driven for a different finding, and an
      // `undefined` here is exactly what a home with no Slack bot token supplies.
      reaction: undefined,
      processSnapshot: () => ({ kind: "rows", rows: [] }) as const,
      nowIso: () => "2026-08-24T04:00:00.000Z",
      writeLine: ({ line }) => lines.push(line),
    };
    await sweepDispatchedAsks({ deps, home });
    expect(lines).toStrictEqual([
      "worker-failed (finalised, stranded — one re-dispatch pending): C1/1787541790.572479 — the vendor portal needs a login I do not have",
      "sweep: 0 ready, 0 still working, 0 in-review, 1 worker-failed, 0 phantom, 0 lease-expired, 0 never-dispatched, 0 checklist-update-failed, 0 ignored",
    ]);
    const folded = foldAskLifecycle({ events: parseAskLifecycleLog({ text: readAskLifecycleText({ home }) }).events });
    const entry = folded.get(askLifecycleKey({ askIdentity: ASK }))!;
    expect(entry.state).toBe("failed");
    expect(entry.lastEvent).toStrictEqual({
      ...ASK,
      kind: "failed",
      reason: "the vendor portal needs a login I do not have",
      tsIso: "2026-08-24T04:00:00.000Z",
    });
  });

  it("counts a phantom separately from still working, and records dispatch-failed", async () => {
    const home = dispatchedHome();
    const lines: string[] = [];
    const deps: DispatchSweepDeps = {
      latestSubmittedMessage: () => Promise.resolve(undefined),
      reviewer: quietReviewerSweepDeps(),
      workerLiveness: ({ workspaceId }) =>
        Promise.resolve({ kind: "unknown", reason: "no cmux in a unit test", workspaceId }),
      freshScreenRead: ({ entry }) =>
        Promise.resolve({
          record: {
            ...ASK,
            askPermalink: "https://example.slack.com/archives/C1/p1787541790572479",
            briefPath: join(home, "brief.json"),
            decision: DECISION,
            dispatchId: dispatchIdOf({ askIdentity: entry }),
            execution: { mode: "continuous-drain", supervisorHost: "claude-code" },
            leaseExpiresAt: LEASE,
            schemaVersion: 3,
            session: {
              host: "claude-code",
              surfaceId: SURFACE_ID,
              surfaceRef: "surface:145",
              workspaceId: WORKSPACE_ID,
              workspaceRef: "workspace:136",
            },
          },
          screen: "",
          truth: { kind: "phantom", reason: "the workspace this dispatch recorded is gone", workspaceId: WORKSPACE_ID },
        }),
      // No reaction assertion in this case: the sweep is being driven for a different finding, and an
      // `undefined` here is exactly what a home with no Slack bot token supplies.
      reaction: undefined,
      processSnapshot: () => ({ kind: "rows", rows: [] }) as const,
      nowIso: () => "2026-08-24T04:00:00.000Z",
      writeLine: ({ line }) => lines.push(line),
    };
    await sweepDispatchedAsks({ deps, home });
    expect(lines).toStrictEqual([
      "phantom (nothing running, re-dispatch candidate): C1/1787541790.572479 — the workspace this dispatch recorded is gone",
      "sweep: 0 ready, 0 still working, 0 in-review, 0 worker-failed, 1 phantom, 0 lease-expired, 0 never-dispatched, 0 checklist-update-failed, 0 ignored",
    ]);
    const folded = foldAskLifecycle({ events: parseAskLifecycleLog({ text: readAskLifecycleText({ home }) }).events });
    expect(folded.get(askLifecycleKey({ askIdentity: ASK }))!.state).toBe("dispatch-failed");
  });
});

describe("a dispatch-failed ask resurfaces", () => {
  it("stops being active, so a later tag from the same asker no longer queues behind it", () => {
    const home = dispatchedHome();
    const dispatchedOnly = parseAskLifecycleLog({ text: readAskLifecycleText({ home }) }).events;
    expect(activeAsks({ nowIso: NOW_ISO, events: dispatchedOnly }).map((ask) => ask.messageTs)).toStrictEqual([
      ASK.messageTs,
    ]);
    appendAskLifecycleEvent({
      event: {
        ...ASK,
        kind: "dispatch-failed",
        reason: "the pickup command was never witnessed arriving in workspace workspace:136",
        tsIso: "2026-08-24T03:25:00.000Z",
      },
      home,
    });
    const afterFailure = parseAskLifecycleLog({ text: readAskLifecycleText({ home }) }).events;
    expect(activeAsks({ nowIso: NOW_ISO, events: afterFailure })).toStrictEqual([]);
    const folded = foldAskLifecycle({ events: afterFailure });
    const entry = folded.get(askLifecycleKey({ askIdentity: ASK }))!;
    expect(entry.state).toBe("dispatch-failed");
    expect(entry.lastEvent).toStrictEqual({
      ...ASK,
      kind: "dispatch-failed",
      reason: "the pickup command was never witnessed arriving in workspace workspace:136",
      tsIso: "2026-08-24T03:25:00.000Z",
    });
  });

  it("round-trips through the log's own parser rather than only through the fold", () => {
    const parsed = parseAskLifecycleLog({
      text: `${JSON.stringify({ ...ASK, kind: "dispatch-failed", reason: "nothing landed", schemaVersion: 1, tsIso: "2026-08-24T03:25:00.000Z" })}\n`,
    });
    expect(parsed.unreadable).toStrictEqual([]);
    expect(parsed.events).toStrictEqual([
      { ...ASK, kind: "dispatch-failed", reason: "nothing landed", tsIso: "2026-08-24T03:25:00.000Z" },
    ]);
  });

  it("refuses a dispatch-failed line carrying no reason — an unexplained one is not recoverable", () => {
    const parsed = parseAskLifecycleLog({
      text: `${JSON.stringify({ ...ASK, kind: "dispatch-failed", schemaVersion: 1, tsIso: "2026-08-24T03:25:00.000Z" })}\n`,
    });
    expect(parsed.events).toStrictEqual([]);
    expect(parsed.unreadable).toStrictEqual([1]);
  });
});

describe("uncarriedAnswerDetail — the same stall from the other end", () => {
  it("says nothing while a fresh completion is still ordinary", () => {
    expect(
      uncarriedAnswerDetail({ nowIso: "2026-08-24T04:43:40.000Z", recordedAtIso: "2026-08-24T04:42:40.000Z" }),
    ).toBeUndefined();
  });

  it("names how long an answer has been waiting once the silence is worth reporting", () => {
    expect(
      uncarriedAnswerDetail({ nowIso: "2026-08-24T05:22:40.000Z", recordedAtIso: "2026-08-24T04:42:40.000Z" }),
    ).toBe(
      "ready and unposted for 40m — the worker validated this answer but has not taken it through the door; check its workspace and its reviewer",
    );
  });

  it("says nothing for a marker written before the field existed, rather than guessing", () => {
    expect(uncarriedAnswerDetail({ nowIso: "2026-08-24T05:22:40.000Z", recordedAtIso: undefined })).toBeUndefined();
  });

  it("says nothing for an unparseable instant", () => {
    expect(uncarriedAnswerDetail({ nowIso: "2026-08-24T05:22:40.000Z", recordedAtIso: "not-a-time" })).toBeUndefined();
  });
});

describe("recordDispatchNeverLanded — the dispatch side of the same defect", () => {
  it("turns a dispatch whose pickup never landed into dispatch-failed, and frees the burst queue", async () => {
    const home = dispatchedHome();
    await recordDispatchNeverLanded({
      askIdentity: ASK,
      home,
      reason: "the pickup command was never witnessed arriving in workspace workspace:136",
    });
    const events = parseAskLifecycleLog({ text: readAskLifecycleText({ home }) }).events;
    const entry = foldAskLifecycle({ events }).get(askLifecycleKey({ askIdentity: ASK }))!;
    expect(entry.state).toBe("dispatch-failed");
    expect(entry.lastEvent).toStrictEqual({
      ...ASK,
      kind: "dispatch-failed",
      reason: "the pickup command was never witnessed arriving in workspace workspace:136",
      tsIso: entry.lastEvent.tsIso,
    });
    expect(activeAsks({ nowIso: NOW_ISO, events })).toStrictEqual([]);
  });

  it("still records the durable event for an ask whose fold carries no dispatched event at all", async () => {
    const home = mkdtempSync(join(tmpdir(), "phantom-dispatch-bare-"));
    fixtureDirs.push(home);
    appendAskLifecycleEvent({
      event: { ...ASK, kind: "captured", surface: "channel", tsIso: "2026-08-24T03:23:11.131Z", userId: "U1" },
      home,
    });
    await recordDispatchNeverLanded({ askIdentity: ASK, home, reason: "the workspace was never opened" });
    const events = parseAskLifecycleLog({ text: readAskLifecycleText({ home }) }).events;
    expect(foldAskLifecycle({ events }).get(askLifecycleKey({ askIdentity: ASK }))!.state).toBe("dispatch-failed");
  });
});
