import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  channelEntitySchemaFor,
  coverageCellSchemaFor,
  gapSchemaFor,
  generationSchemas,
  kindFileSchemaFor,
  kindStatusSchema,
  manifestSchemaFor,
  responseAccountingSchema,
} from "../../../../atlas/kit/generationSchemas.js";
import { atlasKindStatusSchema } from "../../../../atlas/kit/kindStatus.js";

const AT = "2026-10-12T00:00:00.000Z";

/** Where a schema refused a value, as dotted paths — so a test names WHICH field was refused, not only that one was. */
function refusedAt({ schema, value }: { schema: z.ZodType; value: unknown }): readonly string[] {
  return schema.safeParse(value).error!.issues.map((issue) => issue.path.join("."));
}

const CELL = {
  artifacts: [],
  lastSuccessAt: AT,
  latestAttemptFailed: false,
  reason: "every repository listed",
  role: "authoritative",
  scope: "org",
  state: "synced",
  surface: "rest",
  unblockedBy: null,
  visibilityScope: "org-members",
};

const GAP = {
  condition: "permission-denied",
  fields: [],
  firstDetectedAt: AT,
  id: "gap-1",
  kind: null,
  lastCheckedAt: null,
  lastDetectedAt: AT,
  reason: "the token cannot read audit logs",
  scope: "org",
  status: "open",
  surfaces: ["rest"],
};

const STATUS = { digest: "a".repeat(64), entityCount: 2, lastAttempt: null, lastSuccessAt: AT };

describe("coverageCellSchemaFor", () => {
  const cell = coverageCellSchemaFor({ surfaces: ["rest", "graphql"] });

  it("accepts a cell on one of the platform's own surfaces", () => {
    expect(cell.parse(CELL)).toEqual(CELL);
  });

  it("refuses another platform's surface, an empty reason and an unknown key", () => {
    expect(refusedAt({ schema: cell, value: { ...CELL, surface: "slack-web" } })).toEqual(["surface"]);
    expect(refusedAt({ schema: cell, value: { ...CELL, reason: "" } })).toEqual(["reason"]);
    expect(refusedAt({ schema: cell, value: { ...CELL, channel: "rest" } })).toEqual([""]);
  });
});

describe("gapSchemaFor", () => {
  const gap = gapSchemaFor({ conditions: ["permission-denied"], kinds: ["repo", "team"], surfaces: ["rest"] });

  it("accepts a gap that belongs to no kind", () => {
    expect(gap.parse(GAP)).toEqual(GAP);
    expect(gap.parse({ ...GAP, kind: "team" })).toEqual({ ...GAP, kind: "team" });
  });

  it("refuses a condition, kind or surface outside the platform's vocabulary", () => {
    expect(refusedAt({ schema: gap, value: { ...GAP, condition: "rate-limited" } })).toEqual(["condition"]);
    expect(refusedAt({ schema: gap, value: { ...GAP, kind: "workflow" } })).toEqual(["kind"]);
    expect(refusedAt({ schema: gap, value: { ...GAP, surfaces: ["rest", "graphql"] } })).toEqual(["surfaces.1"]);
    expect(refusedAt({ schema: gap, value: { ...GAP, status: "resolved" } })).toEqual(["status"]);
  });
});

describe("kindStatusSchema", () => {
  it("is the kit's own kind status, not a copy that can drift from it", () => {
    expect(kindStatusSchema).toBe(atlasKindStatusSchema);
  });

  it("refuses an empty digest, which no publish writes", () => {
    expect(kindStatusSchema.parse(STATUS)).toEqual(STATUS);
    expect(kindStatusSchema.parse({ ...STATUS, digest: null })).toEqual({ ...STATUS, digest: null });
    expect(refusedAt({ schema: kindStatusSchema, value: { ...STATUS, digest: "" } })).toEqual(["digest"]);
  });
});

describe("manifestSchemaFor", () => {
  const manifest = manifestSchemaFor({ kinds: ["repo", "team"], schemaVersion: 3 });
  const valid = { kinds: { repo: STATUS, team: STATUS }, schemaVersion: 3, updatedAt: AT };

  it("accepts a manifest naming every kind at this build's version", () => {
    expect(manifest.parse(valid)).toEqual(valid);
  });

  it("refuses a missing kind, an unknown kind, and another schema version", () => {
    expect(refusedAt({ schema: manifest, value: { ...valid, kinds: { repo: STATUS } } })).toEqual(["kinds.team"]);
    expect(refusedAt({ schema: manifest, value: { ...valid, kinds: { ...valid.kinds, workflow: STATUS } } })).toEqual([
      "kinds",
    ]);
    expect(refusedAt({ schema: manifest, value: { ...valid, schemaVersion: 2 } })).toEqual(["schemaVersion"]);
  });
});

describe("channelEntitySchemaFor and kindFileSchemaFor", () => {
  const source = z.object({ endpoint: z.string().min(1) }).strict();
  const view = channelEntitySchemaFor({ channels: ["api", "browser"], source });
  const VIEW = {
    channel: "api",
    detail: { anything: true },
    firstSeenAt: AT,
    lastSeenAt: AT,
    source: { endpoint: "/repos" },
    state: "observed",
  };

  it("wraps an opaque detail in the platform's own channels and source shape", () => {
    expect(view.parse(VIEW)).toEqual(VIEW);
    expect(view.parse({ ...VIEW, source: null })).toEqual({ ...VIEW, source: null });
  });

  it("refuses a channel the platform lacks and a source in another shape", () => {
    expect(refusedAt({ schema: view, value: { ...VIEW, channel: "mcp" } })).toEqual(["channel"]);
    expect(refusedAt({ schema: view, value: { ...VIEW, source: { endpoint: "" } } })).toEqual(["source.endpoint"]);
    expect(refusedAt({ schema: view, value: { ...VIEW, state: "deleted" } })).toEqual(["state"]);
  });

  it("builds a kind file over the platform's own cell, entity and gap schemas", () => {
    const file = kindFileSchemaFor({
      cell: coverageCellSchemaFor({ surfaces: ["rest"] }),
      entity: z.object({ id: z.string().min(1) }).strict(),
      gap: gapSchemaFor({ conditions: ["permission-denied"], kinds: ["repo"], surfaces: ["rest"] }),
      kinds: ["repo"],
      platform: "github",
      schemaVersion: 3,
    });
    const valid = {
      coverage: [CELL],
      entities: [{ id: "repo:1" }],
      gaps: [GAP],
      kind: "repo",
      platform: "github",
      schemaVersion: 3,
      updatedAt: AT,
    };

    expect(file.parse({ ...valid, coverage: [{ ...CELL, surface: "rest" }] })).toEqual(valid);
    expect(refusedAt({ schema: file, value: { ...valid, platform: "hex" } })).toEqual(["platform"]);
    expect(refusedAt({ schema: file, value: { ...valid, entities: [{ id: "" }] } })).toEqual(["entities.0.id"]);
  });
});

describe("responseAccountingSchema and the family object", () => {
  it("refuses a negative or fractional count", () => {
    const counts = { bodyFailed: 0, bodySucceeded: 2, eligible: 2, seen: 3 };

    expect(responseAccountingSchema.parse(counts)).toEqual(counts);
    expect(refusedAt({ schema: responseAccountingSchema, value: { ...counts, bodyFailed: -1 } })).toEqual([
      "bodyFailed",
    ]);
    expect(refusedAt({ schema: responseAccountingSchema, value: { ...counts, seen: 1.5 } })).toEqual(["seen"]);
  });

  it("groups exactly the individual exports, so either import reaches the same schema", () => {
    expect(generationSchemas.channelEntityFor).toBe(channelEntitySchemaFor);
    expect(generationSchemas.coverageCellFor).toBe(coverageCellSchemaFor);
    expect(generationSchemas.gapFor).toBe(gapSchemaFor);
    expect(generationSchemas.kindFileFor).toBe(kindFileSchemaFor);
    expect(generationSchemas.kindStatus).toBe(kindStatusSchema);
    expect(generationSchemas.manifestFor).toBe(manifestSchemaFor);
    expect(generationSchemas.responseAccounting).toBe(responseAccountingSchema);
  });
});
