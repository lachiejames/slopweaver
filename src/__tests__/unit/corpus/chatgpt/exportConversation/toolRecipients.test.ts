/*
 * The tools the assistant addresses a call to, learned off the first full live-sync walk: a call to each is the model's
 * working (withheld, not reported), while a recipient no one has learned stays reported. Synthetic fixtures only.
 */
import { describe, expect, it } from "vitest";

import { parseExportConversation } from "../../../../../corpus/chatgpt/exportConversation.js";
import { unwrap } from "../../../../../lib/result.js";

const call = ({ recipient, content }: { recipient: string; content: Record<string, unknown> }): unknown => ({
  create_time: 1790000000,
  current_node: "m",
  id: "6f1c2a9e-3b4d-4e5f-8a7b-1c2d3e4f5aff",
  mapping: {
    m: {
      id: "m",
      message: {
        author: { role: "assistant" },
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

const CODE_CALL = { content_type: "code", language: "json", text: '{"q":"synthetic"}' };
const TEXT_CALL = { content_type: "text", parts: ["synthetic query"] };

describe("a call the assistant addresses to a tool", () => {
  it.each([
    ["bio", CODE_CALL],
    ["container.exec", CODE_CALL],
    ["de1d73e.create", CODE_CALL],
    ["de1d73e.update", CODE_CALL],
    ["genui.run", CODE_CALL],
    ["genui.search", CODE_CALL],
    ["hotline.get_local_hotline", CODE_CALL],
    ["q7dr546", CODE_CALL],
    ["web", TEXT_CALL],
  ])("is withheld, not reported, when addressed to %s", (recipient, content) => {
    const read = unwrap(parseExportConversation({ value: call({ content, recipient }) }));
    expect([...read.unknownKinds]).toEqual([]);
    expect(read.withheld).toBe(1);
    expect(read.messages).toEqual([]);
  });

  it("is still reported when addressed to a recipient no one has learned", () => {
    const read = unwrap(parseExportConversation({ value: call({ content: CODE_CALL, recipient: "genui.unlearned" }) }));
    expect([...read.unknownKinds]).toEqual([["recipient genui.unlearned", 1]]);
    expect(read.withheld).toBe(0);
  });
});
