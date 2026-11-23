import { describe, expect, it } from "vitest";

import { JUMPCLOUD_EXCLUSIONS, jumpcloudExclusionFor } from "../../../../atlas/jumpcloud/exclusions.js";
import { JUMPCLOUD_SURFACES } from "../../../../atlas/jumpcloud/generated/surfaces.js";

const reachable = JUMPCLOUD_SURFACES.filter((r) => r.coverage === "reachable");
const excluded = JUMPCLOUD_SURFACES.filter((r) => r.coverage === "excluded");
const posts = JUMPCLOUD_SURFACES.filter((r) => r.method === "POST");

describe("the generated registry census", () => {
  it("holds 503 rows", () => {
    expect(JUMPCLOUD_SURFACES.length).toBe(503);
  });

  it("splits 487 reachable and 16 excluded", () => {
    expect(reachable.length).toBe(487);
    expect(excluded.length).toBe(16);
  });

  it("gives every exclusion in the table a row, so a refusal is stated rather than silent", () => {
    expect(excluded.length).toBe(JUMPCLOUD_EXCLUSIONS.length);
  });

  it("names every excluded row's reason", () => {
    expect(excluded.filter((r) => r.excludedBecause === null)).toStrictEqual([]);
  });

  it("leaves every reachable row's exclusion reason null", () => {
    expect(reachable.filter((r) => r.excludedBecause !== null)).toStrictEqual([]);
  });
});

describe("read-only, enforced by what the registry admits", () => {
  it("admits no membership-write POST, which reads like traversal and manages group members", () => {
    const memberWrites = posts.filter((r) => r.path.endsWith("/members") && r.coverage === "reachable");
    expect(memberWrites).toStrictEqual([]);
  });

  it("admits exactly 15 observational POSTs", () => {
    expect(posts.filter((r) => r.coverage === "reachable").length).toBe(15);
  });

  it("admits no reachable POST outside the reviewed observational set", () => {
    const admitted = posts.filter((r) => r.coverage === "reachable").map((r) => r.path);
    const stray = admitted.filter(
      (p) => !/\/search\/|\/events(\/|$)|\/directoryinsights\/events\/|\/authn\/policy-evaluations\//.test(p),
    );
    expect(stray).toStrictEqual([]);
  });

  it("reaches only the two pinned origins", () => {
    expect([...new Set(JUMPCLOUD_SURFACES.map((r) => r.origin))].toSorted()).toStrictEqual(["directory", "insights"]);
  });

  it("uses no method other than GET or POST", () => {
    expect([...new Set(JUMPCLOUD_SURFACES.map((r) => r.method))].toSorted()).toStrictEqual(["GET", "POST"]);
  });
});

describe("registry integrity", () => {
  it("gives every row a unique surface name, so a caller can never address two operations", () => {
    expect(new Set(JUMPCLOUD_SURFACES.map((r) => r.name)).size).toBe(JUMPCLOUD_SURFACES.length);
  });

  it("sorts by surface name, so a regeneration diff shows a change in place", () => {
    const names = JUMPCLOUD_SURFACES.map((r) => r.name);
    expect(names.toSorted((a, b) => a.localeCompare(b))).toStrictEqual(names);
  });

  it("prefixes every path with a pinned version segment", () => {
    const bad = JUMPCLOUD_SURFACES.filter((r) => !/^\/(api|api\/v2|insights\/directory\/v1)\//.test(r.path));
    expect(bad).toStrictEqual([]);
  });

  it("carries the 60 System Insights tables the ISO endpoint question needs", () => {
    expect(reachable.filter((r) => r.kind === "systeminsights").length).toBe(60);
  });
});

describe("the generated registry against the exclusion table", () => {
  /**
   * The generated file is written by `tools/generateJumpcloudSurfaces.ts` from `exclusions.ts`, so the two
   * must agree exactly. This is the gate that makes a hand-edit safe: an edit that does not match what the
   * generator would produce fails here, and a regeneration cannot silently disagree with the table either.
   */
  it("marks a row excluded exactly when the exclusion table refuses that path and method", () => {
    const disagreeing = JUMPCLOUD_SURFACES.filter((row) => {
      const pathKey = row.path.replace(/^\/api\/v2|^\/api|^\/insights\/directory\/v1/, "");
      const refused = jumpcloudExclusionFor({ method: row.method, pathKey });
      return (refused === undefined) !== (row.coverage === "reachable");
    }).map((row) => row.name);

    expect(disagreeing).toStrictEqual([]);
  });

  it("carries each excluded row's reason verbatim from the table", () => {
    const wrong = JUMPCLOUD_SURFACES.filter((row) => row.coverage === "excluded")
      .filter((row) => {
        const pathKey = row.path.replace(/^\/api\/v2|^\/api|^\/insights\/directory\/v1/, "");
        return row.excludedBecause !== jumpcloudExclusionFor({ method: row.method, pathKey })?.detail;
      })
      .map((row) => row.name);

    expect(wrong).toStrictEqual([]);
  });
});
