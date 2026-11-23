/**
 * What the walk is and is not commissioned to open, and how a declared page becomes an address.
 *
 * Two of the three refusals here have a SIDE EFFECT behind them rather than a tidiness argument — a
 * credential page whose screenshot would carry a working token, and a recording whose payload this atlas
 * withholds on disclosure — so the declared list is checked against them rather than trusted.
 */
import { describe, expect, it } from "vitest";

import {
  isJamApplicationPath,
  isJamAuthPath,
  isJamCredentialRevealPath,
  isJamFirstPartyOrigin,
  isJamRecordingPath,
  JAM_APPLICATION_PREFIX,
  JAM_BROWSER_PAGES,
  JAM_INVENTED_ROUTE,
  JAM_NOT_FOUND_ROUTE,
  JAM_WEB_ORIGIN,
  jamPageUrl,
  jamRootFromFinalUrl,
  jamWebSectionOf,
} from "../../../../atlas/jam/browserPages.js";

/** A root of the shape the client actually lands on, with a synthetic team id. */
const ROOT = `${JAM_APPLICATION_PREFIX}team-0000`;

describe("the declared list", () => {
  it("declares the not-found control, and declares it origin-relative so it needs no root", () => {
    const control = JAM_BROWSER_PAGES.find((page) => page.path === JAM_NOT_FOUND_ROUTE);
    expect(control?.surface).toBe("not-found-control");
    expect(control?.rootRelative).toBe(false);
  });

  it("names every page exactly once", () => {
    const surfaces = JAM_BROWSER_PAGES.map((page) => page.surface);
    expect(new Set(surfaces).size).toBe(surfaces.length);
  });

  it("declares no page the walk's own refusals would reject", () => {
    const rejected = JAM_BROWSER_PAGES.filter(
      (page) => !isJamApplicationPath({ path: page.rootRelative ? `${ROOT}${page.path}` : page.path }),
    );
    expect(rejected).toEqual([]);
  });

  it("hangs every page but the two controls off the application root", () => {
    expect(JAM_BROWSER_PAGES.filter((page) => !page.rootRelative).map((page) => page.surface)).toEqual([
      "not-found-control",
      "not-found-invented",
    ]);
  });

  // MEASURED: under the team root Jam now forwards an unknown route to /404, the declared control's
  // own address, so an invented control there is never reached. At the bare origin it renders in place.
  it("declares the invented control at the bare origin, where Jam still renders its not-found in place", () => {
    const invented = JAM_BROWSER_PAGES.find((page) => page.surface === "not-found-invented")!;
    expect(invented.path).toBe(JAM_INVENTED_ROUTE);
    expect(jamPageUrl({ page: invented, root: ROOT })).toBe(`${JAM_WEB_ORIGIN}${JAM_INVENTED_ROUTE}`);
  });

  it("admits the invented control's bare-origin path and no other invented one", () => {
    expect(isJamApplicationPath({ path: JAM_INVENTED_ROUTE })).toBe(true);
    expect(isJamApplicationPath({ path: "/zzz-some-other-route" })).toBe(false);
  });
});

describe("credential pages", () => {
  it("refuses the two settings tabs Jam ships that render a credential", () => {
    expect(isJamCredentialRevealPath({ path: `${ROOT}/settings/cli` })).toBe(true);
    expect(isJamCredentialRevealPath({ path: `${ROOT}/settings/sdk` })).toBe(true);
  });

  it("refuses by fragment rather than by name, so a tab shipped tomorrow is refused too", () => {
    expect(isJamCredentialRevealPath({ path: `${ROOT}/settings/api-keys` })).toBe(true);
    expect(isJamCredentialRevealPath({ path: `${ROOT}/settings/two-factor` })).toBe(true);
    expect(isJamCredentialRevealPath({ path: "/oauth/authorize" })).toBe(true);
  });

  it("admits an ordinary settings tab", () => {
    expect(isJamCredentialRevealPath({ path: `${ROOT}/settings/connected-apps` })).toBe(false);
  });
});

describe("recording pages", () => {
  it("refuses a jam, a shared conversation and a share redirect", () => {
    expect(isJamRecordingPath({ path: "/v/abc123" })).toBe(true);
    expect(isJamRecordingPath({ path: "/c/abc123" })).toBe(true);
    expect(isJamRecordingPath({ path: "/to/abc123" })).toBe(true);
  });

  it("admits the settings page that lists recording links, which is administrative", () => {
    expect(isJamRecordingPath({ path: `${ROOT}/recording-links` })).toBe(false);
  });
});

describe("the sign-in surface", () => {
  it("is refused, because Jam serves it from the application's OWN origin", () => {
    expect(isJamAuthPath({ path: "/login" })).toBe(true);
    expect(isJamAuthPath({ path: "/logout" })).toBe(true);
    expect(isJamAuthPath({ path: "/denied" })).toBe(true);
    expect(isJamAuthPath({ path: "/login?redirect=%2F" })).toBe(true);
  });

  it("does not refuse a path that merely starts with the same letters", () => {
    expect(isJamAuthPath({ path: "/logins-report" })).toBe(false);
  });
});

describe("admission", () => {
  it("admits the application prefix, the root and the walk's own control", () => {
    expect(isJamApplicationPath({ path: "/" })).toBe(true);
    expect(isJamApplicationPath({ path: JAM_NOT_FOUND_ROUTE })).toBe(true);
    expect(isJamApplicationPath({ path: `${ROOT}/settings/members` })).toBe(true);
  });

  it("refuses the MARKETING site Jam serves from the SAME origin, which is why admission is by prefix", () => {
    for (const path of [
      "/about",
      "/pricing",
      "/careers",
      "/blog/ai-animations/",
      "/blog/author/dani/",
      "/docs/security",
      "/legal/terms",
      "/integrations/linear",
      "/contact/sales",
    ]) {
      expect(isJamApplicationPath({ path })).toBe(false);
    }
  });
});

describe("jamRootFromFinalUrl", () => {
  it("reads the team root the client sent the bare origin to", () => {
    expect(jamRootFromFinalUrl({ finalUrl: `${JAM_WEB_ORIGIN}${ROOT}` })).toBe(ROOT);
    expect(jamRootFromFinalUrl({ finalUrl: `${JAM_WEB_ORIGIN}${ROOT}/settings/mcp` })).toBe(ROOT);
  });

  it("answers null when the client landed somewhere carrying no root", () => {
    expect(jamRootFromFinalUrl({ finalUrl: `${JAM_WEB_ORIGIN}/login` })).toBe(null);
    expect(jamRootFromFinalUrl({ finalUrl: `${JAM_WEB_ORIGIN}${JAM_APPLICATION_PREFIX}` })).toBe(null);
    expect(jamRootFromFinalUrl({ finalUrl: "not a url" })).toBe(null);
  });
});

describe("jamPageUrl", () => {
  it("composes a root-relative page under the resolved root", () => {
    expect(jamPageUrl({ page: { path: "/settings/mcp", rootRelative: true, surface: "s" }, root: ROOT })).toBe(
      `${JAM_WEB_ORIGIN}${ROOT}/settings/mcp`,
    );
  });

  it("addresses an origin-relative page with no root at all", () => {
    expect(jamPageUrl({ page: { path: "/404", rootRelative: false, surface: "c" }, root: null })).toBe(
      `${JAM_WEB_ORIGIN}/404`,
    );
  });

  it("refuses a root-relative page when there is no root, rather than addressing the bare origin", () => {
    expect(jamPageUrl({ page: { path: "/settings", rootRelative: true, surface: "s" }, root: null })).toBe(null);
  });
});

describe("first-party origins", () => {
  it("admits Jam's own hosts and refuses the third parties its client loads", () => {
    expect(isJamFirstPartyOrigin({ origin: "https://jam.dev" })).toBe(true);
    expect(isJamFirstPartyOrigin({ origin: "https://api.jam.dev" })).toBe(true);
    expect(isJamFirstPartyOrigin({ origin: "https://mcp.jam.dev" })).toBe(true);
    expect(isJamFirstPartyOrigin({ origin: "https://js.stripe.com" })).toBe(false);
    expect(isJamFirstPartyOrigin({ origin: "https://widget.intercom.io" })).toBe(false);
  });

  it("is not fooled by a host that merely ends in the same letters", () => {
    expect(isJamFirstPartyOrigin({ origin: "https://notjam.dev" })).toBe(false);
    expect(isJamFirstPartyOrigin({ origin: "https://jam.dev.example.com" })).toBe(false);
  });

  it("refuses an origin it cannot parse rather than throwing", () => {
    expect(isJamFirstPartyOrigin({ origin: "not a url" })).toBe(false);
  });
});

describe("sections", () => {
  it("names a declared page's first segment, and calls the root what it is", () => {
    expect(jamWebSectionOf({ surface: "settings/connected-apps" })).toBe("settings");
    expect(jamWebSectionOf({ surface: "overview" })).toBe("overview");
    expect(jamWebSectionOf({ surface: "" })).toBe("root");
  });
});
