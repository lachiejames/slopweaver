import { describe, expect, it } from "vitest";

import type { PageReadWindow } from "../../lib/pageReadWindow";
import { type PageView, pageRead, pageReadOn } from "../../lib/pageVoice";
import { coverageLine, readCoverageOf, toolArgsOf } from "../../lib/readCoverage";

/** One text content item carrying a JSON answer. */
const text = (value: unknown) => [{ text: JSON.stringify(value), type: "inputText" as const }];

describe("readCoverageOf", () => {
  it("reads a file window cut at nextFrom as partial, resumed by the same tool with its words mode kept", () => {
    const answer = {
      kind: "text",
      nextFrom: 9953,
      path: "/h/p.html",
      size: 17315,
      start: 0,
      text: "…",
      truncated: true,
    };
    const coverage = readCoverageOf({
      args: { path: "/h/p.html", words: true },
      contentItems: text(answer),
      tool: "file_read",
    });
    expect(coverage).toEqual({
      gaps: [
        {
          continuation: { arguments: { from: 9953, path: "/h/p.html", words: true }, tool: "file_read" },
          source: "/h/p.html",
          what: "bytes 0 to 9953 of 17315 of /h/p.html",
        },
      ],
      kind: "partial",
    });
  });

  it("reads a window that reached the end as whole", () => {
    const answer = { kind: "text", nextFrom: null, path: "/h/p.html", size: 10, start: 0, text: "x", truncated: false };
    expect(readCoverageOf({ args: {}, contentItems: text(answer), tool: "file_read" })).toEqual({ kind: "whole" });
  });

  it("resumes a code window with code_read and leaves the words mode out of it", () => {
    const answer = { end: 100, nextFrom: 100, path: "src/a.ts", start: 0, truncated: true };
    const coverage = readCoverageOf({ args: { path: "src/a.ts" }, contentItems: text(answer), tool: "code_read" });
    expect(coverage).toEqual({
      gaps: [
        {
          continuation: { arguments: { from: 100, path: "src/a.ts" }, tool: "code_read" },
          source: "src/a.ts",
          what: "bytes 0 to 100 of src/a.ts",
        },
      ],
      kind: "partial",
    });
  });

  it("resumes a paged recall record under its pointer from the page's nextFrom, and reads its last page as whole", () => {
    const paged = {
      mode: "open",
      page: { complete: false, from: 0, nextFrom: 1200 },
      pointer: "call:abc#7",
      text: "…",
    };
    expect(readCoverageOf({ args: { pointer: "call:abc#7" }, contentItems: text(paged), tool: "recall_open" })).toEqual(
      {
        gaps: [
          {
            continuation: { arguments: { from: 1200, pointer: "call:abc#7" }, tool: "recall_open" },
            source: "call:abc#7",
            what: "characters 0 to 1200 of the record call:abc#7",
          },
        ],
        kind: "partial",
      },
    );
    const last = {
      mode: "open",
      page: { complete: true, from: 1200, nextFrom: null },
      pointer: "call:abc#7",
      text: "…",
    };
    expect(readCoverageOf({ args: {}, contentItems: text(last), tool: "recall_open" })).toEqual({ kind: "whole" });
  });

  it("names a card's partial briefing and the words-mode read that resumes it, past its sibling read whole", () => {
    const answer = {
      briefings: [
        { read: true, slug: "whole-one", text: "all of it" },
        { read: "partial", rest: { from: 4096, path: "/h/pages/b/index.html" }, say: "…", slug: "b", text: "part" },
      ],
      key: "ask:b",
    };
    const coverage = readCoverageOf({ args: { key: "ask:b" }, contentItems: text(answer), tool: "read_card" });
    expect(coverage).toEqual({
      gaps: [
        {
          continuation: { arguments: { from: 4096, path: "/h/pages/b/index.html", words: true }, tool: "file_read" },
          source: "/h/pages/b/index.html",
          what: "only the first part of the b briefing",
        },
      ],
      kind: "partial",
    });
  });

  it("pages a cut verb answer on from its spill, from the bytes already carried", () => {
    const answer = {
      spill: { bytes: 90000, path: "/h/talk/verb-spill/x.txt" },
      stdout: { bytes: 90000, text: "héllo", truncated: true },
    };
    const coverage = readCoverageOf({ args: {}, contentItems: text(answer), tool: "verb" });
    expect(coverage).toEqual({
      gaps: [
        {
          continuation: { arguments: { from: 6, path: "/h/talk/verb-spill/x.txt" }, tool: "file_read" },
          source: "/h/talk/verb-spill/x.txt",
          what: "6 of 90000 bytes of what the verb printed",
        },
      ],
      kind: "partial",
    });
  });

  it("says no tool reads the rest of a cut verb answer that kept no spill", () => {
    const answer = { spill: null, stdout: { bytes: 50, text: "abc", truncated: true } };
    const coverage = readCoverageOf({ args: {}, contentItems: text(answer), tool: "verb" });
    expect(coverage).toEqual({
      gaps: [{ continuation: undefined, source: "verb", what: "3 of 50 bytes of what the verb printed" }],
      kind: "partial",
    });
  });

  it("names every cut a capped, incomplete Queue answer marks at its own fields, without inventing a count", () => {
    const answer = {
      beyondCap: { marked: false, more: true, parked: false },
      complete: false,
      cut: "detail was cut from 4 rows to fit",
      items: [],
      recentlyLeftBeyondCap: 2,
    };
    const coverage = readCoverageOf({ args: {}, contentItems: text(answer), tool: "action_items" });
    expect(coverage).toEqual({
      gaps: [
        { continuation: undefined, source: "action_items", what: "complete: false" },
        { continuation: undefined, source: "action_items", what: "beyondCap.more: true" },
        { continuation: undefined, source: "action_items", what: "cut: detail was cut from 4 rows to fit" },
        { continuation: undefined, source: "action_items", what: "recentlyLeftBeyondCap: 2" },
      ],
      kind: "partial",
    });
  });

  it("names a closing cut and the tool's own cuts together: a card's partial briefing beside one left out", () => {
    const answer = {
      briefings: [{ read: "partial", rest: { from: 4096, path: "/h/pages/b/index.html" }, slug: "b", text: "part" }],
      briefingsLeftOut: { count: 2 },
    };
    const coverage = readCoverageOf({ args: {}, contentItems: text(answer), tool: "open_card" });
    expect(coverage).toEqual({
      gaps: [
        {
          continuation: { arguments: { from: 4096, path: "/h/pages/b/index.html", words: true }, tool: "file_read" },
          source: "/h/pages/b/index.html",
          what: "only the first part of the b briefing",
        },
        { continuation: undefined, source: "open_card", what: "briefingsLeftOut.count: 2" },
      ],
      kind: "partial",
    });
  });

  it("resumes a windowed read_page with read_page, carrying the reading it was cut from, and names no second cut", () => {
    const view: PageView = {
      open: undefined,
      openBy: undefined,
      path: "/queue",
      shows: { body: "q".repeat(9000) },
      title: "Queue",
    };
    const window = pageRead({ maxBytes: 4096, view }) as PageReadWindow;
    expect(window.nextFrom).toBe(3830);
    expect(readCoverageOf({ args: {}, contentItems: text(window), tool: "read_page" })).toEqual({
      gaps: [
        {
          continuation: { arguments: { from: 3830, path: "/queue", reading: window.reading }, tool: "read_page" },
          source: "/queue",
          what: "bytes 0 to 3830 of 9011 of /queue",
        },
      ],
      kind: "partial",
    });
  });

  // A refused read on named the cut's path and `from`; read as whole, it closed the gap it never read.
  it("reads a refusal as refused, never as whole", () => {
    const refusal = { detail: "read on refused", refused: "the page moved since that read" };
    expect(
      readCoverageOf({ args: { from: 6000, path: "/queue" }, contentItems: text(refusal), tool: "read_page" }),
    ).toEqual({
      gaps: [{ continuation: undefined, source: "read_page", what: "refused: the page moved since that read" }],
      kind: "refused",
    });
  });

  // Read by field name, slack_unread's subject counts read as cuts.
  it("reads a tool's fields only as that tool means them: unread counts on a complete Slack read are no cut", () => {
    const answer = { dms: { more: 0, rows: [{ unread: 3 }] }, residue: ["scope"], status: "complete" };
    expect(readCoverageOf({ args: {}, contentItems: text(answer), tool: "slack_unread" })).toEqual({ kind: "whole" });
  });

  it("reads zero and empty Slack markers, and the standing bot-token caveat, as whole", () => {
    const answer = {
      cut: [],
      olderExist: false,
      omitted: 0,
      repliesNotRead: 0,
      warnings: ["read with the BOT token: a private conversation the bot is not in cannot be read"],
    };
    expect(readCoverageOf({ args: {}, contentItems: text(answer), tool: "slack_channel" })).toEqual({ kind: "whole" });
  });

  it("reads a whole Queue answer, prose, and an image as whole", () => {
    const whole = { beyondCap: { marked: false, more: false, parked: false }, complete: true, cut: undefined };
    const items = [
      ...text(whole),
      { text: "not json at all", type: "inputText" as const },
      { imageUrl: "data:image/png;base64,AA==", type: "inputImage" as const },
    ];
    expect(readCoverageOf({ args: {}, contentItems: items, tool: "action_items" })).toEqual({ kind: "whole" });
  });

  // A window's `shows` is text, so the reading's own `drawnMore` was a fragment no probe
  // read, and its last window read as whole.
  it("keeps the whole reading's own cut on every window of it, the last one included", () => {
    const view: PageView = {
      open: undefined,
      openBy: undefined,
      path: "/queue",
      shows: { body: "x".repeat(20_000), drawnMore: 1 },
      title: "Queue",
    };
    const windows = [pageRead({ maxBytes: 16_384, view }) as PageReadWindow];
    while (windows.at(-1)!.nextFrom !== undefined) {
      const { nextFrom, path, reading } = windows.at(-1)!;
      windows.push(pageReadOn({ args: { from: nextFrom, path, reading }, maxBytes: 16_384, view }) as PageReadWindow);
    }
    expect(windows.length).toBe(2);
    expect(windows.map((one) => one.readingCuts)).toEqual([["shows.drawnMore: 1"], ["shows.drawnMore: 1"]]);
    const last = windows.at(-1)!;
    const coverage = readCoverageOf({
      args: { from: last.start, path: last.path, reading: last.reading },
      contentItems: text(last),
      tool: "read_page",
    });
    expect(coverage).toEqual({
      gaps: [{ continuation: undefined, source: "read_page", what: "readingCuts: shows.drawnMore: 1" }],
      kind: "partial",
    });
  });

  // The cuts were read off the object, the windows off its `toJSON` text, so a reading
  // serialised through `toJSON` carried no cut and its last window read as whole.
  it("reads the reading's own cuts off the text its windows cut, a reading serialised through toJSON included", () => {
    const view: PageView = {
      open: undefined,
      openBy: undefined,
      path: "/queue",
      shows: { toJSON: () => ({ body: "x".repeat(20_000), drawnMore: 1 }) },
      title: "Queue",
    };
    const first = pageRead({ maxBytes: 16_384, view }) as PageReadWindow;
    expect(first.readingCuts).toEqual(["shows.drawnMore: 1"]);
  });

  // A cut quoting a 20,000-character marker passed the bound and crowded out every window.
  it("cuts a whole reading's long cut, so the window and its read on still fit under the bound", () => {
    const view: PageView = {
      open: undefined,
      openBy: undefined,
      path: "/queue",
      shows: { hiddenByContext: "x".repeat(20_000) },
      title: "Queue",
    };
    const window = pageRead({ maxBytes: 16_384, view }) as PageReadWindow;
    const bytes = new TextEncoder().encode(JSON.stringify(window)).length;
    expect([window.path, window.nextFrom! > 0, bytes <= 16_384, window.readingCuts]).toEqual([
      "/queue",
      true,
      true,
      [`shows.hiddenByContext: ${"x".repeat(177)}… (cut at 200 characters)`],
    ]);
  });

  // The reading's own cuts filled the room and the sentence blamed the path alone.
  it("names the reading's own cuts when they and the page's fields leave no room for a window", () => {
    const shows = { body: "z".repeat(20_000), drawnMore: "x".repeat(1000), hiddenByContext: "x".repeat(1000) };
    const viewAt = ({ length }: { length: number }): PageView => ({
      open: undefined,
      openBy: undefined,
      path: `/${"p".repeat(length)}`,
      shows,
      title: "T",
    });
    // The shortest path at which no window fits: one byte of path shorter still carries one.
    let length = 15_000;
    while (pageRead({ maxBytes: 16_384, view: viewAt({ length }) }).shows !== "") {
      length += 1;
    }
    const view = viewAt({ length });
    const read = pageRead({ maxBytes: 16_384, view }) as PageReadWindow;
    const size = new TextEncoder().encode(JSON.stringify(shows)).length;
    expect([read.path, read.nextFrom, read.readOn, read.readingCuts!.length, read.truncated]).toEqual([
      view.path,
      undefined,
      undefined,
      2,
      `no room beside this page's path, title, open card and reading cuts under the 16384-byte bound for any of its ${String(size)}-byte reading`,
    ]);
  });
});

describe("toolArgsOf", () => {
  it("parses an arguments object and answers an empty one for anything else", () => {
    expect(toolArgsOf({ text: '{"path":"/a","from":3}' })).toEqual({ from: 3, path: "/a" });
    expect(toolArgsOf({ text: "[1,2]" })).toEqual({});
    expect(toolArgsOf({ text: "nope" })).toEqual({});
  });
});

describe("coverageLine", () => {
  it("names each cut and the exact call that reads on, or that none does", () => {
    const line = coverageLine({
      gaps: [
        {
          continuation: { arguments: { from: 9, path: "/a" }, tool: "file_read" },
          source: "/a",
          what: "bytes 0 to 9 of /a",
        },
        { continuation: undefined, source: "action_items", what: "more rows than the list carries" },
      ],
    });
    expect(line).toContain('bytes 0 to 9 of /a (read on with file_read {"from":9,"path":"/a"})');
    expect(line).toContain("more rows than the list carries (no tool reads the rest)");
    expect(line.startsWith("READ COVERAGE: this answer is partial: ")).toBe(true);
  });
});
