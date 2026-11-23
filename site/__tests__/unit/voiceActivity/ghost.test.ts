import { describe, expect, it } from "vitest";

import { activityRows } from "../../../lib/voiceActivity";
import { backend, delegated, MEASURED, play, quietAt } from "./harness";

describe("foldActivity over the measured ghost", () => {
  it("names the continued turn as reasoning, not listening, twenty seconds after the tool answered", () => {
    const activity = play({ script: MEASURED });
    expect(quietAt({ activity, nowMs: 27_500 })).toEqual({
      detail: "reasoning · 27s",
      headline: "reasoning",
      phase: "working",
      seconds: 27,
    });
  });

  it("keeps a delegation open when its response completes by calling a tool", () => {
    const activity = play({ script: MEASURED.slice(0, 8) });
    expect([...activity.delegations.keys()]).toEqual(["d1"]);
    expect(activity.delegations.get("d1")!.step).toEqual({ kind: "tool", name: "action_items" });
  });

  it("opens a delegation it first hears of through a completion that calls a tool", () => {
    const activity = play({
      script: [
        [
          5_000,
          backend({
            delegationId: "d1",
            extra: {
              response: { id: "r1", output: [{ name: "action_items", type: "function_call" }], status: "completed" },
            },
            type: "response.completed",
          }),
        ],
      ],
    });
    expect([...activity.delegations.keys()]).toEqual(["d1"]);
    expect(quietAt({ activity, nowMs: 6_000 }).phase).toBe("working");
  });

  it("binds a held ask to the response an unknown event names, without counting that event as progress", () => {
    const activity = play({
      script: [
        [0, delegated({ id: "d1" })],
        [
          1_000,
          backend({
            delegationId: "d1",
            extra: { item: { name: "action_items", type: "function_call" } },
            type: "response.output_item.done",
          }),
        ],
        [2_000, backend({ delegationId: "d1", extra: { response_id: "r1" }, type: "response.some_future_event" })],
        [3_000, backend({ delegationId: "d1", extra: { response: { id: "r2" } }, type: "response.created" })],
        [
          4_000,
          backend({ delegationId: "d1", extra: { response: { id: "r2", output: [] } }, type: "response.completed" }),
        ],
      ],
    });
    expect(activity.delegations.size).toBe(0);
    const held = play({
      script: [
        [0, delegated({ id: "d1" })],
        [
          1_000,
          backend({
            delegationId: "d1",
            extra: { item: { name: "action_items", type: "function_call" } },
            type: "response.output_item.done",
          }),
        ],
        [2_000, backend({ delegationId: "d1", extra: { response_id: "r1" }, type: "response.some_future_event" })],
      ],
    });
    expect(held.delegations.get("d1")!.lastProgressMs).toBe(1_000);
    expect(held.delegations.get("d1")!.askedBy).toEqual(["r1"]);
  });

  it("keeps a held ask when the delegation's opening arrives after its backend events", () => {
    const activity = play({
      script: [
        [
          1_000,
          backend({
            delegationId: "d1",
            extra: { item: { name: "action_items", type: "function_call" } },
            type: "response.output_item.done",
          }),
        ],
        [1_100, delegated({ id: "d1", responseId: "r1" })],
        [
          1_200,
          backend({
            delegationId: "d1",
            extra: { response: { id: "r1", output: [], status: "completed" } },
            type: "response.completed",
          }),
        ],
      ],
    });
    expect([...activity.delegations.keys()]).toEqual(["d1"]);
    expect(activity.delegations.get("d1")!.sinceMs).toBe(1_000);
    expect(quietAt({ activity, nowMs: 1_300 }).phase).toBe("working");
  });

  it("does not bring back a turn that finished before its own opening arrived", () => {
    const activity = play({
      script: [
        [
          1_000,
          backend({
            delegationId: "d1",
            extra: { response: { id: "r1", output: [], status: "completed" } },
            type: "response.completed",
          }),
        ],
        [1_100, delegated({ id: "d1", responseId: "r1" })],
      ],
    });
    expect(activity.delegations.size).toBe(0);
    expect(activity.ended).toEqual([{ id: "d1", responseIds: ["r1"] }]);
    expect(quietAt({ activity, nowMs: 1_200 }).phase).toBe("listening");
  });

  it("gives an ask held before any id to the first response a late opening names", () => {
    const activity = play({
      script: [
        [
          1_000,
          backend({
            delegationId: "d1",
            extra: { item: { name: "x", type: "function_call" } },
            type: "response.output_item.done",
          }),
        ],
        [1_100, { kind: "continued" }],
        [1_200, backend({ delegationId: "d1", extra: { response: { id: "r2" } }, type: "response.created" })],
        [1_300, delegated({ id: "d1", responseId: "r1" })],
        [
          1_400,
          backend({
            delegationId: "d1",
            extra: { response: { id: "r2", output: [], status: "completed" } },
            type: "response.completed",
          }),
        ],
      ],
    });
    expect(activity.delegations.size).toBe(0);
    expect(activity.ended).toEqual([{ id: "d1", responseIds: ["r1", "r2"] }]);
    expect(quietAt({ activity, nowMs: 1_500 }).phase).toBe("listening");
  });

  it("ends the turn when a late opening moves the ask off a newest response that already completed", () => {
    const activity = play({
      script: [
        [
          1_000,
          backend({
            delegationId: "d1",
            extra: { item: { name: "x", type: "function_call" } },
            type: "response.output_item.done",
          }),
        ],
        [1_100, { kind: "continued" }],
        [
          1_200,
          backend({
            delegationId: "d1",
            extra: { response: { id: "r2", output: [], status: "completed" } },
            type: "response.completed",
          }),
        ],
        [1_300, delegated({ id: "d1", responseId: "r1" })],
      ],
    });
    expect(activity.delegations.size).toBe(0);
    expect(activity.ended).toEqual([{ id: "d1", responseIds: ["r1", "r2"] }]);
    expect(quietAt({ activity, nowMs: 1_400 }).phase).toBe("listening");
  });

  it("keeps waiting for the continuation when older responses close after the page continued", () => {
    const activity = play({
      script: [
        [0, delegated({ id: "d1", responseId: "r1" })],
        [10, delegated({ id: "d2", responseId: "r2" })],
        [100, backend({ extra: { item: { name: "x", type: "function_call" } }, type: "response.output_item.done" })],
        [200, { callId: "c1", kind: "tool-started", name: "x" }],
        [300, { callId: "c1", kind: "tool-answered" }],
        [310, { kind: "continued" }],
        [
          400,
          backend({
            delegationId: "d1",
            extra: { response: { id: "r1", output: [], status: "completed" } },
            type: "response.completed",
          }),
        ],
        [
          500,
          backend({
            delegationId: "d2",
            extra: { response: { id: "r2", output: [], status: "completed" } },
            type: "response.completed",
          }),
        ],
      ],
    });
    expect(activity.continuations).toEqual([310]);
    expect(quietAt({ activity, nowMs: 600 }).phase).toBe("working");
  });

  it("reads a late copy of an ask the page already answered as history, not the continuation's ask", () => {
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
          500,
          backend({
            delegationId: "d1",
            extra: { item: { call_id: "c1", name: "x", type: "function_call" } },
            type: "response.output_item.done",
          }),
        ],
        [
          600,
          backend({
            delegationId: "d1",
            extra: { response: { id: "r2", output: [], status: "completed" } },
            type: "response.completed",
          }),
        ],
      ],
    });
    expect(activity.answeredCalls).toEqual(["c1"]);
    expect(activity.delegations.size).toBe(0);
    expect(quietAt({ activity, nowMs: 700 }).phase).toBe("listening");
  });

  it("keeps a failure its turn's own late opening arrives after", () => {
    const activity = play({
      script: [
        [
          100,
          backend({
            delegationId: "d1",
            extra: { response: { error: { message: "boom" }, id: "r1", status: "failed" } },
            type: "response.failed",
          }),
        ],
        [200, delegated({ id: "d1", responseId: "r1" })],
      ],
    });
    expect(activity.delegations.size).toBe(0);
    expect(activity.error).toEqual({ atMs: 100, message: "boom" });
    expect(quietAt({ activity, nowMs: 201 })).toMatchObject({ headline: "error", why: "boom" });
  });

  it("reads a late arguments event for an answered call as history, by the item id it carries", () => {
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
        [400, backend({ delegationId: "d1", extra: { response: { id: "r2" } }, type: "response.created" })],
        [
          500,
          backend({
            delegationId: "d1",
            extra: { arguments: "{}", item_id: "fc1", output_index: 0, sequence_number: 2 },
            type: "response.function_call_arguments.done",
          }),
        ],
        [
          600,
          backend({
            delegationId: "d1",
            extra: { response: { id: "r2", output: [], status: "completed" } },
            type: "response.completed",
          }),
        ],
        [
          700,
          backend({
            delegationId: "d1",
            extra: { arguments: "{}", item_id: "fc1", output_index: 0, sequence_number: 3 },
            type: "response.function_call_arguments.done",
          }),
        ],
      ],
    });
    expect(activity.callItems).toEqual(new Map([["fc1", "c1"]]));
    expect(activity.delegations.size).toBe(0);
    expect(activityRows({ activity, nowMs: 800 })).toEqual([]);
    expect(quietAt({ activity, nowMs: 800 }).phase).toBe("listening");
  });
});
