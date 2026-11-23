/*
 * Where a citation chip goes, and what its hover card's footer offers. The chip goes to the first link, so a pull
 * request's first link being GitHub's own address is the rule: a GitHub chip opens the PR in
 * GitHub, the way a Slack chip opens the message in Slack.
 */

import { describe, expect, it } from "vitest";

import { citedSource, referenceHref } from "../../lib/citationDisplay";
import { type CitationFooterLink, citationFooterOf } from "../../lib/citationFooter";

const OPEN = { rel: "noreferrer", target: "_blank" } as const;

/** The footer exactly as the chip computes it, off an address reference. */
function footerFor({ url }: { url: string }): readonly CitationFooterLink[] {
  const reference = { kind: "address", url } as const;
  return citationFooterOf({ cited: citedSource({ reference }), href: referenceHref({ reference })! });
}

describe("citationFooterOf", () => {
  it("opens a pull request in GitHub first, then the console's view and its diff", () => {
    const pr = "https://github.com/lachiejames/slopweaver/pull/1545";
    expect(footerFor({ url: pr })).toEqual([
      { href: pr, opens: OPEN, words: "open it in GitHub" },
      { href: "/pull-requests/lachiejames/slopweaver/1545", opens: OPEN, words: "open it here" },
      { href: "/pull-requests/lachiejames/slopweaver/1545?tab=files", opens: OPEN, words: "open its diff here" },
    ]);
  });

  it("keeps a cited diff address as cited and offers no second console diff", () => {
    const files = "https://github.com/lachiejames/slopweaver/pull/1545/files#diff-abc";
    expect(footerFor({ url: files })).toEqual([
      { href: files, opens: OPEN, words: "open it in GitHub" },
      { href: "/pull-requests/lachiejames/slopweaver/1545?tab=files", opens: OPEN, words: "open it here" },
    ]);
  });

  it("opens a Slack message in Slack, alone", () => {
    const slack = "https://acme.slack.com/archives/C01/p1727400000000000";
    expect(footerFor({ url: slack })).toEqual([{ href: slack, opens: OPEN, words: "open it in Slack" }]);
  });

  it("offers GitHub's diff beside an address only prDiffUrl reads as a pull request", () => {
    const shaped = "https://github.com/lachiejames/slopweaver/pull/1234567890";
    expect(footerFor({ url: shaped })).toEqual([
      { href: shaped, opens: OPEN, words: "open it in GitHub" },
      { href: `${shaped}/files`, opens: OPEN, words: "open its diff" },
    ]);
  });

  it("opens a local page here, through the console's own route", () => {
    expect(footerFor({ url: "file:///Users/me/.slopweaver/pages/alpha/index.html" })).toEqual([
      { href: "/api/page/alpha/index.html", opens: OPEN, words: "open it here" },
    ]);
  });
});
