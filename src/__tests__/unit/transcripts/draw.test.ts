/**
 * The draw fold, over hand-built transcript lines whose token arithmetic is worked out in each comment.
 *
 * The numbers the chair-cost page quotes rest on three properties, and each is asserted exactly here: that a
 * gap's prompt growth is what its results cost, that a cap refusal retried is billed only the rewrite's API calls
 * and the whole prompts they re-read, and that a tick is what a `tick close` receipt named — not `tick open`'s
 * recurring directory number.
 */
import { describe, expect, it } from "vitest";

import { summariseDraw, verbCallsOf } from "../../../transcripts/draw.js";
import { finishReading } from "../../../transcripts/drawFinish.js";
import { drawReading } from "../../../transcripts/drawFold.js";
import { capClassOf, preambleCharsOf, verbHeadOf } from "../../../transcripts/drawShapes.js";

/** One assistant record: an API call reading `prompt` tokens and writing `output`, issuing `tools`. */
function assistant({
  id,
  prompt,
  output,
  tools = [],
}: {
  id: string;
  prompt: number;
  output: number;
  tools?: readonly { id: string; name: string; command?: string }[];
}): string {
  return JSON.stringify({
    message: {
      content: tools.map((tool) => ({
        id: tool.id,
        input: tool.command === undefined ? { file_path: "/x" } : { command: tool.command },
        name: tool.name,
        type: "tool_use",
      })),
      id,
      usage: {
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: prompt,
        input_tokens: 0,
        output_tokens: output,
      },
    },
    type: "assistant",
  });
}

/** One user record carrying a tool result. */
function result({ id, text, isError = false }: { id: string; text: string; isError?: boolean }): string {
  return JSON.stringify({
    message: { content: [{ content: text, is_error: isError, tool_use_id: id, type: "tool_result" }] },
    type: "user",
  });
}

const REFUSED = "shift state is 700 words against a budget of 631 — trim it";

/**
 * A refusal, a rewrite, the retry, then the receipt closing tick 7, then one more call after it.
 *
 * Prompts: m0 1000 (out 50) → m1 1150 (out 30) → m2 1190 (out 20) → m3 1250 (out 10) → m4 1320.
 * Growth per gap is next − previous − previous output: t1 100, t2 10, t3 40, t4 60.
 */
const LAP = [
  assistant({ id: "m0", output: 10, prompt: 1000 }),
  assistant({
    id: "m0",
    output: 50,
    prompt: 1000,
    tools: [{ command: "cd /repo && slopweaver supervisor sweep-prompt --shift-file s", id: "t1", name: "Bash" }],
  }),
  result({ id: "t1", text: REFUSED }),
  assistant({ id: "m1", output: 30, prompt: 1150, tools: [{ id: "t2", name: "Write" }] }),
  result({ id: "t2", text: "wrote" }),
  assistant({
    id: "m2",
    output: 20,
    prompt: 1190,
    tools: [{ command: "slopweaver supervisor sweep-prompt --shift-file s", id: "t3", name: "Bash" }],
  }),
  result({ id: "t3", text: "rendered" }),
  assistant({
    id: "m3",
    output: 10,
    prompt: 1250,
    tools: [{ command: "slopweaver supervisor tick close --handoff h", id: "t4", name: "Bash" }],
  }),
  result({ id: "t4", text: "supervisor tick close: handoff-9351-tick-7 recorded; ok" }),
  assistant({ id: "m4", output: 5, prompt: 1320 }),
];

describe("verbHeadOf", () => {
  it("groups a slopweaver call by noun and verb, past a cd and an env prefix", () => {
    expect(verbHeadOf({ command: "cd /r && SLOPWEAVER_ALLOW_X=1 slopweaver talk unread --json", tool: "Bash" })).toBe(
      "slopweaver talk unread",
    );
  });

  it("goes one word deeper for a nested group", () => {
    expect(verbHeadOf({ command: "slopweaver supervisor tick close --handoff h", tool: "Bash" })).toBe(
      "slopweaver supervisor tick close",
    );
  });

  it("names another command by its first word and a non-Bash call by its tool", () => {
    expect(verbHeadOf({ command: "grep -rn foo src", tool: "Bash" })).toBe("grep");
    expect(verbHeadOf({ command: "", tool: "Read" })).toBe("Read");
  });
});

describe("preambleCharsOf", () => {
  it("counts the stale-seat head line and its indented lines, and nothing after", () => {
    const head = "slopweaver talk unread: this seat is 3 commit(s) behind origin/main";
    const text = [head, "  rebase it", "the answer"].join("\n");
    expect(preambleCharsOf({ text })).toBe(head.length + 1 + "  rebase it".length + 1);
  });

  it("is zero for a result with no advisory", () => {
    expect(preambleCharsOf({ text: "  indented but no head" })).toBe(0);
  });
});

describe("drawReading", () => {
  const reading = drawReading({ lines: LAP });

  it("dedupes a split message to one API call at its largest output", () => {
    expect(reading.apiCalls).toBe(5);
    expect(reading.outputTokens).toBe(50 + 30 + 20 + 10 + 5);
  });

  it("measures each result as its gap's prompt growth", () => {
    expect(reading.calls.map((call) => call.measuredTokens)).toEqual([100, 10, 40, 60]);
  });

  it("labels the calls before a receipt with the tick it named, and the rest tick 0", () => {
    expect(reading.ticks).toEqual([
      { apiCalls: 1, outputTokens: 5, promptTokens: 1320, segment: 1, tick: 0 },
      { apiCalls: 4, outputTokens: 110, promptTokens: 4590, segment: 0, tick: 7 },
    ]);
  });

  it("bills a retried refusal the rewrite's API calls and the whole prompts they read", () => {
    expect(reading.retries).toEqual([
      {
        callsBetween: 1,
        head: "slopweaver supervisor sweep-prompt",
        lapApiCalls: 2,
        lapOutputTokens: 30 + 20,
        lapPromptTokens: 1150 + 1190,
        refusal: REFUSED,
        // read by m1 and the three calls after it
        refusalCarried: 100 * 4,
        refusalMeasured: true,
        refusalReadIndex: 1,
        refusalTokens: 100,
        retried: true,
        tick: 7,
      },
    ]);
  });

  it("does not bill unrelated work between a refusal and its retry", () => {
    const lines = [
      ...LAP.slice(0, 3),
      assistant({
        id: "x1",
        output: 900,
        prompt: 1150,
        tools: [{ command: "slopweaver talk unread", id: "u1", name: "Bash" }],
      }),
      result({ id: "u1", text: "nothing" }),
      ...LAP.slice(3).map((line) => line.replace('"id":"m1"', '"id":"m1b"')),
    ];
    const lap = drawReading({ lines }).retries[0]!;
    expect(lap.lapApiCalls).toBe(2);
    expect(lap.lapOutputTokens).toBe(30 + 20);
  });

  it("never reads a hook refusal as a cap refusal", () => {
    const lines = [
      assistant({
        id: "h0",
        output: 1,
        prompt: 10,
        tools: [{ command: "slopweaver hand post", id: "h1", name: "Bash" }],
      }),
      result({ id: "h1", isError: true, text: `PreToolUse: refused — ${REFUSED}` }),
      assistant({ id: "h2", output: 1, prompt: 30 }),
    ];
    const hooked = drawReading({ lines });
    expect(hooked.calls[0]!.hookRefused).toBe(true);
    expect(hooked.retries).toEqual([]);
  });

  it("measures nothing across a gap whose prompt shrank", () => {
    const lines = [
      assistant({ id: "c0", output: 5, prompt: 5000, tools: [{ id: "r1", name: "Read" }] }),
      result({ id: "r1", text: "body" }),
      assistant({ id: "c1", output: 5, prompt: 800 }),
    ];
    const shrunk = drawReading({ lines });
    expect(shrunk.calls[0]!.measured).toBe(false);
    expect(shrunk.compactionTicks).toEqual([0]);
  });

  it("records no compaction for a prompt that only grew", () => {
    expect(reading.compactionTicks).toEqual([]);
  });
});

/**
 * Every other line shape the walk meets. Prompts: a0 1000 → a1 1100 (growth 100) → compaction → a2 300 → a3 350
 * (growth 50). The first gap's 100 characters split 13 to the Read's array-shaped result, 60 to two hook
 * attachments of 30 and 27 to a todo attachment serialised whole, so each gets exactly its character count.
 */
const SHAPES = [
  'not json {"type":"user"',
  JSON.stringify({ type: "system" }),
  JSON.stringify({ isSidechain: true, message: { id: "side", usage: { input_tokens: 99_999 } }, type: "assistant" }),
  JSON.stringify({
    message: {
      content: [
        { text: "thinking aloud", type: "text" },
        { id: "r0", input: "not an object", name: "Read", type: "tool_use" },
      ],
      id: "a0",
      usage: { cache_read_input_tokens: 1000, output_tokens: 0 },
    },
    type: "assistant",
  }),
  JSON.stringify({
    message: {
      content: [
        { text: "a stray text block", type: "text" },
        {
          content: [{ text: "abcdefghijklm", type: "text" }, { type: "image" }],
          tool_use_id: "r0",
          type: "tool_result",
        },
        { content: "again", tool_use_id: "r0", type: "tool_result" },
        { content: "nobody asked", tool_use_id: "unknown", type: "tool_result" },
      ],
    },
    type: "user",
  }),
  JSON.stringify({ attachment: { content: "x".repeat(30), type: "hook_additional_context" }, type: "attachment" }),
  JSON.stringify({ attachment: { content: "y".repeat(30), type: "hook_additional_context" }, type: "attachment" }),
  // '{"type":"todo","items":[1]}' is 27 characters
  JSON.stringify({ attachment: { type: "todo", items: [1] }, type: "attachment" }),
  JSON.stringify({ attachment: { content: "untyped", type: "" }, type: "attachment" }),
  assistant({ id: "a1", output: 0, prompt: 1100 }),
  JSON.stringify({ isCompactSummary: true, message: { content: "the summary" }, type: "user" }),
  assistant({ id: "a2", output: 0, prompt: 300, tools: [{ id: "r1", name: "Read" }] }),
  result({ id: "r1", text: "" }),
  assistant({ id: "a3", output: 0, prompt: 350 }),
];

describe("drawReading over every other line shape", () => {
  const shaped = drawReading({ lines: SHAPES });

  it("reads only main-thread records, never a torn, foreign or sidechain line", () => {
    expect(shaped.apiCalls).toBe(4);
  });

  it("measures an array-shaped result and an empty one, answering each call once", () => {
    expect(shaped.calls.map((call) => [call.head, call.resultChars, call.measuredTokens])).toEqual([
      ["Read", 13, 13],
      ["Read", 0, 50],
    ]);
    expect(shaped.calls[0]!.inputChars).toBe(0);
  });

  it("splits a gap's growth across its attachments by kind, an untyped one dropped", () => {
    expect(shaped.attachments).toEqual([
      { kind: "hook_additional_context", tick: 0, tokens: 60 },
      { kind: "todo", tick: 0, tokens: 27 },
    ]);
  });

  it("opens an epoch at a compaction summary", () => {
    expect(shaped.compactionTicks).toEqual([0]);
    expect(shaped.laterReads).toEqual([1, 0, 1, 0]);
  });

  it("reports attachments per tick, largest first", () => {
    const summary = summariseDraw({ fromTick: 0, readings: [shaped, shaped], toTick: 0 });
    expect(summary.attachmentsPerTick).toEqual([
      { kind: "hook_additional_context", tokensPerTick: 60 },
      { kind: "todo", tokensPerTick: 27 },
    ]);
    expect(summary.compactions).toBe(2);
  });
});

describe("summariseDraw", () => {
  const summary = summariseDraw({ fromTick: 1, readings: [drawReading({ lines: LAP })], toTick: 100 });

  it("keeps only the ticks in range and reports per tick", () => {
    expect(summary.ticks).toBe(1);
    expect(summary.apiCalls).toBe(4);
    expect(summary.promptTokensPerTick).toBe(4590);
    expect(summary.outputTokensPerTick).toBe(110);
  });

  it("ranks the verbs by carried tokens", () => {
    // only m1–m3 are in tick 7, so m4 (the tail) is no read: sweep-prompt t1 100 × 3 + t3 40 × 1;
    // Write t2 10 × 2; tick close t4 is read by m4 alone, so 0
    expect(summary.verbs.map((row) => [row.head, row.carriedPerTick])).toEqual([
      ["slopweaver supervisor sweep-prompt", 340],
      ["Write", 20],
      ["slopweaver supervisor tick close", 0],
    ]);
  });

  it("totals the laps and groups them by the cap that fired", () => {
    expect(summary.lapApiCalls).toBe(2);
    expect(summary.lapPromptTokens).toBe(2340);
    expect(summary.retriesByCap).toEqual([
      {
        cap: "shift-state word budget",
        heads: ["slopweaver supervisor sweep-prompt"],
        lapApiCalls: 2,
        // the refusal is read by m1–m3 inside tick 7; m4 is the tail, outside the window
        lapCarried: 300,
        lapPromptTokens: 2340,
        lapTokens: 150,
        refusals: 1,
      },
    ]);
  });

  it("folds two refusals of one cap into one group", () => {
    const twice = summariseDraw({
      fromTick: 1,
      readings: [drawReading({ lines: LAP }), drawReading({ lines: LAP })],
      toTick: 100,
    });
    expect(twice.retriesByCap.map((group) => [group.cap, group.refusals, group.lapPromptTokens])).toEqual([
      ["shift-state word budget", 2, 4680],
    ]);
  });

  it("counts each reading that closed no tick as one tick of its own, not one between them", () => {
    // each: one Read whose result grew the prompt by 1100 − 1000 − 0 = 100 tokens, never a `tick close`
    const unclosed = drawReading({
      lines: [
        assistant({ id: "m0", output: 0, prompt: 1000, tools: [{ id: "r0", name: "Read" }] }),
        result({ id: "r0", text: "x" }),
        assistant({ id: "m1", output: 0, prompt: 1100 }),
      ],
    });
    const two = summariseDraw({ fromTick: 0, readings: [unclosed, unclosed], toTick: 100 });
    expect(two.ticks).toBe(2);
    expect(two.resultTokensPerTick).toBe(100);
    expect(two.verbs.map((row) => [row.head, row.callsPerTick])).toEqual([["Read", 1]]);
  });

  it("counts the tail after the last close as a tick of its own when it is kept", () => {
    // LAP: tick 7 is m0–m3, 4590 prompt and 110 output; the tail is m4, 1320 prompt and 0 output
    const withTail = summariseDraw({ fromTick: 0, readings: [drawReading({ lines: LAP })], toTick: 100 });
    expect(withTail.ticks).toBe(2);
    expect(withTail.promptTokensPerTick).toBe((4590 + 1320) / 2);
  });

  it("gives a refusal in a shrunk gap its verb's mean in the lap totals, as the verb table does", () => {
    // x y: the first result grows the prompt 1100 − 1000 − 0 = 100; the refusal's gap shrinks (1100 → 500)
    const xy = { command: "slopweaver x y", name: "Bash" };
    const reading = drawReading({
      lines: [
        assistant({ id: "a0", output: 0, prompt: 1000, tools: [{ ...xy, id: "x1" }] }),
        result({ id: "x1", text: "ok" }),
        assistant({ id: "a1", output: 10, prompt: 1100, tools: [{ ...xy, id: "x2" }] }),
        result({ id: "x2", text: REFUSED }),
        assistant({ id: "a2", output: 20, prompt: 500, tools: [{ ...xy, id: "x3" }] }),
        result({ id: "x3", text: "ok" }),
        // x3 grows it 620 − 500 − 20 = 100 too, so the verb's mean over its two measured results is 100
        assistant({ id: "a3", output: 0, prompt: 620 }),
      ],
    });
    const lapped = summariseDraw({ fromTick: 0, readings: [reading], toTick: 0 });
    // the rewrite is a2 alone (20 output); the refusal stands in at the verb's 100-token mean
    expect(lapped.lapTokens).toBe(20 + 100);
    expect(lapped.retries.map((row) => row.refusalTokens)).toEqual([100]);
  });

  it("gives a hook refusal in a shrunk gap its verb's mean in the hook-refusal total", () => {
    const xy = { command: "slopweaver x y", name: "Bash" };
    const reading = drawReading({
      lines: [
        assistant({ id: "a0", output: 0, prompt: 1000, tools: [{ ...xy, id: "x1" }] }),
        result({ id: "x1", text: "ok" }),
        assistant({ id: "a1", output: 0, prompt: 1100, tools: [{ ...xy, id: "x2" }] }),
        result({ id: "x2", isError: true, text: "PreToolUse: refused" }),
        // the hook refusal's gap shrinks (1100 → 500), so the verb's 100-token mean stands in for it
        assistant({ id: "a2", output: 0, prompt: 500 }),
      ],
    });
    const refused = summariseDraw({ fromTick: 0, readings: [reading], toTick: 0 });
    expect(refused.hookRefusals).toBe(1);
    expect(refused.hookRefusalTokens).toBe(100);
  });

  it("counts no tick for a reading holding nothing in range", () => {
    const outside = summariseDraw({
      fromTick: 1,
      readings: [drawReading({ lines: LAP }), drawReading({ lines: [] })],
      toTick: 100,
    });
    expect(outside.ticks).toBe(1);
  });
});

describe("verbCallsOf", () => {
  it("lists one head's calls with their measured tokens, reads and target", () => {
    const calls = verbCallsOf({
      fromTick: 1,
      head: "slopweaver supervisor sweep-prompt",
      readings: [drawReading({ lines: LAP })],
      toTick: 100,
    });
    expect(calls).toEqual([
      { label: "slopweaver supervisor sweep-prompt --shift-file s", reads: 3, tick: 7, tokens: 100 },
      { label: "slopweaver supervisor sweep-prompt --shift-file s", reads: 1, tick: 7, tokens: 40 },
    ]);
  });

  it("marks a call in a shrunk gap as unmeasured rather than zero", () => {
    const lines = [
      assistant({ id: "c0", output: 5, prompt: 5000, tools: [{ id: "r1", name: "Read" }] }),
      result({ id: "r1", text: "body" }),
      assistant({ id: "c1", output: 5, prompt: 800 }),
    ];
    const calls = verbCallsOf({ fromTick: 0, head: "Read", readings: [drawReading({ lines })], toTick: 0 });
    expect(calls).toEqual([{ label: "/x", reads: 1, tick: 0, tokens: -1 }]);
  });
});

describe("capClassOf", () => {
  it("names each cap the chair's verbs print", () => {
    expect(capClassOf({ refusal: REFUSED })).toBe("shift-state word budget");
    expect(capClassOf({ refusal: 'sentence 3 uses the fleet word "row" — say what happened' })).toBe("fleet word");
    expect(capClassOf({ refusal: "- risk runs 43 words against a cap of 30" })).toBe("fold word cap");
    expect(capClassOf({ refusal: "what is 135 characters and the cap is 120" })).toBe("character cap");
  });
});

describe("a refusal retried only after its tick closed", () => {
  it("is not retried in its tick, and bills nothing from the next one", () => {
    const reading = drawReading({
      lines: [
        assistant({
          id: "m0",
          output: 10,
          prompt: 1000,
          tools: [{ command: "slopweaver supervisor sweep-prompt", id: "s1", name: "Bash" }],
        }),
        result({ id: "s1", text: REFUSED }),
        assistant({
          id: "m1",
          output: 10,
          prompt: 1100,
          tools: [{ command: "slopweaver supervisor tick close", id: "c1", name: "Bash" }],
        }),
        result({ id: "c1", text: "supervisor tick close: h-tick-7 recorded; next" }),
        assistant({
          id: "m2",
          output: 10,
          prompt: 1200,
          tools: [{ command: "slopweaver supervisor sweep-prompt", id: "s2", name: "Bash" }],
        }),
        result({ id: "s2", text: "ok" }),
        assistant({ id: "m3", output: 0, prompt: 1300 }),
      ],
    });
    expect(reading.retries.map((row) => [row.tick, row.retried, row.lapApiCalls, row.lapPromptTokens])).toEqual([
      [7, false, 0, 0],
    ]);
  });

  it("keeps two segments a recurring label names as two ticks, and never pairs a retry across them", () => {
    const close = ({ id, n }: { id: string; n: number }): string =>
      result({ id, text: `supervisor tick close: h-tick-${String(n)} recorded; next` });
    const tickClose = { command: "slopweaver supervisor tick close", name: "Bash" };
    const sweep = { command: "slopweaver supervisor sweep-prompt", name: "Bash" };
    const reading = drawReading({
      lines: [
        assistant({ id: "m0", output: 0, prompt: 1000, tools: [{ ...sweep, id: "s1" }] }),
        result({ id: "s1", text: REFUSED }),
        assistant({ id: "m1", output: 0, prompt: 1100, tools: [{ ...tickClose, id: "c1" }] }),
        close({ id: "c1", n: 7 }),
        assistant({ id: "m2", output: 0, prompt: 1200, tools: [{ id: "w1", name: "Write" }] }),
        result({ id: "w1", text: "wrote" }),
        assistant({ id: "m3", output: 0, prompt: 1300, tools: [{ ...tickClose, id: "c2" }] }),
        close({ id: "c2", n: 8 }),
        assistant({ id: "m4", output: 0, prompt: 1400, tools: [{ ...sweep, id: "s2" }] }),
        result({ id: "s2", text: "ok" }),
        assistant({ id: "m5", output: 0, prompt: 1500, tools: [{ ...tickClose, id: "c3" }] }),
        close({ id: "c3", n: 7 }),
        assistant({ id: "m6", output: 0, prompt: 1600 }),
      ],
    });
    expect(summariseDraw({ fromTick: 7, readings: [reading], toTick: 7 }).ticks).toBe(2);
    expect(reading.retries.map((row) => [row.retried, row.lapApiCalls])).toEqual([[false, 0]]);
  });
});

describe("finishReading", () => {
  it("relabels each segment to the tick its close named, an unclosed one to 0, and counts reads per epoch", () => {
    const reading = finishReading({
      state: {
        apiCalls: [
          { messageId: "a", outputTokens: 1, promptTokens: 10, segment: 0, tick: 0 },
          { messageId: "b", outputTokens: 2, promptTokens: 20, segment: 1, tick: 1 },
          { messageId: "c", outputTokens: 3, promptTokens: 5, segment: 1, tick: 1 },
        ],
        attachments: [],
        byMessage: new Map(),
        byToolUse: new Map(),
        calls: [],
        // call 2 opened a new epoch, so call 0 is read again by call 1 only and call 2 by nobody
        epochStarts: [0, 2],
        labels: new Map([[0, 7]]),
        pending: [],
        pendingAttachments: new Map(),
        segment: 1,
      },
    });
    expect(reading.ticks).toEqual([
      { apiCalls: 2, outputTokens: 5, promptTokens: 25, segment: 1, tick: 0 },
      { apiCalls: 1, outputTokens: 1, promptTokens: 10, segment: 0, tick: 7 },
    ]);
    expect(reading.laterReads).toEqual([1, 0, 0]);
    expect(reading.compactionTicks).toEqual([0]);
  });
});
