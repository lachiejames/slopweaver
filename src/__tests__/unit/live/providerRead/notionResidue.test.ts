/*
 * The pure residue and coverage strings a Notion page read carries: the slice residue that names the exact
 * continuation, and the nested-expansion residue that leads with incompleteness and the way past a ceiling.
 */
import { describe, expect, it } from "vitest";

import type { NotionNestedExpansion } from "../../../../live/notion/blockShape.js";
import { notionNestedResidue, notionPageCoverageDetail } from "../../../../live/notion/nestedResidue.js";
import { notionBlockSliceResidue } from "../../../../live/notion/read.js";

describe("notionBlockSliceResidue", () => {
  it("tells the caller the exact command that reaches the rest of a long page", () => {
    expect(
      notionBlockSliceResidue({
        after: undefined,
        hasMore: true,
        limit: 100,
        nextCursor: "cursor-2",
      })[1],
    ).toBe("more top-level blocks remain: read the next slice with --after cursor-2");
  });

  it("never calls a resumed slice the FIRST blocks of the page", () => {
    expect(
      notionBlockSliceResidue({
        after: "cursor-2",
        hasMore: false,
        limit: 100,
        nextCursor: undefined,
      })[0],
    ).toBe("only the page object and up to 100 top-level blocks continuing from the supplied cursor were requested");
  });

  it("says FIRST only for the opening slice", () => {
    expect(notionBlockSliceResidue({ after: undefined, hasMore: false, limit: 25, nextCursor: undefined })[0]).toBe(
      "only the page object and first 25 top-level blocks were requested",
    );
  });

  it("reports a terminal slice with no continuation line at all", () => {
    expect(notionBlockSliceResidue({ after: "c1", hasMore: false, limit: 100, nextCursor: undefined })).toHaveLength(1);
  });

  it("refuses to imply completeness when more remains but no cursor came back", () => {
    expect(notionBlockSliceResidue({ after: undefined, hasMore: true, limit: 100, nextCursor: undefined })[1]).toBe(
      "the page reports more top-level blocks but returned no cursor, so the rest cannot be reached by " +
        "continuing — a provider inconsistency, and NOT a complete read",
    );
  });
});

describe("notionNestedResidue and notionPageCoverageDetail", () => {
  const whole: NotionNestedExpansion = {
    calls: 3,
    callLimit: 400,
    complete: true,
    linkedObjects: [],
    stoppedBy: null,
    unexpanded: [],
  };

  it("says nothing about a whole expansion that names no child object", () => {
    expect(notionNestedResidue({ nested: whole })).toEqual([]);
    expect(notionPageCoverageDetail({ after: undefined, complete: true })).toBe(
      "one page object and its first top-level block page, every block nested beneath it expanded; " +
        "child pages and databases are named, not read",
    );
  });

  it("leads with the incompleteness and the exact way past a call ceiling", () => {
    const capped: NotionNestedExpansion = {
      ...whole,
      complete: false,
      stoppedBy: "calls",
      unexpanded: [{ expansion: "budget", id: "b1", reason: "the read's calls ceiling was reached", type: "toggle" }],
    };

    expect(notionNestedResidue({ nested: capped })).toEqual([
      "nested blocks are INCOMPLETE: 1 block(s) were not fully expanded — data.nested.unexpanded names each one and why",
      "nested expansion stopped at its 400-call ceiling: raise it with --nested-calls <n> (at most 2000), or read " +
        "a smaller slice with --limit and continue with --after",
    ]);
    expect(notionPageCoverageDetail({ after: "c1", complete: false })).toBe(
      "one page object and one continued top-level block page; its nested expansion is INCOMPLETE, see residue",
    );
  });

  it("names the time stop check and the child objects left for their own read", () => {
    const timed: NotionNestedExpansion = {
      ...whole,
      complete: false,
      linkedObjects: [{ id: "p1", kind: "page", url: "https://www.notion.so/p1" }],
      stoppedBy: "time",
      unexpanded: [
        {
          expansion: "budget",
          id: "b1",
          reason: "the read had run past its time limit for starting calls",
          type: "toggle",
        },
      ],
    };

    expect(notionNestedResidue({ nested: timed }).slice(1)).toEqual([
      "nested expansion started no call after 300s (the call already in flight finished, retries included): read a " +
        "smaller slice with --limit and continue with --after",
      "1 child page(s) or database(s) are named in data.nested.linkedObjects and not read: each is its own object, " +
        "read by its url",
    ]);
  });
});
