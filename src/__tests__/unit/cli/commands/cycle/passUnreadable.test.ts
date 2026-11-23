/**
 * `reconcilePass` over a bronze directory that exists and will not list: a typed refusal, never an empty
 * corpus — the read `cycle reconcile --write` would otherwise publish as whole.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { reconcilePass } from "../../../../../cli/commands/cycle/pass.js";
import type { OwnerProtectionResolver } from "../../../../../corpus/bronzeProtection.js";
import { bronzeSourceDir } from "../../../../../corpus/corpusPaths.js";
import { ok, unwrapErr } from "../../../../../lib/result.js";
import { memoryIdentityRosterPort, unavailableIdentityRosterPort } from "../../../../identityRosterFixture.js";

/** An owner protect list with no entries, so no test reads the owner's own registry. */
const NO_ENTRIES: OwnerProtectionResolver = () => ok([]);

const homes: string[] = [];

afterEach(() => {
  homes.splice(0).forEach((home) => {
    rmSync(home, { force: true, recursive: true });
  });
});

/** A home whose `source` bronze path is a FILE, so listing it fails with something other than ENOENT. */
function homeWithUnlistable({ source }: { source: "linear" | "github" }): string {
  const home = mkdtempSync(`${tmpdir()}/cycle-pass-`);
  homes.push(home);
  const dir = bronzeSourceDir({ home, source });
  mkdirSync(dirname(dir), { recursive: true });
  writeFileSync(dir, "not a directory", "utf8");
  return home;
}

describe("reconcilePass over an unlistable bronze directory", () => {
  it.each(["linear", "github"] as const)("refuses a %s directory that will not list, naming it", async (source) => {
    const home = homeWithUnlistable({ source });
    const failure = unwrapErr(
      await reconcilePass({
        home,
        identityRoster: memoryIdentityRosterPort(),
        nowIso: "2026-09-26T00:00:00.000Z",
        protection: NO_ENTRIES,
        verify: false,
      }),
    );
    expect(failure.code).toBe("CORPUS_UNREADABLE");
    expect(failure.message).toContain(`the ${source} bronze directory exists and could not be listed (`);
  });

  it("refuses with CORPUS_PROTECTED when the protect list marks Linear bronze no-access, reading nothing", async () => {
    const home = mkdtempSync(`${tmpdir()}/cycle-pass-`);
    homes.push(home);
    const dir = bronzeSourceDir({ home, source: "linear" });
    mkdirSync(dir, { recursive: true });
    const entry = { addedIso: "2026-01-01T00:00:00.000Z", mode: "no-access" as const, path: dir, why: "fixture" };
    const failure = unwrapErr(
      await reconcilePass({
        home,
        identityRoster: memoryIdentityRosterPort(),
        nowIso: "2026-09-26T00:00:00.000Z",
        protection: () => ok([entry]),
        verify: false,
      }),
    );
    expect(failure).toStrictEqual({
      code: "CORPUS_PROTECTED",
      message: `refusing to read linear: it would search ${dir}, which the owner's protect list marks no-access at ${dir} (fixture)`,
      source: "linear",
    });
  });

  it("reads an absent bronze directory as an ordinary state, not as unreadable", async () => {
    const home = mkdtempSync(`${tmpdir()}/cycle-pass-`);
    homes.push(home);
    const failure = unwrapErr(
      await reconcilePass({
        home,
        identityRoster: memoryIdentityRosterPort(),
        nowIso: "2026-09-26T00:00:00.000Z",
        protection: NO_ENTRIES,
        verify: false,
      }),
    );
    expect(failure.code).toBe("NO_LINEAR_IDENTITY");
  });

  it("refuses with IDENTITY_ROSTER_UNREADABLE when the store cannot answer, never as nobody on Linear", async () => {
    const home = mkdtempSync(`${tmpdir()}/cycle-pass-`);
    homes.push(home);
    const failure = unwrapErr(
      await reconcilePass({
        home,
        identityRoster: unavailableIdentityRosterPort(),
        nowIso: "2026-09-26T00:00:00.000Z",
        protection: NO_ENTRIES,
        verify: false,
      }),
    );
    expect(failure.code).toBe("IDENTITY_ROSTER_UNREADABLE");
    expect(failure.message).toContain("this install keeps its identity roster in the store");
  });
});
