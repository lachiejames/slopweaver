/**
 * A publish or up-to-date claim names where the owner goes to see it.
 */
import { describe, expect, it } from "vitest";

import {
  CONSOLE_SURFACES,
  publishClaimIssues,
  publishClaimRefusal,
  unpointedPublishClaim,
} from "../../../briefing/publishClaim.js";

describe("unpointedPublishClaim", () => {
  it("refuses the live recent block's own wording, which named no address", () => {
    expect(unpointedPublishClaim({ text: "6 probes repaired, the asks page republished, 9 asks left." })).toBe(
      "republished",
    );
  });

  it("refuses published, publishing and up to date alike", () => {
    expect(unpointedPublishClaim({ text: "Published the briefing." })).toBe("Published");
    expect(unpointedPublishClaim({ text: "Publishing the queue now." })).toBe("Publishing");
    expect(unpointedPublishClaim({ text: "The workstreams are up to date." })).toBe("up to date");
    expect(unpointedPublishClaim({ text: "The board is up-to-date." })).toBe("up-to-date");
  });

  it("passes a claim carrying the console URL", () => {
    expect(unpointedPublishClaim({ text: "The queue republished: http://localhost:3000/queue" })).toBeUndefined();
  });

  it("passes a claim carrying a file path or a file URL", () => {
    expect(
      unpointedPublishClaim({ text: "Published at ~/.slopweaver/pages/value/index.html for your pick." }),
    ).toBeUndefined();
    expect(unpointedPublishClaim({ text: "Published (/Users/x/.slopweaver/pages/a/index.html)." })).toBeUndefined();
    expect(unpointedPublishClaim({ text: "Published file:///tmp/a.html now." })).toBeUndefined();
  });

  it("passes a claim carrying another URL, a permalink included", () => {
    expect(
      unpointedPublishClaim({ text: "The answer published in-thread: https://acme.slack.com/archives/C1/p1" }),
    ).toBeUndefined();
  });

  it("leaves a line with no claim alone, and does not read unpublished as one", () => {
    expect(unpointedPublishClaim({ text: "The listener is back up on arm 2590fb24." })).toBeUndefined();
    expect(unpointedPublishClaim({ text: "The draft stays unpublished until their pick." })).toBeUndefined();
    expect(
      unpointedPublishClaim({ text: "The claude.ai copy is retired and no chair publishes there again." }),
    ).toBeUndefined();
  });

  it("does not take a relative path or a date for a pointer", () => {
    expect(unpointedPublishClaim({ text: "Published skills/supervisor on 23/09." })).toBe("Published");
  });
});

describe("publishClaimIssues", () => {
  it("reads the lede and every recent headline, with a link run counted through its URL", () => {
    const issues = publishClaimIssues({
      lede: [{ kind: "text", text: "Every row is up to date." }],
      recent: [
        { headline: [{ kind: "text", text: "Nothing moved." }] },
        {
          headline: [
            { kind: "text", text: "The queue republished at " },
            { kind: "link", text: "the queue", url: "http://localhost:3000/queue" },
          ],
        },
        { headline: [{ kind: "text", text: "Page 136d969f published." }] },
      ],
    });

    expect(issues).toEqual([
      { message: publishClaimRefusal({ claim: "up to date" }), path: ["header", "lede"] },
      { message: publishClaimRefusal({ claim: "published" }), path: ["recent", 2, "headline"] },
    ]);
  });
});

describe("publishClaimRefusal", () => {
  it("names the claim and every console surface", () => {
    expect(CONSOLE_SURFACES.length).toBeGreaterThan(0);
    expect(publishClaimRefusal({ claim: "published" })).toBe(
      'the line says "published" and never says where the owner goes to see it. ' +
        "Name the exact URL — http://localhost:3000/queue, http://localhost:3000/pull-requests, " +
        "http://localhost:3000/workstreams, http://localhost:3000/fleet, " +
        "http://localhost:3000/alignment — or the file path when the surface is not on the console, and say what " +
        "moved rather than a page hash.",
    );
  });
});
