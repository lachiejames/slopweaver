/**
 * The compatibility parser for a pre-H6 `held` queue row — one that predates exact ask identity and so
 * carries only `channel`/`threadTs`, never a `messageTs`. Pure, so every case is a plain call.
 */
import { describe, expect, it } from "vitest";

import {
  parseSchemaOneAskRow,
  type SchemaOneAskRow,
  threadOnlyRecordedAskIdentity,
} from "../../../admit/schemaOneAskRow.js";
import { isRecord } from "../../../lib/parsers.js";

/** `schemaOneRow()`'s own `held` field, narrowed for real rather than cast. */
function heldOf({ value }: { value: Readonly<Record<string, unknown>> }): Record<string, unknown> {
  const held = value["held"];
  if (!isRecord(held)) {
    throw new Error("expected schemaOneRow() to carry a held object");
  }
  return held;
}

/** A well-formed schema-1 held row, as the old writer emitted it — no `messageTs` anywhere. */
function schemaOneRow(over: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, unknown>> {
  return {
    held: {
      askedBy: "U_ASKER",
      channel: "C1",
      code: "E1",
      draft: { kind: "update" },
      question: "what did we decide?",
      reason: "no responder whitelist",
      surface: "channel",
      threadTs: "1.1",
    },
    id: "row-1",
    kind: "held",
    schemaVersion: 1,
    tsIso: "2026-08-01T00:00:00.000Z",
    ...over,
  };
}

describe("parseSchemaOneAskRow", () => {
  it("reads a well-formed schema-1 held row", () => {
    const parsed = parseSchemaOneAskRow({ value: schemaOneRow() });

    expect(parsed).toEqual({
      held: {
        askedBy: "U_ASKER",
        channel: "C1",
        code: "E1",
        draft: { kind: "update" },
        question: "what did we decide?",
        reason: "no responder whitelist",
        surface: "channel",
        threadTs: "1.1",
      },
      id: "row-1",
      kind: "held",
      schemaVersion: 1,
      tsIso: "2026-08-01T00:00:00.000Z",
    } satisfies SchemaOneAskRow);
  });

  it("refuses a row of a different schema version, never coercing it", () => {
    expect(parseSchemaOneAskRow({ value: schemaOneRow({ schemaVersion: 2 }) })).toBeUndefined();
  });

  it("refuses a row of a different kind", () => {
    expect(parseSchemaOneAskRow({ value: schemaOneRow({ kind: "released" }) })).toBeUndefined();
  });

  it("refuses a held body missing a required field", () => {
    const value = schemaOneRow();
    const held = heldOf({ value });
    expect(parseSchemaOneAskRow({ value: { ...value, held: { ...held, askedBy: undefined } } })).toBeUndefined();
  });

  it("refuses a held surface that is neither channel nor dm", () => {
    const value = schemaOneRow();
    const held = heldOf({ value });
    expect(parseSchemaOneAskRow({ value: { ...value, held: { ...held, surface: "mpim" } } })).toBeUndefined();
  });

  it("refuses a non-record value", () => {
    expect(parseSchemaOneAskRow({ value: "not a record" })).toBeUndefined();
  });
});

describe("threadOnlyRecordedAskIdentity", () => {
  it("carries channel and threadTs as a quality: thread-only recorded identity", () => {
    const parsed = parseSchemaOneAskRow({ value: schemaOneRow() });
    expect(threadOnlyRecordedAskIdentity({ held: parsed!.held })).toEqual({
      channel: "C1",
      quality: "thread-only",
      threadTs: "1.1",
    });
  });

  it("never invents a messageTs even when the held record happens to carry one at runtime", () => {
    const value = schemaOneRow();
    const held = heldOf({ value });
    const parsed = parseSchemaOneAskRow({ value: { ...value, held: { ...held, messageTs: "9.9" } } });

    expect(Object.keys(threadOnlyRecordedAskIdentity({ held: parsed!.held }))).not.toContain("messageTs");
  });
});
