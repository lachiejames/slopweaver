/**
 * The publish guard: the two incoherences a schema cannot see, and the duplicate-id refusal.
 *
 * The duplicate refusal is here because of a defect measured on a SIBLING atlas rather than one imagined
 * for this one — a Cloudflare fan-out published more entities than it had distinct ids, every gate
 * passed, and the census silently double-counted. This atlas fans out over repositories, which is the same
 * shape, so the refusal is asserted rather than assumed.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assembleGithubKindFile,
  emptyGithubKindFile,
  type GithubKindFile,
  type GithubManifest,
  initialGithubManifest,
} from "../../../../atlas/github/kindFiles.js";
import { githubAtlasPaths, publishGithubAtlas, readGithubAtlas } from "../../../../atlas/github/store.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const AT = "2026-09-05T00:00:00.000Z";
const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** A throwaway state home; every test passes it explicitly rather than touching the ambient one. */
function scratchHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-github-store-"));
  homes.push(home);
  return home;
}

/** One stored webhook, with an id a caller controls so a collision can be constructed. */
function webhook({ id }: { id: string }): GithubKindFile["entities"][number] {
  return {
    active: true,
    contentType: "json",
    destinationOrigin: "https://hooks.example.test",
    destinationPathDigest: "0".repeat(64),
    events: ["push"],
    firstSeenAt: AT,
    id,
    insecureSsl: false,
    providerId: id,
    scopeLevel: "organization",
    scopeRef: "example-org",
    source: {
      artifacts: [],
      deepLink: null,
      deepLinkStatus: "unavailable",
      endpoint: "/orgs/example-org/hooks",
      observedAt: AT,
      surface: "rest-live",
    },
    state: "observed",
    updatedAt: null,
  };
}

/** A manifest grading one kind with the count and digest a caller wants. */
function manifestWith({ entityCount, digest }: { entityCount: number; digest: string | null }): GithubManifest {
  const base = initialGithubManifest({ updatedAt: AT });
  return {
    ...base,
    kinds: { ...base.kinds, webhook: { digest, entityCount, lastAttempt: null, lastSuccessAt: AT } },
  };
}

describe("publishGithubAtlas", () => {
  it("writes a generation a later read can open", () => {
    const paths = githubAtlasPaths({ home: scratchHome() });
    const file = unwrap(
      assembleGithubKindFile({ at: AT, coverage: [], entities: [webhook({ id: "a" })], gaps: [], kind: "webhook" }),
    );
    const written = publishGithubAtlas({
      files: { webhook: file },
      manifest: initialGithubManifest({ updatedAt: AT }),
      paths,
      derivedFrom: null,
    });
    expect(written.isOk()).toBe(true);
    const read = unwrap(readGithubAtlas({ paths }));
    expect(read.files["webhook"]?.entities).toHaveLength(1);
  });

  it("REFUSES a file carrying the same entity id twice, because one thing counted twice is a census lie", () => {
    const paths = githubAtlasPaths({ home: scratchHome() });
    const file = unwrap(
      assembleGithubKindFile({
        at: AT,
        coverage: [],
        entities: [webhook({ id: "a" }), webhook({ id: "a" })],
        gaps: [],
        kind: "webhook",
      }),
    );
    const written = publishGithubAtlas({
      files: { webhook: file },
      manifest: initialGithubManifest({ updatedAt: AT }),
      paths,
      derivedFrom: null,
    });
    expect(written.isErr()).toBe(true);
    expect(written._unsafeUnwrapErr()[0]).toContain("same entity id more than once");
  });

  it("refuses a manifest claiming entities for a file this generation never wrote", () => {
    const paths = githubAtlasPaths({ home: scratchHome() });
    const written = publishGithubAtlas({
      files: {},
      manifest: manifestWith({ digest: null, entityCount: 12 }),
      paths,
      derivedFrom: null,
    });
    expect(written.isErr()).toBe(true);
    expect(written._unsafeUnwrapErr()[0]).toContain("carries no file digest");
  });

  it("refuses a kind graded successful with no success time, which can never be graded for freshness", () => {
    const paths = githubAtlasPaths({ home: scratchHome() });
    const base = initialGithubManifest({ updatedAt: AT });
    const written = publishGithubAtlas({
      files: {},
      manifest: {
        ...base,
        kinds: {
          ...base.kinds,
          webhook: {
            digest: null,
            entityCount: 0,
            lastAttempt: { at: AT, outcome: "ok", reasons: [] },
            lastSuccessAt: null,
          },
        },
      },
      paths,
      derivedFrom: null,
    });
    expect(written.isErr()).toBe(true);
    expect(written._unsafeUnwrapErr()[0]).toContain("no success time");
  });

  it("writes nothing at all when a GUARD refuses", () => {
    const home = scratchHome();
    const paths = githubAtlasPaths({ home });
    publishGithubAtlas({
      files: {},
      manifest: manifestWith({ digest: null, entityCount: 3 }),
      derivedFrom: null,
      paths,
    });
    const read = unwrap(readGithubAtlas({ paths }));
    expect(read.manifest).toBe(null);
  });

  it("writes no kind file when the DUPLICATE-ID guard refuses, because it runs before the publish", () => {
    const home = scratchHome();
    const paths = githubAtlasPaths({ home });
    const file = unwrap(
      assembleGithubKindFile({
        at: AT,
        coverage: [],
        entities: [webhook({ id: "a" }), webhook({ id: "a" })],
        gaps: [],
        kind: "webhook",
      }),
    );
    publishGithubAtlas({
      files: { webhook: file },
      manifest: initialGithubManifest({ updatedAt: AT }),
      paths,
      derivedFrom: null,
    });
    const read = unwrap(readGithubAtlas({ paths }));
    expect(read.files["webhook"]).toBe(null);
    expect(read.manifest).toBe(null);
  });

  it("prints a duplicate id with the one trailer the pre-publish guard adds", () => {
    const paths = githubAtlasPaths({ home: scratchHome() });
    const file = unwrap(
      assembleGithubKindFile({
        at: AT,
        coverage: [],
        entities: [webhook({ id: "a" }), webhook({ id: "a" })],
        gaps: [],
        kind: "webhook",
      }),
    );
    const manifest = initialGithubManifest({ updatedAt: AT });
    expect(unwrapErr(publishGithubAtlas({ derivedFrom: null, files: { webhook: file }, manifest, paths }))).toEqual([
      "webhook carries the same entity id more than once: a — one thing counted twice is how a census lies",
      "nothing was written — this generation is not published",
    ]);
  });

  // The kit's own coherence check refuses this shape before the platform guard runs, so one trailer prints.
  it("prints a digestless count followed by one trailer", () => {
    const paths = githubAtlasPaths({ home: scratchHome() });
    const manifest = manifestWith({ digest: null, entityCount: 12 });
    expect(unwrapErr(publishGithubAtlas({ derivedFrom: null, files: {}, manifest, paths }))).toEqual([
      "webhook is graded with 12 entities but carries no file digest — the count describes a file this generation never wrote",
      "nothing was written — this generation is not published",
    ]);
  });

  it("prints a success with no success time followed by both trailers", () => {
    const paths = githubAtlasPaths({ home: scratchHome() });
    const base = initialGithubManifest({ updatedAt: AT });
    const webhookStatus = { digest: null, entityCount: 0, lastSuccessAt: null };
    const manifest: GithubManifest = {
      ...base,
      kinds: { ...base.kinds, webhook: { ...webhookStatus, lastAttempt: { at: AT, outcome: "ok", reasons: [] } } },
    };
    expect(unwrapErr(publishGithubAtlas({ derivedFrom: null, files: {}, manifest, paths }))).toEqual([
      "webhook records a successful attempt but no success time, so its freshness can never be graded",
      "nothing was written — this generation is not published",
      "nothing was written — this generation is not published",
    ]);
  });
});

describe("assembleGithubKindFile", () => {
  it("refuses an entity routed into the wrong kind's file", () => {
    const assembled = assembleGithubKindFile({
      at: AT,
      coverage: [],
      entities: [webhook({ id: "a" })],
      gaps: [],
      kind: "ruleset",
    });
    expect(unwrapErr(assembled)).toEqual([
      "the ruleset file this run assembled is not storable — entities.0.bypassActorIds: Invalid input: expected array, received undefined",
      "the ruleset file this run assembled is not storable — entities.0.conditionKeys: Invalid input: expected array, received undefined",
      "the ruleset file this run assembled is not storable — entities.0.enforcement: Invalid input: expected string, received undefined",
      "the ruleset file this run assembled is not storable — entities.0.name: Invalid input: expected string, received undefined",
      "the ruleset file this run assembled is not storable — entities.0.ruleTypes: Invalid input: expected array, received undefined",
      "the ruleset file this run assembled is not storable — entities.0.target: Invalid input: expected string, received undefined",
    ]);
  });

  it("accepts an empty file for a kind this run had nothing for", () => {
    expect(emptyGithubKindFile({ kind: "webhook", updatedAt: AT }).entities).toEqual([]);
  });
});
