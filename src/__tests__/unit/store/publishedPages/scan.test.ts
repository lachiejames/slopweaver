/*
 * The scanner reads both page folders whole and byte-exact, passes over only Finder's `.DS_Store`, names EVERY link,
 * odd entry and unsafe name in one run, and leaves both folders exactly as it found them.
 *
 * Real temporary trees, per `.claude/rules/testing.md` (a filesystem round trip under the per-file sandbox). A name
 * that is not UTF-8 is not exercised here: APFS refuses to create one, so the case cannot be built on every machine
 * this lane runs on.
 */

import { createHash } from "node:crypto";
import { linkSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import { PublishedPagesImportErrors } from "../../../../store/publishedPages/errors.js";
import { scanPublishedPageSources } from "../../../../store/publishedPages/scan.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "pp-scan-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** Write a file under the home, creating its directories. */
function put({ path, text }: { path: string; text: string }): string {
  const full = join(home, path);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, text);
  return full;
}

/** Every path under the home with its size and modification time, to prove a scan changed nothing. */
function snapshot(): readonly string[] {
  return readdirSync(home, { recursive: true, withFileTypes: true }).map((entry) => {
    const path = join(entry.parentPath, entry.name);
    const stats = statSync(path, { bigint: true, throwIfNoEntry: false });
    return `${path} ${String(stats?.size)} ${String(stats?.mtimeNs)}`;
  });
}

describe("scanPublishedPageSources — what it reads", () => {
  it("reads nothing from a home with neither folder", async () => {
    expect(unwrap(await scanPublishedPageSources({ home }))).toEqual({
      finderMetadataSkipped: 0,
      histories: [],
      pages: [],
    });
  });

  it("reads every file of a page and a history whole, nested assets and hardlinks included, passing over Finder's file", async () => {
    put({ path: "pages/alpha/index.html", text: "<p>a</p>" });
    const shot = put({ path: "pages/alpha/media/shot.png", text: "png" });
    mkdirSync(join(home, "pages/beta"), { recursive: true });
    linkSync(shot, join(home, "pages/alpha/media/copy.png"));
    put({ path: "pages/.DS_Store", text: "finder" });
    put({ path: "pages/alpha/.DS_Store", text: "finder" });
    put({ path: "published-pages/alpha/latest.json", text: "{}" });
    const scan = unwrap(await scanPublishedPageSources({ home }));
    expect({
      finderMetadataSkipped: scan.finderMetadataSkipped,
      histories: scan.histories.map(({ name, files }) => ({ files: files.map((file) => file.relativePath), name })),
      pages: scan.pages.map(({ name, files }) => ({
        files: files.map(({ relativePath, bytes, sha256 }) => ({ relativePath, sha256, text: bytes.toString("utf8") })),
        name,
      })),
    }).toEqual({
      finderMetadataSkipped: 2,
      histories: [{ files: ["latest.json"], name: "alpha" }],
      pages: [
        {
          files: [
            { relativePath: "index.html", sha256: digestOf({ text: "<p>a</p>" }), text: "<p>a</p>" },
            { relativePath: "media/copy.png", sha256: digestOf({ text: "png" }), text: "png" },
            { relativePath: "media/shot.png", sha256: digestOf({ text: "png" }), text: "png" },
          ],
          name: "alpha",
        },
        { files: [], name: "beta" },
      ],
    });
  });

  it("leaves both folders exactly as it found them", async () => {
    put({ path: "pages/alpha/index.html", text: "<p>a</p>" });
    put({ path: "published-pages/alpha/latest.json", text: "{}" });
    const before = snapshot();
    unwrap(await scanPublishedPageSources({ home }));
    expect(snapshot()).toEqual(before);
  });
});

describe("scanPublishedPageSources — refusals", () => {
  it("names every symbolic link in one run — a page, an asset, a history and a version — and answers no scan", async () => {
    put({ path: "pages/alpha/index.html", text: "a" });
    const outside = put({ path: "outside.html", text: "x" });
    symlinkSync(outside, join(home, "pages/alpha/linked.png"));
    symlinkSync(join(home, "pages/alpha"), join(home, "pages/beta"));
    put({ path: "published-pages/alpha/latest.json", text: "{}" });
    symlinkSync(outside, join(home, "published-pages/alpha/v.html"));
    symlinkSync(join(home, "published-pages/alpha"), join(home, "published-pages/gamma"));
    expect(unwrapErr(await scanPublishedPageSources({ home }))).toEqual([
      PublishedPagesImportErrors.symbolicLink({ path: join(home, "pages/beta") }),
      PublishedPagesImportErrors.symbolicLink({ path: join(home, "pages/alpha/linked.png") }),
      PublishedPagesImportErrors.symbolicLink({ path: join(home, "published-pages/gamma") }),
      PublishedPagesImportErrors.symbolicLink({ path: join(home, "published-pages/alpha/v.html") }),
    ]);
  });

  it("refuses a root that is a link or not a directory", async () => {
    const target = join(home, "elsewhere");
    mkdirSync(target);
    symlinkSync(target, join(home, "pages"));
    put({ path: "published-pages", text: "a file" });
    expect(unwrapErr(await scanPublishedPageSources({ home }))).toEqual([
      PublishedPagesImportErrors.symbolicLink({ path: join(home, "pages") }),
      PublishedPagesImportErrors.entryKindUnsupported({
        found: "a regular file where a folder belongs",
        path: join(home, "published-pages"),
      }),
    ]);
  });

  it("refuses a name outside the page alphabet, and a loose file where a page directory belongs", async () => {
    put({ path: "pages/alpha/index.html", text: "a" });
    put({ path: "pages/alpha/my shot.png", text: "p" });
    put({ path: "pages/.hidden/index.html", text: "a" });
    put({ path: "pages/notes.txt", text: "n" });
    expect(unwrapErr(await scanPublishedPageSources({ home }))).toEqual([
      PublishedPagesImportErrors.entryNameUnsafe({ directory: join(home, "pages"), name: ".hidden" }),
      PublishedPagesImportErrors.entryNameUnsafe({ directory: join(home, "pages/alpha"), name: "my shot.png" }),
      PublishedPagesImportErrors.entryKindUnsupported({
        found: "a regular file where only page directories belong",
        path: join(home, "pages/notes.txt"),
      }),
    ]);
  });

  it("passes over only Finder's FILE: a directory named .DS_Store, at a root or deeper, is an unsafe name", async () => {
    put({ path: "pages/.DS_Store/index.html", text: "a" });
    put({ path: "published-pages/alpha/.DS_Store/latest.json", text: "{}" });
    expect(unwrapErr(await scanPublishedPageSources({ home }))).toEqual([
      PublishedPagesImportErrors.entryNameUnsafe({ directory: join(home, "pages"), name: ".DS_Store" }),
      PublishedPagesImportErrors.entryNameUnsafe({ directory: join(home, "published-pages/alpha"), name: ".DS_Store" }),
    ]);
  });
});

describe("scanPublishedPageSources — one page", () => {
  it("reads only the named page and history, never a sibling, even a broken one", async () => {
    put({ path: "pages/alpha/index.html", text: "a" });
    put({ path: "pages/alpha/media/shot.png", text: "p" });
    put({ path: "published-pages/alpha/latest.json", text: "{}" });
    put({ path: "pages/beta/index.html", text: "b" });
    symlinkSync(join(home, "pages/beta"), join(home, "pages/gamma"));
    put({ path: "pages/notes.txt", text: "n" });
    const scan = unwrap(await scanPublishedPageSources({ home, slug: "alpha" }));
    expect({
      histories: scan.histories.map(({ name, files }) => ({ files: files.map((file) => file.relativePath), name })),
      pages: scan.pages.map(({ name, files }) => ({ files: files.map((file) => file.relativePath), name })),
    }).toEqual({
      histories: [{ files: ["latest.json"], name: "alpha" }],
      pages: [{ files: ["index.html", "media/shot.png"], name: "alpha" }],
    });
  });

  it("reads an absent page or history as an empty side", async () => {
    put({ path: "pages/alpha/index.html", text: "a" });
    const scan = unwrap(await scanPublishedPageSources({ home, slug: "alpha" }));
    expect([scan.pages.map((page) => page.name), scan.histories.length]).toEqual([["alpha"], 0]);
  });

  it("still refuses a link, an unsafe nested name and a loose file within the named page", async () => {
    put({ path: "pages/alpha/index.html", text: "a" });
    put({ path: "pages/alpha/my shot.png", text: "p" });
    const outside = put({ path: "outside.html", text: "x" });
    symlinkSync(outside, join(home, "pages/alpha/linked.png"));
    put({ path: "published-pages/beta/latest.json", text: "{}" });
    symlinkSync(join(home, "published-pages/beta"), join(home, "published-pages/alpha"));
    expect(unwrapErr(await scanPublishedPageSources({ home, slug: "alpha" }))).toEqual([
      PublishedPagesImportErrors.entryNameUnsafe({ directory: join(home, "pages/alpha"), name: "my shot.png" }),
      PublishedPagesImportErrors.symbolicLink({ path: join(home, "pages/alpha/linked.png") }),
      PublishedPagesImportErrors.symbolicLink({ path: join(home, "published-pages/alpha") }),
    ]);
  });

  it("refuses a named page that is a file, and a slug outside the page alphabet without reading anything", async () => {
    put({ path: "pages/alpha", text: "a file" });
    expect([
      unwrapErr(await scanPublishedPageSources({ home, slug: "alpha" })),
      unwrapErr(await scanPublishedPageSources({ home, slug: "../alpha" })),
    ]).toEqual([
      [
        PublishedPagesImportErrors.entryKindUnsupported({
          found: "a regular file where only page directories belong",
          path: join(home, "pages/alpha"),
        }),
      ],
      [PublishedPagesImportErrors.entryNameUnsafe({ directory: join(home, "pages"), name: "../alpha" })],
    ]);
  });
});

/** The digest of a text. */
function digestOf({ text }: { text: string }): string {
  return createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
}
