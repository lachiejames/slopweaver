import { describe, expect, it } from "vitest";

import { type AimShotResult, planAimShot } from "../../../../../browser/aimShot.js";
import type { PageObservation } from "../../../../../browser/interactionSession.js";
import { aimPageTrail, attributeAim } from "../../../../../cli/commands/browser/aimDocument.js";

const PAGE_A = "https://app.slack.com/client/T01/C02";
const PAGE_B = "https://example.invalid/elsewhere";

const look = ({ id, url }: { id: string; url: string }): PageObservation => ({
  id,
  observedAtIso: "2026-11-02T00:00:00.000Z",
  screenshotPath: `/tmp/session/look-${id}.png`,
  snapshotPath: `/tmp/session/observation-${id}.yml`,
  title: "a page",
  url,
});

const shot = ({ pictureUrls }: { pictureUrls: readonly (string | null)[] }): AimShotResult => ({
  focus: null,
  pictureUrls,
  plan: planAimShot({ fullPage: false, mark: "highlight", ref: "e1", stem: "/tmp/session/aim" }),
  scroll: null,
});

const ON_A = look({ id: "obs-1", url: PAGE_A });
const FILED_ON_A = look({ id: "obs-2", url: PAGE_A });
const FILED_ON_B = look({ id: "obs-2", url: PAGE_B });

describe("which page an aim's pictures belong to", () => {
  it("says nothing moved, and prints no note, when every look and picture was on one page", () => {
    const attributed = attributeAim({
      before: ON_A,
      elements: [],
      observation: FILED_ON_A,
      shot: shot({ pictureUrls: [PAGE_A, PAGE_A] }),
    });
    expect(attributed.picturesUrl).toBe(PAGE_A);
    expect(attributed.policy.provider).toBe("Slack");
    expect(attributed.notes).toEqual([]);
    expect(attributed.document["pageMoved"]).toBe(false);
    expect(attributed.document["pageTrail"]).toEqual([PAGE_A]);
    expect(attributed.document["picturesUnconfirmed"]).toBe(0);
  });

  it("credits the pictures to the page their replies named and names a move from the gating look before them", () => {
    const attributed = attributeAim({
      before: ON_A,
      elements: [],
      observation: FILED_ON_B,
      shot: shot({ pictureUrls: [PAGE_B, PAGE_B] }),
    });
    expect(attributed.picturesUrl).toBe(PAGE_B);
    expect(attributed.policy.provider).toBe(null);
    expect(attributed.document["pageMoved"]).toBe(true);
    expect(attributed.notes).toEqual([`  the page moved during the aim: ${PAGE_A} -> ${PAGE_B}`]);
  });

  it("names a move after the pictures, and carries the filed look, outline and policy in the JSON document", () => {
    const attributed = attributeAim({
      before: ON_A,
      elements: ["  outline line"],
      observation: FILED_ON_B,
      shot: shot({ pictureUrls: [PAGE_A, PAGE_A] }),
    });
    expect(attributed.document["picturesUrl"]).toBe(PAGE_A);
    expect(attributed.document["page"]).toEqual(FILED_ON_B);
    expect(attributed.document["pageTrail"]).toEqual([PAGE_A, PAGE_B]);
    expect(attributed.document["elements"]).toEqual(["  outline line"]);
    expect(attributed.document["policy"]).toEqual(attributed.policy);
  });

  it("calls a picture set split across two pages a move, even when the filed look is back where it began", () => {
    const attributed = attributeAim({
      before: ON_A,
      elements: [],
      observation: FILED_ON_A,
      shot: shot({ pictureUrls: [PAGE_A, PAGE_B] }),
    });
    expect(attributed.document["pageTrail"]).toEqual([PAGE_A, PAGE_B, PAGE_A]);
  });

  it("says a picture whose reply named no page is unconfirmed rather than borrowing a neighbour's page", () => {
    const attributed = attributeAim({
      before: ON_A,
      elements: [],
      observation: FILED_ON_A,
      shot: shot({ pictureUrls: [null, PAGE_A] }),
    });
    expect(attributed.picturesUrl).toBe(null);
    expect(attributed.document["picturesUnconfirmed"]).toBe(1);
    expect(attributed.notes).toEqual([
      "  unconfirmed: 1 picture(s) came back naming no page, so which page they show is not known",
    ]);
  });

  it("credits no page to the set when a LATER picture reply named none", () => {
    const attributed = attributeAim({
      before: ON_A,
      elements: [],
      observation: FILED_ON_A,
      shot: shot({ pictureUrls: [PAGE_A, null] }),
    });
    expect(attributed.picturesUrl).toBe(null);
    expect(attributed.document["picturesUrl"]).toBe(null);
    expect(attributed.document["picturesUnconfirmed"]).toBe(1);
  });

  it("never reports the gating look's page as the pictures' page when no picture reply named one", () => {
    const attributed = attributeAim({
      before: ON_A,
      elements: [],
      observation: FILED_ON_A,
      shot: shot({ pictureUrls: [null, null] }),
    });
    expect(attributed.picturesUrl).toBe(null);
    expect(attributed.document["picturesUrl"]).toBe(null);
    expect(attributed.document["gatedUrl"]).toBe(PAGE_A);
    expect(attributed.document["policyUrl"]).toBe(PAGE_A);
    expect(attributed.pageLabel).toBe(`${PAGE_A} (where the aim was gated; not every picture named its page)`);
    expect(attributed.document["picturesUnconfirmed"]).toBe(2);
  });
});

describe("the trail of pages an aim passed through", () => {
  it("keeps a return to an earlier page rather than collapsing it", () => {
    expect(aimPageTrail({ filedUrl: PAGE_A, gatedUrl: PAGE_A, pictureUrls: [PAGE_B] })).toEqual([
      PAGE_A,
      PAGE_B,
      PAGE_A,
    ]);
  });

  it("skips a picture that named no page without dropping the pages around it", () => {
    expect(aimPageTrail({ filedUrl: PAGE_B, gatedUrl: PAGE_A, pictureUrls: [null, PAGE_A] })).toEqual([PAGE_A, PAGE_B]);
  });
});
