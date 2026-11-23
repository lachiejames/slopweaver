/**
 * `hooks/hooks.json` and `scripts/plugin-mirror-sync.sh` must name the SAME per-root mirror directory.
 *
 * MEASURED once: one mirror shared by every
 * seat on the machine, rewritten by whichever worktree booted last, took every PreToolUse guard off seven
 * `main` seats at once — a missing hook command exits 127, which the host does not treat as a block, so
 * there was no symptom on any of them. Keying the mirror per plugin root fixes that only while the two
 * files agree on the key, and nothing at runtime checks that they do.
 *
 * The cases below are the check. They read the shipped files, not a copy.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { HOOK_MANIFESTS } from "../../../canon/hookManifests.js";
import { MIRROR_KEY_EXPRESSION, MIRROR_KEYED_PREFIX } from "../../hookMirrorKey.js";

const hooksJsons = HOOK_MANIFESTS.map((manifest) => readFileSync(join(process.cwd(), manifest), "utf8"));
const syncScript = readFileSync(join(process.cwd(), "scripts", "plugin-mirror-sync.sh"), "utf8");

/** Every `command` string every hook manifest registers, across every event. */
function everyCommand(): readonly string[] {
  return hooksJsons.flatMap((hooksJson) => {
    const parsed: unknown = JSON.parse(hooksJson);
    const events = (parsed as { hooks: Record<string, { hooks: { command: string }[] }[]> }).hooks;
    return Object.values(events).flatMap((groups) => groups.flatMap((group) => group.hooks.map((h) => h.command)));
  });
}

/** The commands that reach into the plugin mirror — the ones a key has to appear in. */
function mirroredCommands(): readonly string[] {
  return everyCommand().filter((command) => command.includes("/mirror/"));
}

describe("the mirror key both files carry", () => {
  it("is what plugin-mirror-sync.sh assigns MIRROR_KEY to", () => {
    expect(syncScript).toContain(`MIRROR_KEY="${MIRROR_KEY_EXPRESSION}"`);
  });

  it("is what plugin-mirror-sync.sh builds its mirror root from", () => {
    expect(syncScript).toContain(`MIRROR_ROOT="$DATA_ROOT/mirror/by-root$MIRROR_KEY"`);
  });

  it("is carried by every mirrored hook command", () => {
    const commands = mirroredCommands();
    // A registry guard: `filter(bad).toEqual([])` is true of an empty list, and an empty list here would
    // mean the commands stopped naming the mirror at all rather than that they all carry the key.
    expect(commands.length).toBeGreaterThan(0);
    expect(commands.filter((command) => !command.includes(MIRROR_KEYED_PREFIX))).toEqual([]);
  });

  it("leaves no command on the unkeyed path, which is the shape that shared one tree across every seat", () => {
    expect(everyCommand().filter((command) => command.includes("/mirror/current/"))).toEqual([]);
  });
});

/**
 * Every command registered under each event, MERGED across manifests — a host that loads both runs one
 * event's hooks from both files together, so a per-file check would miss a Codex-only entry racing the sync
 * the shared file registers.
 */
function commandsByEvent(): ReadonlyMap<string, readonly string[]> {
  const merged = new Map<string, string[]>();
  for (const hooksJson of hooksJsons) {
    const parsed: unknown = JSON.parse(hooksJson);
    const events = (parsed as { hooks: Record<string, { hooks: { command: string }[] }[]> }).hooks;
    for (const [event, groups] of Object.entries(events)) {
      const commands = groups.flatMap((group) => group.hooks.map((h) => h.command));
      merged.set(event, [...(merged.has(event) ? merged.get(event)! : []), ...commands]);
    }
  }
  return merged;
}

describe("the event that BUILDS the mirror", () => {
  // MEASURED once: SessionStart hooks start in parallel, so a sibling naming `…/current/` ran before
  // `plugin-mirror-sync` had made it on a fresh root and exited 127 — 119 of 152 transcripts in a day, the
  // profile and run brief delivered to none of them. `transcripts boot-hooks` is the probe.
  const building = [...commandsByEvent()].filter(([, commands]) =>
    commands.some((command) => command.includes("plugin-mirror-sync")),
  );

  it("is registered at all — a guard over nothing would pass", () => {
    expect(building.map(([event]) => event)).toEqual(["SessionStart"]);
  });

  it("names no command that depends on the mirror it is still building", () => {
    expect(building.flatMap(([, commands]) => commands.filter((command) => command.includes("/mirror/")))).toEqual([]);
  });
});
