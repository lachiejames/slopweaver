import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { consoleBuildFileDeps, readInstalledPlist } from "../../../checkouts/consoleBuildDeps.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "console-claims-"));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

describe("consoleBuildFileDeps", () => {
  it("creates a claim exclusively, making its directory, and refuses a second taker", () => {
    const deps = consoleBuildFileDeps();
    const path = join(dir, "claims", "100.claim");
    expect(deps.claim({ path })).toBe(true);
    expect(deps.claim({ path })).toBe(false);
    expect(deps.readText({ path })).toBe("");
  });

  it("writes a claim's decision and a stamp's upstream, and reads them back", () => {
    const deps = consoleBuildFileDeps();
    const claim = join(dir, "100.claim");
    deps.markClaim({ decision: "fetch", path: claim });
    deps.stampFetched({ path: join(dir, "fetched"), upstream: "origin/main" });
    expect(deps.readText({ path: claim })).toBe("fetch");
    expect(deps.readText({ path: join(dir, "fetched") })).toBe("origin/main");
  });

  it("reads a missing file as undefined", () => {
    expect(consoleBuildFileDeps().readText({ path: join(dir, "absent") })).toBe(undefined);
  });

  it("sweeps only claims below the bucket, never the stamp", () => {
    const deps = consoleBuildFileDeps();
    for (const name of ["98.claim", "99.claim", "100.claim"]) {
      deps.claim({ path: join(dir, name) });
    }
    deps.stampFetched({ path: join(dir, "fetched"), upstream: "origin/main" });
    deps.sweepClaims({ below: 100, dir });
    expect(readdirSync(dir).toSorted()).toEqual(["100.claim", "fetched"]);
  });

  it("sweeps a directory that does not exist without throwing", () => {
    consoleBuildFileDeps().sweepClaims({ below: 100, dir: join(dir, "absent") });
    expect(existsSync(join(dir, "absent"))).toBe(false);
  });

  it("swallows a write into a directory that does not exist", () => {
    const deps = consoleBuildFileDeps();
    deps.markClaim({ decision: "skip", path: join(dir, "absent", "1.claim") });
    deps.stampFetched({ path: join(dir, "absent", "fetched"), upstream: "origin/main" });
    expect(existsSync(join(dir, "absent"))).toBe(false);
  });
});

describe("readInstalledPlist", () => {
  it("reads no bundle as absent and a bundle's plist as its text", () => {
    const bundle = join(dir, "Slopweaver.app");
    expect(readInstalledPlist({ bundle })).toEqual({ kind: "absent" });
    mkdirSync(join(bundle, "Contents"), { recursive: true });
    writeFileSync(join(bundle, "Contents", "Info.plist"), "<plist/>");
    expect(readInstalledPlist({ bundle })).toEqual({ kind: "read", text: "<plist/>" });
  });

  it("never reads a bundle that is there with no plist as absent", () => {
    const bundle = join(dir, "Slopweaver.app");
    mkdirSync(join(bundle, "Contents"), { recursive: true });
    expect(readInstalledPlist({ bundle })).toEqual({ kind: "failed", why: `${bundle} has no Contents/Info.plist` });
  });

  it("never reads a plist under a directory it may not search as absent", () => {
    const bundle = join(dir, "Slopweaver.app");
    const contents = join(bundle, "Contents");
    mkdirSync(contents, { recursive: true });
    writeFileSync(join(contents, "Info.plist"), "<plist/>");
    chmodSync(contents, 0o000);
    try {
      expect(readInstalledPlist({ bundle }).kind).toBe("failed");
    } finally {
      chmodSync(contents, 0o755);
    }
  });

  it("names a plist path that is not a file as a failed read", () => {
    const bundle = join(dir, "Slopweaver.app");
    mkdirSync(join(bundle, "Contents", "Info.plist"), { recursive: true });
    expect(readInstalledPlist({ bundle })).toEqual({
      kind: "failed",
      why: "EISDIR: illegal operation on a directory, read",
    });
  });
});
