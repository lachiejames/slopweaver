/*
 * Who a message is from and to: a turn addressed to a recipient the reader does not know, or written under an author
 * role it has never seen, is reported rather than read or withheld, while a known working turn is withheld.
 */
import { describe, expect, it } from "vitest";

import { parseExportConversation } from "../../../../../corpus/chatgpt/exportConversation.js";
import { unwrap } from "../../../../../lib/result.js";
import { oneMessage } from "./harness.js";

describe("parseExportConversation", () => {
  it("reports a user turn addressed anywhere but all, and keeps one addressed to all", () => {
    const userTurn = ({
      recipient,
      content = { content_type: "text", parts: ["hello"] },
    }: {
      recipient: string;
      content?: Record<string, unknown>;
    }): unknown => ({
      create_time: 1790000000,
      current_node: "m",
      id: "6f1c2a9e-3b4d-4e5f-8a7b-1c2d3e4f5aff",
      mapping: {
        m: {
          id: "m",
          message: {
            author: { role: "user" },
            content,
            create_time: 1790000001,
            id: "m",
            recipient,
          },
          parent: "root",
        },
        root: { id: "root", message: null, parent: null },
      },
    });
    const read = ["hostile.new_recipient", "all"].map((recipient) =>
      unwrap(parseExportConversation({ value: userTurn({ recipient }) })),
    );
    expect(read.map((one) => [...one.unknownKinds])).toEqual([[["recipient hostile.new_recipient", 1]], []]);
    expect(read.map((one) => one.messages.length)).toEqual([0, 1]);
    // A working content kind does not withhold a user turn before its recipient is read.
    const thoughts = unwrap(
      parseExportConversation({
        value: userTurn({ content: { content_type: "thoughts" }, recipient: "hostile.new_recipient" }),
      }),
    );
    expect([...thoughts.unknownKinds]).toEqual([["recipient hostile.new_recipient", 1]]);
  });

  it("reports an assistant turn to an unknown recipient though its content is a working kind, and withholds one to all", () => {
    const thinking = ({ recipient }: { recipient: string }): unknown => ({
      create_time: 1790000000,
      current_node: "m",
      id: "6f1c2a9e-3b4d-4e5f-8a7b-1c2d3e4f5aff",
      mapping: {
        m: {
          id: "m",
          message: {
            author: { role: "assistant" },
            content: { content_type: "thoughts", parts: ["payload"] },
            create_time: 1790000001,
            id: "m",
            recipient,
          },
          parent: "root",
        },
        root: { id: "root", message: null, parent: null },
      },
    });
    const read = ["future.route", "all"].map((recipient) =>
      unwrap(parseExportConversation({ value: thinking({ recipient }) })),
    );
    expect(read.map((one) => [...one.unknownKinds])).toEqual([[["recipient future.route", 1]], []]);
    expect(read.map((one) => one.withheld)).toEqual([0, 1]);
  });

  it("reports an author role it has never seen, rather than withholding words that role may carry", () => {
    const value = oneMessage({ content: { content_type: "text", parts: ["hello"] } }) as {
      mapping: { m: { message: { author: { role: string } } } };
    };
    value.mapping.m.message.author.role = "critic";
    const conversation = unwrap(parseExportConversation({ value }));
    expect(conversation.messages).toEqual([]);
    expect([...conversation.unknownKinds]).toEqual([["role critic", 1]]);
    expect(conversation.withheld).toBe(0);
  });

  it("reports an author role it has never seen even on a message flagged hidden, while a hidden tool turn is withheld", () => {
    const hiddenAs = ({ role }: { role: string }): unknown => {
      const value = oneMessage({ content: { content_type: "text", parts: ["words"] } }) as {
        mapping: { m: { message: { author: { role: string }; metadata?: Record<string, unknown> } } };
      };
      value.mapping.m.message.author.role = role;
      value.mapping.m.message.metadata = { is_visually_hidden_from_conversation: true };
      return value;
    };
    const critic = unwrap(parseExportConversation({ value: hiddenAs({ role: "critic" }) }));
    expect([...critic.unknownKinds]).toEqual([["role critic", 1]]);
    expect(critic.withheld).toBe(0);
    const tool = unwrap(parseExportConversation({ value: hiddenAs({ role: "tool" }) }));
    expect([...tool.unknownKinds]).toEqual([]);
    expect(tool.withheld).toBe(1);
  });
});
