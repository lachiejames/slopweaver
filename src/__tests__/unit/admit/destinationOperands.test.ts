import { describe, expect, it } from "vitest";

import { REMOTE_OPERAND, writerOperands, writtenInto } from "../../../admit/destinationOperands.js";
import { type ShellWord, shellWords } from "../../../admit/shellLexing.js";

/** The words of one argument list, as the shell would split it. */
function argsOf({ text }: { text: string }): readonly ShellWord[] {
  return shellWords({ text }).words;
}

describe("writerOperands", () => {
  it("reads the destination before an option written after the operands, its value skipped", () => {
    const read = writerOperands({ args: argsOf({ text: "src dst --exclude x" }), name: "rsync" });

    expect(read.destinations.map((word) => word.text)).toEqual(["dst"]);
    expect(read.operands.map((word) => word.text)).toEqual(["src", "dst"]);
    expect(read.options).toEqual(["--exclude"]);
  });

  it("judges both readings of a long option it does not know", () => {
    const read = writerOperands({ args: argsOf({ text: "src dst --frob x" }), name: "rsync" });

    expect(read.destinations.map((word) => word.text)).toEqual(["x", "dst"]);
  });

  it("names no destination for a one-operand rsync listing or a remote destination", () => {
    expect(writerOperands({ args: argsOf({ text: "src" }), name: "rsync" }).destinations).toEqual([]);
    expect(writerOperands({ args: argsOf({ text: "src host:path" }), name: "rsync" }).destinations).toEqual([]);
  });

  it("reads a cp's last operand as its destination", () => {
    const read = writerOperands({ args: argsOf({ text: "-S .bak a b" }), name: "cp" });

    expect(read.destinations.map((word) => word.text)).toEqual(["b"]);
    expect(read.operands.map((word) => word.text)).toEqual(["a", "b"]);
  });
});

describe("writtenInto", () => {
  const [destination] = argsOf({ text: "/h" });
  const sources = argsOf({ text: "/h/talk/calls/x.jsonl" });

  it("judges a copy into a directory as the source's last component under it", () => {
    const written = writtenInto({ destination: destination!, name: "cp", options: [], sources });

    expect(written.map((word) => word.text)).toEqual(["/h/x.jsonl"]);
  });

  it("keeps the destination itself for ditto, a placement option or a contents copy", () => {
    expect(writtenInto({ destination: destination!, name: "ditto", options: [], sources }).map((w) => w.text)).toEqual([
      "/h",
    ]);
    expect(
      writtenInto({ destination: destination!, name: "rsync", options: ["-aR"], sources }).map((w) => w.text),
    ).toEqual(["/h"]);
    expect(
      writtenInto({ destination: destination!, name: "rsync", options: [], sources: argsOf({ text: "calls/" }) }).map(
        (w) => w.text,
      ),
    ).toEqual(["/h"]);
  });
});

describe("REMOTE_OPERAND", () => {
  it("matches host:path and host::module, never a local path holding a colon", () => {
    expect([
      REMOTE_OPERAND.test("host:path"),
      REMOTE_OPERAND.test("host::module"),
      REMOTE_OPERAND.test("/a/b:c"),
    ]).toEqual([true, true, false]);
  });
});
