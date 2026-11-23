/*
 * The tree a conversation's mapping links: a missing or unheld `current_node`, a looping parent chain, a dangling or
 * mis-keyed node, a second root and a prototype-named key are each refused, and `currentPath` walks leaf to root.
 */
import { describe, expect, it } from "vitest";

import { currentPath, parseExportConversation } from "../../../../../corpus/chatgpt/exportConversation.js";
import { PROTOTYPE_NAME_ISSUE } from "../../../../../corpus/chatgpt/exportMessage.js";
import { unwrapErr } from "../../../../../lib/result.js";
import { fixtureConversation } from "./harness.js";

describe("parseExportConversation", () => {
  it("refuses a conversation with no current_node, or one its mapping does not hold", () => {
    const base = fixtureConversation({ file: "conversations-001.json", index: 0 }) as Record<string, unknown>;
    const absent = unwrapErr(parseExportConversation({ value: { ...base, current_node: null } }));
    expect(absent.code).toBe("CONVERSATION_NO_LEAF");
    expect(absent.message).toContain("carries no `current_node`");
    expect(unwrapErr(parseExportConversation({ value: { ...base, current_node: "nowhere" } }))).toEqual({
      code: "CONVERSATION_NO_LEAF",
      conversationId: "a0000100-0000-4000-8000-000000000109",
      message: "a0000100-0000-4000-8000-000000000109: `current_node` nowhere is not in its own `mapping`",
    });
  });

  it("refuses a parent chain that loops, rather than walking it forever", () => {
    const value = {
      current_node: "x",
      id: "a0000100-0000-4000-8000-000000000110",
      mapping: { x: { id: "x", message: null, parent: "y" }, y: { id: "y", message: null, parent: "x" } },
    };
    expect(unwrapErr(parseExportConversation({ value }))).toEqual({
      code: "CONVERSATION_LOOP",
      conversationId: "a0000100-0000-4000-8000-000000000110",
      message: "a0000100-0000-4000-8000-000000000110: the parent chain from `current_node` loops",
    });
  });

  it("refuses a node whose parent the mapping does not hold, or keyed under an id it does not carry", () => {
    const id = "6f1c2a9e-3b4d-4e5f-8a7b-1c2d3e4f5abb";
    const dangling = {
      current_node: "leaf",
      id,
      mapping: { leaf: { id: "leaf", message: null, parent: "gone" } },
    };
    const misKeyed = {
      current_node: "leaf",
      id,
      mapping: { leaf: { id: "other", message: null, parent: null } },
    };
    expect([
      unwrapErr(parseExportConversation({ value: dangling })),
      unwrapErr(parseExportConversation({ value: misKeyed })),
    ]).toEqual([
      {
        code: "CONVERSATION_BROKEN_LINK",
        conversationId: id,
        message: `${id}: node leaf names a parent the mapping does not hold`,
        nodeId: "leaf",
      },
      {
        code: "CONVERSATION_BROKEN_LINK",
        conversationId: id,
        message: `${id}: node leaf is keyed under an id it does not carry`,
        nodeId: "leaf",
      },
    ]);
  });

  it("refuses a second root, rather than carrying a disconnected conversation in under this one's id", () => {
    const id = "6f1c2a9e-3b4d-4e5f-8a7b-1c2d3e4f5acc";
    const said = { author: { role: "user" }, content: { content_type: "text", parts: ["stray"] }, id: "stray-msg" };
    const value = {
      current_node: "leaf",
      id,
      mapping: {
        leaf: { id: "leaf", message: null, parent: "root" },
        root: { id: "root", message: null, parent: null },
        stray: { id: "stray", message: said, parent: null },
      },
    };
    expect(unwrapErr(parseExportConversation({ value }))).toEqual({
      code: "CONVERSATION_BROKEN_LINK",
      conversationId: id,
      message: `${id}: node stray is a second root, a conversation the first root's tree does not reach`,
      nodeId: "stray",
    });
  });

  it.each(["__proto__", "constructor", "hasOwnProperty"])(
    "never reads a node keyed or parented %s through the prototype as part of the tree",
    (name) => {
      const said = {
        author: { role: "user" },
        content: { content_type: "text", parts: ["hidden?"] },
        create_time: 1790000001,
        id: "msg-odd",
      };
      const keyed = JSON.parse(
        JSON.stringify({
          current_node: "leaf",
          id: "6f1c2a9e-3b4d-4e5f-8a7b-1c2d3e4f5abd",
          mapping: {
            leaf: { id: "leaf", message: null, parent: "root" },
            root: { id: "root", message: null, parent: null },
            [`${name}`]: { id: name, message: said, parent: "root" },
          },
        }),
      ) as unknown;
      const parented = {
        current_node: "leaf",
        id: "6f1c2a9e-3b4d-4e5f-8a7b-1c2d3e4f5abd",
        mapping: { leaf: { id: "leaf", message: said, parent: name } },
      };
      const refusals = [keyed, parented].map((value) => unwrapErr(parseExportConversation({ value })).message);
      expect(refusals[0]!).toContain(`mapping.${name}: ${PROTOTYPE_NAME_ISSUE}`);
      expect(refusals[1]!).toContain(`mapping.leaf.parent: ${PROTOTYPE_NAME_ISSUE}`);
    },
  );
});

describe("currentPath", () => {
  it("walks from the leaf to the root, leaf first, and stops at a parent the mapping lacks", () => {
    const mapping = {
      a: { id: "a", parent: null },
      b: { id: "b", parent: "a" },
      c: { id: "c", parent: "b" },
      orphan: { id: "orphan", parent: "gone" },
    };
    expect(currentPath({ leaf: "c", mapping })).toEqual(["c", "b", "a"]);
    expect(currentPath({ leaf: "orphan", mapping })).toEqual(["orphan"]);
  });
});
