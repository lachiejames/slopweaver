/*
 * Both page folders project into exactly the rows and bodies an import writes — a page joined to its history by
 * slug, a history with no page kept as one, the pointer's `path` never trusted — and every defect refuses the whole
 * import with the code that names it.
 */

import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import { PublishedPagesImportErrors } from "../../../../store/publishedPages/errors.js";
import { projectPublishedPages } from "../../../../store/publishedPages/project.js";
import type { PublishedPagesScan, ScannedDirectory, ScannedFile } from "../../../../store/publishedPages/scan.js";

const HOME = "/home/acme/.slopweaver";
const MODIFIED = new Date("2026-11-01T10:00:00.000Z");
const FROZEN_ISO = "2026-10-30T09:15:00.000Z";

/** A file whose digest is computed from its text, as the scanner computes it. */
function file({ relativePath, text }: { relativePath: string; text: string }): ScannedFile {
  const bytes = Buffer.from(text, "utf8");
  return { bytes, modifiedAt: MODIFIED, relativePath, sha256: createHash("sha256").update(bytes).digest("hex") };
}

/** The digest of a text. */
function digestOf({ text }: { text: string }): string {
  return createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
}

/** A frozen version file, named by its own digest. */
function version({ text }: { text: string }): ScannedFile {
  return file({ relativePath: `${digestOf({ text })}.html`, text });
}

/** A `latest.json` pointing at a text's digest. */
function pointer({ key, text, path = "/elsewhere/x.html" }: { key: string; text: string; path?: string }): ScannedFile {
  return file({
    relativePath: "latest.json",
    text: JSON.stringify({ frozenIso: FROZEN_ISO, key, path, sha256: `sha256:${digestOf({ text })}` }),
  });
}

/** A scan of the given directories. */
function scanOf({
  pages = [],
  histories = [],
}: {
  pages?: readonly ScannedDirectory[];
  histories?: readonly ScannedDirectory[];
}): PublishedPagesScan {
  return { finderMetadataSkipped: 1, histories, pages };
}

describe("projectPublishedPages — what an import writes", () => {
  it("joins a page to its history by slug, dates it by the freeze it matches, and stores one body per digest", () => {
    const plan = unwrap(
      projectPublishedPages({
        home: HOME,
        scan: scanOf({
          histories: [
            {
              files: [
                pointer({ key: "alpha", text: "<p>v2</p>" }),
                version({ text: "<p>v1</p>" }),
                version({ text: "<p>v2</p>" }),
              ],
              name: "alpha",
            },
          ],
          pages: [
            {
              files: [
                file({ relativePath: "index.html", text: "<p>v2</p>" }),
                file({ relativePath: "media/shot.png", text: "png" }),
              ],
              name: "alpha",
            },
          ],
        }),
      }),
    );
    expect(plan.pages).toEqual([
      {
        canonicalAddress: "file:///home/acme/.slopweaver/pages/alpha/index.html",
        currentBodySha256: digestOf({ text: "<p>v2</p>" }),
        files: [
          { bodySha256: digestOf({ text: "<p>v2</p>" }), relativePath: "index.html" },
          { bodySha256: digestOf({ text: "png" }), relativePath: "media/shot.png" },
        ],
        kind: "local",
        latestFrozenAt: new Date(FROZEN_ISO),
        latestFrozenBodySha256: digestOf({ text: "<p>v2</p>" }),
        pageKey: "alpha",
        publishedAt: new Date(FROZEN_ISO),
        versionSha256s: [digestOf({ text: "<p>v1</p>" }), digestOf({ text: "<p>v2</p>" })],
      },
    ]);
    expect(plan.blobs.map(({ sha256, byteLength, mediaType }) => ({ byteLength, mediaType, sha256 }))).toEqual(
      [
        { byteLength: 3, mediaType: "image/png", sha256: digestOf({ text: "png" }) },
        { byteLength: 9, mediaType: "text/html", sha256: digestOf({ text: "<p>v1</p>" }) },
        { byteLength: 9, mediaType: "text/html", sha256: digestOf({ text: "<p>v2</p>" }) },
      ].toSorted((a, b) => a.sha256.localeCompare(b.sha256)),
    );
  });

  it("dates a page by its file when it has no history, or when its file is newer than its latest freeze", () => {
    const plan = unwrap(
      projectPublishedPages({
        home: HOME,
        scan: scanOf({
          histories: [{ files: [pointer({ key: "beta", text: "old" }), version({ text: "old" })], name: "beta" }],
          pages: [
            { files: [file({ relativePath: "index.html", text: "fresh" })], name: "alpha" },
            { files: [file({ relativePath: "index.html", text: "new" })], name: "beta" },
          ],
        }),
      }),
    );
    expect(
      plan.pages.map(({ pageKey, publishedAt, latestFrozenBodySha256, latestFrozenAt }) => ({
        latestFrozenAt,
        latestFrozenBodySha256,
        pageKey,
        publishedAt,
      })),
    ).toEqual([
      { latestFrozenAt: null, latestFrozenBodySha256: null, pageKey: "alpha", publishedAt: MODIFIED },
      {
        latestFrozenAt: new Date(FROZEN_ISO),
        latestFrozenBodySha256: digestOf({ text: "old" }),
        pageKey: "beta",
        publishedAt: MODIFIED,
      },
    ]);
    expect([plan.counts.publishedAtFromFreeze, plan.counts.publishedAtFromModified]).toEqual([0, 2]);
  });

  it("keeps a history with no page as a history-only row, with no address, file or current body", () => {
    const plan = unwrap(
      projectPublishedPages({
        home: HOME,
        scan: scanOf({
          histories: [{ files: [pointer({ key: "abc123", text: "x" }), version({ text: "x" })], name: "abc123" }],
        }),
      }),
    );
    expect(plan.pages).toEqual([
      {
        canonicalAddress: null,
        currentBodySha256: null,
        files: [],
        kind: "history-only",
        latestFrozenAt: new Date(FROZEN_ISO),
        latestFrozenBodySha256: digestOf({ text: "x" }),
        pageKey: "abc123",
        publishedAt: null,
        versionSha256s: [digestOf({ text: "x" })],
      },
    ]);
  });

  it("carries a file no reader serves as opaque bytes, and counts everything", () => {
    const plan = unwrap(
      projectPublishedPages({
        home: HOME,
        scan: scanOf({
          histories: [
            { files: [pointer({ key: "alpha", text: "a" }), version({ text: "a" })], name: "alpha" },
            { files: [pointer({ key: "gone", text: "g" }), version({ text: "g" })], name: "gone" },
          ],
          pages: [
            {
              files: [
                file({ relativePath: "index.html", text: "a" }),
                file({ relativePath: "measure/scan.ts", text: "ts" }),
              ],
              name: "alpha",
            },
          ],
        }),
      }),
    );
    expect(plan.blobs.find((blob) => blob.sha256 === digestOf({ text: "ts" }))!.mediaType).toBe(
      "application/octet-stream",
    );
    expect(plan.counts).toEqual({
      bytes: 4,
      distinctBodies: 3,
      files: 2,
      finderMetadataSkipped: 1,
      historiesWithoutPage: 1,
      localPages: 1,
      publishedAtFromFreeze: 1,
      publishedAtFromModified: 0,
      unservedFiles: 1,
      versions: 2,
    });
  });

  it("projects an empty scan to nothing", () => {
    expect(unwrap(projectPublishedPages({ home: HOME, scan: scanOf({}) })).pages).toEqual([]);
  });
});

describe("projectPublishedPages — refusals", () => {
  /** The refusal codes a single history directory's files earn. */
  function historyRefusal({ files }: { files: readonly ScannedFile[] }): readonly string[] {
    return unwrapErr(
      projectPublishedPages({ home: HOME, scan: scanOf({ histories: [{ files, name: "alpha" }] }) }),
    ).map(({ code }) => code);
  }

  it("names each defect in a history directory", () => {
    expect([
      historyRefusal({ files: [] }),
      historyRefusal({ files: [version({ text: "a" })] }),
      historyRefusal({
        files: [pointer({ key: "alpha", text: "a" }), file({ relativePath: "notes.html", text: "a" })],
      }),
      historyRefusal({
        files: [
          pointer({ key: "alpha", text: "a" }),
          file({ relativePath: `sub/${digestOf({ text: "a" })}.html`, text: "a" }),
        ],
      }),
      historyRefusal({
        files: [
          pointer({ key: "alpha", text: "a" }),
          file({ relativePath: `${digestOf({ text: "b" })}.html`, text: "a" }),
        ],
      }),
      historyRefusal({ files: [pointer({ key: "alpha", text: "b" }), version({ text: "a" })] }),
    ]).toEqual([
      ["PAGES_HISTORY_EMPTY"],
      ["PAGES_LATEST_MISSING"],
      ["PAGES_VERSION_NAME_INVALID"],
      ["PAGES_VERSION_NAME_INVALID"],
      ["PAGES_VERSION_DIGEST_MISMATCH"],
      ["PAGES_LATEST_VERSION_MISSING"],
    ]);
  });

  it("refuses a pointer that is not JSON, not the freeze store's shape, or names another key", () => {
    const refusals = [
      file({ relativePath: "latest.json", text: "{not json" }),
      file({ relativePath: "latest.json", text: JSON.stringify({ key: "alpha", sha256: "sha256:abc" }) }),
      pointer({ key: "beta", text: "a" }),
    ].flatMap((latest) =>
      unwrapErr(
        projectPublishedPages({
          home: HOME,
          scan: scanOf({ histories: [{ files: [latest, version({ text: "a" })], name: "alpha" }] }),
        }),
      ),
    );
    expect(refusals.map(({ code }) => code)).toEqual([
      "PAGES_LATEST_INVALID",
      "PAGES_LATEST_INVALID",
      "PAGES_LATEST_INVALID",
    ]);
    expect(refusals[2]!.message).toContain("it names key beta");
  });

  it("names every defect across directories in one run, not only the first", () => {
    const refusals = unwrapErr(
      projectPublishedPages({
        home: HOME,
        scan: scanOf({
          histories: [{ files: [version({ text: "a" })], name: "alpha" }],
          pages: [{ files: [file({ relativePath: "shot.png", text: "p" })], name: "beta" }],
        }),
      }),
    );
    expect(refusals).toEqual([
      PublishedPagesImportErrors.latestMissing({ path: "/home/acme/.slopweaver/published-pages/alpha" }),
      PublishedPagesImportErrors.indexMissing({ path: "/home/acme/.slopweaver/pages/beta" }),
    ]);
  });

  it("never reads the pointer's path, so a path naming another home changes nothing", () => {
    const plan = unwrap(
      projectPublishedPages({
        home: HOME,
        scan: scanOf({
          histories: [
            {
              files: [pointer({ key: "alpha", path: "/etc/passwd", text: "a" }), version({ text: "a" })],
              name: "alpha",
            },
          ],
        }),
      }),
    );
    expect(plan.pages[0]!.latestFrozenBodySha256).toBe(digestOf({ text: "a" }));
  });

  it("refuses a page with no index.html", () => {
    const refusal = unwrapErr(
      projectPublishedPages({
        home: HOME,
        scan: scanOf({ pages: [{ files: [file({ relativePath: "shot.png", text: "p" })], name: "alpha" }] }),
      }),
    );
    expect(refusal.map(({ code, message }) => ({ code, message }))).toEqual([
      {
        code: "PAGES_INDEX_MISSING",
        message:
          "/home/acme/.slopweaver/pages/alpha carries no regular index.html, so it is not a page a reader can open",
      },
    ]);
  });

  it("refuses one body claimed under two media types, naming both paths", () => {
    const refusal = unwrapErr(
      projectPublishedPages({
        home: HOME,
        scan: scanOf({
          pages: [
            {
              files: [
                file({ relativePath: "index.html", text: "same" }),
                file({ relativePath: "copy.txt", text: "same" }),
              ],
              name: "alpha",
            },
          ],
        }),
      }),
    );
    expect(refusal).toEqual([
      {
        code: "PAGES_BODY_MEDIA_CONFLICT",
        message: `one body (${digestOf({ text: "same" })}) derives two media types — /home/acme/.slopweaver/pages/alpha/index.html (text/html) and /home/acme/.slopweaver/pages/alpha/copy.txt (text/plain) — and a stored body carries one; rename the file whose extension is wrong`,
        paths: [
          "/home/acme/.slopweaver/pages/alpha/index.html (text/html)",
          "/home/acme/.slopweaver/pages/alpha/copy.txt (text/plain)",
        ],
        sha256: digestOf({ text: "same" }),
      },
    ]);
  });
});
