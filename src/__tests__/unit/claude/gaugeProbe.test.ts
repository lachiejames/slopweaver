import { describe, expect, it } from "vitest";

import {
  BASICALLY_ZERO_TOKENS,
  headerRecord,
  PROBE_URL,
  probeBody,
  probeCostIsBasicallyZero,
  probeCostTokens,
  probeHeaders,
  readProbeCost,
} from "../../../claude/gaugeProbe.js";
import { parseClaudeGauge } from "../../../claude/usage.js";
import { unwrap } from "../../../lib/result.js";

describe("probeHeaders", () => {
  it("carries the OAuth token as a bearer credential", () => {
    expect(probeHeaders({ accessToken: "TOKEN" })["authorization"]).toBe("Bearer TOKEN");
  });

  it("declares both betas a subscription credential needs", () => {
    expect(probeHeaders({ accessToken: "T" })["anthropic-beta"]).toBe("oauth-2025-04-20,claude-code-20250219");
  });

  it("identifies as the CLI, which is what the credential is issued for", () => {
    expect(probeHeaders({ accessToken: "T" })["x-app"]).toBe("cli");
  });
});

describe("probeBody", () => {
  it("asks for exactly one output token, so a gauge read costs nothing that matters", () => {
    expect(JSON.parse(probeBody())["max_tokens"]).toBe(1);
  });

  it("carries Claude Code's own system prompt, without which a subscription credential is refused", () => {
    const system = JSON.parse(probeBody())["system"] as { text: string }[];
    expect(system[0]?.text).toBe("You are Claude Code, Anthropic's official CLI for Claude.");
  });

  it("names a FABLE model, which is what makes the provider attach the Fable-only week", () => {
    // Not the cheapest model, which is what this used to assert. MEASURED: only a request naming
    // a Fable model comes back with the `anthropic-ratelimit-unified-7d_oi-*` trio, so a Haiku probe is a
    // gauge that cannot see the budget half the routing decisions turn on.
    expect(JSON.parse(probeBody())["model"]).toBe("claude-fable-5-1");
  });
});

describe("PROBE_URL", () => {
  it("is the ordinary messages endpoint, which is what makes the gauge headers appear", () => {
    expect(PROBE_URL).toBe("https://api.anthropic.com/v1/messages?beta=true");
  });

  it("is not the usage endpoint, which is throttled to roughly one call an hour", () => {
    expect(PROBE_URL).not.toContain("/api/oauth/usage");
  });
});

describe("headerRecord", () => {
  it("lower-cases every name, so a parse is not casing-dependent", () => {
    const headers = new Headers({ "ANTHROPIC-RateLimit-Unified-5h-Status": "allowed" });
    expect(headerRecord({ headers })["anthropic-ratelimit-unified-5h-status"]).toBe("allowed");
  });

  it("feeds the gauge parser end to end, from a real Headers object to a typed reading", () => {
    const headers = new Headers({
      "anthropic-ratelimit-unified-5h-reset": "1788459000",
      "anthropic-ratelimit-unified-5h-status": "allowed",
      "anthropic-ratelimit-unified-5h-utilization": "0.34",
      "anthropic-ratelimit-unified-7d-reset": "1788645600",
      "anthropic-ratelimit-unified-7d-status": "allowed_warning",
      "anthropic-ratelimit-unified-7d-utilization": "0.91",
    });
    const gauge = unwrap(
      parseClaudeGauge({
        alias: "plan-one",
        headers: headerRecord({ headers }),
        observedAtIso: "2026-09-04T00:00:00.000Z",
      }),
    );
    expect(gauge.fiveHour!.utilization).toBe(0.34);
    expect(gauge.sevenDay.status).toBe("allowed_warning");
    expect(gauge.sevenDay.resetAtIso).toBe("2026-09-05T22:00:00.000Z");
  });
});

describe("readProbeCost", () => {
  it("reads the input and output counters a message response carries", () => {
    const text = JSON.stringify({
      content: [{ text: "Hi", type: "text" }],
      usage: { input_tokens: 22, output_tokens: 1 },
    });
    expect(readProbeCost({ text })).toStrictEqual({ inputTokens: 22, outputTokens: 1 });
  });

  it("counts cache creation and cache reads as input, because the provider bills them as input", () => {
    const usage = { cache_creation_input_tokens: 5, cache_read_input_tokens: 7, input_tokens: 22, output_tokens: 1 };
    expect(readProbeCost({ text: JSON.stringify({ usage }) })).toStrictEqual({ inputTokens: 34, outputTokens: 1 });
  });

  it("carries only the counters, never the model's content", () => {
    const text = JSON.stringify({ content: "a reply", usage: { input_tokens: 3, output_tokens: 1 } });
    expect(readProbeCost({ text })).toStrictEqual({ inputTokens: 3, outputTokens: 1 });
  });

  it.each([
    ["malformed JSON", "{not json"],
    ["an error body", JSON.stringify({ error: { message: "rate limited", type: "rate_limit_error" }, type: "error" })],
    ["a body with no usage", JSON.stringify({ content: [] })],
    ["a missing output counter", JSON.stringify({ usage: { input_tokens: 22 } })],
    ["a negative counter", JSON.stringify({ usage: { input_tokens: -1, output_tokens: 1 } })],
    ["a fractional counter", JSON.stringify({ usage: { input_tokens: 2.5, output_tokens: 1 } })],
    ["a counter sent as text", JSON.stringify({ usage: { input_tokens: "22", output_tokens: 1 } })],
    [
      "a present but malformed cache counter",
      JSON.stringify({ usage: { cache_read_input_tokens: null, input_tokens: 22, output_tokens: 1 } }),
    ],
  ])("answers UNMEASURED for %s, never zero", (_case, text) => {
    expect(readProbeCost({ text })).toBeUndefined();
  });
});

describe("probeCostIsBasicallyZero", () => {
  it("holds the owner's ceiling at a hundred tokens", () => {
    expect(BASICALLY_ZERO_TOKENS).toBe(100);
  });

  it("is strictly UNDER the ceiling: 99 is basically zero, 100 and 101 are not", () => {
    const verdicts = [98, 99, 100].map((inputTokens) =>
      probeCostIsBasicallyZero({ cost: { inputTokens, outputTokens: 1 } }),
    );
    expect(verdicts).toStrictEqual([true, false, false]);
  });

  it("sums input and output into one total", () => {
    expect(probeCostTokens({ cost: { inputTokens: 22, outputTokens: 1 } })).toBe(23);
  });
});
