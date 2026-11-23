import { describe, expect, it } from "vitest";

import { activityRows, ERROR_SHOWN_MS, STALL_MS } from "../../../lib/voiceActivity";
import { backend, delegated, play, quietAt, type Script } from "./harness";

describe("foldActivity correlation", () => {
  it("shows backend work that names no turn, before any turn is open, until its opening claims it", () => {
    const early: Script = [
      [
        100,
        backend({
          extra: { content_index: 0, delta: "hi", item_id: "m1", logprobs: [], output_index: 0, sequence_number: 1 },
          type: "response.output_text.delta",
        }),
      ],
    ];
    const before = play({ script: early });
    expect(activityRows({ activity: before, nowMs: 101 }).map((row) => row.key)).toEqual(["stray"]);
    expect(quietAt({ activity: before, nowMs: 101 }).phase).toBe("working");
    expect(quietAt({ activity: before, nowMs: 100 + STALL_MS }).phase).toBe("stalled");
    const after = play({ script: [...early, [200, delegated({ id: "d1" })]] });
    expect(after.stray).toBe(undefined);
    expect(activityRows({ activity: after, nowMs: 201 }).map((row) => row.key)).toEqual(["d:d1"]);
  });

  it("reads a Responses event it has no words for as the backend working", () => {
    const activity = play({
      script: [
        [
          1_000,
          backend({
            extra: { item_id: "fs_1", output_index: 0, sequence_number: 1 },
            type: "response.file_search_call.in_progress",
          }),
        ],
      ],
    });
    expect(activity.stray).toEqual({ lastMs: 1_000, sinceMs: 1_000, step: { kind: "working" } });
    expect(quietAt({ activity, nowMs: 1_001 }).phase).toBe("working");
  });

  it("drops the unclaimed row when a failure naming no turn ends it", () => {
    const activity = play({
      script: [
        [100, backend({ extra: { delta: "hi", item_id: "m1" }, type: "response.output_text.delta" })],
        [200, backend({ extra: { message: "boom" }, type: "error" })],
      ],
    });
    expect(activity.stray).toBe(undefined);
    expect(quietAt({ activity, nowMs: 201 })).toMatchObject({ headline: "error", why: "boom" });
  });

  it("merges responses in the order each began, so an interleaved older one's close leaves the newest running", () => {
    const activity = play({
      script: [
        [0, delegated({ id: "d1", responseId: "r0" })],
        [10, backend({ extra: { response: { id: "r1" } }, type: "response.created" })],
        [
          15,
          backend({
            delegationId: "d1",
            extra: { item: { call_id: "c1", id: "fc1", name: "x", type: "function_call" }, response_id: "r0" },
            type: "response.output_item.added",
          }),
        ],
        [
          20,
          backend({
            delegationId: "d1",
            extra: {
              response: {
                id: "r0",
                output: [{ call_id: "c1", name: "x", type: "function_call" }],
                status: "completed",
              },
            },
            type: "response.completed",
          }),
        ],
        [22, { callId: "c1", kind: "tool-started", name: "x" }],
        [24, { callId: "c1", kind: "tool-answered" }],
        [26, { kind: "continued" }],
        [30, backend({ delegationId: "d1", extra: { response: { id: "r2" } }, type: "response.created" })],
        [
          40,
          backend({
            delegationId: "d1",
            extra: { response: { id: "r1", output: [], status: "completed" } },
            type: "response.completed",
          }),
        ],
      ],
    });
    expect(activity.delegations.get("d1")!.responseIds).toEqual(["r0", "r1", "r2"]);
    expect(activityRows({ activity, nowMs: 50 }).map((row) => row.key)).toEqual(["d:d1"]);
    expect(quietAt({ activity, nowMs: 50 }).phase).toBe("working");
  });

  it("orders two responses first named in the same millisecond by which was heard first", () => {
    const activity = play({
      script: [
        [100, backend({ extra: { response: { id: "r1" } }, type: "response.created" })],
        [100, backend({ delegationId: "d1", extra: { response: { id: "r2" } }, type: "response.created" })],
        [
          101,
          backend({
            delegationId: "d1",
            extra: { delta: "hi", response_id: "r1" },
            type: "response.output_text.delta",
          }),
        ],
        [
          102,
          backend({
            delegationId: "d1",
            extra: { response: { id: "r1", output: [], status: "completed" } },
            type: "response.completed",
          }),
        ],
      ],
    });
    expect(activity.delegations.get("d1")!.responseIds).toEqual(["r1", "r2"]);
    expect(activityRows({ activity, nowMs: 103 }).map((row) => row.key)).toEqual(["d:d1"]);
  });

  it("ranks a late opening's response first, as the response its delegation was created with", () => {
    const activity = play({
      script: [
        [0, backend({ delegationId: "d1", extra: { response: { id: "r2" } }, type: "response.created" })],
        [1, delegated({ id: "d1", responseId: "r1" })],
        [
          2,
          backend({
            delegationId: "d1",
            extra: { response: { id: "r2", output: [], status: "completed" } },
            type: "response.completed",
          }),
        ],
      ],
    });
    expect(activity.responseOrder.get("r1")).toBeLessThan(activity.responseOrder.get("r2")!);
    expect(activity.ended).toEqual([{ id: "d1", responseIds: ["r1", "r2"] }]);
  });

  it("merges a late opening's response ahead of one heard before it", () => {
    const activity = play({
      script: [
        [0, backend({ extra: { response: { id: "r2" } }, type: "response.created" })],
        [1, backend({ extra: { response: { id: "r1" } }, type: "response.created" })],
        [2, delegated({ id: "d1", responseId: "r1" })],
        [
          3,
          backend({
            delegationId: "d1",
            extra: { delta: "hi", response_id: "r2" },
            type: "response.output_text.delta",
          }),
        ],
      ],
    });
    expect(activity.delegations.get("d1")!.responseIds).toEqual(["r1", "r2"]);
  });

  it("takes a guessed response off its first delegation when an already-open one names it", () => {
    const activity = play({
      script: [
        [0, delegated({ id: "d1" })],
        [10, backend({ extra: { response: { id: "r1" } }, type: "response.created" })],
        [20, delegated({ id: "d2" })],
        [30, backend({ delegationId: "d2", extra: { response: { id: "r1" } }, type: "response.in_progress" })],
        [
          40,
          backend({ extra: { response: { id: "r1", output: [], status: "completed" } }, type: "response.completed" }),
        ],
        [50, backend({ delegationId: "d1", extra: { response: { id: "r0" } }, type: "response.created" })],
        [
          60,
          backend({
            delegationId: "d1",
            extra: { response: { id: "r0", output: [], status: "completed" } },
            type: "response.completed",
          }),
        ],
      ],
    });
    expect(activity.delegations.size).toBe(0);
    expect(activityRows({ activity, nowMs: 70 })).toEqual([]);
    expect(quietAt({ activity, nowMs: 70 }).phase).toBe("listening");
  });

  it("reopens a delegation whose only response proves to be another's, still waiting for its own", () => {
    const activity = play({
      script: [
        [0, delegated({ id: "d1" })],
        [10, backend({ extra: { response: { id: "r1" } }, type: "response.created" })],
        [
          20,
          backend({ extra: { response: { id: "r1", output: [], status: "completed" } }, type: "response.completed" }),
        ],
        [30, delegated({ id: "d2" })],
        [40, backend({ delegationId: "d2", extra: { response: { id: "r1" } }, type: "response.in_progress" })],
      ],
    });
    expect(activity.ended).toEqual([]);
    expect(activity.delegations.get("d1")!.responseIds).toEqual([]);
    expect(
      activityRows({ activity, nowMs: 50 })
        .map((row) => row.key)
        .toSorted(),
    ).toEqual(["d:d1", "d:d2"]);
  });

  it("reopens an ended delegation when the response that closed it proves to be another's", () => {
    const toolItem = ({ callId, id }: { callId: string; id: string }): Record<string, unknown> => ({
      item: { call_id: callId, id, name: callId, type: "function_call" },
    });
    const activity = play({
      script: [
        [0, delegated({ id: "d1", responseId: "r1" })],
        [
          10,
          backend({
            delegationId: "d1",
            extra: { ...toolItem({ callId: "x", id: "fx" }), response_id: "r1" },
            type: "response.output_item.added",
          }),
        ],
        [20, backend({ extra: { response: { id: "r2" } }, type: "response.created" })],
        [
          30,
          backend({ extra: { response: { id: "r2", output: [], status: "completed" } }, type: "response.completed" }),
        ],
        [40, delegated({ id: "d2" })],
        [
          50,
          backend({
            delegationId: "d2",
            extra: { response: { id: "r2", output: [], status: "completed" } },
            type: "response.completed",
          }),
        ],
      ],
    });
    expect(activity.ended).toEqual([{ id: "d2", responseIds: ["r2"] }]);
    expect(activity.delegations.get("d1")!.responseIds).toEqual(["r1"]);
    expect(activityRows({ activity, nowMs: 60 }).map((row) => row.key)).toEqual(["d:d1"]);
    expect(quietAt({ activity, nowMs: 60 }).phase).toBe("working");
  });

  it("keeps the page's continuation outstanding through a late failure of the response that asked", () => {
    const activity = play({
      script: [
        [0, delegated({ id: "d1", responseId: "r1" })],
        [
          10,
          backend({
            delegationId: "d1",
            extra: { item: { call_id: "c1", id: "fc1", name: "x", type: "function_call" } },
            type: "response.output_item.done",
          }),
        ],
        [20, { callId: "c1", kind: "tool-started", name: "x" }],
        [30, { callId: "c1", kind: "tool-answered" }],
        [31, { kind: "continued" }],
        [
          40,
          backend({
            delegationId: "d1",
            extra: { response: { error: { message: "boom" }, id: "r1", status: "failed" } },
            type: "response.failed",
          }),
        ],
        [40 + ERROR_SHOWN_MS, { kind: "heard" }],
      ],
    });
    expect(activity.continuations).toEqual([31]);
    expect(activityRows({ activity, nowMs: 40 + ERROR_SHOWN_MS + 1_000 }).map((row) => row.key)).toEqual(["continued"]);
    expect(quietAt({ activity, nowMs: 40 + ERROR_SHOWN_MS + 1_000 }).phase).toBe("working");
  });

  it("keeps the page's continuation outstanding through a late delta and then a failure of the response that asked", () => {
    const activity = play({
      script: [
        [0, delegated({ id: "d1", responseId: "r1" })],
        [
          10,
          backend({
            delegationId: "d1",
            extra: { item: { call_id: "c1", id: "fc1", name: "x", type: "function_call" } },
            type: "response.output_item.done",
          }),
        ],
        [20, { callId: "c1", kind: "tool-started", name: "x" }],
        [30, { callId: "c1", kind: "tool-answered" }],
        [31, { kind: "continued" }],
        // A later item of r1, not a response beginning: it answers no continue.
        [
          32,
          backend({ delegationId: "d1", extra: { delta: "so", item_id: "m1" }, type: "response.output_text.delta" }),
        ],
        [
          40,
          backend({
            delegationId: "d1",
            extra: { response: { error: { message: "boom" }, id: "r1", status: "failed" } },
            type: "response.failed",
          }),
        ],
        [40 + ERROR_SHOWN_MS, { kind: "heard" }],
      ],
    });
    expect(activity.continuations).toEqual([31]);
    expect(activityRows({ activity, nowMs: 40 + ERROR_SHOWN_MS + 1_000 }).map((row) => row.key)).toEqual(["continued"]);
    expect(quietAt({ activity, nowMs: 40 + ERROR_SHOWN_MS + 1_000 }).phase).toBe("working");
  });
});
