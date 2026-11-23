/**
 * What `store hits`, `store peek` and `store open` print for one record — and the word each prints for an
 * author, container or title the record does not carry.
 */
import { describe, expect, it } from "vitest";

import { hitLine, openLines, peekLines } from "../../../../../cli/commands/store/probeLines.js";
import type { RecordHead } from "../../../../../store/probe/head.js";

/** One record's head, with nothing resolved: no author, no container, no title. */
const head = (over: Partial<RecordHead> = {}): RecordHead => ({
  author: null,
  authorNativeId: null,
  container: null,
  id: "r-1",
  kind: "issue",
  occurredAt: "2026-10-02T03:04:05Z",
  source: "linear",
  sourceId: "ENG-1",
  title: null,
  url: "https://example.test/ENG-1",
  ...over,
});

describe("hitLine", () => {
  it("prints (unknown) for a record whose author resolved to nobody", () => {
    expect(hitLine({ hit: head() })).toBe("r-1  linear  2026-10-02T03:04:05Z  (unknown)  https://example.test/ENG-1");
  });

  it("prints the resolved author when there is one", () => {
    expect(hitLine({ hit: head({ author: "Ari" }) })).toBe(
      "r-1  linear  2026-10-02T03:04:05Z  Ari  https://example.test/ENG-1",
    );
  });
});

describe("peekLines", () => {
  it("names each missing field for what it means", () => {
    expect(peekLines({ peek: { ...head(), bodyChars: 30, excerpt: "a\nb", from: 4 } })).toEqual([
      "r-1  linear  2026-10-02T03:04:05Z  (unknown)  (no container)",
      "  (no title)",
      "  [4..7 of 30] a\n  b",
      "",
    ]);
  });

  it("prints the author, container and title a record carries", () => {
    const peek = {
      ...head({ author: "Rosa", container: "ENG", title: "Pool exhaust" }),
      bodyChars: 2,
      excerpt: "ok",
      from: 0,
    };
    expect(peekLines({ peek }).slice(0, 2)).toEqual(["r-1  linear  2026-10-02T03:04:05Z  Rosa  ENG", "  Pool exhaust"]);
  });
});

describe("openLines", () => {
  it("prints (unknown) and (none) for a record with no author or container, and no title line", () => {
    expect(openLines({ record: { ...head(), body: "whole body", refs: [] } })).toEqual([
      "--- r-1  linear/issue  2026-10-02T03:04:05Z",
      "author: (unknown)   container: (none)",
      "url: https://example.test/ENG-1",
      "",
      "whole body",
      "",
    ]);
  });

  it("prints the resolved names, the title and the links a record carries", () => {
    const record = {
      ...head({ author: "Ari", container: "ENG", title: "Pool" }),
      body: "b",
      refs: ["https://x.test"],
    };
    expect(openLines({ record }).slice(1, 4)).toEqual([
      "author: Ari   container: ENG",
      "url: https://example.test/ENG-1",
      "title: Pool",
    ]);
    expect(openLines({ record }).slice(-2)).toEqual(["links: https://x.test", ""]);
  });
});
