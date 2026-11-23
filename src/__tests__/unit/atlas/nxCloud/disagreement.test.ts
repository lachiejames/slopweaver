import { describe, expect, it } from "vitest";

import { nxCloudCorroboration, nxCloudDisagreements } from "../../../../atlas/nxCloud/disagreement.js";
import type { NxCloudAtlasEntity, NxCloudChannelEntity } from "../../../../atlas/nxCloud/model.js";

const AT = "2026-09-05T00:00:00.000Z";

/** One channel record carrying a detail with the named field lists. */
function channel({
  fields = [],
  params = [],
  state = "observed",
}: {
  fields?: readonly string[];
  params?: readonly string[];
  state?: "observed" | "stale";
}): NxCloudChannelEntity {
  return {
    channel: "web-data",
    detail: { queryParams: [...params], responseFields: [...fields] },
    firstSeenAt: AT,
    lastSeenAt: AT,
    source: null,
    state,
  };
}

/** One endpoint entity with whichever channels the caller supplies. */
function endpoint({
  providerId,
  web = null,
  browser = null,
}: {
  providerId: string;
  web?: NxCloudChannelEntity | null;
  browser?: NxCloudChannelEntity | null;
}): NxCloudAtlasEntity {
  return {
    channels: { browser, "web-data": web },
    id: providerId,
    kind: "endpoint",
    providerId,
    scope: "platform",
  };
}

describe("nxCloudDisagreements", () => {
  it("reports an operation only one channel holds", () => {
    const rows = nxCloudDisagreements({ entities: [endpoint({ providerId: "GET /a", web: channel({}) })] });
    expect(rows[0]!.heldBy).toEqual(["web-data"]);
  });

  it("reads a channel that never looked as holding no names, so every name the other holds is one-sided", () => {
    const rows = nxCloudDisagreements({
      entities: [endpoint({ providerId: "GET /a", web: channel({ fields: ["b", "a"], params: ["q"] }) })],
    });
    expect(rows).toEqual([
      {
        browserOnlyFields: [],
        browserOnlyParams: [],
        heldBy: ["web-data"],
        providerId: "GET /a",
        webDataOnlyFields: ["a", "b"],
      },
    ]);
  });

  it("reports nothing when both channels hold an operation with identical detail", () => {
    const same = endpoint({
      browser: channel({ fields: ["a"] }),
      providerId: "GET /a",
      web: channel({ fields: ["a"] }),
    });
    expect(nxCloudDisagreements({ entities: [same] })).toEqual([]);
  });

  it("names the fields only the rendered client saw", () => {
    const differing = endpoint({
      browser: channel({ fields: ["a", "b"] }),
      providerId: "GET /a",
      web: channel({ fields: ["a"] }),
    });
    expect(nxCloudDisagreements({ entities: [differing] })[0]!.browserOnlyFields).toEqual(["b"]);
  });

  it("names the fields only the direct read saw", () => {
    const differing = endpoint({
      browser: channel({ fields: ["a"] }),
      providerId: "GET /a",
      web: channel({ fields: ["a", "c"] }),
    });
    expect(nxCloudDisagreements({ entities: [differing] })[0]!.webDataOnlyFields).toEqual(["c"]);
  });

  it("names a parameter only the rendered client sent", () => {
    const differing = endpoint({
      browser: channel({ params: ["branch"] }),
      providerId: "GET /a",
      web: channel({ params: [] }),
    });
    expect(nxCloudDisagreements({ entities: [differing] })[0]!.browserOnlyParams).toEqual(["branch"]);
  });

  it("ignores a STALE channel, so a retired endpoint is not reported as a live one-sided finding", () => {
    const retired = endpoint({ providerId: "GET /old", web: channel({ state: "stale" }) });
    expect(nxCloudDisagreements({ entities: [retired] })).toEqual([]);
  });

  it("ignores an entity of another kind entirely", () => {
    const route: NxCloudAtlasEntity = {
      channels: { browser: channel({}), "web-data": null },
      id: "r",
      kind: "route",
      providerId: "/orgs",
      scope: "w",
    };
    expect(nxCloudDisagreements({ entities: [route] })).toEqual([]);
  });

  it("sorts by operation, so two reports over one generation read the same", () => {
    const rows = nxCloudDisagreements({
      entities: [
        endpoint({ providerId: "GET /z", web: channel({}) }),
        endpoint({ providerId: "GET /a", web: channel({}) }),
      ],
    });
    expect(rows.map((row) => row.providerId)).toEqual(["GET /a", "GET /z"]);
  });
});

describe("nxCloudCorroboration", () => {
  it("counts an operation both channels observed", () => {
    const both = endpoint({
      browser: channel({ fields: ["a"] }),
      providerId: "GET /a",
      web: channel({ fields: ["a"] }),
    });
    expect(nxCloudCorroboration({ entities: [both] }).bothChannels).toBe(1);
  });

  it("counts one-sided operations per channel", () => {
    const counts = nxCloudCorroboration({
      entities: [
        endpoint({ providerId: "GET /a", web: channel({}) }),
        endpoint({ browser: channel({}), providerId: "GET /b" }),
      ],
    });
    expect([counts.webDataOnly, counts.browserOnly]).toEqual([1, 1]);
  });

  it("counts operations both hold that nonetheless differ", () => {
    const differing = endpoint({
      browser: channel({ fields: ["a", "b"] }),
      providerId: "GET /a",
      web: channel({ fields: ["a"] }),
    });
    expect(nxCloudCorroboration({ entities: [differing] }).differingDetail).toBe(1);
  });
});
