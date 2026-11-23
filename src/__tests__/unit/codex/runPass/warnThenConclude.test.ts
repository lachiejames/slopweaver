/*
 * `runBoundedPass` once the warn aborts the first turn: the resumed conclusion and both attempts recorded, the
 * aborted attempt left not measured, the conclusion given only what remains of the bound, no resume without a
 * thread id or after the deadline, no warn on a bound too short, and a conclusion landing past the deadline
 * refused while one just inside it is accepted.
 */

import { describe, expect, it } from "vitest";
import { unwrap } from "#lib/result.js";
import { makePassBound } from "../../../../codex/bounds.js";
import { runBoundedPass } from "../../../../codex/runPass.js";
import { acceptAll, answeredTurn, BOUND, clientOf, FakeRuntime, FakeThread, USAGE } from "./harness.js";

describe("runBoundedPass — warn then conclude", () => {
  it("resumes after an abort and returns the conclusion, recording BOTH attempts", async () => {
    const runtime = new FakeRuntime();
    const start = new FakeThread({
      behaviour: { fireAtMs: 204_000, kind: "abort-on-signal", runtime },
      id: "t1",
    });
    const resume = new FakeThread({
      behaviour: { kind: "answer", turn: answeredTurn({ response: "{}" }) },
      id: "t1",
    });
    const result = await runBoundedPass({
      bound: BOUND,
      client: clientOf({ resume, start }),
      outputSchema: {},
      prompt: "p",
      repoRoot: "/repo",
      runtime,
      validate: acceptAll,
      workingDirectory: "/repo",
    });
    expect(result.outcome.kind).toBe("answered");
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0]!.kind).toBe("initial");
    expect(result.attempts[0]!.status).toBe("aborted");
    expect(result.attempts[1]!.kind).toBe("conclusion");
    expect(result.attempts[1]!.status).toBe("answered");
  });

  it("records the ABORTED attempt's usage AND items as not-measured — no Turn ever existed", async () => {
    const runtime = new FakeRuntime();
    const start = new FakeThread({ behaviour: { fireAtMs: 204_000, kind: "abort-on-signal", runtime }, id: "t1" });
    const resume = new FakeThread({ behaviour: { kind: "answer", turn: answeredTurn({ response: "{}" }) }, id: "t1" });
    const result = await runBoundedPass({
      bound: BOUND,
      client: clientOf({ resume, start }),
      outputSchema: {},
      prompt: "p",
      repoRoot: "/repo",
      runtime,
      validate: acceptAll,
      workingDirectory: "/repo",
    });
    expect(result.attempts[0]!.usage).toEqual({ kind: "not-measured", reason: "aborted" });
    expect(result.attempts[0]!.items).toEqual({ kind: "not-measured", reason: "aborted" });
    // The conclusion's usage stays its OWN — it must never stand in for the abandoned turn's.
    expect(result.attempts[1]!.usage).toEqual({ kind: "measured", usage: USAGE });
  });

  it("gives the conclusion only what REMAINS of the original bound, never a fresh one", async () => {
    const runtime = new FakeRuntime();
    const start = new FakeThread({ behaviour: { fireAtMs: 204_000, kind: "abort-on-signal", runtime }, id: "t1" });
    const resume = new FakeThread({ behaviour: { kind: "answer", turn: answeredTurn({ response: "{}" }) }, id: "t1" });
    await runBoundedPass({
      bound: BOUND,
      client: clientOf({ resume, start }),
      outputSchema: {},
      prompt: "p",
      repoRoot: "/repo",
      runtime,
      validate: acceptAll,
      workingDirectory: "/repo",
    });
    // 240_000 total - 204_000 elapsed = 36_000 remaining, and the wrap-up prompt says so in seconds.
    expect(resume.seen[0]!.input).toContain("36 seconds left");
  });

  it("is unrecoverable when the abort landed before the thread id existed", async () => {
    const runtime = new FakeRuntime();
    const start = new FakeThread({ behaviour: { fireAtMs: 204_000, kind: "abort-on-signal", runtime }, id: null });
    const result = await runBoundedPass({
      bound: BOUND,
      client: clientOf({ start }),
      outputSchema: {},
      prompt: "p",
      repoRoot: "/repo",
      runtime,
      validate: acceptAll,
      workingDirectory: "/repo",
    });
    expect(result.outcome.kind).toBe("no-verdict");
    expect(result.outcome.kind === "no-verdict" ? result.outcome.reason : "").toBe("unrecoverable-abort");
    // Only ONE attempt: no resume was tried, because an aborted thread's id does not appear later.
    expect(result.attempts).toHaveLength(1);
  });

  it("does not resume at all when the DEADLINE, not the warn, is what aborted the turn", async () => {
    const runtime = new FakeRuntime();
    const start = new FakeThread({ behaviour: { fireAtMs: 240_000, kind: "abort-on-signal", runtime }, id: "t1" });
    const result = await runBoundedPass({
      bound: BOUND,
      client: clientOf({ start }),
      outputSchema: {},
      prompt: "p",
      repoRoot: "/repo",
      runtime,
      validate: acceptAll,
      workingDirectory: "/repo",
    });
    expect(result.outcome.kind).toBe("no-verdict");
    expect(result.outcome.kind === "no-verdict" ? result.outcome.reason : "").toBe("no-conclusion-in-bound");
    expect(result.attempts).toHaveLength(1);
  });

  it("skips the warn entirely for a bound too short to conclude in", async () => {
    const runtime = new FakeRuntime();
    const tiny = unwrap(makePassBound({ boundSeconds: 10 }));
    const start = new FakeThread({ behaviour: { kind: "answer", turn: answeredTurn({ response: "{}" }) }, id: "t1" });
    await runBoundedPass({
      bound: tiny,
      client: clientOf({ start }),
      outputSchema: {},
      prompt: "p",
      repoRoot: "/repo",
      runtime,
      validate: acceptAll,
      workingDirectory: "/repo",
    });
    // Only the deadline timer was ever armed, and it was cancelled on the answer.
    expect(runtime.armedCount()).toBe(0);
  });
});

describe("runBoundedPass — a late answer is not an answer", () => {
  it("REFUSES a conclusion that resolves after the absolute deadline, so the bound is never exceeded", async () => {
    const runtime = new FakeRuntime();
    const start = new FakeThread({ behaviour: { fireAtMs: 204_000, kind: "abort-on-signal", runtime }, id: "t1" });
    // The wrap-up turn resolves successfully at 241s — 1s past the 240s bound.
    const resume = new FakeThread({
      behaviour: { atMs: 241_000, kind: "answer-at", runtime, turn: answeredTurn({ response: "{}" }) },
      id: "t1",
    });
    const result = await runBoundedPass({
      bound: BOUND,
      client: clientOf({ resume, start }),
      outputSchema: {},
      prompt: "p",
      repoRoot: "/repo",
      runtime,
      validate: acceptAll,
      workingDirectory: "/repo",
    });
    expect(result.outcome.kind).toBe("no-verdict");
    expect(result.outcome.kind === "no-verdict" ? result.outcome.reason : "").toBe("no-conclusion-in-bound");
    // The attempt STAYS in the record — that work really happened and its usage is real.
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[1]!.usage.kind).toBe("measured");
  });

  it("ACCEPTS a conclusion that resolves just inside the deadline", async () => {
    const runtime = new FakeRuntime();
    const start = new FakeThread({ behaviour: { fireAtMs: 204_000, kind: "abort-on-signal", runtime }, id: "t1" });
    const resume = new FakeThread({
      behaviour: { atMs: 239_000, kind: "answer-at", runtime, turn: answeredTurn({ response: "{}" }) },
      id: "t1",
    });
    const result = await runBoundedPass({
      bound: BOUND,
      client: clientOf({ resume, start }),
      outputSchema: {},
      prompt: "p",
      repoRoot: "/repo",
      runtime,
      validate: acceptAll,
      workingDirectory: "/repo",
    });
    expect(result.outcome.kind).toBe("answered");
  });
});
