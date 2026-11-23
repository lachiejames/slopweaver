/**
 * Resolving this installation's WorkOS environment segment.
 *
 * Every case here is a real state an install reaches: nothing walked yet, a walk that WorkOS redirected
 * into an environment, a second environment appearing in the same generation, and an operator declaring one
 * by hand. The resolver is pure, so each is two lines of fixture and an exact assertion.
 */
import { describe, expect, it } from "vitest";

import {
  resolveWorkosEnvironmentId,
  WORKOS_ENVIRONMENT_ID_ENV,
  type WorkosEnvironmentResolution,
  type WorkosWitnessedFinalUrl,
  workosEnvironmentSegmentFromUrl,
} from "../../../../atlas/workos/environmentId.js";

import { TEST_ENVIRONMENT_ID } from "./workosFixtures.js";

/** One stored page row whose browser channel ended on `finalUrl`. */
function walked({ finalUrl }: { finalUrl: string }): WorkosWitnessedFinalUrl {
  return { channels: { browser: { detail: { finalUrl } } } };
}

/** One stored page row no browser has ever looked at. */
function unwalked(): WorkosWitnessedFinalUrl {
  return { channels: { browser: null } };
}

/**
 * The reason an unresolved resolution carries.
 *
 * Throws rather than branching, the way `unwrap` does for a `Result`: a test that reached here on a
 * RESOLVED environment has already failed, and a conditional would let it pass quietly.
 */
function unknownReason({ resolution }: { resolution: WorkosEnvironmentResolution }): string {
  if (resolution.state === "resolved") {
    throw new Error(`expected no resolved environment, got ${resolution.environmentId}`);
  }
  return resolution.reason;
}

describe("workosEnvironmentSegmentFromUrl", () => {
  it("reads the segment a scoped dashboard address hangs off", () => {
    expect(
      workosEnvironmentSegmentFromUrl({ url: `https://dashboard.workos.com/${TEST_ENVIRONMENT_ID}/api-keys` }),
    ).toBe(TEST_ENVIRONMENT_ID);
  });

  it("answers null for a root address, which hangs off no environment", () => {
    expect(workosEnvironmentSegmentFromUrl({ url: "https://dashboard.workos.com/settings/team" })).toBe(null);
  });

  it("answers null for the origin itself", () => {
    expect(workosEnvironmentSegmentFromUrl({ url: "https://dashboard.workos.com" })).toBe(null);
  });

  it("answers null for a first segment that is not shaped like an environment", () => {
    expect(workosEnvironmentSegmentFromUrl({ url: "https://dashboard.workos.com/environments/list" })).toBe(null);
  });

  it("answers null rather than throwing on something that is not a URL", () => {
    expect(workosEnvironmentSegmentFromUrl({ url: "dashboard.workos.com/organizations" })).toBe(null);
  });
});

describe("resolveWorkosEnvironmentId", () => {
  it("resolves the segment a walk was redirected into", () => {
    const resolution = resolveWorkosEnvironmentId({
      env: {},
      pages: [unwalked(), walked({ finalUrl: `https://dashboard.workos.com/${TEST_ENVIRONMENT_ID}/webhooks` })],
    });
    expect(resolution).toEqual({
      environmentId: TEST_ENVIRONMENT_ID,
      source: "witnessed-walk",
      state: "resolved",
    });
  });

  it("resolves one segment from many rows that agree", () => {
    const resolution = resolveWorkosEnvironmentId({
      env: {},
      pages: [
        walked({ finalUrl: `https://dashboard.workos.com/${TEST_ENVIRONMENT_ID}/webhooks` }),
        walked({ finalUrl: `https://dashboard.workos.com/${TEST_ENVIRONMENT_ID}/api-keys` }),
        walked({ finalUrl: "https://dashboard.workos.com/settings/team" }),
      ],
    });
    expect(resolution).toEqual({
      environmentId: TEST_ENVIRONMENT_ID,
      source: "witnessed-walk",
      state: "resolved",
    });
  });

  it("says nothing is known when no walk has ended anywhere scoped, and names both routes out", () => {
    const resolution = resolveWorkosEnvironmentId({
      env: {},
      pages: [unwalked(), walked({ finalUrl: "https://dashboard.workos.com/get-started" })],
    });
    const reason = unknownReason({ resolution });
    expect(reason).toContain("slopweaver atlas workos walk");
    expect(reason).toContain(WORKOS_ENVIRONMENT_ID_ENV);
  });

  // Two environments in one generation means a walk saw somewhere this atlas's content half is blind to,
  // and picking either would deep-link every content row into an environment it does not describe.
  it("refuses to pick between two witnessed environments, and names them", () => {
    const other = "environment_01OTHEROTHEROTHEROTHEROT";
    const resolution = resolveWorkosEnvironmentId({
      env: {},
      pages: [
        walked({ finalUrl: `https://dashboard.workos.com/${TEST_ENVIRONMENT_ID}/webhooks` }),
        walked({ finalUrl: `https://dashboard.workos.com/${other}/webhooks` }),
      ],
    });
    const reason = unknownReason({ resolution });
    expect(reason).toContain(TEST_ENVIRONMENT_ID);
    expect(reason).toContain(other);
  });

  it("takes the declared environment ahead of what a walk witnessed", () => {
    const resolution = resolveWorkosEnvironmentId({
      env: { [WORKOS_ENVIRONMENT_ID_ENV]: "environment_01DECLAREDDECLAREDDECLARE" },
      pages: [walked({ finalUrl: `https://dashboard.workos.com/${TEST_ENVIRONMENT_ID}/webhooks` })],
    });
    expect(resolution).toEqual({
      environmentId: "environment_01DECLAREDDECLAREDDECLARE",
      source: "environment-variable",
      state: "resolved",
    });
  });

  it("gives a declared bare id the prefix the dashboard's own address bar shows", () => {
    const resolution = resolveWorkosEnvironmentId({
      env: { [WORKOS_ENVIRONMENT_ID_ENV]: "01DECLAREDDECLAREDDECLARE" },
      pages: [],
    });
    expect(resolution).toEqual({
      environmentId: "environment_01DECLAREDDECLAREDDECLARE",
      source: "environment-variable",
      state: "resolved",
    });
  });

  it("refuses a declared value that is not an environment segment at all", () => {
    const resolution = resolveWorkosEnvironmentId({
      env: { [WORKOS_ENVIRONMENT_ID_ENV]: "https://dashboard.workos.com/environment_01/users" },
      pages: [],
    });
    const reason = unknownReason({ resolution });
    expect(reason).toContain(WORKOS_ENVIRONMENT_ID_ENV);
  });

  it("ignores an empty declared value and falls to the witnesses", () => {
    const resolution = resolveWorkosEnvironmentId({
      env: { [WORKOS_ENVIRONMENT_ID_ENV]: "   " },
      pages: [walked({ finalUrl: `https://dashboard.workos.com/${TEST_ENVIRONMENT_ID}/api-keys` })],
    });
    expect(resolution).toEqual({
      environmentId: TEST_ENVIRONMENT_ID,
      source: "witnessed-walk",
      state: "resolved",
    });
  });
});
