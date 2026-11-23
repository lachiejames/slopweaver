import { describe, expect, it } from "vitest";

import { absentAsNull } from "#lib/absent.js";
import { mergeVantaBrowserChannel, mergeVantaKind } from "../../../../atlas/vanta/merge.js";
import type { VantaEntity } from "../../../../atlas/vanta/model.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

function entity({
  id,
  at,
  browser,
}: {
  id: string;
  at: string;
  browser?: VantaEntity["channels"]["browser"];
}): VantaEntity {
  return {
    channels: {
      browser: absentAsNull({ value: browser }),
      "manage-api": {
        channel: "manage-api",
        detail: { id },
        firstSeenAt: at,
        lastSeenAt: at,
        source: {
          artifacts: [],
          channel: "manage-api",
          deepLink: null,
          deepLinkStatus: "unavailable",
          endpoint: "/controls",
          observedAt: at,
        },
        state: "observed",
      },
    },
    financialDetail: null,
    id,
    kind: "control",
    providerId: id,
    sensitivity: null,
  };
}

describe("mergeVantaKind", () => {
  it("adds a freshly observed entity to an empty store", () => {
    const observed = [entity({ at: "2026-01-01T00:00:00.000Z", id: "e1" })];
    const merged = unwrap(mergeVantaKind({ at: "2026-01-01T00:00:00.000Z", observed, stored: [] }));
    expect(merged).toHaveLength(1);
    expect(merged[0]!.id).toBe("e1");
  });

  it("preserves firstSeenAt across a later observation of the same entity", () => {
    const stored = [entity({ at: "2026-01-01T00:00:00.000Z", id: "e1" })];
    const observed = [entity({ at: "2026-01-02T00:00:00.000Z", id: "e1" })];
    const merged = unwrap(mergeVantaKind({ at: "2026-01-02T00:00:00.000Z", observed, stored }));
    expect(merged[0]!.channels["manage-api"]!.firstSeenAt).toBe("2026-01-01T00:00:00.000Z");
    expect(merged[0]!.channels["manage-api"]!.lastSeenAt).toBe("2026-01-02T00:00:00.000Z");
  });

  it("preserves a prior browser channel across a manage-api-only re-observation", () => {
    const browserChannel: VantaEntity["channels"]["browser"] = {
      channel: "browser",
      detail: { seen: true },
      firstSeenAt: "2025-01-01T00:00:00.000Z",
      lastSeenAt: "2025-01-01T00:00:00.000Z",
      source: null,
      state: "observed",
    };
    const stored = [entity({ at: "2026-01-01T00:00:00.000Z", browser: browserChannel, id: "e1" })];
    const observed = [entity({ at: "2026-01-02T00:00:00.000Z", id: "e1" })];
    const merged = unwrap(mergeVantaKind({ at: "2026-01-02T00:00:00.000Z", observed, stored }));
    expect(merged[0]!.channels.browser).toEqual(browserChannel);
  });

  it("marks a stored entity stale when it is no longer observed", () => {
    const stored = [entity({ at: "2026-01-01T00:00:00.000Z", id: "gone" })];
    const merged = unwrap(mergeVantaKind({ at: "2026-01-02T00:00:00.000Z", observed: [], stored }));
    expect(merged[0]!.channels["manage-api"]!.state).toBe("stale");
  });

  it("refuses when this run's observed entities contain a duplicate id", () => {
    const observed = [
      entity({ at: "2026-01-01T00:00:00.000Z", id: "dup" }),
      entity({ at: "2026-01-01T00:00:00.000Z", id: "dup" }),
    ];
    const result = mergeVantaKind({ at: "2026-01-01T00:00:00.000Z", observed, stored: [] });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)[0]).toContain("produced the same entity id twice");
  });

  it("sorts the merged list by id", () => {
    const observed = [
      entity({ at: "2026-01-01T00:00:00.000Z", id: "zzz" }),
      entity({ at: "2026-01-01T00:00:00.000Z", id: "aaa" }),
    ];
    const merged = unwrap(mergeVantaKind({ at: "2026-01-01T00:00:00.000Z", observed, stored: [] }));
    expect(merged.map((entry) => entry.id)).toEqual(["aaa", "zzz"]);
  });
});

describe("mergeVantaBrowserChannel", () => {
  const AT_BROWSER = "2026-09-07T10:00:00.000Z";

  const browserOnly = ({ id, deepLink }: { id: string; deepLink: string }): VantaEntity => ({
    channels: {
      browser: {
        channel: "browser",
        detail: { title: "Controls - Vanta" },
        firstSeenAt: AT_BROWSER,
        lastSeenAt: AT_BROWSER,
        source: {
          artifacts: [],
          channel: "browser",
          deepLink,
          deepLinkStatus: "browser-discovered",
          endpoint: deepLink,
          observedAt: AT_BROWSER,
        },
        state: "observed",
      },
      "manage-api": null,
    },
    financialDetail: null,
    id,
    kind: "control",
    providerId: id,
    sensitivity: null,
  });

  const apiOnly = ({ id }: { id: string }): VantaEntity => ({
    channels: {
      browser: null,
      "manage-api": {
        channel: "manage-api",
        detail: { externalId: "DCH-108" },
        firstSeenAt: "2026-09-01T00:00:00.000Z",
        lastSeenAt: "2026-09-01T00:00:00.000Z",
        source: {
          artifacts: [],
          channel: "manage-api",
          deepLink: null,
          deepLinkStatus: "unavailable",
          endpoint: "/controls",
          observedAt: "2026-09-01T00:00:00.000Z",
        },
        state: "observed",
      },
    },
    financialDetail: null,
    id,
    kind: "control",
    providerId: id,
    sensitivity: null,
  });

  it("adds a browser channel without disturbing the manage-api channel already there", () => {
    const merged = unwrap(
      mergeVantaBrowserChannel({
        at: AT_BROWSER,
        observed: [browserOnly({ deepLink: "https://app.vanta.com/c/acme/controls?controlId=a", id: "a" })],
        stored: [apiOnly({ id: "a" })],
      }),
    );
    expect(merged.length).toBe(1);
    expect(merged[0]!.channels["manage-api"]!.lastSeenAt).toBe("2026-09-01T00:00:00.000Z");
    expect(merged[0]!.channels.browser!.source!.deepLinkStatus).toBe("browser-discovered");
  });

  it("carries an entity this run never looked at through untouched, rather than staling it", () => {
    const merged = unwrap(
      mergeVantaBrowserChannel({
        at: AT_BROWSER,
        observed: [browserOnly({ deepLink: "https://app.vanta.com/c/acme/controls?controlId=a", id: "a" })],
        stored: [apiOnly({ id: "a" }), apiOnly({ id: "b" })],
      }),
    );
    const untouched = merged.find((row) => row.id === "b")!;
    expect(untouched.channels["manage-api"]!.state).toBe("observed");
    expect(untouched.channels.browser).toBe(null);
  });

  it("keeps the first time the browser saw an entity, rather than resetting it on every capture", () => {
    const stored = browserOnly({ deepLink: "https://app.vanta.com/c/acme/controls?controlId=a", id: "a" });
    const merged = unwrap(
      mergeVantaBrowserChannel({
        at: "2026-09-08T10:00:00.000Z",
        observed: [
          {
            ...stored,
            channels: {
              ...stored.channels,
              browser: { ...stored.channels.browser!, lastSeenAt: "2026-09-08T10:00:00.000Z" },
            },
          },
        ],
        stored: [
          {
            ...stored,
            channels: {
              ...stored.channels,
              browser: { ...stored.channels.browser!, firstSeenAt: "2026-09-02T00:00:00.000Z" },
            },
          },
        ],
      }),
    );
    expect(merged[0]!.channels.browser!.firstSeenAt).toBe("2026-09-02T00:00:00.000Z");
    expect(merged[0]!.channels.browser!.lastSeenAt).toBe("2026-09-08T10:00:00.000Z");
  });

  it("refuses an observed entity with no browser channel at all, rather than erasing what was there", () => {
    const refused = mergeVantaBrowserChannel({
      at: AT_BROWSER,
      observed: [apiOnly({ id: "a" })],
      stored: [apiOnly({ id: "a" })],
    });
    expect(refused.isErr()).toBe(true);
    expect(unwrapErr(refused)[0]).toBe("entity a was captured this run with no browser channel populated");
  });
});
