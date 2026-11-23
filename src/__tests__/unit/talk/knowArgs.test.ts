/**
 * What the four "voice knows what the supervisor knows" verbs accept. The load-bearing case is the history
 * window: the model's schema and the verb's parser read ONE bound, so neither can promise a window the other
 * refuses, and neither runs a read past the console's 20 s tool timeout.
 */
import { describe, expect, it } from "vitest";

import {
  MAX_WORDS_CHARS,
  parseGlossaryArgs,
  parseHistoryArgs,
  parseKnowledgeArgs,
  parseOriginArgs,
} from "../../../cli/commands/talk/knowArgs.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { KNOWLEDGE_MAX_BYTES } from "../../../talk/knowledge.js";
import { HISTORY_MAX_BYTES, MAX_HISTORY_HOURS } from "../../../talk/supervisorHistory.js";
import { TALK_TOOLS } from "../../../talk/talkToolSchemas.js";

describe("parseHistoryArgs", () => {
  it("accepts the widest window the bound allows, and refuses one hour past it", () => {
    expect(unwrap(parseHistoryArgs({ rest: ["--phrase", "atlas", "--hours", String(MAX_HISTORY_HOURS)] })).hours).toBe(
      MAX_HISTORY_HOURS,
    );
    expect(
      unwrapErr(parseHistoryArgs({ rest: ["--phrase", "atlas", "--hours", String(MAX_HISTORY_HOURS + 1)] })),
    ).toEqual([
      `talk history --hours is above 0 and at most ${String(MAX_HISTORY_HOURS)}: the console's history window is the last day`,
    ]);
  });

  it("offers the model exactly the window the verb accepts", () => {
    const tool = TALK_TOOLS.find((row) => row.name === "supervisor_history")!;
    const properties = tool.parameters["properties"] as Record<string, { description: string; maximum?: number }>;
    expect(properties["hours"]!.maximum).toBe(MAX_HISTORY_HOURS);
    // In words too: a transport that reduces the schema can drop `maximum`, and the description survives.
    expect(properties["hours"]!.description).toContain(
      `1 to ${String(MAX_HISTORY_HOURS)}; the verb refuses a wider window`,
    );
    expect(tool.parameters["required"]).toEqual(["phrase"]);
  });

  it("refuses a --now that is not an instant", () => {
    expect(unwrapErr(parseHistoryArgs({ rest: ["--phrase", "atlas", "--now", "yesterday"] }))).toEqual([
      "talk history --now yesterday is not an ISO instant",
    ]);
  });
});

describe("parseOriginArgs", () => {
  it("takes a queue card's ask: key as its slug", () => {
    expect(unwrap(parseOriginArgs({ rest: ["--slug", "ask:atlas-jumpcloud"] })).slug).toBe("atlas-jumpcloud");
  });

  it("refuses a call with no slug", () => {
    expect(unwrapErr(parseOriginArgs({ rest: ["--json"] }))).toEqual(["talk origin needs --slug <board-slug>"]);
  });
});

describe("parseKnowledgeArgs", () => {
  it("refuses a limit past the most one read asks for", () => {
    expect(unwrapErr(parseKnowledgeArgs({ rest: ["--query", "atlas", "--limit", "11"] }))).toEqual([
      "talk knowledge --limit is 1 to 10",
    ]);
  });
});

describe("--max-bytes", () => {
  it("may lower a verb's cap, never lift it past the console's tool cap", () => {
    expect(unwrap(parseHistoryArgs({ rest: ["--phrase", "atlas", "--max-bytes", "8192"] })).maxBytes).toBe(8192);
    expect(unwrapErr(parseHistoryArgs({ rest: ["--phrase", "atlas", "--max-bytes", "1000000"] }))).toEqual([
      `talk history --max-bytes is above 0 and at most ${String(HISTORY_MAX_BYTES)}: the answer must fit the console's tool cap`,
    ]);
    expect(unwrapErr(parseKnowledgeArgs({ rest: ["--query", "atlas", "--max-bytes", "1000000"] }))).toEqual([
      `talk knowledge --max-bytes is above 0 and at most ${String(KNOWLEDGE_MAX_BYTES)}: the answer must fit the console's tool cap`,
    ]);
  });
});

describe("search words", () => {
  it("are refused past the longest a spoken question needs, on every verb that echoes them", () => {
    const long = "x".repeat(MAX_WORDS_CHARS + 1);
    expect(unwrapErr(parseGlossaryArgs({ rest: ["--term", long] }))).toEqual([
      `talk glossary --term is at most ${String(MAX_WORDS_CHARS)} characters: ask in a sentence`,
    ]);
    expect(unwrapErr(parseKnowledgeArgs({ rest: ["--query", long] }))).toEqual([
      `talk knowledge --query is at most ${String(MAX_WORDS_CHARS)} characters: ask in a sentence`,
    ]);
    expect(unwrapErr(parseHistoryArgs({ rest: ["--phrase", long] }))).toEqual([
      `talk history --phrase is at most ${String(MAX_WORDS_CHARS)} characters: ask in a sentence`,
    ]);
    expect(unwrap(parseGlossaryArgs({ rest: ["--term", "x".repeat(MAX_WORDS_CHARS)] })).term).toBe(
      "x".repeat(MAX_WORDS_CHARS),
    );
  });
});
