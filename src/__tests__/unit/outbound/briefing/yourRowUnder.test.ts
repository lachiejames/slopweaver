import { describe, expect, it } from "vitest";

import type { BriefingYourRow } from "../../../../outbound/briefing/types.js";
import { renderUnderHeadline } from "../../../../outbound/briefing/yourRowUnder.js";

const ROW: BriefingYourRow = {
  closing: false,
  headline: [{ kind: "text", text: "review the monitors" }],
  identity: "slack:row-one",
  link: false,
  rank: 1,
  score: 3,
  whenIso: "2026-10-20T22:00:00.000Z",
  where: "https://example.slack.com/archives/channel-one/p1787708973446169",
  who: "Seth Tanner",
  why: "somebody asked you for a review",
};

/** A review ask's slice, with a path that would read as a pull-request number in prose. */
const SLICE = {
  additions: 1,
  deletions: 1,
  omittedPaths: 0,
  ownedFiles: 2,
  shownPaths: ["apps/ops/datadog/notificationChannels.ts", "docs/#123.md"],
  totalFiles: 30,
};

describe("renderUnderHeadline", () => {
  it("renders nothing for a row with neither a slice nor a title", () => {
    expect(renderUnderHeadline({ row: ROW })).toBe("");
  });

  it("renders each path of the slice as code, then the escaped title", () => {
    expect(renderUnderHeadline({ row: { ...ROW, codeOwnerSlice: SLICE, title: "Gifting V2 <monitors>" } })).toBe(
      '<div class="bg">Yours as code owner, by login: 2 of 30 files, +1 -1 lines, in ' +
        "<code>apps/ops/datadog/notificationChannels.ts</code> and <code>docs/#123.md</code></div>" +
        '<div class="bg">Gifting V2 &lt;monitors&gt;</div>',
    );
  });

  it("renders the title alone when the row carries no slice", () => {
    expect(renderUnderHeadline({ row: { ...ROW, title: "Gifting V2 monitors" } })).toBe(
      '<div class="bg">Gifting V2 monitors</div>',
    );
  });
});
