/*
 * A plan call's claim and answer posts, and the failure answer the page sends when one of them is lost: it is tried
 * again only while the server may still be waiting, stops on the server's word, and never outlives the deadline
 * (the owner's turn is held while a starved console answers 503s). Every seam is a plain fake; nothing is mocked.
 */
import { describe, expect, it } from "vitest";

import { type PlanPost, planPostOf, settleUntil } from "../../components/voice/planCallClient";
import { deliverPlanAnswer } from "../../components/voice/planWiringHeld";

const LOST: PlanPost = { kind: "lost", why: "the route answered HTTP 503" };

/**
 * Run `settleUntil` over a scripted run of posts, each taking `postMs` on a fake clock.
 *
 * @param posts what each successive attempt comes to; the last repeats
 * @param deadlineMs when the fake clock's deadline falls
 * @param postMs how long each post takes on the fake clock
 * @returns what it answered and how many attempts it made
 */
async function settleOver({
  posts,
  deadlineMs,
  postMs = 1_000,
}: {
  posts: readonly PlanPost[];
  deadlineMs: number;
  postMs?: number;
}): Promise<{ readonly why: string | undefined; readonly attempts: number }> {
  const clock = { ms: 0 };
  let attempts = 0;
  const why = await settleUntil({
    attempt: async () => {
      clock.ms += postMs;
      const post = posts[Math.min(attempts, posts.length - 1)];
      attempts += 1;
      return post;
    },
    deadlineMs,
    now: () => clock.ms,
    pause: async ({ ms }) => {
      clock.ms += ms;
    },
  });
  return { attempts, why };
}

describe("planPostOf", () => {
  it("reads 2xx as taken, a 5xx as lost, and any other status as the server's refusal", () => {
    expect([200, 503, 409, 400].map((status) => planPostOf({ status, why: "w" }))).toEqual([
      { kind: "taken" },
      { kind: "lost", why: "w" },
      { kind: "refused", status: 409, why: "w" },
      { kind: "refused", status: 400, why: "w" },
    ]);
  });
});

describe("settleUntil", () => {
  it("tries a lost failure answer again until one is taken", async () => {
    expect(await settleOver({ deadlineMs: 120_000, posts: [LOST, LOST, { kind: "taken" }] })).toEqual({
      attempts: 3,
      why: undefined,
    });
  });

  it("stops on a 409, since no tool call waits on the token any more", async () => {
    const settled = { kind: "refused", status: 409, why: "no tool call is waiting on that token" } as const;
    expect(await settleOver({ deadlineMs: 120_000, posts: [LOST, settled] })).toEqual({ attempts: 2, why: undefined });
  });

  it("stops on any other refusal and says why", async () => {
    const refused = { kind: "refused", status: 400, why: "the body is not { token, contentItems, success }" } as const;
    expect(await settleOver({ deadlineMs: 120_000, posts: [refused] })).toEqual({
      attempts: 1,
      why: "the body is not { token, contentItems, success }",
    });
  });

  it("starts no attempt at or past the deadline, and names the last loss", async () => {
    expect(await settleOver({ deadlineMs: 6_000, posts: [LOST] })).toEqual({
      attempts: 3,
      why: "no failure answer reached the call before its wait ran out: the route answered HTTP 503",
    });
  });

  it("sends nothing when the deadline has already passed", async () => {
    expect(await settleOver({ deadlineMs: 0, posts: [{ kind: "taken" }] })).toEqual({
      attempts: 0,
      why: "no failure answer reached the call before its wait ran out: the call's wait had already passed, so no failure answer was sent",
    });
  });
});

describe("deliverPlanAnswer", () => {
  /**
   * Deliver one answer over fake posts.
   *
   * @param posted what the real answer's post comes to
   * @param unsettled what settling it as failed answers
   * @returns what it answered, and every call it settled as failed
   */
  async function deliver({
    posted,
    unsettled,
    triageVisit = undefined,
    visits = [],
  }: {
    posted: PlanPost;
    unsettled: string | undefined;
    triageVisit?: string | undefined;
    visits?: unknown[];
  }): Promise<{ readonly why: string | undefined; readonly settled: string[] }> {
    const settled: string[] = [];
    const why = await deliverPlanAnswer({
      deadlineMs: 125_000,
      gateLog: { current: [] },
      held: { callId: "c-1", claimant: "page-a" },
      output: "done",
      post: async (input) => {
        visits.push(input.triageVisit);
        return posted;
      },
      readText: false,
      refused: false,
      settle: async ({ callId, claimant, token, deadlineMs }) => {
        settled.push(`${callId}/${token} as ${claimant} by ${String(deadlineMs)}`);
        return unsettled;
      },
      token: "T.1",
      tool: "relay_steer",
      triageVisit,
    });
    return { settled, why };
  }

  it("posts the triage visit a triage_next answer names, and none on any other", async () => {
    const visit = "0b7e6c1a-6d3f-4f0e-9a1b-2c3d4e5f6a7b";
    const visits: unknown[] = [];
    await deliver({ posted: { kind: "taken" }, triageVisit: visit, unsettled: undefined, visits });
    await deliver({ posted: { kind: "taken" }, unsettled: undefined, visits });
    expect(visits).toEqual([visit, undefined]);
  });

  it("settles nothing when the answer is taken", async () => {
    expect(await deliver({ posted: { kind: "taken" }, unsettled: undefined })).toEqual({
      settled: [],
      why: undefined,
    });
  });

  it("settles nothing when the server refused the answer, and says why", async () => {
    const posted = { kind: "refused", status: 409, why: "the call has ended" } as const;
    expect(await deliver({ posted, unsettled: undefined })).toEqual({ settled: [], why: "the call has ended" });
  });

  it("settles a call whose answer was lost as failed, by the call's deadline", async () => {
    expect(await deliver({ posted: LOST, unsettled: undefined })).toEqual({
      settled: ["c-1/T.1 as page-a by 125000"],
      why: "the answer was lost: the route answered HTTP 503; the call was told the tool could not run",
    });
  });

  it("says so when the failure answer could not land either", async () => {
    expect(await deliver({ posted: LOST, unsettled: "no failure answer reached the call" })).toEqual({
      settled: ["c-1/T.1 as page-a by 125000"],
      why: "the answer was lost: the route answered HTTP 503, and no failure answer reached the call",
    });
  });
});
