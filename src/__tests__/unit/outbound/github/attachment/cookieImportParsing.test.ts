/*
 * Importing cookies a person hands over: a pasted Cookie header or a cookies.txt export is parsed to github.com
 * cookies, then written as a storage state the upload path's own parser reads back.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import {
  cookieHeaderFromStorageState,
  parseCookieHeaderInput,
  parseNetscapeCookies,
  sessionLifetimeOf,
  storageStateFromCookies,
} from "../../../../../outbound/github/webSessionCookies.js";

describe("parseCookieHeaderInput", () => {
  it("parses the Cookie header a browser sends, in order", () => {
    const cookies = parseCookieHeaderInput({ text: "user_session=abc; _gh_sess=def; logged_in=yes" });
    expect(cookies.map((c) => c.name)).toEqual(["user_session", "_gh_sess", "logged_in"]);
    expect(cookies.map((c) => c.value)).toEqual(["abc", "def", "yes"]);
  });

  it("tolerates the `Cookie:` prefix DevTools shows beside the value", () => {
    const cookies = parseCookieHeaderInput({ text: "Cookie: user_session=abc" });
    expect(cookies.map((c) => c.name)).toEqual(["user_session"]);
  });

  it("keeps a value containing an equals sign whole", () => {
    const cookies = parseCookieHeaderInput({ text: "user_session=aGk=Pw==" });
    expect(cookies[0]?.value).toBe("aGk=Pw==");
  });

  it("marks every imported cookie session-scoped, because a header carries no expiry to read", () => {
    const cookies = parseCookieHeaderInput({ text: "user_session=abc" });
    expect(cookies[0]?.expires).toBe(-1);
  });

  it("files them under github.com so the upload path's own domain filter accepts them", () => {
    expect(parseCookieHeaderInput({ text: "user_session=abc" })[0]?.domain).toBe("github.com");
  });

  it("ignores a stray fragment with no equals sign rather than inventing a cookie", () => {
    const cookies = parseCookieHeaderInput({ text: "user_session=abc; garbage; _gh_sess=def" });
    expect(cookies.map((c) => c.name)).toEqual(["user_session", "_gh_sess"]);
  });

  it("returns nothing for an empty paste", () => {
    expect(parseCookieHeaderInput({ text: "   " })).toEqual([]);
  });
});

describe("parseNetscapeCookies", () => {
  const line = ({ fields }: { fields: readonly string[] }): string => fields.join("\t");

  it("reads a github.com cookie WITH its real expiry — the reason to prefer this source", () => {
    const text = line({ fields: ["github.com", "TRUE", "/", "TRUE", "1756000000", "user_session", "abc"] });
    const cookies = parseNetscapeCookies({ text });
    expect(cookies.map((c) => c.name)).toEqual(["user_session"]);
    expect(cookies[0]?.expires).toBe(1756000000);
  });

  it("skips comments and short lines a real export carries", () => {
    const text = [
      "# Netscape HTTP Cookie File",
      "",
      "not\tenough\tfields",
      line({ fields: ["github.com", "TRUE", "/", "TRUE", "1756000000", "user_session", "abc"] }),
    ].join("\n");
    expect(parseNetscapeCookies({ text }).map((c) => c.name)).toEqual(["user_session"]);
  });

  it("keeps only github.com cookies, never another host's", () => {
    const text = [
      line({ fields: ["example.com", "TRUE", "/", "TRUE", "1756000000", "other", "x"] }),
      line({ fields: [".github.com", "TRUE", "/", "TRUE", "1756000000", "user_session", "abc"] }),
    ].join("\n");
    expect(parseNetscapeCookies({ text }).map((c) => c.name)).toEqual(["user_session"]);
  });
});

describe("storageStateFromCookies", () => {
  it("round-trips through the parser the upload path uses", () => {
    const json = storageStateFromCookies({
      cookies: parseCookieHeaderInput({ text: "user_session=abc; _gh_sess=def" }),
    });
    const header = cookieHeaderFromStorageState({ json, path: "state-home/github-web-session.json" });
    expect(header.isOk()).toBe(true);
    expect(unwrap(header)).toBe("user_session=abc; _gh_sess=def");
  });

  it("is refused by that same parser when the paste carried no session cookie", () => {
    const json = storageStateFromCookies({ cookies: parseCookieHeaderInput({ text: "logged_in=yes" }) });
    const header = cookieHeaderFromStorageState({ json, path: "state-home/github-web-session.json" });
    expect(header.isErr()).toBe(true);
    expect(unwrapErr(header).code).toBe("WEB_SESSION_UNREADABLE");
  });

  it("carries a real expiry through from a cookies.txt import", () => {
    const text = ["github.com", "TRUE", "/", "TRUE", "1756000000", "user_session", "abc"].join("\t");
    const json = storageStateFromCookies({ cookies: parseNetscapeCookies({ text }) });
    expect(sessionLifetimeOf({ json }).expiresAtIso).toBe("2025-08-24T01:46:40.000Z");
  });
});
