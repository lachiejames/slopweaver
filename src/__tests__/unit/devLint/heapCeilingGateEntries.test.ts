import { describe, expect, it } from "vitest";
import { withSourceFile } from "#lib/tsSyntax.js";
import { gatesIn } from "../../../devLint/heapCeilingGateEntries.js";

/** Read every gate entry in a text as plain data, so no syntax node leaves the lending callback. */
function entriesOf({
  text,
}: {
  text: string;
}): readonly { name: string; elements: number; words: readonly string[] | undefined }[] {
  return withSourceFile({
    fileName: "gateGroups.ts",
    text,
    use: (source) =>
      gatesIn({ source }).map((gate) => ({ elements: gate.elements.length, name: gate.name, words: gate.words })),
  });
}

describe("gatesIn", () => {
  it("reads a gate whose args are one array of plain literals", () => {
    const text = `const gates = [{ name: "a", args: ["--max-old-space-size=8192", "x"] }];`;
    expect(entriesOf({ text })).toEqual([{ elements: 2, name: "a", words: ["--max-old-space-size=8192", "x"] }]);
  });

  it("follows one hop to a same-file const array", () => {
    const text = `const ARGS = ["p", "q"];\nconst gates = [{ name: "b", args: ARGS }];`;
    expect(entriesOf({ text })).toEqual([{ elements: 2, name: "b", words: ["p", "q"] }]);
  });

  it("leaves words undefined when an element is computed", () => {
    const text = `const gates = [{ name: "c", args: ["a", "b" + "c"] }];`;
    expect(entriesOf({ text })).toEqual([{ elements: 2, name: "c", words: undefined }]);
  });

  it("treats an object spread as opaque, with no readable argv", () => {
    const text = `const gates = [{ name: "d", ...rest, args: ["a"] }];`;
    expect(entriesOf({ text })).toEqual([{ elements: 0, name: "d", words: undefined }]);
  });

  it("ignores an object literal with no plain-string name", () => {
    const text = `const other = { args: ["a"] };`;
    expect(entriesOf({ text })).toEqual([]);
  });
});
