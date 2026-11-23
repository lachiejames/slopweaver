/**
 * Which model a chair's transcript says its seat is on — proved first against a frozen, field-trimmed copy of
 * the REAL transcript that a Fable safeguard fallback reseated on Opus, then arm
 * by arm on small inline transcripts.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { judgeChairTranscript } from "../../../supervisor/chairModel.js";

/** The frozen transcript: assistant model/timestamp/uuid, user timestamp/uuid, and the fallback system record. */
const FIXTURE = readFileSync(
  join(import.meta.dirname, "../../fixtures/supervisor/chair-fallback-a0000023.jsonl"),
  "utf8",
);

/** The fixture's records, one per line. */
const LINES = FIXTURE.split("\n").filter((line) => line.length > 0);

/** Index of the first Opus assistant record in the fixture — the first turn the fallback produced. */
const FIRST_OPUS = LINES.findIndex((line) => line.includes('"claude-opus-4-8"'));

/** One JSONL line for an assistant turn on a model. */
const assistant = ({ model, at }: { model: string; at: string }): string =>
  JSON.stringify({ message: { model }, timestamp: at, type: "assistant" });

/** One JSONL line for a safeguard fallback. */
const fallback = ({ at }: { at: string }): string =>
  JSON.stringify({
    apiRefusalCategory: "cyber",
    fallbackModel: "claude-opus-4-8",
    originalModel: "claude-fable-5-1",
    subtype: "model_refusal_fallback",
    timestamp: at,
    type: "system",
  });

describe("judgeChairTranscript — the real chair", () => {
  it("reads the whole transcript as OFF Fable, naming the 19:23:30Z cyber fallback that put it there", () => {
    const verdict = judgeChairTranscript({ text: FIXTURE });

    expect(verdict.kind).toBe("off-fable");
    expect(verdict).toMatchObject({
      fallback: {
        atIso: "2026-09-15T19:23:30.360Z",
        category: "cyber",
        fallbackModel: "claude-opus-4-8",
        originalModel: "claude-fable-5-1",
      },
      model: "claude-opus-4-8",
    });
  });

  it("reads the same transcript up to the fallback as ON Fable — the gate would have passed every tick before it", () => {
    expect(FIRST_OPUS).toBe(204);

    const verdict = judgeChairTranscript({ text: LINES.slice(0, FIRST_OPUS).join("\n") });

    expect(verdict).toStrictEqual({ atIso: "2026-09-15T19:22:39.770Z", kind: "on-fable", model: "claude-fable-5-1" });
  });

  it("still reads OFF Fable from a tail that begins mid-line, as the 1 MiB tail read does", () => {
    const tail = FIXTURE.slice(Math.floor(FIXTURE.length / 2) + 7);

    expect(judgeChairTranscript({ text: tail })).toMatchObject({ kind: "off-fable", model: "claude-opus-4-8" });
  });
});

describe("judgeChairTranscript — each arm", () => {
  it("is OFF Fable in the instant between a fallback and the first turn it produces", () => {
    const text = [
      assistant({ at: "2026-09-15T19:22:39.770Z", model: "claude-fable-5-1" }),
      fallback({ at: "2026-09-15T19:23:30.360Z" }),
    ].join("\n");

    expect(judgeChairTranscript({ text })).toMatchObject({
      atIso: "2026-09-15T19:23:30.360Z",
      kind: "off-fable",
      model: "claude-opus-4-8",
    });
  });

  it("is ON Fable when Fable turns follow a fallback — the owner restored /model", () => {
    const text = [
      fallback({ at: "2026-09-15T19:23:30.360Z" }),
      assistant({ at: "2026-09-15T19:24:00.000Z", model: "claude-opus-4-8" }),
      assistant({ at: "2026-09-15T21:05:00.000Z", model: "claude-fable-5-1" }),
    ].join("\n");

    expect(judgeChairTranscript({ text })).toStrictEqual({
      atIso: "2026-09-15T21:05:00.000Z",
      kind: "on-fable",
      model: "claude-fable-5-1",
    });
  });

  it("is OFF Fable for a seat spawned on another model with no fallback at all", () => {
    const text = assistant({ at: "2026-09-15T10:00:00.000Z", model: "claude-opus-5" });

    expect(judgeChairTranscript({ text })).toStrictEqual({
      atIso: "2026-09-15T10:00:00.000Z",
      fallback: undefined,
      kind: "off-fable",
      model: "claude-opus-5",
    });
  });

  it("ignores a <synthetic> message, which no model produced", () => {
    const text = [
      assistant({ at: "2026-09-15T10:00:00.000Z", model: "claude-fable-5-1" }),
      assistant({ at: "2026-09-15T10:01:00.000Z", model: "<synthetic>" }),
    ].join("\n");

    expect(judgeChairTranscript({ text })).toMatchObject({ kind: "on-fable", model: "claude-fable-5-1" });
  });

  it("is unreadable when nothing read carries an assistant model", () => {
    expect(judgeChairTranscript({ text: '{"type":"user"}\nnot json' })).toStrictEqual({
      kind: "unreadable",
      why: "no assistant record naming a model was found in what was read",
    });
  });
});
