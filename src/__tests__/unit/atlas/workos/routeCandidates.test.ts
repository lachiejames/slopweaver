/**
 * The candidate table's own invariants.
 *
 * The table is the one part of this atlas that is a fact about THIS REPOSITORY rather than about WorkOS
 * (`routeCandidates.ts` says so, and `gaps.ts` raises it as a standing gap). What these tests hold it to is
 * the two promises that make that acceptable: it never carries a real identifier from this installation,
 * and it never asks about the same pair twice — a duplicated pair would publish two entities with one id
 * and the merge would refuse the whole run.
 */
import { describe, expect, it } from "vitest";

import {
  WORKOS_API_ORIGIN,
  WORKOS_ORACLE_CONTROL_PATH,
  WORKOS_ROUTE_CANDIDATES,
  WORKOS_UNMAPPED_ORIGINS,
  workosRouteFamilies,
  workosRouteProviderId,
} from "../../../../atlas/workos/routeCandidates.js";

describe("the candidate table", () => {
  it("asks about each (method, path) pair exactly once", () => {
    const ids = WORKOS_ROUTE_CANDIDATES.map((candidate) =>
      workosRouteProviderId({ httpMethod: candidate.httpMethod, path: candidate.path }),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("never carries the control path, which must never become an entity", () => {
    const paths = WORKOS_ROUTE_CANDIDATES.map((candidate) => candidate.path);
    expect(paths.includes(WORKOS_ORACLE_CONTROL_PATH)).toBe(false);
  });

  // Every id-taking path is probed with an `_x` placeholder, so no organisation, user, connection or
  // directory id from this installation can enter the repository through this table.
  it("uses only `_x` placeholders where an id would go", () => {
    const withIds = WORKOS_ROUTE_CANDIDATES.filter((candidate) => /_(?:x)(?:\/|$)/u.test(candidate.path));
    const realLooking = withIds.filter((candidate) => /[0-9A-HJKMNP-TV-Z]{20,}/u.test(candidate.path));
    expect(realLooking).toEqual([]);
  });

  it("starts every path at the root, so a candidate cannot name a different origin", () => {
    const offOrigin = WORKOS_ROUTE_CANDIDATES.filter((candidate) => !candidate.path.startsWith("/"));
    expect(offOrigin).toEqual([]);
  });

  it("owns one origin, and it is the REST host rather than the dashboard", () => {
    expect(WORKOS_API_ORIGIN).toBe("https://api.workos.com");
  });

  it("declares the FGA origin it does not map, so the family reads as unmapped rather than absent", () => {
    expect(WORKOS_UNMAPPED_ORIGINS.map((unmapped) => unmapped.origin)).toEqual(["https://fga.workos.com"]);
  });
});

describe("workosRouteProviderId", () => {
  it("keys on the METHOD and the path together", () => {
    expect(workosRouteProviderId({ httpMethod: "GET", path: "/organizations" })).toBe("GET /organizations");
    expect(workosRouteProviderId({ httpMethod: "POST", path: "/organizations" })).toBe("POST /organizations");
  });
});

describe("workosRouteFamilies", () => {
  it("deduplicates and sorts, so a printed report is stable", () => {
    const families = workosRouteFamilies();
    expect(new Set(families).size).toBe(families.length);
    expect([...families]).toEqual([...families].toSorted());
  });

  it("names the Vault family, whose refusal vocabulary is its own", () => {
    expect(workosRouteFamilies().includes("Vault")).toBe(true);
  });
});
