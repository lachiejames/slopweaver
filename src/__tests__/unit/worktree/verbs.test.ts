/**
 * The `worktree` verbs' PARSE phase, proved through the real entry points.
 *
 * Only the paths `dryParseSafe` promises are I/O-free are exercised here — `--help`, a missing positional and
 * an unknown flag. Anything past those runs git and yarn, which belongs in the subprocess lane, not this one.
 */
import { describe, expect, it } from "vitest";
import { runWorktreeCreate } from "../../../cli/commands/worktree/createRun.js";
import { runWorktreeHere } from "../../../cli/commands/worktree/hereRun.js";
import { runWorktreeList, runWorktreeRemove, runWorktreeStatus } from "../../../cli/commands/worktree/inventoryRun.js";
import { runWorktreeNoindex } from "../../../cli/commands/worktree/noindexRun.js";
import { EXIT_OK, EXIT_USAGE } from "../../../cli/exitCodes.js";

/** The argv shape the router hands a verb: `[node, cli, noun, verb, …]`. */
function argvFor({ verb, rest }: { verb: string; rest: readonly string[] }): readonly string[] {
  return ["node", "cli", "worktree", verb, ...rest];
}

describe("every worktree verb answers --help without touching anything", () => {
  it("returns success for create, list, remove and status alike", () => {
    expect(runWorktreeCreate(argvFor({ rest: ["--help"], verb: "create" }))).toBe(EXIT_OK);
    expect(runWorktreeList(argvFor({ rest: ["--help"], verb: "list" }))).toBe(EXIT_OK);
    expect(runWorktreeRemove(argvFor({ rest: ["--help"], verb: "remove" }))).toBe(EXIT_OK);
    expect(runWorktreeStatus(argvFor({ rest: ["--help"], verb: "status" }))).toBe(EXIT_OK);
    expect(runWorktreeHere(argvFor({ rest: ["--help"], verb: "here" }))).toBe(EXIT_OK);
    expect(runWorktreeNoindex(argvFor({ rest: ["--help"], verb: "noindex" }))).toBe(EXIT_OK);
  });
});

describe("every worktree verb refuses a flag it does not know", () => {
  it("returns the usage exit code rather than ignoring the flag", () => {
    expect(runWorktreeCreate(argvFor({ rest: ["a-slug", "--nope"], verb: "create" }))).toBe(EXIT_USAGE);
    expect(runWorktreeList(argvFor({ rest: ["--nope"], verb: "list" }))).toBe(EXIT_USAGE);
    expect(runWorktreeRemove(argvFor({ rest: ["a-slug", "--nope"], verb: "remove" }))).toBe(EXIT_USAGE);
    expect(runWorktreeStatus(argvFor({ rest: ["a-slug", "--nope"], verb: "status" }))).toBe(EXIT_USAGE);
    expect(runWorktreeHere(argvFor({ rest: ["--nope"], verb: "here" }))).toBe(EXIT_USAGE);
    expect(runWorktreeNoindex(argvFor({ rest: ["--nope"], verb: "noindex" }))).toBe(EXIT_USAGE);
  });
});

describe("worktree create refuses before it resolves a repository", () => {
  it("needs a slug, and says so rather than creating something named nothing", () => {
    expect(runWorktreeCreate(argvFor({ rest: [], verb: "create" }))).toBe(EXIT_USAGE);
  });

  it("refuses two contradictory switches", () => {
    expect(runWorktreeCreate(argvFor({ rest: ["a-slug", "--build", "--no-build"], verb: "create" }))).toBe(EXIT_USAGE);
  });
});
