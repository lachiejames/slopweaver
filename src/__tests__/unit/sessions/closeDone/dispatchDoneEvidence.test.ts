/**
 * When a dispatch child of the bot loop is done: a finalised turn ends both roles, a parent's lease or gone
 * worker ends a reviewer, a reviewer mid-verdict holds, and a worker that posted only its plan still owes the
 * build. Pure; every input is inline.
 */
import { describe, expect, it } from "vitest";

import type { AskLifecycleEvent } from "../../../../live/ask/lifecycle.js";
import { dispatchChildrenBySessionKey } from "../../../../sessions/dispatchChildren.js";
import { dispatchDoneEvidence } from "../../../../sessions/dispatchDoneEvidence.js";
import { ASK, captured, dispatched, NO_REVIEW, NOW, REVIEW_KEY, reviewing, WORKER_KEY } from "../dispatchFixtures.js";

describe("dispatchDoneEvidence", () => {
  const childOf = ({ askEvents, role }: { askEvents: readonly AskLifecycleEvent[]; role: "ask" | "review" }) =>
    dispatchChildrenBySessionKey({ askEvents }).get(role === "ask" ? WORKER_KEY : REVIEW_KEY)![0]!;

  it("ends both roles on a posted answer", () => {
    const answered: AskLifecycleEvent = {
      ...ASK,
      answerTs: "1789046999.1",
      kind: "answered",
      tsIso: "2026-09-03T08:00:00.000Z",
    };
    const askEvents = [captured(), answered];
    expect(
      dispatchDoneEvidence({
        child: childOf({ askEvents, role: "review" }),
        nowIso: NOW,
        review: NO_REVIEW,
        workerWorkspace: "live",
      }),
    ).toEqual({ kind: "turn-finalised", role: "review", terminal: "answered" });
    expect(
      dispatchDoneEvidence({
        child: childOf({ askEvents, role: "ask" }),
        nowIso: NOW,
        review: NO_REVIEW,
        workerWorkspace: "live",
      }),
    ).toEqual({ kind: "turn-finalised", role: "ask", terminal: "answered" });
  });

  it("ends both roles on a withheld turn and on a triaged one", () => {
    const withheld: AskLifecycleEvent = {
      ...ASK,
      code: "REVIEW",
      kind: "withheld",
      queueId: "q1",
      reason: "held for review",
      tsIso: "2026-09-03T08:00:00.000Z",
    };
    const triaged: AskLifecycleEvent = {
      ...ASK,
      kind: "triaged-no-response",
      reason: "no reply wanted",
      tsIso: "2026-09-03T08:00:00.000Z",
    };
    expect(
      dispatchDoneEvidence({
        child: childOf({ askEvents: [captured(), withheld], role: "ask" }),
        nowIso: NOW,
        review: NO_REVIEW,
        workerWorkspace: "live",
      }),
    ).toEqual({ kind: "turn-finalised", role: "ask", terminal: "withheld" });
    expect(
      dispatchDoneEvidence({
        child: childOf({ askEvents: [captured(), triaged], role: "review" }),
        nowIso: NOW,
        review: NO_REVIEW,
        workerWorkspace: "live",
      }),
    ).toEqual({ kind: "turn-finalised", role: "review", terminal: "triaged-no-response" });
  });

  it("leaves a WORKER open on an expired lease and on a vanished workspace, which are diagnoses not endings", () => {
    const askEvents = [captured(), dispatched({ leaseExpiresAt: "2026-09-03T08:00:00.000Z" })];
    expect(
      dispatchDoneEvidence({
        child: childOf({ askEvents, role: "ask" }),
        nowIso: NOW,
        review: NO_REVIEW,
        workerWorkspace: "gone",
      }),
    ).toBeUndefined();
  });

  it("ends a REVIEW child the moment its parent's lease is reached", () => {
    const askEvents = [captured(), dispatched({ leaseExpiresAt: NOW })];
    expect(
      dispatchDoneEvidence({
        child: childOf({ askEvents, role: "review" }),
        nowIso: NOW,
        review: NO_REVIEW,
        workerWorkspace: "live",
      }),
    ).toEqual({ kind: "parent-lease-expired" });
  });

  it("keeps a REVIEW child while its parent's lease still has time left", () => {
    const askEvents = [captured(), dispatched({ leaseExpiresAt: "2026-09-03T10:00:00.001Z" })];
    expect(
      dispatchDoneEvidence({
        child: childOf({ askEvents, role: "review" }),
        nowIso: NOW,
        review: NO_REVIEW,
        workerWorkspace: "live",
      }),
    ).toBeUndefined();
  });

  it("ends a REVIEW child on a RECORDED lease expiry, which clears activeDispatch entirely", () => {
    const expired: AskLifecycleEvent = { ...ASK, kind: "lease-expired", tsIso: "2026-09-03T09:00:00.000Z" };
    const askEvents = [captured(), dispatched({ leaseExpiresAt: "2026-09-03T10:00:00.001Z" }), expired];
    const child = childOf({ askEvents, role: "review" });
    expect(child.lifecycle.activeDispatch).toBeUndefined();
    expect(dispatchDoneEvidence({ child, nowIso: NOW, review: NO_REVIEW, workerWorkspace: "live" })).toEqual({
      kind: "parent-lease-expired",
    });
  });

  it("ends a REVIEW child whose parent worker's workspace is gone, and keeps one that is merely unknown", () => {
    const askEvents = [captured(), dispatched({ leaseExpiresAt: "2026-09-03T10:00:00.001Z" })];
    const child = childOf({ askEvents, role: "review" });
    expect(dispatchDoneEvidence({ child, nowIso: NOW, review: NO_REVIEW, workerWorkspace: "gone" })).toEqual({
      kind: "parent-worker-gone",
    });
    expect(dispatchDoneEvidence({ child, nowIso: NOW, review: NO_REVIEW, workerWorkspace: "unknown" })).toBeUndefined();
  });

  // The measured turn this guard exists for: on `C0SYN000006/1789347793.808099` the parent's lease lapsed,
  // round 2 opened half an hour later with no verdict written, and a close-done run from an unrelated
  // seat reaped it soon after. The RECORDED state was half an hour older than the reviewer it judged.
  it("keeps a REVIEW child mid-verdict even though its parent's RECORDED lease expiry says the turn is over", () => {
    const expired: AskLifecycleEvent = { ...ASK, kind: "lease-expired", tsIso: "2026-09-03T09:00:00.000Z" };
    const askEvents = [captured(), dispatched({ leaseExpiresAt: "2026-09-03T09:00:00.000Z" }), expired];
    const child = childOf({ askEvents, role: "review" });
    expect(child.lifecycle.state).toBe("lease-expired");
    expect(
      dispatchDoneEvidence({
        child,
        nowIso: NOW,
        review: reviewing({ spawnedAt: "2026-09-03T09:40:00.000Z" }),
        workerWorkspace: "live",
      }),
    ).toBeUndefined();
  });

  it("keeps a REVIEW child mid-verdict past a parent lease the WALL CLOCK has run out", () => {
    const askEvents = [captured(), dispatched({ leaseExpiresAt: "2026-09-03T09:00:00.000Z" })];
    const child = childOf({ askEvents, role: "review" });
    expect(child.lifecycle.activeDispatch!.leaseExpiresAt).toBe("2026-09-03T09:00:00.000Z");
    expect(
      dispatchDoneEvidence({
        child,
        nowIso: NOW,
        review: reviewing({ spawnedAt: "2026-09-03T09:40:00.000Z" }),
        workerWorkspace: "live",
      }),
    ).toBeUndefined();
  });

  it("stops holding a REVIEW child once its reviewer has outrun MAX_REVIEW_HOLD_HOURS", () => {
    const askEvents = [captured(), dispatched({ leaseExpiresAt: "2026-09-03T09:00:00.000Z" })];
    expect(
      dispatchDoneEvidence({
        child: childOf({ askEvents, role: "review" }),
        nowIso: NOW,
        // Spawned three hours before NOW — past the two-hour cap, so the hold lapses and the lease decides.
        review: reviewing({ spawnedAt: "2026-09-03T07:00:00.000Z" }),
        workerWorkspace: "live",
      }),
    ).toEqual({ kind: "parent-lease-expired" });
  });

  it("holds nothing back from a TERMINAL ask, whose reviewer reviewRelease.ts reaps ungated on liveness", () => {
    const answered: AskLifecycleEvent = {
      ...ASK,
      answerTs: "1789046999.1",
      kind: "answered",
      tsIso: "2026-09-03T09:00:00.000Z",
    };
    expect(
      dispatchDoneEvidence({
        child: childOf({ askEvents: [captured(), answered], role: "review" }),
        nowIso: NOW,
        review: reviewing({ spawnedAt: "2026-09-03T09:40:00.000Z" }),
        workerWorkspace: "live",
      }),
    ).toEqual({ kind: "turn-finalised", role: "review", terminal: "answered" });
  });

  it("still reaps a REVIEW child whose parent WORKER is gone, since no verdict of its can be consumed", () => {
    const askEvents = [captured(), dispatched({ leaseExpiresAt: "2026-09-03T10:00:00.001Z" })];
    expect(
      dispatchDoneEvidence({
        child: childOf({ askEvents, role: "review" }),
        nowIso: NOW,
        review: reviewing({ spawnedAt: "2026-09-03T09:40:00.000Z" }),
        workerWorkspace: "gone",
      }),
    ).toEqual({ kind: "parent-worker-gone" });
  });
});

/*
 * A worker that posts its plan and keeps building — the self-reap, shifted onto this file's clock:
 * dispatched at 07:01 and leased to 09:00, its plan posted at 08:00 re-arms the lease to 10:00:00.001.
 */
describe("dispatchDoneEvidence after a FIRST answer", () => {
  const childOf = ({ askEvents, role }: { askEvents: readonly AskLifecycleEvent[]; role: "ask" | "review" }) =>
    dispatchChildrenBySessionKey({ askEvents }).get(role === "ask" ? WORKER_KEY : REVIEW_KEY)![0]!;
  const firstAnswered: AskLifecycleEvent = {
    ...ASK,
    answerDigest: "digest-of-the-plan",
    answerTs: "1789046999.1",
    kind: "first-answered",
    leaseExpiresAt: "2026-09-03T10:00:00.001Z",
    owes: "pull-requests",
    tsIso: "2026-09-03T08:00:00.000Z",
    what: "open the two pull requests the plan names",
  };
  const answered: AskLifecycleEvent = {
    ...ASK,
    answerTs: "1789046999.1",
    kind: "answered",
    tsIso: "2026-09-03T08:00:00.000Z",
  };
  const gen1 = dispatched({ leaseExpiresAt: "2026-09-03T09:00:00.000Z" });

  it("leaves the WORKER that posted the plan open, because it still owes the build", () => {
    expect(
      dispatchDoneEvidence({
        child: childOf({ askEvents: [captured(), gen1, firstAnswered], role: "ask" }),
        nowIso: NOW,
        review: NO_REVIEW,
        workerWorkspace: "live",
      }),
    ).toBeUndefined();
  });

  it("is the pair: the same post written as `answered` reaps the worker — the self-reap", () => {
    expect(
      dispatchDoneEvidence({
        child: childOf({ askEvents: [captured(), gen1, answered], role: "ask" }),
        nowIso: NOW,
        review: NO_REVIEW,
        workerWorkspace: "live",
      }),
    ).toEqual({ kind: "turn-finalised", role: "ask", terminal: "answered" });
  });

  it("keeps a REVIEW child under the re-armed lease, though the dispatch's own lease ran out at 09:00Z", () => {
    expect(
      dispatchDoneEvidence({
        child: childOf({ askEvents: [captured(), gen1, firstAnswered], role: "review" }),
        nowIso: NOW,
        review: NO_REVIEW,
        workerWorkspace: "live",
      }),
    ).toBeUndefined();
  });

  it("is the pair: with no plan posted, the same instant ends the REVIEW child on the parent's lease", () => {
    expect(
      dispatchDoneEvidence({
        child: childOf({ askEvents: [captured(), gen1], role: "review" }),
        nowIso: NOW,
        review: NO_REVIEW,
        workerWorkspace: "live",
      }),
    ).toEqual({ kind: "parent-lease-expired" });
  });
});
