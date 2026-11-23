import { describe, expect, it } from "vitest";

import {
  emptyTwilioKindFile,
  type TwilioAtlasEntity,
  type TwilioAtlasKindFile,
} from "../../../../atlas/twilio/model.js";
import { reportTwilioDisagreements } from "../../../../atlas/twilio/report.js";

/** One method entity carrying whichever channels a test needs. */
function entity({
  providerId,
  specFields,
  browserFields,
}: {
  providerId: string;
  specFields: readonly string[] | null;
  browserFields: readonly string[] | null;
}): TwilioAtlasEntity {
  const channel = ({ fields }: { fields: readonly string[] }) => ({
    channel: "api" as const,
    detail: { responseFields: [...fields] },
    firstSeenAt: "2026-09-05T00:00:00.000Z",
    lastSeenAt: "2026-09-05T00:00:00.000Z",
    source: null,
    state: "observed" as const,
  });
  return {
    channels: {
      api: specFields === null ? null : channel({ fields: specFields }),
      browser: browserFields === null ? null : { ...channel({ fields: browserFields }), channel: "browser" as const },
    },
    id: providerId,
    kind: "method",
    providerId,
  };
}

/** A method kind file holding exactly these entities. */
function methods({ entities }: { entities: readonly TwilioAtlasEntity[] }): TwilioAtlasKindFile {
  return { ...emptyTwilioKindFile({ kind: "method", updatedAt: "2026-09-05T00:00:00.000Z" }), entities: [...entities] };
}

describe("where Twilio's two surfaces disagree", () => {
  // Reporting 1,395 spec-declared operations as browser-absent would be technically true and a lie about
  // what was measured.
  it("finds nothing when the browser channel has never looked, and says why", () => {
    const report = reportTwilioDisagreements({
      methods: methods({
        entities: [entity({ browserFields: null, providerId: "GET /v1/Services", specFields: ["sid"] })],
      }),
    });

    expect(report.disagreements).toEqual([]);
    expect(report.specKnown).toBe(1);
    expect(report.browserKnown).toBe(0);
    expect(report.unmeasurableBecause).toContain("the browser channel holds no operation at all");
  });

  it("finds nothing at all over a store that holds no method file", () => {
    const report = reportTwilioDisagreements({ methods: null });

    expect(report.specKnown).toBe(0);
    expect(report.browserKnown).toBe(0);
    expect(report.disagreements).toEqual([]);
  });

  // The class the both-surfaces ruling exists for: things reachable in the browser and not via the API.
  it("reports an operation only the console calls as browser-only", () => {
    const report = reportTwilioDisagreements({
      methods: methods({
        entities: [
          entity({ browserFields: ["items"], providerId: "GET /console/internal/summary", specFields: null }),
          entity({ browserFields: ["sid"], providerId: "GET /v1/Services", specFields: ["sid"] }),
        ],
      }),
    });

    expect(report.disagreements[0]!.kind).toBe("browser-only");
    expect(report.disagreements[0]!.providerId).toBe("GET /console/internal/summary");
  });

  it("reports an operation the console never called as spec-only", () => {
    const report = reportTwilioDisagreements({
      methods: methods({
        entities: [
          entity({ browserFields: ["sid"], providerId: "GET /v1/Services", specFields: ["sid"] }),
          entity({ browserFields: null, providerId: "GET /v1/Brands", specFields: ["sid"] }),
        ],
      }),
    });

    const found = report.disagreements.find((row) => row.providerId === "GET /v1/Brands")!;
    expect(found.kind).toBe("spec-only");
  });

  // The sharpest of the three, and the one a single-surface atlas cannot produce at all.
  it("names the fields when both surfaces know an operation and disagree about its shape", () => {
    const report = reportTwilioDisagreements({
      methods: methods({
        entities: [
          entity({
            browserFields: ["sid", "undocumented_flag"],
            providerId: "GET /v1/Services",
            specFields: ["date_created", "sid"],
          }),
        ],
      }),
    });

    expect(report.disagreements.length).toBe(1);
    expect(report.disagreements[0]!.kind).toBe("field-divergence");
    expect([...report.disagreements[0]!.fields]).toEqual(["date_created", "undocumented_flag"]);
  });

  it("reports nothing for an operation both surfaces agree about", () => {
    const report = reportTwilioDisagreements({
      methods: methods({
        entities: [entity({ browserFields: ["sid"], providerId: "GET /v1/Services", specFields: ["sid"] })],
      }),
    });

    expect(report.disagreements).toEqual([]);
    expect(report.unmeasurableBecause).toBe(null);
  });

  // It collects instances and stops — which surface wins is the owner's call, reserved until they can see real ones.
  it("orders browser-only first, because that is the class a reader acts on", () => {
    const report = reportTwilioDisagreements({
      methods: methods({
        entities: [
          entity({ browserFields: null, providerId: "GET /v1/Brands", specFields: ["sid"] }),
          entity({ browserFields: ["x"], providerId: "GET /console/internal/x", specFields: null }),
          entity({ browserFields: ["a"], providerId: "GET /v1/Services", specFields: ["b"] }),
        ],
      }),
    });

    expect(report.disagreements.map((row) => row.kind)).toEqual(["browser-only", "field-divergence", "spec-only"]);
  });
});
