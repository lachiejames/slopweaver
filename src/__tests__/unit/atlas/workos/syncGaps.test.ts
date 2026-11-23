/**
 * The gap list one sync carries out, for the halves a round trip cannot pin exactly.
 *
 * `syncRoundTrip/routeMap.test.ts` and `syncRoundTrip/browserChannel.test.ts` prove these reach a published
 * file; what is asserted here is the prose and the count a reader actually grades the atlas on — the
 * environment provenance clause, and the fact that the page kind's standing bounds are raised whether or not a
 * segment resolved.
 */
import { describe, expect, it } from "vitest";

import { emptyWorkosKindFile } from "../../../../atlas/workos/model.js";
import {
  environmentProvenance,
  environmentScopedRouteCount,
  gapsFor,
  type WorkosAcquisition,
} from "../../../../atlas/workos/syncGaps.js";

import { AT, TEST_ENVIRONMENT_ID } from "./workosFixtures.js";

/** A run whose credentialled half never happened, which is every run on an install with no key. */
const NO_CONTENT: WorkosAcquisition = {
  content: { connections: [], directories: [], organizations: [], users: [] },
  families: {
    connection: { outcome: "not-configured", reason: "no key" },
    directory: { outcome: "not-configured", reason: "no key" },
    organization: { outcome: "not-configured", reason: "no key" },
    user: { outcome: "not-configured", reason: "no key" },
  },
  outcome: "not-configured",
  probed: [],
  reason: "no key",
};

/** The conditions this run's page gaps raised, in the order they were raised. */
function pageConditions({ environment }: { environment: Parameters<typeof gapsFor>[0]["environment"] }): string[] {
  return gapsFor({
    acquisition: NO_CONTENT,
    at: AT,
    environment,
    kind: "page",
    stored: emptyWorkosKindFile({ kind: "page", updatedAt: AT }),
  }).map((gap) => gap.condition);
}

describe("environmentScopedRouteCount", () => {
  it("counts the declared routes that hang off the segment", () => {
    expect(environmentScopedRouteCount()).toBe(10);
  });
});

describe("environmentProvenance", () => {
  it("names a witnessed walk as the source when one resolved the segment", () => {
    expect(
      environmentProvenance({
        environment: { environmentId: TEST_ENVIRONMENT_ID, source: "witnessed-walk", state: "resolved" },
      }),
    ).toBe("environment witnessed by a previous dashboard walk");
  });

  it("names the environment variable when it is what declared the segment", () => {
    expect(
      environmentProvenance({
        environment: { environmentId: TEST_ENVIRONMENT_ID, source: "environment-variable", state: "resolved" },
      }),
    ).toBe("environment declared by $WORKOS_ENVIRONMENT_ID");
  });

  // The word a reader grades on: "bootstrap" is what separates an address that works from one published
  // only so a walk has somewhere to go.
  it("says the addresses are bootstrap paths when nothing resolved the segment", () => {
    expect(environmentProvenance({ environment: { reason: "no walk yet", state: "unknown" } })).toBe(
      "no environment resolved, so those addresses are the bare bootstrap paths",
    );
  });

  it("never puts the segment itself in the clause, since every deep link beside it already carries one", () => {
    const clause = environmentProvenance({
      environment: { environmentId: TEST_ENVIRONMENT_ID, source: "witnessed-walk", state: "resolved" },
    });
    expect(clause.includes(TEST_ENVIRONMENT_ID)).toBe(false);
  });
});

describe("gapsFor, on the page kind", () => {
  it("raises the unresolved-environment gap when no segment is known", () => {
    const conditions = pageConditions({ environment: { reason: "no walk yet", state: "unknown" } });
    expect(conditions.includes("dashboard-environment-unresolved")).toBe(true);
  });

  it("drops that gap once a segment resolves, since the addresses are no longer bootstrap ones", () => {
    const conditions = pageConditions({
      environment: { environmentId: TEST_ENVIRONMENT_ID, source: "witnessed-walk", state: "resolved" },
    });
    expect(conditions.includes("dashboard-environment-unresolved")).toBe(false);
  });

  // Standing, because no walk has witnessed the address that replaced /sso — a resolved environment does
  // not answer it, so it must survive the case above.
  it("keeps the moved-surface gap whether or not a segment resolved", () => {
    const conditions = pageConditions({
      environment: { environmentId: TEST_ENVIRONMENT_ID, source: "witnessed-walk", state: "resolved" },
    });
    expect(conditions.filter((condition) => condition === "dashboard-surface-moved-unknown-address").length).toBe(1);
  });

  it("raises one unwitnessed gap per declared route, plus the standing bound", () => {
    const conditions = pageConditions({
      environment: { environmentId: TEST_ENVIRONMENT_ID, source: "witnessed-walk", state: "resolved" },
    });
    expect(conditions.filter((condition) => condition === "dashboard-page-unwitnessed").length).toBe(13);
    expect(conditions.includes("dashboard-route-unverifiable-without-session")).toBe(true);
  });
});
