import { describe, expect, it } from "vitest";

import { findRawObjectSchemas } from "../../../devLint/outboundFormStrict.js";

const PATH = "src/outbound/x/schema.ts";

describe("findRawObjectSchemas", () => {
  it("reports all three raw constructors, with spaces or tabs inside the call on one line, at their 1-based lines, trimmed", () => {
    const content = [
      'import { z } from "zod";',
      "  const a = z.object({ x: z.string() });",
      "const b = z.strictObject({});",
      "const c = z.looseObject({});",
      "const d = z . object ({});",
      "\tconst e = z\t.strictObject(\t{});  ",
    ].join("\n");
    expect(findRawObjectSchemas({ content, path: PATH })).toEqual([
      { line: 2, path: PATH, text: "const a = z.object({ x: z.string() });" },
      { line: 3, path: PATH, text: "const b = z.strictObject({});" },
      { line: 4, path: PATH, text: "const c = z.looseObject({});" },
      { line: 5, path: PATH, text: "const d = z . object ({});" },
      { line: 6, path: PATH, text: "const e = z\t.strictObject(\t{});" },
    ]);
  });

  it("does not report strictForm, another receiver, another constructor, or a name without a call", () => {
    const content = [
      "const a = strictForm({ x: z.string() });",
      "const b = zod.object({});",
      "const c = schema.z.objectify({});",
      "const d = z.array(z.string());",
      "const e = z.object;",
      "const f = Object.keys(z);",
    ].join("\n");
    expect(findRawObjectSchemas({ content, path: PATH })).toEqual([]);
  });

  it("skips a line opening with //, /* or *, but reports the same call after code on a line", () => {
    const content = [
      "// z.object({}) drops unknown keys",
      "/* z.strictObject({}) is mute */",
      " * z.looseObject({}) is the opt-in",
      "const a = 1; // z.object({}) trailing prose still counts",
    ].join("\n");
    expect(findRawObjectSchemas({ content, path: PATH })).toEqual([
      { line: 4, path: PATH, text: "const a = 1; // z.object({}) trailing prose still counts" },
    ]);
  });

  it("reports a constructor named inside a string, since the scan reads text not syntax", () => {
    const content = 'const help = "use z.object( sparingly";';
    expect(findRawObjectSchemas({ content, path: PATH })).toEqual([{ line: 1, path: PATH, text: content }]);
  });

  it("reads one line at a time, so a constructor split across a line break is not reported", () => {
    const content = ["const a = z", "  . looseObject({});", "const b = z.looseObject({});"].join("\n");
    expect(findRawObjectSchemas({ content, path: PATH })).toEqual([
      { line: 3, path: PATH, text: "const b = z.looseObject({});" },
    ]);
  });

  it("finds nothing in an empty source", () => {
    expect(findRawObjectSchemas({ content: "", path: PATH })).toEqual([]);
  });
});
