import { describe, expect, it } from "vitest";

import {
  DATADOG_EXCLUDED_KINDS,
  DATADOG_EXCLUSIONS,
  DATADOG_OBSERVATIONAL_POSTS,
  DATADOG_PROBE_ONLY,
  datadogExclusionFor,
  datadogKindExclusionFor,
  datadogProbeOnlyFor,
} from "../../../../atlas/datadog/exclusions.js";
import { DATADOG_SURFACES } from "../../../../atlas/datadog/generated/surfaces.js";
import { DATADOG_KINDS } from "../../../../atlas/datadog/model.js";
import { DATADOG_SHAPE_INDEXED, datadogShapeIndexFor } from "../../../../atlas/datadog/shapeIndexed.js";

const SYNTHETICS = DATADOG_SURFACES.filter((row) => row.kind === "synthetics");

describe("datadogExclusionFor", () => {
  it("finds a refused operation by its exact method and path", () => {
    expect(datadogExclusionFor({ method: "GET", path: "/api/v1/graph/snapshot" })?.reason).toBe("side-effecting");
  });

  // Matching on the path alone would refuse the GET as well as the write, or the write as well as the GET.
  it("matches on the METHOD too, so a path with several methods is not refused wholesale", () => {
    expect(datadogExclusionFor({ method: "GET", path: "/api/v1/api_key/{key}" })?.reason).toBe("secret-bearing");
    expect(datadogExclusionFor({ method: "POST", path: "/api/v1/api_key/{key}" })).toBe(undefined);
  });

  it("answers undefined for an operation no row refuses", () => {
    expect(datadogExclusionFor({ method: "GET", path: "/api/v1/monitor" })).toBe(undefined);
  });
});

describe("datadogShapeIndexFor", () => {
  it("shape-indexes log search rather than refusing it", () => {
    expect(datadogShapeIndexFor({ method: "POST", path: "/api/v2/logs/events/search" })?.detail).toContain(
      "log events themselves",
    );
  });

  // The rule cuts THROUGH a family rather than around it, which is why this is an operation table.
  it("leaves log CONFIGURATION alone, in the same family", () => {
    expect(datadogShapeIndexFor({ method: "GET", path: "/api/v1/logs/config/indexes" })).toBe(undefined);
  });
});

describe("datadogProbeOnlyFor", () => {
  it("treats credential validation as a probe that publishes nothing", () => {
    expect(datadogProbeOnlyFor({ method: "GET", path: "/api/v1/validate" })?.detail).toContain(
      "a fact about the installation",
    );
  });
});

describe("the disposition tables themselves", () => {
  it("gives every group a reason a reader can act on", () => {
    const groups = [...DATADOG_EXCLUSIONS, ...DATADOG_SHAPE_INDEXED, DATADOG_PROBE_ONLY];
    expect(groups.filter((group) => group.detail.length < 20)).toStrictEqual([]);
  });

  it("never lists an empty group, which would look like a decision while deciding nothing", () => {
    const groups = [...DATADOG_EXCLUSIONS, ...DATADOG_SHAPE_INDEXED, DATADOG_PROBE_ONLY];
    expect(groups.filter((group) => group.operations.length === 0)).toStrictEqual([]);
  });

  // `mutating` is deliberately absent from this table: a write is refused by the generator from its method
  // and its absence from the observational allowlist, so the table holds only decisions somebody made.
  it("carries only the two reasons a human decided, never the rule's 950 consequences", () => {
    const reasons = [...new Set(DATADOG_EXCLUSIONS.map((group) => group.reason))].toSorted();
    expect(reasons).toStrictEqual(["secret-bearing", "side-effecting"]);
  });

  it("lists each observational POST once", () => {
    expect(new Set(DATADOG_OBSERVATIONAL_POSTS).size).toBe(DATADOG_OBSERVATIONAL_POSTS.length);
  });

  // The list was wrong once and a path is what made it wrong: `POST /api/v2/replay/heatmap/snapshots` ends
  // in a plural noun and reads like a collection, while its operation is `createReplayHeatmapSnapshot` and
  // the same surface carries list, update and delete. The SDK names every operation, so `createX` is a
  // free second opinion on a list that is reviewed once and grown afterwards.
  // The same guard on the other verb, and it earned its place the same way: an adversarial pass found
  // `GET /api/v2/cost/tag_descriptions/{tag_key}/generate` — Datadog's own AI writing a draft description —
  // admitted as an entity. The `validate*` probes are exempt because they are `probe-only` by decision and
  // publish nothing.
  it("admits no GET whose own operation name says it CREATES", () => {
    const creating = /^(create|generate|render|capture|produce|draft|compose|trigger|send|submit|import|reprocess)/i;
    const offenders = DATADOG_SURFACES.filter(
      (row) =>
        row.method === "GET" && row.disposition !== "excluded" && creating.test(row.operationKey.split(".").at(-1)!),
    ).map((row) => row.operationKey);

    expect(offenders).toStrictEqual([]);
  });

  // Raised by a review pass and DECLINED on the merits, pinned so it is argued with rather than
  // rediscovered: the CWS policy download renders rules the tenant already holds into the response body and
  // nowhere else. Nothing is stored, sent or charged. A bar of "produces something" would fail every read
  // in the registry, since `GET /api/v1/dashboard/{id}` produces JSON.
  it("keeps the CWS policy download as an entity, because nothing changes outside its own response", () => {
    const row = DATADOG_SURFACES.find(
      (entry) => entry.method === "GET" && entry.path === "/api/v2/remote_config/products/cws/policy/download",
    );

    expect(row?.disposition).toBe("entity");
  });

  it("admits no POST whose own operation name says it MUTATES", () => {
    const mutating =
      /^(create|update|delete|add|remove|set|patch|put|submit|cancel|mute|unmute|trigger|send|register|upsert|validate|import|reprocess|start|stop|enable|disable|assign|unassign|archive|unarchive|approve|reject|move|link|unlink|install|uninstall|sync|refresh|reset|restore|revoke|rotate|bulk)/i;
    const offenders = DATADOG_SURFACES.filter(
      (row) =>
        row.method === "POST" && row.disposition !== "excluded" && mutating.test(row.operationKey.split(".").at(-1)!),
    ).map((row) => row.operationKey);

    expect(offenders).toStrictEqual([]);
  });

  // The other half of the same correction: a heatmap snapshot is CREATED, listed, updated and deleted by a
  // person, so by this atlas's own voluminous rule it is configuration rather than telemetry.
  it("keeps the saved heatmap snapshots as entities and refuses the create", () => {
    const list = DATADOG_SURFACES.find(
      (row) => row.method === "GET" && row.path === "/api/v2/replay/heatmap/snapshots",
    );
    const create = DATADOG_SURFACES.find(
      (row) => row.method === "POST" && row.path === "/api/v2/replay/heatmap/snapshots",
    );

    expect(list?.disposition).toBe("entity");
    expect(create?.disposition).toBe("excluded");
    expect(create?.exclusionReason).toBe("mutating");
  });
});

describe("datadogKindExclusionFor", () => {
  it("has at least one entry in DATADOG_EXCLUDED_KINDS, so the guards below are not vacuously green", () => {
    expect(DATADOG_EXCLUDED_KINDS.length).toBeGreaterThan(0);
  });

  it("refuses the whole synthetics kind, because no projection here makes its responses safe to store", () => {
    expect(datadogKindExclusionFor({ kind: "synthetics" })?.reason).toBe("unsupported-sensitive-shape");
  });

  it("answers undefined for a kind the atlas stores", () => {
    expect(datadogKindExclusionFor({ kind: "monitor" })).toBe(undefined);
  });

  // The exclusion waits on a piece of work, so the row has to name where that work is specified.
  it("names the module that specifies the projection which would admit the kind", () => {
    expect(datadogKindExclusionFor({ kind: "synthetics" })!.detail).toContain("sensitiveFields.ts");
  });

  // A row is exactly { kind, detail, reason }: the reversal condition left with the installation's state.
  it("declares each excluded kind with only its kind, its detail and its reason", () => {
    expect(DATADOG_EXCLUDED_KINDS.map((row) => Object.keys(row).toSorted())).toStrictEqual([
      ["detail", "kind", "reason"],
    ]);
  });
});

describe("the synthetics kind, as the registry now holds it", () => {
  // The witness that the exclusion BITES: an excluded row has no callable variant, so zero here is the
  // whole behaviour. It can fire — before this change 34 of these rows were entity or shape-index.
  it("leaves no callable synthetics operation at all", () => {
    const callable = SYNTHETICS.filter((row) => row.disposition !== "excluded").map((row) => row.operationKey);

    expect(callable).toStrictEqual([]);
  });

  it("counts 69 synthetics rows, 34 refused for the kind and 35 already refused as writes", () => {
    expect(SYNTHETICS.length).toBe(69);
    expect(SYNTHETICS.filter((row) => row.exclusionReason === "unsupported-sensitive-shape").length).toBe(34);
    expect(SYNTHETICS.filter((row) => row.exclusionReason === "mutating").length).toBe(35);
  });

  // The generator asks the method rule first on purpose: `mutating` is true about the operation forever,
  // `unsupported-sensitive-shape` only until the projection ships, and the more durable reason must
  // survive the day the exclusion comes out.
  it("keeps the more durable reason on a synthetics write", () => {
    const write = DATADOG_SURFACES.find((row) => row.method === "PUT" && row.kind === "synthetics");

    expect(write?.exclusionReason).toBe("mutating");
  });

  it("refuses a synthetics read for the kind rather than for its method", () => {
    const read = DATADOG_SURFACES.find((row) => row.method === "GET" && row.path === "/api/v1/synthetics/tests");

    expect(read?.disposition).toBe("excluded");
    expect(read?.exclusionReason).toBe("unsupported-sensitive-shape");
  });

  it("spends the reason on synthetics alone, so no other kind was quietly closed", () => {
    const kinds = [
      ...new Set(
        DATADOG_SURFACES.filter((row) => row.exclusionReason === "unsupported-sensitive-shape").map((row) => row.kind),
      ),
    ];

    expect(kinds).toStrictEqual(["synthetics"]);
  });

  // An atlas that DROPPED the kind would answer "Datadog has no synthetics", which is false and is the
  // failure `exclusions.ts` opens by refusing. Excluded rows still exist and stay addressable.
  it("still declares the kind, because excluded is not absent", () => {
    expect(DATADOG_KINDS).toContain("synthetics");
  });

  it("tells a reader on the row itself which projection would admit the kind", () => {
    const read = DATADOG_SURFACES.find((row) => row.method === "GET" && row.path === "/api/v1/synthetics/tests");

    expect(read?.dispositionBecause).toContain(
      "`sensitiveFields.ts` describes the projection that would admit the kind",
    );
  });
});
