/**
 * Where a settled address disagrees with the one the walk asked for — origin, path, query or unreadable — and
 * the client-side noise it must not mistake for a disagreement, with a query key that is total.
 */
import { describe, expect, it } from "vitest";

import { addressDisagreement } from "../../../../../atlas/kit/pageWalk.js";

import { ORIGIN } from "./harness.js";

describe("addressDisagreement", () => {
  it("holds a page whose client appended its own view state to the address it was asked for", () => {
    expect(
      addressDisagreement({
        finalUrl: `${ORIGIN}/cost/analyze/explorer?page=1&filterRecent=false&paused=false&timeframe=7d`,
        requestedUrl: `${ORIGIN}/cost/analyze/explorer?page=1`,
      }),
    ).toBe(null);
  });

  it("refuses a page whose declared parameter the client dropped", () => {
    expect(
      addressDisagreement({
        finalUrl: `${ORIGIN}/policies?afterCursor=abc`,
        requestedUrl: `${ORIGIN}/policies?page=1`,
      }),
    ).toBe("query");
  });

  it("refuses a page whose identity parameter the client answered with a different value", () => {
    expect(
      addressDisagreement({
        finalUrl: `${ORIGIN}/controls?controlId=Y`,
        requestedUrl: `${ORIGIN}/controls?controlId=X`,
      }),
    ).toBe("query");
  });

  it("holds a repeated parameter the settled address carries in full", () => {
    expect(
      addressDisagreement({
        finalUrl: `${ORIGIN}/tests?status=OVERDUE&status=DUE_SOON`,
        requestedUrl: `${ORIGIN}/tests?status=OVERDUE&status=DUE_SOON`,
      }),
    ).toBe(null);
  });

  it("refuses a repeated parameter the settled address carries only once", () => {
    expect(
      addressDisagreement({
        finalUrl: `${ORIGIN}/tests?status=OVERDUE`,
        requestedUrl: `${ORIGIN}/tests?status=OVERDUE&status=DUE_SOON`,
      }),
    ).toBe("query");
  });

  it("reads a plus and a percent-encoded space as the same value", () => {
    expect(
      addressDisagreement({
        finalUrl: `${ORIGIN}/tests?search=Password%20policy`,
        requestedUrl: `${ORIGIN}/tests?search=Password+policy`,
      }),
    ).toBe(null);
  });

  it("refuses a declared empty value the client did not keep", () => {
    expect(addressDisagreement({ finalUrl: `${ORIGIN}/tests`, requestedUrl: `${ORIGIN}/tests?search=` })).toBe("query");
  });

  it("names the ORIGIN when the client left it, whatever the query says", () => {
    expect(
      addressDisagreement({ finalUrl: "https://elsewhere.test/tests?page=1", requestedUrl: `${ORIGIN}/tests?page=1` }),
    ).toBe("origin");
  });

  it("treats a trailing slash as the same address", () => {
    expect(addressDisagreement({ finalUrl: `${ORIGIN}/settings/`, requestedUrl: `${ORIGIN}/settings` })).toBe(null);
  });

  it("names the PATH when the client rewrote the route", () => {
    expect(addressDisagreement({ finalUrl: `${ORIGIN}/overview`, requestedUrl: `${ORIGIN}/settings` })).toBe("path");
  });

  it("ignores a fragment, which is client-side state rather than an address", () => {
    expect(addressDisagreement({ finalUrl: `${ORIGIN}/settings#tab-two`, requestedUrl: `${ORIGIN}/settings` })).toBe(
      null,
    );
  });

  it("names an address it cannot read at all", () => {
    expect(addressDisagreement({ finalUrl: "not a url", requestedUrl: `${ORIGIN}/settings` })).toBe("unreadable");
    expect(addressDisagreement({ finalUrl: `${ORIGIN}/settings`, requestedUrl: "not a url" })).toBe("unreadable");
  });
});

describe("addressDisagreement's query key is total", () => {
  it("does not confuse a name and value that straddle where a separator would sit", () => {
    // `a=bc` and `ab=c` collide under any fixed separator that can appear in either half.
    expect(
      addressDisagreement({
        finalUrl: `${ORIGIN}/x?${encodeURIComponent("ab")}=${encodeURIComponent("c")}`,
        requestedUrl: `${ORIGIN}/x?${encodeURIComponent("a")}=${encodeURIComponent("bc")}`,
      }),
    ).toBe("query");
  });

  it("holds a name and value carrying the characters a key would otherwise join on", () => {
    const name = "a=b&c:d";
    const value = "1:2=3";
    const query = `${encodeURIComponent(name)}=${encodeURIComponent(value)}`;
    expect(addressDisagreement({ finalUrl: `${ORIGIN}/x?${query}`, requestedUrl: `${ORIGIN}/x?${query}` })).toBe(null);
  });
});
