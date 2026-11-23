/*
 * Which conversation an export entry is: `conversation_id` stands in for a missing `id`, an entry with neither or with
 * an id the live read would not accept is refused by its field, and two ids naming different conversations conflict.
 */
import { describe, expect, it } from "vitest";

import { parseExportConversation } from "../../../../../corpus/chatgpt/exportConversation.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { fixtureConversation } from "./harness.js";

describe("parseExportConversation", () => {
  it("falls back to conversation_id when the export carries no id", () => {
    const value = { ...(fixtureConversation({ file: "conversations-001.json", index: 0 }) as Record<string, unknown>) };
    delete value["id"];
    value["conversation_id"] = "6f1c2a9e-3b4d-4e5f-8a7b-1c2d3e4f5a09";
    expect(unwrap(parseExportConversation({ value })).id).toBe("6f1c2a9e-3b4d-4e5f-8a7b-1c2d3e4f5a09");
  });

  it("refuses a conversation with neither id, naming both keys", () => {
    const value = { ...(fixtureConversation({ file: "conversations-001.json", index: 0 }) as Record<string, unknown>) };
    delete value["id"];
    expect(unwrapErr(parseExportConversation({ value }))).toEqual({
      code: "CONVERSATION_UNIDENTIFIED",
      message: "(conversation): carries neither `id` nor `conversation_id`",
    });
  });

  it("refuses a conversation id the live read would not accept, an empty one included, by its field", () => {
    const base = fixtureConversation({ file: "conversations-001.json", index: 0 }) as Record<string, unknown>;
    const refusals = [
      { ...base, id: "" },
      { ...base, id: "new-provider-id" },
      { ...base, conversation_id: "NOT-A-UUID", id: undefined },
    ].map((value) => unwrapErr(parseExportConversation({ value })));
    expect(refusals.map(({ code, message }) => [code, message])).toEqual([
      [
        "CONVERSATION_SHAPE",
        "id: Too small: expected string to have >=1 characters; id: not a conversation id the live read accepts",
      ],
      ["CONVERSATION_SHAPE", "id: not a conversation id the live read accepts"],
      ["CONVERSATION_SHAPE", "conversation_id: not a conversation id the live read accepts"],
    ]);
  });

  it("refuses an id and a conversation_id naming two different conversations, and takes them when they agree", () => {
    const base = fixtureConversation({ file: "conversations-001.json", index: 0 }) as Record<string, unknown>;
    const other = "6f1c2a9e-3b4d-4e5f-8a7b-1c2d3e4f5a99";
    expect(unwrapErr(parseExportConversation({ value: { ...base, conversation_id: other } }))).toEqual({
      code: "CONVERSATION_ID_CONFLICT",
      conversationId: "a0000100-0000-4000-8000-000000000109",
      message:
        "a0000100-0000-4000-8000-000000000109: carries `id` a0000100-0000-4000-8000-000000000109 and " +
        "`conversation_id` 6f1c2a9e-3b4d-4e5f-8a7b-1c2d3e4f5a99, which name two different conversations",
      otherId: other,
    });
    const agreeing = { ...base, conversation_id: base["id"] };
    expect(unwrap(parseExportConversation({ value: agreeing })).id).toBe("a0000100-0000-4000-8000-000000000109");
  });
});
