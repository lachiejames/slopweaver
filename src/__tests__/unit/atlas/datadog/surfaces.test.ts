import { describe, expect, it } from "vitest";

import {
  DATADOG_EXCLUSIONS,
  DATADOG_OBSERVATIONAL_POSTS,
  DATADOG_PROBE_ONLY,
} from "../../../../atlas/datadog/exclusions.js";
import { DATADOG_SDK_PIN, DATADOG_SPEC_PARITY } from "../../../../atlas/datadog/generated/sdkLock.js";
import { DATADOG_SURFACES } from "../../../../atlas/datadog/generated/surfaces.js";
import { DATADOG_REGISTRY_KINDS } from "../../../../atlas/datadog/model.js";
import { DATADOG_SHAPE_INDEXED } from "../../../../atlas/datadog/shapeIndexed.js";

describe("the generated Datadog surface registry", () => {
  it("has at least one entry in DATADOG_OBSERVATIONAL_POSTS, so the guards below are not vacuously green", () => {
    expect(DATADOG_OBSERVATIONAL_POSTS.length).toBeGreaterThan(0);
  });

  it("holds one row per operation the pinned client declares", () => {
    expect(DATADOG_SURFACES.length).toBe(DATADOG_SDK_PIN.census.total);
  });

  it("matches the pinned census method by method, so a lost operation is not a smaller table", () => {
    const counts = { DELETE: 0, GET: 0, PATCH: 0, POST: 0, PUT: 0 };
    for (const row of DATADOG_SURFACES) {
      counts[row.method] += 1;
    }
    expect(counts).toStrictEqual({
      DELETE: DATADOG_SDK_PIN.census.DELETE,
      GET: DATADOG_SDK_PIN.census.GET,
      PATCH: DATADOG_SDK_PIN.census.PATCH,
      POST: DATADOG_SDK_PIN.census.POST,
      PUT: DATADOG_SDK_PIN.census.PUT,
    });
  });

  it("gives every row a unique surface name, because the name is what a caller passes instead of a URL", () => {
    expect(new Set(DATADOG_SURFACES.map((row) => row.name)).size).toBe(DATADOG_SURFACES.length);
  });

  it("gives every row a unique operation key, which is the reproduction handle", () => {
    expect(new Set(DATADOG_SURFACES.map((row) => row.operationKey)).size).toBe(DATADOG_SURFACES.length);
  });

  it("carries Datadog's own unstable marking, read from the client rather than guessed from the path", () => {
    expect(DATADOG_SURFACES.filter((row) => row.unstable).length).toBe(DATADOG_SDK_PIN.unstableOperations);
  });

  it("carries Datadog's own deprecated flag, which the compiled client does not", () => {
    expect(DATADOG_SURFACES.filter((row) => row.deprecated).length).toBe(DATADOG_SPEC_PARITY.deprecated);
  });

  it("says why every row that is not a plain entity is not one", () => {
    const unexplained = DATADOG_SURFACES.filter(
      (row) => row.disposition !== "entity" && row.dispositionBecause === null,
    );
    expect(unexplained).toStrictEqual([]);
  });

  it("gives a plain entity row no reason, because there is nothing to explain", () => {
    const explained = DATADOG_SURFACES.filter((row) => row.disposition === "entity" && row.dispositionBecause !== null);
    expect(explained).toStrictEqual([]);
  });

  it("attaches an exclusion reason to exactly the excluded rows", () => {
    const mismatched = DATADOG_SURFACES.filter(
      (row) => (row.disposition === "excluded") !== (row.exclusionReason !== null),
    );
    expect(mismatched).toStrictEqual([]);
  });

  it("never admits a PUT, PATCH or DELETE, because this atlas only ever reads", () => {
    const writable = DATADOG_SURFACES.filter(
      (row) =>
        row.disposition !== "excluded" && (row.method === "PUT" || row.method === "PATCH" || row.method === "DELETE"),
    );
    expect(writable).toStrictEqual([]);
  });

  it("admits a POST only when it is on the reviewed observational allowlist", () => {
    const admitted = DATADOG_SURFACES.filter((row) => row.disposition !== "excluded" && row.method === "POST");
    const offList = admitted.filter((row) => !DATADOG_OBSERVATIONAL_POSTS.includes(row.path));
    expect(offList).toStrictEqual([]);
  });

  // The row that proves an HTTP method decides nothing here: a GET that renders a widget and uploads the
  // image. If this ever flips to reachable, the atlas has started creating artifacts in the tenant.
  it("refuses the graph snapshot GET, which creates an artifact", () => {
    const row = DATADOG_SURFACES.find((entry) => entry.path === "/api/v1/graph/snapshot" && entry.method === "GET");
    expect(row?.disposition).toBe("excluded");
    expect(row?.exclusionReason).toBe("side-effecting");
  });

  it("refuses the two key reads whose PATH PARAMETER is the credential", () => {
    const rows = DATADOG_SURFACES.filter(
      (entry) =>
        entry.method === "GET" &&
        (entry.path === "/api/v1/api_key/{key}" || entry.path === "/api/v1/application_key/{key}"),
    );
    expect(rows.map((row) => row.exclusionReason)).toStrictEqual(["secret-bearing", "secret-bearing"]);
  });

  // The key LISTS stay reachable: refusing them would answer "Datadog has no way to enumerate keys", which
  // is false. `sensitiveFields.ts` is what removes the value.
  it("keeps the key list reads reachable, because field denial is what protects them", () => {
    const list = DATADOG_SURFACES.find((entry) => entry.path === "/api/v1/api_key" && entry.method === "GET");
    expect(list?.disposition).toBe("entity");
  });

  it("shape-indexes log search rather than refusing it, which is the owner's 'we don't do nothing' cut", () => {
    const row = DATADOG_SURFACES.find((entry) => entry.path === "/api/v2/logs/events/search");
    expect(row?.disposition).toBe("shape-index");
  });

  it("keeps log CONFIGURATION as entities, so the scope rule cuts through a family rather than around it", () => {
    const row = DATADOG_SURFACES.find(
      (entry) => entry.path === "/api/v1/logs/config/indexes" && entry.method === "GET",
    );
    expect(row?.disposition).toBe("entity");
    expect(row?.kind).toBe("logs");
  });

  it("treats credential validation as probe-only, because it publishes no entity", () => {
    const row = DATADOG_SURFACES.find((entry) => entry.path === "/api/v1/validate");
    expect(row?.disposition).toBe("probe-only");
  });

  // Every kind, whatever the disposition — an excluded or shape-indexed row still needs a file to be
  // published into, and 50 rows across 28 kinds had none while this checked entity rows alone.
  // `tools/datadogKindCensus.ts` reproduces the measurement.
  it("carries rows for exactly the kinds the model declares, in both directions", () => {
    const kinds = [...new Set(DATADOG_SURFACES.map((row) => row.kind))];
    expect(kinds.toSorted()).toStrictEqual([...DATADOG_REGISTRY_KINDS]);
  });

  it("puts no operation in two disposition tables at once", () => {
    const seen = new Set<string>();
    const duplicates: string[] = [];
    const groups = [...DATADOG_EXCLUSIONS, ...DATADOG_SHAPE_INDEXED, DATADOG_PROBE_ONLY];
    for (const group of groups) {
      for (const operation of group.operations) {
        const key = `${operation.method} ${operation.path}`;
        if (seen.has(key)) {
          duplicates.push(key);
        }
        seen.add(key);
      }
    }
    expect(duplicates).toStrictEqual([]);
  });

  // A table row naming an operation the client does not declare is a decision about nothing, and it reads
  // exactly like a decision that is being enforced.
  it("names only operations the registry actually holds in every disposition table", () => {
    const known = new Set(DATADOG_SURFACES.map((row) => `${row.method} ${row.path}`));
    const groups = [...DATADOG_EXCLUSIONS, ...DATADOG_SHAPE_INDEXED, DATADOG_PROBE_ONLY];
    const unknown = groups.flatMap((group) =>
      group.operations.map((operation) => `${operation.method} ${operation.path}`).filter((key) => !known.has(key)),
    );
    expect(unknown).toStrictEqual([]);
  });

  it("lists only real POST paths on the observational allowlist", () => {
    const posts = new Set(DATADOG_SURFACES.filter((row) => row.method === "POST").map((row) => row.path));
    expect(DATADOG_OBSERVATIONAL_POSTS.filter((path) => !posts.has(path))).toStrictEqual([]);
  });
});
