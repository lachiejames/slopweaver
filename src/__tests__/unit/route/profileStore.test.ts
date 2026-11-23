/**
 * The filesystem edge: what `loadCapabilityProfile` returns for a real, absent, invalid, or unreadable
 * `capability-profile.json`.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { CapabilityProfile } from "../../../route/profile.js";
import { loadCapabilityProfile, writeCapabilityProfile } from "../../../route/profileStore.js";
import { stateHomePaths } from "../../../stateHome.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A fresh temp home with nothing in it. */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-capability-profile-"));
  fixtureDirs.push(home);
  return home;
}

/** Write `capability-profile.json` into a temp home with the given raw text, and return the home. */
function seed({ text }: { text: string }): string {
  const home = freshHome();
  writeFileSync(stateHomePaths({ home }).capabilityProfileJson, text, "utf8");
  return home;
}

const VALID_PROFILE: CapabilityProfile = {
  capabilities: [
    {
      availability: { kind: "available" },
      command: ["private-cli", "github", "vulnerability-report"],
      coverage: { detail: "every open Dependabot advisory across the tracked repos", kind: "complete" },
      effect: "read",
      freshness: { detail: "measured from the GitHub API when called", kind: "live" },
      id: "github-vulnerability-report",
      owner: "private-cli",
      sourceClass: "provider",
      terms: ["vulnerability", "vulnerabilities", "cve", "dependabot"],
      truthMode: "current",
      what: "open security vulnerabilities across the tracked repositories",
    },
  ],
  schemaVersion: 1,
};

describe("loadCapabilityProfile", () => {
  it("loads a valid profile", () => {
    const home = seed({ text: JSON.stringify(VALID_PROFILE) });
    const outcome = loadCapabilityProfile({ home });
    expect(outcome).toEqual({ kind: "profile", profile: VALID_PROFILE, skipped: [] });
  });

  it("loads an absent file as absent, not a refusal", () => {
    const home = freshHome();
    expect(loadCapabilityProfile({ home })).toEqual({ kind: "absent" });
  });

  it("loads invalid JSON as unreadable", () => {
    const home = seed({ text: "not json" });
    expect(loadCapabilityProfile({ home }).kind).toBe("unreadable");
  });

  it("loads a schema violation as unreadable", () => {
    const home = seed({ text: JSON.stringify({ capabilities: [], schemaVersion: 2 }) });
    expect(loadCapabilityProfile({ home }).kind).toBe("unreadable");
  });

  it("loads a directory at the capability-profile.json path as unreadable", () => {
    const home = freshHome();
    mkdirSync(stateHomePaths({ home }).capabilityProfileJson);
    expect(loadCapabilityProfile({ home }).kind).toBe("unreadable");
  });

  it("loads an unreadable-permission file as unreadable", () => {
    const home = seed({ text: JSON.stringify(VALID_PROFILE) });
    const path = stateHomePaths({ home }).capabilityProfileJson;
    chmodSync(path, 0o000);
    const outcome = loadCapabilityProfile({ home });
    chmodSync(path, 0o600);
    expect(outcome.kind).toBe("unreadable");
  });
});

describe("writeCapabilityProfile", () => {
  it("writes a profile that loadCapabilityProfile then reads back unchanged", () => {
    const home = freshHome();

    writeCapabilityProfile({ home, profile: VALID_PROFILE });

    expect(loadCapabilityProfile({ home })).toEqual({ kind: "profile", profile: VALID_PROFILE, skipped: [] });
  });

  it("creates the state home directory when it does not exist yet", () => {
    const parent = mkdtempSync(join(tmpdir(), "slopweaver-capability-profile-"));
    fixtureDirs.push(parent);
    const home = join(parent, "not-yet-created");

    writeCapabilityProfile({ home, profile: VALID_PROFILE });

    expect(existsSync(stateHomePaths({ home }).capabilityProfileJson)).toBe(true);
  });

  it("overwrites whatever was already at the path", () => {
    const home = seed({ text: JSON.stringify(VALID_PROFILE) });
    const replacement = { capabilities: [], schemaVersion: 1 as const };

    writeCapabilityProfile({ home, profile: replacement });

    expect(loadCapabilityProfile({ home })).toEqual({ kind: "profile", profile: replacement, skipped: [] });
  });
});
