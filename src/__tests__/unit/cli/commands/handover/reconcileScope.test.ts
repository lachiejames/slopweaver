/**
 * `handover reconcile`'s scope: the `--dir` and `--home` it scans from are the same absolute paths every command
 * it prints names, resolved once before the scan.
 */
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { scopeFlagsOf, scopePaths } from "../../../../../cli/commands/handover/reconcileScope.js";

describe("scopePaths", () => {
  it("resolves a relative dir and home, a `..` included, and leaves an unpassed one undefined", () => {
    expect([
      scopePaths({ values: { dir: "ln/..", home: "h" } }),
      scopePaths({ values: { dir: "/abs/board" } }),
      scopePaths({ values: { dir: true } }),
      scopePaths({ values: {} }),
    ]).toEqual([
      { dir: resolve("."), home: resolve("h") },
      { dir: "/abs/board", home: undefined },
      { dir: undefined, home: undefined },
      { dir: undefined, home: undefined },
    ]);
  });
});

describe("scopeFlagsOf", () => {
  it("prints each passed path after its flag, dir first, and nothing for an unpassed one", () => {
    expect([
      scopeFlagsOf({ scope: { dir: "/abs/board", home: "/abs/home" } }),
      scopeFlagsOf({ scope: { dir: undefined, home: "/abs/home" } }),
      scopeFlagsOf({ scope: { dir: undefined, home: undefined } }),
    ]).toEqual([["--dir", "/abs/board", "--home", "/abs/home"], ["--home", "/abs/home"], []]);
  });
});
