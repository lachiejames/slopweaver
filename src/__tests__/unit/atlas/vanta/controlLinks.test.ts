import { describe, expect, it } from "vitest";

import { vantaControlPage, vantaPageUrl } from "../../../../atlas/vanta/browserPages.js";
import { controlLabel, vantaControlRefs, vantaControlUrl } from "../../../../atlas/vanta/controlLinks.js";
import type { VantaEntity } from "../../../../atlas/vanta/model.js";

/** One control entity, as the atlas stores it — only the fields this table reads actually vary. */
function control({ externalId, providerId }: { externalId: string | null; providerId: string }): VantaEntity {
  return {
    channels: {
      browser: null,
      "manage-api": {
        channel: "manage-api",
        detail: externalId === null ? { name: "unnamed" } : { externalId, name: "a control" },
        firstSeenAt: "2026-09-06T10:09:02.484Z",
        lastSeenAt: "2026-09-06T10:09:02.484Z",
        source: {
          artifacts: [],
          channel: "manage-api",
          deepLink: null,
          deepLinkStatus: "unavailable",
          endpoint: "/controls",
          observedAt: "2026-09-06T10:09:02.484Z",
        },
        state: "observed",
      },
    },
    financialDetail: null,
    id: `entity-${providerId}`,
    kind: "control",
    providerId,
    sensitivity: null,
  };
}

describe("vantaControlUrl", () => {
  it("addresses a control by its PROVIDER id, as a query parameter", () => {
    expect(vantaControlUrl({ providerId: "0syn0001", tenantSlug: "acme" })).toBe(
      "https://app.vanta.com/c/acme/controls?controlId=0syn0001",
    );
  });

  it("escapes a provider id that would otherwise change the query", () => {
    expect(vantaControlUrl({ providerId: "a&b=c", tenantSlug: "acme" })).toBe(
      "https://app.vanta.com/c/acme/controls?controlId=a%26b%3Dc",
    );
  });
});

describe("vantaControlRefs", () => {
  it("keys on the printed id while addressing the provider id — the two are unrelated", () => {
    expect(
      vantaControlRefs({
        entities: [control({ externalId: "DCH-108", providerId: "0syn0001" })],
        tenantSlug: "acme",
      }),
    ).toEqual([{ id: "DCH-108", url: "https://app.vanta.com/c/acme/controls?controlId=0syn0001" }]);
  });

  it("still RECOGNISES every control when no tenant slug resolved, with a null url", () => {
    expect(
      vantaControlRefs({
        entities: [control({ externalId: "HRS-52", providerId: "0syn0002" })],
        tenantSlug: null,
      }),
    ).toEqual([{ id: "HRS-52", url: null }]);
  });

  it("drops a control with no printed id rather than inventing a key", () => {
    expect(
      vantaControlRefs({
        entities: [
          control({ externalId: null, providerId: "nameless" }),
          control({ externalId: "BCD-69", providerId: "0syn0003" }),
        ],
        tenantSlug: "acme",
      }),
    ).toEqual([{ id: "BCD-69", url: "https://app.vanta.com/c/acme/controls?controlId=0syn0003" }]);
  });

  it("holds nothing when the atlas holds no controls", () => {
    expect(vantaControlRefs({ entities: [], tenantSlug: "acme" })).toEqual([]);
  });
});

describe("vantaControlUrl and the page the shot navigates to", () => {
  it("spells one address, so a citation and the capture that proves it cannot drift", () => {
    // The citation builder and the walk reach the same control by different routes — a slug the operator
    // supplied, and a tenant root learned from a redirect — so the assertion is that both land on the same
    // string for the same control.
    const cited = vantaControlUrl({ providerId: "0syn0001", tenantSlug: "acme" });
    const walked = vantaPageUrl({
      page: vantaControlPage({ providerId: "0syn0001" }),
      tenantRoot: "https://app.vanta.com/c/acme",
    });
    expect(cited).toBe(walked);
    expect(cited).toBe("https://app.vanta.com/c/acme/controls?controlId=0syn0001");
  });

  it("omits the status filter the client appends, so a citation lands on the whole list", () => {
    expect(vantaControlUrl({ providerId: "data-encrypted-gdpr", tenantSlug: "acme" })).not.toContain("status=");
  });
});

describe("controlLabel", () => {
  it("prints the id Vanta shows a reader", () => {
    expect(controlLabel({ control: { externalId: "DCH-108", providerId: "0syn0001" } })).toBe("DCH-108");
  });

  it("names a control Vanta assigned no printed id by the id it is addressed by", () => {
    expect(controlLabel({ control: { externalId: null, providerId: "0syn0001" } })).toBe("0syn0001");
  });

  it("keeps a printed id that is the empty string, since only an unassigned one is absent", () => {
    expect(controlLabel({ control: { externalId: "", providerId: "0syn0001" } })).toBe("");
  });
});
