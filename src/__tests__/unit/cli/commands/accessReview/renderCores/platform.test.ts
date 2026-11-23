/*
 * The `platformCore.ts` render surface of `access-review`: how one stored level prints, how one platform's section
 * prints as text, and what its JSON document carries — on a read, a half-written read, a degraded attempt and a
 * refusal.
 */
import { describe, expect, it } from "vitest";

import { ACCESS_LEVEL_TABLE } from "../../../../../../accessReview/levels.js";
import { platformSectionOf } from "../../../../../../accessReview/report.js";
import {
  ABSENT_MARK,
  platformSectionJson,
  renderLevel,
  renderPlatformSection,
} from "../../../../../../cli/commands/accessReview/platformCore.js";
import { kindView, snapshot } from "../../../../accessReview/fixtures.js";

import { READ_STAMP, reportOf } from "./harness.js";

const JUMPCLOUD = ACCESS_LEVEL_TABLE.find((spec) => spec.platform === "jumpcloud")!;

describe("renderLevel", () => {
  it("prints an absent field as the absent mark", () => {
    expect(renderLevel({ value: null })).toBe(ABSENT_MARK);
  });

  it("prints a stored empty string verbatim, never as absent nor as a stored null", () => {
    expect(renderLevel({ value: "" })).toBe("");
    expect(renderLevel({ value: "null" })).toBe("null");
  });

  it("prints a stored value verbatim", () => {
    expect(renderLevel({ value: "ACTIVATED" })).toBe("ACTIVATED");
  });
});

describe("renderPlatformSection", () => {
  it("heads the section with the counts, then one line per person", () => {
    const report = reportOf({
      people: [{ email: "Ann@X.test", role: null, state: "ACTIVATED" }],
      spells: [],
    });
    const lines = renderPlatformSection({ section: report.sections[0]! });
    expect(lines[0]).toBe(
      "JumpCloud (jumpcloud/systemusers) · 1 people · 0 records of another declared surface family · 0 carrying no readable address · 0 the last complete read no longer returned",
    );
    expect(lines[1]).toContain("Ann@X.test");
    expect(lines[1]).toContain("state=ACTIVATED");
    expect(lines[1]).toContain(`console role=${ABSENT_MARK}`);
  });

  it("prints the boundary under the rows", () => {
    const report = reportOf({ people: [{ email: "a@x.test", role: null, state: "ACTIVATED" }], spells: [] });
    const lines = renderPlatformSection({ section: report.sections[0]! });
    expect(lines).toContain("  read stamp · jumpcloud/systemusers last successful read 2026-09-06T00:00:00.000Z");
  });

  it("prints a refusal and nothing else when the atlas would not read", () => {
    const section = platformSectionOf({
      source: { platform: "jumpcloud", refusal: "generation unpublished", snapshot: null },
      spec: JUMPCLOUD,
    });
    expect(renderPlatformSection({ section })).toEqual(["JumpCloud (jumpcloud) · REFUSED", "  generation unpublished"]);
  });

  it("names a colliding address rather than only counting it", () => {
    const report = reportOf({
      people: [
        { email: "dup@x.test", role: null, state: "ACTIVATED" },
        { email: "dup@x.test", role: null, state: "SUSPENDED" },
      ],
      spells: [],
    });
    expect(renderPlatformSection({ section: report.sections[0]! })[1]).toBe(
      "  two or more records claimed one address: dup@x.test",
    );
  });
});

describe("platformSectionJson", () => {
  it("carries the rows, the stamp and the declared boundary", () => {
    const report = reportOf({ people: [{ email: "a@x.test", role: null, state: "ACTIVATED" }], spells: [] });
    const json = platformSectionJson({ section: report.sections[0]! });
    expect(json.platform).toBe("jumpcloud");
    expect(json.kind).toBe("systemusers");
    expect(json.readStampIso).toBe(READ_STAMP);
    expect(json.rows!.map((row) => row.email)).toEqual(["a@x.test"]);
    expect(json.refusal).toBe(null);
  });

  it("refuses a half-written read rather than reporting its short rows as the surface", () => {
    const section = platformSectionOf({
      source: {
        platform: "jumpcloud",
        refusal: null,
        snapshot: snapshot({
          kinds: [kindView({ entities: [], kind: "systemusers", lastSuccessAt: READ_STAMP, publishedCount: 179 })],
          platform: "jumpcloud",
        }),
      },
      spec: JUMPCLOUD,
    });
    const json = platformSectionJson({ section });
    expect(json.refusal).toBe(
      "jumpcloud/systemusers read back 0 records of the 179 the manifest vouches for, so the read is incomplete",
    );
    expect(json.rows).toBe(null);
    expect(json.readCount).toBe(null);
  });

  it("prints DEGRADED in the JSON boundary when the latest attempt failed after an earlier read", () => {
    const section = platformSectionOf({
      source: {
        platform: "jumpcloud",
        refusal: null,
        snapshot: snapshot({
          kinds: [
            kindView({ entities: [], kind: "systemusers", lastSuccessAt: READ_STAMP, latestAttemptFailed: true }),
          ],
          platform: "jumpcloud",
        }),
      },
      spec: JUMPCLOUD,
    });
    const json = platformSectionJson({ section });
    expect(json.latestAttemptFailed).toBe(true);
    expect(json.boundary).toContain("DEGRADED · the latest attempt on jumpcloud/systemusers FAILED");
  });

  it("nulls every measured field on a refusal, so nothing reads as a zero or an empty list", () => {
    const section = platformSectionOf({
      source: { platform: "jumpcloud", refusal: "store unreadable", snapshot: null },
      spec: JUMPCLOUD,
    });
    const json = platformSectionJson({ section });
    expect(json.refusal).toBe("store unreadable");
    expect(json.addressless).toBe(null);
    expect(json.otherFamily).toBe(null);
    expect(json.publishedCount).toBe(null);
    expect(json.readCount).toBe(null);
    expect(json.readStampIso).toBe(null);
    expect(json.rows).toBe(null);
    expect(json.collidingAddresses).toBe(null);
    expect(json.declaredBoundary).toBe(null);
    expect(json.boundary).toEqual(["read stamp · jumpcloud REFUSED — store unreadable"]);
  });
});
