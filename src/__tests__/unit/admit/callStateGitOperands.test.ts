import { describe, expect, it } from "vitest";

import { gitWorkTreeDestroyed } from "../../../admit/callStateGitOperands.js";
import { shellWords } from "../../../admit/shellLexing.js";

/** What one git command destroys, as the texts of its words and whether it cleans its own directory. */
function destroys({ command }: { command: string }): { texts: readonly string[]; cleansCwd: boolean } {
  const { words } = shellWords({ text: command });
  const read = gitWorkTreeDestroyed({ at: words.findIndex((word) => word.text === "git"), words });
  return { cleansCwd: read.cleansCwd, texts: read.words.map((word) => word.text) };
}

describe("gitWorkTreeDestroyed", () => {
  it.each([
    ["a spaced -c", "git -c 'alias.nuke=reset --hard' nuke"],
    ["an attached -c", "git '-calias.nuke=reset --hard' nuke"],
    ["a key in another case", "git -c 'Alias.Nuke=reset --hard' nuke"],
    ["a shell alias", "git -c 'alias.nuke=!rm -rf talk' nuke"],
    ["--config-env", "git --config-env=alias.nuke=NUKE nuke"],
    ["a GIT_CONFIG_KEY assignment", "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=alias.nuke GIT_CONFIG_VALUE_0=x git nuke"],
  ])("judges the whole tree for a subcommand the command aliases by %s", (_label, command) => {
    expect(destroys({ command })).toEqual({ cleansCwd: true, texts: [] });
  });

  it("does not judge an alias the command defines for a different subcommand than it runs", () => {
    expect(destroys({ command: "git -c 'alias.nuke=reset --hard' status" })).toEqual({ cleansCwd: false, texts: [] });
  });

  it("judges the directory a git clean runs in, unless it is a dry run", () => {
    expect(destroys({ command: "git clean -fd" })).toEqual({ cleansCwd: true, texts: [] });
    expect(destroys({ command: "git clean -n" })).toEqual({ cleansCwd: false, texts: [] });
    expect(destroys({ command: "git clean -n --no-dry-run -fd" })).toEqual({ cleansCwd: true, texts: [] });
  });

  it.each([
    { command: "git rm -f -- talk/calls/a.jsonl", texts: ["talk/calls/a.jsonl"] },
    { command: "git rm --cached a", texts: [] },
    { command: "git rm -n a", texts: [] },
    { command: "git rm -n --no-dry-run -f a", texts: ["a"] },
    { command: "git rm -n --no-dry a", texts: ["a"] },
    { command: "git rm --cached --no-cached a", texts: ["a"] },
    { command: "git mv -n --no-dry-run a b", texts: ["a", "b"] },
    { command: "git restore --staged --no-staged a", texts: ["a"] },
    { command: "git mv a b", texts: ["a", "b"] },
    { command: "git restore a", texts: ["a"] },
    { command: "git restore --staged a", texts: [] },
    { command: "git restore --staged --worktree a", texts: ["a"] },
    { command: "git restore -S a", texts: [] },
    { command: "git restore -SW a", texts: ["a"] },
    { command: "git restore -sS a", texts: ["a"] },
    { command: "git checkout -- a", texts: ["a"] },
    { command: "git status", texts: [] },
  ])("$command destroys $texts in its work tree", ({ command, texts }) => {
    expect(destroys({ command })).toEqual({ cleansCwd: false, texts });
  });

  it.each([
    { cleansCwd: true, command: "git reset --hard" },
    { cleansCwd: true, command: "git checkout -f" },
    { cleansCwd: true, command: "git checkout -fq old" },
    { cleansCwd: true, command: "git reset --har HEAD" },
    { cleansCwd: true, command: "git checkout --forc old" },
    { cleansCwd: true, command: "git switch --disc main" },
    { cleansCwd: false, command: "git reset --soft HEAD" },
    { cleansCwd: true, command: "git clean -en" },
    { cleansCwd: false, command: "git clean -fn" },
    { cleansCwd: true, command: "git switch --discard-changes main" },
    { cleansCwd: true, command: "git restore :/talk/calls/a.jsonl" },
    { cleansCwd: true, command: "git rm -f 'talk/*'" },
    { cleansCwd: true, command: "git restore --pathspec-from-file=list" },
    { cleansCwd: true, command: "git restore --pathspec-from-f=list" },
    { cleansCwd: true, command: "git checkout --pathspec-fr list" },
    { cleansCwd: true, command: "git rm --pathspec-from-file list" },
    { cleansCwd: false, command: "git reset HEAD~1" },
    { cleansCwd: false, command: "git switch main" },
  ])("$command discards the whole work tree: $cleansCwd", ({ command, cleansCwd }) => {
    expect(destroys({ command })).toEqual({ cleansCwd, texts: [] });
  });

  it.each([
    { cleansCwd: false, command: "command git -C /h restore -- a", texts: ["/h/a"] },
    { cleansCwd: false, command: "FOO=1 git -C sub -C x rm a", texts: ["sub/x/a"] },
    { cleansCwd: true, command: "command git -Csub reset --hard", texts: ["sub"] },
    { cleansCwd: false, command: "command git -C /h status", texts: [] },
    { cleansCwd: false, command: "git -C /h restore a", texts: ["/h/a"] },
    { cleansCwd: false, command: "git -C .. rm -- a", texts: ["../a"] },
    // An unknown expansion may already be absolute, so it is judged as written and under the -C both.
    { cleansCwd: false, command: 'command git -C /h clean -f -- "$OTHER"x', texts: ["$OTHERx", "/h/$OTHERx"] },
    { cleansCwd: false, command: 'git -C /h rm -- "$HOME"/a', texts: ["$HOME/a"] },
  ])("$command applies git's own -C, wrapped or not, exactly once: $texts", ({ command, cleansCwd, texts }) => {
    expect(destroys({ command })).toEqual({ cleansCwd, texts });
  });

  it.each([
    { command: "git --work-tree=/h clean -fdx", texts: ["/h"] },
    { command: "git --work-tree /h clean -fd -- a", texts: ["/h"] },
    { command: "GIT_WORK_TREE=/h git clean -f", texts: ["/h"] },
    { command: "git --work-tree=/h clean -n", texts: [] },
    { command: "git --git-dir=/h/.git -c core.worktree=/h restore -- a", texts: ["/h"] },
    { command: "git -ccore.workTree=/h checkout -- a", texts: ["/h"] },
    { command: "git -c user.name=x restore -- a", texts: ["a"] },
    { command: "echo core.worktree=/h && git restore -- a", texts: ["a"] },
  ])("$command judges the work tree it cleans: $texts", ({ command, texts }) => {
    expect(destroys({ command })).toEqual({ cleansCwd: false, texts });
  });
});
