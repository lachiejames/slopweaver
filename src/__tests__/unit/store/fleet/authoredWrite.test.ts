/**
 * The filesystem edge restore and `show --out` write through, over real temp directories: an exclusive create
 * that never overwrites, and never lands outside the home however a link points.
 */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createAuthoredFile, fileSha256, writeShownBody } from "../../../../store/fleet/authoredWrite.js";

const EARLY = new Date("2026-09-01T00:00:00.000Z");

describe("createAuthoredFile", () => {
  let dir: string | undefined;

  afterEach(() => {
    rmSync(dir!, { force: true, recursive: true });
  });

  it("creates the file with its bytes and recorded mtime", () => {
    dir = mkdtempSync(join(tmpdir(), "authored-create-"));
    const home = join(dir, "home");
    mkdirSync(home);
    const path = join(home, "briefs", "deep", "a.md");

    createAuthoredFile({ bytes: Buffer.from("back"), modifiedAt: EARLY, path, root: home });

    expect(readFileSync(path, "utf8")).toBe("back");
    expect(statSync(path).mtime.toISOString()).toBe(EARLY.toISOString());
  });

  it("refuses a path something already occupies — a file, or a symbolic link to nowhere", () => {
    dir = mkdtempSync(join(tmpdir(), "authored-create-"));
    const home = join(dir, "home");
    mkdirSync(join(home, "briefs"), { recursive: true });
    writeFileSync(join(home, "briefs", "present.md"), "mine");
    symlinkSync(join(dir, "target-outside"), join(home, "briefs", "dangling.md"));

    expect(() => {
      createAuthoredFile({
        bytes: Buffer.from("stored"),
        modifiedAt: EARLY,
        path: join(home, "briefs", "present.md"),
        root: home,
      });
    }).toThrow("EEXIST");
    expect(() => {
      createAuthoredFile({
        bytes: Buffer.from("stored"),
        modifiedAt: EARLY,
        path: join(home, "briefs", "dangling.md"),
        root: home,
      });
    }).toThrow("EEXIST");
    expect(readFileSync(join(home, "briefs", "present.md"), "utf8")).toBe("mine");
    expect(() => statSync(join(dir!, "target-outside"))).toThrow("ENOENT");
  });

  it("refuses a directory that resolves outside the home through a symbolic link", () => {
    dir = mkdtempSync(join(tmpdir(), "authored-create-"));
    const home = join(dir, "home");
    const outside = join(dir, "outside");
    mkdirSync(home);
    mkdirSync(outside);
    symlinkSync(outside, join(home, "briefs"));

    expect(() => {
      createAuthoredFile({
        bytes: Buffer.from("stored"),
        modifiedAt: EARLY,
        path: join(home, "briefs", "a.md"),
        root: home,
      });
    }).toThrow("outside");
    expect(() => {
      createAuthoredFile({
        bytes: Buffer.from("stored"),
        modifiedAt: EARLY,
        path: join(home, "briefs", "deep", "er", "a.md"),
        root: home,
      });
    }).toThrow("outside");
    expect(() => statSync(join(outside, "a.md"))).toThrow("ENOENT");
    expect(() => statSync(join(outside, "deep"))).toThrow("ENOENT");
  });
});

describe("writeShownBody and fileSha256", () => {
  let dir: string | undefined;

  afterEach(() => {
    rmSync(dir!, { force: true, recursive: true });
  });

  it("replaces the --out file with the exact bytes, and hashes what is there", () => {
    dir = mkdtempSync(join(tmpdir(), "authored-out-"));
    const path = join(dir, "new", "brief.bin");
    const bytes = Buffer.from([0, 1, 2, 255]);
    writeShownBody({ bytes: Buffer.from("old"), path });

    writeShownBody({ bytes, path });

    expect(readFileSync(path)).toEqual(bytes);
    expect(fileSha256({ path })).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(fileSha256({ path: join(dir, "absent") })).toBeUndefined();
  });
});
