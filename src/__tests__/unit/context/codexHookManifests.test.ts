/**
 * Which host reads which hook manifest — the only boundary keeping the Codex rules injection out of Claude.
 *
 * `.codex-plugin/plugin.json`'s `hooks` REPLACES Codex's default of `hooks/hooks.json`, so a list that drops
 * the shared file turns every guard off in Codex with no symptom. Claude Code reads `hooks/hooks.json` only;
 * a Codex-only entry reaching it would load every always-on rule twice. `../../../canon/hookManifests.ts`
 * carries the measurement.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CODEX_ONLY_HOOK_MANIFEST,
  CODEX_PLUGIN_HOOKS,
  HOOK_MANIFESTS,
  SHARED_HOOK_MANIFEST,
} from "../../../canon/hookManifests.js";

const read = ({ path }: { path: string }): string => readFileSync(join(process.cwd(), path), "utf8");

describe("the Codex plugin manifest", () => {
  it("names the shared manifest first, then the Codex-only one, and nothing else", () => {
    const manifest = JSON.parse(read({ path: ".codex-plugin/plugin.json" })) as { hooks: unknown };
    expect(manifest.hooks).toEqual(["./hooks/hooks.json", "./hooks/codex-hooks.json"]);
    expect(CODEX_PLUGIN_HOOKS).toEqual(manifest.hooks);
  });

  it("names only files that exist", () => {
    expect(HOOK_MANIFESTS.length).toBeGreaterThan(0);
    expect(HOOK_MANIFESTS.filter((path) => !existsSync(join(process.cwd(), path)))).toEqual([]);
  });
});

describe("the Claude plugin", () => {
  it("declares no hooks field, so Claude Code reads the shared manifest alone", () => {
    const manifest = JSON.parse(read({ path: ".claude-plugin/plugin.json" })) as Record<string, unknown>;
    expect(Object.keys(manifest)).not.toContain("hooks");
  });

  it("never registers the Codex rules emitter in the manifest it reads", () => {
    expect(read({ path: CODEX_ONLY_HOOK_MANIFEST })).toContain("codex rules-context");
    expect(read({ path: SHARED_HOOK_MANIFEST })).not.toContain("codex rules-context");
  });
});

describe("the Codex-only manifest", () => {
  it("passes the whole rules text to the model rather than a spilled preview", () => {
    const parsed = JSON.parse(read({ path: CODEX_ONLY_HOOK_MANIFEST })) as {
      hooks: { SessionStart: { matcher: string; hooks: { additionalContextLimit: number }[] }[] };
    };
    const group = parsed.hooks.SessionStart[0]!;
    expect(group.matcher).toBe("startup|resume|clear|compact");
    expect(group.hooks[0]!.additionalContextLimit).toBe(0);
  });
});
