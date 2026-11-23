import { describe, expect, it } from "vitest";

import { mergeCloudflareKind, withStoredFirstSeen } from "../../../../atlas/cloudflare/merge.js";
import type { CloudflareEntity } from "../../../../atlas/cloudflare/model.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const AT = "2026-01-01T00:00:00.000Z";
const LATER = "2026-01-02T00:00:00.000Z";

function zoneEntity({
  id,
  firstSeenAt,
  state = "observed",
}: {
  id: string;
  firstSeenAt: string;
  state?: "observed" | "stale";
}): CloudflareEntity {
  return {
    detail: { kind: "zone", name: id },
    firstSeenAt,
    id,
    kind: "zone",
    lastSeenAt: firstSeenAt,
    providerId: id,
    scope: { accountId: "a", parentId: null, zoneId: id },
    source: { channel: "rest-api", observedAt: firstSeenAt, operation: "zones-list" },
    state,
  };
}

function settingEntity({
  id,
  zoneId,
  state = "observed",
}: {
  id: string;
  zoneId: string;
  state?: "observed" | "stale";
}): CloudflareEntity {
  return {
    detail: { kind: "zone-setting", value: "on" },
    firstSeenAt: AT,
    id: `${zoneId}:${id}`,
    kind: "zone-setting",
    lastSeenAt: AT,
    providerId: id,
    scope: { accountId: "a", parentId: null, zoneId },
    source: { channel: "rest-api", observedAt: AT, operation: "zone-settings-list" },
    state,
  };
}

describe("mergeCloudflareKind", () => {
  it("adds a freshly observed entity with no prior history", () => {
    const observed = zoneEntity({ firstSeenAt: AT, id: "z1" });
    const result = unwrap(mergeCloudflareKind({ at: AT, observed: [observed], readZoneId: null, stored: [] }));
    expect(result).toEqual([observed]);
  });

  it("preserves firstSeenAt across runs for the same entity", () => {
    const stored = zoneEntity({ firstSeenAt: AT, id: "z1" });
    const observed = zoneEntity({ firstSeenAt: LATER, id: "z1" });
    const result = unwrap(mergeCloudflareKind({ at: LATER, observed: [observed], readZoneId: null, stored: [stored] }));
    expect(result[0]?.firstSeenAt).toBe(AT);
    expect(result[0]?.lastSeenAt).toBe(LATER);
  });

  it("stales an entity previously observed but absent from this run", () => {
    const stored = zoneEntity({ firstSeenAt: AT, id: "z1" });
    const result = unwrap(mergeCloudflareKind({ at: LATER, observed: [], readZoneId: null, stored: [stored] }));
    expect(result[0]?.state).toBe("stale");
  });

  it("un-stales an entity that reappears", () => {
    const stored = zoneEntity({ firstSeenAt: AT, id: "z1", state: "stale" });
    const observed = zoneEntity({ firstSeenAt: LATER, id: "z1" });
    const result = unwrap(mergeCloudflareKind({ at: LATER, observed: [observed], readZoneId: null, stored: [stored] }));
    expect(result[0]?.state).toBe("observed");
  });

  it("sorts the merged entities by id", () => {
    const result = unwrap(
      mergeCloudflareKind({
        at: AT,
        observed: [zoneEntity({ firstSeenAt: AT, id: "z2" }), zoneEntity({ firstSeenAt: AT, id: "z1" })],
        readZoneId: null,
        stored: [],
      }),
    );
    expect(result.map((entity) => entity.id)).toEqual(["z1", "z2"]);
  });

  it("refuses two observed entities sharing the same id", () => {
    const entity = zoneEntity({ firstSeenAt: AT, id: "z1" });
    const result = mergeCloudflareKind({ at: AT, observed: [entity, entity], readZoneId: null, stored: [] });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).some((line) => line.includes("z1"))).toBe(true);
  });
});

describe("mergeCloudflareKind over a zone-scoped kind", () => {
  it("leaves another zone's entities untouched when this run read one zone", () => {
    const other = settingEntity({ id: "ssl", zoneId: "zone-two" });
    const result = unwrap(
      mergeCloudflareKind({
        at: LATER,
        observed: [settingEntity({ id: "ssl", zoneId: "zone-one" })],
        readZoneId: "zone-one",
        stored: [other],
      }),
    );
    expect(result.map((entity) => entity.id)).toEqual(["zone-one:ssl", "zone-two:ssl"]);
    expect(result.find((entity) => entity.id === "zone-two:ssl")!.state).toBe("observed");
  });

  it("stales an entity of the zone it DID read that this run no longer returned", () => {
    const result = unwrap(
      mergeCloudflareKind({
        at: LATER,
        observed: [],
        readZoneId: "zone-one",
        stored: [settingEntity({ id: "ssl", zoneId: "zone-one" }), settingEntity({ id: "ssl", zoneId: "zone-two" })],
      }),
    );
    expect(result.find((entity) => entity.id === "zone-one:ssl")!.state).toBe("stale");
    expect(result.find((entity) => entity.id === "zone-two:ssl")!.state).toBe("observed");
  });

  it("accumulates one zone at a time, both zones' rows observed — the 672-to-56 fold this prevents", () => {
    const first = unwrap(
      mergeCloudflareKind({
        at: AT,
        observed: [settingEntity({ id: "ssl", zoneId: "zone-one" })],
        readZoneId: "zone-one",
        stored: [],
      }),
    );
    const second = unwrap(
      mergeCloudflareKind({
        at: LATER,
        observed: [settingEntity({ id: "ssl", zoneId: "zone-two" })],
        readZoneId: "zone-two",
        stored: first,
      }),
    );
    expect(second).toHaveLength(2);
    expect(second.map((entity) => entity.scope.zoneId)).toEqual(["zone-one", "zone-two"]);
    expect(second.map((entity) => entity.state)).toEqual(["observed", "observed"]);
  });
});

describe("withStoredFirstSeen", () => {
  it("keeps the instant a stored entity was first seen, and stamps a new one first seen now", () => {
    const stored = [zoneEntity({ firstSeenAt: AT, id: "z1" })];
    const fresh = [zoneEntity({ firstSeenAt: LATER, id: "z1" }), zoneEntity({ firstSeenAt: LATER, id: "z2" })];

    const carried = withStoredFirstSeen({ entities: fresh, stored });

    expect(carried.map((entity) => [entity.id, entity.firstSeenAt, entity.lastSeenAt])).toEqual([
      ["z1", AT, LATER],
      ["z2", LATER, LATER],
    ]);
  });

  it("returns an empty run as empty, and a run with nothing stored unchanged", () => {
    const fresh = [zoneEntity({ firstSeenAt: LATER, id: "z1" })];
    expect(withStoredFirstSeen({ entities: [], stored: fresh })).toEqual([]);
    expect(withStoredFirstSeen({ entities: fresh, stored: [] })).toEqual(fresh);
  });
});
