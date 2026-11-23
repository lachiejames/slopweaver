/**
 * The SDK's event stream drained into one turn (`codex/streamDrain.ts`): the last agent message is the answer, an
 * item started and never completed leaves the activity not measured, and a failed turn throws.
 */
import { describe, expect, it } from "vitest";
import type { CodexSdkStreamEvent } from "../../../codex/client.js";
import { drainStream, toItemActivity } from "../../../codex/streamDrain.js";
import type { CodexObservedEvent } from "../../../codex/types.js";

async function* streamOf({ events }: { events: readonly CodexSdkStreamEvent[] }): AsyncIterable<CodexSdkStreamEvent> {
  for (const event of events) {
    yield event;
  }
}

const USAGE = {
  cache_write_input_tokens: 0,
  cached_input_tokens: 0,
  input_tokens: 10,
  output_tokens: 2,
  reasoning_output_tokens: 0,
};

describe("drainStream", () => {
  it("takes the LAST agent message as the answer and counts every completed item", async () => {
    const seen: CodexObservedEvent[] = [];
    const turn = await drainStream({
      events: streamOf({
        events: [
          { item: { text: "thinking", type: "agent_message" }, type: "item.completed" },
          { item: { text: "the answer", type: "agent_message" }, type: "item.completed" },
          { type: "turn.completed", usage: USAGE },
        ],
      }),
      sink: (event) => seen.push(event),
    });

    expect(turn).toEqual({
      finalResponse: "the answer",
      items: [{ type: "agent_message" }, { type: "agent_message" }],
      unfinished: 0,
      usage: USAGE,
    });
    expect(toItemActivity({ turn })).toEqual({ counts: { agent_message: 2 }, kind: "measured" });
    expect(seen.length).toBeGreaterThan(0);
  });

  it("leaves the activity NOT MEASURED when an item started and never completed", async () => {
    const turn = await drainStream({
      events: streamOf({
        events: [
          { item: { command: "cat x", type: "command_execution" }, type: "item.started" },
          { item: { text: "hi", type: "agent_message" }, type: "item.completed" },
          { type: "turn.completed", usage: USAGE },
        ],
      }),
      sink: undefined,
    });

    expect(turn.unfinished).toBe(1);
    expect(toItemActivity({ turn })).toEqual({ kind: "not-measured", reason: "item-unfinished" });
  });

  it("throws a failed turn's own message, as the SDK's blocking run does", async () => {
    const drained = drainStream({
      events: streamOf({ events: [{ error: { message: "refused" }, type: "turn.failed" }] }),
      sink: undefined,
    });

    await expect(drained).rejects.toThrow("refused");
  });
});
