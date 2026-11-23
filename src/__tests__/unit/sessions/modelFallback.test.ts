/**
 * The model-agnostic safeguard-fallback reader, proved first against a frozen, field-trimmed copy of the REAL
 * transcript — the Opus 5 seat a `cyber` fallback dropped to Opus 4.8, which the
 * Fable-only chair gate cannot see — then arm by arm on small inline transcripts.
 *
 * The fixture is the reason this file exists rather than a widened chair test: its fallback record sits at
 * LINE 32 of the real file's 3,691, which is what rules out every tail-based reader.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  EMPTY_SEAT_FALLBACK_FOLD,
  foldSeatFallbackLine,
  judgeSeatFallback,
  readAssistantModelLine,
  readModelFallbackLine,
  seatFallbackVerdict,
} from "../../../sessions/modelFallback.js";

/** The frozen head of the real transcript: 140 lines, the fallback at line 32, 30 Opus 4.8 turns after it. */
const FIXTURE_LINES = readFileSync(
  join(import.meta.dirname, "../../fixtures/sessions/seat-fallback-29b955c3.jsonl"),
  "utf8",
)
  .split("\n")
  .filter((line) => line.length > 0);

/** One JSONL line for an assistant turn on a model. */
const assistant = ({ model }: { model: string }): string =>
  JSON.stringify({ message: { model }, timestamp: "2026-09-15T12:00:00.000Z", type: "assistant" });

/** One JSONL line for a safeguard fallback. */
const fallback = ({ from, to, at }: { from: string; to: string; at: string }): string =>
  JSON.stringify({
    apiRefusalCategory: "cyber",
    fallbackModel: to,
    originalModel: from,
    scope: "session",
    subtype: "model_refusal_fallback",
    timestamp: at,
    type: "system",
  });

describe("judgeSeatFallback — the real 29b955c3 seat", () => {
  it("reads the whole frozen head as DEMOTED, naming the 12:03:00Z cyber switch off Opus 5", () => {
    const verdict = judgeSeatFallback({ lines: FIXTURE_LINES });

    expect(verdict.kind).toBe("demoted");
    const demoted = verdict as Extract<typeof verdict, { kind: "demoted" }>;
    expect(demoted.fallback.originalModel).toBe("claude-opus-5");
    expect(demoted.fallback.fallbackModel).toBe("claude-opus-4-8");
    expect(demoted.fallback.atIso).toBe("2026-09-15T12:03:00.259Z");
    expect(demoted.fallback.category).toBe("cyber");
  });

  it("carries the fallback record well past any tail a reader would have taken", () => {
    const at = FIXTURE_LINES.findIndex((line) => line.includes("model_refusal_fallback"));

    expect(at).toBe(31);
    expect(FIXTURE_LINES.length).toBe(140);
    expect(FIXTURE_LINES.filter((line) => readAssistantModelLine({ line }) === "claude-opus-4-8").length).toBe(30);
  });

  it("reports the seat as restored once one later turn runs on the original model again", () => {
    const verdict = judgeSeatFallback({ lines: [...FIXTURE_LINES, assistant({ model: "claude-opus-5" })] });

    expect(verdict.kind).toBe("restored");
    const restored = verdict as Extract<typeof verdict, { kind: "restored" }>;
    expect(restored.model).toBe("claude-opus-5");
    expect(restored.fallback.atIso).toBe("2026-09-15T12:03:00.259Z");
  });
});

describe("judgeSeatFallback — each arm", () => {
  it("reports none when no fallback record was read at all", () => {
    const verdict = judgeSeatFallback({ lines: [assistant({ model: "claude-opus-5" })] });

    expect(verdict.kind).toBe("none");
  });

  it("ignores a turn that ran BEFORE the fallback, so an earlier original-model turn is not a restore", () => {
    const verdict = judgeSeatFallback({
      lines: [
        assistant({ model: "claude-fable-5-1" }),
        fallback({ at: "2026-09-15T19:23:30.360Z", from: "claude-fable-5-1", to: "claude-opus-4-8" }),
        assistant({ model: "claude-opus-4-8" }),
      ],
    });

    expect(verdict.kind).toBe("demoted");
  });

  it("gives a SECOND fallback its own fresh judgement, discarding the first one's restore", () => {
    const verdict = judgeSeatFallback({
      lines: [
        fallback({ at: "2026-09-15T12:03:00.259Z", from: "claude-opus-5", to: "claude-opus-4-8" }),
        assistant({ model: "claude-opus-5" }),
        fallback({ at: "2026-09-16T21:59:32.000Z", from: "claude-opus-5", to: "claude-opus-4-8" }),
        assistant({ model: "claude-opus-4-8" }),
      ],
    });

    expect(verdict.kind).toBe("demoted");
    const demoted = verdict as Extract<typeof verdict, { kind: "demoted" }>;
    expect(demoted.fallback.atIso).toBe("2026-09-16T21:59:32.000Z");
  });

  it("skips a fragment line rather than failing over it", () => {
    const verdict = judgeSeatFallback({
      lines: [
        '{"message":{"model":"claude-opu',
        fallback({ at: "2026-09-15T12:03:00.259Z", from: "claude-opus-5", to: "claude-opus-4-8" }),
        assistant({ model: "claude-opus-4-8" }),
      ],
    });

    expect(verdict.kind).toBe("demoted");
  });

  it("reads an empty transcript as none rather than as demoted", () => {
    expect(judgeSeatFallback({ lines: [] }).kind).toBe("none");
  });
});

describe("readModelFallbackLine", () => {
  it("reads every field the record states", () => {
    const record = readModelFallbackLine({
      line: fallback({ at: "2026-09-15T12:03:00.259Z", from: "claude-opus-5", to: "claude-opus-4-8" }),
    })!;

    expect(record.originalModel).toBe("claude-opus-5");
    expect(record.fallbackModel).toBe("claude-opus-4-8");
    expect(record.category).toBe("cyber");
    expect(record.atIso).toBe("2026-09-15T12:03:00.259Z");
  });

  it("reports an unnamed category as the empty string rather than inventing one", () => {
    const record = readModelFallbackLine({
      line: JSON.stringify({
        fallbackModel: "claude-opus-4-8",
        originalModel: "claude-opus-5",
        subtype: "model_refusal_fallback",
        timestamp: "2026-09-15T12:03:00.259Z",
        type: "system",
      }),
    })!;

    expect(record.category).toBe("");
  });

  it("refuses a line that merely MENTIONS the subtype without being the record", () => {
    const mention = JSON.stringify({ text: "a model_refusal_fallback fired earlier", type: "user" });

    expect(readModelFallbackLine({ line: mention })).toBe(undefined);
  });

  it("refuses an assistant line", () => {
    expect(readModelFallbackLine({ line: assistant({ model: "claude-opus-5" }) })).toBe(undefined);
  });
});

describe("readAssistantModelLine", () => {
  it("reads the model off an assistant record", () => {
    expect(readAssistantModelLine({ line: assistant({ model: "claude-fable-5-1" }) })).toBe("claude-fable-5-1");
  });

  it("refuses Claude Code's own synthetic marker, which says nothing about the seat", () => {
    expect(readAssistantModelLine({ line: assistant({ model: "<synthetic>" }) })).toBe(undefined);
  });

  it("refuses a user record", () => {
    const user = JSON.stringify({ timestamp: "2026-09-15T12:00:00.000Z", type: "user" });

    expect(readAssistantModelLine({ line: user })).toBe(undefined);
  });
});

describe("the streaming fold", () => {
  it("reaches the same verdict a whole-transcript read does, one line at a time", () => {
    let fold = EMPTY_SEAT_FALLBACK_FOLD;
    for (const line of FIXTURE_LINES) {
      fold = foldSeatFallbackLine({ fold, line });
    }

    expect(seatFallbackVerdict({ fold })).toEqual(judgeSeatFallback({ lines: FIXTURE_LINES }));
  });

  it("holds nothing about a seat no fallback has touched", () => {
    const fold = foldSeatFallbackLine({ fold: EMPTY_SEAT_FALLBACK_FOLD, line: assistant({ model: "claude-opus-5" }) });

    expect(fold).toEqual(EMPTY_SEAT_FALLBACK_FOLD);
  });
});
