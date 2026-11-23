/**
 * The words a card's link reads as (`site/lib/cardLinks.ts`): "thread in dev-alerts", never "the thread in
 * dev-alerts", and never a raw URL.
 */
import { describe, expect, it } from "vitest";

import { cardLinkLabel } from "../../lib/cardLinks";

const THREAD = "https://acme.slack.com/archives/C0123/p1759530000000100";

describe("cardLinkLabel", () => {
  it("drops the article and the channel's # from a thread label", () => {
    expect(cardLinkLabel({ label: "the thread in #dev-alerts", url: THREAD })).toBe("thread in dev-alerts");
  });

  it("leaves a label with neither as it was", () => {
    expect(cardLinkLabel({ label: "SUP-9297 thread in proj-monitoring", url: THREAD })).toBe(
      "SUP-9297 thread in proj-monitoring",
    );
  });

  it("names the place an address points at where the label is itself the address, or empty", () => {
    expect(
      ["https://github.com/lachiejames/slopweaver/pull/1811", "  "].map((label) =>
        cardLinkLabel({ label, url: "https://github.com/lachiejames/slopweaver/pull/1811" }),
      ),
    ).toEqual(["lachiejames/slopweaver #1811", "lachiejames/slopweaver #1811"]);
  });

  it("names a site with no integration by its host, never its path", () => {
    expect(cardLinkLabel({ label: "www.example.com/a/b?c=1", url: "https://www.example.com/a/b?c=1" })).toBe(
      "example.com",
    );
  });
});
