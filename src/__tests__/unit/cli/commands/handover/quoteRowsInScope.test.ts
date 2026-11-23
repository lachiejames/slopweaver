/**
 * Which rows a `handover quote` run reads: the scope, the named slugs, and the files whose front matter does not
 * open them, so a run cannot pass over one silently.
 *
 * Per `testing.md`, every fixture is written under a directory this file minted.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { fencelessDocs, rowsToRead } from "../../../../../cli/commands/handover/quoteRowsInScope.js";
import { type HandoverDoc, parseHandoverDoc } from "../../../../../handover/doc.js";

const TURN = "a0000015-0000-4000-8000-000000000016";

/** A row's text, anchored on the owner's words or not. */
function rowText({ slug, anchor }: { slug: string; anchor: string | undefined }): string {
  const lines = ["---", `slug: ${slug}`, "kind: ask", "status: ready"];
  if (anchor !== undefined) {
    lines.push(`anchor: ${anchor}`);
  }
  return [...lines, "artifact: null", "---", "", "# body", ""].join("\n");
}

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "quote-scope-"));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

/** Write a row to the board and parse it as the scan would. */
function row({ slug, anchor, prefix }: { slug: string; anchor: string | undefined; prefix: string }): HandoverDoc {
  const path = join(dir, `${slug}.md`);
  const text = rowText({ anchor, slug });
  writeFileSync(path, `${prefix}${text}`);
  return parseHandoverDoc({ path, text });
}

describe("rowsToRead", () => {
  it("reads every row anchored on the owner's words, and no other, when no slug is named", () => {
    const docs = [
      row({ anchor: `talk:${TURN}`, prefix: "", slug: "anchored" }),
      row({ anchor: undefined, prefix: "", slug: "unanchored" }),
    ];

    const read = rowsToRead({ docs, slugs: [], unreadable: [] });

    expect(read.rows.map((doc) => doc.slug)).toEqual(["anchored"]);
    expect(read.unknown).toEqual([]);
  });

  it("calls a named slug outside the scope unknown, but never one whose file would not read", () => {
    const docs = [
      row({ anchor: `talk:${TURN}`, prefix: "", slug: "anchored" }),
      row({ anchor: undefined, prefix: "", slug: "unanchored" }),
    ];

    const read = rowsToRead({ docs, slugs: ["anchored", "unanchored", "broken"], unreadable: ["broken.md"] });

    expect(read.rows.map((doc) => doc.slug)).toEqual(["anchored"]);
    expect(read.unknown).toEqual(["unanchored"]);
  });
});

describe("fencelessDocs", () => {
  it("names a row whose front matter does not open the file, and one that is gone, but not a well-formed one", () => {
    const docs = [
      row({ anchor: `talk:${TURN}`, prefix: "", slug: "fenced" }),
      row({ anchor: `talk:${TURN}`, prefix: "﻿", slug: "bom" }),
      parseHandoverDoc({ path: join(dir, "gone.md"), text: rowText({ anchor: undefined, slug: "gone" }) }),
    ];

    expect(fencelessDocs({ docs })).toEqual(["bom.md", "gone.md"]);
  });
});
