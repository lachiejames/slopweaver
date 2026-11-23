/*
 * `directoryStatementsOf`: per-bucket statement counts and percentages, ordered by name, empty buckets omitted.
 */
import { describe, expect, it } from "vitest";

import { directoryStatementsOf } from "../../../../devLint/coverageFloor.js";

describe("directoryStatementsOf", () => {
  it("sums statements per bucket and rounds the percentage", () => {
    const directories = directoryStatementsOf({
      files: [
        { covered: 1, relativePath: "src/cli/a.ts", total: 3 },
        { covered: 2, relativePath: "src/cli/deep/b.ts", total: 3 },
        { covered: 9, relativePath: "src/lib/c.ts", total: 10 },
      ],
    });
    expect(directories).toEqual({
      "src/cli": { statementCount: 6, statements: 50 },
      "src/lib": { statementCount: 10, statements: 90 },
    });
  });

  it("omits a bucket with no statements rather than reporting 0% or NaN", () => {
    expect(directoryStatementsOf({ files: [{ covered: 0, relativePath: "src/empty/index.ts", total: 0 }] })).toEqual(
      {},
    );
  });

  it("orders buckets by name", () => {
    const directories = directoryStatementsOf({
      files: [
        { covered: 1, relativePath: "src/zeta/a.ts", total: 1 },
        { covered: 1, relativePath: "src/alpha/a.ts", total: 1 },
      ],
    });
    expect(Object.keys(directories)).toEqual(["src/alpha", "src/zeta"]);
  });
});
