/*
 * The store half of a page import writes only the difference: a held body is never re-sent, a disagreeing one
 * refuses, a version is dated by its import and never rewritten, a local page's files are made to match its folder
 * exactly, and a stored page the folders no longer hold is reported and left alone.
 */

import { describe, expect, it } from "vitest";

import { PublishedPagesImportErrors } from "../../../../store/publishedPages/errors.js";
import {
  blobRecord,
  blobsToWrite,
  fileChanges,
  heldBlobConflicts,
  pageRecord,
  storeOnlyKeys,
  versionRecords,
} from "../../../../store/publishedPages/importPlan.js";
import type { PlannedBlob, PlannedPage } from "../../../../store/publishedPages/project.js";

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);
const IMPORTED_AT = new Date("2026-11-09T01:00:00.000Z");

/** A planned body. */
function blob({ sha256, mediaType = "text/html" }: { sha256: string; mediaType?: string }): PlannedBlob {
  return { byteLength: 4, bytes: Buffer.from("body"), mediaType, sha256 };
}

/** A planned local page with the given files and versions. */
function localPage({
  pageKey,
  files = [],
  versionSha256s = [],
}: {
  pageKey: string;
  files?: PlannedPage["files"];
  versionSha256s?: readonly string[];
}): PlannedPage {
  return {
    canonicalAddress: `file:///home/acme/.slopweaver/pages/${pageKey}/index.html`,
    currentBodySha256: A,
    files,
    kind: "local",
    latestFrozenAt: null,
    latestFrozenBodySha256: null,
    pageKey,
    publishedAt: IMPORTED_AT,
    versionSha256s,
  };
}

describe("held bodies", () => {
  it("sends only the bodies the store does not hold, and refuses one held under another type or length", () => {
    const blobs = [blob({ sha256: A }), blob({ sha256: B }), blob({ mediaType: "image/png", sha256: C })];
    const held = new Map([
      [A, { byteLength: 4, mediaType: "text/html" }],
      [C, { byteLength: 4, mediaType: "text/plain" }],
    ]);
    expect(blobsToWrite({ blobs, held }).map((planned) => planned.sha256)).toEqual([B]);
    expect(heldBlobConflicts({ blobs, held })).toEqual([
      PublishedPagesImportErrors.heldBlobConflict({
        derived: "image/png, 4 bytes",
        held: "text/plain, 4 bytes",
        sha256: C,
      }),
    ]);
    expect(blobRecord({ blob: blobs[2]! })).toEqual({ bodySha256: C, byteLength: 4, mediaType: "image/png" });
  });

  it("finds no conflict when nothing is held", () => {
    expect(heldBlobConflicts({ blobs: [blob({ sha256: A })], held: new Map() })).toEqual([]);
  });
});

describe("rows", () => {
  it("dates every version by the import and marks it imported", () => {
    expect(
      versionRecords({
        context: { importedAt: IMPORTED_AT, kind: "import" },
        pages: [localPage({ pageKey: "alpha", versionSha256s: [A, B] })],
      }),
    ).toEqual([
      { bodySha256: A, firstFrozenAt: IMPORTED_AT, origin: "imported", pageKey: "alpha" },
      { bodySha256: B, firstFrozenAt: IMPORTED_AT, origin: "imported", pageKey: "alpha" },
    ]);
  });

  it("marks only a publish's own version published at its freeze, every other found version imported", () => {
    const frozenAt = new Date("2026-11-09T02:00:00.000Z");
    expect(
      versionRecords({
        context: { importedAt: IMPORTED_AT, kind: "publish", published: { bodySha256: B, frozenAt, pageKey: "alpha" } },
        pages: [
          localPage({ pageKey: "alpha", versionSha256s: [A, B] }),
          localPage({ pageKey: "beta", versionSha256s: [B] }),
        ],
      }),
    ).toEqual([
      { bodySha256: A, firstFrozenAt: IMPORTED_AT, origin: "imported", pageKey: "alpha" },
      { bodySha256: B, firstFrozenAt: frozenAt, origin: "published", pageKey: "alpha" },
      { bodySha256: B, firstFrozenAt: IMPORTED_AT, origin: "imported", pageKey: "beta" },
    ]);
  });

  it("writes a page row with exactly the page's fields", () => {
    expect(pageRecord({ page: localPage({ pageKey: "alpha" }) })).toEqual({
      canonicalAddress: "file:///home/acme/.slopweaver/pages/alpha/index.html",
      currentBodySha256: A,
      kind: "local",
      latestFrozenAt: null,
      latestFrozenBodySha256: null,
      pageKey: "alpha",
      publishedAt: IMPORTED_AT,
    });
  });
});

describe("fileChanges", () => {
  it("removes a file gone from the folder, writes a new or changed one, and leaves an unchanged one alone", () => {
    const pages = [
      localPage({
        files: [
          { bodySha256: A, relativePath: "index.html" },
          { bodySha256: C, relativePath: "media/new.png" },
          { bodySha256: B, relativePath: "media/changed.png" },
        ],
        pageKey: "alpha",
      }),
    ];
    const held = [
      { bodySha256: A, pageKey: "alpha", relativePath: "index.html" },
      { bodySha256: A, pageKey: "alpha", relativePath: "media/changed.png" },
      { bodySha256: B, pageKey: "alpha", relativePath: "media/gone.png" },
      { bodySha256: B, pageKey: "beta", relativePath: "index.html" },
    ];
    expect(fileChanges({ held, pages })).toEqual({
      removals: [{ pageKey: "alpha", relativePath: "media/gone.png" }],
      writes: [
        { bodySha256: C, pageKey: "alpha", relativePath: "media/new.png" },
        { bodySha256: B, pageKey: "alpha", relativePath: "media/changed.png" },
      ],
    });
  });

  it("changes nothing when the store already matches the folder", () => {
    const pages = [localPage({ files: [{ bodySha256: A, relativePath: "index.html" }], pageKey: "alpha" })];
    expect(fileChanges({ held: [{ bodySha256: A, pageKey: "alpha", relativePath: "index.html" }], pages })).toEqual({
      removals: [],
      writes: [],
    });
  });

  it("never touches the files of a page whose folder is gone, only its history seen", () => {
    const history: PlannedPage = { ...localPage({ pageKey: "alpha" }), files: [], kind: "history-only" };
    expect(
      fileChanges({ held: [{ bodySha256: A, pageKey: "alpha", relativePath: "index.html" }], pages: [history] }),
    ).toEqual({
      removals: [],
      writes: [],
    });
  });
});

describe("storeOnlyKeys", () => {
  it("reports the stored pages no folder holds, sorted", () => {
    const stored = ["zeta", "alpha", "beta"].map((key) => ({ key, kind: "local" }));
    expect(storeOnlyKeys({ pages: [localPage({ pageKey: "alpha" })], stored })).toEqual(["beta", "zeta"]);
  });

  it("reports a stored page whose folder is gone though its history remains, and never a history being promoted", () => {
    const history: PlannedPage = { ...localPage({ pageKey: "alpha" }), files: [], kind: "history-only" };
    const stored = [
      { key: "alpha", kind: "local" },
      { key: "beta", kind: "history-only" },
      { key: "gamma", kind: "history-only" },
    ];
    const pages = [history, localPage({ pageKey: "beta" }), { ...history, pageKey: "gamma" }];
    expect(storeOnlyKeys({ pages, stored })).toEqual(["alpha"]);
  });
});
