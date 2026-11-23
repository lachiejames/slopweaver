import { describe, expect, it } from "vitest";

import type { HiveSyncOutcome } from "../../../../atlas/graphqlHive/sync.js";
import {
  exitCodeForHiveSync,
  renderHiveSyncLines,
  splitOrganizationSlugs,
} from "../../../../cli/commands/graphqlHiveAtlas/syncRun.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../../../cli/exitCodes.js";

/** One sync outcome, with only the fields a test pins. */
function outcome({ registry }: { registry: HiveSyncOutcome["registry"] }): HiveSyncOutcome {
  return {
    operationCount: 26,
    organizationCount: 0,
    pageCount: 2,
    projectCount: 0,
    registry,
    registryReason: registry === "synced" ? null : "no token",
    schemasStored: 0,
    targetCount: 0,
    typeCount: 257,
    written: [],
  };
}

describe("exitCodeForHiveSync", () => {
  it("is clean only when both halves ran", () => {
    expect(exitCodeForHiveSync({ outcome: outcome({ registry: "synced" }) })).toBe(EXIT_OK);
  });

  it("reports an unconfigured registry as expected-empty, the ordinary state of an SSO-only install", () => {
    expect(exitCodeForHiveSync({ outcome: outcome({ registry: "not-configured" }) })).toBe(EXIT_EXPECTED_EMPTY);
  });

  it("reports a schema that no longer declares the content query as expected-empty, not as a crash", () => {
    expect(exitCodeForHiveSync({ outcome: outcome({ registry: "unsupported" }) })).toBe(EXIT_EXPECTED_EMPTY);
  });

  it("fails when the registry was genuinely attempted and broke", () => {
    expect(exitCodeForHiveSync({ outcome: outcome({ registry: "failed" }) })).toBe(EXIT_ERROR);
  });
});

describe("splitOrganizationSlugs", () => {
  it("splits a comma-separated list", () => {
    expect(splitOrganizationSlugs({ value: "a,b" })).toStrictEqual(["a", "b"]);
  });

  it("trims each entry", () => {
    expect(splitOrganizationSlugs({ value: " a , b " })).toStrictEqual(["a", "b"]);
  });

  it("drops a blank entry, so an empty selector is never sent", () => {
    expect(splitOrganizationSlugs({ value: "a,,b," })).toStrictEqual(["a", "b"]);
  });

  it("answers nothing when neither the flag nor the environment named one", () => {
    expect(splitOrganizationSlugs({ value: null })).toStrictEqual([]);
  });
});

describe("renderHiveSyncLines", () => {
  it("leads with the surface map, which is the half that runs with no credential", () => {
    expect(renderHiveSyncLines({ outcome: outcome({ registry: "synced" }) })[0]).toBe(
      "graphql-hive api surface — 26 operation(s) and 257 type(s) from one introspection",
    );
  });

  it("prints the registry's stated reason when there is one, so a gap is visible at the terminal", () => {
    expect(renderHiveSyncLines({ outcome: outcome({ registry: "not-configured" }) })).toContain("  no token");
  });

  it("prints three lines when the registry synced and there is nothing to explain", () => {
    expect(renderHiveSyncLines({ outcome: outcome({ registry: "synced" }) }).length).toBe(3);
  });
});
