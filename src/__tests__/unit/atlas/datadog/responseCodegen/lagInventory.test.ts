/*
 * The lag inventory one operation's recorded lag folds into: each place listed once, in path then lag order,
 * every row naming its operation.
 */
import { describe, expect, it } from "vitest";

import { datadogLagInventory } from "../../../../../atlas/datadog/responseCodegenFields.js";

describe("datadogLagInventory", () => {
  it("lists each place once, ordered by path then lag, every row carrying its operation", () => {
    const lag = [
      { lag: "string", path: "n" },
      { lag: "key", path: "b" },
      { lag: "null", path: "n" },
      { lag: "string", path: "n" },
    ] as const;
    expect(datadogLagInventory({ lag, surface: "op" })).toEqual([
      { lag: "key", path: "b", surface: "op" },
      { lag: "null", path: "n", surface: "op" },
      { lag: "string", path: "n", surface: "op" },
    ]);
  });

  it("lists nothing for an operation with no lag", () => {
    expect(datadogLagInventory({ lag: [], surface: "op" })).toEqual([]);
  });
});
