/**
 * The content half of the sync with a working key, end to end against a fake transport and a throwaway home: it
 * publishes the four content families through the filtered membership walk, closes the no-key gap, and grades a
 * family whose record misses a required field failed without staling what an earlier run stored.
 */
import { describe, expect, it } from "vitest";

import type { WorkosFetch } from "../../../../../atlas/workos/client.js";
import { readWorkosKindFile, workosAtlasPaths } from "../../../../../atlas/workos/store.js";
import { syncWorkosApiSurface } from "../../../../../atlas/workos/sync.js";
import { ok, unwrap } from "../../../../../lib/result.js";

import { AT } from "../workosFixtures.js";

import { contentFetch, noKey, pageText, probeOnlyFetch, tempHome, useTempHomes } from "./harness.js";

useTempHomes();

describe("syncWorkosApiSurface with a key", () => {
  it("publishes the four content families and grades the half synced", async () => {
    const home = tempHome();
    const paths = workosAtlasPaths({ home });
    const synced = await syncWorkosApiSurface({ apiKey: ok("sk_test"), at: AT, env: {}, fetch: contentFetch(), paths });
    expect(unwrap(synced).content).toBe("synced");
    expect(unwrap(synced).organizationCount).toBe(1);
    expect(unwrap(synced).userCount).toBe(1);
    expect(unwrap(synced).connectionCount).toBe(1);
    expect(unwrap(synced).directoryCount).toBe(1);
  });

  // The whole point of walking memberships per organisation: the unfiltered listing the sync used to make
  // answers 400, so a user reaching its organisation ids is proof the filtered walk really ran.
  it("reaches a user's organisation ids through the FILTERED membership walk", async () => {
    const home = tempHome();
    const paths = workosAtlasPaths({ home });
    await syncWorkosApiSurface({ apiKey: ok("sk_test"), at: AT, env: {}, fetch: contentFetch(), paths });
    const users = unwrap(readWorkosKindFile({ kind: "user", paths }))!;
    const detail = users.entities.find((entity) => entity.providerId === "user_1")!.channels.api!.detail;
    expect((detail as { organizationIds: readonly string[] }).organizationIds).toEqual(["org_1"]);
  });

  it("closes the content-not-configured gap once the content half runs", async () => {
    const home = tempHome();
    const paths = workosAtlasPaths({ home });
    await syncWorkosApiSurface({
      apiKey: noKey(),
      at: AT,
      env: {},
      fetch: probeOnlyFetch({ absentPath: "/webhooks" }),
      paths,
    });
    await syncWorkosApiSurface({ apiKey: ok("sk_test"), at: AT, env: {}, fetch: contentFetch(), paths });
    const organizations = unwrap(readWorkosKindFile({ kind: "organization", paths }))!;
    expect(organizations.gaps.filter((gap) => gap.condition === "content-not-configured")).toEqual([]);
  });
});

/** The content transport, except that `/directories` answers one directory carrying no `state`. */
const stateless: WorkosFetch = (request) => {
  const authorised = request.headers["authorization"] !== undefined;
  if (authorised && new URL(request.url).pathname === "/directories") {
    return Promise.resolve({ status: 200, text: pageText({ data: [{ id: "directory_1", type: "scim" }] }) });
  }
  return contentFetch()(request);
};

describe("a record missing a field WorkOS declares required", () => {
  it("grades its own family failed with the boundary's refusal, and leaves the others synced", async () => {
    const paths = workosAtlasPaths({ home: tempHome() });
    const synced = unwrap(
      await syncWorkosApiSurface({ apiKey: ok("sk_test"), at: AT, env: {}, fetch: stateless, paths }),
    );
    expect(synced.families.directory).toStrictEqual({
      outcome: "failed",
      reason:
        "GET /directories answered a shape this version does not read — refused, not guessed: " +
        'field "data[0].state" is missing',
    });
    expect(synced.families.connection.outcome).toBe("synced");
  });

  it("leaves the directory an earlier run stored exactly as it stood, rather than staling it", async () => {
    const paths = workosAtlasPaths({ home: tempHome() });
    await syncWorkosApiSurface({ apiKey: ok("sk_test"), at: AT, env: {}, fetch: contentFetch(), paths });
    await syncWorkosApiSurface({
      apiKey: ok("sk_test"),
      at: "2026-09-18T00:00:00.000Z",
      env: {},
      fetch: stateless,
      paths,
    });
    const directories = unwrap(readWorkosKindFile({ kind: "directory", paths }))!;
    expect(directories.entities[0]!.channels.api!.state).toBe("observed");
  });
});
