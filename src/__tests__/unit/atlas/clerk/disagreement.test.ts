/**
 * The corroboration output — where the two surfaces disagree, which `docs/atlas-intent/04-corroboration.md` makes a thing
 * the atlas SHOWS rather than a build-time check it discards.
 *
 * The parameter-shape reconciliation is what this file exists for. Its own §4 records the sibling Linear
 * atlas's lesson: its first run reported "disagreements" that were the comparison rather than the platform, and
 * a comparator that manufactures findings in an instrument built to find real ones is worse than none.
 */
import { describe, expect, it } from "vitest";

import {
  isParameterShapeTwin,
  splitClerkChannels,
  summariseClerkDisagreement,
} from "../../../../atlas/clerk/disagreement.js";
import type { ClerkAtlasEntity, ClerkChannelEntity } from "../../../../atlas/clerk/model.js";

const AT = "2026-09-05T11:00:00.000Z";

/** One channel's view, with only the field the split reads. */
function channel({ fields }: { fields: readonly string[] }): ClerkChannelEntity {
  return {
    channel: "compiled",
    detail: { responseFields: [...fields] },
    firstSeenAt: AT,
    lastSeenAt: AT,
    source: null,
    state: "observed",
  };
}

/** One stored operation row, carrying whichever channels a case needs. */
function entity({
  providerId,
  compiled,
  browser,
}: {
  providerId: string;
  compiled: readonly string[] | null;
  browser: readonly string[] | null;
}): ClerkAtlasEntity {
  return {
    channels: {
      api: null,
      browser: browser === null ? null : { ...channel({ fields: browser }), channel: "browser" },
      compiled: compiled === null ? null : channel({ fields: compiled }),
    },
    id: providerId,
    kind: "operation",
    providerId,
  };
}

describe("isParameterShapeTwin", () => {
  it("reads two spellings of one parameterised route as the same operation", () => {
    expect(isParameterShapeTwin({ left: "GET bapi:/v1/users/{user_id}", right: "GET bapi:/v1/users/{user}" })).toBe(
      true,
    );
  });

  it("keeps two genuinely different routes apart", () => {
    expect(isParameterShapeTwin({ left: "GET bapi:/v1/users/{user_id}", right: "GET bapi:/v1/clients/{id}" })).toBe(
      false,
    );
  });

  it("keeps the same path on two APIs apart, which is why the API is in the key", () => {
    expect(isParameterShapeTwin({ left: "GET bapi:/v1/api_keys", right: "GET fapi:/v1/api_keys" })).toBe(false);
  });

  it("keeps two methods on one path apart", () => {
    expect(isParameterShapeTwin({ left: "GET bapi:/v1/users", right: "POST bapi:/v1/users" })).toBe(false);
  });
});

describe("splitClerkChannels", () => {
  it("puts a row both channels saw on both surfaces", () => {
    const split = splitClerkChannels({
      entities: [entity({ browser: ["id"], compiled: ["id"], providerId: "GET fapi:/v1/environment" })],
    });
    expect(split.onBoth).toEqual(["GET fapi:/v1/environment"]);
    expect(split.declaredOnly).toEqual([]);
    expect(split.browserOnlyAll).toEqual([]);
  });

  it("reports a declared row the walk never saw as declared only", () => {
    const split = splitClerkChannels({
      entities: [entity({ browser: null, compiled: ["id"], providerId: "GET bapi:/v1/users" })],
    });
    expect(split.declaredOnly).toEqual(["GET bapi:/v1/users"]);
  });

  it("reports an observed row no document declares as browser only, keyed by its API", () => {
    const split = splitClerkChannels({
      entities: [entity({ browser: ["ok"], compiled: null, providerId: "GET dashboard:/v1/workspace_status" })],
    });
    expect(split.browserOnlyAll).toEqual(["GET dashboard:/v1/workspace_status"]);
    expect(split.browserOnly.dashboard).toEqual(["GET dashboard:/v1/workspace_status"]);
  });

  it("does NOT report a parameter-shape twin as two single-channel findings", () => {
    const split = splitClerkChannels({
      entities: [
        entity({ browser: null, compiled: ["id"], providerId: "GET bapi:/v1/users/{user_id}" }),
        entity({ browser: ["id"], compiled: null, providerId: "GET bapi:/v1/users/{user}" }),
      ],
    });
    expect(split.declaredOnly).toEqual([]);
    expect(split.browserOnlyAll).toEqual([]);
    expect(split.onBoth).toEqual(["GET bapi:/v1/users/{user_id}", "GET bapi:/v1/users/{user}"]);
  });

  it("names the response fields the browser saw that no document declares", () => {
    const split = splitClerkChannels({
      entities: [
        entity({
          browser: ["captcha_bypass", "id"],
          compiled: ["id"],
          providerId: "GET fapi:/v1/client",
        }),
      ],
    });
    expect(split.undeclaredFields).toEqual([{ fields: ["captcha_bypass"], providerId: "GET fapi:/v1/client" }]);
  });

  it("reports no field disagreement when the document declares everything the browser saw", () => {
    const split = splitClerkChannels({
      entities: [entity({ browser: ["id"], compiled: ["captcha_bypass", "id"], providerId: "GET fapi:/v1/client" })],
    });
    expect(split.undeclaredFields).toEqual([]);
  });
});

describe("summariseClerkDisagreement", () => {
  it("leads with the three counts over the rows held", () => {
    const lines = summariseClerkDisagreement({
      split: {
        browserOnly: { dashboard: ["GET dashboard:/v1/workspace_status"] },
        browserOnlyAll: ["GET dashboard:/v1/workspace_status"],
        declaredOnly: ["GET bapi:/v1/users"],
        onBoth: ["GET fapi:/v1/environment"],
        undeclaredFields: [],
      },
    });
    expect(lines[0]).toBe("clerk surface corroboration — 3 operation row(s) held");
    expect(lines[1]).toBe("  on both surfaces   1");
  });

  it("names the undocumented surface it found", () => {
    const lines = summariseClerkDisagreement({
      split: {
        browserOnly: { dashboard: ["GET dashboard:/v1/workspace_status"] },
        browserOnlyAll: ["GET dashboard:/v1/workspace_status"],
        declaredOnly: [],
        onBoth: [],
        undeclaredFields: [],
      },
    });
    expect(lines.join("\n")).toContain("GET dashboard:/v1/workspace_status");
  });
});
