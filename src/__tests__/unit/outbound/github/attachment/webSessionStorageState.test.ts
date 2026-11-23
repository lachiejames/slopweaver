/*
 * A captured web session's storage state: assembled into the github.com Cookie header only, narrowed to
 * github.com before it is kept, and read for the earliest hard expiry among its auth cookies.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import {
  cookieHeaderFromStorageState,
  narrowToGithubCookies,
  sessionLifetimeOf,
} from "../../../../../outbound/github/webSessionCookies.js";

describe("cookieHeaderFromStorageState", () => {
  const state = JSON.stringify({
    cookies: [
      { domain: ".github.com", name: "user_session", value: "session-value" },
      { domain: "github.com", name: "_gh_sess", value: "gh-sess-value" },
      { domain: ".example.com", name: "other_site", value: "not-github" },
    ],
    origins: [],
  });

  it("assembles only the github.com cookies, in file order", () => {
    const result = cookieHeaderFromStorageState({ json: state, path: "state-home/github-web-session.json" });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toBe("user_session=session-value; _gh_sess=gh-sess-value");
  });

  it("never carries another host's cookie to GitHub", () => {
    const result = cookieHeaderFromStorageState({ json: state, path: "state-home/github-web-session.json" });
    expect(unwrap(result).includes("other_site")).toBe(false);
  });

  it("refuses a capture with no user_session cookie — a file that parses but does not authenticate", () => {
    const signedOut = JSON.stringify({ cookies: [{ domain: "github.com", name: "_octo", value: "x" }], origins: [] });
    const result = cookieHeaderFromStorageState({ json: signedOut, path: "state-home/github-web-session.json" });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).code).toBe("WEB_SESSION_UNREADABLE");
    expect(unwrapErr(result).message).toContain("was not signed in");
  });

  it("refuses a file that is not JSON", () => {
    const result = cookieHeaderFromStorageState({ json: "not json", path: "state-home/github-web-session.json" });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).code).toBe("WEB_SESSION_UNREADABLE");
  });

  it("refuses a JSON document with no cookies array", () => {
    const result = cookieHeaderFromStorageState({ json: '{"origins":[]}', path: "state-home/github-web-session.json" });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).message).toContain("no `cookies` array");
  });

  it("ignores a malformed cookie entry rather than throwing on it", () => {
    const mixed = JSON.stringify({
      cookies: [{ domain: "github.com" }, { domain: "github.com", name: "user_session", value: "v" }],
      origins: [],
    });
    const result = cookieHeaderFromStorageState({ json: mixed, path: "state-home/github-web-session.json" });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toBe("user_session=v");
  });
});

describe("narrowToGithubCookies", () => {
  const captured = JSON.stringify({
    cookies: [
      { domain: "github.com", expires: 1756000000, name: "user_session", value: "a" },
      { domain: ".github.com", expires: -1, name: "logged_in", value: "yes" },
      { domain: "accounts.google.com", expires: 1756000000, name: "SID", value: "secret" },
      { domain: ".google.com", expires: 1756000000, name: "SSID", value: "secret" },
      { domain: ".youtube.com", expires: 1756000000, name: "VISITOR_INFO", value: "secret" },
    ],
    origins: [{ localStorage: [], origin: "https://accounts.google.com" }],
  });

  it("keeps every github.com cookie", () => {
    const narrowed: { cookies: { name: string }[] } = JSON.parse(narrowToGithubCookies({ json: captured }));
    expect(narrowed.cookies.map((c) => c.name)).toEqual(["user_session", "logged_in"]);
  });

  it("drops the identity provider's cookies, which a real SSO login captures too", () => {
    expect(narrowToGithubCookies({ json: captured }).includes("accounts.google.com")).toBe(false);
    expect(narrowToGithubCookies({ json: captured }).includes("secret")).toBe(false);
  });

  it("drops origins wholesale rather than carrying another site's local storage", () => {
    const narrowed: { origins: unknown[] } = JSON.parse(narrowToGithubCookies({ json: captured }));
    expect(narrowed.origins).toEqual([]);
  });

  it("leaves the narrowed document usable by the upload path's own parser", () => {
    const header = cookieHeaderFromStorageState({
      json: narrowToGithubCookies({ json: captured }),
      path: "state-home/github-web-session.json",
    });
    expect(header.isOk()).toBe(true);
    expect(unwrap(header)).toBe("user_session=a; logged_in=yes");
  });

  it("preserves expiries, so the lifetime is still readable afterwards", () => {
    expect(sessionLifetimeOf({ json: narrowToGithubCookies({ json: captured }) }).expiresAtIso).toBe(
      "2025-08-24T01:46:40.000Z",
    );
  });

  it("returns an unreadable document unchanged rather than destroying it", () => {
    expect(narrowToGithubCookies({ json: "not json" })).toBe("not json");
  });
});

describe("sessionLifetimeOf", () => {
  it("reports the earliest hard expiry among the AUTH cookies only", () => {
    const json = JSON.stringify({
      cookies: [
        { domain: ".github.com", expires: 1788000000, name: "_octo", value: "x" },
        { domain: "github.com", expires: 1756000000, name: "user_session", value: "x" },
        { domain: ".github.com", expires: 1788000001, name: "logged_in", value: "yes" },
      ],
    });
    expect(sessionLifetimeOf({ json }).expiresAtIso).toBe("2025-08-24T01:46:40.000Z");
  });

  it("ignores a year-long preference cookie, which would otherwise flatter the answer", () => {
    const json = JSON.stringify({
      cookies: [
        { domain: ".github.com", expires: 1788000000, name: "_octo", value: "x" },
        { domain: "github.com", expires: -1, name: "_gh_sess", value: "x" },
      ],
    });
    expect(sessionLifetimeOf({ json }).expiresAtIso).toBeUndefined();
  });

  it("reports a session-scoped auth cookie as such rather than as never expiring", () => {
    const json = JSON.stringify({ cookies: [{ domain: "github.com", expires: -1, name: "_gh_sess", value: "x" }] });
    expect(sessionLifetimeOf({ json }).sessionScoped).toBe(true);
    expect(sessionLifetimeOf({ json }).expiresAtIso).toBeUndefined();
  });

  it("flags both when one auth cookie expires and another is session-scoped", () => {
    const json = JSON.stringify({
      cookies: [
        { domain: "github.com", expires: 1756000000, name: "user_session", value: "x" },
        { domain: "github.com", expires: -1, name: "_gh_sess", value: "x" },
      ],
    });
    expect(sessionLifetimeOf({ json }).sessionScoped).toBe(true);
    expect(sessionLifetimeOf({ json }).expiresAtIso).toBe("2025-08-24T01:46:40.000Z");
  });

  it("says nothing rather than throwing on an unreadable file", () => {
    expect(sessionLifetimeOf({ json: "not json" }).expiresAtIso).toBeUndefined();
    expect(sessionLifetimeOf({ json: "not json" }).sessionScoped).toBe(false);
  });
});
