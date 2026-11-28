import { describe, expect, it } from "vitest";
import { candidateSpecifiers } from "../../../testLanes/targetedTestImports.js";

const TEXT = [
  'import { a } from "../../lib/date.js";',
  'import { b } from "@/shortcut";',
  'import { c } from "../../lib/result.js";',
  'import { d } from "vitest";',
].join("\n");

describe("candidateSpecifiers", () => {
  it("keeps a specifier naming a changed stem and one matching a stem-changing alias, nothing else", () => {
    expect(
      candidateSpecifiers({
        aliases: [{ exact: true, prefix: "@/shortcut" }],
        path: "site/__tests__/unit/a.test.ts",
        stems: new Set(["date"]),
        text: TEXT,
      }),
    ).toEqual(["../../lib/date.js", "@/shortcut"]);
  });

  it("resolves an aliased specifier even when its text names no changed stem", () => {
    expect(
      candidateSpecifiers({
        aliases: [{ exact: true, prefix: "@/shortcut" }],
        path: "site/__tests__/unit/a.test.ts",
        stems: new Set(["foo"]),
        text: TEXT,
      }),
    ).toEqual(["@/shortcut"]);
  });

  it("parses nothing when the diff changed no source file", () => {
    expect(
      candidateSpecifiers({
        aliases: [{ exact: true, prefix: "@/shortcut" }],
        path: "site/__tests__/unit/a.test.ts",
        stems: new Set(),
        text: TEXT,
      }),
    ).toEqual([]);
  });

  it("keeps nothing when the text names no stem and no alias", () => {
    expect(
      candidateSpecifiers({ aliases: [], path: "src/__tests__/unit/a.test.ts", stems: new Set(["foo"]), text: TEXT }),
    ).toEqual([]);
  });
});
