import { describe, expect, it } from "vitest";
import { githubStackCommand, runGithubStack } from "../../../../../cli/commands/github/stackRun.js";
import { EXIT_USAGE } from "../../../../../cli/exitCodes.js";

describe("runGithubStack", () => {
  it("refuses an unrecognised sub-verb and prints the usage line", async () => {
    const lines: string[] = [];
    const code = await runGithubStack({
      argv: ["node", "cli", "github", "stack", "rebase"],
      deps: { out: ({ line }) => lines.push(line) },
    });
    expect(code).toBe(EXIT_USAGE);
    expect(lines).toEqual([
      "usage: slopweaver github stack <push|sync|restack|submit|adopt|audit|remove|dissolve> [...]",
    ]);
  });

  it("delegates a recognised sub-verb to its own parser, entirely offline", async () => {
    // No --form: this proves the dispatch genuinely reaches stackPushRun's own parser (which refuses first,
    // before any Git or network read) rather than stopping at the dispatch layer alone.
    const code = await runGithubStack({ argv: ["node", "cli", "github", "stack", "push"] });
    expect(code).toBe(EXIT_USAGE);
  });

  it("delegates sync to its own parser, entirely offline", async () => {
    // An unknown flag: proves the dispatch reaches stackSyncRun's own parser, which refuses before any Git
    // or network read, rather than stopping at the dispatch layer alone.
    const code = await runGithubStack({ argv: ["node", "cli", "github", "stack", "sync", "--unknown"] });
    expect(code).toBe(EXIT_USAGE);
  });

  it("delegates adopt to its own parser, entirely offline", async () => {
    // No --pr: proves the dispatch reaches stackAdoptRun's own parser, which refuses before any Git or
    // network read, rather than stopping at the dispatch layer alone.
    const code = await runGithubStack({ argv: ["node", "cli", "github", "stack", "adopt"] });
    expect(code).toBe(EXIT_USAGE);
  });

  it("wires the registered command to the same dispatch", async () => {
    const code = await githubStackCommand(["node", "cli", "github", "stack", "rebase"]);
    expect(code).toBe(EXIT_USAGE);
  });
});
