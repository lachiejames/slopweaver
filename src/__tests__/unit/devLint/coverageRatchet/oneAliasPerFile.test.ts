/*
 * `oneAliasPerFile`: one path per real file two links reach — the one the report names, else the first coverage
 * does not exclude, else the first.
 */
import { describe, expect, it } from "vitest";

import { oneAliasPerFile, vitestMeasures } from "../../../../devLint/coverageCompleteness.js";
import { measuredHere, ROOT } from "./harness.js";

describe("oneAliasPerFile", () => {
  const aliases = [
    { path: "src/b/one.ts", real: "/r/real/one.ts" },
    { path: "src/a/one.ts", real: "/r/real/one.ts" },
    { path: "src/lib/two.ts", real: "/r/src/lib/two.ts" },
  ];

  it("keeps the path the report names for a file two links reach", () => {
    expect(
      oneAliasPerFile({ aliases, measured: vitestMeasures({ exclude: [], root: ROOT }), reported: ["src/b/one.ts"] }),
    ).toEqual(["src/b/one.ts", "src/lib/two.ts"]);
  });

  it("asks for the first path coverage does not exclude when the report names none", () => {
    expect(
      oneAliasPerFile({ aliases, measured: vitestMeasures({ exclude: ["src/a/**"], root: ROOT }), reported: [] }),
    ).toEqual(["src/b/one.ts", "src/lib/two.ts"]);
  });

  it("falls to the first path when every path is excluded, which the exclusion then drops", () => {
    const measured = vitestMeasures({ exclude: ["src/a/**", "src/b/**"], root: ROOT });
    expect(oneAliasPerFile({ aliases, measured, reported: [] })).toEqual(["src/a/one.ts", "src/lib/two.ts"]);
  });

  it("answers nothing for no paths", () => {
    expect(oneAliasPerFile({ aliases: [], measured: measuredHere, reported: [] })).toEqual([]);
  });
});
