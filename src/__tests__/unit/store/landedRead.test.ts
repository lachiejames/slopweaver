/**
 * `parseCatFileBatch`: one `git cat-file --batch` read replaces a `git show` per landed migration, so its parse
 * has to hand back exactly each blob, and refuse rather than drop one.
 */
import { describe, expect, it } from "vitest";

import { landedHashes, parseCatFileBatch, strictUtf8 } from "../../../store/landedRead.js";

/**
 * One batch record as git prints it.
 *
 * @param text the blob's contents
 * @returns the header, the bytes and the trailing newline
 */
function record({ text }: { text: string }): Buffer {
  return rawRecord({ bytes: Buffer.from(text, "utf8") });
}

/**
 * One batch record carrying exactly these bytes, valid UTF-8 or not.
 *
 * @param bytes the blob's raw contents
 * @returns the header, the bytes and the trailing newline
 */
function rawRecord({ bytes }: { bytes: Buffer }): Buffer {
  return Buffer.concat([Buffer.from(`${"a".repeat(40)} blob ${String(bytes.length)}\n`), bytes, Buffer.from("\n")]);
}

describe("strictUtf8", () => {
  it("throws on bytes that are not valid UTF-8, where a lenient decode would read 0x80 and 0x81 alike", () => {
    const lenient = [0x80, 0x81].map((byte) => Buffer.from([0x2d, 0x2d, 0x20, byte]).toString("utf8"));

    expect(lenient[0]).toBe(lenient[1]);
    expect(() => strictUtf8({ bytes: Buffer.from([0x2d, 0x2d, 0x20, 0x80]) })).toThrow(TypeError);
  });

  it("keeps a leading BOM, exactly as Buffer#toString does, so the hash is drizzle's own", () => {
    const bytes = Buffer.from([0xef, 0xbb, 0xbf, 0x61]);

    expect(strictUtf8({ bytes })).toBe(bytes.toString("utf8"));
  });
});

describe("parseCatFileBatch", () => {
  it("returns each blob in order, its size counted in bytes so a multi-byte character does not shift the next", () => {
    const output = Buffer.concat([record({ text: 'CREATE TABLE "é" ();\n' }), record({ text: "line\nline\n" })]);

    expect(parseCatFileBatch({ count: 2, output })).toEqual(['CREATE TABLE "é" ();\n', "line\nline\n"]);
  });

  it("returns an empty blob as an empty string", () => {
    expect(parseCatFileBatch({ count: 1, output: record({ text: "" }) })).toEqual([""]);
  });

  it("returns nothing when nothing was asked for", () => {
    expect(parseCatFileBatch({ count: 0, output: Buffer.alloc(0) })).toEqual([]);
  });

  it("throws on a name git could not resolve, rather than leaving that file out", () => {
    const output = Buffer.concat([
      record({ text: "a" }),
      Buffer.from("origin/main:supabase/migrations/x.sql missing\n"),
    ]);

    expect(() => parseCatFileBatch({ count: 2, output })).toThrow(
      'printed "origin/main:supabase/migrations/x.sql missing" where a blob was expected',
    );
  });

  it("throws when the output stops before every blob asked for", () => {
    expect(() => parseCatFileBatch({ count: 2, output: record({ text: "a" }) })).toThrow("stopped after 1 of 2 blobs");
  });

  it("throws when a blob is cut short of its stated size", () => {
    const output = Buffer.from(`${"a".repeat(40)} blob 10\nshort`);

    expect(() => parseCatFileBatch({ count: 1, output })).toThrow("cut blob 1 short of its 10 bytes");
  });

  it("throws when a blob's bytes are all there but the newline closing its record is not (Codex r33)", () => {
    const output = Buffer.from(`${"a".repeat(40)} blob 3\nabc`);

    expect(() => parseCatFileBatch({ count: 1, output })).toThrow("cut blob 1 short of its 3 bytes");
  });

  it("throws on a blob that is not valid UTF-8, rather than hashing its replacement characters", () => {
    const output = Buffer.concat([record({ text: "a" }), rawRecord({ bytes: Buffer.from([0x2d, 0x2d, 0x20, 0x80]) })]);

    expect(() => parseCatFileBatch({ count: 2, output })).toThrow("blob 2 is not valid UTF-8");
  });
});

describe("landedHashes", () => {
  it("keys each blob's sha256 by its tag, the file name without .sql", () => {
    const output = Buffer.concat([record({ text: "" }), record({ text: "abc" })]);

    expect([...landedHashes({ names: ["0001_a.sql", "0002_b.sql"], output })]).toEqual([
      ["0001_a", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
      ["0002_b", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
    ]);
  });
});
