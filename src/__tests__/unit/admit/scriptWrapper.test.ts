import { describe, expect, it } from "vitest";

import { classifyScriptSource, scriptPathFromTokens } from "../../../admit/scriptWrapper.js";

/** Tokenise the way `classifySegment` does before handing tokens on. */
function tokens({ command }: { command: string }): readonly string[] {
  return command.split(/\s+/).filter((token) => token.length > 0);
}

/**
 * The shape of the watcher that ran through the door, re-typed rather than copied: a function whose body
 * shells `gh api graphql`, called from a `$(…)` substitution inside a `while :` loop. Every `gh` in it sits
 * in a position the plain token walk never reaches.
 */
const POLLING_WATCHER = [
  "#!/usr/bin/env bash",
  "set -uo pipefail",
  "PR=$1",
  'fetch() { gh api graphql -F pr="$PR" -f query="$SNAP_QUERY" 2>/dev/null || true; }',
  "while :; do",
  "  snap=$(fetch)",
  "  printf '%s' \"$snap\" | jq -r '.data.repository.pullRequest.state'",
  "  sleep 20",
  "done",
].join("\n");

describe("scriptPathFromTokens", () => {
  it("names a direct relative, dotted, and absolute script path", () => {
    expect(scriptPathFromTokens({ tokens: tokens({ command: "scripts/ship/watch.sh --pr 1" }) })).toBe(
      "scripts/ship/watch.sh",
    );
    expect(scriptPathFromTokens({ tokens: tokens({ command: "./watch.sh --pr 1" }) })).toBe("./watch.sh");
    expect(scriptPathFromTokens({ tokens: tokens({ command: "/tmp/w/watch.sh" }) })).toBe("/tmp/w/watch.sh");
  });

  it("unwraps a shell given a script file, and nohup/exec/time in front of either", () => {
    expect(scriptPathFromTokens({ tokens: tokens({ command: "bash scripts/watch.sh 1" }) })).toBe("scripts/watch.sh");
    expect(scriptPathFromTokens({ tokens: tokens({ command: "nohup bash scripts/watch.sh 1" }) })).toBe(
      "scripts/watch.sh",
    );
    expect(scriptPathFromTokens({ tokens: tokens({ command: "exec scripts/watch.sh --pr 1" }) })).toBe(
      "scripts/watch.sh",
    );
    expect(scriptPathFromTokens({ tokens: tokens({ command: "time ./watch.sh" }) })).toBe("./watch.sh");
  });

  it("leaves a `-c` wrapper to the shell-runner walk, and a known tool to the token walk", () => {
    expect(scriptPathFromTokens({ tokens: tokens({ command: "bash -c 'gh pr close 1'" }) })).toBe(undefined);
    expect(scriptPathFromTokens({ tokens: tokens({ command: "/usr/bin/gh pr checks 1" }) })).toBe(undefined);
    expect(scriptPathFromTokens({ tokens: tokens({ command: "/opt/homebrew/bin/git status" }) })).toBe(undefined);
  });

  it("does not treat an ordinary tool on PATH, or a bare shell, as a script", () => {
    expect(scriptPathFromTokens({ tokens: tokens({ command: "jq -r .state" }) })).toBe(undefined);
    expect(scriptPathFromTokens({ tokens: tokens({ command: "bash" }) })).toBe(undefined);
    expect(scriptPathFromTokens({ tokens: tokens({ command: "bash -x" }) })).toBe(undefined);
    expect(scriptPathFromTokens({ tokens: [] })).toBe(undefined);
  });
});

describe("classifyScriptSource", () => {
  it("finds the gh inside a function body called from a substitution inside a loop", () => {
    expect(classifyScriptSource({ source: POLLING_WATCHER })).toEqual({
      reason: "the script shells `gh` internally, reaching GitHub outside the door",
      tool: "gh",
    });
  });

  it("finds gh behind an assignment, a pipe, a wrapper word, and a full path", () => {
    expect(classifyScriptSource({ source: "state=$(gh pr view 1 --json state)" })!.tool).toBe("gh");
    expect(classifyScriptSource({ source: "cat x | gh api graphql --input -" })!.tool).toBe("gh");
    expect(classifyScriptSource({ source: "nohup gh run watch 1 &" })!.tool).toBe("gh");
    expect(classifyScriptSource({ source: "/usr/local/bin/gh pr list" })!.tool).toBe("gh");
    expect(classifyScriptSource({ source: "if gh pr checks 1; then echo ok; fi" })!.tool).toBe("gh");
  });

  it("treats a read-only gh as a reach too — a script is where a one-shot read becomes a loop", () => {
    expect(classifyScriptSource({ source: "gh pr checks 1" })!.tool).toBe("gh");
  });

  it("finds curl, wget and git push, and names each", () => {
    expect(classifyScriptSource({ source: "curl -s https://api.github.com/x" })).toEqual({
      reason: "the script shells `curl` internally, making an external request outside the door",
      tool: "curl",
    });
    expect(classifyScriptSource({ source: "wget -q https://x" })!.tool).toBe("wget");
    expect(classifyScriptSource({ source: "git -C /tmp/r push origin HEAD" })).toEqual({
      reason: "the script pushes with `git` internally, reaching the remote outside the door",
      tool: "git",
    });
  });

  it("ignores a gh that is only a comment, a word in a string argument, or a substring of another name", () => {
    expect(classifyScriptSource({ source: "# gh is not installed here" })).toBe(undefined);
    expect(classifyScriptSource({ source: "echo 'run gh later'" })).toBe(undefined);
    expect(classifyScriptSource({ source: "ghost --haunt" })).toBe(undefined);
    expect(classifyScriptSource({ source: "command -v gh >/dev/null" })).toBe(undefined);
  });

  it("passes a script that reaches nothing", () => {
    expect(classifyScriptSource({ source: "set -e\ngit status\njq -r .x < f.json\nsleep 5" })).toBe(undefined);
    expect(classifyScriptSource({ source: "" })).toBe(undefined);
  });
});
