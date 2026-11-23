import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { isAbsentError, isGenuinelyAbsent, readStrictFileIfPresent } from "../../../lib/presentFile.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-present-file-"));
  fixtureDirs.push(dir);
  return dir;
}

const read = ({ path }: { path: string }): ReturnType<typeof readStrictFileIfPresent> =>
  readStrictFileIfPresent({ operation: "test", path });

describe("readStrictFileIfPresent", () => {
  it("reads a file that is there", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "a.txt"), "hello");
    expect(unwrap(read({ path: join(dir, "a.txt") }))).toBe("hello");
  });

  it("reads a file that was never written as null", () => {
    expect(unwrap(read({ path: join(tempDir(), "missing.txt") }))).toBeNull();
  });

  it("reads a missing file beneath a live directory link as null", () => {
    const dir = tempDir();
    mkdirSync(join(dir, "real"));
    symlinkSync(join(dir, "real"), join(dir, "link"));
    expect(unwrap(read({ path: join(dir, "link", "missing.txt") }))).toBeNull();
  });

  it("refuses a dangling file link, because something is there", () => {
    const dir = tempDir();
    symlinkSync(join(dir, "gone.txt"), join(dir, "a.txt"));
    expect(unwrapErr(read({ path: join(dir, "a.txt") })).code).toBe("ENOENT");
  });

  it("refuses a file beneath a dangling directory link", () => {
    const dir = tempDir();
    symlinkSync(join(dir, "gone"), join(dir, "link"));
    expect(unwrapErr(read({ path: join(dir, "link", "a.txt") })).code).toBe("ENOENT");
  });

  it("refuses bytes that are not UTF-8 instead of repairing them", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "a.txt"), Buffer.from([0x61, 0x96, 0x62]));
    expect(unwrapErr(read({ path: join(dir, "a.txt") })).message).toContain("encoded data was not valid");
  });

  it("refuses a directory where a file was expected", () => {
    const dir = tempDir();
    mkdirSync(join(dir, "a.txt"));
    expect(unwrapErr(read({ path: join(dir, "a.txt") })).code).toBe("EISDIR");
  });

  it("refuses a named pipe without opening it, where a read would block forever", () => {
    const path = join(tempDir(), "a.txt");
    execFileSync("mkfifo", [path]);
    expect(unwrapErr(read({ path })).message).toContain(`${path} is not a regular file (a pipe, socket or device)`);
  });
});

describe("isGenuinelyAbsent / isAbsentError", () => {
  it("calls a path under an existing directory absent", () => {
    expect(isGenuinelyAbsent({ path: join(tempDir(), "x", "y") })).toBe(true);
  });

  it("does not call a path under a dangling link absent", () => {
    const dir = tempDir();
    symlinkSync(join(dir, "gone"), join(dir, "link"));
    expect(isGenuinelyAbsent({ path: join(dir, "link", "y") })).toBe(false);
    expect(isGenuinelyAbsent({ path: `${join(dir, "link")}/` })).toBe(false);
    expect(isGenuinelyAbsent({ path: `${join(dir, "link")}/../y` })).toBe(false);
    expect(isGenuinelyAbsent({ path: `${join(dir, "link")}//y` })).toBe(false);
  });

  it("counts only ENOENT as absence", () => {
    const path = join(tempDir(), "missing");
    expect(isAbsentError({ error: Object.assign(new Error("gone"), { code: "ENOENT" }), path })).toBe(true);
    expect(isAbsentError({ error: Object.assign(new Error("denied"), { code: "EACCES" }), path })).toBe(false);
  });
});
