/**
 * The atlas projection, over both entity layouts the estate actually carries.
 *
 * Pure: every case is an object literal in, rows out. The fixtures are hand-written rows in each published
 * LAYOUT, with synthetic ids and values — a Vanta `browser-page` for the canonical `channels` map, a
 * Cloudflare `zero-trust-organization` for the pre-`channels` row that names its channel in `source.channel`,
 * and a CrowdStrike `prevention-policy` for the one that names it in `source.surface`. Inventing a LAYOUT here
 * would test one nobody publishes.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { collapseGaps, projectEnvelope } from "../../../../store/atlas/envelope.js";
import { channelNameOf, mayHoldNul, projectEntity, stripNuls } from "../../../../store/atlas/project.js";
import type { NewAtlasGapRow } from "../../../../store/schema.js";

const GENERATION_AT = new Date("2026-09-19T00:47:21.989Z");

/** A canonical two-channel entity, as `kit/channelEntity.ts` assembles one. */
const CANONICAL = {
  channels: {
    browser: {
      channel: "browser",
      detail: { title: "Tests" },
      firstSeenAt: "2026-09-19T09:39:25.207Z",
      lastSeenAt: "2026-09-19T09:41:00.000Z",
      source: {
        artifacts: [{ byteLength: 12, kind: "page-png" }],
        channel: "browser",
        deepLink: "https://app.vanta.com/c/acme/tests",
        deepLinkStatus: "browser-discovered",
        endpoint: "https://app.vanta.com/c/acme/tests",
        observedAt: "2026-09-19T09:39:25.207Z",
      },
      state: "observed",
    },
    "manage-api": null,
  },
  financialDetail: null,
  id: "00000000000000000000000000000c01",
  kind: "browser-page",
  providerId: "tests-collection",
  sensitivity: "restricted",
};

/** A pre-`channels` Cloudflare row: no `channels` map, channel named in `source.channel`. */
const FLAT_CHANNEL = {
  detail: { authDomain: "acme.cloudflareaccess.com" },
  firstSeenAt: "2026-09-06T10:00:00.000Z",
  id: "00000000000000000000000000000c02",
  kind: "zero-trust-organization",
  lastSeenAt: "2026-09-19T00:47:21.989Z",
  providerId: "operation:00000c05",
  scope: { accountId: "0000000000000000000000000000ac01" },
  source: { channel: "rest-api", observedAt: "2026-09-19T00:47:21.989Z", operation: "api-gateway-operations-list" },
  state: "observed",
};

/** A pre-`channels` CrowdStrike row: no `channels` map, no `lastSeenAt`, channel named in `source.surface`. */
const FLAT_SURFACE = {
  createdAt: "2024-03-19T13:47:10.804Z",
  firstSeenAt: "2026-09-06T10:07:33.492Z",
  id: "00000000000000000000000000000c03",
  name: "platform_default",
  platformName: "Android",
  providerId: "00000000000000000000000000000c04",
  source: {
    artifacts: [],
    deepLink: null,
    deepLinkStatus: "unverified",
    endpoint: "/policy/combined/prevention/v1",
    observedAt: "2026-09-19T00:06:27.556Z",
    surface: "falcon-api",
  },
  state: "observed",
};

/** Project one entity with the arguments every case here shares. */
function project({ entity, scanForNuls = false }: { entity: unknown; scanForNuls?: boolean }) {
  return projectEntity({
    entity,
    generationAt: GENERATION_AT,
    kind: "a-kind",
    lineNumber: 2,
    path: "/atlas/p/a-kinds.jsonl",
    platform: "p",
    scanForNuls,
  });
}

describe("projectEntity over the canonical channels map", () => {
  it("projects one row per FILLED channel and skips the null slot", () => {
    const projected = unwrap(project({ entity: CANONICAL }));
    expect(projected.channels.length).toBe(1);
    expect(projected.channels[0]!.channel).toBe("browser");
    expect(projected.channels[0]!.state).toBe("observed");
    expect(projected.channels[0]!.deepLinkStatus).toBe("browser-discovered");
    expect(projected.channels[0]!.endpoint).toBe("https://app.vanta.com/c/acme/tests");
    expect(projected.channels[0]!.firstSeenAt.toISOString()).toBe("2026-09-19T09:39:25.207Z");
    expect(projected.channels[0]!.lastSeenAt.toISOString()).toBe("2026-09-19T09:41:00.000Z");
  });

  it("takes the entity key from the line and the kind from the caller, not from the entity", () => {
    const projected = unwrap(project({ entity: CANONICAL }));
    expect(projected.entity.entityId).toBe("00000000000000000000000000000c01");
    expect(projected.entity.providerId).toBe("tests-collection");
    expect(projected.entity.kind).toBe("a-kind");
    expect(projected.entity.platform).toBe("p");
  });

  it("keeps the platform's own extra fields and no canonical one", () => {
    const projected = unwrap(project({ entity: CANONICAL }));
    expect(projected.entity.extra).toEqual({ financialDetail: null, sensitivity: "restricted" });
  });
});

describe("projectEntity over a pre-channels entity", () => {
  it("names the channel from source.channel and keeps the row's own detail", () => {
    const projected = unwrap(project({ entity: FLAT_CHANNEL }));
    expect(projected.channels.length).toBe(1);
    expect(projected.channels[0]!.channel).toBe("rest-api");
    expect(projected.channels[0]!.detail).toEqual({ authDomain: "acme.cloudflareaccess.com" });
  });

  it("reads cloudflare's `operation` as the endpoint, since it carries no `endpoint`", () => {
    const projected = unwrap(project({ entity: FLAT_CHANNEL }));
    expect(projected.channels[0]!.endpoint).toBe("api-gateway-operations-list");
    expect(projected.channels[0]!.deepLink).toBe(null);
  });

  it("names the channel from source.surface when there is no source.channel", () => {
    const projected = unwrap(project({ entity: FLAT_SURFACE }));
    expect(projected.channels[0]!.channel).toBe("falcon-api");
    expect(projected.channels[0]!.surface).toBe("falcon-api");
  });

  it("falls lastSeenAt back to firstSeenAt when the row carries only one look", () => {
    const projected = unwrap(project({ entity: FLAT_SURFACE }));
    expect(projected.channels[0]!.firstSeenAt.toISOString()).toBe("2026-09-06T10:07:33.492Z");
    expect(projected.channels[0]!.lastSeenAt.toISOString()).toBe("2026-09-06T10:07:33.492Z");
  });

  it("makes the row's own non-view fields the detail, since a flat row has no detail bag", () => {
    const projected = unwrap(project({ entity: FLAT_SURFACE }));
    expect(projected.channels[0]!.detail).toEqual({
      createdAt: "2024-03-19T13:47:10.804Z",
      name: "platform_default",
      platformName: "Android",
    });
  });

  it("carries no extras, because a flat row's fields are its detail rather than its extras", () => {
    const projected = unwrap(project({ entity: FLAT_SURFACE }));
    expect(projected.entity.extra).toEqual({});
  });
});

describe("projectEntity refusals", () => {
  it("refuses a line that is not an object", () => {
    const refused = project({ entity: ["not", "a", "record"] });
    expect(refused.isErr()).toBe(true);
    expect(unwrapErr(refused).code).toBe("UNREADABLE_LINE");
  });

  it("names the missing field when an entity carries no id", () => {
    const refused = project({ entity: { ...FLAT_SURFACE, id: "" } });
    expect(refused.isErr()).toBe(true);
    expect(unwrapErr(refused).code).toBe("MISSING_FIELD");
    expect(unwrapErr(refused).message).toContain("no usable id");
  });

  it("names the missing field when an entity carries no providerId", () => {
    const refused = project({ entity: { ...CANONICAL, providerId: 7 } });
    expect(refused.isErr()).toBe(true);
    expect(unwrapErr(refused).code).toBe("MISSING_FIELD");
    expect(unwrapErr(refused).message).toContain("no usable providerId");
  });

  it("refuses a pre-channels row that names its channel nowhere", () => {
    const refused = project({ entity: { ...FLAT_SURFACE, source: { observedAt: "2026-09-19T00:00:00.000Z" } } });
    expect(refused.isErr()).toBe(true);
    expect(unwrapErr(refused).code).toBe("UNNAMED_CHANNEL");
  });

  it("refuses an unreadable instant rather than defaulting it", () => {
    const refused = project({ entity: { ...FLAT_SURFACE, firstSeenAt: "the day before yesterday" } });
    expect(refused.isErr()).toBe(true);
    expect(unwrapErr(refused).code).toBe("UNREADABLE_INSTANT");
  });

  it("refuses a state outside the two the kit assigns", () => {
    const refused = project({ entity: { ...FLAT_SURFACE, state: "guessed" } });
    expect(refused.isErr()).toBe(true);
    expect(unwrapErr(refused).code).toBe("MISSING_FIELD");
  });
});

describe("channelNameOf", () => {
  it("prefers source.channel over source.surface when a row carries both", () => {
    expect(channelNameOf({ source: { channel: "rest-api", surface: "cloudflare-api" } })).toBe("rest-api");
  });

  it("answers null for a source that is not a record", () => {
    expect(channelNameOf({ source: null })).toBe(null);
  });
});

describe("the U+0000 strip Postgres jsonb forces", () => {
  it("sees the escape in a raw line and the literal byte in a parsed one", () => {
    expect(mayHoldNul({ line: String.raw`{"a":"b\u0000c"}` })).toBe(true);
    expect(mayHoldNul({ line: '{"a":"b\u0000c"}' })).toBe(true);
    expect(mayHoldNul({ line: '{"a":"bc"}' })).toBe(false);
  });

  it("removes every NUL and counts them", () => {
    const done = stripNuls({ value: { deep: ["x\u0000y", { z: "\u0000\u0000" }] } });
    expect(done.stripped).toBe(3);
    expect(done.value).toEqual({ deep: ["xy", { z: "" }] });
  });

  it("returns the same reference when there is nothing to strip", () => {
    const value = { deep: ["x", { z: "y" }] };
    const done = stripNuls({ value });
    expect(done.stripped).toBe(0);
    expect(done.value).toBe(value);
  });

  it("strips inside a channel detail only when the caller asks it to scan", () => {
    const dirty = { ...FLAT_CHANNEL, detail: { note: "poli\u0000cy" } };
    expect(unwrap(project({ entity: dirty, scanForNuls: true })).channels[0]!.detail).toEqual({ note: "policy" });
    expect(unwrap(project({ entity: dirty, scanForNuls: true })).nulsStripped).toBe(1);
    expect(unwrap(project({ entity: dirty })).channels[0]!.detail).toEqual({ note: "poli\u0000cy" });
  });
});

describe("collapseGaps", () => {
  const gap = (over: Partial<NewAtlasGapRow> = {}): NewAtlasGapRow => ({
    condition: "reachable-but-empty",
    fields: [],
    firstDetectedAt: GENERATION_AT,
    gapId: "7d8bc038",
    kind: "applications",
    lastCheckedAt: null,
    lastDetectedAt: GENERATION_AT,
    platform: "jumpcloud",
    reason: "answered successfully and carried no records",
    scope: "v2-graph",
    status: "open",
    surfaces: ["directory-api"],
    ...over,
  });

  it("keeps the first of a repeated (kind, id) and counts the rest", () => {
    const folded = collapseGaps({ rows: [gap(), gap(), gap()] });
    expect(folded.rows.length).toBe(1);
    expect(folded.collapsed).toBe(2);
  });

  it("keeps two gaps that differ only in kind", () => {
    const folded = collapseGaps({ rows: [gap(), gap({ kind: "systems" })] });
    expect(folded.rows.length).toBe(2);
    expect(folded.collapsed).toBe(0);
  });

  it("collapses nothing in an empty list", () => {
    const folded = collapseGaps({ rows: [] });
    expect(folded.rows.length).toBe(0);
    expect(folded.collapsed).toBe(0);
  });
});

describe("projectEnvelope", () => {
  const envelope = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    coverage: [
      {
        lastSuccessAt: "2026-09-19T00:47:21.989Z",
        latestAttemptFailed: false,
        reason: "read 1 record",
        scope: "account/zero-trust-organization",
        state: "synced",
        unblockedBy: null,
        visibilityScope: "configured-token-visible",
      },
    ],
    entities: [],
    gaps: [],
    kind: "zero-trust-organization",
    platform: "cloudflare",
    schemaVersion: 3,
    updatedAt: "2026-09-19T00:47:21.989Z",
    ...over,
  });

  it("takes the kind and the generation instant off line 1", () => {
    const projected = unwrap(projectEnvelope({ envelope: envelope(), path: "/p/f.jsonl", platform: "cloudflare" }));
    expect(projected.kind).toBe("zero-trust-organization");
    expect(projected.generationAt.toISOString()).toBe("2026-09-19T00:47:21.989Z");
    expect(projected.schemaVersion).toBe(3);
    expect(projected.readEpoch).toBe(null);
  });

  it("accepts a cloudflare coverage cell that carries no surface, role or artifacts", () => {
    const projected = unwrap(projectEnvelope({ envelope: envelope(), path: "/p/f.jsonl", platform: "cloudflare" }));
    expect(projected.coverage.length).toBe(1);
    expect(projected.coverage[0]!.surface).toBe(null);
    expect(projected.coverage[0]!.role).toBe(null);
    expect(projected.coverage[0]!.artifacts).toEqual([]);
    expect(projected.coverage[0]!.state).toBe("synced");
  });

  it("accepts an envelope that carries no platform at all, taking it from the directory", () => {
    const { platform: _dropped, ...noPlatform } = envelope();
    const projected = unwrap(projectEnvelope({ envelope: noPlatform, path: "/p/f.jsonl", platform: "cloudflare" }));
    expect(projected.kind).toBe("zero-trust-organization");
  });

  it("refuses an envelope whose declared platform is not the directory it sits in", () => {
    const refused = projectEnvelope({ envelope: envelope(), path: "/p/f.jsonl", platform: "vanta" });
    expect(refused.isErr()).toBe(true);
    expect(unwrapErr(refused).code).toBe("PLATFORM_MISMATCH");
  });

  it("refuses an envelope that names no kind", () => {
    const refused = projectEnvelope({
      envelope: envelope({ kind: undefined }),
      path: "/p/f.jsonl",
      platform: "cloudflare",
    });
    expect(refused.isErr()).toBe(true);
    expect(unwrapErr(refused).code).toBe("UNUSABLE_ENVELOPE");
  });

  it("maps a coverage state this build has never heard of to unreadable rather than inventing a label", () => {
    const cells = envelope()["coverage"] as readonly Record<string, unknown>[];
    const projected = unwrap(
      projectEnvelope({
        envelope: envelope({ coverage: [{ ...cells[0]!, state: "from-the-future" }] }),
        path: "/p/f.jsonl",
        platform: "cloudflare",
      }),
    );
    expect(projected.coverage[0]!.state).toBe("unreadable");
  });

  it("refuses a coverage cell that names no reason, rather than storing a blank one", () => {
    const cells = envelope()["coverage"] as readonly Record<string, unknown>[];
    const { reason: _dropped, ...noReason } = cells[0]!;
    const refused = projectEnvelope({
      envelope: envelope({ coverage: [noReason] }),
      path: "/p/f.jsonl",
      platform: "cloudflare",
    });
    expect(refused.isErr()).toBe(true);
    expect(unwrapErr(refused).message).toContain("names no reason");
  });

  it("refuses a gap that names no status, rather than assuming it is open", () => {
    const refused = projectEnvelope({
      envelope: envelope({
        gaps: [
          {
            condition: "reachable-but-empty",
            firstDetectedAt: "2026-09-06T18:10:04.832Z",
            id: "7d8bc038",
            lastDetectedAt: "2026-09-06T18:10:04.832Z",
            reason: "answered and carried no records",
            scope: "v2-graph",
          },
        ],
      }),
      path: "/p/f.jsonl",
      platform: "cloudflare",
    });
    expect(refused.isErr()).toBe(true);
    expect(unwrapErr(refused).message).toContain("names no status");
  });

  it("stores a gap that carries no fields or surfaces as empty arrays", () => {
    const projected = unwrap(
      projectEnvelope({
        envelope: envelope({
          gaps: [
            {
              condition: "reachable-but-empty",
              firstDetectedAt: "2026-09-06T18:10:04.832Z",
              id: "7d8bc038",
              lastCheckedAt: null,
              lastDetectedAt: "2026-09-06T18:10:04.832Z",
              reason: "answered and carried no records",
              scope: "v2-graph",
              status: "open",
            },
          ],
        }),
        path: "/p/f.jsonl",
        platform: "cloudflare",
      }),
    );
    expect(projected.gaps.length).toBe(1);
    expect(projected.gaps[0]!.fields).toEqual([]);
    expect(projected.gaps[0]!.surfaces).toEqual([]);
  });
});
