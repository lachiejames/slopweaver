/**
 * The owner's protect list as a deliberate verb reads it: both registries, failing closed, entries under both
 * spellings. Every home here is a throwaway one, and the account default is either injected or the per-file sandbox
 * `setup-ambient-home.ts` installs, so the owner's own registry is never read.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { accountDefaultHome } from "../../../homeDir.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import {
  OwnerProtectionErrors,
  ownerProtection,
  ownerProtectionFor,
  protectionHomes,
  resolvedPathSpellings,
} from "../../../protectedPaths/ownerEntries.js";
import { type ProtectedPath, renderProtectedPaths } from "../../../protectedPaths/registry.js";
import { stateHomePaths } from "../../../stateHome.js";

const ADDED = "2026-11-01T00:00:00.000Z";

let root: string;
beforeEach(() => {
  // Real from the start, so an entry under it has one spelling unless a case adds a symlink on purpose.
  root = realpathSync(mkdtempSync(join(tmpdir(), "slop-owner-entries-")));
});
afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

/**
 * A fixture home with its own registry.
 *
 * @param name the home's directory name under the fixture root
 * @param paths the entries its registry holds, or none for a home with no registry at all
 * @returns the home's path
 */
function homeWith({ name, paths }: { name: string; paths?: readonly ProtectedPath[] }): string {
  const home = join(root, name);
  mkdirSync(home, { recursive: true });
  if (paths !== undefined) {
    writeFileSync(
      stateHomePaths({ home }).protectedPathsJson,
      renderProtectedPaths({ registry: { paths, schemaVersion: 1 } }),
    );
  }
  return home;
}

const entry = ({ path, mode }: Pick<ProtectedPath, "path" | "mode">): ProtectedPath => ({
  addedIso: ADDED,
  mode,
  path,
  why: "synthetic",
});

describe("protectionHomes", () => {
  it("names the home in use and then the account default", () => {
    expect(unwrap(protectionHomes({ accountHome: () => "/account/.slopweaver", home: "/fixture/home" }))).toEqual([
      "/fixture/home",
      "/account/.slopweaver",
    ]);
  });

  it("names a home once when it is the account default", () => {
    expect(unwrap(protectionHomes({ accountHome: () => "/same", home: "/same" }))).toEqual(["/same"]);
  });

  it("fails closed when the account default cannot be resolved", () => {
    const accountHome = (): string => {
      throw new Error("no passwd entry");
    };

    expect(unwrapErr(protectionHomes({ accountHome, home: "/fixture/home" }))).toEqual(
      OwnerProtectionErrors.unknown({ reason: "the account's default home could not be resolved: no passwd entry" }),
    );
  });
});

describe("ownerProtectionFor, with nothing injected", () => {
  // The production composition every un-injected corpus reader reaches (`corpus/bronzeProtection.ts`'s
  // `protectionResolver`): its account registry is this file's sandbox, never the operator's own.
  it("reads the sandboxed account home's registry beside the home in use", () => {
    const accountHome = accountDefaultHome();
    expect(accountHome === join(userInfo().homedir, ".slopweaver")).toBe(false);
    const covered = entry({ mode: "no-access", path: join(root, "covered") });
    writeFileSync(
      stateHomePaths({ home: accountHome }).protectedPathsJson,
      renderProtectedPaths({ registry: { paths: [covered], schemaVersion: 1 } }),
    );

    expect(unwrap(ownerProtectionFor({ home: homeWith({ name: "in-use" }) }))).toEqual([covered]);
  });

  it("finds no entry in a fresh test: the previous case's registry was emptied, and no real one is read", () => {
    expect(unwrap(ownerProtectionFor({ home: homeWith({ name: "in-use" }) }))).toEqual([]);
  });
});

describe("ownerProtection", () => {
  it("merges both registries in order, an absent one contributing nothing", () => {
    const inUse = homeWith({ name: "in-use", paths: [entry({ mode: "no-access", path: join(root, "x") })] });
    const account = homeWith({ name: "account", paths: [entry({ mode: "read-only", path: join(root, "y") })] });
    const bare = homeWith({ name: "bare" });

    expect(unwrap(ownerProtection({ homes: [inUse, bare, account] }))).toEqual([
      entry({ mode: "no-access", path: join(root, "x") }),
      entry({ mode: "read-only", path: join(root, "y") }),
    ]);
  });

  it("keeps one registry's no-access copy of a path beside the other's read-only one, and drops an exact repeat", () => {
    const path = join(root, "both");
    const inUse = homeWith({ name: "in-use", paths: [entry({ mode: "read-only", path })] });
    const account = homeWith({ name: "account", paths: [entry({ mode: "no-access", path })] });
    const repeat = homeWith({ name: "repeat", paths: [entry({ mode: "read-only", path })] });

    expect(unwrap(ownerProtection({ homes: [inUse, account, repeat] }))).toEqual([
      entry({ mode: "read-only", path }),
      entry({ mode: "no-access", path }),
    ]);
  });

  it("expands an entry spelled through a symlink to its real path, a missing last segment included", () => {
    mkdirSync(join(root, "real"));
    symlinkSync(join(root, "real"), join(root, "alias"));
    const home = homeWith({
      name: "home",
      paths: [entry({ mode: "no-access", path: join(root, "alias", "not-yet") })],
    });

    expect(unwrap(ownerProtection({ homes: [home] }))).toEqual([
      entry({ mode: "no-access", path: join(root, "alias", "not-yet") }),
      entry({ mode: "no-access", path: join(root, "real", "not-yet") }),
    ]);
  });

  it("fails closed on a malformed registry", () => {
    const home = homeWith({ name: "home" });
    writeFileSync(stateHomePaths({ home }).protectedPathsJson, "{");

    const error = unwrapErr(ownerProtection({ homes: [home] }));

    expect(error.code).toBe("PROTECTION_UNKNOWN");
    expect(error.reason).toContain(`${stateHomePaths({ home }).protectedPathsJson} is not a protected-path registry`);
  });

  it("fails closed on a registry its reader cannot read", () => {
    const home = homeWith({ name: "home" });
    const readText = (): string => {
      throw new Error("synthetic denial");
    };

    expect(unwrapErr(ownerProtection({ homes: [home], readText }))).toEqual(
      OwnerProtectionErrors.unknown({
        reason: `${stateHomePaths({ home }).protectedPathsJson} could not be read: synthetic denial`,
      }),
    );
  });

  it("fails closed on a dangling symlink where the registry belongs, never reading it as absent", () => {
    const home = homeWith({ name: "home" });
    const file = stateHomePaths({ home }).protectedPathsJson;
    symlinkSync(join(root, "gone.json"), file);

    expect(unwrapErr(ownerProtection({ homes: [home] }))).toEqual(
      OwnerProtectionErrors.unknown({
        reason: `${file} could not be read: ENOENT: no such file or directory, open '${file}'`,
      }),
    );
  });
});

describe("resolvedPathSpellings", () => {
  it("resolves a file not created yet through its symlinked parent", () => {
    mkdirSync(join(root, "real"));
    symlinkSync(join(root, "real"), join(root, "link"));

    expect(resolvedPathSpellings({ path: join(root, "link", "new.jsonl") })).toEqual([
      join(root, "link", "new.jsonl"),
      join(root, "real", "new.jsonl"),
    ]);
  });

  it("gives one spelling for a path with no symlink on it", () => {
    expect(resolvedPathSpellings({ path: join(root, "plain", "new.jsonl") })).toEqual([
      join(root, "plain", "new.jsonl"),
    ]);
  });
});
