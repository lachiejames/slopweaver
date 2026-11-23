import { describe, expect, it } from "vitest";

import {
  antiforgeryTokenFrom,
  cookieHeaderFromJar,
  jarHoldsSession,
  TRELICA_SESSION_COOKIE,
} from "../../../../atlas/trelica/session.js";
import type { JarCookie } from "../../../../browser/cookieScope.js";

/** One jar row, shaped as `cookieJar.ts` hands them back. */
function cookie({ name, value }: { name: string; value: string }): JarCookie {
  return { domain: "team-example.trelica.app", expires: -1, httpOnly: true, name, path: "/", secure: true, value };
}

describe("jarHoldsSession", () => {
  it("recognises the identity cookie by name", () => {
    expect(jarHoldsSession({ cookies: [cookie({ name: TRELICA_SESSION_COOKIE, value: "opaque" })] })).toBe(true);
  });

  it("is false for a jar holding only the antiforgery and preference cookies", () => {
    expect(
      jarHoldsSession({
        cookies: [cookie({ name: "XSRF-TOKEN", value: "x" }), cookie({ name: "theme", value: "light" })],
      }),
    ).toBe(false);
  });

  it("is false for an empty jar", () => {
    expect(jarHoldsSession({ cookies: [] })).toBe(false);
  });
});

describe("cookieHeaderFromJar", () => {
  it("renders the rows a browser would send, in jar order", () => {
    expect(
      cookieHeaderFromJar({
        cookies: [cookie({ name: "a", value: "1" }), cookie({ name: "b", value: "2" })],
      }),
    ).toBe("a=1; b=2");
  });

  it("renders an empty jar as an empty header rather than throwing", () => {
    expect(cookieHeaderFromJar({ cookies: [] })).toBe("");
  });
});

describe("antiforgeryTokenFrom", () => {
  it("reads the token out of the page-state block the platform renders", () => {
    const html = '<script>var pageState = {"antiforgeryToken":"CfDJ8-a-token","location":{}};</script>';
    expect(antiforgeryTokenFrom({ html })).toBe("CfDJ8-a-token");
  });

  it("answers null for a sign-in page, which carries no page state at all", () => {
    expect(antiforgeryTokenFrom({ html: "<html><body>Log in</body></html>" })).toBe(null);
  });

  it("answers null rather than an empty string when the key is present and empty", () => {
    expect(antiforgeryTokenFrom({ html: '{"antiforgeryToken":""}' })).toBe(null);
  });
});
