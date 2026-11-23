/**
 * The false-STALE defect, re-run over a REAL fixture tree rather than over literal numbers.
 *
 * `installFreshness`'s own tests take three integers, so they cannot see which files were read — and the
 * defect was entirely about which file the installed side of the comparison came from. These build a tree
 * shaped exactly as the measured checkout was (yarn's state file older than a lockfile a fast-forward has
 * just stamped) and drive the real stat seam over it.
 */
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { measureInstall, productionInspectDeps } from "../../../checkouts/inspect.js";
import { installVerifiedPath, recordInstallVerified } from "../../../checkouts/installMark.js";

/** Seconds since the epoch for the fixture's own stamps — far enough apart that no filesystem rounds them together. */
const LOCKFILE_SECONDS = 1_788_000_000;

/** The yarn state file's stamp: an hour BEFORE the lockfile, which is the measured post-fast-forward shape. */
const INSTALL_STATE_SECONDS = LOCKFILE_SECONDS - 3_600;

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

/** A checkout-shaped fixture whose installed tree is older than the lockfile beside it. */
function fixtureTree(): string {
  const root = mkdtempSync(join(tmpdir(), "slopweaver-mark-"));
  roots.push(root);
  mkdirSync(join(root, "node_modules"));
  writeFileSync(join(root, "package.json"), '{"name":"fixture"}\n', "utf8");
  writeFileSync(join(root, "yarn.lock"), "# fixture\n", "utf8");
  writeFileSync(join(root, "node_modules", ".yarn-state.yml"), "__metadata:\n  version: 1\n", "utf8");
  utimesSync(join(root, "node_modules", ".yarn-state.yml"), INSTALL_STATE_SECONDS, INSTALL_STATE_SECONDS);
  utimesSync(join(root, "yarn.lock"), LOCKFILE_SECONDS, LOCKFILE_SECONDS);
  utimesSync(join(root, "package.json"), LOCKFILE_SECONDS, LOCKFILE_SECONDS);
  return root;
}

describe("the verified-install mark over a fixture tree", () => {
  it("reads STALE while only yarn's own state file speaks — the reported defect", () => {
    expect(measureInstall({ deps: productionInspectDeps(), path: fixtureTree() })).toBe("stale");
  });

  it("reads current once a verified install is recorded, without yarn's file moving", () => {
    const root = fixtureTree();
    expect(recordInstallVerified({ nowIso: "2026-09-06T12:00:00.000Z", root })).toBe(undefined);
    expect(measureInstall({ deps: productionInspectDeps(), path: root })).toBe("current");
  });

  it("goes back to STALE when the lockfile is touched after the verified install", () => {
    const root = fixtureTree();
    recordInstallVerified({ nowIso: "2026-09-06T12:00:00.000Z", root });
    const later = Math.round(Date.now() / 1000) + 600;
    utimesSync(join(root, "yarn.lock"), later, later);
    expect(measureInstall({ deps: productionInspectDeps(), path: root })).toBe("stale");
  });

  it("does not call a mark beside a missing yarn state file an install", () => {
    const root = fixtureTree();
    rmSync(join(root, "node_modules", ".yarn-state.yml"));
    recordInstallVerified({ nowIso: "2026-09-06T12:00:00.000Z", root });
    expect(measureInstall({ deps: productionInspectDeps(), path: root })).toBe("never-installed");
  });

  it("reports the failure rather than throwing when there is no node_modules to write into", () => {
    const root = mkdtempSync(join(tmpdir(), "slopweaver-mark-"));
    roots.push(root);
    expect(recordInstallVerified({ nowIso: "2026-09-06T12:00:00.000Z", root })).toContain("ENOENT");
  });

  it("writes the mark inside node_modules, so removing the tree removes the claim about it", () => {
    const root = fixtureTree();
    expect(installVerifiedPath({ root })).toBe(join(root, "node_modules", ".slopweaver-install-verified"));
  });
});
