import { describe, expect, it } from "vitest";
import type { NounManifestModule } from "../../../../cli/manifest.js";
import { ATLAS_MANIFEST_MODULES } from "../../../../cli/manifests/atlasManifests.js";
import { CORPUS_MANIFEST_MODULES } from "../../../../cli/manifests/corpusManifests.js";
import { DOOR_MANIFEST_MODULES } from "../../../../cli/manifests/doorManifests.js";
import { FLEET_MANIFEST_MODULES } from "../../../../cli/manifests/fleetManifests.js";
import { MANIFEST_MODULES } from "../../../../cli/manifests/index.js";
import { SETUP_MANIFEST_MODULES } from "../../../../cli/manifests/setupManifests.js";

/*
 * The noun barrel is five family files spread into one array. Spreading overwrites nothing and warns of nothing,
 * so a noun written into two families would register twice and `Object.fromEntries` would keep only the later row.
 * These cases pin which family holds which noun, that no noun repeats, and that the barrel is exactly the families
 * in order behind the access-review module. Row CONTENTS stay each noun's own `manifests/<noun>.test.ts`.
 */

/** The nouns a family holds, in its declared order. */
function nounsOf({ family }: { family: readonly NounManifestModule[] }): readonly string[] {
  return family.map((row) => row.noun);
}

const FAMILIES = [
  SETUP_MANIFEST_MODULES,
  CORPUS_MANIFEST_MODULES,
  FLEET_MANIFEST_MODULES,
  DOOR_MANIFEST_MODULES,
  ATLAS_MANIFEST_MODULES,
] as const;

describe("the manifest families", () => {
  it("holds the install, machine and dev-loop nouns in the setup family", () => {
    expect(nounsOf({ family: SETUP_MANIFEST_MODULES })).toEqual([
      "doctor",
      "init",
      "onboard",
      "connect",
      "secrets",
      "protect",
      "dev",
      "catalog",
      "route",
      "claude",
      "codex",
      "checkout",
      "console",
      "desktop",
      "perf",
      "plans",
      "home",
      "proof",
      "worktree",
      "machine",
      "wait",
      "velocity",
      "fresh-cut",
    ]);
  });

  it("holds the local world model's nouns in the corpus family", () => {
    expect(nounsOf({ family: CORPUS_MANIFEST_MODULES })).toEqual([
      "refresh",
      "seed",
      "derive",
      "distil",
      "identity",
      "org",
      "compact",
      "policy",
      "audit",
      "pdf",
      "spend",
      "slice",
      "subset",
      "memory",
      "profile",
      "store",
      "reflect",
    ]);
  });

  it("holds the board, sessions, ledgers and registers in the fleet family", () => {
    expect(nounsOf({ family: FLEET_MANIFEST_MODULES })).toEqual([
      "events",
      "grant",
      "private-terms",
      "ruling",
      "incident",
      "talk",
      "hatch",
      "handover",
      "fleet",
      "cmux",
      "session",
      "transcripts",
      "page",
      "org-health",
      "pane",
      "supervisor",
      "sweep",
      "knowledge",
      "hand",
      "monitor",
      "autonomy",
      "reading",
      "gold",
      "value",
      "automation",
      "session-start",
      "briefing",
      "browser",
      "workstreams",
      "witness",
    ]);
  });

  it("holds the provider doors and the bot's turn path in the door family", () => {
    expect(nounsOf({ family: DOOR_MANIFEST_MODULES })).toEqual([
      "linear",
      "proposal",
      "sop",
      "notion",
      "github",
      "gmail",
      "outlook",
      "outlook-calendar",
      "drive",
      "calendar",
      "slack",
      "listen",
      "turn",
      "queue",
      "responders",
      "cycle",
      "google",
      "gcp",
      "write",
      "vulnerability-fix",
      "alias",
    ]);
  });

  it("holds the platform atlases and live read-only clients in the atlas family", () => {
    expect(nounsOf({ family: ATLAS_MANIFEST_MODULES })).toEqual([
      "atlas",
      "onepassword",
      "crowdstrike",
      "cloudflare",
      "datadog",
      "fathom",
      "chatgpt",
      "hex",
      "twilio",
      "knock",
    ]);
  });

  it("names no noun in two rows, across the families and the barrel", () => {
    const nouns = nounsOf({ family: MANIFEST_MODULES });
    expect(FAMILIES.every((family) => family.length > 0)).toBe(true);
    expect(new Set(nouns).size).toBe(nouns.length);
  });

  it("is the access-review module and then the five families, each row the family's own", () => {
    const expected = [...MANIFEST_MODULES.slice(0, 1), ...FAMILIES.flat()];
    expect(MANIFEST_MODULES[0]!.noun).toBe("access-review");
    expect(MANIFEST_MODULES.length).toBe(expected.length);
    expect(MANIFEST_MODULES.every((row, index) => row === expected[index])).toBe(true);
  });
});
