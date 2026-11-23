/*
 * Every recursive walk terminates and stays linear in the distinct nodes it meets: self-references, cycles through
 * accessories, element lists, rich text and table cells, and a shared subtree repeated many times over.
 */
import { describe, expect, it } from "vitest";

import { flatten } from "./fixtures.js";

describe("flattenSlackVisibleProse — findings from the adversarial review", () => {
  it("terminates on a self-referential accessory rather than exhausting the stack", () => {
    const block: Record<string, unknown> = { text: { text: "the visible body", type: "mrkdwn" }, type: "section" };
    block["accessory"] = block;
    expect(flatten({ raw: { blocks: [block] } })).toStrictEqual(["the visible body"]);
  });

  it("terminates on a self-referential element list", () => {
    const block: Record<string, unknown> = { type: "actions" };
    block["elements"] = [block];
    expect(flatten({ raw: { blocks: [block] } })).toStrictEqual([]);
  });
});

describe("flattenSlackVisibleProse — every recursive path terminates", () => {
  it("terminates on a self-referential rich_text container", () => {
    // `rich_text` dispatches straight into the rich-text walker, so a cap that lived only in the block
    // dispatcher would leave this path unguarded.
    const block: Record<string, unknown> = { type: "rich_text" };
    block["elements"] = [block];
    expect(flatten({ raw: { blocks: [block] } })).toStrictEqual([]);
  });

  it("terminates on a self-referential table cell", () => {
    const cell: Record<string, unknown> = { type: "rich_text" };
    cell["elements"] = [cell];
    expect(flatten({ raw: { blocks: [{ rows: [[cell]], type: "table" }] } })).toStrictEqual([]);
  });
});

describe("flattenSlackVisibleProse — a cycle terminates without exponential work", () => {
  it("returns promptly when a node's element array holds many copies of itself", () => {
    // A depth cap alone does not save this: seven self-copies per level is 7^depth visits. Only identity
    // tracking along the current path bounds it.
    const block: Record<string, unknown> = { text: { text: "x", type: "plain_text" }, type: "actions" };
    block["elements"] = Array(7).fill(block);
    expect(flatten({ raw: { blocks: [block] } })).toStrictEqual(["x"]);
  });

  it("still reads the same object appearing twice as siblings, which is repetition not a cycle", () => {
    const shared = { text: { text: "shared body", type: "plain_text" }, type: "section" };
    expect(flatten({ raw: { blocks: [shared, shared] } })).toStrictEqual(["shared body"]);
  });
});

describe("flattenSlackVisibleProse — findings from the final review round", () => {
  it("returns promptly when a rich_text node's element array holds many copies of itself", () => {
    const node: Record<string, unknown> = { type: "rich_text" };
    node["elements"] = Array(7).fill(node);
    expect(flatten({ raw: { blocks: [node] } })).toStrictEqual([]);
  });
});

describe("flattenSlackVisibleProse — the last two recursion and mark gaps", () => {
  it("returns promptly when a table cell's element array holds copies of itself", () => {
    const cell: Record<string, unknown> = { type: "rich_text" };
    cell["elements"] = Array(2000).fill(cell);
    expect(flatten({ raw: { blocks: [{ rows: [[cell]], type: "table" }] } })).toStrictEqual([]);
  });
});

describe("flattenSlackVisibleProse — work stays linear in distinct nodes", () => {
  it("returns promptly for a ring of nodes joined by many parallel edges", () => {
    // Path-local cycle tracking explores 50^6 paths here; entering each node at most once does not.
    const nodes = Array.from({ length: 6 }, (_, i) => ({
      text: { text: `node-${String(i)}`, type: "plain_text" },
      type: "actions",
    })) as Record<string, unknown>[];
    for (let i = 0; i < nodes.length; i++) {
      nodes[i]!["elements"] = Array(50).fill(nodes[(i + 1) % nodes.length]!);
    }
    expect(flatten({ raw: { blocks: [nodes[0]!] } })).toStrictEqual([
      "node-0",
      "node-1",
      "node-2",
      "node-3",
      "node-4",
      "node-5",
    ]);
  });
});

describe("flattenSlackVisibleProse — one visited set per payload, not per call", () => {
  it("walks a shared subtree once even when the top level repeats the same block many times", () => {
    const leaves = Array.from({ length: 400 }, (_, i) => ({
      text: { text: `leaf-${String(i)}`, type: "plain_text" },
      type: "section",
    }));
    const block: Record<string, unknown> = { type: "actions" };
    block["elements"] = [block, ...leaves];
    block["accessory"] = block;
    const kept = flatten({ raw: { blocks: Array(400).fill(block) } });
    expect(kept).toHaveLength(400);
    expect(kept[0]).toBe("leaf-0");
    expect(kept[399]).toBe("leaf-399");
  });
});
