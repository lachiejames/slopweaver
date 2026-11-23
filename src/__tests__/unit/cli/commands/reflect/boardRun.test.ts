/**
 * `slopweaver reflect board`'s shell, exercised only on the branches that reach neither the real board nor
 * a clock: help and flag rejection. The hygiene reading itself is tested against injected seams in
 * `unit/reflect/board.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { runReflectBoard } from "../../../../../cli/commands/reflect/boardRun.js";
import { REFLECT_BOARD_USAGE } from "../../../../../cli/commands/reflect/usage.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { reflectManifest } from "../../../../../cli/manifests/reflect.js";

describe("runReflectBoard", () => {
  it("--help prints usage and exits EXIT_OK without reading the board", () => {
    const code = runReflectBoard(["node", "slopweaver", "reflect", "board", "--help"]);
    expect(code).toBe(EXIT_OK);
  });

  it("rejects an unknown flag with EXIT_USAGE before anything is read", () => {
    const code = runReflectBoard(["node", "slopweaver", "reflect", "board", "--since", "24h"]);
    expect(code).toBe(EXIT_USAGE);
  });

  it("rejects a --now that does not parse as an instant", () => {
    const code = runReflectBoard(["node", "slopweaver", "reflect", "board", "--now", "not-a-date"]);
    expect(code).toBe(EXIT_USAGE);
  });

  it("publishes one copy of its usage, shared with the manifest rather than duplicated", () => {
    expect(reflectManifest["board"]?.meta.usage).toBe(REFLECT_BOARD_USAGE);
    expect(REFLECT_BOARD_USAGE).toContain("--now");
  });
});
