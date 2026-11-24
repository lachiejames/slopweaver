import { describe, expect, it } from "vitest";

import { LOCAL_PAGE_GLYPH, NEW_TAB_PAGES, OTHER_PAGE_GLYPH, TAB_PAGES, tabIcon } from "../../src/tabPages";

describe("tabIcon", () => {
  it("gives a tab its section's sidebar glyph, a page under the section included", () => {
    expect(tabIcon({ path: "/queue" })).toBe("☰");
    expect(tabIcon({ path: "/queue?open=ask%3Aa&context=work" })).toBe("☰");
    expect(tabIcon({ path: "/queue/mail/a/b" })).toBe("☰");
    expect(tabIcon({ path: "/pull-requests/acme/app/12?tab=files" })).toBe("⇄");
    expect(tabIcon({ path: "/fleet/session/0f1e2d3c-0000-4000-8000-000000000000" })).toBe("◎");
    expect(tabIcon({ path: "/alignment#steers" })).toBe("◇");
    expect(tabIcon({ path: "/store" })).toBe("▦");
  });

  it("gives a page in the viewer the glyph of what it frames", () => {
    expect(tabIcon({ path: "/view?src=%2Fapi%2Fpage%2Fweekly-briefing%2Findex.html" })).toBe(LOCAL_PAGE_GLYPH);
    expect(tabIcon({ path: "/view?src=%2Fdocs%2Fmodel&from=%2Fqueue" })).toBe("¶");
    expect(tabIcon({ path: "/view" })).toBe(LOCAL_PAGE_GLYPH);
  });

  it("gives every other page the neutral ring, never a section's glyph by a shared prefix", () => {
    expect(tabIcon({ path: "/fleetx" })).toBe(OTHER_PAGE_GLYPH);
    expect(tabIcon({ path: "/" })).toBe(OTHER_PAGE_GLYPH);
    expect(tabIcon({ path: "/talk" })).toBe(OTHER_PAGE_GLYPH);
  });
});

describe("NEW_TAB_PAGES", () => {
  it("offers every sidebar page but the Queue, which has one tab, in the sidebar's order", () => {
    expect(TAB_PAGES.length).toBeGreaterThan(0);
    expect(NEW_TAB_PAGES.map((page) => page.label)).toEqual([
      "Alignment",
      "Pull requests",
      "Workstreams",
      "Automations",
      "Fleet",
      "Store",
      "Docs",
    ]);
  });
});
