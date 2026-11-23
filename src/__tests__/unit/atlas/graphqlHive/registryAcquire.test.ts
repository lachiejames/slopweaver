/**
 * The registry half of a sync, driven with a plain fake transport — an injected `HiveFetch` seam, not a mock.
 */
import { describe, expect, it } from "vitest";

import type { HiveFetch } from "../../../../atlas/graphqlHive/client.js";
import { acquireHiveRegistry } from "../../../../atlas/graphqlHive/registryAcquire.js";
import { reduceHiveSchema } from "../../../../atlas/graphqlHive/schemaRead.js";
import { unwrap } from "../../../../lib/result.js";

import { introspection, registryPayload } from "./hiveFixtures.js";

const SCHEMA = unwrap(reduceHiveSchema({ data: introspection() }));

/** A transport answering every request with one fixed body. */
function answering({ body }: { body: unknown }): HiveFetch {
  return () => Promise.resolve({ status: 200, text: JSON.stringify(body) });
}

describe("acquireHiveRegistry", () => {
  it("reads every named organisation and carries no reason when the half synced", async () => {
    const half = await acquireHiveRegistry({
      deps: { fetch: answering({ body: { data: registryPayload({ sdl: "type Query { a: String }" }) } }), token: "t" },
      organizationSlugs: ["acme"],
      schema: SCHEMA,
    });
    expect(half.outcome).toBe("synced");
    expect(half.reason).toBeNull();
    expect(half.registry.targets.map((target) => target.slug)).toStrictEqual(["production"]);
  });

  it("grades the half unsupported, naming the declared root fields, when the schema lacks the root field", async () => {
    const half = await acquireHiveRegistry({
      deps: { fetch: answering({ body: {} }), token: "t" },
      organizationSlugs: ["acme"],
      schema: { operations: [], types: [] },
    });
    expect(half.outcome).toBe("unsupported");
    expect(half.reason).toContain("The 0 root Query field(s) it does declare");
  });

  it("grades the half not-configured, naming the secret to set, when there is no token", async () => {
    const half = await acquireHiveRegistry({
      deps: { fetch: answering({ body: {} }), token: null },
      organizationSlugs: ["acme"],
      schema: SCHEMA,
    });
    expect(half.outcome).toBe("not-configured");
    expect(half.reason).toContain("slopweaver secrets set graphql-hive-token");
  });

  it("grades the half not-configured, naming the flag, when a token exists and no organisation does", async () => {
    const half = await acquireHiveRegistry({
      deps: { fetch: answering({ body: {} }), token: "t" },
      organizationSlugs: [],
      schema: SCHEMA,
    });
    expect(half.outcome).toBe("not-configured");
    expect(half.reason).toContain("--organization <slug>");
  });

  it("grades the half failed when the organisation answers null, because this token cannot see it", async () => {
    const half = await acquireHiveRegistry({
      deps: { fetch: answering({ body: { data: { organization: null } } }), token: "t" },
      organizationSlugs: ["acme"],
      schema: SCHEMA,
    });
    expect(half.outcome).toBe("failed");
    expect(half.reason).toBe("organization answered null for the organisation named — this token cannot see it");
  });

  it("grades the half failed, publishing nothing, when the content query answers GraphQL errors", async () => {
    const half = await acquireHiveRegistry({
      deps: { fetch: answering({ body: { errors: [{ message: "boom" }] } }), token: "t" },
      organizationSlugs: ["acme"],
      schema: SCHEMA,
    });
    expect(half.outcome).toBe("failed");
    expect(half.registry).toStrictEqual({ organizations: [], projects: [], targets: [] });
  });
});
