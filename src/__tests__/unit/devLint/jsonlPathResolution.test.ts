import { describe, expect, it } from "vitest";
import { withSourceFile } from "#lib/tsSyntax.js";
import {
  indexLocalJsonlPaths,
  type JsonlNameIndex,
  type NameTally,
  tally,
  unambiguous,
} from "../../../devLint/jsonlPathResolution.js";

const EMPTY_INDEX: JsonlNameIndex = { functions: new Set<string>(), properties: new Set<string>() };

/** The local names one text binds unambiguously to a `.jsonl` path, as a sorted array. */
function localsOf({ text, index = EMPTY_INDEX }: { text: string; index?: JsonlNameIndex }): readonly string[] {
  return withSourceFile({
    fileName: "x.ts",
    text,
    use: (source) => [...indexLocalJsonlPaths({ index, source })].toSorted(),
  });
}

describe("tally and unambiguous", () => {
  it("proves a name only when every declaration of it names a .jsonl", () => {
    const tallies = new Map<string, NameTally>();
    tally({ into: tallies, name: "ledger", namesJsonl: true });
    tally({ into: tallies, name: "ledger", namesJsonl: true });
    tally({ into: tallies, name: "path", namesJsonl: true });
    tally({ into: tallies, name: "path", namesJsonl: false });
    expect([...unambiguous({ tallies })]).toEqual(["ledger"]);
  });
});

describe("indexLocalJsonlPaths", () => {
  it("indexes a local initialised from a .jsonl literal", () => {
    expect(localsOf({ text: `const p = "asks.jsonl";` })).toEqual(["p"]);
  });

  it("indexes a local built by join over an indexed property", () => {
    const index: JsonlNameIndex = { functions: new Set<string>(), properties: new Set(["asksJsonl"]) };
    expect(localsOf({ index, text: `const p = join(dir, paths.asksJsonl);` })).toEqual(["p"]);
  });

  it("does not index a name that is also a parameter, which never names a .jsonl", () => {
    expect(localsOf({ text: `const path = "a.jsonl";\nconst f = ({ path }) => path;` })).toEqual([]);
  });

  it("does not index a local that holds a .json path", () => {
    expect(localsOf({ text: `const p = "state.json";` })).toEqual([]);
  });
});
