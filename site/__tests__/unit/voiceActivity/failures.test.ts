import { describe, expect, it } from "vitest";

import { ERROR_SHOWN_MS, foldActivity, HEARING_HOLD_MS, voiceStatusOf } from "../../../lib/voiceActivity";
import { backend, delegated, play, quietAt } from "./harness";

describe("foldActivity failures", () => {
  it("closes a failed turn and says why plainly, the provider's own words carried beside it for the fold", () => {
    const failed = play({
      script: [
        [0, delegated({ id: "d1" })],
        [
          900,
          backend({
            delegationId: "d1",
            extra: { response: { error: { message: "rate limit reached" } } },
            type: "response.failed",
          }),
        ],
      ],
    });
    expect(failed.delegations.size).toBe(0);
    expect(quietAt({ activity: failed, nowMs: 1_000 })).toEqual({
      detail: "It failed with a technical error.",
      headline: "error",
      nudge: undefined,
      phase: "error",
      seconds: undefined,
      why: "rate limit reached",
    });
  });

  it("closes a turn whose stream reports an error event, in the provider's words", () => {
    const activity = play({
      script: [
        [0, delegated({ id: "d1", responseId: "r1" })],
        [100, backend({ delegationId: "d1", extra: { response: { id: "r1" } }, type: "response.created" })],
        [
          200,
          backend({
            delegationId: "d1",
            extra: { code: null, message: "backend stream failed", param: null, sequence_number: 2 },
            type: "error",
          }),
        ],
      ],
    });
    expect(activity.delegations.size).toBe(0);
    expect(activity.error).toEqual({ atMs: 200, message: "backend stream failed" });
  });

  it("says why for a failure it cannot tie to either of two open turns, and closes neither", () => {
    const activity = play({
      script: [
        [0, delegated({ id: "d1", responseId: "r1" })],
        [100, delegated({ id: "d2", responseId: "r2" })],
        [200, backend({ extra: { code: "server_error", message: "r1 exploded", param: null }, type: "error" })],
      ],
    });
    expect([...activity.delegations.keys()]).toEqual(["d1", "d2"]);
    expect(activity.error).toEqual({ atMs: 200, message: "r1 exploded" });
  });

  it("names an incomplete answer's reason", () => {
    const cut = play({
      script: [
        [0, delegated({ id: "d1" })],
        [
          10,
          backend({
            delegationId: "d1",
            extra: { response: { incomplete_details: { reason: "max_output_tokens" } } },
            type: "response.incomplete",
          }),
        ],
      ],
    });
    expect(cut.error).toEqual({ atMs: 10, message: "the answer was cut short: max_output_tokens" });
  });

  it("closes a turn whose snapshot says cancelled", () => {
    const cancelled = play({
      script: [
        [0, delegated({ id: "d1" })],
        [10, backend({ delegationId: "d1", extra: { response: { status: "cancelled" } }, type: "response.completed" })],
      ],
    });
    expect(cancelled.delegations.size).toBe(0);
    expect(cancelled.error).toEqual({ atMs: 10, message: "the answer was cancelled" });
  });

  it("shows a failure's reason under the owner's talking, and keeps it through words that follow at once", () => {
    const failed = play({
      script: [
        [0, delegated({ id: "d1", responseId: "r1" })],
        [
          1_000,
          backend({
            delegationId: "d1",
            extra: { response: { error: { message: "rate limit reached" }, id: "r1", status: "failed" } },
            type: "response.failed",
          }),
        ],
      ],
    });
    const talking = voiceStatusOf({
      activity: failed,
      link: "live",
      micLevel: 0.3,
      micRms: 0.042,
      muted: false,
      nowMs: 1_100,
      outputLevel: 0,
    });
    expect(talking.headline).toBe("hearing you");
    expect([talking.detail, talking.why]).toEqual(["It failed with a technical error.", "rate limit reached"]);
    const heard = foldActivity({ activity: failed, input: { kind: "heard" }, nowMs: 1_500 });
    expect(heard.error).toEqual({ atMs: 1_000, message: "rate limit reached" });
    const after = quietAt({ activity: heard, nowMs: 1_500 + HEARING_HOLD_MS + 100 });
    expect([after.detail, after.why]).toEqual(["It failed with a technical error.", "rate limit reached"]);
  });

  it("never leads the orb's detail with a session error's stack, which rides beside it for the fold", () => {
    const raw = "Error: setup failed\n    at connect (/srv/app/talk.ts:12:5)";
    const errored = play({ script: [[0, { kind: "error", message: raw }]] });
    const shown = quietAt({ activity: errored, nowMs: 1_000 });
    expect([shown.phase, shown.detail, shown.why]).toEqual(["error", "It failed with a technical error.", raw]);
  });

  it("carries no raw error on a status that has none", () => {
    const quiet = play({ script: [[0, delegated({ id: "d1" })]] });
    expect(quietAt({ activity: quiet, nowMs: 100 }).why).toBe(undefined);
  });

  it("clears a session error once the owner speaks again", () => {
    const errored = play({ script: [[0, { kind: "error", message: "bad event" }]] });
    expect(quietAt({ activity: errored, nowMs: 5_000 }).headline).toBe("error");
    const heard = foldActivity({ activity: errored, input: { kind: "heard" }, nowMs: ERROR_SHOWN_MS });
    expect(heard.error).toBe(undefined);
  });
});
