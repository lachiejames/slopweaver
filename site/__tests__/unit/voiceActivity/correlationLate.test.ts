import { describe, expect, it } from "vitest";

import { type ActivityInput, activityRows } from "../../../lib/voiceActivity";
import { backend, delegated, play, quietAt, type Script } from "./harness";

describe("foldActivity correlation", () => {
  it("answers the page's continuation when a response the turn has not had begins", () => {
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
        [40, backend({ delegationId: "d1", extra: { response: { id: "r2" } }, type: "response.created" })],
      ],
    });
    expect(activity.continuations).toEqual([]);
    expect(activity.delegations.get("d1")!.responseIds).toEqual(["r1", "r2"]);
  });

  it("keeps a second continue outstanding when one response asked for two tools and one continuation has ended", () => {
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
        [
          10,
          backend({
            delegationId: "d1",
            extra: { item: { call_id: "c2", id: "fc2", name: "x", type: "function_call" } },
            type: "response.output_item.done",
          }),
        ],
        [20, backend({ delegationId: "d1", extra: { response: { id: "r1" } }, type: "response.completed" })],
        [30, { callId: "c1", kind: "tool-started", name: "x" }],
        [40, { callId: "c1", kind: "tool-answered" }],
        [41, { kind: "continued" }],
        [50, { callId: "c2", kind: "tool-started", name: "x" }],
        [60, { callId: "c2", kind: "tool-answered" }],
        [61, { kind: "continued" }],
        [70, backend({ delegationId: "d1", extra: { response: { id: "r2" } }, type: "response.created" })],
        [80, backend({ delegationId: "d1", extra: { response: { id: "r2" } }, type: "response.completed" })],
      ],
    });
    expect(activity.continuations).toEqual([61]);
    expect(activityRows({ activity, nowMs: 1_000 }).map((row) => row.key)).toEqual(["continued"]);
    expect(quietAt({ activity, nowMs: 1_000 }).phase).toBe("working");
  });

  it("closes a delegation whose only response already ended under a response-keyed turn", () => {
    const activity = play({
      script: [
        [1_000, backend({ extra: { response: { id: "r1" } }, type: "response.created" })],
        [
          1_100,
          backend({ extra: { response: { id: "r1", output: [], status: "completed" } }, type: "response.completed" }),
        ],
        [1_200, delegated({ id: "d1" })],
        [1_300, backend({ delegationId: "d1", extra: { response_id: "r1" }, type: "response.output_text.done" })],
      ],
    });
    expect(activity.delegations.size).toBe(0);
    expect(activity.ended).toEqual([{ id: "d1", responseIds: ["r1"] }]);
  });

  it("takes an ended response-keyed record into the delegation that runs on once named", () => {
    const activity = play({
      script: [
        [0, backend({ extra: { response: { id: "r1" } }, type: "response.created" })],
        [
          10,
          backend({ extra: { response: { id: "r1", output: [], status: "completed" } }, type: "response.completed" }),
        ],
        [20, backend({ delegationId: "d1", extra: { response: { id: "r2" } }, type: "response.created" })],
        [30, delegated({ id: "d1", responseId: "r1" })],
      ],
    });
    expect([...activity.delegations.keys()]).toEqual(["d1"]);
    expect(activity.delegations.get("d1")!.responseIds).toEqual(["r1", "r2"]);
    expect(activity.ended).toEqual([]);
  });

  it("says why on a late failure of a finished turn's older response, without bringing it back", () => {
    const activity = play({
      script: [
        [0, delegated({ id: "d1", responseId: "r1" })],
        [
          100,
          backend({
            delegationId: "d1",
            extra: { item: { name: "x", type: "function_call" } },
            type: "response.output_item.done",
          }),
        ],
        [200, backend({ delegationId: "d1", extra: { response: { id: "r2" } }, type: "response.created" })],
        [
          300,
          backend({
            delegationId: "d1",
            extra: { response: { id: "r2", output: [], status: "completed" } },
            type: "response.completed",
          }),
        ],
        [
          400,
          backend({
            delegationId: "d1",
            extra: { response: { error: { message: "upstream exploded" }, id: "r1", status: "failed" } },
            type: "response.failed",
          }),
        ],
      ],
    });
    expect(activity.delegations.size).toBe(0);
    expect(activity.error).toEqual({ atMs: 400, message: "upstream exploded" });
    expect(quietAt({ activity, nowMs: 500 }).why).toBe("upstream exploded");
  });

  it("remembers every turn the call closed, however many came after it", () => {
    const turns: Script = Array.from({ length: 40 }, (_, index): readonly [number, ActivityInput] => [
      index * 1_000,
      backend({
        delegationId: `d${String(index)}`,
        extra: { response: { id: `r${String(index)}`, output: [], status: "completed" } },
        type: "response.completed",
      }),
    ]);
    const activity = play({
      script: [
        ...turns,
        [50_000, backend({ delegationId: "d0", extra: { response: { id: "r0" } }, type: "response.created" })],
      ],
    });
    expect(activity.delegations.size).toBe(0);
    expect(quietAt({ activity, nowMs: 50_100 }).phase).toBe("listening");
  });

  it("never binds a closed turn's late failure to the one delegation still open, though it says why", () => {
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
        [2_000, delegated({ id: "d2", responseId: "r9" })],
        [
          3_000,
          backend({
            extra: { response: { error: { message: "late" }, id: "r1", status: "failed" } },
            type: "response.failed",
          }),
        ],
      ],
    });
    expect([...activity.delegations.keys()]).toEqual(["d2"]);
    expect(activity.delegations.get("d2")!.responseIds).toEqual(["r9"]);
    expect(activity.error).toEqual({ atMs: 3_000, message: "late" });
  });
});
