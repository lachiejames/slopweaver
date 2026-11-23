/**
 * Reading a `hooks.json`'s mirrored command paths back out of it.
 *
 * The parser is what the mirror-completeness subprocess test compares a built mirror against, so a parser
 * that silently answers nothing would turn that test green while the fleet lost its guards — which is the
 * exact failure being held down. These cases pin it on a hand-written fixture and on the shipped file.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { mirroredHookCommands, PRE_FOLD_PRETOOLUSE_COMMANDS } from "../../liveHookCommands.js";

const MIRROR_PREFIX =
  '"${PLUGIN_DATA:-${CLAUDE_PLUGIN_DATA:-$HOME/.claude/plugins/data/slopweaver}}/mirror/by-root${PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-/_unkeyed}}/current/';

/** A `hooks.json` text naming the given commands under one event. */
function hooksJsonNaming({ commands }: { commands: readonly string[] }): string {
  return JSON.stringify({
    hooks: { PreToolUse: [{ hooks: commands.map((command) => ({ command, type: "command" })) }] },
  });
}

describe("the mirrored command paths of a hooks.json", () => {
  it("reads the path back from a mirrored command", () => {
    const json = hooksJsonNaming({ commands: [`${MIRROR_PREFIX}scripts/pretooluse.sh"`] });
    expect(mirroredHookCommands({ hooksJson: json })).toEqual(["scripts/pretooluse.sh"]);
  });

  it("stops at the closing quote, so arguments after the path are not part of it", () => {
    const json = hooksJsonNaming({ commands: [`${MIRROR_PREFIX}bin/slopweaver" memory hook --from-payload`] });
    expect(mirroredHookCommands({ hooksJson: json })).toEqual(["bin/slopweaver"]);
  });

  it("ignores a command that runs from the plugin root, because that one builds the mirror", () => {
    const json = hooksJsonNaming({
      commands: ['"${PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/scripts/plugin-mirror-sync.sh"'],
    });
    expect(mirroredHookCommands({ hooksJson: json })).toEqual([]);
  });

  it("names each path once, however many events reach for it", () => {
    const json = hooksJsonNaming({
      commands: [`${MIRROR_PREFIX}hooks/handover-run.sh"`, `${MIRROR_PREFIX}hooks/handover-run.sh"`],
    });
    expect(mirroredHookCommands({ hooksJson: json })).toEqual(["hooks/handover-run.sh"]);
  });

  it("finds the shipped hooks.json's own PreToolUse entry", () => {
    const shipped = readFileSync(join(process.cwd(), "hooks", "hooks.json"), "utf8");
    expect(mirroredHookCommands({ hooksJson: shipped })).toContain("scripts/pretooluse.sh");
  });
});

describe("the pre-fold PreToolUse roster", () => {
  it("names the ten shims a seat booted before the fold still reaches for", () => {
    expect(PRE_FOLD_PRETOOLUSE_COMMANDS.length).toBe(10);
  });

  it("holds no path the folded hooks.json itself names, so the two sets do not paper over each other", () => {
    const shipped = readFileSync(join(process.cwd(), "hooks", "hooks.json"), "utf8");
    const current = new Set(mirroredHookCommands({ hooksJson: shipped }));
    expect(PRE_FOLD_PRETOOLUSE_COMMANDS.filter((path) => current.has(path))).toEqual([]);
  });
});
