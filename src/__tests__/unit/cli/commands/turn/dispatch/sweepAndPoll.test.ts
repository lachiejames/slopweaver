/**
 * `slopweaver turn dispatch` — `--sweep` and `--poll` with no fresh-session dispatch open, the durable marker
 * `liveScreenRead` checks before cmux, and `sweepDispatchedAsks` surfacing an expired lease.
 *
 * The `fresh-visible-session` tier itself calls the REAL `productionSpawnDeps()`/`readScreen` — hardwired,
 * not injected, deliberately: that lane is proven by the owner's own watched live run, never an automated
 * fixture faking a terminal. See `AGENTS.md`'s own doctrine on this.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runTurnDispatch } from "../../../../../../cli/commands/turn/dispatch.js";
import { type DispatchSweepDeps, sweepDispatchedAsks } from "../../../../../../cli/commands/turn/dispatchSweep.js";
import { liveScreenRead } from "../../../../../../cli/commands/turn/liveScreenRead.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { parseAskLifecycleLog } from "../../../../../../live/ask/lifecycle.js";
import {
  appendAskLifecycleEvent,
  ensureCapturedAskLifecycle,
  readAskLifecycleText,
} from "../../../../../../live/ask/store.js";
import { buildTurnRoutingBrief } from "../../../../../../live/turn/brief.js";
import { dispatchIdOf } from "../../../../../../live/turn/dispatch.js";
import { writeDispatchRecord } from "../../../../../../live/turn/dispatchStore.js";
import { writeTurnMarker } from "../../../../../../live/turn/turnMarkerStore.js";
import { stateHomePaths } from "../../../../../../stateHome.js";
import { quietReviewerSweepDeps } from "../../../../../reviewerSweepFakes.js";
import { CAPTURE_CARD, RESPOND_INLINE, RESPOND_SUBAGENT, ROUTING_INPUT } from "./fixtures.js";
import { fixtureDirs, lastLifecycleEvent, removeFixtureDirs } from "./harness.js";

afterEach(removeFixtureDirs);

describe("turn dispatch — sweep and poll, with no fresh-session dispatch open", () => {
  it("--sweep reports zero when nothing is currently dispatched", async () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-turn-dispatch-sweep-"));
    fixtureDirs.push(home);
    expect(await runTurnDispatch(["node", "slopweaver", "turn", "dispatch", "--sweep", "--home", home])).toBe(EXIT_OK);
  });

  it("--poll refuses a dispatch id no record exists for, before touching cmux", async () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-turn-dispatch-poll-"));
    fixtureDirs.push(home);
    const code = await runTurnDispatch([
      "node",
      "slopweaver",
      "turn",
      "dispatch",
      "--poll",
      JSON.stringify(["C1", "1.1", "1.1"]),
      "--home",
      home,
    ]);
    expect(code).toBe(EXIT_ERROR);
  });

  it("--poll refuses (never touching cmux) when the durable record belongs to a PRIOR dispatch generation", async () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-turn-dispatch-poll-stale-generation-"));
    fixtureDirs.push(home);
    const askIdentity = { channel: "C1", messageTs: "1785000000.000100", threadTs: "1785000000.000100" };
    const dispatchId = dispatchIdOf({ askIdentity });

    ensureCapturedAskLifecycle({ askIdentity, home, surface: "channel", userId: "U0OWNER" });
    // The CURRENT generation's lease — this is what a live re-dispatch would have just appended.
    appendAskLifecycleEvent({
      event: {
        ...askIdentity,
        decision: RESPOND_SUBAGENT,
        kind: "dispatched",
        leaseExpiresAt: "2099-01-01T00:00:00.000Z",
        tier: "fresh-visible-session",
        tsIso: "2026-08-13T00:00:00.000Z",
      },
      home,
    });
    // A STALE record left over from a PRIOR generation of the same ask — a different lease, an unreachable
    // fake surface/workspace. If the generation check ever regresses, this would fall through to a real
    // `readScreen` call against that fake locator instead of refusing outright.
    writeDispatchRecord({
      home,
      record: {
        ...askIdentity,
        askPermalink: "https://example.slack.com/archives/C1/p1785000000000100",
        briefPath: "/tmp/brief.json",
        decision: RESPOND_SUBAGENT,
        dispatchId,
        execution: { mode: "single-turn", supervisorHost: "claude-code" },
        leaseExpiresAt: "2020-01-01T00:00:00.000Z",
        schemaVersion: 3,
        session: {
          host: "claude-code",
          surfaceId: "id-prior-generation-surface",
          surfaceRef: "prior-generation-surface",
          workspaceId: "id-prior-generation-workspace",
          workspaceRef: "prior-generation-workspace",
        },
      },
    });

    const code = await runTurnDispatch([
      "node",
      "slopweaver",
      "turn",
      "dispatch",
      "--poll",
      dispatchId,
      "--home",
      home,
    ]);
    expect(code).toBe(EXIT_ERROR);
  });
});

/**
 * The durable-marker fallback `liveScreenRead` checks BEFORE ever touching cmux — the fix for a host TUI
 * (Claude Code's own) collapsing a successful bash tool call's stdout into a summary line that never shows
 * the `SLOPWEAVER_TURN_READY`/`SLOPWEAVER_TURN_FAILED` marker `freshScreenTruth` needs. Both cases here use a
 * deliberately UNREACHABLE fake `surfaceRef`/`workspaceRef` — the same trick as the stale-generation poll
 * test above — so any accidental fallthrough to a real `readScreen` call is caught immediately rather than
 * masked by a coincidentally-reachable fixture.
 */
describe("liveScreenRead — durable marker checked before cmux", () => {
  const ASK_IDENTITY = { channel: "C1", messageTs: "1785000000.000200", threadTs: "1785000000.000200" };
  const DISPATCH_ID = dispatchIdOf({ askIdentity: ASK_IDENTITY });
  const CURRENT_LEASE = "2099-01-01T00:00:00.000Z";

  /** Seed a CURRENT-generation dispatched ask + dispatch record, pointed at an unreachable fake surface. */
  function seedCurrentGeneration({ home }: { home: string }): void {
    ensureCapturedAskLifecycle({ askIdentity: ASK_IDENTITY, home, surface: "channel", userId: "U0OWNER" });
    appendAskLifecycleEvent({
      event: {
        ...ASK_IDENTITY,
        decision: RESPOND_SUBAGENT,
        kind: "dispatched",
        leaseExpiresAt: CURRENT_LEASE,
        tier: "fresh-visible-session",
        tsIso: "2026-08-17T00:00:00.000Z",
      },
      home,
    });
    writeDispatchRecord({
      home,
      record: {
        ...ASK_IDENTITY,
        askPermalink: "https://example.slack.com/archives/C1/p1785000000000200",
        briefPath: "/tmp/brief.json",
        decision: RESPOND_SUBAGENT,
        dispatchId: DISPATCH_ID,
        execution: { mode: "single-turn", supervisorHost: "claude-code" },
        leaseExpiresAt: CURRENT_LEASE,
        schemaVersion: 3,
        session: {
          host: "claude-code",
          surfaceId: "id-unreachable-surface",
          surfaceRef: "unreachable-surface",
          workspaceId: "id-unreachable-workspace",
          workspaceRef: "unreachable-workspace",
        },
      },
    });
  }

  it("resolves ready from a current-generation durable marker, without ever reaching cmux", async () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-turn-dispatch-marker-ready-"));
    fixtureDirs.push(home);
    seedCurrentGeneration({ home });
    writeTurnMarker({
      askIdentity: ASK_IDENTITY,
      home,
      marker: { answerPath: "/tmp/answer.json", dispatchId: DISPATCH_ID, kind: "ready", leaseExpiresAt: CURRENT_LEASE },
    });

    const read = await liveScreenRead({
      askIdentity: ASK_IDENTITY,
      dispatchId: DISPATCH_ID,
      home,
      readSurface: () => Promise.resolve({ unreachable: "no cmux in a unit test" }),
      surfaceId: "unreachable-surface",
      workspaceId: "unreachable-workspace",
    });

    expect(read.truth).toEqual({ answerPath: "/tmp/answer.json", dispatchId: DISPATCH_ID, kind: "ready" });
  });

  it("ignores a marker left over from a PRIOR generation, falling through to the (unreachable) screen scrape", async () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-turn-dispatch-marker-stale-"));
    fixtureDirs.push(home);
    seedCurrentGeneration({ home });
    writeTurnMarker({
      askIdentity: ASK_IDENTITY,
      home,
      marker: {
        answerPath: "/tmp/answer.json",
        dispatchId: DISPATCH_ID,
        kind: "ready",
        leaseExpiresAt: "2020-01-01T00:00:00.000Z",
      },
    });

    const read = await liveScreenRead({
      askIdentity: ASK_IDENTITY,
      // An unreadable surface now asks cmux whether the workspace holds a session at all. Injected as an
      // unanswerable oracle here, which is what a unit test genuinely has: `unknown` must leave the screen's
      // own verdict alone rather than manufacture a phantom out of a check that could not run.
      checkLiveness: ({ workspaceId }) =>
        Promise.resolve({ kind: "unknown", reason: "no cmux in a unit test", workspaceId }),
      dispatchId: DISPATCH_ID,
      home,
      readSurface: () => Promise.resolve({ unreachable: "no cmux in a unit test" }),
      surfaceId: "unreachable-surface",
      workspaceId: "unreachable-workspace",
    });

    expect(read.truth.kind).toBe("unreachable");
  });
});

/**
 * The PURE decision half of the sweep's live-checklist-detail push — no real screen, no real brief file, no
 * real Slack transport anywhere near it. `readScreen`/`makeSlackWriteTransport` stay hardwired in the
 * effectful shell around this, per this file's own doctrine at the top.
 */
describe("turn dispatch — sweepDispatchedAsks surfaces an expired lease, never relaunching", () => {
  const ASK_IDENTITY = { channel: "C1", messageTs: "1785000000.000100", threadTs: "1785000000.000100" };

  /** Seed a captured ask with an ALREADY-EXPIRED dispatched(fresh-visible-session) event + current record. */
  function seedExpiredFreshDispatch({ home }: { home: string }): void {
    ensureCapturedAskLifecycle({ askIdentity: ASK_IDENTITY, home, surface: "channel", userId: "U0OWNER" });
    appendAskLifecycleEvent({
      event: {
        ...ASK_IDENTITY,
        decision: RESPOND_SUBAGENT,
        kind: "dispatched",
        leaseExpiresAt: "2020-01-01T00:00:00.000Z",
        tier: "fresh-visible-session",
        tsIso: "2019-12-31T00:00:00.000Z",
      },
      home,
    });
    writeDispatchRecord({
      home,
      record: {
        ...ASK_IDENTITY,
        askPermalink: "https://example.slack.com/archives/C1/p1785000000000100",
        briefPath: "/tmp/brief.json",
        decision: RESPOND_SUBAGENT,
        dispatchId: dispatchIdOf({ askIdentity: ASK_IDENTITY }),
        execution: { mode: "single-turn", supervisorHost: "claude-code" },
        leaseExpiresAt: "2020-01-01T00:00:00.000Z",
        schemaVersion: 3,
        session: {
          host: "claude-code",
          surfaceId: "id-surface:1",
          surfaceRef: "surface:1",
          workspaceId: "id-workspace:1",
          workspaceRef: "workspace:1",
        },
      },
    });
  }

  it("reports lease-expired exactly once, calling the screen reader exactly once, never relaunching anything", async () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-turn-dispatch-sweep-expired-"));
    fixtureDirs.push(home);
    seedExpiredFreshDispatch({ home });
    const lines: string[] = [];
    let screenReaderCalls = 0;
    const deps: DispatchSweepDeps = {
      latestSubmittedMessage: () => Promise.resolve(undefined),
      reviewer: quietReviewerSweepDeps(),
      workerLiveness: ({ workspaceId }) =>
        Promise.resolve({ kind: "unknown", reason: "no cmux in a unit test", workspaceId }),
      freshScreenRead: async () => {
        screenReaderCalls += 1;
        // No current generation found — the SAME outcome the real wiring reports for an unreachable or
        // already-superseded workspace, and it is enough on its own to resolve the already-expired lease
        // below (`sweepDecision` only needs a live "ready" to override it), without needing a full
        // `FreshDispatchRecord` fixture just to satisfy this test's own fake.
        return undefined;
      },
      // No reaction assertion in this case: the sweep is being driven for a different finding, and an
      // `undefined` here is exactly what a home with no Slack bot token supplies.
      reaction: undefined,
      processSnapshot: () => ({ kind: "rows", rows: [] }) as const,
      nowIso: () => "2026-08-14T00:00:00.000Z",
      writeLine: ({ line }) => {
        lines.push(line);
      },
    };

    const code = await sweepDispatchedAsks({ deps, home });

    expect(code).toBe(EXIT_OK);
    expect(screenReaderCalls).toBe(1);
    expect(lines).toContain(
      `lease-expired (re-judgement candidate): ${ASK_IDENTITY.channel}/${ASK_IDENTITY.messageTs}`,
    );
    expect(lines).toContain(
      "sweep: 0 ready, 0 still working, 0 in-review, 0 worker-failed, 0 phantom, 1 lease-expired, " +
        "0 never-dispatched, 0 checklist-update-failed, 0 ignored",
    );
    const { events } = parseAskLifecycleLog({ text: readAskLifecycleText({ home }) });
    expect(events.at(-1)?.kind).toBe("lease-expired");
  });

  it("re-judging the SAME ask as inline, after the lease-expired sweep, dispatches normally for the exact same identity", async () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-turn-dispatch-sweep-expired-rejudge-"));
    fixtureDirs.push(home);
    seedExpiredFreshDispatch({ home });
    await sweepDispatchedAsks({
      deps: {
        latestSubmittedMessage: () => Promise.resolve(undefined),
        reviewer: quietReviewerSweepDeps(),
        workerLiveness: ({ workspaceId }) =>
          Promise.resolve({ kind: "unknown", reason: "no cmux in a unit test", workspaceId }),
        freshScreenRead: () => Promise.resolve(undefined),
        // No reaction assertion in this case: the sweep is being driven for a different finding, and an
        // `undefined` here is exactly what a home with no Slack bot token supplies.
        reaction: undefined,
        processSnapshot: () => ({ kind: "rows", rows: [] }) as const,
        nowIso: () => "2026-08-14T00:00:00.000Z",
        writeLine: () => {},
      },
      home,
    });

    // The real initial dispatch path, run again for the exact same ask — a fresh brief the visible
    // supervisor built for its second judgement, never a subagent report or a relaunch.
    writeFileSync(stateHomePaths({ home }).respondersJson, JSON.stringify(["U0OWNER"]), "utf8");
    const briefPath = join(home, "rejudge-brief.json");
    const decisionPath = join(home, "rejudge-decision.json");
    writeFileSync(
      briefPath,
      JSON.stringify(
        buildTurnRoutingBrief({
          ...ASK_IDENTITY,
          question: "what are my open PRs?",
          routingInput: ROUTING_INPUT,
          started: CAPTURE_CARD,
          surface: "channel",
          unavailableCapabilities: [],
          userId: "U0OWNER",
        }),
      ),
      "utf8",
    );
    writeFileSync(decisionPath, JSON.stringify(RESPOND_INLINE), "utf8");

    const code = await runTurnDispatch([
      "node",
      "slopweaver",
      "turn",
      "dispatch",
      "--brief",
      briefPath,
      "--decision",
      decisionPath,
      "--home",
      home,
    ]);

    expect(code).toBe(EXIT_OK);
    const logged = lastLifecycleEvent<{ kind: string; tier: string; channel: string; messageTs: string }>({ home })!;
    expect(logged.kind).toBe("dispatched");
    expect(logged.tier).toBe("inline");
    expect(logged.channel).toBe(ASK_IDENTITY.channel);
    expect(logged.messageTs).toBe(ASK_IDENTITY.messageTs);
  });

  it("a real `turn dispatch --sweep` over an expired orphan record (no current dispatch file) reaches EXIT_OK, exercising the real argv/manifest wiring", async () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-turn-dispatch-sweep-orphan-"));
    fixtureDirs.push(home);
    ensureCapturedAskLifecycle({ askIdentity: ASK_IDENTITY, home, surface: "channel", userId: "U0OWNER" });
    appendAskLifecycleEvent({
      event: {
        ...ASK_IDENTITY,
        decision: RESPOND_SUBAGENT,
        kind: "dispatched",
        leaseExpiresAt: "2020-01-01T00:00:00.000Z",
        tier: "fresh-visible-session",
        tsIso: "2019-12-31T00:00:00.000Z",
      },
      home,
    });
    // Deliberately NO writeDispatchRecord — an orphan record. The real wiring's `freshVisibleSessionScreenRead`
    // finds no current generation and never calls `readScreen` at all, so this reaches EXIT_OK without cmux.

    expect(await runTurnDispatch(["node", "slopweaver", "turn", "dispatch", "--sweep", "--home", home])).toBe(EXIT_OK);
    const { events } = parseAskLifecycleLog({ text: readAskLifecycleText({ home }) });
    expect(events.at(-1)?.kind).toBe("lease-expired");
  });
});
