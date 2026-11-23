/** `route capabilities-merge` merges a real source file into a real installed profile. */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  parseRouteCapabilitiesMergeArgs,
  routeCapabilitiesMergeCommand,
  runRouteCapabilitiesMerge,
} from "../../../../../cli/commands/route/capabilitiesMerge.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { routeManifest } from "../../../../../cli/manifests/route.js";
import { unwrapErr } from "../../../../../lib/result.js";
import { loadCapabilityProfile } from "../../../../../route/profileStore.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function freshHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-capabilities-merge-home-"));
  fixtureDirs.push(dir);
  return dir;
}

/** One minimal, valid capability profile carrying exactly the given ids. */
function profileWith({ ids }: { ids: readonly string[] }): unknown {
  return {
    capabilities: ids.map((id) => ({
      availability: { kind: "available" },
      command: ["work-console", id],
      coverage: { detail: "a placeholder capability for the merge test", kind: "unknown" },
      effect: "read",
      freshness: { detail: "a placeholder capability for the merge test", kind: "unknown" },
      id,
      owner: "work-console",
      sourceClass: "provider",
      terms: [id],
      truthMode: "current",
      what: "a placeholder capability for the merge test",
    })),
    schemaVersion: 1,
  };
}

function writeSourceFile({ value }: { value: unknown }): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-capabilities-merge-source-"));
  fixtureDirs.push(dir);
  const path = join(dir, "capabilities.json");
  writeFileSync(path, JSON.stringify(value), "utf8");
  return path;
}

describe("route capabilities-merge", () => {
  it("parses the required --from flag", () => {
    expect(parseRouteCapabilitiesMergeArgs({ rest: ["--from", "/tmp/capabilities.json", "--json"] }).isOk()).toBe(true);
  });

  it("refuses an unknown flag", () => {
    expect(unwrapErr(parseRouteCapabilitiesMergeArgs({ rest: ["--unknown"] }))).toEqual(["unknown flag: --unknown"]);
  });

  it("requires the explicit JSON hand-off mode", () => {
    expect(
      runRouteCapabilitiesMerge(["node", "slopweaver", "route", "capabilities-merge", "--from", "/tmp/x.json"]),
    ).toBe(EXIT_USAGE);
  });

  it("fails loudly when --from names a file that does not exist", () => {
    const home = freshHome();
    expect(
      runRouteCapabilitiesMerge([
        "node",
        "slopweaver",
        "route",
        "capabilities-merge",
        "--from",
        "/nonexistent/capabilities.json",
        "--home",
        home,
        "--json",
      ]),
    ).toBe(EXIT_ERROR);
  });

  it("fails loudly when --from names a file that fails schema validation", () => {
    const home = freshHome();
    const fromPath = writeSourceFile({ value: { capabilities: [], schemaVersion: 2 } });
    expect(
      runRouteCapabilitiesMerge([
        "node",
        "slopweaver",
        "route",
        "capabilities-merge",
        "--from",
        fromPath,
        "--home",
        home,
        "--json",
      ]),
    ).toBe(EXIT_ERROR);
  });

  it("adds every incoming capability when the installed profile is absent", () => {
    const home = freshHome();
    const fromPath = writeSourceFile({ value: profileWith({ ids: ["vanta-controls-atlas", "telemetry"] }) });

    const exit = runRouteCapabilitiesMerge([
      "node",
      "slopweaver",
      "route",
      "capabilities-merge",
      "--from",
      fromPath,
      "--home",
      home,
      "--json",
    ]);

    expect(exit).toBe(EXIT_OK);
    const outcome = loadCapabilityProfile({ home });
    expect(outcome.kind).toBe("profile");
    expect(outcome.kind === "profile" ? outcome.profile.capabilities.map((c) => c.id) : []).toEqual([
      "vanta-controls-atlas",
      "telemetry",
    ]);
  });

  it("never overwrites an installed capability sharing an incoming id", () => {
    const home = freshHome();
    const installFirst = writeSourceFile({ value: profileWith({ ids: ["github-vulnerability-evidence"] }) });
    expect(
      runRouteCapabilitiesMerge([
        "node",
        "slopweaver",
        "route",
        "capabilities-merge",
        "--from",
        installFirst,
        "--home",
        home,
        "--json",
      ]),
    ).toBe(EXIT_OK);
    const overriding = writeSourceFile({
      value: profileWith({ ids: ["github-vulnerability-evidence", "vanta-controls-atlas"] }),
    });

    const exit = runRouteCapabilitiesMerge([
      "node",
      "slopweaver",
      "route",
      "capabilities-merge",
      "--from",
      overriding,
      "--home",
      home,
      "--json",
    ]);

    expect(exit).toBe(EXIT_OK);
    const outcome = loadCapabilityProfile({ home });
    expect(outcome.kind === "profile" ? outcome.profile.capabilities.map((c) => c.id) : []).toEqual([
      "github-vulnerability-evidence",
      "vanta-controls-atlas",
    ]);
  });

  it("--dry-run reports what it would add without writing anything", () => {
    const home = freshHome();
    const fromPath = writeSourceFile({ value: profileWith({ ids: ["vanta-controls-atlas"] }) });

    const exit = runRouteCapabilitiesMerge([
      "node",
      "slopweaver",
      "route",
      "capabilities-merge",
      "--from",
      fromPath,
      "--home",
      home,
      "--dry-run",
      "--json",
    ]);

    expect(exit).toBe(EXIT_OK);
    expect(loadCapabilityProfile({ home }).kind).toBe("absent");
  });

  it("exposes the manifest-selected command as a local-state write", () => {
    expect(routeCapabilitiesMergeCommand).toBe(runRouteCapabilitiesMerge);
    expect(routeManifest["capabilities-merge"]?.meta.effect).toBe("local-state");
  });
});
