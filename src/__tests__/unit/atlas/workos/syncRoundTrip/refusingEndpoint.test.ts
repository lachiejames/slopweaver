/**
 * A content read that fails part-way, end to end against a fake transport and a throwaway home: one refusing
 * endpoint grades and gaps only its own family, keeps an earlier run's success and entities rather than staling
 * them, and a membership walk that cannot run still publishes every user, graded deferred.
 */
import { describe, expect, it } from "vitest";

import { readWorkosKindFile, workosAtlasPaths } from "../../../../../atlas/workos/store.js";
import { syncWorkosApiSurface } from "../../../../../atlas/workos/sync.js";
import { ok, unwrap } from "../../../../../lib/result.js";

import { AT } from "../workosFixtures.js";

import { contentFetch, tempHome, useTempHomes } from "./harness.js";

useTempHomes();

describe("one refusing endpoint", () => {
  // MEASURED: one malformed membership call published zero organisations, zero users, zero
  // connections and zero directories, because the whole content half shared a single outcome.
  it("leaves the other three families published", async () => {
    const home = tempHome();
    const paths = workosAtlasPaths({ home });
    const synced = await syncWorkosApiSurface({
      apiKey: ok("sk_test"),
      at: AT,
      env: {},
      fetch: contentFetch({ refusePath: "/directories" }),
      paths,
    });
    expect(unwrap(synced).organizationCount).toBe(1);
    expect(unwrap(synced).userCount).toBe(1);
    expect(unwrap(synced).connectionCount).toBe(1);
    expect(unwrap(synced).directoryCount).toBe(0);
  });

  it("grades its own family unreadable and leaves the others synced", async () => {
    const home = tempHome();
    const paths = workosAtlasPaths({ home });
    await syncWorkosApiSurface({
      apiKey: ok("sk_test"),
      at: AT,
      env: {},
      fetch: contentFetch({ refusePath: "/directories" }),
      paths,
    });
    const directories = unwrap(readWorkosKindFile({ kind: "directory", paths }))!;
    const connections = unwrap(readWorkosKindFile({ kind: "connection", paths }))!;
    expect(directories.coverage.find((cell) => cell.surface === "api-content")!.state).toBe("unreadable");
    expect(connections.coverage.find((cell) => cell.surface === "api-content")!.state).toBe("synced");
  });

  it("raises the content gap on its own family alone", async () => {
    const home = tempHome();
    const paths = workosAtlasPaths({ home });
    await syncWorkosApiSurface({
      apiKey: ok("sk_test"),
      at: AT,
      env: {},
      fetch: contentFetch({ refusePath: "/directories" }),
      paths,
    });
    const directories = unwrap(readWorkosKindFile({ kind: "directory", paths }))!;
    const organizations = unwrap(readWorkosKindFile({ kind: "organization", paths }))!;
    // `content-not-configured` means "no API key". Raising it for an endpoint that refused with a key that
    // works sends a reader to fix a credential that is fine.
    expect(directories.gaps.map((gap) => gap.condition)).toEqual(["content-unreadable"]);
    expect(organizations.gaps).toEqual([]);
  });

  it("rolls the run up to failed, naming which family refused", async () => {
    const home = tempHome();
    const paths = workosAtlasPaths({ home });
    const synced = await syncWorkosApiSurface({
      apiKey: ok("sk_test"),
      at: AT,
      env: {},
      fetch: contentFetch({ refusePath: "/directories" }),
      paths,
    });
    expect(unwrap(synced).content).toBe("failed");
    expect(unwrap(synced).contentReason).toContain("directory:");
    expect(unwrap(synced).families.connection.outcome).toBe("synced");
  });

  // Three families really looked and one really did not; the cell is the only record that tells a freshness
  // sweep which is which, so a failed read must not stamp today as its last success.
  it("keeps the earlier run's lastSuccessAt rather than stamping a fresh one", async () => {
    const home = tempHome();
    const paths = workosAtlasPaths({ home });
    await syncWorkosApiSurface({ apiKey: ok("sk_test"), at: AT, env: {}, fetch: contentFetch(), paths });
    await syncWorkosApiSurface({
      apiKey: ok("sk_test"),
      at: "2026-09-06T00:00:00.000Z",
      env: {},
      fetch: contentFetch({ refusePath: "/directories" }),
      paths,
    });
    const directories = unwrap(readWorkosKindFile({ kind: "directory", paths }))!;
    const cell = directories.coverage.find((entry) => entry.surface === "api-content")!;
    expect(cell.lastSuccessAt).toBe(AT);
    expect(cell.latestAttemptFailed).toBe(true);
  });

  it("marks the families that DID look as freshly succeeded on that same run", async () => {
    const home = tempHome();
    const paths = workosAtlasPaths({ home });
    await syncWorkosApiSurface({ apiKey: ok("sk_test"), at: AT, env: {}, fetch: contentFetch(), paths });
    await syncWorkosApiSurface({
      apiKey: ok("sk_test"),
      at: "2026-09-06T00:00:00.000Z",
      env: {},
      fetch: contentFetch({ refusePath: "/directories" }),
      paths,
    });
    const connections = unwrap(readWorkosKindFile({ kind: "connection", paths }))!;
    const cell = connections.coverage.find((entry) => entry.surface === "api-content")!;
    expect(cell.lastSuccessAt).toBe("2026-09-06T00:00:00.000Z");
    expect(cell.latestAttemptFailed).toBe(false);
  });

  // Staling a family on the strength of a run that never read it is the failure `mergeFor` exists to avoid.
  it("does not stale what an earlier run stored for it", async () => {
    const home = tempHome();
    const paths = workosAtlasPaths({ home });
    await syncWorkosApiSurface({ apiKey: ok("sk_test"), at: AT, env: {}, fetch: contentFetch(), paths });
    await syncWorkosApiSurface({
      apiKey: ok("sk_test"),
      at: "2026-09-06T00:00:00.000Z",
      env: {},
      fetch: contentFetch({ refusePath: "/directories" }),
      paths,
    });
    const directories = unwrap(readWorkosKindFile({ kind: "directory", paths }))!;
    expect(directories.entities.map((entity) => entity.providerId)).toEqual(["directory_1"]);
    expect(directories.entities[0]!.channels.api!.state).toBe("observed");
  });
});

describe("a membership walk that cannot run", () => {
  it("still publishes every user, graded deferred rather than synced", async () => {
    const home = tempHome();
    const paths = workosAtlasPaths({ home });
    const synced = await syncWorkosApiSurface({
      apiKey: ok("sk_test"),
      at: AT,
      env: {},
      fetch: contentFetch({ refusePath: "/user_management/organization_memberships" }),
      paths,
    });
    expect(unwrap(synced).userCount).toBe(1);
    expect(unwrap(synced).families.user.outcome).toBe("truncated");
    const users = unwrap(readWorkosKindFile({ kind: "user", paths }))!;
    expect(users.coverage.find((cell) => cell.surface === "api-content")!.state).toBe("deferred");
  });

  it("raises content-bounded on the user family, not the no-key condition", async () => {
    const home = tempHome();
    const paths = workosAtlasPaths({ home });
    await syncWorkosApiSurface({
      apiKey: ok("sk_test"),
      at: AT,
      env: {},
      fetch: contentFetch({ refusePath: "/user_management/organization_memberships" }),
      paths,
    });
    const users = unwrap(readWorkosKindFile({ kind: "user", paths }))!;
    expect(users.gaps.map((gap) => gap.condition)).toEqual(["content-bounded"]);
  });

  it("clears a family's earlier content gap once its own read comes back whole", async () => {
    const home = tempHome();
    const paths = workosAtlasPaths({ home });
    await syncWorkosApiSurface({
      apiKey: ok("sk_test"),
      at: AT,
      env: {},
      fetch: contentFetch({ refusePath: "/directories" }),
      paths,
    });
    await syncWorkosApiSurface({
      apiKey: ok("sk_test"),
      at: "2026-09-06T00:00:00.000Z",
      env: {},
      fetch: contentFetch(),
      paths,
    });
    const directories = unwrap(readWorkosKindFile({ kind: "directory", paths }))!;
    expect(directories.gaps).toEqual([]);
  });

  it("leaves the organisation family synced, because its own read was whole", async () => {
    const home = tempHome();
    const paths = workosAtlasPaths({ home });
    const synced = await syncWorkosApiSurface({
      apiKey: ok("sk_test"),
      at: AT,
      env: {},
      fetch: contentFetch({ refusePath: "/user_management/organization_memberships" }),
      paths,
    });
    expect(unwrap(synced).families.organization.outcome).toBe("synced");
  });
});
