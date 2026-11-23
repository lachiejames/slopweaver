/**
 * PostgreSQL's COPY text format, decoded field by field: split on TABs first, `\N` is null, escapes become BYTES.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { decodeCopyLine } from "../../../../store/ownerTurnDump/copyText.js";
import { CopyLineErrors } from "../../../../store/ownerTurnDump/errors.js";

/** Each decoded field's text, or null. */
function textsOf({ line, columns }: { line: string; columns: number }): (string | null)[] {
  return unwrap(decodeCopyLine({ columns, line })).map((field) => (field === null ? null : field.text));
}

describe("decodeCopyLine", () => {
  it("splits on TABs and decodes every simple escape", () => {
    expect(textsOf({ columns: 2, line: "a\\nb\\tc\\\\d\tx\\ry\\b\\f\\v" })).toEqual(["a\nb\tc\\d", "x\ry\b\f\v"]);
  });

  it("reads a field that is exactly \\N as null, and a longer one as text", () => {
    expect(textsOf({ columns: 3, line: "\\N\t\\\\N\t" })).toEqual([null, "\\N", ""]);
  });

  it("decodes octal and hex escapes as bytes, which then have to be UTF-8 together", () => {
    // é is C3 A9: once as octal, once as hex.
    expect(textsOf({ columns: 2, line: "caf\\303\\251\tcaf\\xc3\\xa9" })).toEqual(["café", "café"]);
  });

  it("keeps the bytes the field decoded from, so a body is hashed as the dump carried it", () => {
    const [field] = unwrap(decodeCopyLine({ columns: 1, line: "é\\n" }));

    expect(field).toEqual({ bytes: Buffer.from("é\n", "utf8"), text: "é\n" });
  });

  it("lets any other backslashed character stand for itself", () => {
    expect(textsOf({ columns: 1, line: "a\\.b\\qc" })).toEqual(["a.bqc"]);
  });

  it("refuses an escape that decodes to a NUL byte, which no stored text value can hold", () => {
    expect(unwrapErr(decodeCopyLine({ columns: 1, line: "a\\000b" }))).toEqual(CopyLineErrors.nulByte({ field: 1 }));
  });

  it("refuses the end-of-data marker rather than reading it as a field holding a dot", () => {
    expect(unwrapErr(decodeCopyLine({ columns: 1, line: "\\." })).message).toBe(
      "it is the end-of-data marker, which holds no row",
    );
  });

  it("reads a backslashed literal TAB as data inside one field, never as a column break", () => {
    expect(textsOf({ columns: 1, line: "a\\\tb" })).toEqual(["a\tb"]);
    expect(textsOf({ columns: 2, line: "a\\\\\tb" })).toEqual(["a\\", "b"]);
  });

  it("refuses the wrong number of fields, a lone trailing backslash, and bytes that are not UTF-8", () => {
    expect(unwrapErr(decodeCopyLine({ columns: 3, line: "a\tb" })).message).toBe(
      "it has 2 field(s) where the section declares 3",
    );
    expect(unwrapErr(decodeCopyLine({ columns: 1, line: "a\\" }))).toEqual(
      CopyLineErrors.badEscape({ field: 1, reason: "it ends in a lone backslash" }),
    );
    expect(unwrapErr(decodeCopyLine({ columns: 2, line: "ok\t\\377" })).code).toBe("COPY_NOT_UTF8");
    expect(unwrapErr(decodeCopyLine({ columns: 1, line: "a\uD800b" }))).toEqual(CopyLineErrors.loneSurrogate());
  });
});
