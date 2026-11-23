import { describe, expect, it } from "vitest";

import { splitTrelicaChannels, summariseTrelicaDisagreement } from "../../../../atlas/trelica/disagreement.js";
import {
  emptyTrelicaChannels,
  type TrelicaAtlasEntity,
  type TrelicaChannelEntity,
} from "../../../../atlas/trelica/model.js";

const AT = "2026-09-05T00:00:00.000Z";

/** One channel record, with whatever detail the test needs. */
function channel({ name, detail }: { name: TrelicaChannelEntity["channel"]; detail: unknown }): TrelicaChannelEntity {
  return { channel: name, detail, firstSeenAt: AT, lastSeenAt: AT, source: null, state: "observed" };
}

/** A method entity with exactly the channels a test names filled. */
function method({
  providerId,
  filled,
}: {
  providerId: string;
  filled: Partial<Record<TrelicaChannelEntity["channel"], unknown>>;
}): TrelicaAtlasEntity {
  const channels = { ...emptyTrelicaChannels() };
  for (const [name, detail] of Object.entries(filled)) {
    channels[name as TrelicaChannelEntity["channel"]] = channel({
      detail,
      name: name as TrelicaChannelEntity["channel"],
    });
  }
  return { channels, id: providerId, kind: "method", providerId };
}

describe("splitTrelicaChannels", () => {
  it("puts an operation only one document declares in publishedOnly", () => {
    const split = splitTrelicaChannels({
      entities: [method({ filled: { "published-api": {} }, providerId: "GET /api/apps/v1" })],
    });
    expect([...split.publishedOnly]).toEqual(["GET /api/apps/v1"]);
  });

  it("separates an operation this atlas CALLED from one it merely watched", () => {
    const split = splitTrelicaChannels({
      entities: [
        method({
          filled: { "first-party-api": { calledDirectly: true } },
          providerId: "POST /AppsApi/CustomerApp/FilterItems",
        }),
        method({ filled: { browser: {} }, providerId: "GET /AppsApi/Other/Thing" }),
      ],
    });
    expect([...split.calledUndocumented]).toEqual(["POST /AppsApi/CustomerApp/FilterItems"]);
    expect([...split.observedUndocumented]).toEqual(["GET /AppsApi/Other/Thing"]);
  });

  it("counts an operation more than one channel has looked at as corroborated", () => {
    const split = splitTrelicaChannels({
      entities: [
        method({
          filled: { browser: {}, "first-party-api": { calledDirectly: true } },
          providerId: "POST /AppsApi/CustomerApp/FilterItems",
        }),
      ],
    });
    expect([...split.corroborated]).toEqual(["POST /AppsApi/CustomerApp/FilterItems"]);
    expect([...split.calledUndocumented]).toEqual([]);
  });

  it("treats a first-party row that was only observed as observed, not called", () => {
    const split = splitTrelicaChannels({
      entities: [method({ filled: { "first-party-api": { calledDirectly: false } }, providerId: "GET /x" })],
    });
    expect([...split.observedUndocumented]).toEqual(["GET /x"]);
    expect([...split.calledUndocumented]).toEqual([]);
  });
});

describe("summariseTrelicaDisagreement", () => {
  it("leads with the total and then the four counts", () => {
    const lines = summariseTrelicaDisagreement({
      split: {
        calledUndocumented: ["POST /a"],
        corroborated: ["GET /b"],
        observedUndocumented: [],
        publishedOnly: ["GET /c", "GET /d"],
      },
    });
    expect(lines[0]).toBe("trelica surface corroboration — 4 method row(s) held");
    expect(lines[1]).toContain("corroborated          1");
    expect(lines[2]).toContain("published only        2");
  });

  it("stops after the counts when nothing is undocumented", () => {
    const lines = summariseTrelicaDisagreement({
      split: { calledUndocumented: [], corroborated: [], observedUndocumented: [], publishedOnly: ["GET /a"] },
    });
    expect(lines.length).toBe(5);
  });

  it("samples the undocumented surface rather than printing all of it", () => {
    const lines = summariseTrelicaDisagreement({
      split: {
        calledUndocumented: Array.from(
          { length: 30 },
          (_ignored: unknown, index: number) => `POST /op-${String(index)}`,
        ),
        corroborated: [],
        observedUndocumented: [],
        publishedOnly: [],
      },
    });
    expect(lines[5]).toContain("first 12 of 30");
    expect(lines.length).toBe(18);
  });
});
