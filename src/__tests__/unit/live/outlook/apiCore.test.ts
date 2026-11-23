/**
 * The pure helpers every Outlook method file shares: which paging links may carry the owner's bearer, and how a
 * value is quoted into an OData literal or a `$search` term.
 */
import { describe, expect, it } from "vitest";
import type { IngestError } from "../../../../lib/ingestError.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  checkedWrite,
  followable,
  isGraphLink,
  odataQuoted,
  searchQuoted,
  segment,
  writeFailure,
} from "../../../../live/outlook/apiCore.js";
import { MESSAGE } from "../../../../live/outlook/graphWire.js";
import { wireMessage } from "../../../fakeOutlookMailbox.js";

/** A boundary failure as `safeProviderCall` would hand one back. */
function ingest({ over }: { over: Partial<IngestError> }): IngestError {
  return { kind: "http", message: "synthetic failure", operation: "outlook.test", provider: "outlook", ...over };
}

describe("isGraphLink", () => {
  it("accepts a link on Graph's own https origin", () => {
    expect(isGraphLink({ link: "https://graph.microsoft.com/v1.0/me/messages?$skip=10" })).toBe(true);
  });

  it("refuses another host", () => {
    expect(isGraphLink({ link: "https://evil.example.test/v1.0/me/messages" })).toBe(false);
  });

  it("refuses a host that merely starts with Graph's name", () => {
    expect(isGraphLink({ link: "https://graph.microsoft.com.evil.example.test/v1.0" })).toBe(false);
  });

  it("refuses plain http on Graph's host", () => {
    expect(isGraphLink({ link: "http://graph.microsoft.com/v1.0/me/messages" })).toBe(false);
  });

  it("refuses a link carrying userinfo", () => {
    expect(isGraphLink({ link: "https://user:pw@graph.microsoft.com/v1.0/me/messages" })).toBe(false);
  });

  it("refuses a username-only link that would redirect trust", () => {
    expect(isGraphLink({ link: "https://graph.microsoft.com@evil.example.test/v1.0" })).toBe(false);
  });

  it("refuses a string that is not a URL at all", () => {
    expect(isGraphLink({ link: "not a url" })).toBe(false);
  });
});

describe("followable", () => {
  it("lets a first page through whatever it names", () => {
    expect(followable({ start: { first: { folderId: "inbox" } } }).isOk()).toBe(true);
  });

  it("lets a Graph link through", () => {
    expect(followable({ start: { link: "https://graph.microsoft.com/v1.0/next" } }).isOk()).toBe(true);
  });

  it("answers the link it checked, so a start that changes after the check cannot redirect the request", () => {
    let reads = 0;
    const shifting = {
      get link(): string {
        reads += 1;
        return reads === 1 ? "https://graph.microsoft.com/v1.0/next" : "https://evil.example.test/next";
      },
    };

    const allowed = unwrap(followable({ start: shifting }));

    expect(allowed).toEqual({ link: "https://graph.microsoft.com/v1.0/next" });
    expect(reads).toBe(1);
  });

  it("refuses a foreign link, naming it", () => {
    const refused = followable({ start: { link: "https://evil.example.test/next" } });

    expect(refused.isErr()).toBe(true);
    const error = unwrapErr(refused);
    expect(error.code).toBe("NEXT_LINK_REFUSED");
    expect(error.message).toContain("https://evil.example.test/next");
  });
});

describe("odataQuoted", () => {
  it("wraps a plain value in single quotes", () => {
    expect(odataQuoted({ value: "inbox" })).toBe("'inbox'");
  });

  it("doubles an embedded single quote", () => {
    expect(odataQuoted({ value: "O'Brien's" })).toBe("'O''Brien''s'");
  });

  it("quotes an empty value", () => {
    expect(odataQuoted({ value: "" })).toBe("''");
  });
});

describe("searchQuoted", () => {
  it("wraps the whole term in double quotes", () => {
    expect(searchQuoted({ query: "from:alice" })).toBe('"from:alice"');
  });

  it("escapes an embedded double quote", () => {
    expect(searchQuoted({ query: 'say "hi"' })).toBe('"say \\"hi\\""');
  });

  it("escapes a backslash before the quote so neither undoes the other", () => {
    expect(searchQuoted({ query: 'a\\"b' })).toBe('"a\\\\\\"b"');
  });
});

describe("writeFailure", () => {
  it("reads a 4xx as a write Graph refused, with no folder to check", () => {
    const error = writeFailure({
      check: "your Sent Items folder",
      error: ingest({ over: { message: "400 ErrorInvalidRecipients", status: 400 } }),
      operation: "outlook.drafts.send",
    });

    expect(error.code).toBe("API_FAILED");
    expect(error.message).toBe("400 ErrorInvalidRecipients");
  });

  it("reads the shared rate-limit block as refused, though it carries no status", () => {
    const error = writeFailure({
      check: "your Sent Items folder",
      error: ingest({ over: { kind: "rate-limit", message: "blocked until later" } }),
      operation: "outlook.drafts.send",
    });

    expect(error.code).toBe("API_FAILED");
  });

  it("reads a 5xx as an unknown outcome, naming the status and where to look", () => {
    const error = writeFailure({
      check: "your Sent Items folder",
      error: ingest({ over: { status: 503 } }),
      operation: "outlook.drafts.send",
    });

    expect(error.code).toBe("WRITE_OUTCOME_UNKNOWN");
    expect(error.message).toContain("Graph answered 503");
    expect(error.message).toContain("check your Sent Items folder before running it again");
  });

  it("reads a 2xx whose body would not parse as an unknown outcome, since Graph accepted the write", () => {
    const error = writeFailure({
      check: "your Drafts folder",
      error: ingest({ over: { kind: "parse", message: "Unexpected end of JSON input", status: 201 } }),
      operation: "outlook.drafts.create",
    });

    expect(error.code).toBe("WRITE_OUTCOME_UNKNOWN");
    expect(error.message).toContain("Graph answered 201");
    expect(error.message).toContain("check your Drafts folder");
  });

  it("reads no answer at all as an unknown outcome, carrying the transport's own message", () => {
    const error = writeFailure({
      check: "your Drafts folder",
      error: ingest({ over: { kind: "network", message: "socket hang up" } }),
      operation: "outlook.drafts.create",
    });

    expect(error.code).toBe("WRITE_OUTCOME_UNKNOWN");
    expect(error.message).toContain("socket hang up");
    expect(error.message).toContain("check your Drafts folder");
  });
});

describe("checkedWrite", () => {
  it("passes an answer its boundary accepts", () => {
    const message = unwrap(
      checkedWrite({
        boundary: MESSAGE,
        check: "the destination folder",
        operation: "outlook.messages.move",
        value: wireMessage({ id: "m1" }),
      }),
    );

    expect(message.id).toBe("m1");
  });

  it("names an accepted write whose answer drifted as an unknown outcome, never a plain failure", () => {
    const refused = checkedWrite({
      boundary: MESSAGE,
      check: "the destination folder",
      operation: "outlook.messages.move",
      value: { unexpected: true },
    });

    const error = unwrapErr(refused);
    expect(error.code).toBe("WRITE_OUTCOME_UNKNOWN");
    expect(error.message).toContain("Graph accepted it");
    expect(error.message).toContain("check the destination folder");
  });
});

describe("segment", () => {
  it("percent-encodes the characters an immutable id carries", () => {
    expect(segment({ id: "AAMk/ad+x=" })).toBe("AAMk%2Fad%2Bx%3D");
  });
});
