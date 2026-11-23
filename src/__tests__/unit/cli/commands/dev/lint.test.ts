import { describe, expect, it } from "vitest";

import { devLintCommand } from "../../../../../cli/commands/dev/lint.js";
import { EXIT_OK } from "../../../../../cli/exitCodes.js";
import { runDevLint } from "../../../../../devLint/devLint.js";

describe("devLintCommand", () => {
  it("answers --help without spawning a single check", async () => {
    // Exercised through the loader-selected export. If this ever spawned the bar it would take minutes and
    // shell out to every linter, so a fast return IS the assertion. The runner is async since the gates
    // became concurrent, so the verb answers a promise the CLI loader already awaits.
    expect(await devLintCommand(["node", "slopweaver", "dev", "lint", "--help"])).toBe(EXIT_OK);
  });

  // The command is no longer the runner itself: it closes over the lap-lock read the seat lane needs, which
  // `src/devLint/` may not import. Help through either answers the same, so the wiring is the real runner's.
  it("carries no metadata of its own and answers help exactly as the real runner does", async () => {
    const argv = ["node", "slopweaver", "dev", "lint", "-h"];
    expect(Object.hasOwn(devLintCommand, "meta")).toBe(false);
    expect(await devLintCommand(argv)).toBe(await runDevLint({ argv, readLapHolder: () => undefined }));
  });
});
