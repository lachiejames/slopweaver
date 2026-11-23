/*
 * The bounds a conversation's shape is read within: a mapping past the node bound, a retyped field, a hostile flood
 * of issues, an over-long id and a time no date can hold are each refused by their field, bounded, never quoted back.
 */
import { describe, expect, it } from "vitest";

import { parseExportConversation } from "../../../../../corpus/chatgpt/exportConversation.js";
import { EXPORT_ID_CHARS, UNREPRESENTABLE_TIME_ISSUE } from "../../../../../corpus/chatgpt/exportMessage.js";
import { EXPORT_MAPPING_NODES } from "../../../../../corpus/chatgpt/exportSchema.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { oneMessage } from "./harness.js";

describe("parseExportConversation", () => {
  it("refuses a mapping past the node bound before the schema builds an issue per entry", () => {
    const mapping = Object.fromEntries(
      Array.from({ length: EXPORT_MAPPING_NODES + 1 }, (_, index) => [`n${String(index)}`, null]),
    );
    expect(unwrapErr(parseExportConversation({ value: { id: "c", mapping } }))).toEqual({
      code: "CONVERSATION_SHAPE",
      issueCount: 1,
      issues: ["mapping: more than 50000 nodes, past what one conversation is read at"],
      message: "mapping: more than 50000 nodes, past what one conversation is read at",
    });
  });

  it("refuses a retyped field it reads, by path", () => {
    const refused = unwrapErr(parseExportConversation({ value: { mapping: [] } }));
    expect(refused.code).toBe("CONVERSATION_SHAPE");
    expect(refused.message).toContain("mapping:");
  });

  it("names five issues and counts the rest, each line bounded, however many a hostile mapping raises", () => {
    const longKey = "k".repeat(1000);
    const mapping = Object.fromEntries(
      [longKey, ...Array.from({ length: 99 }, (_, index) => `node-${String(index)}`)].map((key) => [key, 7]),
    );
    const refused = unwrapErr(
      parseExportConversation({ value: { id: "a0000100-0000-4000-8000-000000000109", mapping } }),
    );
    expect(refused.code).toBe("CONVERSATION_SHAPE");
    const shape = refused as Extract<typeof refused, { code: "CONVERSATION_SHAPE" }>;
    expect(shape.issueCount).toBe(100);
    expect(shape.issues.length).toBe(5);
    expect(shape.issues.filter((line) => line.length > 200)).toEqual([]);
    expect(shape.message).toContain("; and 95 more");
  });

  it("refuses an over-long id by its field, so no refusal ever quotes an id the element sized", () => {
    const longId = "A".repeat(EXPORT_ID_CHARS + 1);
    for (const value of [
      { id: longId, mapping: {} },
      { conversation_id: longId, mapping: {} },
      { current_node: longId, id: "c", mapping: {} },
      { id: "c", mapping: { [longId]: { id: "n", message: null, parent: null } } },
      { id: "c", mapping: { n: { id: "n", message: null, parent: longId } } },
    ]) {
      const refused = unwrapErr(parseExportConversation({ value }));
      expect(refused.code).toBe("CONVERSATION_SHAPE");
      expect(refused.message.length).toBeLessThan(1100);
      expect(refused.message).not.toContain(longId);
    }
  });

  it("refuses a time no date can hold by its field, never reading it as absent", () => {
    const base = oneMessage({ content: { content_type: "text", parts: ["hello"] } }) as Record<string, unknown> & {
      mapping: { m: { message: Record<string, unknown> } };
    };
    const message = { ...base.mapping.m.message, create_time: 9_000_000_000_000 };
    const refusals = [
      { ...base, mapping: { ...base.mapping, m: { ...base.mapping.m, message } } },
      { ...base, create_time: 9_000_000_000_000 },
      { ...base, update_time: -9_000_000_000_000 },
    ].map((value) => unwrapErr(parseExportConversation({ value })));
    expect(refusals.map(({ code, message: said }) => [code, said])).toEqual([
      ["CONVERSATION_SHAPE", `mapping.m.message.create_time: ${UNREPRESENTABLE_TIME_ISSUE}`],
      ["CONVERSATION_SHAPE", `create_time: ${UNREPRESENTABLE_TIME_ISSUE}`],
      ["CONVERSATION_SHAPE", `update_time: ${UNREPRESENTABLE_TIME_ISSUE}`],
    ]);
  });

  it("refuses a time past year 9999, whose six-digit ISO year would sort before 2026, and accepts the last second of 9999", () => {
    const base = oneMessage({ content: { content_type: "text", parts: ["hello"] } }) as Record<string, unknown>;
    const past = unwrapErr(parseExportConversation({ value: { ...base, update_time: 253_402_300_800 } }));
    expect([past.code, past.message]).toEqual(["CONVERSATION_SHAPE", `update_time: ${UNREPRESENTABLE_TIME_ISSUE}`]);
    const last = unwrap(parseExportConversation({ value: { ...base, update_time: 253_402_300_799 } }));
    expect(last.updatedIso).toBe("9999-12-31T23:59:59.000Z");
  });
});
