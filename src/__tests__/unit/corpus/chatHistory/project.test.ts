/**
 * The one chat-history projection: a record per visible message, private, dated by the message and keyed by
 * conversation and message id so a newer export dedups onto the same records.
 */
import { describe, expect, it } from "vitest";

import { chatHistoryContainer, projectChatConversation } from "../../../../corpus/chatHistory/project.js";
import type { ChatHistoryConversation, ChatHistoryMessage } from "../../../../corpus/chatHistory/types.js";

/** A message with every field set, overridable. */
function message(over: Partial<ChatHistoryMessage> = {}): ChatHistoryMessage {
  return {
    attachments: 0,
    branch: "current",
    createdIso: "2026-09-21T13:33:30.000Z",
    id: "m1",
    modality: "typed",
    model: undefined,
    parentMessageId: undefined,
    role: "user",
    text: "Should we renew the lease? See https://example.invalid/lease",
    turnIndex: 0,
    ...over,
  };
}

/** A conversation around the given messages. */
function conversation(over: Partial<ChatHistoryConversation> = {}): ChatHistoryConversation {
  return {
    createdIso: "2026-09-21T13:33:20.000Z",
    id: "a0000100-0000-4000-8000-000000000109",
    messages: [message()],
    title: "Lease renewal",
    unknownKinds: new Map(),
    updatedIso: "2026-09-21T13:34:20.000Z",
    url: "https://chatgpt.com/c/a0000100-0000-4000-8000-000000000109",
    withheld: 0,
    ...over,
  };
}

describe("projectChatConversation", () => {
  it("projects one private message record, keyed by conversation and message, with its facts in attrs", () => {
    const projected = projectChatConversation({ conversation: conversation(), source: "chatgpt" });
    expect(projected.undated).toBe(0);
    expect(projected.records).toEqual([
      {
        attrs: {
          branch: "current",
          conversationId: "a0000100-0000-4000-8000-000000000109",
          modality: "typed",
          role: "user",
          turnIndex: 0,
        },
        author: "user",
        container: "chatgpt/conversations",
        kind: "message",
        refs: ["https://example.invalid/lease"],
        source: "chatgpt",
        sourceId: "a0000100-0000-4000-8000-000000000109:m1",
        text: "Should we renew the lease? See https://example.invalid/lease",
        title: "Lease renewal",
        tsIso: "2026-09-21T13:33:30.000Z",
        url: "https://chatgpt.com/c/a0000100-0000-4000-8000-000000000109",
        visibility: "private",
      },
    ]);
  });

  it("carries the model, the visible parent and an attachment count only when there is one", () => {
    const reply = message({
      attachments: 2,
      id: "m2",
      model: "gpt-5",
      parentMessageId: "m1",
      role: "assistant",
      turnIndex: 1,
    });
    const record = projectChatConversation({ conversation: conversation({ messages: [reply] }), source: "chatgpt" })
      .records[0]!;
    expect(record.attrs).toEqual({
      attachments: 2,
      branch: "current",
      conversationId: "a0000100-0000-4000-8000-000000000109",
      model: "gpt-5",
      modality: "typed",
      parentMessageId: "m1",
      role: "assistant",
      turnIndex: 1,
    });
  });

  it("projects a message identically however far its conversation's update time has moved", () => {
    const before = projectChatConversation({ conversation: conversation(), source: "chatgpt" }).records;
    const later = conversation({ updatedIso: "2026-10-01T00:00:00.000Z" });
    expect(projectChatConversation({ conversation: later, source: "chatgpt" }).records).toEqual(before);
  });

  it("keeps a long message whole — no cap", () => {
    const long = "word ".repeat(20_000).trim();
    const record = projectChatConversation({
      conversation: conversation({ messages: [message({ text: long })] }),
      source: "chatgpt",
    }).records[0]!;
    expect(record.text.length).toBe(long.length);
  });

  it("dates an untimed message by its conversation, and counts one with neither instant as undated", () => {
    const untimed = message({ createdIso: undefined, id: "m3" });
    const dated = projectChatConversation({ conversation: conversation({ messages: [untimed] }), source: "chatgpt" });
    expect(dated.records[0]!.tsIso).toBe("2026-09-21T13:33:20.000Z");
    const nowhere = projectChatConversation({
      conversation: conversation({ createdIso: undefined, messages: [untimed, message()] }),
      source: "chatgpt",
    });
    expect(nowhere.undated).toBe(1);
    expect(nowhere.records.map((record) => record.sourceId)).toEqual(["a0000100-0000-4000-8000-000000000109:m1"]);
  });

  it("leaves the title off a conversation that has none", () => {
    const record = projectChatConversation({ conversation: conversation({ title: undefined }), source: "chatgpt" })
      .records[0]!;
    expect(Object.keys(record).includes("title")).toBe(false);
  });
});

describe("chatHistoryContainer", () => {
  it("is one bucket per provider", () => {
    expect(chatHistoryContainer({ source: "chatgpt" })).toBe("chatgpt/conversations");
  });
});
