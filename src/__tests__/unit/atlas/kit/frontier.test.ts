/**
 * The two decisions a sitemap-less walk shares: turning a rendered href into a comparable path, and choosing the
 * next round from what the last one rendered — with which paths are admitted left to the caller.
 */
import { describe, expect, it } from "vitest";

import { canonicaliseSameOriginHref, expandRenderedFrontier } from "../../../../atlas/kit/frontier.js";

const ORIGIN = "https://console.example.com";

describe("canonicaliseSameOriginHref", () => {
  it("drops the fragment and sorts the query, so one destination is one path", () => {
    expect(canonicaliseSameOriginHref({ href: "/settings?tab=b&a=1#members", origin: ORIGIN })).toBe(
      "/settings?a=1&tab=b",
    );
  });

  it("resolves a relative href against the origin and returns a bare pathname when there is no query", () => {
    expect(canonicaliseSameOriginHref({ href: "settings/billing", origin: `${ORIGIN}/` })).toBe("/settings/billing");
  });

  it("keeps an absolute href on the same origin", () => {
    expect(canonicaliseSameOriginHref({ href: `${ORIGIN}/org/teams`, origin: ORIGIN })).toBe("/org/teams");
  });

  it("re-encodes a decoded &, =, #, + or space, so one parameter never becomes two", () => {
    expect(canonicaliseSameOriginHref({ href: "/search?q=a%26b%3Dc%23d%2Be%20f", origin: ORIGIN })).toBe(
      "/search?q=a%26b%3Dc%23d%2Be%20f",
    );
  });

  it("reads a literal + as the space it means, so both spellings are one destination", () => {
    expect(canonicaliseSameOriginHref({ href: "/search?q=a+b", origin: ORIGIN })).toBe("/search?q=a%20b");
  });

  it("leaves a / or : in a value readable, as it was rendered", () => {
    expect(canonicaliseSameOriginHref({ href: "/go?next=/settings/billing&at=12:00", origin: ORIGIN })).toBe(
      "/go?at=12:00&next=/settings/billing",
    );
  });

  it("keeps a repeated key's values in the order they were rendered", () => {
    expect(canonicaliseSameOriginHref({ href: "/list?tag=b&page=1&tag=a", origin: ORIGIN })).toBe(
      "/list?page=1&tag=b&tag=a",
    );
  });

  it("refuses an off-origin href", () => {
    expect(canonicaliseSameOriginHref({ href: "https://docs.example.com/settings", origin: ORIGIN })).toBe(null);
  });

  it("refuses an href that does not parse", () => {
    expect(canonicaliseSameOriginHref({ href: "http://[", origin: ORIGIN })).toBe(null);
  });

  it("refuses when the origin itself does not parse", () => {
    expect(canonicaliseSameOriginHref({ href: "/settings", origin: "not a url" })).toBe(null);
  });
});

describe("expandRenderedFrontier", () => {
  it("returns admitted, unvisited, same-origin paths, de-duplicated and sorted", () => {
    const next = expandRenderedFrontier({
      admits: ({ path }) => path.startsWith("/settings"),
      origin: ORIGIN,
      rendered: [
        "/settings/teams",
        "/settings/billing#plan",
        "/settings/billing",
        "/settings/members",
        "/dashboard",
        "https://elsewhere.example.com/settings/x",
      ],
      visited: new Set(["/settings/members"]),
    });

    expect(next).toEqual(["/settings/billing", "/settings/teams"]);
  });

  it("matches the visited set on the CANONICAL path, so a re-ordered query is not visited twice", () => {
    const next = expandRenderedFrontier({
      admits: () => true,
      origin: ORIGIN,
      rendered: ["/audit?sort=asc&page=2", "/audit?page=3"],
      visited: new Set(["/audit?page=2&sort=asc"]),
    });

    expect(next).toEqual(["/audit?page=3"]);
  });

  it("returns nothing when nothing was rendered", () => {
    expect(expandRenderedFrontier({ admits: () => true, origin: ORIGIN, rendered: [], visited: new Set() })).toEqual(
      [],
    );
  });
});
