/*
 * The tag handlers that read only attributes, and the tables the parser routes a tag through. Every fixture is
 * synthetic.
 */
import { describe, expect, it } from "vitest";

import type { NotionMdNode } from "../../../../corpus/notion/markdownNodes.js";
import {
  CONTAINER_TAGS,
  MEDIA_KINDS,
  MENTION_TARGETS,
  makeSink,
  TRANSPARENT_TAGS,
  transparentNodes,
  unknownNode,
} from "../../../../corpus/notion/markdownTags.js";

const CHILDREN: readonly NotionMdNode[] = [{ kind: "text", text: "kept" }];

describe("the tag tables", () => {
  it("routes the tags whose node kind differs from their name", () => {
    expect(CONTAINER_TAGS["details"]).toBe("toggle");
    expect(MENTION_TARGETS["mention-data-source"]).toBe("dataSource");
    expect(MEDIA_KINDS["embed"]).toBe("embed");
  });

  it("treats a spacing wrapper as transparent, and never a table's own row or cell", () => {
    expect(TRANSPARENT_TAGS.has("span")).toBe(true);
    expect(TRANSPARENT_TAGS.has("tr")).toBe(false);
    expect(TRANSPARENT_TAGS.has("td")).toBe(false);
  });
});

describe("makeSink", () => {
  it("starts empty and borrows nothing", () => {
    const sink = makeSink();
    expect(sink.nodes).toEqual([]);
    expect(sink.gaps.size).toBe(0);
    expect(sink.borrowsContent).toBe(false);
  });

  it("hands each parse its own lists", () => {
    const first = makeSink();
    first.mentionUrls.push("https://acme.example/one");
    expect(makeSink().mentionUrls).toEqual([]);
  });
});

describe("unknownNode", () => {
  it("lifts the follow-up url onto the sink and keeps the alt", () => {
    const sink = makeSink();
    const nodes = unknownNode({
      attrs: { alt: "alias", url: "https://acme.example/block" },
      children: [],
      sink,
      tag: "unknown",
    });
    expect(nodes).toEqual([{ alt: "alias", kind: "unknown", url: "https://acme.example/block" }]);
    expect(sink.unknownUrls).toEqual(["https://acme.example/block"]);
  });

  it("lifts nothing when the block carries no url", () => {
    const sink = makeSink();
    const nodes = unknownNode({ attrs: {}, children: [], sink, tag: "unknown" });
    expect(nodes).toEqual([{ alt: undefined, kind: "unknown", url: undefined }]);
    expect(sink.unknownUrls).toEqual([]);
  });
});

describe("transparentNodes", () => {
  it("returns the children and lifts each discussion url, dropping an empty one", () => {
    const sink = makeSink();
    const nodes = transparentNodes({
      attrs: { "discussion-urls": "discussion://one,,discussion://two" },
      children: CHILDREN,
      sink,
      tag: "span",
    });
    expect(nodes).toEqual(CHILDREN);
    expect(sink.discussionUrls).toEqual(["discussion://one", "discussion://two"]);
  });

  it("lifts nothing from a wrapper with no discussion attribute", () => {
    const sink = makeSink();
    expect(transparentNodes({ attrs: {}, children: CHILDREN, sink, tag: "summary" })).toEqual(CHILDREN);
    expect(sink.discussionUrls).toEqual([]);
  });
});
