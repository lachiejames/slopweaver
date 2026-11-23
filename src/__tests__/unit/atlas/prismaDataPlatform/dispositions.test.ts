/**
 * The disposition and kind decisions, tested against the tables that make them rather than against the
 * generated rows — so a table edited without regenerating fails here rather than shipping a registry whose
 * reasons no longer match its own source.
 */
import { describe, expect, it } from "vitest";

import {
  PRISMA_NOT_ENUMERABLE_OPERATIONS,
  PRISMA_PROBE_ONLY_OPERATIONS,
  PRISMA_VOLUMINOUS_OPERATIONS,
  prismaDispositionOf,
} from "../../../../atlas/prismaDataPlatform/dispositions.js";
import {
  PRISMA_DATA_PLATFORM_ATLAS_KINDS,
  prismaDataPlatformKindFor,
  prismaDataPlatformKindPrefixes,
} from "../../../../atlas/prismaDataPlatform/kinds.js";
import { prismaWithheldFieldFor } from "../../../../atlas/prismaDataPlatform/sensitiveFields.js";

describe("prismaDispositionOf", () => {
  it("refuses every non-GET as mutating, whatever the path", () => {
    expect(prismaDispositionOf({ method: "POST", path: "/v1/databases" }).exclusionReason).toBe("mutating");
    expect(prismaDispositionOf({ method: "DELETE", path: "/v1/buckets/{bucketId}" }).exclusionReason).toBe("mutating");
    expect(prismaDispositionOf({ method: "PATCH", path: "/v1/projects/{id}" }).exclusionReason).toBe("mutating");
    expect(prismaDispositionOf({ method: "PUT", path: "/v1/builds/{buildId}/resources/{a}/{b}" }).exclusionReason).toBe(
      "mutating",
    );
  });

  it("shape-indexes the two log streams and gives each a reason a coverage cell can print", () => {
    const build = prismaDispositionOf({ method: "GET", path: "/v1/builds/{buildId}/logs" });

    expect(build.disposition).toBe("shape-index");
    expect(build.dispositionBecause).toContain("newline-delimited JSON");
    expect(PRISMA_VOLUMINOUS_OPERATIONS.length).toBe(2);
  });

  it("stores nothing at all for the caller-identity probe", () => {
    const me = prismaDispositionOf({ method: "GET", path: "/v1/me" });

    expect(me.disposition).toBe("probe-only");
    expect(me.dispositionBecause).toContain("email");
    expect(PRISMA_PROBE_ONLY_OPERATIONS.length).toBe(1);
  });

  it("refuses the two IaC-state reads as not-enumerable and gives each its own reason", () => {
    const reasons = PRISMA_NOT_ENUMERABLE_OPERATIONS.map((row) => row.reason);

    expect(PRISMA_NOT_ENUMERABLE_OPERATIONS.length).toBe(2);
    expect(new Set(reasons).size).toBe(2);
    expect(
      prismaDispositionOf({
        method: "GET",
        path: "/v1/projects/{projectId}/branches/{branchId}/alchemy-state/state/stacks/{stack}/stages/{stage}/output",
      }).exclusionReason,
    ).toBe("not-enumerable");
  });

  it("leaves an ordinary read a plain entity with no reason at all", () => {
    const listed = prismaDispositionOf({ method: "GET", path: "/v1/databases" });

    expect(listed.disposition).toBe("entity");
    expect(listed.dispositionBecause).toBe(null);
    expect(listed.exclusionReason).toBe(null);
  });
});

describe("prismaDataPlatformKindFor", () => {
  it("takes the longest matching prefix, so a container's children are not filed under the container", () => {
    expect(prismaDataPlatformKindFor({ method: "GET", path: "/v1/databases" })?.kind).toBe("database");
    expect(prismaDataPlatformKindFor({ method: "GET", path: "/v1/databases/{databaseId}/backups" })?.kind).toBe(
      "database-backup",
    );
    expect(prismaDataPlatformKindFor({ method: "GET", path: "/v1/databases/{databaseId}/usage" })?.kind).toBe(
      "database-usage",
    );
    expect(prismaDataPlatformKindFor({ method: "GET", path: "/v1/databases/{databaseId}/connections" })?.kind).toBe(
      "connection",
    );
  });

  // The deprecated `apps` family and the `services` family are one noun being renamed in place, so both
  // feed one kind and the atlas answers "what services exist" once rather than twice.
  it("files apps and services under the same kind", () => {
    expect(prismaDataPlatformKindFor({ method: "GET", path: "/v1/apps" })?.kind).toBe("service");
    expect(prismaDataPlatformKindFor({ method: "GET", path: "/v1/services" })?.kind).toBe("service");
  });

  it("overrides the prefix for the two log streams, because what is stored is the shape rather than the build", () => {
    expect(prismaDataPlatformKindFor({ method: "GET", path: "/v1/builds/{buildId}/logs" })?.kind).toBe("event-shape");
    expect(prismaDataPlatformKindFor({ method: "GET", path: "/v1/builds/{buildId}" })?.kind).toBe("build");
  });

  it("fans a database listing out to the connections its response nests", () => {
    expect(prismaDataPlatformKindFor({ method: "GET", path: "/v1/databases" })?.alsoFeeds).toEqual(["connection"]);
    expect(prismaDataPlatformKindFor({ method: "GET", path: "/v1/connections" })?.alsoFeeds).toEqual([]);
  });

  it("returns null for a path no prefix covers, so the generator refuses rather than guessing", () => {
    expect(prismaDataPlatformKindFor({ method: "GET", path: "/v1/something-prisma-has-not-shipped" })).toBe(null);
  });

  it("only ever names a kind the kind constant declares", () => {
    const named = prismaDataPlatformKindPrefixes().map(
      (prefix) => prismaDataPlatformKindFor({ method: "GET", path: prefix })?.kind,
    );

    expect(named.filter((kind) => kind === undefined)).toEqual([]);
    expect(named.filter((kind) => kind !== undefined && !PRISMA_DATA_PLATFORM_ATLAS_KINDS.includes(kind))).toEqual([]);
  });
});

describe("prismaWithheldFieldFor", () => {
  it("withholds the direct-connection password and the integration contact's email", () => {
    expect(prismaWithheldFieldFor({ path: "data[].directConnection.pass" })?.operations.length).toBe(6);
    expect(prismaWithheldFieldFor({ path: "data[].email" })?.because).toContain("personal data");
  });

  // `url` is the public self-link of 101 response properties on this platform and `key` is an environment
  // variable's own name — a rule matching credential-shaped NAMES would withhold the most useful fields.
  it("withholds neither url nor key, which are public identifiers here", () => {
    expect(prismaWithheldFieldFor({ path: "data[].url" })).toBe(null);
    expect(prismaWithheldFieldFor({ path: "data[].key" })).toBe(null);
  });
});
