/*
 * The page's steer-risk watch and the reads it rests on: what one route answer means, what one verb answer holds, and
 * how the asks are paced. A steered deliverable at risk gets a floating note AND a voice
 * cut-in the minute it is known.
 */
import { describe, expect, it } from "vitest";

import { type SteerRiskNotice, steerRiskAnswerOf, steerRiskNoticeOf } from "../../lib/steerRiskNotice";
import {
  STEER_RISK_POLL_MS,
  STEER_RISK_RETRY_MS,
  type SteerRiskPost,
  steerRiskPostOf,
  watchSteerRisk,
} from "../../lib/steerRiskWatch";

const NOTICE: SteerRiskNotice = {
  stepId: "mon-steer-sup-4293-1a2b3c",
  what: "Your steered sup-4293 is at risk",
  why: "its seat closed until 2026-10-22T04:50:00Z, so nobody is working it",
};

describe("steerRiskNoticeOf", () => {
  it("takes the three fields trimmed, and refuses one missing, blank or over its bound", () => {
    expect([
      steerRiskNoticeOf({ value: { ...NOTICE, what: `  ${NOTICE.what} ` } }),
      steerRiskNoticeOf({ value: { stepId: NOTICE.stepId, what: NOTICE.what } }),
      steerRiskNoticeOf({ value: { ...NOTICE, why: "  " } }),
      steerRiskNoticeOf({ value: { ...NOTICE, stepId: "x".repeat(201) } }),
      steerRiskNoticeOf({ value: { ...NOTICE, why: "y".repeat(401) } }),
      steerRiskNoticeOf({ value: [NOTICE] }),
    ]).toEqual([NOTICE, undefined, undefined, undefined, undefined, undefined]);
  });
});

describe("steerRiskAnswerOf", () => {
  it("takes every notice with the unread-line count, an empty list included", () => {
    expect([
      steerRiskAnswerOf({ value: { notices: [NOTICE], unreadLines: 0 } }),
      steerRiskAnswerOf({ value: { notices: [], unreadLines: 0 } }),
      steerRiskAnswerOf({ value: { notices: [], unreadLines: 1 } }),
    ]).toEqual([
      { notices: [NOTICE], unreadLines: 0 },
      { notices: [], unreadLines: 0 },
      { notices: [], unreadLines: 1 },
    ]);
  });

  it("refuses the whole answer when one notice will not read, there are more than twenty, or no unread count", () => {
    expect([
      steerRiskAnswerOf({ value: { notices: [NOTICE, { stepId: "a" }], unreadLines: 0 } }),
      steerRiskAnswerOf({ value: { notices: Array.from({ length: 21 }, () => NOTICE), unreadLines: 0 } }),
      steerRiskAnswerOf({ value: { notices: "none", unreadLines: 0 } }),
      steerRiskAnswerOf({ value: { notices: [] } }),
      steerRiskAnswerOf({ value: { notices: [], unreadLines: -1 } }),
      steerRiskAnswerOf({ value: undefined }),
    ]).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
  });
});

describe("steerRiskPostOf", () => {
  it("reads a said line, an already-said one and none owed off a 2xx", () => {
    expect([
      steerRiskPostOf({ body: { already: false, ok: true, said: NOTICE }, status: 200, why: "" }),
      steerRiskPostOf({ body: { already: true, ok: true, said: NOTICE }, status: 200, why: "" }),
      steerRiskPostOf({ body: { already: false, ok: true, said: null }, status: 200, why: "" }),
    ]).toEqual([
      { already: false, kind: "said", notice: NOTICE },
      { already: true, kind: "said", notice: NOTICE },
      { kind: "none" },
    ]);
  });

  it("retries a taken floor or a lost response, and drops every other refusal with its reason", () => {
    expect([
      steerRiskPostOf({ body: { ok: false, refused: "busy" }, status: 409, why: "busy" }),
      steerRiskPostOf({ body: undefined, status: undefined, why: "did not answer" }),
      steerRiskPostOf({ body: { ok: false, refused: "no voice" }, status: 422, why: "no voice" }),
      steerRiskPostOf({ body: "text", status: 200, why: "" }),
      steerRiskPostOf({ body: { said: { stepId: "a" } }, status: 200, why: "" }),
    ]).toEqual([
      { kind: "retry", why: "busy" },
      { kind: "retry", why: "did not answer" },
      { kind: "dropped", why: "no voice" },
      { kind: "dropped", why: "the steer-risk route answered no JSON" },
      { kind: "dropped", why: "the steer-risk route answered a note this page cannot read" },
    ]);
  });
});

/** A watch driven by hand: each post answers the next scripted reply, each `after` is held until `fire` runs it. */
function harness({ replies, live = () => true }: { replies: readonly SteerRiskPost[]; live?: () => boolean }) {
  const pending: { ms: number; run: () => void; cancelled: boolean }[] = [];
  const notes: { detail: string; refused: boolean }[] = [];
  let posts = 0;
  const stop = watchSteerRisk({
    seams: {
      after: ({ ms, run }) => {
        const timer = { cancelled: false, ms, run };
        pending.push(timer);
        return () => {
          timer.cancelled = true;
        };
      },
      live,
      note: (line) => {
        notes.push({ ...line });
      },
      post: async () => {
        const reply = replies[posts];
        posts += 1;
        return reply;
      },
    },
  });
  /** Drain the microtasks an awaited post resolves through — no clock, so no timer runs on its own. */
  const settle = async (): Promise<void> => {
    for (let tick = 0; tick < 10; tick += 1) {
      await Promise.resolve();
    }
  };
  /** Let the awaited post settle, then run the one timer it scheduled. */
  const fire = async (): Promise<void> => {
    await settle();
    pending.shift()!.run();
  };
  return { fire, notes, pending, posts: () => posts, settle, stop };
}

describe("watchSteerRisk", () => {
  it("asks at once, asks again after the retry gap when a line was said, then waits a poll once it was said already", async () => {
    const watch = harness({
      replies: [
        { already: false, kind: "said", notice: NOTICE },
        { already: true, kind: "said", notice: NOTICE },
        { kind: "none" },
      ],
    });
    await watch.settle();
    const first = watch.pending.map((one) => one.ms);
    await watch.fire();
    await watch.settle();
    const second = watch.pending.map((one) => one.ms);
    expect({ first, notes: watch.notes, posts: watch.posts(), second }).toEqual({
      first: [STEER_RISK_RETRY_MS],
      notes: [
        { detail: `${NOTICE.what}: said`, refused: false },
        { detail: `${NOTICE.what}: said earlier on this server`, refused: false },
      ],
      posts: 2,
      second: [STEER_RISK_POLL_MS],
    });
  });

  it("logs a dropped reason once however many polls repeat it, and a new reason again", async () => {
    const watch = harness({
      replies: [
        { kind: "dropped", why: "the register would not read" },
        { kind: "dropped", why: "the register would not read" },
        { kind: "dropped", why: "no voice" },
      ],
    });
    await watch.fire();
    await watch.fire();
    await watch.settle();
    expect({ notes: watch.notes, posts: watch.posts(), waits: watch.pending.map((one) => one.ms) }).toEqual({
      notes: [
        { detail: "no steer-risk check: the register would not read", refused: true },
        { detail: "no steer-risk check: no voice", refused: true },
      ],
      posts: 3,
      waits: [STEER_RISK_POLL_MS],
    });
  });

  it("retries a taken floor after the short gap, writing nothing", async () => {
    const watch = harness({ replies: [{ kind: "retry", why: "busy" }] });
    await watch.settle();
    expect({ notes: watch.notes, waits: watch.pending.map((one) => one.ms) }).toEqual({
      notes: [],
      waits: [STEER_RISK_RETRY_MS],
    });
  });

  it("schedules nothing and writes nothing once stopped, even over a post already in flight", async () => {
    const watch = harness({ replies: [{ already: false, kind: "said", notice: NOTICE }] });
    watch.stop();
    await watch.settle();
    expect({ notes: watch.notes, posts: watch.posts(), waits: watch.pending.length }).toEqual({
      notes: [],
      posts: 1,
      waits: 0,
    });
  });

  it("never asks once the call it began on is no longer the page's", async () => {
    const watch = harness({ live: () => false, replies: [] });
    await watch.settle();
    expect({ posts: watch.posts(), waits: watch.pending.length }).toEqual({ posts: 0, waits: 0 });
  });
});
