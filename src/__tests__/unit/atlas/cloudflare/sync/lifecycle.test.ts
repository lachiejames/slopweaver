import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createCloudflareClient } from "../../../../../atlas/cloudflare/client.js";
import { CloudflareClientErrors } from "../../../../../atlas/cloudflare/errors.js";
import {
  cloudflareAtlasPaths,
  readCloudflareAtlas,
  readCloudflareKindFile,
  readCloudflareManifest,
} from "../../../../../atlas/cloudflare/store.js";
import { syncCloudflareAtlas } from "../../../../../atlas/cloudflare/sync.js";
import { unwrap } from "../../../../../lib/result.js";
import { AT, FLAT_KINDS, LATER, noopProgress, outcomeFor, SELECTION } from "./fixtures.js";
import { allKindsFetch, freshHome, removeFixtureHomes } from "./harness.js";
import { jsonResponse, requestUrl } from "./httpResponses.js";
import { EMPTY_ZERO_TRUST } from "./zeroTrustFixtures.js";

describe("syncCloudflareAtlas", () => {
  let home: string;
  beforeEach(() => {
    home = freshHome();
  });
  afterEach(removeFixtureHomes);

  it("publishes the zone kind and stamps the selection on a fresh atlas", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: allKindsFetch({ zones: [{ id: "z1", name: "one.test" }] }),
      maxRetries: 0,
    });
    const result = await syncCloudflareAtlas({ at: AT, client, home, progress: noopProgress, selection: SELECTION });
    const report = unwrap(result);
    expect(outcomeFor({ kind: "zone", kinds: report.kinds })).toEqual({
      complete: true,
      entityCount: 1,
      kind: "zone",
      reasons: [],
    });
    expect(report.lockReleaseError).toBeNull();

    const paths = cloudflareAtlasPaths({ home });
    const manifest = unwrap(readCloudflareManifest({ paths }));
    expect(manifest?.selection).toEqual(SELECTION);
    expect(manifest?.kinds.zone.lastSuccessAt).toBe(AT);
    expect(manifest?.kinds.zone.lastAttempt).toEqual({ at: AT, outcome: "ok", reasons: [] });
    const zoneFile = unwrap(readCloudflareKindFile({ kind: "zone", paths }));
    expect(zoneFile?.entities).toHaveLength(1);

    // The manifest must actually learn the run succeeded — readCloudflareAtlas's own "unpublished" grade
    // fires whenever a kind file's digest exists but the manifest's lastSuccessAt was never advanced.
    const atlas = unwrap(readCloudflareAtlas({ paths }));
    expect(atlas.unpublished).not.toContain("zone");
  });

  it("stales a zone that disappears between two runs", async () => {
    const clientWithZone = createCloudflareClient({
      apiToken: "t",
      fetchImpl: allKindsFetch({ zones: [{ id: "z1", name: "one.test" }] }),
      maxRetries: 0,
    });
    await syncCloudflareAtlas({ at: AT, client: clientWithZone, home, progress: noopProgress, selection: SELECTION });

    const clientWithoutZone = createCloudflareClient({ apiToken: "t", fetchImpl: allKindsFetch({}), maxRetries: 0 });
    await syncCloudflareAtlas({
      at: LATER,
      client: clientWithoutZone,
      home,
      progress: noopProgress,
      selection: SELECTION,
    });

    const paths = cloudflareAtlasPaths({ home });
    const zoneFile = unwrap(readCloudflareKindFile({ kind: "zone", paths }));
    expect(zoneFile?.entities[0]?.state).toBe("stale");
  });

  it("re-syncing the same zones is idempotent — no duplicate entities", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: allKindsFetch({ zones: [{ id: "z1", name: "one.test" }] }),
      maxRetries: 0,
    });
    await syncCloudflareAtlas({ at: AT, client, home, progress: noopProgress, selection: SELECTION });
    await syncCloudflareAtlas({ at: LATER, client, home, progress: noopProgress, selection: SELECTION });

    const paths = cloudflareAtlasPaths({ home });
    const zoneFile = unwrap(readCloudflareKindFile({ kind: "zone", paths }));
    expect(zoneFile?.entities).toHaveLength(1);
    expect(zoneFile?.entities[0]?.firstSeenAt).toBe(AT);
    expect(zoneFile?.entities[0]?.lastSeenAt).toBe(LATER);
  });

  it("a failed read leaves prior entities untouched and reports an incomplete outcome for that kind only", async () => {
    const clientOk = createCloudflareClient({
      apiToken: "t",
      fetchImpl: allKindsFetch({ zones: [{ id: "z1", name: "one.test" }] }),
      maxRetries: 0,
    });
    await syncCloudflareAtlas({ at: AT, client: clientOk, home, progress: noopProgress, selection: SELECTION });

    const clientZoneFailing = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async (input) => {
        const url = requestUrl({ input });
        if (url.pathname.endsWith("/zones")) {
          return jsonResponse({ body: { errors: [{ message: "denied" }], success: false }, status: 403 });
        }
        return allKindsFetch({})(input);
      },
      maxRetries: 0,
    });
    const result = await syncCloudflareAtlas({
      at: LATER,
      client: clientZoneFailing,
      home,
      progress: noopProgress,
      selection: SELECTION,
    });
    const report = unwrap(result);
    const zoneOutcome = outcomeFor({ kind: "zone", kinds: report.kinds });
    expect(zoneOutcome?.complete).toBe(false);
    expect(zoneOutcome?.entityCount).toBe(1);
    // Only the zone kind failed — every other flat kind still synced complete this run.
    for (const kind of FLAT_KINDS.filter((k) => k !== "zone")) {
      expect(outcomeFor({ kind, kinds: report.kinds })?.complete).toBe(true);
    }

    const paths = cloudflareAtlasPaths({ home });
    const zoneFile = unwrap(readCloudflareKindFile({ kind: "zone", paths }));
    expect(zoneFile?.entities).toHaveLength(1);
    expect(zoneFile?.entities[0]?.state).toBe("observed");
    expect(zoneFile?.gaps.some((gap) => gap.status === "open")).toBe(true);

    const manifest = unwrap(readCloudflareManifest({ paths }));
    expect(manifest?.kinds.zone.lastSuccessAt).toBe(AT);
    expect(manifest?.kinds.zone.lastAttempt?.outcome).toBe("failed");
  });

  it("a kind whose very first-ever sync attempt fails is not misreported as unpublished", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async () => jsonResponse({ body: { errors: [{ message: "denied" }], success: false }, status: 403 }),
      maxRetries: 0,
    });
    const result = await syncCloudflareAtlas({ at: AT, client, home, progress: noopProgress, selection: SELECTION });
    const report = unwrap(result);
    expect(report.kinds[0]?.complete).toBe(false);

    const paths = cloudflareAtlasPaths({ home });
    const manifest = unwrap(readCloudflareManifest({ paths }));
    expect(manifest?.kinds.zone.lastSuccessAt).toBeNull();
    expect(manifest?.kinds.zone.lastAttempt?.outcome).toBe("failed");

    const atlas = unwrap(readCloudflareAtlas({ paths }));
    expect(atlas.unpublished).not.toContain("zone");
  });

  it("a later successful run closes the gap a prior failure opened", async () => {
    const clientZoneFailing = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async (input) => {
        const url = requestUrl({ input });
        if (url.pathname.endsWith("/zones")) {
          return jsonResponse({ body: { errors: [{ message: "denied" }], success: false }, status: 403 });
        }
        return allKindsFetch({})(input);
      },
      maxRetries: 0,
    });
    await syncCloudflareAtlas({
      at: AT,
      client: clientZoneFailing,
      home,
      progress: noopProgress,
      selection: SELECTION,
    });

    const clientOk = createCloudflareClient({
      apiToken: "t",
      fetchImpl: allKindsFetch({ zones: [{ id: "z1", name: "one.test" }] }),
      maxRetries: 0,
    });
    await syncCloudflareAtlas({ at: LATER, client: clientOk, home, progress: noopProgress, selection: SELECTION });

    const paths = cloudflareAtlasPaths({ home });
    const zoneFile = unwrap(readCloudflareKindFile({ kind: "zone", paths }));
    expect(zoneFile?.gaps.every((gap) => gap.status === "closed")).toBe(true);
  });

  // The access log's key is a composite of fields the provider returns, so a line missing one is refused at
  // the reader; this proves the refusal reaches the published coverage as schema drift, rather than stopping
  // at the reader's return value or being keyed on a placeholder.
  it("an Access authentication event without its ray id leaves the log kind incomplete with a schema-drift gap", async () => {
    const clientOk = createCloudflareClient({ apiToken: "t", fetchImpl: allKindsFetch({}), maxRetries: 0 });
    await syncCloudflareAtlas({ at: AT, client: clientOk, home, progress: noopProgress, selection: SELECTION });

    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: allKindsFetch({
        zeroTrust: { ...EMPTY_ZERO_TRUST, accessAuthenticationEvents: [{ created_at: "2026-01-01T00:00:00Z" }] },
      }),
      maxRetries: 0,
    });
    const report = unwrap(
      await syncCloudflareAtlas({ at: LATER, client, home, progress: noopProgress, selection: SELECTION }),
    );
    const refusal = CloudflareClientErrors.schema({
      cause:
        "an Access authentication event had no ray_id in the response, and ray_id is part of the key that identifies it",
      operation: "access-authentication-events-list",
    });
    const outcome = outcomeFor({ kind: "access-authentication-log", kinds: report.kinds })!;
    expect(outcome.complete).toBe(false);
    expect(outcome.entityCount).toBe(0);
    expect(outcome.reasons).toEqual([refusal.message]);

    const paths = cloudflareAtlasPaths({ home });
    const logFile = unwrap(readCloudflareKindFile({ kind: "access-authentication-log", paths }))!;
    expect(logFile.entities).toEqual([]);
    expect(logFile.gaps.map((gap) => [gap.condition, gap.status, gap.reason])).toEqual([
      ["schema-drift", "open", refusal.message],
    ]);
  });
});
