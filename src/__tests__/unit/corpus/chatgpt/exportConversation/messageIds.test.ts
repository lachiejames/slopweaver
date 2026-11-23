/*
 * How a visible message is identified: by the id its own record carries, never the mapping key, so two visible
 * messages sharing one id are refused, an empty id is refused, and an id exactly at the bound is kept.
 */
import { describe, expect, it } from "vitest";

import { parseExportConversation } from "../../../../../corpus/chatgpt/exportConversation.js";
import { EXPORT_ID_CHARS } from "../../../../../corpus/chatgpt/exportMessage.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { oneMessage } from "./harness.js";

describe("parseExportConversation", () => {
  it("refuses two visible messages sharing one id, rather than letting the store keep one of them", () => {
    const visible = ({ text }: { text: string }) => ({
      author: { role: "user" },
      content: { content_type: "text", parts: [text] },
      create_time: 1790000001,
      id: "same-message-id",
      recipient: "all",
    });
    const value = {
      current_node: "n2",
      id: "a0000100-0000-4000-8000-000000000111",
      mapping: {
        n1: { id: "n1", message: visible({ text: "first" }), parent: "root" },
        n2: { id: "n2", message: visible({ text: "second" }), parent: "root" },
        root: { id: "root", message: null, parent: null },
      },
    };
    expect(unwrapErr(parseExportConversation({ value }))).toEqual({
      code: "CONVERSATION_DUPLICATE_MESSAGE",
      conversationId: "a0000100-0000-4000-8000-000000000111",
      message:
        "a0000100-0000-4000-8000-000000000111: two visible messages carry the id same-message-id, and the store would keep only one",
      messageId: "same-message-id",
    });
  });

  it("names a reply's parent by the message id its record carries, never the mapping key, across a hidden node", () => {
    const said = ({ role, text, id }: { role: string; text: string; id: string }) => ({
      author: { role },
      content: { content_type: "text", parts: [text] },
      create_time: 1790000001,
      id,
      recipient: "all",
    });
    const hidden = {
      author: { role: "system" },
      content: { content_type: "text", parts: ["context"] },
      id: "msg-hidden",
      metadata: { is_visually_hidden_from_conversation: true },
    };
    const value = {
      current_node: "node-answer",
      id: "6f1c2a9e-3b4d-4e5f-8a7b-1c2d3e4f5add",
      mapping: {
        "node-answer": {
          id: "node-answer",
          message: said({ id: "msg-answer", role: "assistant", text: "answer" }),
          parent: "node-hidden",
        },
        "node-hidden": { id: "node-hidden", message: hidden, parent: "node-question" },
        "node-question": {
          id: "node-question",
          message: said({ id: "msg-question", role: "user", text: "question" }),
          parent: "root",
        },
        root: { id: "root", message: null, parent: null },
      },
    };
    const conversation = unwrap(parseExportConversation({ value }));
    expect(conversation.messages.map(({ id, parentMessageId, turnIndex }) => [id, parentMessageId, turnIndex])).toEqual(
      [
        ["msg-question", undefined, 0],
        ["msg-answer", "msg-question", 1],
      ],
    );
    expect(conversation.withheld).toBe(1);
  });

  it("accepts a message id exactly at the bound", () => {
    const atBound = "A".repeat(EXPORT_ID_CHARS);
    const value = oneMessage({ content: { content_type: "text", parts: ["hello"] } }) as {
      mapping: { m: { message: { id: string } } };
    };
    value.mapping.m.message.id = atBound;
    expect(unwrap(parseExportConversation({ value })).messages.map(({ id }) => id)).toEqual([atBound]);
  });

  it("refuses an empty node or message id, which would collapse two of them into one", () => {
    const emptyMessage = oneMessage({ content: { content_type: "text", parts: ["hello"] } }) as {
      mapping: { m: { message: { id: string } } };
    };
    emptyMessage.mapping.m.message.id = "";
    expect(unwrapErr(parseExportConversation({ value: emptyMessage })).message).toContain("mapping.m.message.id:");
  });
});
