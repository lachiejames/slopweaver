/**
 * The corroboration output: which routes each channel has looked at, and which only one has.
 *
 * The owner's ruling is that a disagreement is a thing the atlas SHOWS and never one it resolves, so these
 * tests check that all three sets survive rather than that one wins.
 */
import { describe, expect, it } from "vitest";

import {
  splitXeroChannels,
  summariseDisagreement,
  XERO_DISAGREEMENT_SAMPLE,
} from "../../../../atlas/xero/disagreement.js";
import type { XeroAtlasEntity, XeroChannelEntity } from "../../../../atlas/xero/model.js";

const AT = "2026-09-05T00:00:00.000Z";

/** One channel's view, present only so the entity says that channel has looked. */
function looked({ channel }: { channel: "api" | "browser" }): XeroChannelEntity {
  return { channel, detail: null, firstSeenAt: AT, lastSeenAt: AT, source: null, state: "observed" };
}

/** One method entity with the named channels present. */
function method({ id, api, browser }: { id: string; api: boolean; browser: boolean }): XeroAtlasEntity {
  return {
    channels: {
      api: api ? looked({ channel: "api" }) : null,
      browser: browser ? looked({ channel: "browser" }) : null,
    },
    id,
    kind: "method",
    providerId: id,
  };
}

describe("splitXeroChannels", () => {
  const entities = [
    method({ api: true, browser: true, id: "GET both" }),
    method({ api: true, browser: false, id: "GET declared" }),
    method({ api: false, browser: true, id: "GET undocumented" }),
  ];

  it("names the routes both channels have looked at", () => {
    expect(splitXeroChannels({ entities }).onBoth).toEqual(["GET both"]);
  });

  it("names the routes only the SDK declares", () => {
    expect(splitXeroChannels({ entities }).apiOnly).toEqual(["GET declared"]);
  });

  it("names the routes only the web client was seen calling — the undocumented surface", () => {
    expect(splitXeroChannels({ entities }).browserOnly).toEqual(["GET undocumented"]);
  });

  // A disagreement is an output, never a resolution: nothing here drops a row from either side.
  it("keeps every row somewhere, so no channel's evidence is discarded", () => {
    const split = splitXeroChannels({ entities });
    expect(split.onBoth.length + split.apiOnly.length + split.browserOnly.length).toBe(entities.length);
  });

  it("sorts each set, so a report is stable between runs", () => {
    const split = splitXeroChannels({
      entities: [method({ api: false, browser: true, id: "b" }), method({ api: false, browser: true, id: "a" })],
    });
    expect(split.browserOnly).toEqual(["a", "b"]);
  });
});

describe("summariseDisagreement", () => {
  it("leads with the total the atlas holds", () => {
    const lines = summariseDisagreement({ split: { apiOnly: ["a"], browserOnly: [], onBoth: ["b"] } });
    expect(lines[0]).toBe("xero surface corroboration — 2 method row(s) held");
  });

  it("prints no sample when nothing is browser-only, rather than an empty heading", () => {
    const lines = summariseDisagreement({ split: { apiOnly: ["a"], browserOnly: [], onBoth: [] } });
    expect(lines).toHaveLength(4);
  });

  it("bounds the sample it prints, so a report stays readable", () => {
    const browserOnly = Array.from({ length: 40 }, (_, index) => `GET route-${String(index)}`);
    const lines = summariseDisagreement({ split: { apiOnly: [], browserOnly, onBoth: [] } });
    expect(lines).toHaveLength(4 + 1 + XERO_DISAGREEMENT_SAMPLE);
  });

  it("says how many it is showing out of how many there are", () => {
    const browserOnly = Array.from({ length: 40 }, (_, index) => `GET route-${String(index)}`);
    const lines = summariseDisagreement({ split: { apiOnly: [], browserOnly, onBoth: [] } });
    expect(lines[4]).toBe("  the undocumented surface, first 12 of 40:");
  });
});
