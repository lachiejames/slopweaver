/**
 * The whole API-surface sync, driven end to end over a temp home with a plain fake transport.
 *
 * Not a mock: `HiveFetch` is an injected seam and the fake is an ordinary function, so what is under test is
 * the real client, the real reducers, the real merge and the real store. The temp home is the genuine
 * fixture the testing rules allow — a `mkdtempSync` directory, written to and read back, removed after.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { HiveFetch } from "../../../../atlas/graphqlHive/client.js";
import { readGraphqlHiveSnapshot } from "../../../../atlas/graphqlHive/readAdapter.js";
import { hiveAtlasPaths, readHiveKindFile } from "../../../../atlas/graphqlHive/store.js";
import { syncHiveApiSurface } from "../../../../atlas/graphqlHive/sync.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

import { AT, introspection, registryPayload } from "./hiveFixtures.js";

const SDL = "type Query { hello: String }";
const homes: string[] = [];

afterEach(() => {
  while (homes.length > 0) {
    rmSync(homes.pop()!, { force: true, recursive: true });
  }
});

/** A throwaway home this file owns, removed after each test. */
function scratchHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-hive-"));
  homes.push(home);
  return home;
}

/** A transport answering the introspection first and the content query after, from fixtures. */
function fakeFetch({ withRegistry }: { withRegistry: boolean }): HiveFetch {
  return ({ body }) => {
    const asksForSchema = body.includes("__schema");
    if (asksForSchema) {
      return Promise.resolve({ status: 200, text: JSON.stringify({ data: introspection() }) });
    }
    if (!withRegistry) {
      return Promise.resolve({ status: 200, text: JSON.stringify({ errors: [{ message: "unauthorized" }] }) });
    }
    return Promise.resolve({ status: 200, text: JSON.stringify({ data: registryPayload({ sdl: SDL }) }) });
  };
}

describe("syncHiveApiSurface", () => {
  it("publishes the schema surface with no token at all, because introspection needs none", async () => {
    const home = scratchHome();
    const outcome = await syncHiveApiSurface({
      at: AT,
      deps: { fetch: fakeFetch({ withRegistry: false }), token: null },
      organizationSlugs: [],
      paths: hiveAtlasPaths({ home }),
    });
    expect(unwrap(outcome).operationCount).toBe(2);
  });

  it("reports the registry half unconfigured rather than failed when there is no token", async () => {
    const home = scratchHome();
    const outcome = await syncHiveApiSurface({
      at: AT,
      deps: { fetch: fakeFetch({ withRegistry: false }), token: null },
      organizationSlugs: [],
      paths: hiveAtlasPaths({ home }),
    });
    expect(unwrap(outcome).registry).toBe("not-configured");
  });

  it("names the missing organisation when a token exists and no slug does", async () => {
    const home = scratchHome();
    const outcome = await syncHiveApiSurface({
      at: AT,
      deps: { fetch: fakeFetch({ withRegistry: true }), token: "t" },
      organizationSlugs: [],
      paths: hiveAtlasPaths({ home }),
    });
    expect(unwrap(outcome).registryReason).toContain("--organization");
  });

  it("publishes the root console addresses even with no registry access", async () => {
    const home = scratchHome();
    const outcome = await syncHiveApiSurface({
      at: AT,
      deps: { fetch: fakeFetch({ withRegistry: false }), token: null },
      organizationSlugs: [],
      paths: hiveAtlasPaths({ home }),
    });
    expect(unwrap(outcome).pageCount).toBe(2);
  });

  it("reads the registry and expands every console route against its slugs", async () => {
    const home = scratchHome();
    const outcome = await syncHiveApiSurface({
      at: AT,
      deps: { fetch: fakeFetch({ withRegistry: true }), token: "t" },
      organizationSlugs: ["acme"],
      paths: hiveAtlasPaths({ home }),
    });
    expect(unwrap(outcome).pageCount).toBe(19);
  });

  it("stores the composed schema as bytes on disk, addressed by its own digest", async () => {
    const home = scratchHome();
    const outcome = await syncHiveApiSurface({
      at: AT,
      deps: { fetch: fakeFetch({ withRegistry: true }), token: "t" },
      organizationSlugs: ["acme"],
      paths: hiveAtlasPaths({ home }),
    });
    const paths = hiveAtlasPaths({ home });
    const file = unwrap(readHiveKindFile({ kind: "target", paths }))!;
    const artifact = file.entities[0]!.channels.api!.source!.artifacts[0]!;
    expect(readFileSync(join(paths.directory, artifact.relativePath), "utf8")).toBe(SDL);
    expect(unwrap(outcome).schemasStored).toBe(1);
  });

  it("reports the registry half FAILED when the endpoint answers 200 with GraphQL errors", async () => {
    const home = scratchHome();
    const outcome = await syncHiveApiSurface({
      at: AT,
      deps: { fetch: fakeFetch({ withRegistry: false }), token: "t" },
      organizationSlugs: ["acme"],
      paths: hiveAtlasPaths({ home }),
    });
    expect(unwrap(outcome).registry).toBe("failed");
  });

  it("stamps the manifest's own clock from the same instant its kind files carry", async () => {
    const home = scratchHome();
    await syncHiveApiSurface({
      at: AT,
      deps: { fetch: fakeFetch({ withRegistry: true }), token: "t" },
      organizationSlugs: ["acme"],
      paths: hiveAtlasPaths({ home }),
    });
    const snapshot = unwrap(readGraphqlHiveSnapshot({ home }));
    expect(snapshot.generation.updatedAt).toBe(AT);
  });

  it("is readable through the generic read verb's own adapter, so the atlas is not jq-only", async () => {
    const home = scratchHome();
    await syncHiveApiSurface({
      at: AT,
      deps: { fetch: fakeFetch({ withRegistry: true }), token: "t" },
      organizationSlugs: ["acme"],
      paths: hiveAtlasPaths({ home }),
    });
    const snapshot = unwrap(readGraphqlHiveSnapshot({ home }));
    expect(snapshot.kinds.find((kind) => kind.kind === "target")!.publishedCount).toBe(1);
  });

  it("refuses to publish an introspection that declared no root field at all", async () => {
    const home = scratchHome();
    const outcome = await syncHiveApiSurface({
      at: AT,
      deps: {
        fetch: () => Promise.resolve({ status: 200, text: JSON.stringify({ data: { __schema: { types: [] } } }) }),
        token: null,
      },
      organizationSlugs: [],
      paths: hiveAtlasPaths({ home }),
    });
    expect(unwrapErr(outcome)).toEqual([
      "the introspection answered 200 and declared no root fields at all — this build cannot map a schema " +
        "it cannot read, and publishing an empty surface would claim Hive has no API",
    ]);
  });

  it("refuses to publish an introspection whose named type carries no kind, naming the type", async () => {
    const home = scratchHome();
    const schema = { queryType: { name: "Query" }, types: [{ fields: [], name: "Query" }] };
    const outcome = await syncHiveApiSurface({
      at: AT,
      deps: {
        fetch: () => Promise.resolve({ status: 200, text: JSON.stringify({ data: { __schema: schema } }) }),
        token: null,
      },
      organizationSlugs: [],
      paths: hiveAtlasPaths({ home }),
    });
    expect(unwrapErr(outcome)).toEqual([
      "https://api.graphql-hive.com/graphql answered 200 with a body this atlas cannot read: the introspected " +
        "type Query carries no kind, which the introspection contract requires",
    ]);
  });

  it("keeps a registry row from an earlier credentialled run when a later run has no token", async () => {
    const home = scratchHome();
    const paths = hiveAtlasPaths({ home });
    await syncHiveApiSurface({
      at: AT,
      deps: { fetch: fakeFetch({ withRegistry: true }), token: "t" },
      organizationSlugs: ["acme"],
      paths,
    });
    await syncHiveApiSurface({
      at: "2026-09-06T00:00:00.000Z",
      deps: { fetch: fakeFetch({ withRegistry: false }), token: null },
      organizationSlugs: [],
      paths,
    });
    const targets = unwrap(readHiveKindFile({ kind: "target", paths }))!;
    expect(targets.entities[0]!.channels.api!.state).toBe("observed");
  });
});
