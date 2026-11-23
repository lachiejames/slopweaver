/**
 * `PlanCall` reading a Codex turn that waits on the model, through its real notification path: the `model-wait` line a
 * long wait leaves, the step the page is told once items overlap, and Codex's own re-send notice. MEASURED, the
 * incident: three waits of 346s, 326s and 233s ran with no tool running and the orb drew ZZZ over them.
 */

import { describe, expect, it } from "vitest";
import type { SequencedEvent } from "../../../lib/planCallContract";
import { eventsOf, itemLine, opened, turnLine } from "./harness";

/** The events a turn waiting on the model is read by: its own progress, the waits it left and Codex's notices. */
const waitEventsOf = ({ seen }: { seen: readonly SequencedEvent[] }): SequencedEvent["event"][] =>
  eventsOf({ seen }).filter((event) => ["codex-turn", "model-wait", "codex-notice"].includes(event.kind));

/** An app-server `error` notification line: the model's reply dropped, and whether Codex re-sends it. */
const errorLine = ({ threadId, willRetry }: { threadId: string; willRetry: boolean }): string =>
  `${JSON.stringify({ method: "error", params: { error: { message: "stream disconnected" }, threadId, turnId: "t-1", willRetry } })}\n`;

describe("a Codex turn waiting on the model", () => {
  it("writes the wait before its first item, keeps the turn on an item still in flight, and counts no wait under it", async () => {
    const h = await opened();
    const seen: SequencedEvent[] = [];
    h.call.subscribe({ after: 0, listener: (event) => seen.push(event) });
    const tool = { id: "a", tool: "read_card", type: "dynamicToolCall" };
    const reasoning = { id: "b", type: "reasoning" };
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" }) });
    h.clock.advance({ ms: 346_000 });
    h.call.receive({ chunk: itemLine({ item: tool, method: "item/started", turnId: "t-1" }) });
    h.call.receive({ chunk: itemLine({ item: reasoning, method: "item/started", turnId: "t-1" }) });
    h.call.receive({ chunk: itemLine({ item: reasoning, method: "item/completed", turnId: "t-1" }) });
    h.clock.advance({ ms: 37_000 });
    h.call.receive({ chunk: itemLine({ item: tool, method: "item/completed", turnId: "t-1" }) });
    h.call.receive({ chunk: turnLine({ method: "turn/completed", status: "completed", turnId: "t-1" }) });
    const toolStep = { kind: "tool", name: "read_card" };
    expect(waitEventsOf({ seen })).toEqual([
      { kind: "codex-turn", phase: "started", turnId: "t-1" },
      { kind: "model-wait", turnId: "t-1", waitMs: 346_000 },
      { kind: "codex-turn", phase: "progress", step: toolStep, turnId: "t-1" },
      { kind: "codex-turn", phase: "progress", step: { kind: "reasoning" }, turnId: "t-1" },
      { kind: "codex-turn", phase: "progress", step: toolStep, turnId: "t-1" },
      { kind: "codex-turn", phase: "progress", step: { kind: "awaiting", reason: "model" }, turnId: "t-1" },
      { failure: null, kind: "codex-turn", phase: "completed", status: "completed", turnId: "t-1" },
    ]);
  });

  it("forwards its own thread's re-send as a notice and the turn awaiting it, and nothing of another thread's", async () => {
    const h = await opened();
    const seen: SequencedEvent[] = [];
    h.call.subscribe({ after: 0, listener: (event) => seen.push(event) });
    h.call.receive({ chunk: turnLine({ method: "turn/started", status: "inProgress", turnId: "t-1" }) });
    h.call.receive({ chunk: errorLine({ threadId: "thread-9", willRetry: true }) });
    h.call.receive({ chunk: errorLine({ threadId: "thread-1", willRetry: true }) });
    expect(waitEventsOf({ seen })).toEqual([
      { kind: "codex-turn", phase: "started", turnId: "t-1" },
      { kind: "codex-notice", level: "retry", message: "stream disconnected", turnId: "t-1" },
      { kind: "codex-turn", phase: "progress", step: { kind: "awaiting", reason: "retry" }, turnId: "t-1" },
    ]);
    expect(eventsOf({ seen }).filter((event) => event.kind === "error")).toEqual([]);
  });
});
