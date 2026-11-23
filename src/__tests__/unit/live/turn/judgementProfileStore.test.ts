/**
 * The filesystem edge: what `loadJudgementProfile` returns for a real, absent, invalid, or unreadable
 * `judgement/profile.json`, and that `writeJudgementProfile` tightens the directory and file to owner-only
 * on both creation and an already-existing, previously-permissive path (P3 finding #7).
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { loadJudgementProfile, writeJudgementProfile } from "../../../../live/turn/judgementProfileStore.js";
import { stateHomePaths } from "../../../../stateHome.js";

const HASH = `sha256:${"a".repeat(64)}`;

const VALID_PROFILE = {
  provenance: { minedAt: "2026-08-11T00:00:00.000Z", sourceManifestHash: HASH },
  routing: { counterexamples: [], examples: [], principles: [] },
  schemaVersion: 1,
  voice: { examples: [], principles: [] },
};

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A fresh temp home with nothing in it. */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-judgement-profile-"));
  fixtureDirs.push(home);
  return home;
}

/** Write `judgement/profile.json` into a temp home with the given raw text, and return the home. */
function seed({ text }: { text: string }): string {
  const home = freshHome();
  const path = stateHomePaths({ home }).judgement.profileJson;
  mkdirSync(stateHomePaths({ home }).judgement.root, { recursive: true });
  writeFileSync(path, text, "utf8");
  return home;
}

/** The permission bits of a path, as a POSIX octal string (e.g. "700"). */
function modeOf({ path }: { path: string }): string {
  return (statSync(path).mode & 0o777).toString(8);
}

describe("loadJudgementProfile", () => {
  it("loads a valid profile", () => {
    const home = seed({ text: JSON.stringify(VALID_PROFILE) });
    expect(loadJudgementProfile({ home })).toEqual({ kind: "profile", profile: VALID_PROFILE });
  });

  it("loads an absent file as absent, not a refusal", () => {
    const home = freshHome();
    expect(loadJudgementProfile({ home })).toEqual({ kind: "absent" });
  });

  it("loads invalid JSON as unreadable", () => {
    const home = seed({ text: "not json" });
    expect(loadJudgementProfile({ home }).kind).toBe("unreadable");
  });

  it("loads a schema violation as unreadable", () => {
    const home = seed({ text: JSON.stringify({ ...VALID_PROFILE, schemaVersion: 2 }) });
    expect(loadJudgementProfile({ home }).kind).toBe("unreadable");
  });

  it("loads a directory at the profile.json path as unreadable", () => {
    const home = freshHome();
    mkdirSync(stateHomePaths({ home }).judgement.root, { recursive: true });
    mkdirSync(stateHomePaths({ home }).judgement.profileJson);
    expect(loadJudgementProfile({ home }).kind).toBe("unreadable");
  });

  it("loads an unreadable-permission file as unreadable", () => {
    const home = seed({ text: JSON.stringify(VALID_PROFILE) });
    const path = stateHomePaths({ home }).judgement.profileJson;
    chmodSync(path, 0o000);
    const outcome = loadJudgementProfile({ home });
    chmodSync(path, 0o600);
    expect(outcome.kind).toBe("unreadable");
  });
});

describe("writeJudgementProfile", () => {
  it("creates the directory and file at 0700/0600", () => {
    const home = freshHome();
    writeJudgementProfile({ home, profile: VALID_PROFILE });
    const paths = stateHomePaths({ home });
    expect(modeOf({ path: paths.judgement.root })).toBe("700");
    expect(modeOf({ path: paths.judgement.profileJson })).toBe("600");
  });

  it("re-tightens an already-existing, previously-permissive directory", () => {
    const home = freshHome();
    const paths = stateHomePaths({ home });
    mkdirSync(paths.judgement.root, { mode: 0o755, recursive: true });
    expect(modeOf({ path: paths.judgement.root })).toBe("755");
    writeJudgementProfile({ home, profile: VALID_PROFILE });
    expect(modeOf({ path: paths.judgement.root })).toBe("700");
  });

  it("writes a profile that loads back byte-identical", () => {
    const home = freshHome();
    writeJudgementProfile({ home, profile: VALID_PROFILE });
    expect(loadJudgementProfile({ home })).toEqual({ kind: "profile", profile: VALID_PROFILE });
  });
});
