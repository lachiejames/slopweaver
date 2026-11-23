import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { JumpcloudFetch } from "../../../../atlas/jumpcloud/client.js";
import { readJumpcloudSnapshot } from "../../../../atlas/jumpcloud/readAdapter.js";
import { admitJumpcloudPage, type JumpcloudAdmit } from "../../../../atlas/jumpcloud/responseRegistry.js";
import { readJumpcloudResume } from "../../../../atlas/jumpcloud/resume.js";
import { jumpcloudAtlasPaths, readJumpcloudAtlas } from "../../../../atlas/jumpcloud/store.js";
import { syncJumpcloudAtlas } from "../../../../atlas/jumpcloud/sync.js";
import type { JumpcloudSyncDeps } from "../../../../atlas/jumpcloud/syncDeps.js";
import { unwrap } from "../../../../lib/result.js";
import { admitAnyCarrier } from "../../../jumpcloudCarrierAdmit.js";

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** A throwaway state home, removed after every test. */
function scratchHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-jumpcloud-sync-"));
  homes.push(home);
  return home;
}

/**
 * A provider that holds exactly one system and nothing else, so the walk has something real to publish
 * without the fixture becoming a second implementation of JumpCloud.
 */
function tenancyWithOneSystem({ failOn }: { failOn?: string } = {}): JumpcloudFetch {
  return async ({ url }) => {
    if (failOn !== undefined && url.includes(failOn)) {
      // A redirect: the boundary refuses to follow one, and it is BLOCKING because the next run may well
      // not be redirected. A 5xx would prove the same thing while spending the whole retry budget, and a
      // 400 would prove the opposite — the provider refusing the request is a settled fact, not a failure.
      return { headers: {}, status: 302, text: "" };
    }
    if (url === "https://console.jumpcloud.com/api/systems") {
      return {
        headers: {},
        status: 200,
        text: JSON.stringify({ results: [{ _id: "sys-1", hostname: "laptop", displayName: "Laptop" }], totalCount: 1 }),
      };
    }
    if (url.startsWith("https://console.jumpcloud.com/api/systems/sys-1")) {
      return { headers: {}, status: 200, text: JSON.stringify({ _id: "sys-1", hostname: "laptop" }) };
    }
    return { headers: { "x-total-count": "0" }, status: 200, text: "[]" };
  };
}

// A JumpCloud administrator key is forty hex characters, and the gate matches the configured one verbatim
// wherever it appears. A one-character stand-in here matched the letter `k` in every document under test.
const TEST_API_KEY = "0f1e2d3c4b5a69788796a5b4c3d2e1f009182736";

/** The walk's dependencies over a fake tenancy, its invented records admitted by carrier unless a test says otherwise. */
function deps({
  fetch,
  admit = admitAnyCarrier,
}: {
  fetch: JumpcloudFetch;
  admit?: JumpcloudAdmit;
}): JumpcloudSyncDeps {
  let tick = 0;
  return {
    admit,
    client: { apiKey: TEST_API_KEY, fetch, orgId: null },
    now: () => {
      tick += 1;
      return new Date(Date.UTC(2026, 8, 4, 10, 0, tick)).toISOString();
    },
    progress: () => undefined,
  };
}

/** The same tenancy, except one device description carries the administrator key this sync authenticates with. */
function tenancyLeakingTheAdminKey(): JumpcloudFetch {
  const inner = tenancyWithOneSystem();
  return async (input) => {
    if (input.url === "https://console.jumpcloud.com/api/systems") {
      return {
        headers: {},
        status: 200,
        text: JSON.stringify({
          results: [{ _id: "sys-1", description: `provisioned with ${TEST_API_KEY}`, hostname: "laptop" }],
          totalCount: 1,
        }),
      };
    }
    return inner(input);
  };
}

/**
 * Every test here runs a WHOLE sync over the 488 reachable rows of the generated surface registry, so each
 * one is seconds of real work rather than milliseconds. MEASURED: the file takes 5.24s of test
 * time in isolation and passes, and the same two cases timed out against vitest's 5000ms default when the
 * machine was also running `yarn validate` — twice, in a pre-push gate, on a branch that touches none of
 * this. Reproduce by running `yarn validate` and `yarn vitest run --config config/vitest/unit.ts` at once.
 *
 * The local pre-push hook no longer runs this lane at all (CI runs it), which removes one way to
 * hit it and not the budget itself: a CI runner under its own load is the same bet.
 *
 * So the ceiling is raised rather than the work shrunk: a sync test that walked fewer families would stop
 * being a test of the sync.
 */
const SYNC_TIMEOUT_MS = 20_000;

describe("syncJumpcloudAtlas", () => {
  it(
    "publishes a generation the read verb can then answer devices from",
    async () => {
      const home = scratchHome();
      const report = unwrap(await syncJumpcloudAtlas({ deps: deps({ fetch: tenancyWithOneSystem() }), home }));
      expect(report.published).toBe(true);
      expect(report.refusals).toEqual([]);
      const snapshot = unwrap(readJumpcloudSnapshot({ home }));
      const systems = snapshot.kinds.find((kind) => kind.kind === "systems")!;
      // The identity is the CALL plus the record's own id, so a device read from the root collection is
      // `<surface>#<id>` — see `syncEntities.ts` on the collision that made a bare id wrong.
      expect(systems.entities.some((entity) => entity.providerId === "v1-systems-list#sys-1")).toBe(true);
    },
    SYNC_TIMEOUT_MS,
  );

  it(
    "stamps the manifest clock from the same publish that wrote the kind files",
    async () => {
      const home = scratchHome();
      await syncJumpcloudAtlas({ deps: deps({ fetch: tenancyWithOneSystem() }), home });
      const snapshot = unwrap(readJumpcloudAtlas({ paths: jumpcloudAtlasPaths({ home }) }));
      const kindClock = snapshot.files.systems!.updatedAt;
      expect(snapshot.manifest!.updatedAt).toBe(kindClock);
    },
    SYNC_TIMEOUT_MS,
  );

  it(
    "interleaves the walk so two multi-operation families overlap in time rather than running in series",
    async () => {
      const home = scratchHome();
      await syncJumpcloudAtlas({ deps: deps({ fetch: tenancyWithOneSystem() }), home });
      const snapshot = unwrap(readJumpcloudAtlas({ paths: jumpcloudAtlasPaths({ home }) }));
      // `systeminsights` was this assertion's second family until the family was shape-indexed
      // and taken it out of the walk entirely. `systemusers` replaces it on the property that matters here —
      // several operations under one kind — rather than the file being the one the walk happened to be
      // slowest on.
      const systems = snapshot.files.systems!.readEpoch!;
      const users = snapshot.files.systemusers!.readEpoch!;
      expect(systems.startedAt < users.endedAt).toBe(true);
      expect(users.startedAt < systems.endedAt).toBe(true);
    },
    SYNC_TIMEOUT_MS,
  );

  it("publishes nothing at all when one family failed for a reason a later run could clear", async () => {
    const home = scratchHome();
    const report = unwrap(
      await syncJumpcloudAtlas({ deps: deps({ fetch: tenancyWithOneSystem({ failOn: "/api/systems" }) }), home }),
    );
    expect(report.published).toBe(false);
    expect(report.written).toEqual([]);
    expect(report.refusals.some((line) => line.includes("nothing was published"))).toBe(true);
    expect(readJumpcloudAtlas({ paths: jumpcloudAtlasPaths({ home }) }).isOk()).toBe(true);
  });

  it("publishes nothing when a family ANSWERED but came up short of the total the provider declared", async () => {
    const home = scratchHome();
    let page = 0;
    const short: JumpcloudFetch = async ({ url }) => {
      if (url.startsWith("https://console.jumpcloud.com/api/systems")) {
        // One record against a synthetic declared 250, then the provider runs out. Every call succeeded and this is
        // still not the family, which is what an unstable page order looks like from here.
        page += 1;
        const results = page === 1 ? [{ _id: "sys-1" }] : [];
        return { headers: {}, status: 200, text: JSON.stringify({ results, totalCount: 250 }) };
      }
      return { headers: { "x-total-count": "0" }, status: 200, text: "[]" };
    };
    const report = unwrap(await syncJumpcloudAtlas({ deps: deps({ fetch: short }), home }));
    expect(report.published).toBe(false);
    expect(report.refusals.some((line) => line.includes("of the 250 the provider declared"))).toBe(true);
  });

  it("publishes a permission boundary as coverage rather than refusing the whole generation for it", async () => {
    const home = scratchHome();
    const refused: JumpcloudFetch = async ({ url }) => {
      if (url.startsWith("https://console.jumpcloud.com/api/systems")) {
        return { headers: {}, status: 403, text: "" };
      }
      return { headers: { "x-total-count": "0" }, status: 200, text: "[]" };
    };
    const report = unwrap(await syncJumpcloudAtlas({ deps: deps({ fetch: refused }), home }));
    expect(report.published).toBe(true);
    const systems = report.kinds.find((kind) => kind.kind === "systems")!;
    expect(systems.state).toBe("unreadable");
    const stored = unwrap(readJumpcloudAtlas({ paths: jumpcloudAtlasPaths({ home }) })).files.systems!;
    expect(stored.coverage[0]!.reason).toContain("permission boundary");
    expect(stored.gaps.some((gap) => gap.condition === "auth-refused")).toBe(true);
  });

  it("publishes a product this organisation does not have as named-absent rather than refusing for it", async () => {
    // Measured: on a tenancy without Google Chrome Enterprise Premium, `/api/v2/gcep/configuration`
    // answers 404, and every publish was refused because gcep was a never-acquired mandatory kind.
    const home = scratchHome();
    const inner = tenancyWithOneSystem();
    const noGcep: JumpcloudFetch = async (input) => {
      if (input.url.startsWith("https://console.jumpcloud.com/api/v2/gcep/")) {
        return { headers: {}, status: 404, text: "" };
      }
      return inner(input);
    };
    const report = unwrap(await syncJumpcloudAtlas({ deps: deps({ fetch: noGcep }), home }));
    expect(report.refusals).toEqual([]);
    expect(report.published).toBe(true);
    const gcep = unwrap(readJumpcloudAtlas({ paths: jumpcloudAtlasPaths({ home }) })).manifest!.kinds.gcep;
    expect(gcep.lastSuccessAt).toBe(null);
    expect(gcep.permissionBlocked).toBe(undefined);
    expect(gcep.productAbsent!.detail).toContain("v2-google-chrome-enterprise-premium-service-get-configuration");
    expect(gcep.productAbsent!.detail).toContain("answered 404");
  });

  it("does not call a family absent when a 404 is one record gone among records it did read", async () => {
    const home = scratchHome();
    const inner = tenancyWithOneSystem();
    const recordGone: JumpcloudFetch = async (input) => {
      if (input.url.startsWith("https://console.jumpcloud.com/api/systems/sys-1")) {
        return { headers: {}, status: 404, text: "" };
      }
      return inner(input);
    };
    unwrap(await syncJumpcloudAtlas({ deps: deps({ fetch: recordGone }), home }));
    const systems = unwrap(readJumpcloudAtlas({ paths: jumpcloudAtlasPaths({ home }) })).manifest!.kinds.systems;
    expect(systems.entityCount).toBeGreaterThan(0);
    expect(systems.productAbsent).toBe(undefined);
  });

  it("says the two event families are shape-indexed rather than leaving them silently missing", async () => {
    const home = scratchHome();
    const report = unwrap(await syncJumpcloudAtlas({ deps: deps({ fetch: tenancyWithOneSystem() }), home }));
    const events = report.kinds.find((kind) => kind.kind === "events")!;
    expect(events.state).toBe("deferred");
    expect(events.reason).toContain("indexed by shape");
  });

  it("removes the resume journal once the generation it was building is published", async () => {
    const home = scratchHome();
    await syncJumpcloudAtlas({ deps: deps({ fetch: tenancyWithOneSystem() }), home });
    expect(readJumpcloudResume({ directory: jumpcloudAtlasPaths({ home }).directory }).length).toBe(0);
  });

  it("keeps the journal when it refuses, so the next run does not redo every call", async () => {
    const home = scratchHome();
    await syncJumpcloudAtlas({ deps: deps({ fetch: tenancyWithOneSystem({ failOn: "/api/systems" }) }), home });
    expect(readJumpcloudResume({ directory: jumpcloudAtlasPaths({ home }).directory }).length).toBeGreaterThan(0);
  });

  it("resumes the calls a previous run already made rather than repeating them", async () => {
    const home = scratchHome();
    await syncJumpcloudAtlas({ deps: deps({ fetch: tenancyWithOneSystem({ failOn: "/api/v2/policies" }) }), home });
    const second = unwrap(await syncJumpcloudAtlas({ deps: deps({ fetch: tenancyWithOneSystem() }), home }));
    expect(second.kinds.find((kind) => kind.kind === "systems")!.resumed).toBeGreaterThan(0);
  });
  it("publishes nothing when an answer departs from the keys its surface was measured with", async () => {
    // The production admitter, over a tenancy whose one system carries three of the measured keys and none of the rest.
    const home = scratchHome();
    const report = unwrap(
      await syncJumpcloudAtlas({ deps: deps({ admit: admitJumpcloudPage, fetch: tenancyWithOneSystem() }), home }),
    );
    expect(report.published).toBe(false);
    const systems = report.refusals.filter((line) => line.startsWith("systems/v1-systems-list:"));
    expect(systems).toEqual([
      'systems/v1-systems-list: v1-systems-list answered a shape this version does not read, so nothing it answered is held: field "results[0].acknowledged" is missing; field "results[0].active" is missing; field "results[0].agentHasFullDiskAccess" is missing (+32 more)',
    ]);
    expect(readJumpcloudResume({ directory: jumpcloudAtlasPaths({ home }).directory }).length).toBeGreaterThan(0);
  });

  it("refuses the whole generation when a record carries the administrator key this sync is using", async () => {
    const home = scratchHome();
    const report = unwrap(await syncJumpcloudAtlas({ deps: deps({ fetch: tenancyLeakingTheAdminKey() }), home }));
    expect(report.published).toBe(false);
    expect(report.refusals[0]).toBe(
      "systems/v1-systems-list: v1-systems-list carried material the pre-publish gate refuses",
    );
    // The refusal names the position and the shape, never the value — so a refusal is safe to print.
    expect(report.refusals.join(" ").includes(TEST_API_KEY)).toBe(false);
  });
});

/**
 * A tenancy whose one RADIUS server carries its shared secret.
 *
 * This was a `systeminsights/services` record with a credential on its command line until that whole family
 * was shape-indexed and taken out of the walk. The property under test is unchanged
 * and has nothing to do with which family carries it: a field dropped at the projection has to survive into
 * the coverage reason. `sharedSecret` on `/api/radiusservers` is a named member of
 * `JUMPCLOUD_SECRET_MATERIAL_FIELDS` on a still-walked family, which is what makes it the replacement.
 */
function tenancyWithASecretBearingRadiusServer(): JumpcloudFetch {
  const inner = tenancyWithOneSystem();
  return async (input) => {
    if (input.url === "https://console.jumpcloud.com/api/radiusservers") {
      return {
        headers: {},
        status: 200,
        text: JSON.stringify({
          results: [
            { _id: "radius-1", name: "Office RADIUS", networkSourceIp: "203.0.113.7", sharedSecret: "hunter2-shared" },
          ],
          totalCount: 1,
        }),
      };
    }
    return inner(input);
  };
}

describe("a withholding survives the journal", () => {
  it("publishes the RADIUS server without its shared secret, and SAYS it withheld one", async () => {
    const home = scratchHome();
    const report = unwrap(
      await syncJumpcloudAtlas({ deps: deps({ fetch: tenancyWithASecretBearingRadiusServer() }), home }),
    );
    const radius = report.kinds.find((kind) => kind.kind === "radiusservers")!;
    // The records are projected BEFORE they are journalled, so re-projecting them finds nothing to remove.
    // Without the journalled drops this reads "nothing was withheld at the boundary" while a live shared
    // secret was in fact dropped, which is the exact failure this assertion exists to catch.
    expect(radius.reason.includes("nothing was withheld at the boundary")).toBe(false);
    expect(radius.reason.includes("withheld 1 secret-material position(s) at the boundary")).toBe(true);
    expect(radius.reason.includes("across the field(s) sharedSecret")).toBe(true);
  });
});
