/**
 * What a `store` read prints for a value the row does not carry: each absence is a word that says what it
 * means, never a blank and never a substituted value that reads as data.
 */
import { describe, expect, it } from "vitest";

import { detailLines, listLines } from "../../../../../cli/commands/store/rowLines.js";
import type { ContentRow } from "../../../../../store/schema/content.js";

/** A stored row carrying only the columns these two renderers read. */
const bare = (over: Partial<ContentRow> = {}): ContentRow =>
  ({
    body: "the deploy rolled back\nbecause the probe failed",
    dataClass: null,
    kind: "message",
    occurredAt: new Date("2026-10-01T09:00:00.000Z"),
    source: "slack",
    sourceId: "C7:7.7",
    title: null,
    url: "https://example.test/7",
    visibility: "public",
    ...over,
  }) as unknown as ContentRow;

describe("listLines' headline", () => {
  it("heads a row that carries no title by its body's first line, exactly", () => {
    expect(listLines({ rows: [bare()], total: 1 })).toEqual([
      "2026-10-01T09:00:00.000Z  slack/message  C7:7.7  the deploy rolled back",
      "1 of 1 matching row(s)",
    ]);
  });

  it("heads a titled row by its title, even an empty body", () => {
    expect(listLines({ rows: [bare({ body: "", title: "Release notes" })], total: 3 })).toEqual([
      "2026-10-01T09:00:00.000Z  slack/message  C7:7.7  Release notes",
      "1 of 3 matching row(s)",
    ]);
  });
});

describe("detailLines' resolved names", () => {
  it("prints (none) for a container and an author the store resolved no name for", () => {
    const lines = detailLines({
      detail: { author: null, container: null, row: bare(), sourceRow: null },
      source: "slack",
      sourceId: "C7:7.7",
    });
    expect(lines.slice(0, 4)).toEqual([
      "slack/message  C7:7.7",
      "when:      2026-10-01T09:00:00.000Z",
      "container: (none)",
      "author:    (none)",
    ]);
  });
});
