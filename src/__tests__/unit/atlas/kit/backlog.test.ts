/**
 * The refused-exclusion backlog: what it collects, and the order the owner ruled it should be worked.
 *
 * Two halves, deliberately separated. The ORDERING is pure and is tested over hand-built rows, so the owner's
 * sequence is asserted as a sequence rather than as whatever the tree happens to carry today. The
 * COLLECTION is tested over the real descriptors, because a filter that quietly admitted a settled ground
 * would be invisible against fixtures.
 */
import { describe, expect, it } from "vitest";

import { DATADOG_ATLAS_DESCRIPTOR } from "../../../../atlas/datadog/descriptor.js";
import { GITHUB_ATLAS_DESCRIPTOR } from "../../../../atlas/github/descriptor.js";
import {
  ATLAS_BACKLOG_ORDER,
  type AtlasBacklogRow,
  namedPositionOf,
  orderAtlasBacklog,
  refusedRowsOf,
} from "../../../../atlas/kit/backlog.js";
import { atlasPlatforms, findAtlasPlatform } from "../../../../atlas/registry.js";

/** One row, so a caller states only what the assertion is about. */
function row({
  platform,
  ground = "not-fetched",
}: {
  platform: string;
  ground?: AtlasBacklogRow["ground"];
}): AtlasBacklogRow {
  return { because: `${platform} withholds something`, ground, platform, remedy: `go and get ${platform}'s` };
}

describe("the owner's atlas order", () => {
  it("names nine atlases, each one this build actually registers", () => {
    const known = atlasPlatforms();
    expect(ATLAS_BACKLOG_ORDER.length).toBe(9);
    expect(ATLAS_BACKLOG_ORDER.filter((platform) => !known.includes(platform))).toEqual([]);
  });

  it("places the atlases the owner named, in their sequence, and nothing else", () => {
    expect(namedPositionOf({ platform: "datadog" })).toBe(1);
    expect(namedPositionOf({ platform: "google-admin" })).toBe(9);
    expect(namedPositionOf({ platform: "xero" })).toBe(null);
  });
});

describe("ordering the register", () => {
  it("puts the owner's nine first in their sequence, even when an unnamed atlas carries more rows", () => {
    const ordered = orderAtlasBacklog({
      rows: [
        row({ platform: "xero" }),
        row({ platform: "xero", ground: "shape-index" }),
        row({ platform: "xero" }),
        row({ platform: "google-admin" }),
        row({ platform: "datadog" }),
      ],
    });
    expect(ordered.entries.map((entry) => entry.platform)).toEqual(["datadog", "google-admin", "xero"]);
    expect(ordered.entries.map((entry) => entry.namedPosition)).toEqual([1, 9, null]);
  });

  it("sorts the unnamed tail densest first, then by name, so two runs print the same list", () => {
    const ordered = orderAtlasBacklog({
      rows: [
        row({ platform: "twilio" }),
        row({ platform: "airtable" }),
        row({ platform: "xero" }),
        row({ platform: "xero" }),
      ],
    });
    expect(ordered.entries.map((entry) => entry.platform)).toEqual(["xero", "airtable", "twilio"]);
  });

  it("counts each ground, and names the atlases the owner asked for that are already clear", () => {
    const ordered = orderAtlasBacklog({
      rows: [row({ platform: "datadog" }), row({ platform: "datadog", ground: "shape-index" })],
    });
    expect(ordered.refusedCount).toBe(2);
    expect(ordered.notFetchedCount).toBe(1);
    expect(ordered.unmeasuredCount).toBe(1);
    expect(ordered.namedAndClear).toEqual([
      "vanta",
      "linear",
      "slack",
      "notion",
      "github",
      "cloudflare",
      "jumpcloud",
      "google-admin",
    ]);
  });

  it("is empty, and reports every named atlas clear, when nothing is refused", () => {
    const ordered = orderAtlasBacklog({ rows: [] });
    expect(ordered.entries).toEqual([]);
    expect(ordered.refusedCount).toBe(0);
    expect(ordered.namedAndClear).toEqual([...ATLAS_BACKLOG_ORDER]);
  });
});

describe("collecting one atlas's refused rows", () => {
  it("takes GitHub's single not-fetched row and the remedy its own ground carries", () => {
    const rows = refusedRowsOf({ descriptor: GITHUB_ATLAS_DESCRIPTOR, platform: "github" });
    expect(rows.length).toBe(1);
    expect(rows[0]!.ground).toBe("not-fetched");
    expect(rows[0]!.platform).toBe("github");
    expect(rows[0]!.because).toContain("code-scanning alerts");
    expect(rows[0]!.remedy).toContain("a kind that HOLDS them");
  });

  it("leaves Datadog's weighed shape-index row out, because a measured claim is not refused", () => {
    const rows = refusedRowsOf({ descriptor: DATADOG_ATLAS_DESCRIPTOR, platform: "datadog" });
    expect(rows.map((one) => one.ground)).toEqual(["not-fetched"]);
  });

  it("never admits the two grounds the owner's ruling let survive, nor any other settled ground", async () => {
    const grounds = new Set<string>();
    let seen = 0;
    for (const platform of atlasPlatforms()) {
      const registration = findAtlasPlatform({ platform })!;
      seen += 1;
      refusedRowsOf({ descriptor: await registration.readDescriptor(), platform }).forEach((one) => {
        grounds.add(one.ground);
      });
    }
    expect(seen).toBe(34);
    expect([...grounds].toSorted()).toEqual(["not-fetched", "shape-index"]);
  });
});
