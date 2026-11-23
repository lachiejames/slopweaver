/*
 * `store pages-import`'s parser takes exactly its three flags, and its report says what the folders hold, that a
 * refusal wrote nothing, that a dry run opened no connection, and every store-only page it left alone.
 */

import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import {
  type PagesImportReport,
  pagesImportLines,
  parsePagesImportArgs,
} from "../../../../cli/commands/store/pagesImportCore.js";
import type { PublishedPagesCounts } from "../../../../store/publishedPages/project.js";

const COUNTS: PublishedPagesCounts = {
  bytes: 4096,
  distinctBodies: 5,
  files: 4,
  finderMetadataSkipped: 1,
  historiesWithoutPage: 1,
  localPages: 2,
  publishedAtFromFreeze: 1,
  publishedAtFromModified: 1,
  unservedFiles: 0,
  versions: 3,
};

const COUNT_LINES = [
  "store pages-import: 2 page(s) and 1 history(ies) with no page; 4 file(s), 3 version(s), 5 distinct body(ies), 4096 bytes",
  "published at: 1 from the freeze matching the page, 1 from the page file's modification time",
  "0 file(s) no reader serves carried as opaque bytes; 1 Finder .DS_Store file(s) passed over",
];

describe("parsePagesImportArgs", () => {
  it("defaults to a real, human-read run in the ambient home", () => {
    expect(unwrap(parsePagesImportArgs({ argv: [] }))).toEqual({ dryRun: false, home: undefined, json: false });
  });

  it("reads every flag it advertises", () => {
    expect(unwrap(parsePagesImportArgs({ argv: ["--json", "--home", "/h", "--dry-run"] }))).toEqual({
      dryRun: true,
      home: "/h",
      json: true,
    });
  });

  it("names every problem at once: an unknown flag and a --home with no directory", () => {
    expect(unwrapErr(parsePagesImportArgs({ argv: ["--force", "--home"] }))).toEqual([
      "unexpected argument: --force",
      "--home needs a directory",
    ]);
  });
});

describe("pagesImportLines", () => {
  it("says a dry run wrote nothing, opened no connection and so could not count store-only pages", () => {
    const report: PagesImportReport = { counts: COUNTS, dryRun: true, refusals: [], writes: undefined };
    expect(pagesImportLines({ report })).toEqual([
      ...COUNT_LINES,
      "DRY RUN — nothing was written and no connection was opened, so store-only pages were not counted",
    ]);
  });

  it("says a refusal wrote nothing and names each one, with no counts when the folders were refused", () => {
    const report: PagesImportReport = {
      counts: undefined,
      dryRun: false,
      refusals: ["/h/pages/a is a symbolic link", "/h/pages/b.txt is a regular file"],
      writes: undefined,
    };
    expect(pagesImportLines({ report })).toEqual([
      "2 refusal(s), so nothing was uploaded or written:",
      "  /h/pages/a is a symbolic link",
      "  /h/pages/b.txt is a regular file",
    ]);
  });

  it("spells twenty refusals and summarises the rest", () => {
    const refusals = Array.from({ length: 23 }, (_, index) => `refusal ${String(index)}`);
    const lines = pagesImportLines({ report: { counts: undefined, dryRun: false, refusals, writes: undefined } });
    expect(lines).toHaveLength(22);
    expect(lines[20]).toBe("  refusal 19");
    expect(lines[21]).toBe("  … and 3 more");
  });

  it("reports what a real run wrote and every store-only page it left alone", () => {
    const report: PagesImportReport = {
      counts: COUNTS,
      dryRun: false,
      refusals: [],
      writes: {
        blobs: 5,
        filesRemoved: 1,
        filesWritten: 4,
        objects: 5,
        pages: 3,
        storeOnlyPages: ["acme-orphan"],
        versions: 3,
      },
    };
    expect(pagesImportLines({ report })).toEqual([
      ...COUNT_LINES,
      "written: 5 object(s), 5 body row(s), 3 page row(s), 3 version(s), 4 file row(s); 1 file row(s) removed",
      "store-only pages, left untouched: 1",
      "  acme-orphan",
    ]);
  });
});
