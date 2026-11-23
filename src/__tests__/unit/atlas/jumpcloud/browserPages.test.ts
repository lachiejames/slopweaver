/**
 * The JumpCloud console's declared pages, and the two address rules the kit cannot supply for a hash-routed
 * client: comparing the FRAGMENT route, and recognising a settle on the sign-in page or end-user portal.
 */
import { describe, expect, it } from "vitest";

import {
  hashRouteDisagreement,
  isSignInSettle,
  JUMPCLOUD_CONSOLE_ORIGIN,
  JUMPCLOUD_CONSOLE_PAGES,
  JUMPCLOUD_ORACLE_SURFACES,
  jumpcloudConsolePageUrl,
} from "../../../../atlas/jumpcloud/browserPages.js";

const HOME = `${JUMPCLOUD_CONSOLE_ORIGIN}/#/home`;

describe("JUMPCLOUD_CONSOLE_PAGES", () => {
  it("declares pages at all", () => {
    expect(JUMPCLOUD_CONSOLE_PAGES.length).toBeGreaterThan(0);
  });

  it("names every page once, so a coverage row cannot be credited twice", () => {
    const surfaces = JUMPCLOUD_CONSOLE_PAGES.map((page) => page.surface);
    expect(new Set(surfaces).size).toBe(surfaces.length);
  });

  it("addresses every route once, so two rows cannot be one page", () => {
    const routes = JUMPCLOUD_CONSOLE_PAGES.map((page) => page.route);
    expect(new Set(routes).size).toBe(routes.length);
  });

  it("declares no route that creates, imports, exports or deletes anything", () => {
    expect(
      JUMPCLOUD_CONSOLE_PAGES.filter((page) => /(^|\/)(new|add|create|import|export|delete)(\/|$)/.test(page.route)),
    ).toEqual([]);
  });

  it("holds every oracle page, so the declared list cannot silently lose a page measured to exist", () => {
    const declared = new Set(JUMPCLOUD_CONSOLE_PAGES.map((page) => page.surface));
    expect(JUMPCLOUD_ORACLE_SURFACES.length).toBeGreaterThan(0);
    expect(JUMPCLOUD_ORACLE_SURFACES.filter((surface) => !declared.has(surface))).toEqual([]);
  });
});

describe("jumpcloudConsolePageUrl", () => {
  it("addresses a page by its hash route under the console origin", () => {
    expect(
      jumpcloudConsolePageUrl({
        page: { description: "d", query: {}, route: "devices/list", section: "device-management", surface: "devices" },
      }),
    ).toBe("https://console.jumpcloud.com/#/devices/list");
  });

  it("carries declared view state inside the fragment", () => {
    expect(
      jumpcloudConsolePageUrl({
        page: { description: "d", query: { tab: "all" }, route: "alerts", section: "monitoring", surface: "alerts" },
      }),
    ).toBe("https://console.jumpcloud.com/#/alerts?tab=all");
  });
});

describe("hashRouteDisagreement", () => {
  it("holds a route the client kept", () => {
    expect(hashRouteDisagreement({ finalUrl: HOME, requestedUrl: HOME })).toBe(null);
  });

  // Measured: `#/zz-not-a-route` settles on `#/home`, and the kit's own comparison cannot see it.
  it("catches the client sending an unknown route home", () => {
    expect(
      hashRouteDisagreement({ finalUrl: HOME, requestedUrl: `${JUMPCLOUD_CONSOLE_ORIGIN}/#/zz-not-a-route` }),
    ).toBe("route");
  });

  it("treats a trailing slash on the route as the same route", () => {
    expect(hashRouteDisagreement({ finalUrl: `${HOME}/`, requestedUrl: HOME })).toBe(null);
  });

  it("tolerates a parameter the client appends to the fragment", () => {
    expect(hashRouteDisagreement({ finalUrl: `${HOME}?view=grid`, requestedUrl: HOME })).toBe(null);
  });

  it("refuses a fragment parameter the request carried and the client dropped", () => {
    expect(hashRouteDisagreement({ finalUrl: HOME, requestedUrl: `${HOME}?tab=all` })).toBe("route-query");
  });

  it("refuses an address it cannot read", () => {
    expect(hashRouteDisagreement({ finalUrl: "::::", requestedUrl: HOME })).toBe("unreadable");
  });
});

describe("isSignInSettle", () => {
  it("reads the administrator sign-in page as a lost session", () => {
    expect(isSignInSettle({ finalUrl: "https://console.jumpcloud.com/login/admin" })).toBe(true);
  });

  it("reads the end-user portal as a lost ADMINISTRATOR session", () => {
    expect(isSignInSettle({ finalUrl: "https://console.jumpcloud.com/userconsole#/" })).toBe(true);
  });

  it("reads a console page as the session continuing", () => {
    expect(isSignInSettle({ finalUrl: HOME })).toBe(false);
  });

  it("does not read an unreadable address as a sign-in", () => {
    expect(isSignInSettle({ finalUrl: "::::" })).toBe(false);
  });
});
