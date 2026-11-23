/** {@link foldTranscriptSpend} — seat kinds, the doubling defence, UTC day buckets and refusal classes. */
import { describe, expect, it } from "vitest";

import { classifySeat, foldTranscriptSpend, refusalClassOf } from "../../../sessions/spendFold.js";

/** One assistant turn line. */
function turn({
  id,
  timestamp,
  model = "claude-opus-5-5",
  output = 10,
}: {
  id: string;
  timestamp: string;
  model?: string;
  output?: number;
}): string {
  return JSON.stringify({
    message: {
      id,
      model,
      usage: { cache_creation_input_tokens: 5, cache_read_input_tokens: 100, input_tokens: 1, output_tokens: output },
    },
    timestamp,
    type: "assistant",
  });
}

/** The opening user line a transcript starts with. */
function opening({ cwd, prompt }: { cwd: string; prompt: string }): string {
  return JSON.stringify({ cwd, message: { content: prompt, role: "user" }, type: "user" });
}

/** A tool result line carrying `text`, errored unless said otherwise. */
function toolResult({ text, isError = true }: { text: string; isError?: boolean }): string {
  return JSON.stringify({
    message: { content: [{ content: text, is_error: isError, tool_use_id: "t1", type: "tool_result" }], role: "user" },
    type: "user",
  });
}

/** One top-level seat in `cwd`, opening on `firstPrompt`, for an install declaring `botHandles`. */
const seatIn = ({
  cwd,
  firstPrompt = "",
  botHandles = [],
}: {
  cwd: string;
  firstPrompt?: string;
  botHandles?: readonly string[];
}): string => classifySeat({ botHandles, cwd, firstPrompt, path: "/p/a.jsonl" });

describe("classifySeat", () => {
  it("reads a subagent off its path before anything else", () => {
    expect(
      classifySeat({
        botHandles: [],
        cwd: "/x/supervisor",
        firstPrompt: "handover start a",
        path: "/p/s/subagents/agent-1.jsonl",
      }),
    ).toBe("subagent");
  });

  it("names each seat kind from its working directory or first prompt", () => {
    expect(seatIn({ cwd: "/w/fresh-supervisor" })).toBe("chair");
    expect(seatIn({ cwd: "/w", firstPrompt: "codex review-fallback prepare" })).toBe("fallback-reviewer");
    expect(seatIn({ cwd: "/w/live-bot-loop-21sep-c" })).toBe("bot");
    expect(seatIn({ cwd: "/w/live-acme-bot-loop-12sep-a" })).toBe("bot");
    expect(seatIn({ cwd: "live-bot-loop-31oct-a" })).toBe("bot");
    expect(seatIn({ cwd: "/w/successor-to-live-acme-bot-loop-7oct-g" })).toBe("bot");
    expect(seatIn({ cwd: "/w/live-acme_ops-bot-loop-31oct-a" })).toBe("bot");
    expect(seatIn({ cwd: "/w/live-Zoë.Ops-bot-loop" })).toBe("bot");
    expect(seatIn({ cwd: "/w/live-acme-bot-loops" })).toBe("other");
    expect(seatIn({ cwd: "/w/alive-bot-loop" })).toBe("other");
    expect(seatIn({ cwd: "/w/not-live-acme-bot-loop-31oct-a" })).toBe("other");
    expect(seatIn({ cwd: "/work/robot-loop" })).toBe("other");
    expect(seatIn({ cwd: "/w", firstPrompt: "then run: slopweaver handover start x" })).toBe("handover-seat");
    expect(seatIn({ cwd: "/w", firstPrompt: "recipe seat for a row" })).toBe("recipe-seat");
    expect(seatIn({ cwd: "/w", firstPrompt: "hello" })).toBe("other");
  });

  it("knows a bot seat by a directory named for one of the install's declared handles, and only then", () => {
    expect(seatIn({ botHandles: ["Acme-Bot"], cwd: "/w/acme-bot" })).toBe("bot");
    expect(seatIn({ botHandles: [], cwd: "/w/acme-bot" })).toBe("other");
    expect(seatIn({ botHandles: ["zoë-bot"], cwd: "/w/acme-bot" })).toBe("other");
    expect(seatIn({ botHandles: [""], cwd: "/w/acme-bot" })).toBe("other");
  });

  it("knows a seat by the automations wording and by the older scheduled-ask wording in older transcripts", () => {
    const seat = ({ firstPrompt }: { firstPrompt: string }): string => seatIn({ cwd: "/w", firstPrompt });
    expect(seat({ firstPrompt: "Run 2 automation(s) that need a session, then close this workspace." })).toBe(
      "recipe-seat",
    );
    expect(seat({ firstPrompt: "Run 2 scheduled ask(s) that need a session, then close this workspace." })).toBe(
      "recipe-seat",
    );
    expect(seat({ firstPrompt: "rename the console's automations page" })).toBe("other");
  });
});

describe("refusalClassOf", () => {
  it("classes a hook refusal by its own wording", () => {
    expect(refusalClassOf({ text: "PreToolUse:Bash hook error: … blocked because it runs a Python interpreter" })).toBe(
      "python",
    );
    expect(refusalClassOf({ text: "PreToolUse:Bash hook error: poll-gate: refused a log read of /tmp/x" })).toBe(
      "poll-gate",
    );
    expect(refusalClassOf({ text: "PreToolUse:Read hook error: something blocked because of a rule" })).toBe("other");
  });

  it("is not a refusal without the hook error prefix, nor a hook error with no refusal wording", () => {
    expect(refusalClassOf({ text: "it runs a Python interpreter" })).toBeUndefined();
    expect(refusalClassOf({ text: "PreToolUse:Bash hook error: hook timed out" })).toBeUndefined();
  });
});

describe("foldTranscriptSpend", () => {
  it("counts a turn written across two lines once, and splits usage by UTC day and model", () => {
    const spend = foldTranscriptSpend({
      lines: [
        opening({ cwd: "/w", prompt: "slopweaver handover start a-doc" }),
        turn({ id: "m1", timestamp: "2026-09-27T23:59:00.000Z" }),
        turn({ id: "m1", timestamp: "2026-09-27T23:59:00.000Z" }),
        turn({ id: "m2", timestamp: "2026-09-28T00:00:01.000Z" }),
        turn({ id: "m3", model: "claude-fable-5-1", timestamp: "2026-09-28T00:00:02.000Z" }),
      ],
      path: "/p/a.jsonl",
    });
    expect(spend.seat).toBe("handover-seat");
    expect(spend.cwd).toBe("/w");
    // Every turn re-read 1 input + 100 cache read + 5 cache creation.
    expect(spend.contextFloor).toBe(106);
    expect(spend.usage.map((entry) => [entry.day, entry.model, entry.totals.turns])).toEqual([
      ["2026-09-27", "claude-opus-5-5", 1],
      ["2026-09-28", "claude-fable-5-1", 1],
      ["2026-09-28", "claude-opus-5-5", 1],
    ]);
    expect(spend.usage[0]!.totals).toEqual({
      cacheCreationTokens: 5,
      cacheReadTokens: 100,
      inputTokens: 1,
      outputTokens: 10,
      turns: 1,
    });
  });

  it("tallies refusals by class and never reads a tool result as usage", () => {
    const spend = foldTranscriptSpend({
      lines: [
        toolResult({ text: 'PreToolUse:Bash hook error: blocked because it runs a Python interpreter "usage"' }),
        toolResult({
          text: "PreToolUse:Bash hook error: blocked because it is a shell script rather than one command",
        }),
        toolResult({ text: "PreToolUse:Bash hook error: blocked because it runs a Python interpreter" }),
        toolResult({ text: "ordinary output" }),
        toolResult({
          isError: false,
          text: "grep hit: PreToolUse:Bash hook error: blocked because it runs a Python interpreter",
        }),
      ],
      path: "/p/a.jsonl",
    });
    expect(spend.refusals).toEqual({
      other: 0,
      "poll-gate": 0,
      python: 2,
      "raw-side-effect": 0,
      "shell-script": 1,
      "whole-tree": 0,
    });
    expect(spend.usage).toEqual([]);
    expect(spend.cwd).toBe("");
    expect(spend.contextFloor).toBeNull();
    expect(spend.unreadable).toBe(0);
  });

  it("counts a usage line with no timestamp as unreadable rather than guessing its day", () => {
    const line = JSON.stringify({
      message: { id: "m9", model: "claude-opus-5-5", usage: { output_tokens: 3 } },
      type: "assistant",
    });
    const spend = foldTranscriptSpend({ lines: [line], path: "/p/a.jsonl" });
    expect(spend.unreadable).toBe(1);
    expect(spend.usage).toEqual([]);
  });
});
