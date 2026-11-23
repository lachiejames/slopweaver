/**
 * The in-app viewer's address read back as untrusted: it frames only a bare document on this console, and its back
 * control only ever returns to a console page — the card when one was open.
 */
import { readdirSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { CONSOLE_PAGES, frameSandbox, VIEW_PATH, viewBack, viewedDocument, viewedPageSlug } from "../../lib/inAppView";

describe("viewedPageSlug", () => {
  it("names the page when the viewer frames exactly its own index.html", () => {
    expect(viewedPageSlug({ shown: "/api/page/pir-briefing/index.html" })).toBe("pir-briefing");
    expect(viewedPageSlug({ shown: "/api/page/a.b_c-9/index.html" })).toBe("a.b_c-9");
  });

  it("takes a slug at the grammar's longest, and refuses one past it", () => {
    const longest = `a${"b".repeat(127)}`;
    expect(viewedPageSlug({ shown: `/api/page/${longest}/index.html` })).toBe(longest);
    expect(viewedPageSlug({ shown: `/api/page/${longest}b/index.html` })).toBe(undefined);
  });

  it("decodes the slug once, so an encoded letter is the page and an encoded separator or climb is none", () => {
    expect(viewedPageSlug({ shown: "/api/page/%61bc/index.html" })).toBe("abc");
    expect(viewedPageSlug({ shown: "/api/page/a%2Fb/index.html" })).toBe(undefined);
    expect(viewedPageSlug({ shown: "/api/page/%2E%2E/index.html" })).toBe(undefined);
    expect(viewedPageSlug({ shown: "/api/page/%252E%252E/index.html" })).toBe(undefined);
    expect(viewedPageSlug({ shown: "/api/page/%E0%A4%A/index.html" })).toBe(undefined);
    expect(viewedPageSlug({ shown: "/api/page/.hidden/index.html" })).toBe(undefined);
  });

  it("gives no page for any other document, so Finder never selects a file the owner is not reading", () => {
    const others: readonly (string | undefined)[] = [
      undefined,
      "/api/page/a/shot.png",
      "/api/page/a/appendix/index.html",
      "/api/page/a/",
      "/api/page/index.html",
      "/api/pages/a/index.html",
      "/api/other/a/index.html",
      "/docs/page",
      "/icon.svg",
      "/api/page/a/index.html?x=1",
      "/api/page/a/index.html#top",
      "//evil.example/api/page/a/index.html",
    ];
    expect(others.map((shown) => viewedPageSlug({ shown }))).toEqual(others.map(() => undefined));
  });
});

describe("CONSOLE_PAGES", () => {
  it("names every page.tsx route under app/(console) but the viewer, so a new page is a way back", () => {
    const routes = readdirSync(new URL("../../app/(console)/", import.meta.url), { recursive: true, encoding: "utf8" })
      .filter((entry) => entry.split("/").at(-1) === "page.tsx")
      .map((entry) => {
        const segments = entry.split("/").slice(0, -1);
        return `/${segments.filter((segment) => !segment.startsWith("(")).join("/")}`;
      });
    expect(routes.length).toBeGreaterThan(0);
    expect([...CONSOLE_PAGES, VIEW_PATH].toSorted()).toEqual(routes.toSorted());
  });

  it("serves the Fleet page at its own name, with no page left at /now", () => {
    expect(CONSOLE_PAGES.filter((page) => page.startsWith("/fleet") || page.startsWith("/now"))).toEqual([
      "/fleet",
      "/fleet/session/[id]",
    ]);
  });
});

describe("frameSandbox", () => {
  it("gives a served page what its own policy allows and no origin, and never the top window", () => {
    expect(frameSandbox({ shown: "/api/page/a/index.html" })).toBe(
      "allow-scripts allow-popups allow-popups-to-escape-sandbox allow-downloads",
    );
  });

  it("lets a docs page keep its own origin", () => {
    expect(frameSandbox({ shown: "/docs/console/queue" })).toBe(
      "allow-scripts allow-popups allow-popups-to-escape-sandbox allow-downloads allow-same-origin",
    );
  });
});

describe("viewedDocument", () => {
  it("frames a local page, a served file and a docs page, normalised", () => {
    expect(viewedDocument({ src: "/api/page/vanta-evidence/index.html" })).toBe("/api/page/vanta-evidence/index.html");
    expect(viewedDocument({ src: "/api/draft-media/a.png" })).toBe("/api/draft-media/a.png");
    expect(viewedDocument({ src: "/docs/console/queue#cards" })).toBe("/docs/console/queue#cards");
    expect(viewedDocument({ src: "/api/page/x/../y/index.html" })).toBe("/api/page/y/index.html");
    expect(viewedDocument({ src: "/icon.svg" })).toBe("/icon.svg");
    expect(viewedDocument({ src: "/icon%2Esvg" })).toBe("/icon%2Esvg");
  });

  it("frames nothing off this console", () => {
    expect(viewedDocument({ src: "https://example.com/api/page/a/index.html" })).toBe(undefined);
    expect(viewedDocument({ src: "//example.com/api/page/a/index.html" })).toBe(undefined);
    expect(viewedDocument({ src: "/\\example.com/api/x" })).toBe(undefined);
    expect(viewedDocument({ src: "javascript:alert(1)" })).toBe(undefined);
  });

  it("frames no console page, the viewer itself included", () => {
    expect(viewedDocument({ src: "/queue" })).toBe(undefined);
    expect(viewedDocument({ src: "/view?src=/api/page/a/index.html" })).toBe(undefined);
    expect(viewedDocument({ src: "/api/../queue" })).toBe(undefined);
    expect(viewedDocument({ src: undefined })).toBe(undefined);
  });
});

describe("viewBack", () => {
  it("returns to the card the owner came from", () => {
    expect(viewBack({ back: "/queue?open=hand:h-1&tag=ev" })).toEqual({
      href: "/queue?open=hand:h-1&tag=ev",
      words: "Back to the card",
    });
  });

  it("returns to the Queue, or to any other console page by its plain name", () => {
    expect(viewBack({ back: "/queue?context=work" })).toEqual({
      href: "/queue?context=work",
      words: "Back to the Queue",
    });
    expect(viewBack({ back: "/automations" })).toEqual({ href: "/automations", words: "Back" });
    expect(viewBack({ back: "/pull-requests/o/r/12?tab=files" })).toEqual({
      href: "/pull-requests/o/r/12?tab=files",
      words: "Back",
    });
  });

  it("returns to the Queue for an address naming no console page", () => {
    const toQueue = { href: "/queue", words: "Back to the Queue" };
    expect(viewBack({ back: undefined })).toEqual(toQueue);
    expect(viewBack({ back: "https://example.com/queue" })).toEqual(toQueue);
    expect(viewBack({ back: "//example.com" })).toEqual(toQueue);
    expect(viewBack({ back: "/api/page/a/index.html" })).toEqual(toQueue);
    expect(viewBack({ back: "/view?back=/queue" })).toEqual(toQueue);
    expect(viewBack({ back: "/voice" })).toEqual(toQueue);
    expect(viewBack({ back: "/icon.svg" })).toEqual(toQueue);
    expect(viewBack({ back: "/_next/static/chunks/app.js" })).toEqual(toQueue);
    expect(viewBack({ back: "/no-such-page" })).toEqual(toQueue);
    expect(viewBack({ back: "/queue/no-such-page" })).toEqual(toQueue);
    expect(viewBack({ back: "/pull-requests/o/r" })).toEqual(toQueue);
    expect(viewBack({ back: "/pull-requests/o//1" })).toEqual(toQueue);
    expect(viewBack({ back: "/icon%2Esvg" })).toEqual(toQueue);
    expect(viewBack({ back: "/demo.avif" })).toEqual(toQueue);
    expect(viewBack({ back: "/queue%2F..%2Ficon.svg" })).toEqual(toQueue);
    expect(viewBack({ back: "/queue%E0%A4%A" })).toEqual(toQueue);
    expect(viewBack({ back: "/" })).toEqual(toQueue);
    expect(viewBack({ back: "/queue?open=" })).toEqual({ href: "/queue?open=", words: "Back to the Queue" });
  });
});
