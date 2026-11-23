/**
 * `readAfterHead` takes the bytes the picture sniff already read and never reads them again. The head passed
 * here deliberately differs from the file on disk, so a re-read would show up in the result.
 */
import { closeSync, mkdtempSync, openSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readAfterHead, sniffOpened } from "../../../talk/localImage.js";

describe("readAfterHead", () => {
  let dir: string;
  let fd: number;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "local-image-"));
    writeFileSync(join(dir, "file.txt"), "abcdefghij");
    fd = openSync(join(dir, "file.txt"), "r");
  });

  afterEach(() => {
    closeSync(fd);
    rmSync(dir, { force: true, recursive: true });
  });

  it("uses the head for the bytes it covers and reads only the rest", () => {
    const into = Buffer.alloc(6);
    expect(readAfterHead({ at: 0, fd, head: Buffer.from("XYZ"), into })).toBe(6);
    expect(into.toString()).toBe("XYZdef");
  });

  it("uses only the part of the head past the offset", () => {
    const into = Buffer.alloc(6);
    expect(readAfterHead({ at: 2, fd, head: Buffer.from("XYZ"), into })).toBe(6);
    expect(into.toString()).toBe("Zdefgh");
  });

  it("reads everything from the file when the span starts past the head", () => {
    const into = Buffer.alloc(5);
    expect(readAfterHead({ at: 5, fd, head: Buffer.from("XYZ"), into })).toBe(5);
    expect(into.toString()).toBe("fghij");
  });

  it("stops at the end of the file", () => {
    const into = Buffer.alloc(8);
    expect(readAfterHead({ at: 6, fd, head: Buffer.from("XYZ"), into })).toBe(4);
    expect(into.subarray(0, 4).toString()).toBe("ghij");
  });
});

describe("sniffOpened", () => {
  it("returns the head it read and names no format for text", () => {
    const dir = mkdtempSync(join(tmpdir(), "local-image-"));
    writeFileSync(join(dir, "file.txt"), "abcdefghijklmnop");
    const fd = openSync(join(dir, "file.txt"), "r");
    const sniffed = sniffOpened({ fd, size: 16 });
    closeSync(fd);
    rmSync(dir, { force: true, recursive: true });
    expect(sniffed.head.toString()).toBe("abcdefghijkl");
    expect(sniffed.mediaType).toBe(undefined);
  });
});
