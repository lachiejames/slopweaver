/**
 * The Queue's tag model (`site/lib/queueTags.ts`): what a card inherits from its board rows, how the address's
 * selectors parse and match, what the bar offers, and how a selector is written back into the address. Board rows
 * go through `readBoard`, so every case starts from the published `handover list --json` shape.
 */
import { describe, expect, it } from "vitest";

import { type Board, readBoard } from "../../components/live/read";
import {
  matchesTags,
  parseTagParams,
  selectorText,
  tagFacets,
  tagSummary,
  withoutTags,
  withTagSelector,
  workstreamHref,
} from "../../lib/queueTags";
import { type BoardReading, inheritedTags, type QueueTags } from "../../lib/queueTagsInherited";

/** One declared tag as the published row carries it. */
function tag({ key, value }: { key: string; value: string }): { key: string; value: string; source: string } {
  return { key, source: "declared", value };
}

/** One published row with the fields `readBoard` requires, and whatever a case overrides. */
function row({ slug, over = {} }: { slug: string; over?: Record<string, unknown> }): Record<string, unknown> {
  return {
    kind: "planned",
    ownerWait: "not-waiting",
    reason: "runnable now",
    section: "RUN NOW",
    slug,
    status: "planned",
    tags: [],
    ...over,
  };
}

/** The board those rows publish, read the way the console reads it. */
function boardOf({
  rows,
  unreadable = [],
}: {
  rows: readonly Record<string, unknown>[];
  unreadable?: readonly string[];
}): Board {
  return readBoard({ rows, unreadable, unresolved: 0 })!;
}

/** That board as the association reads it. */
function reading({
  rows,
  unreadable = [],
}: {
  rows: readonly Record<string, unknown>[];
  unreadable?: readonly string[];
}): BoardReading {
  const board = boardOf({ rows, unreadable });
  return { phase: "ready", rows: board.rows, unreadable: board.unreadable };
}

/** A card with these tags, read whole unless a case says otherwise. */
function card({
  tags,
  tagsRead = "whole",
}: {
  tags: readonly (readonly [string, string])[];
  tagsRead?: QueueTags["tagsRead"];
}): QueueTags {
  return { tags: tags.map(([key, value]) => ({ key, value })), tagsRead };
}

const ISO = row({
  over: { tags: [tag({ key: "workstream", value: "iso" }), tag({ key: "area", value: "vanta" })] },
  slug: "iso-row",
});
const CONSOLE = row({ over: { tags: [tag({ key: "workstream", value: "console" })] }, slug: "console-row" });

describe("inheritedTags", () => {
  it("reads a card that can belong to no row whole, on its own facets", () => {
    const tags = inheritedTags({
      board: { phase: "unread" },
      derived: [{ key: "platform", value: "slack" }],
      direct: undefined,
      pullRequest: undefined,
      slugs: [],
    });
    expect(tags).toEqual({ tags: [{ key: "platform", value: "slack" }], tagsRead: "whole" });
  });

  it("reads absent while the board has not read, keeping the card's own facets", () => {
    const tags = inheritedTags({
      board: { phase: "unread" },
      derived: [{ key: "platform", value: "slack" }],
      direct: undefined,
      pullRequest: undefined,
      slugs: ["iso-row"],
    });
    expect(tags).toEqual({ tags: [{ key: "platform", value: "slack" }], tagsRead: "absent" });
  });

  it("reads absent when no row on the board publishes a tags field at all", () => {
    const board = reading({ rows: [row({ over: { tags: undefined }, slug: "iso-row" })] });
    const tags = inheritedTags({ board, derived: [], direct: undefined, pullRequest: undefined, slugs: ["iso-row"] });
    expect(tags).toEqual({ tags: [], tagsRead: "absent" });
  });

  it("inherits every tag of the one row a slug names", () => {
    const board = reading({ rows: [ISO, CONSOLE] });
    const tags = inheritedTags({ board, derived: [], direct: undefined, pullRequest: undefined, slugs: ["iso-row"] });
    expect(tags).toEqual({
      tags: [
        { key: "workstream", value: "iso" },
        { key: "area", value: "vanta" },
      ],
      tagsRead: "whole",
    });
  });

  it("inherits the row an ask card IS, directly", () => {
    const read = boardOf({ rows: [ISO, CONSOLE] });
    const board: BoardReading = { phase: "ready", rows: read.rows, unreadable: read.unreadable };
    const tags = inheritedTags({ board, derived: [], direct: read.rows[1], pullRequest: undefined, slugs: [] });
    expect(tags).toEqual({ tags: [{ key: "workstream", value: "console" }], tagsRead: "whole" });
  });

  it("lends no tag from a slug two rows share, and reads partial", () => {
    const board = reading({
      rows: [ISO, row({ over: { tags: [tag({ key: "workstream", value: "x" })] }, slug: "iso-row" })],
    });
    const tags = inheritedTags({ board, derived: [], direct: undefined, pullRequest: undefined, slugs: ["iso-row"] });
    expect(tags).toEqual({ tags: [], tagsRead: "partial" });
  });

  it("reads a slug that matches nothing as whole when every document read", () => {
    const board = reading({ rows: [ISO] });
    const tags = inheritedTags({ board, derived: [], direct: undefined, pullRequest: undefined, slugs: ["gone"] });
    expect(tags).toEqual({ tags: [], tagsRead: "whole" });
  });

  it("reads a slug that matches nothing as partial when a document could not be read", () => {
    const board = reading({ rows: [ISO], unreadable: ["broken.md"] });
    const tags = inheritedTags({ board, derived: [], direct: undefined, pullRequest: undefined, slugs: ["gone"] });
    expect(tags).toEqual({ tags: [], tagsRead: "partial" });
  });

  it("lends the one row a slug matches but reads partial when a document could not be read, which may hold a second", () => {
    const board = reading({ rows: [CONSOLE], unreadable: ["broken.md"] });
    const tags = inheritedTags({
      board,
      derived: [],
      direct: undefined,
      pullRequest: undefined,
      slugs: ["console-row"],
    });
    expect(tags).toEqual({ tags: [{ key: "workstream", value: "console" }], tagsRead: "partial" });
  });

  it("reads partial when the one row it joins read its tags partially", () => {
    const board = reading({
      rows: [row({ over: { tags: [tag({ key: "workstream", value: "iso" }), { key: 7 }] }, slug: "iso-row" })],
    });
    const tags = inheritedTags({ board, derived: [], direct: undefined, pullRequest: undefined, slugs: ["iso-row"] });
    expect(tags).toEqual({ tags: [{ key: "workstream", value: "iso" }], tagsRead: "partial" });
  });

  it("joins a pull request to every row whose pr= names it, a done one too", () => {
    const board = reading({
      rows: [
        row({
          over: { tags: [tag({ key: "pr", value: "o/r#1" }), tag({ key: "workstream", value: "iso" })] },
          slug: "a",
        }),
        row({ over: { tags: [tag({ key: "pr", value: "o/r#1" }), tag({ key: "area", value: "graph" })] }, slug: "b" }),
        row({
          over: {
            section: "DONE",
            tags: [tag({ key: "pr", value: "o/r#1" }), tag({ key: "workstream", value: "old" })],
          },
          slug: "c",
        }),
        row({ over: { tags: [tag({ key: "pr", value: "o/r#2" })] }, slug: "d" }),
      ],
    });
    const tags = inheritedTags({ board, derived: [], direct: undefined, pullRequest: "o/r#1", slugs: [] });
    expect(tags).toEqual({
      tags: [
        { key: "pr", value: "o/r#1" },
        { key: "workstream", value: "iso" },
        { key: "area", value: "graph" },
        { key: "workstream", value: "old" },
      ],
      tagsRead: "whole",
    });
  });

  it("reads a pull request partial when a row that does not name it may be hiding the edge", () => {
    const board = reading({
      rows: [
        row({ over: { tags: [tag({ key: "pr", value: "o/r#1" })] }, slug: "a" }),
        row({ over: { tags: "not a list" }, slug: "b" }),
      ],
    });
    const tags = inheritedTags({ board, derived: [], direct: undefined, pullRequest: "o/r#1", slugs: [] });
    expect(tags).toEqual({ tags: [{ key: "pr", value: "o/r#1" }], tagsRead: "partial" });
  });

  it("reads a pull request partial when any document could not be read", () => {
    const board = reading({
      rows: [row({ over: { tags: [tag({ key: "pr", value: "o/r#1" })] }, slug: "a" })],
      unreadable: ["x.md"],
    });
    const tags = inheritedTags({ board, derived: [], direct: undefined, pullRequest: "o/r#1", slugs: [] });
    expect(tags.tagsRead).toBe("partial");
  });

  it("carries one tag once when two joined rows both hold it", () => {
    const board = reading({
      rows: [ISO, row({ over: { tags: [tag({ key: "workstream", value: "iso" })] }, slug: "b" })],
    });
    const tags = inheritedTags({
      board,
      derived: [],
      direct: undefined,
      pullRequest: undefined,
      slugs: ["iso-row", "b"],
    });
    expect(tags.tags).toEqual([
      { key: "workstream", value: "iso" },
      { key: "area", value: "vanta" },
    ]);
  });
});

describe("parseTagParams", () => {
  it("groups by key, ORs values within one, and reads a leading ! as the key's absence", () => {
    expect(parseTagParams({ values: ["workstream:iso", "area:vanta", "workstream:console", "!area"] })).toEqual({
      groups: [
        { key: "workstream", missing: false, values: ["iso", "console"] },
        { key: "area", missing: true, values: ["vanta"] },
      ],
      malformed: [],
    });
  });

  it("splits at the first colon, so a value may carry one", () => {
    expect(parseTagParams({ values: ["pr:o/r#1:x"] }).groups).toEqual([
      { key: "pr", missing: false, values: ["o/r#1:x"] },
    ]);
  });

  it("keeps every selector that does not parse, verbatim and once, and matches nothing on it", () => {
    expect(
      parseTagParams({ values: ["nocolon", ":iso", "area:", "area: padded", "Area:x", "!", "!Bad", "nocolon"] }),
    ).toEqual({ groups: [], malformed: ["nocolon", ":iso", "area:", "area: padded", "Area:x", "!", "!Bad"] });
  });

  it("reads no parameter as an empty selection", () => {
    expect(parseTagParams({ values: [] })).toEqual({ groups: [], malformed: [] });
  });
});

describe("matchesTags", () => {
  const isoVanta = card({
    tags: [
      ["workstream", "iso"],
      ["area", "vanta"],
    ],
  });
  const consoleOnly = card({ tags: [["workstream", "console"]] });

  it("shows every card under an empty selection", () => {
    const selection = parseTagParams({ values: [] });
    expect([isoVanta, consoleOnly].map((each) => matchesTags({ card: each, selection }))).toEqual([true, true]);
  });

  it("ORs values within one key", () => {
    const selection = parseTagParams({ values: ["workstream:iso", "workstream:console"] });
    expect([isoVanta, consoleOnly].map((each) => matchesTags({ card: each, selection }))).toEqual([true, true]);
  });

  it("ANDs across keys", () => {
    const selection = parseTagParams({ values: ["workstream:console", "area:vanta"] });
    expect([isoVanta, consoleOnly].map((each) => matchesTags({ card: each, selection }))).toEqual([false, false]);
  });

  it("matches a key's absence only on a card whose tags read whole", () => {
    const selection = parseTagParams({ values: ["!area"] });
    const partial = card({ tags: [["workstream", "console"]], tagsRead: "partial" });
    const absent = card({ tags: [], tagsRead: "absent" });
    expect([isoVanta, consoleOnly, partial, absent].map((each) => matchesTags({ card: each, selection }))).toEqual([
      false,
      true,
      false,
      false,
    ]);
  });

  it("claims no partial or absent card, even by a value it carries", () => {
    const selection = parseTagParams({ values: ["workstream:iso"] });
    const partial = card({ tags: [["workstream", "iso"]], tagsRead: "partial" });
    const absent = card({ tags: [["platform", "slack"]], tagsRead: "absent" });
    expect([isoVanta, partial, absent].map((each) => matchesTags({ card: each, selection }))).toEqual([
      true,
      false,
      false,
    ]);
  });

  it("shows every card, whole or not, when no selector parses", () => {
    const selection = parseTagParams({ values: [] });
    const partial = card({ tags: [["workstream", "iso"]], tagsRead: "partial" });
    expect(matchesTags({ card: partial, selection })).toBe(true);
  });

  it("reads a selector naming a key outside the registry as malformed, so it filters nothing and is named", () => {
    const selection = parseTagParams({ values: ["workstrem:iso", "!aera", "workstream:iso"] });
    expect(selection.malformed).toEqual(["workstrem:iso", "!aera"]);
    expect(selection.groups.map((group) => group.key)).toEqual(["workstream"]);
  });

  it("lets a malformed selector filter nothing", () => {
    const selection = parseTagParams({ values: ["nonsense"] });
    expect(matchesTags({ card: consoleOnly, selection })).toBe(true);
  });
});

describe("tagFacets", () => {
  it("orders known keys first, then others alphabetically, counting values by card and missing only on whole cards", () => {
    const facets = tagFacets({
      cards: [
        card({
          tags: [
            ["zeta", "1"],
            ["workstream", "iso"],
            ["workstream", "iso"],
          ],
        }),
        card({
          tags: [
            ["workstream", "console"],
            ["beta", "x"],
          ],
        }),
        card({ tags: [["workstream", "iso"]] }),
        card({ tags: [], tagsRead: "absent" }),
        card({ tags: [["workstream", "iso"]], tagsRead: "partial" }),
        card({ tags: [["gamma", "g"]], tagsRead: "partial" }),
        card({ tags: [] }),
      ],
    });
    expect(facets).toEqual([
      {
        key: "workstream",
        missing: 1,
        values: [
          { count: 2, value: "iso" },
          { count: 1, value: "console" },
        ],
      },
      { key: "beta", missing: 3, values: [{ count: 1, value: "x" }] },
      { key: "zeta", missing: 3, values: [{ count: 1, value: "1" }] },
    ]);
  });

  it("offers nothing when no card carries a tag", () => {
    expect(tagFacets({ cards: [card({ tags: [] })] })).toEqual([]);
  });
});

describe("tagSummary", () => {
  it("counts the hidden, the untagged whole cards and the incomplete ones apart", () => {
    const summary = tagSummary({
      cards: [
        card({ tags: [["workstream", "iso"]] }),
        card({ tags: [] }),
        card({ tags: [], tagsRead: "absent" }),
        card({ tags: [["workstream", "iso"]], tagsRead: "partial" }),
      ],
      selection: parseTagParams({ values: ["workstream:iso"] }),
    });
    expect(summary).toEqual({ hidden: 3, incomplete: 2, untagged: 1 });
  });
});

describe("the address", () => {
  it("spells a value selector and an absence selector", () => {
    expect([selectorText({ key: "area", value: "vanta" }), selectorText({ key: "area", value: undefined })]).toEqual([
      "area:vanta",
      "!area",
    ]);
  });

  it("adds a selector after the ones already there, keeping every other parameter and a malformed tag", () => {
    expect(withTagSelector({ on: true, search: "?context=work&tag=bad&open=ask%3Aa", selector: "area:vanta" })).toBe(
      "?context=work&open=ask%3Aa&tag=bad&tag=area%3Avanta",
    );
  });

  it("removes one selector and leaves the rest in order", () => {
    expect(withTagSelector({ on: false, search: "tag=a%3A1&tag=b%3A2&tag=c%3A3", selector: "b:2" })).toBe(
      "?tag=a%3A1&tag=c%3A3",
    );
  });

  it("clears every selector, and reads an address with nothing left as empty", () => {
    expect([withoutTags({ search: "?tag=a%3A1&context=work" }), withoutTags({ search: "?tag=a%3A1" })]).toEqual([
      "?context=work",
      "",
    ]);
  });

  it("filters the Queue to one workstream, replacing any selection, closing the card and keeping the context", () => {
    expect(workstreamHref({ search: "?tag=area%3Avanta&open=ask%3Aa&context=work", workstream: "iso" })).toBe(
      "/queue?context=work&tag=workstream%3Aiso",
    );
  });
});
