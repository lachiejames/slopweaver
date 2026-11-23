/**
 * The DevTools paste reader: both copy shapes, the five headers only, and a refusal that names a header and
 * never carries a value.
 */
import { describe, expect, it } from "vitest";

import { bearerExpiryIso, KEPT_HEADERS, parseRequestPaste } from "../../../../../cli/commands/chatgpt/paste.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

/** A bearer whose payload carries `exp` 1790000000. */
const BEARER = `Bearer x.${Buffer.from(JSON.stringify({ exp: 1_790_000_000 })).toString("base64url")}.sig`;

/** A secret sentinel standing in for the cookie, so a leak is checkable. */
const COOKIE = "session-token=SENTINEL-COOKIE-VALUE";

/** The Headers-pane shape: a name line, then a value line, with response headers above. */
const PANE_PASTE = [
  "Request URL",
  "https://chatgpt.com/backend-api/conversations/x/messages",
  "content-type",
  "application/json",
  "authorization",
  BEARER,
  "chatgpt-account-id",
  "acct-1",
  "cookie",
  COOKIE,
  "oai-did",
  "did-1",
  "user-agent",
  "Mozilla/5.0 test",
].join("\n");

describe("parseRequestPaste", () => {
  it("reads the five headers from the Headers-pane shape", () => {
    const headers = unwrap(parseRequestPaste({ text: PANE_PASTE }));
    expect(headers).toEqual({
      authorization: BEARER,
      "chatgpt-account-id": "acct-1",
      cookie: COOKIE,
      "oai-did": "did-1",
      "user-agent": "Mozilla/5.0 test",
    });
  });

  it("reads the one-line `name: value` shape too", () => {
    const text = [
      `authorization: ${BEARER}`,
      "chatgpt-account-id: acct-2",
      `cookie: ${COOKIE}`,
      "oai-did: did-2",
      "user-agent: Mozilla/5.0 other",
    ].join("\r\n");
    const headers = unwrap(parseRequestPaste({ text }));
    expect(headers["chatgpt-account-id"]).toBe("acct-2");
    expect(headers["user-agent"]).toBe("Mozilla/5.0 other");
  });

  it("names the missing header and carries no value when one is absent", () => {
    const text = PANE_PASTE.replace("oai-did\ndid-1\n", "");
    expect(text).toContain(COOKIE);
    const error = unwrapErr(parseRequestPaste({ text }));
    expect(error.code).toBe("HEADER_MISSING");
    expect(error.message).toContain("`oai-did`");
    expect(error.message).not.toContain("SENTINEL");
  });

  it("keeps exactly five header names", () => {
    expect(KEPT_HEADERS).toEqual(["authorization", "cookie", "chatgpt-account-id", "oai-did", "user-agent"]);
  });
});

describe("bearerExpiryIso", () => {
  it("reads the JWT's own exp claim as an instant", () => {
    expect(bearerExpiryIso({ authorization: BEARER })).toBe("2026-09-21T14:13:20.000Z");
  });

  it("answers null for a value that is not a JWT", () => {
    expect(bearerExpiryIso({ authorization: "Bearer opaque" })).toBe(null);
  });

  it("answers null for a JWT with no numeric exp", () => {
    const noExp = `Bearer x.${Buffer.from(JSON.stringify({ sub: "u" })).toString("base64url")}.sig`;
    expect(bearerExpiryIso({ authorization: noExp })).toBe(null);
  });
});
