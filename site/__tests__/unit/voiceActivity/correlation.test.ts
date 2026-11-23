import { describe, expect, it } from "vitest";

import { activityRows, foldActivity } from "../../../lib/voiceActivity";
import { backend, delegated, play, quietAt, type Script } from "./harness";

describe("foldActivity correlation", () => {
  it("records a delegation's id, bound response and opening step", () => {
    const activity = play({ script: [[100, delegated({ id: "d1", responseId: "r0" })]] });
    expect(activity.delegations.get("d1")).toEqual({
      askedBy: [],
      closedBy: [],
      guessedAsk: undefined,
      id: "d1",
      lastProgressMs: 100,
      responseIds: ["r0"],
      sinceMs: 100,
      step: { kind: "reasoning" },
      unboundAsk: false,
    });
  });

  it("folds a client delegation as a plan call's hand-off to Codex, never as a GPT-Live delegation or an answer", () => {
    const activity = play({ script: [[0, { id: "c", kind: "delegated", responseId: undefined, target: "client" }]] });
    expect(activity.delegations.size).toBe(0);
    expect(activity.plan.handoff).toEqual({ sinceMs: 0, spokeMs: undefined });
    expect(activity.lastAnsweredMs).toBe(undefined);
  });

  it("binds by response id when the outer delegation id is absent", () => {
    const activity = play({
      script: [
        [0, delegated({ id: "d1", responseId: "r1" })],
        [0, delegated({ id: "d2", responseId: "r2" })],
        [
          5_000,
          backend({ extra: { item: { type: "message" }, response_id: "r2" }, type: "response.output_item.added" }),
        ],
      ],
    });
    expect(activity.delegations.get("d2")!.step).toEqual({ kind: "writing" });
    expect(activity.delegations.get("d1")!.lastProgressMs).toBe(0);
  });

  it("binds to the one open delegation when nothing names it", () => {
    const activity = play({
      script: [
        [0, delegated({ id: "d1" })],
        [3_000, backend({ extra: { response: { id: "r9" } }, type: "response.in_progress" })],
      ],
    });
    expect(activity.delegations.get("d1")!.responseIds).toEqual(["r9"]);
    expect(activity.delegations.get("d1")!.lastProgressMs).toBe(3_000);
  });

  it("changes neither of two open delegations for an event naming neither", () => {
    const before = play({
      script: [
        [0, delegated({ id: "d1" })],
        [0, delegated({ id: "d2" })],
      ],
    });
    const after = foldActivity({ activity: before, input: backend({ type: "response.completed" }), nowMs: 9_000 });
    expect(after).toBe(before);
  });

  it("does not count an unknown event type as progress for a delegation it knows", () => {
    const before = play({ script: [[0, delegated({ id: "d1" })]] });
    const after = foldActivity({
      activity: before,
      input: backend({ delegationId: "d1", type: "response.some_future_event" }),
      nowMs: 30_000,
    });
    expect(after).toBe(before);
  });

  it("reopens a delegation a later event names after it closed", () => {
    const activity = play({
      script: [
        [0, delegated({ id: "d1" })],
        [
          1_000,
          backend({ delegationId: "d1", extra: { response: { id: "r1", output: [] } }, type: "response.completed" }),
        ],
        [2_000, backend({ delegationId: "d1", extra: { response: { id: "r2" } }, type: "response.created" })],
      ],
    });
    expect(activity.delegations.get("d1")!.sinceMs).toBe(2_000);
    expect(activity.ended).toEqual([]);
  });

  it("does not reopen a closed turn on late events from a response it already had", () => {
    const activity = play({
      script: [
        [0, delegated({ id: "d1", responseId: "r1" })],
        [1_000, backend({ delegationId: "d1", extra: { response: { id: "r2" } }, type: "response.created" })],
        [
          2_000,
          backend({
            delegationId: "d1",
            extra: { response: { id: "r2", output: [], status: "completed" } },
            type: "response.completed",
          }),
        ],
        [
          2_100,
          backend({
            delegationId: "d1",
            extra: { item: { name: "x", type: "function_call" }, response_id: "r1" },
            type: "response.output_item.done",
          }),
        ],
        [
          2_200,
          backend({
            delegationId: "d1",
            extra: { response: { id: "r1", status: "completed" } },
            type: "response.completed",
          }),
        ],
      ],
    });
    expect(activity.delegations.size).toBe(0);
    expect(quietAt({ activity, nowMs: 2_300 }).phase).toBe("listening");
  });

  it("reopens a closed turn when its newest response's tool ask arrives after that response's close", () => {
    const activity = play({
      script: [
        [0, delegated({ id: "d1", responseId: "r1" })],
        [
          1_000,
          backend({
            delegationId: "d1",
            extra: { response: { id: "r1", status: "completed" } },
            type: "response.completed",
          }),
        ],
        [
          1_100,
          backend({
            delegationId: "d1",
            extra: { item: { name: "action_items", type: "function_call" }, response_id: "r1" },
            type: "response.output_item.done",
          }),
        ],
      ],
    });
    expect([...activity.delegations.keys()]).toEqual(["d1"]);
    expect(activity.delegations.get("d1")!.askedBy).toEqual(["r1"]);
    expect(quietAt({ activity, nowMs: 1_200 }).phase).toBe("working");
  });

  it("gives a late tool ask naming no response to the closed turn's newest one", () => {
    const activity = play({
      script: [
        [0, delegated({ id: "d1", responseId: "r1" })],
        [
          1_000,
          backend({
            delegationId: "d1",
            extra: { response: { id: "r1", output: [], status: "completed" } },
            type: "response.completed",
          }),
        ],
        [
          1_100,
          backend({
            delegationId: "d1",
            extra: { item: { call_id: "c1", name: "action_items", type: "function_call" } },
            type: "response.output_item.done",
          }),
        ],
      ],
    });
    expect(activity.delegations.get("d1")!.askedBy).toEqual(["r1"]);
    expect(quietAt({ activity, nowMs: 1_200 }).phase).toBe("working");
  });

  it("keeps a late id-less ask with the unnamed response that closed, not the continued one", () => {
    const activity = play({
      script: [
        [0, delegated({ id: "d1" })],
        [1_000, backend({ delegationId: "d1", extra: { response: { output: [] } }, type: "response.completed" })],
        [
          1_100,
          backend({
            delegationId: "d1",
            extra: { item: { name: "x", type: "function_call" } },
            type: "response.output_item.done",
          }),
        ],
        [1_200, backend({ delegationId: "d1", extra: { response: { id: "r2" } }, type: "response.created" })],
        [
          1_300,
          backend({
            delegationId: "d1",
            extra: { response: { id: "r2", output: [], status: "completed" } },
            type: "response.completed",
          }),
        ],
      ],
    });
    expect(activity.delegations.size).toBe(0);
    expect(quietAt({ activity, nowMs: 1_400 }).phase).toBe("listening");
  });

  it("opens a turn on a response naming no delegation, and hands it to the delegation once named", () => {
    const opened = play({
      script: [[1_000, backend({ extra: { response: { id: "r1" } }, type: "response.created" })]],
    });
    expect(quietAt({ activity: opened, nowMs: 1_100 }).phase).toBe("working");
    const named = foldActivity({ activity: opened, input: delegated({ id: "d1", responseId: "r1" }), nowMs: 1_200 });
    expect([...named.delegations.keys()]).toEqual(["d1"]);
    expect(named.delegations.get("d1")!.sinceMs).toBe(1_000);
    const done = foldActivity({
      activity: named,
      input: backend({
        extra: { response: { id: "r1", output: [], status: "completed" } },
        type: "response.completed",
      }),
      nowMs: 1_300,
    });
    expect(done.delegations.size).toBe(0);
    expect(quietAt({ activity: done, nowMs: 1_400 }).phase).toBe("listening");
  });

  it("hands a response-keyed turn to the delegation a later event names", () => {
    const activity = play({
      script: [
        [1_000, backend({ extra: { response: { id: "r1" } }, type: "response.created" })],
        [1_100, backend({ delegationId: "d1", extra: { response_id: "r1" }, type: "response.reasoning_text.delta" })],
      ],
    });
    expect([...activity.delegations.keys()]).toEqual(["d1"]);
    expect(activity.delegations.get("d1")!.id).toBe("d1");
  });

  it("does not reopen a response-keyed turn whose opening arrives after it closed", () => {
    const activity = play({
      script: [
        [1_000, backend({ extra: { response: { id: "r1" } }, type: "response.created" })],
        [
          1_100,
          backend({ extra: { response: { id: "r1", output: [], status: "completed" } }, type: "response.completed" }),
        ],
        [1_200, delegated({ id: "d1", responseId: "r1" })],
      ],
    });
    expect(activity.delegations.size).toBe(0);
    expect(activity.ended).toEqual([{ id: "d1", responseIds: ["r1"] }]);
  });

  it("opens a concurrent response as its own turn when the open one is not waiting for one", () => {
    const activity = play({
      script: [
        [0, delegated({ id: "d1", responseId: "r1" })],
        [1_000, backend({ extra: { response: { id: "r2" } }, type: "response.created" })],
        [1_100, delegated({ id: "d2", responseId: "r2" })],
        [
          1_200,
          backend({ extra: { response: { id: "r2", output: [], status: "completed" } }, type: "response.completed" }),
        ],
      ],
    });
    expect([...activity.delegations.keys()]).toEqual(["d1"]);
    expect(activity.delegations.get("d1")!.responseIds).toEqual(["r1"]);
    expect(quietAt({ activity, nowMs: 1_300 }).phase).toBe("working");
  });

  it("detaches a response a waiting turn took by guess once its own delegation names it", () => {
    const activity = play({
      script: [
        [0, delegated({ id: "d1", responseId: "r1" })],
        [
          500,
          backend({
            delegationId: "d1",
            extra: { item: { name: "x", type: "function_call" } },
            type: "response.output_item.done",
          }),
        ],
        [1_000, backend({ extra: { response: { id: "r2" } }, type: "response.created" })],
        [1_100, delegated({ id: "d2", responseId: "r2" })],
      ],
    });
    expect(activity.delegations.get("d1")!.responseIds).toEqual(["r1"]);
    expect(activity.delegations.get("d1")!.askedBy).toEqual(["r1"]);
    expect(activity.delegations.get("d2")!.responseIds).toEqual(["r2"]);
  });

  it("keeps a guessed response in the order it began when its own delegation, already open, takes it back", () => {
    const activity = play({
      script: [
        [0, delegated({ id: "d1" })],
        [1_000, backend({ extra: { response: { id: "r2" } }, type: "response.created" })],
        [2_000, delegated({ id: "d2", responseId: "r0" })],
        [3_000, backend({ delegationId: "d2", extra: { response: { id: "r3" } }, type: "response.created" })],
        [4_000, backend({ delegationId: "d2", extra: { response: { id: "r2" } }, type: "response.completed" })],
        [5_000, backend({ delegationId: "d1", extra: { response: { id: "r1" } }, type: "response.created" })],
        [6_000, backend({ delegationId: "d1", extra: { response: { id: "r1" } }, type: "response.completed" })],
      ],
    });
    // r2 began before r3, so r2's close is an older response ending and d2 runs on in r3.
    expect(activity.delegations.get("d2")!.responseIds).toEqual(["r0", "r2", "r3"]);
    expect([...activity.delegations.keys()]).toEqual(["d2"]);
    expect(quietAt({ activity, nowMs: 7_000 }).phase).toBe("working");
  });

  it("gives a delegation opened with no response the first response that names no delegation", () => {
    const activity = play({
      script: [
        [0, delegated({ id: "d1" })],
        [1_000, backend({ extra: { response: { id: "r1" } }, type: "response.created" })],
      ],
    });
    expect([...activity.delegations.keys()]).toEqual(["d1"]);
    expect(activity.delegations.get("d1")!.responseIds).toEqual(["r1"]);
  });

  it("merges a response-keyed turn into its delegation when one event names both", () => {
    const activity = play({
      script: [
        [1_000, backend({ extra: { response: { id: "r1" } }, type: "response.created" })],
        [1_100, delegated({ id: "d1" })],
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
    expect(activity.delegations.size).toBe(0);
    expect(quietAt({ activity, nowMs: 1_300 }).phase).toBe("listening");
  });

  it("keeps a later response-keyed turn's response newest when it merges into a delegation that had one", () => {
    const script: Script = [
      [0, delegated({ id: "d1", responseId: "r0" })],
      [10, backend({ extra: { response: { id: "r1" } }, type: "response.created" })],
      [
        20,
        backend({ delegationId: "d1", extra: { delta: "hi", response_id: "r1" }, type: "response.output_text.delta" }),
      ],
    ];
    expect(play({ script }).delegations.get("d1")!.responseIds).toEqual(["r0", "r1"]);
    const activity = play({
      script: [
        ...script,
        [
          30,
          backend({ extra: { response: { id: "r1", output: [], status: "completed" } }, type: "response.completed" }),
        ],
      ],
    });
    expect(activity.delegations.size).toBe(0);
    expect(activityRows({ activity, nowMs: 40 })).toEqual([]);
    expect(quietAt({ activity, nowMs: 40 }).phase).toBe("listening");
  });

  it("joins two turns that ended apart when a late event names both, rather than reopening either", () => {
    const activity = play({
      script: [
        [0, delegated({ id: "d1", responseId: "r0" })],
        [10, backend({ extra: { response: { id: "r1" } }, type: "response.created" })],
        [
          20,
          backend({
            delegationId: "d1",
            extra: { response: { id: "r0", output: [], status: "completed" } },
            type: "response.completed",
          }),
        ],
        [
          30,
          backend({ extra: { response: { id: "r1", output: [], status: "completed" } }, type: "response.completed" }),
        ],
        [40, backend({ delegationId: "d1", extra: { response: { id: "r1" } }, type: "response.created" })],
      ],
    });
    expect(activity.delegations.size).toBe(0);
    expect(activity.ended).toEqual([{ id: "d1", responseIds: ["r0", "r1"] }]);
    expect(activityRows({ activity, nowMs: 50 })).toEqual([]);
    expect(quietAt({ activity, nowMs: 50 }).phase).toBe("listening");
  });
});
