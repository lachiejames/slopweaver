import { describe, expect, it } from "vitest";

import { activityRows, ERROR_SHOWN_MS, foldActivity, HEARING_HOLD_MS, voiceStatusOf } from "../../../lib/voiceActivity";
import { backend, delegated, MEASURED, play, quietAt } from "./harness";

describe("foldActivity over the measured ghost", () => {
  it("counts a continuation begun when the first event naming it is a late copy of an answered call", () => {
    const activity = play({
      script: [
        [0, delegated({ id: "d1", responseId: "r1" })],
        [
          100,
          backend({
            delegationId: "d1",
            extra: { item: { call_id: "c1", id: "fc1", name: "x", type: "function_call" }, response_id: "r1" },
            type: "response.output_item.added",
          }),
        ],
        [200, { callId: "c1", kind: "tool-started", name: "x" }],
        [300, { callId: "c1", kind: "tool-answered" }],
        [310, { kind: "continued" }],
        [
          400,
          backend({
            delegationId: "d1",
            extra: { item: { call_id: "c1", id: "fc1", name: "x", type: "function_call" }, response_id: "r2" },
            type: "response.output_item.done",
          }),
        ],
        [
          500,
          backend({
            delegationId: "d1",
            extra: { response: { id: "r2", output: [], status: "completed" } },
            type: "response.completed",
          }),
        ],
      ],
    });
    expect(activity.continuations).toEqual([]);
    expect(activityRows({ activity, nowMs: 600 })).toEqual([]);
    expect(quietAt({ activity, nowMs: 600 }).phase).toBe("listening");
  });

  it("reads an answered call in a completion's own output as history, not the continuation's ask", () => {
    const activity = play({
      script: [
        [0, delegated({ id: "d1", responseId: "r1" })],
        [
          100,
          backend({
            delegationId: "d1",
            extra: { item: { call_id: "c1", name: "x", type: "function_call" }, response_id: "r1" },
            type: "response.output_item.added",
          }),
        ],
        [200, { callId: "c1", kind: "tool-started", name: "x" }],
        [300, { callId: "c1", kind: "tool-answered" }],
        [310, { kind: "continued" }],
        [400, backend({ delegationId: "d1", extra: { response: { id: "r2" } }, type: "response.created" })],
        [
          600,
          backend({
            delegationId: "d1",
            extra: {
              response: {
                id: "r2",
                output: [{ call_id: "c1", name: "x", type: "function_call" }],
                status: "completed",
              },
            },
            type: "response.completed",
          }),
        ],
      ],
    });
    expect(activity.delegations.size).toBe(0);
    expect(activityRows({ activity, nowMs: 700 })).toEqual([]);
    expect(quietAt({ activity, nowMs: 700 }).phase).toBe("listening");
  });

  it("keeps a delegation open on a completion whose own output still carries the function call", () => {
    const activity = play({
      script: [
        [0, delegated({ id: "d1" })],
        [
          5_000,
          backend({
            delegationId: "d1",
            extra: { response: { id: "r1", output: [{ type: "function_call" }], status: "completed" } },
            type: "response.completed",
          }),
        ],
      ],
    });
    expect([...activity.delegations.keys()]).toEqual(["d1"]);
  });

  it("keeps the turn open when the tool-calling response reports its close after the continued one began", () => {
    const early = MEASURED.filter(
      ([, input]) => input.kind !== "backend" || input.event["type"] !== "response.completed",
    );
    const activity = play({
      script: [
        ...early,
        [
          7_700,
          backend({
            delegationId: "d1",
            extra: { response: { id: "r1", status: "completed" } },
            type: "response.completed",
          }),
        ],
      ],
    });
    expect([...activity.delegations.keys()]).toEqual(["d1"]);
    expect(quietAt({ activity, nowMs: 8_000 }).phase).toBe("working");
  });

  it("says why on a late failure of the tool-calling response, and leaves the turn to the newer one", () => {
    const early = MEASURED.filter(
      ([, input]) => input.kind !== "backend" || input.event["type"] !== "response.completed",
    );
    const activity = play({
      script: [
        ...early,
        [
          7_700,
          backend({
            delegationId: "d1",
            extra: { response: { error: { message: "upstream exploded" }, id: "r1", status: "failed" } },
            type: "response.failed",
          }),
        ],
      ],
    });
    expect([...activity.delegations.keys()]).toEqual(["d1"]);
    expect(activity.error).toEqual({ atMs: 7_700, message: "upstream exploded" });
    expect(quietAt({ activity, nowMs: 7_800 }).phase).toBe("error");
    const heardAt = 7_700 + ERROR_SHOWN_MS;
    const heard = foldActivity({ activity, input: { kind: "heard" }, nowMs: heardAt });
    expect(quietAt({ activity: heard, nowMs: heardAt + HEARING_HOLD_MS + 100 }).phase).toBe("working");
  });

  it("forgets the ask when the continued response is first named by in_progress rather than created", () => {
    const early = MEASURED.filter(
      ([, input]) => input.kind !== "backend" || input.event["type"] !== "response.created",
    );
    const done = play({
      script: [
        ...early,
        [7_600, backend({ delegationId: "d1", extra: { response: { id: "r2" } }, type: "response.in_progress" })],
        [
          30_000,
          backend({ delegationId: "d1", extra: { response: { id: "r2", output: [] } }, type: "response.completed" }),
        ],
      ],
    });
    expect(done.delegations.size).toBe(0);
  });

  it("owns the ask by response, so a continued response first seen through an id-less item still closes the turn", () => {
    const done = play({
      script: [
        [0, delegated({ id: "d1", responseId: "r1" })],
        [
          6_900,
          backend({
            delegationId: "d1",
            extra: { item: { call_id: "c1", name: "action_items", type: "function_call" } },
            type: "response.output_item.done",
          }),
        ],
        [7_000, { callId: "c1", kind: "tool-started", name: "action_items" }],
        [7_400, { callId: "c1", kind: "tool-answered" }],
        [7_400, { kind: "continued" }],
        [
          7_600,
          backend({ delegationId: "d1", extra: { item: { type: "message" } }, type: "response.output_item.added" }),
        ],
        [
          7_700,
          backend({
            delegationId: "d1",
            extra: { response: { id: "r1", status: "completed" } },
            type: "response.completed",
          }),
        ],
        [
          30_000,
          backend({ delegationId: "d1", extra: { response: { id: "r2", output: [] } }, type: "response.completed" }),
        ],
      ],
    });
    expect(done.delegations.size).toBe(0);
  });

  it("forgets the ask once the continued response begins, so that response completing ends the turn", () => {
    const done = play({
      script: [
        ...MEASURED,
        [
          30_000,
          backend({
            delegationId: "d1",
            extra: { response: { id: "r2", status: "completed" } },
            type: "response.completed",
          }),
        ],
      ],
    });
    expect(done.delegations.size).toBe(0);
  });

  it("closes the delegation when its answer completes, and the orb goes back to listening", () => {
    const done = play({
      script: [
        ...MEASURED,
        [30_000, backend({ delegationId: "d1", type: "response.output_text.delta" })],
        [
          31_000,
          backend({ delegationId: "d1", extra: { response: { id: "r2", output: [] } }, type: "response.completed" }),
        ],
      ],
    });
    expect(done.delegations.size).toBe(0);
    expect(quietAt({ activity: done, nowMs: 32_000 })).toEqual({
      detail: undefined,
      headline: "listening",
      phase: "listening",
      seconds: undefined,
    });
  });

  it("shows the running tool under the voice while it talks over it", () => {
    const activity = play({ script: MEASURED.slice(0, 7) });
    const status = voiceStatusOf({
      activity,
      link: "live",
      micLevel: 0,
      micRms: 0,
      muted: false,
      nowMs: 7_050,
      outputLevel: 0.3,
    });
    expect(status).toEqual({
      detail: "running action_items · 0s",
      headline: "speaking",
      phase: "speaking",
      seconds: undefined,
    });
  });
});
