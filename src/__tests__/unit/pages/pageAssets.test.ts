/**
 * `preparePageAssets` over real temp directories (testing.md's fixture allowance): what a publish reads from
 * `--assets-from` or a publisher's own list, and every way it refuses rather than storing a page broken.
 */
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { PageAssetErrors } from "../../../pages/pageAssetErrors.js";
import {
  type PageAssetSource,
  preparePageAssets,
  readStayedSettled,
  readStayedUnderRoot,
  resolvedRootStayed,
} from "../../../pages/pageAssets.js";
import { wrapPageFragment } from "../../../pages/shell.js";

describe("preparePageAssets", () => {
  let root = "";

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "page-assets-"));
  });

  afterEach(() => {
    rmSync(root, { force: true, recursive: true });
  });

  /** Read what `fragment` loads from `source`, as `acme-page`. */
  const prepare = ({ fragment, source }: { fragment: string; source: PageAssetSource | undefined }) =>
    preparePageAssets({ document: wrapPageFragment({ fragment }), slug: "acme-page", source });

  /** Write `text` at `relativePath` under the root, its directories made. */
  const put = ({ relativePath, text }: { relativePath: string; text: string }): void => {
    const path = join(root, relativePath);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, text);
  };

  it("reads each loaded file once from the directory, then what a stylesheet among them loads", async () => {
    put({ relativePath: "images/a.png", text: "PNG" });
    put({ relativePath: "css/page.css", text: ".a { background: url(../images/b.png); }" });
    put({ relativePath: "images/b.png", text: "PNG-B" });
    put({ relativePath: "notes.txt", text: "not the page's" });

    const assets = unwrap(
      await prepare({
        fragment: '<link rel="stylesheet" href="css/page.css"><img src="images/a.png"><img src="images/a.png">',
        source: { kind: "directory", root },
      }),
    );

    expect(assets.map((asset) => [asset.relativePath, asset.bytes.toString("utf8")])).toEqual([
      ["css/page.css", ".a { background: url(../images/b.png); }"],
      ["images/a.png", "PNG"],
      ["images/b.png", "PNG-B"],
    ]);
  });

  it("needs no source for a page that loads nothing", async () => {
    expect(unwrap(await prepare({ fragment: "<p>plain</p>", source: undefined }))).toEqual([]);
  });

  it("refuses a page that loads files when no source is named", async () => {
    expect(unwrapErr(await prepare({ fragment: '<img src="images/a.png">', source: undefined }))).toEqual([
      PageAssetErrors.required({ references: ["images/a.png"] }),
    ]);
  });

  it("refuses a directory that is absent, a link or a file", async () => {
    put({ relativePath: "file", text: "x" });
    symlinkSync(root, join(root, "link"));
    const fragment = '<img src="a.png">';
    const refusals = [
      unwrapErr(await prepare({ fragment, source: { kind: "directory", root: join(root, "absent") } })),
      unwrapErr(await prepare({ fragment, source: { kind: "directory", root: join(root, "link") } })),
      unwrapErr(await prepare({ fragment, source: { kind: "directory", root: join(root, "file") } })),
    ];
    expect(refusals.map((refusal) => refusal.map((error) => error.message))).toEqual([
      [`--assets-from ${join(root, "absent")} does not exist`],
      [`--assets-from ${join(root, "link")} is a link; name the directory it points at`],
      [`--assets-from ${join(root, "file")} is not a directory`],
    ]);
  });

  it("refuses a named root that is a link even on a page that loads nothing", async () => {
    symlinkSync(root, join(root, "link"));
    const refused = unwrapErr(
      await prepare({ fragment: "<p>plain</p>", source: { kind: "directory", root: join(root, "link") } }),
    );
    expect(refused.map((error) => error.message)).toEqual([
      `--assets-from ${join(root, "link")} is a link; name the directory it points at`,
    ]);
  });

  it("gathers every missing or unsafe file and refuses the whole publish", async () => {
    mkdirSync(join(root, "images", "dir.png"), { recursive: true });
    mkdirSync(join(root, "elsewhere"));
    writeFileSync(join(root, "elsewhere", "c.png"), "PNG");
    symlinkSync(join(root, "elsewhere"), join(root, "linked"));

    const refused = unwrapErr(
      await prepare({
        fragment:
          '<img src="images/gone.png"><img src="missing/a.png"><img src="images/dir.png"><img src="linked/c.png">',
        source: { kind: "directory", root },
      }),
    );

    expect(refused).toEqual([
      PageAssetErrors.missing({
        reference: "images/gone.png",
        relativePath: "images/gone.png",
        where: `at ${join(root, "images", "gone.png")}`,
      }),
      PageAssetErrors.missing({ reference: "missing/a.png", relativePath: "missing/a.png", where: `under ${root}` }),
      PageAssetErrors.unsafe({
        relativePath: "images/dir.png",
        why: `is not a regular file (${join(root, "images", "dir.png")})`,
      }),
      PageAssetErrors.unsafe({ relativePath: "linked/c.png", why: "is reached through a link or a non-directory" }),
    ]);
  });

  it("refuses a file that is itself a link", async () => {
    put({ relativePath: "real.png", text: "PNG" });
    symlinkSync(join(root, "real.png"), join(root, "a.png"));

    const refused = unwrapErr(await prepare({ fragment: '<img src="a.png">', source: { kind: "directory", root } }));

    expect(refused).toEqual([
      PageAssetErrors.unsafe({ relativePath: "a.png", why: `is not a regular file (${join(root, "a.png")})` }),
    ]);
  });

  it("refuses a stylesheet that loads a file outside the page, never dropping it", async () => {
    put({ relativePath: "css/main.css", text: '@import "../../escape.css"; .a { background: url(a.png); }' });
    put({ relativePath: "css/a.png", text: "PNG" });

    const refused = unwrapErr(
      await prepare({ fragment: '<link rel="stylesheet" href="css/main.css">', source: { kind: "directory", root } }),
    );

    expect(refused).toEqual([
      PageAssetErrors.unsafe({ relativePath: "css/main.css", why: "loads ../../escape.css, outside the page" }),
    ]);
  });

  it("reads a publisher's own list by its renamed paths, refusing a file it does not hold", async () => {
    put({ relativePath: "shot.png", text: "SHOT" });
    const source: PageAssetSource = {
      files: [{ path: join(root, "shot.png"), relativePath: "media/1.png" }],
      kind: "files",
    };

    const read = unwrap(await prepare({ fragment: '<img src="media/1.png">', source }));
    const refused = unwrapErr(await prepare({ fragment: '<img src="media/2.png">', source }));

    expect(read.map((asset) => [asset.relativePath, asset.bytes.toString("utf8")])).toEqual([["media/1.png", "SHOT"]]);
    expect(refused).toEqual([
      PageAssetErrors.missing({
        reference: "media/2.png",
        relativePath: "media/2.png",
        where: "among the publisher's media",
      }),
    ]);
  });

  it("stores every file on a publisher's own list, a linked attachment no load names included", async () => {
    put({ relativePath: "dpa.pdf", text: "PDF" });
    const source: PageAssetSource = {
      files: [{ path: join(root, "dpa.pdf"), relativePath: "media/1.pdf" }],
      kind: "files",
    };

    const read = unwrap(await prepare({ fragment: '<a href="media/1.pdf">The signed DPA</a>', source }));

    expect(read.map((asset) => [asset.relativePath, asset.bytes.toString("utf8")])).toEqual([["media/1.pdf", "PDF"]]);
  });
});

describe("resolvedRootStayed", () => {
  it("accepts a root that resolved to the very directory checked, and refuses one swapped between", () => {
    const checked = { dev: 1, ino: 40 };
    expect([
      resolvedRootStayed({ checked, resolved: { dev: 1, ino: 40 } }),
      resolvedRootStayed({ checked, resolved: { dev: 1, ino: 41 } }),
      resolvedRootStayed({ checked, resolved: { dev: 2, ino: 40 } }),
    ]).toEqual([true, false, false]);
  });
});

describe("readStayedSettled", () => {
  const before = { ctimeMs: 2000, dev: 1, ino: 7, mtimeMs: 1000, size: 4 };

  it("accepts a read whose every stamp matches and which returned the whole file", () => {
    expect(readStayedSettled({ before, during: [before, before], length: 4 })).toBe(true);
  });

  it("refuses a same-size overwrite in place whose modification time was put back", () => {
    const rewritten = { ...before, ctimeMs: 2500 };
    expect(readStayedSettled({ before, during: [before, rewritten], length: 4 })).toBe(false);
  });

  it("refuses a file replaced by another inode, resized, or read short", () => {
    expect([
      readStayedSettled({ before, during: [{ ...before, ino: 8 }], length: 4 }),
      readStayedSettled({ before, during: [{ ...before, size: 5 }], length: 4 }),
      readStayedSettled({ before, during: [before], length: 3 }),
    ]).toEqual([false, false, false]);
  });
});

describe("readStayedUnderRoot", () => {
  let base = "";

  beforeEach(() => {
    base = realpathSync(mkdtempSync(join(tmpdir(), "page-assets-root-")));
    mkdirSync(join(base, "assets", "images"), { recursive: true });
    mkdirSync(join(base, "outside", "images"), { recursive: true });
    writeFileSync(join(base, "assets", "images", "a.png"), "IN");
    writeFileSync(join(base, "outside", "images", "a.png"), "OUT");
  });

  afterEach(() => {
    rmSync(base, { force: true, recursive: true });
  });

  const realRoot = (): string => join(base, "assets");
  const rootIdentity = (): { dev: number; ino: number } => {
    const { dev, ino } = lstatSync(realRoot());
    return { dev, ino };
  };

  it("accepts the file still at its path under the root", () => {
    const read = lstatSync(join(base, "assets", "images", "a.png"));
    expect(
      readStayedUnderRoot({ read, realRoot: realRoot(), relativePath: "images/a.png", rootIdentity: rootIdentity() }),
    ).toBe(true);
  });

  it("refuses a read that went through a directory swapped for a link and left swapped", () => {
    const identity = rootIdentity();
    const read = lstatSync(join(base, "outside", "images", "a.png"));
    renameSync(join(base, "assets", "images"), join(base, "assets", "images-moved"));
    symlinkSync(join(base, "outside", "images"), join(base, "assets", "images"));
    expect(
      readStayedUnderRoot({ read, realRoot: realRoot(), relativePath: "images/a.png", rootIdentity: identity }),
    ).toBe(false);
  });

  it("refuses a read of another file even once the swapped directory is put back", () => {
    const read = lstatSync(join(base, "outside", "images", "a.png"));
    expect(
      readStayedUnderRoot({ read, realRoot: realRoot(), relativePath: "images/a.png", rootIdentity: rootIdentity() }),
    ).toBe(false);
  });

  it("refuses a read once another directory was renamed into the root's place, with no link anywhere", () => {
    const identity = rootIdentity();
    renameSync(join(base, "assets"), join(base, "assets-aside"));
    renameSync(join(base, "outside"), join(base, "assets"));
    const read = lstatSync(join(base, "assets", "images", "a.png"));
    expect(
      readStayedUnderRoot({ read, realRoot: realRoot(), relativePath: "images/a.png", rootIdentity: identity }),
    ).toBe(false);
  });

  it("refuses a file that is no longer there", () => {
    const identity = rootIdentity();
    const read = lstatSync(join(base, "assets", "images", "a.png"));
    rmSync(join(base, "assets", "images", "a.png"));
    expect(
      readStayedUnderRoot({ read, realRoot: realRoot(), relativePath: "images/a.png", rootIdentity: identity }),
    ).toBe(false);
  });
});

describe("PageAssetErrors", () => {
  it("says a changed or unreadable file by its path", () => {
    expect([
      PageAssetErrors.changed({ path: "/acme/a.png" }).message,
      PageAssetErrors.unreadable({ path: "/acme/a.png", reason: "EACCES" }).message,
    ]).toEqual([
      "/acme/a.png changed while it was read; publish again once it is written",
      "could not read /acme/a.png: EACCES",
    ]);
  });
});
