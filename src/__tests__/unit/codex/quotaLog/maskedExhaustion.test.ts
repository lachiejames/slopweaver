/*
 * No line reads healthy while either `rate_limits` position reports an exhaustion: a nested exhausted window behind
 * a healthy, empty or bare sibling still reads as one.
 */
import { describe, expect, it } from "vitest";
import { parseRolloutObservation } from "../../../../codex/quotaLog.js";

describe("no line reads HEALTHY while any position it carries reports exhaustion", () => {
  // Three review rounds broke three different precedence rules — prefer the sibling, prefer whichever is an
  // object, prefer whichever carries a reading — each time by putting an exhausted window in the position
  // that lost. Nothing picks now: every position is judged and the worst one wins.
  const masked = ({ sibling }: { sibling: Record<string, unknown> }): string =>
    JSON.stringify({
      payload: {
        info: { rate_limits: { limit_id: "codex", primary: { resets_at: 1_789_275_600, used_percent: 100 } } },
        rate_limits: { limit_id: "codex", ...sibling },
        type: "token_count",
      },
      timestamp: "2026-09-13T00:01:00.000Z",
      type: "event_msg",
    });

  it("reports the nested exhaustion behind a HEALTHY sibling", () => {
    const observation = parseRolloutObservation({ line: masked({ sibling: { primary: { used_percent: 1 } } }) });

    expect(observation?.evidence?.kind).toBe("window-limit");
  });

  it("reports the nested exhaustion behind an EMPTY sibling slot", () => {
    const observation = parseRolloutObservation({ line: masked({ sibling: { primary: {} } }) });

    expect(observation?.evidence?.kind).toBe("window-limit");
  });

  it("reports the nested exhaustion behind a sibling carrying nothing at all", () => {
    const observation = parseRolloutObservation({ line: masked({ sibling: {} }) });

    expect(observation?.evidence?.kind).toBe("window-limit");
  });

  it("still reads a line healthy when NEITHER position reports exhaustion", () => {
    const line = JSON.stringify({
      payload: {
        info: { rate_limits: { limit_id: "codex", primary: { used_percent: 4 } } },
        rate_limits: { limit_id: "codex", primary: { used_percent: 1 } },
        type: "token_count",
      },
      timestamp: "2026-09-13T00:01:00.000Z",
      type: "event_msg",
    });

    expect(parseRolloutObservation({ line })?.evidence).toBeUndefined();
  });

  it("never parses a line that is not a token_count event at all", () => {
    expect(parseRolloutObservation({ line: '{"auth_mode":"apikey","OPENAI_API_KEY":"sk-synthetic"}' })).toBeUndefined();
  });
});
