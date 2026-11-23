import { describe, expect, it } from "vitest";

import { unwrap } from "../../../../lib/result.js";
import {
  completeRow,
  distinctDigests,
  frozenPointerOf,
  TITLE_HEAD_BYTES,
  titleOfBody,
} from "../../../../store/publishedPages/read.js";
import { PublishedPagesReadErrors } from "../../../../store/publishedPages/readErrors.js";

const SHA = "a".repeat(64);
const OTHER = "b".repeat(64);
const AT = new Date("2026-11-09T05:00:00.000Z");

describe("frozenPointerOf", () => {
  it("answers the pointer when the row names one of the page's versions", () => {
    const pointer = frozenPointerOf({
      pageKey: "acme-brief",
      row: { frozenAt: AT, sha256: SHA },
      versionDigests: [OTHER, SHA],
    });

    expect(pointer.isOk()).toBe(true);
    expect(unwrap(pointer)).toEqual({ frozenAt: AT, sha256: SHA });
  });

  it("refuses a key the store holds no row for as never frozen", () => {
    const pointer = frozenPointerOf({ pageKey: "acme-brief", row: undefined, versionDigests: [] });

    expect(pointer._unsafeUnwrapErr().code).toBe("PAGES_NEVER_FROZEN");
  });

  it("refuses a page whose pointer is null and that has no versions as never frozen", () => {
    const pointer = frozenPointerOf({
      pageKey: "acme-brief",
      row: { frozenAt: null, sha256: null },
      versionDigests: [],
    });

    expect(pointer._unsafeUnwrapErr().code).toBe("PAGES_NEVER_FROZEN");
  });

  it("refuses versions with no pointer as inconsistent, never as never frozen", () => {
    const pointer = frozenPointerOf({
      pageKey: "acme-brief",
      row: { frozenAt: null, sha256: null },
      versionDigests: [SHA, OTHER, "c".repeat(64)],
    });

    expect(pointer._unsafeUnwrapErr().message).toBe(
      "the store's rows for acme-brief contradict each other: it holds 3 frozen version(s) and no latest freeze. " +
        "Re-run `slopweaver store pages-import`",
    );
  });

  it("refuses a pointer with no version behind it as inconsistent", () => {
    const pointer = frozenPointerOf({ pageKey: "acme-brief", row: { frozenAt: AT, sha256: SHA }, versionDigests: [] });

    expect(pointer._unsafeUnwrapErr().code).toBe("PAGES_READ_INCONSISTENT");
  });

  it("refuses a pointer naming none of the page's versions, though it holds another", () => {
    const pointer = frozenPointerOf({
      pageKey: "acme-brief",
      row: { frozenAt: AT, sha256: SHA },
      versionDigests: [OTHER],
    });

    expect(pointer._unsafeUnwrapErr().message).toBe(
      `the store's rows for acme-brief contradict each other: its latest freeze ${SHA} is none of its 1 frozen ` +
        "version(s). Re-run `slopweaver store pages-import`",
    );
  });
});

describe("titleOfBody", () => {
  const encode = ({ html }: { html: string }): Uint8Array => new TextEncoder().encode(html);

  it("reads the title from the document's head", () => {
    expect(titleOfBody({ bytes: encode({ html: "<html><head><title>Acme &amp; co</title></head></html>" }) })).toBe(
      "Acme & co",
    );
  });

  it("answers nothing for a document with no title", () => {
    expect(titleOfBody({ bytes: encode({ html: "<html><body>no title</body></html>" }) })).toBe(undefined);
  });

  it("misses a title past the head bound, as the disk read always did", () => {
    const padding = " ".repeat(TITLE_HEAD_BYTES);

    expect(titleOfBody({ bytes: encode({ html: `<html>${padding}<title>Too deep</title></html>` }) })).toBe(undefined);
  });
});

describe("completeRow", () => {
  it("answers a page carrying its document, size and instant", () => {
    const row = { byteLength: 12, pageKey: "acme-brief", publishedAt: AT, sha256: SHA };

    expect(unwrap(completeRow({ row }))).toEqual(row);
  });

  it("refuses a page whose current body has no row, rather than leaving it out of the list", () => {
    const row = { byteLength: null, pageKey: "acme-dangling", publishedAt: AT, sha256: SHA };

    expect(completeRow({ row })._unsafeUnwrapErr().message).toBe(
      `the store's rows for acme-dangling contradict each other: its current document ${SHA} has no body row. ` +
        "Re-run `slopweaver store pages-import`",
    );
  });

  it("refuses a local page with no current document", () => {
    const row = { byteLength: null, pageKey: "acme-empty", publishedAt: null, sha256: null };

    expect(completeRow({ row })._unsafeUnwrapErr().code).toBe("PAGES_READ_INCONSISTENT");
  });
});

describe("distinctDigests", () => {
  it("downloads a body shared by two pages once, in first-seen order", () => {
    expect(distinctDigests({ digests: ["b", "a", "b", "c", "a"] })).toEqual(["b", "a", "c"]);
  });

  it("answers nothing for no pages", () => {
    expect(distinctDigests({ digests: [] })).toEqual([]);
  });
});

describe("PublishedPagesReadErrors", () => {
  it("names the step that threw and its cause", () => {
    const error = PublishedPagesReadErrors.unavailable({ cause: new Error("socket hang up"), doing: "be opened" });

    expect(error.message).toBe("the published-page store did not be opened: socket hang up");
  });

  it("tells a never-frozen key how to get a freeze", () => {
    expect(PublishedPagesReadErrors.neverFrozen({ pageKey: "acme-brief" }).message).toContain(
      "slopweaver page publish",
    );
  });
});
