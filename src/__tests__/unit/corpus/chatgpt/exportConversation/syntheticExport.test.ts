/*
 * The committed SYNTHETIC export read into the provider-neutral shape: which messages the owner saw, on which branch, at
 * which turn, what was withheld, and the live read every projected record plans.
 */
import { describe, expect, it } from "vitest";

import { parseExportConversation } from "../../../../../corpus/chatgpt/exportConversation.js";
import { projectChatConversation } from "../../../../../corpus/chatHistory/project.js";
import { unwrap } from "../../../../../lib/result.js";
import { recordReadPlan } from "../../../../../live/recordReadPlan.js";
import { fixtureConversation } from "./harness.js";

describe("parseExportConversation", () => {
  it("keeps every visible message on both branches, current first, with its turn and visible parent", () => {
    const conversation = unwrap(
      parseExportConversation({ value: fixtureConversation({ file: "conversations-000.json", index: 0 }) }),
    );
    expect(conversation.id).toBe("a0000100-0000-4000-8000-000000000107");
    expect(conversation.title).toBe("Tomatoes for a Melbourne garden");
    expect(conversation.url).toBe("https://chatgpt.com/c/a0000100-0000-4000-8000-000000000107");
    expect(
      conversation.messages.map((message) => [message.id, message.branch, message.turnIndex, message.parentMessageId]),
    ).toEqual([
      ["a-u1", "current", 0, undefined],
      ["a-r1", "current", 1, "a-u1"],
      ["a-u2", "current", 2, "a-r1"],
      ["a-r2", "current", 3, "a-u2"],
      ["a-r1-old", "alternate", 1, "a-u1"],
    ]);
    // The hidden system turn is withheld and counted; the root carries no message and is not.
    expect(conversation.withheld).toBe(1);
    expect([...conversation.unknownKinds]).toEqual([]);
  });

  it("reads a voice exchange as its transcription, marked voice, and names the assistant's model", () => {
    const conversation = unwrap(
      parseExportConversation({ value: fixtureConversation({ file: "conversations-000.json", index: 0 }) }),
    );
    const spoken = conversation.messages.find((message) => message.id === "a-u2")!;
    expect(spoken.text).toBe("And how often should I water them in summer?");
    expect(spoken.modality).toBe("voice");
    expect(spoken.model).toBe(undefined);
    expect(spoken.attachments).toBe(0);
    const reply = conversation.messages.find((message) => message.id === "a-r2")!;
    expect(reply.modality).toBe("voice");
    expect(reply.model).toBe("gpt-5");
    // The fixture's `create_time` 1790000310, in epoch seconds.
    expect(reply.createdIso).toBe("2026-09-21T14:18:30.000Z");
  });

  it("withholds hidden context, tool calls, tool output and thoughts, and fences a code block written to the owner", () => {
    const conversation = unwrap(
      parseExportConversation({ value: fixtureConversation({ file: "conversations-000.json", index: 1 }) }),
    );
    expect(conversation.withheld).toBe(4);
    expect(conversation.messages.map((message) => message.id)).toEqual(["b-u1", "b-r1", "b-r2"]);
    const question = conversation.messages[0]!;
    expect(question.text).toBe("Here is a screenshot of the CSV. How do I parse it in TypeScript? See #42.");
    expect(question.attachments).toBe(1);
    const code = conversation.messages[1]!;
    expect(code.text).toBe('```typescript\nconst rows = text.split("\\n").map((line) => line.split(","));\n```');
    // A hidden turn between two visible ones shifts neither the depth nor the visible parent.
    expect(code.turnIndex).toBe(1);
    expect(code.parentMessageId).toBe("b-u1");
  });

  it("plans a live read for every record an export conversation projects", () => {
    const conversation = unwrap(
      parseExportConversation({ value: fixtureConversation({ file: "conversations-001.json", index: 0 }) }),
    );
    const { records } = projectChatConversation({ conversation, source: "chatgpt" });
    expect(records.length).toBeGreaterThan(0);
    expect(records.filter((record) => recordReadPlan({ record }).kind !== "supported")).toEqual([]);
    expect(recordReadPlan({ record: records[0]! })).toEqual({
      command: ["slopweaver", "chatgpt", "conversation", "a0000100-0000-4000-8000-000000000109"],
      kind: "supported",
    });
  });
});
