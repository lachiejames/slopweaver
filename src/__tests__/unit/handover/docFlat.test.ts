/**
 * The FLAT half of a handover doc's front matter, read directly rather than through `parseHandoverDoc`.
 *
 * Pure line-in, value-out: no filesystem and no clock. `unit/handover/doc/` covers the same reader
 * through the whole parse, which is the caller's view; this file covers the edges that view cannot reach —
 * a duplicated key, a folded scalar, a block sequence — without also asserting a whole `HandoverDoc`.
 */
import { describe, expect, it } from "vitest";

import { asList, flatFields, flatValue, isFrontMatterComment } from "../../../handover/docFlat.js";
import { encodeFlatScalar } from "../../../handover/flatScalarCodec.js";

describe("flatFields", () => {
  it("reads every top-level scalar by key, keeping the YAML spelling it found", () => {
    const read = flatFields({ lines: ["slug: a-thing", 'summary: "landed: #445"', "status: done"] });

    expect(read.fields.get("slug")).toBe("a-thing");
    expect(read.fields.get("summary")).toBe('"landed: #445"');
    expect(read.fields.get("status")).toBe("done");
    expect(read.problems).toEqual([]);
  });

  it("reports a key declared twice rather than silently taking one of the two values", () => {
    const read = flatFields({ lines: ["repo: /a", "repo: /b"] });

    expect(read.problems).toEqual(['front-matter declares "repo" more than once — which one is meant?']);
  });

  it("ignores a nested continuation line, so two probes of one kind are not a duplicated key", () => {
    const read = flatFields({ lines: ["doneWhen:", "  - present: src/a.ts", "  - present: src/b.ts"] });

    expect(read.problems).toEqual([]);
    expect(read.fields.has("- present")).toBe(false);
  });

  it("folds a wrapped scalar onto one line, because every consumer prints a board ROW", () => {
    const read = flatFields({ lines: ["summary: >", "  the pool", "  exhausted"] });

    expect(read.fields.get("summary")).toBe("the pool exhausted");
  });

  it("folds an indented `#` line in a block as text, and drops a column-0 comment as YAML does", () => {
    const read = flatFields({ lines: ["summary: >", "  the pool", "  # exhausted", "# a comment", "artifact: null"] });

    expect([read.fields.get("summary"), read.fields.get("artifact")]).toEqual(["the pool # exhausted", "null"]);
  });

  it("drops an indented comment under a plain value, where YAML reads it as a comment", () => {
    const read = flatFields({ lines: ["artifact: null", "  # none published yet", "summary: the", "  pool"] });

    expect([read.fields.get("artifact"), read.fields.get("summary")]).toEqual(["null", "the pool"]);
  });

  it("hands a block sequence on in the FLOW spelling, so both spellings read the same", () => {
    const read = flatFields({ lines: ["blockedBy:", "  - one", "  - two"] });

    expect(read.fields.get("blockedBy")).toBe("[one, two]");
  });

  it("finds nothing in an empty front matter, rather than reporting a problem about it", () => {
    const read = flatFields({ lines: [] });

    expect(read.fields.size).toBe(0);
    expect(read.problems).toEqual([]);
  });
});

describe("flatValue", () => {
  it("unquotes the value, which is the whole reason the accessor exists", () => {
    const fields = flatFields({ lines: ['summary: "landed: #445"'] }).fields;

    expect(flatValue({ fields, key: "summary" })).toBe("landed: #445");
  });

  // The spelling `handover register` writes for a multi-line value is `JSON.stringify`'s; the reader once decoded
  // only `\"` and `\\` of it, so this read back as `one\ntwo\tthree` with literal backslashes.
  it("decodes a JSON-escaped newline and tab as the characters the writer encoded", () => {
    const fields = flatFields({ lines: [`branch: ${JSON.stringify("one\ntwo\tthree")}`] }).fields;

    expect(flatValue({ fields, key: "branch" })).toBe("one\ntwo\tthree");
  });

  it("reads an absent key as undefined", () => {
    expect(flatValue({ fields: flatFields({ lines: [] }).fields, key: "summary" })).toBeUndefined();
  });

  it("reads an EMPTY quoted value as absent, so it is one state with a missing key", () => {
    const fields = flatFields({ lines: ['summary: ""'] }).fields;

    expect(flatValue({ fields, key: "summary" })).toBeUndefined();
  });
});

describe("asList", () => {
  it("reads the flow spelling as its items", () => {
    expect(asList({ value: "[one, two]" })).toEqual(["one", "two"]);
  });

  it("reads a bare value as a one-item list", () => {
    expect(asList({ value: "one" })).toEqual(["one"]);
  });

  it("reads an absent field as an empty list, not a list holding an empty string", () => {
    expect(asList({ value: undefined })).toEqual([]);
  });

  it("drops an empty member, so `[a, , b]` is two items", () => {
    expect(asList({ value: "[a, , b]" })).toEqual(["a", "b"]);
  });

  // `evidence:` encodes each item, so a quote-leading one read back as its quoted spelling.
  it("decodes each item the writer encoded, so a quote-leading or multi-line item reads back as written", () => {
    const items = ['"quoted', "one\ntwo", "owner/repo#16360"];
    const written = `[${items.map((value) => encodeFlatScalar({ value })).join(", ")}]`;

    expect(asList({ value: written })).toEqual(items);
  });
});

describe("isFrontMatterComment", () => {
  it("calls a column-0 `#` line a comment, inside a block or out of one", () => {
    expect(isFrontMatterComment({ block: false, line: "# a note" })).toBe(true);
    expect(isFrontMatterComment({ block: true, line: "# a note" })).toBe(true);
  });

  it("calls an indented `#` line a comment outside a block and the block's text inside one", () => {
    expect(isFrontMatterComment({ block: false, line: "  # a note" })).toBe(true);
    expect(isFrontMatterComment({ block: true, line: "  # a note" })).toBe(false);
  });

  it("calls a value line, a blank line and a key nothing but what they are", () => {
    expect(isFrontMatterComment({ block: false, line: "  wrapped text" })).toBe(false);
    expect(isFrontMatterComment({ block: false, line: "" })).toBe(false);
    expect(isFrontMatterComment({ block: false, line: "status: ready # not a comment line" })).toBe(false);
  });
});
