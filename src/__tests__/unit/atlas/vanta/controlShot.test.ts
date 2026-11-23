import { describe, expect, it } from "vitest";

import { vantaControlSurface } from "../../../../atlas/vanta/browserPages.js";
import type { VantaPageObservation } from "../../../../atlas/vanta/browserWalk.js";
import {
  pairControlObservations,
  type ResolvedVantaControl,
  resolveVantaControlIds,
  shotControlEntity,
  shotPageEntity,
  type VantaControlLookupRow,
  vantaControlLookup,
  vantaControlPages,
} from "../../../../atlas/vanta/controlShot.js";
import { VantaControlShotErrors } from "../../../../atlas/vanta/controlShotErrors.js";
import type { VantaEntity } from "../../../../atlas/vanta/model.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const AT = "2026-09-07T10:00:00.000Z";

/** The three real pairings this atlas holds, which is why an id may not be taken at face value. */
const ROWS: readonly VantaControlLookupRow[] = [
  { externalId: "DCH-108", name: "Data classified", providerId: "0syn0001" },
  { externalId: "HRS-52", name: "Background checks", providerId: "0syn0002" },
  { externalId: "CRY-56", name: "Data encrypted", providerId: "data-encrypted-gdpr" },
];

const storedControl = ({ providerId, externalId }: { providerId: string; externalId: string }): VantaEntity => ({
  channels: {
    browser: null,
    "manage-api": {
      channel: "manage-api",
      detail: { externalId, name: `control ${externalId}` },
      firstSeenAt: AT,
      lastSeenAt: AT,
      source: {
        artifacts: [],
        channel: "manage-api",
        deepLink: null,
        deepLinkStatus: "unavailable",
        endpoint: "/controls",
        observedAt: AT,
      },
      state: "observed",
    },
  },
  financialDetail: null,
  id: `id-${providerId}`,
  kind: "control",
  providerId,
  sensitivity: null,
});

const held = ({ providerId }: { providerId: string }): VantaPageObservation => ({
  artifacts: [
    {
      byteLength: 95_000,
      kind: "page-png",
      mediaType: "image/png",
      relativePath: `artifacts/pages/${providerId}.png`,
      sha256: "a".repeat(64),
    },
  ],
  attempted: true,
  calls: [],
  captureComplete: true,
  finalUrl: `https://app.vanta.com/c/acme/controls?controlId=${providerId}`,
  observedAt: AT,
  redirected: false,
  requestedUrl: `https://app.vanta.com/c/acme/controls?controlId=${providerId}`,
  responseAccounting: { bodyFailed: 0, bodySucceeded: 3, eligible: 3, seen: 200 },
  screenshotMissingBecause: null,
  statusCode: 200,
  surface: vantaControlSurface({ providerId }),
  title: "Controls - Vanta",
  unreachableBecause: null,
});

describe("vantaControlLookup", () => {
  it("reads the external id and name off the manage-api channel's detail", () => {
    const rows = vantaControlLookup({
      entities: [storedControl({ externalId: "DCH-108", providerId: "0syn0001" })],
    });
    expect(rows).toEqual([{ externalId: "DCH-108", name: "control DCH-108", providerId: "0syn0001" }]);
  });

  it("still contributes the provider id when a control's detail is not a record at all", () => {
    const entity = storedControl({ externalId: "DCH-108", providerId: "0syn0001" });
    const rows = vantaControlLookup({
      entities: [{ ...entity, channels: { ...entity.channels, "manage-api": null } }],
    });
    expect(rows).toEqual([{ externalId: null, name: null, providerId: "0syn0001" }]);
  });
});

describe("resolveVantaControlIds", () => {
  it("places an external id on the provider id the URL actually needs", () => {
    const resolved = unwrap(resolveVantaControlIds({ asked: ["DCH-108"], rows: ROWS }));
    expect(resolved.map((one) => one.providerId)).toEqual(["0syn0001"]);
    expect(resolved[0]!.asked).toBe("DCH-108");
  });

  it("places a provider id given directly, and matches either form case-insensitively", () => {
    const resolved = unwrap(resolveVantaControlIds({ asked: ["0syn0002", "hrs-52"], rows: ROWS }));
    expect(resolved.map((one) => one.providerId)).toEqual(["0syn0002"]);
  });

  it("collapses two ids that name one control, so its own picture is not read as a duplicate", () => {
    const resolved = unwrap(resolveVantaControlIds({ asked: ["DCH-108", "0syn0001"], rows: ROWS }));
    expect(resolved.length).toBe(1);
  });

  it("refuses an id it cannot place rather than building a URL that photographs another control", () => {
    const refused = resolveVantaControlIds({ asked: ["DCH-108", "NOPE-1"], rows: ROWS });
    expect(refused.isErr()).toBe(true);
    expect(unwrapErr(refused).code).toBe("CONTROL_NOT_PLACED");
  });

  it("names exactly the ids it could not place, and not the one it could", () => {
    const refused = resolveVantaControlIds({ asked: ["DCH-108", "NOPE-1"], rows: ROWS });
    expect(unwrapErr(refused)).toEqual(VantaControlShotErrors.notPlaced({ unplaced: ["NOPE-1"] }));
  });

  it("refuses when the atlas holds no controls, naming the sync that would fix it", () => {
    const refused = resolveVantaControlIds({ asked: ["DCH-108"], rows: [] });
    expect(unwrapErr(refused).code).toBe("ATLAS_HOLDS_NO_CONTROLS");
    expect(unwrapErr(refused).message).toContain("run: slopweaver atlas vanta sync");
  });

  it("refuses an empty request", () => {
    const refused = resolveVantaControlIds({ asked: [], rows: ROWS });
    expect(unwrapErr(refused).code).toBe("NO_CONTROL_ASKED");
    expect(unwrapErr(refused).message).toContain("--control names at least one control");
  });
});

describe("vantaControlPages", () => {
  it("addresses each control by its provider id, on a non-empty query the client cannot override", () => {
    const pages = vantaControlPages({
      controls: [{ asked: "DCH-108", externalId: "DCH-108", name: null, providerId: "0syn0001" }],
    });
    expect(pages).toEqual([
      {
        description: "the control view for 0syn0001",
        path: "controls",
        query: { controlId: "0syn0001" },
        surface: "control:0syn0001",
      },
    ]);
  });
});

describe("pairControlObservations", () => {
  const control: ResolvedVantaControl = {
    asked: "DCH-108",
    externalId: "DCH-108",
    name: "Data classified",
    providerId: "0syn0001",
  };

  it("pairs by surface name, never by position, so one control's picture cannot land on another's id", () => {
    const paired = pairControlObservations({
      controls: [control, { ...control, externalId: "HRS-52", providerId: "0syn0002" }],
      pages: [held({ providerId: "0syn0002" }), held({ providerId: "0syn0001" })],
    });
    expect(paired.held.map(({ control: one, page }) => [one.providerId, page.surface])).toEqual([
      ["0syn0001", "control:0syn0001"],
      ["0syn0002", "control:0syn0002"],
    ]);
  });

  it("reports a control whose page carries no picture as unheld, with the walk's own reason", () => {
    const page = held({ providerId: "0syn0001" });
    const paired = pairControlObservations({
      controls: [control],
      pages: [{ ...page, artifacts: [], screenshotMissingBecause: "the browser returned no screenshot" }],
    });
    expect(paired.held).toEqual([]);
    expect(paired.unheld).toEqual([{ because: "the browser returned no screenshot", control }]);
  });

  it("reports a control the walk returned no row for at all, rather than passing over it in silence", () => {
    const paired = pairControlObservations({ controls: [control], pages: [] });
    expect(paired.unheld[0]!.because).toBe("the walk returned no row for this control's page");
  });
});

describe("shotControlEntity", () => {
  it("records the address it actually reached as a browser-discovered deep link, with the picture beside it", () => {
    const entity = shotControlEntity({
      at: AT,
      control: { asked: "DCH-108", externalId: "DCH-108", name: "Data classified", providerId: "0syn0001" },
      page: held({ providerId: "0syn0001" }),
    });
    expect(entity.kind).toBe("control");
    expect(entity.providerId).toBe("0syn0001");
    expect(entity.channels["manage-api"]).toBe(null);
    expect(entity.channels.browser!.source!.deepLink).toBe("https://app.vanta.com/c/acme/controls?controlId=0syn0001");
    expect(entity.channels.browser!.source!.deepLinkStatus).toBe("browser-discovered");
    expect(entity.channels.browser!.source!.artifacts.length).toBe(1);
  });

  it("carries no source at all for a page nobody reached, rather than an empty instant the schema refuses", () => {
    const page = held({ providerId: "0syn0001" });
    const entity = shotPageEntity({
      at: AT,
      page: { ...page, artifacts: [], finalUrl: "", observedAt: "", unreachableBecause: "never asked for" },
    });
    expect(entity.channels.browser!.source).toBe(null);
    expect(entity.channels.browser!.firstSeenAt).toBe(AT);
  });
});
