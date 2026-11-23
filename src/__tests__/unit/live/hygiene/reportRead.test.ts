import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { err, ok, type Result, unwrap, unwrapErr } from "../../../../lib/result.js";
import { readHygieneJson, readHygieneJsonLines } from "../../../../live/hygiene/reportRead.js";
import { HygieneDocumentReadErrors } from "../../../../live/hygiene/reportReadErrors.js";

const dirs: string[] = [];

afterEach(() => {
  dirs.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

const freshDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "sw-hygiene-read-"));
  dirs.push(dir);
  return dir;
};

const WRITTEN = new Date("2026-09-26T07:05:00.000Z");

/** A view accepting only `{ n: number }`, so a case can reach the invalid-view arm. */
const numberView = ({ value }: { readonly value: unknown }): Result<number> => {
  const n = typeof value === "object" && value !== null && "n" in value ? value.n : undefined;
  return typeof n === "number" ? ok(n) : err(["n: expected a number"]);
};

/** A view over lines that refuses the literal line `bad`. */
const linesView = ({ lines }: { readonly lines: readonly string[] }): Result<readonly string[]> =>
  lines.includes("bad") ? err(["line: bad"]) : ok(lines);

describe("readHygieneJson", () => {
  it("returns the validated document and the file's exact mtime", () => {
    const path = join(freshDir(), "doc.json");
    writeFileSync(path, '{"n":7}');
    utimesSync(path, WRITTEN, WRITTEN);
    expect(unwrap(readHygieneJson({ parse: numberView, path }))).toStrictEqual({
      document: 7,
      writtenIso: "2026-09-26T07:05:00.000Z",
    });
  });

  it("names a document never published as missing", () => {
    const path = join(freshDir(), "doc.json");
    expect(unwrapErr(readHygieneJson({ parse: numberView, path }))).toStrictEqual(
      HygieneDocumentReadErrors.missing({ path }),
    );
  });

  it("names a path it cannot read as unreadable", () => {
    const path = join(freshDir(), "doc.json");
    mkdirSync(path);
    const failure = unwrapErr(readHygieneJson({ parse: numberView, path }));
    expect(failure.code).toBe("HYGIENE_DOCUMENT_UNREADABLE");
    expect(failure.message).toContain("EISDIR");
  });

  it("refuses bytes that are not JSON, and leaves them exactly as they were", () => {
    const path = join(freshDir(), "doc.json");
    writeFileSync(path, "{nope");
    const failure = unwrapErr(readHygieneJson({ parse: numberView, path }));
    expect(failure.code).toBe("HYGIENE_DOCUMENT_INVALID");
    expect(failure.message).toContain("not JSON");
    expect(readFileSync(path, "utf8")).toBe("{nope");
  });

  it("refuses JSON its view does not accept, carrying every issue the view named", () => {
    const path = join(freshDir(), "doc.json");
    writeFileSync(path, '{"n":"seven"}');
    expect(unwrapErr(readHygieneJson({ parse: numberView, path }))).toStrictEqual(
      HygieneDocumentReadErrors.invalid({ issues: ["n: expected a number"], path }),
    );
  });
});

describe("readHygieneJsonLines", () => {
  it("reads a zero-byte document as the producer's clean pass: no lines, not a refusal", () => {
    const path = join(freshDir(), "doc.jsonl");
    writeFileSync(path, "");
    utimesSync(path, WRITTEN, WRITTEN);
    expect(unwrap(readHygieneJsonLines({ parse: linesView, path }))).toStrictEqual({
      document: [],
      writtenIso: "2026-09-26T07:05:00.000Z",
    });
  });

  it("hands the view every non-blank line in order", () => {
    const path = join(freshDir(), "doc.jsonl");
    writeFileSync(path, '{"a":1}\n\n{"b":2}\n');
    expect(unwrap(readHygieneJsonLines({ parse: linesView, path })).document).toStrictEqual(['{"a":1}', '{"b":2}']);
  });

  it("never repairs a byte that is not UTF-8 into the text a real U+FFFD would have written", () => {
    const path = join(freshDir(), "doc.jsonl");
    const written = Buffer.from('{"w":"�"}\n', "utf8");
    const corrupted = Buffer.concat([Buffer.from('{"w":"'), Buffer.from([0xff]), Buffer.from('"}\n')]);
    writeFileSync(path, Buffer.concat([written, corrupted]));
    expect(unwrap(readHygieneJsonLines({ parse: linesView, path })).document).toStrictEqual(['{"w":"�"}', "�"]);
  });

  it("names a missing document as missing", () => {
    const path = join(freshDir(), "doc.jsonl");
    expect(unwrapErr(readHygieneJsonLines({ parse: linesView, path }))).toStrictEqual(
      HygieneDocumentReadErrors.missing({ path }),
    );
  });

  it("refuses the whole document when its view refuses one line", () => {
    const path = join(freshDir(), "doc.jsonl");
    writeFileSync(path, "good\nbad\n");
    expect(unwrapErr(readHygieneJsonLines({ parse: linesView, path }))).toStrictEqual(
      HygieneDocumentReadErrors.invalid({ issues: ["line: bad"], path }),
    );
    expect(readFileSync(path, "utf8")).toBe("good\nbad\n");
  });
});
