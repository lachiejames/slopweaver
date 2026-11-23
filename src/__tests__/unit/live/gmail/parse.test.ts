/**
 * Unit: the pure Gmail MIME/header parsing. Every fixture is synthetic — no mailbox, no SDK, no network —
 * which is the point of keeping this layer separate from the API seam.
 */
import { describe, expect, it } from "vitest";
import { htmlToText } from "../../../../live/gmail/htmlToText.js";
import {
  decodeEncodedWords,
  extractAttachments,
  extractBodies,
  extractHtmlLinks,
  getHeader,
  MAX_HTML_LINKS,
  parseGmailMessage,
  splitAddresses,
} from "../../../../live/gmail/parse.js";

/** Encode text the way Gmail encodes a body part. */
const b64 = ({ text }: { text: string }): string => Buffer.from(text, "utf8").toString("base64url");

describe("getHeader", () => {
  it("matches a header name case-insensitively, which is what a bulk sender's all-caps header needs", () => {
    const headers = [{ name: "FROM", value: "Ada <ada@example.test>" }];
    expect(getHeader({ headers, name: "From" })).toBe("Ada <ada@example.test>");
  });

  it("returns undefined for an absent header rather than an empty string", () => {
    expect(getHeader({ headers: [{ name: "To", value: "x@example.test" }], name: "Cc" })).toBe(undefined);
  });

  it("returns undefined for a present-but-empty header", () => {
    expect(getHeader({ headers: [{ name: "Subject", value: "" }], name: "Subject" })).toBe(undefined);
  });

  it("returns undefined when the header list itself is absent", () => {
    expect(getHeader({ headers: undefined, name: "From" })).toBe(undefined);
    expect(getHeader({ headers: null, name: "From" })).toBe(undefined);
  });

  it("decodes an encoded word on the way out", () => {
    const headers = [{ name: "Subject", value: "=?UTF-8?B?SGVsbG8gd29ybGQ=?=" }];
    expect(getHeader({ headers, name: "Subject" })).toBe("Hello world");
  });
});

describe("decodeEncodedWords", () => {
  it("decodes the UTF-8 base64 form", () => {
    expect(decodeEncodedWords({ value: "=?UTF-8?B?w6lhdQ==?=" })).toBe("éau");
  });

  it("drops the FOLD between two adjacent encoded-words, which RFC 2047 says a reader ignores", () => {
    expect(decodeEncodedWords({ value: "=?UTF-8?B?w6k=?= =?UTF-8?B?w6A=?=" })).toBe("éà");
  });

  it("drops a fold written as a real line break too, which is how a long header actually arrives", () => {
    expect(decodeEncodedWords({ value: "=?UTF-8?B?w6k=?=\r\n =?UTF-8?B?w6A=?=" })).toBe("éà");
  });

  it("KEEPS whitespace between an encoded-word and ordinary text, where it is real", () => {
    expect(decodeEncodedWords({ value: "=?UTF-8?B?w6k=?= then plain" })).toBe("é then plain");
  });

  it("decodes the UTF-8 quoted-printable form, including underscore-as-space", () => {
    expect(decodeEncodedWords({ value: "=?utf-8?Q?Q1_report=E2=80=99s_status?=" })).toBe("Q1 report’s status");
  });

  it("leaves a non-UTF-8 charset verbatim rather than mangling it", () => {
    expect(decodeEncodedWords({ value: "=?ISO-8859-1?B?SGVsbG8=?=" })).toBe("=?ISO-8859-1?B?SGVsbG8=?=");
  });

  it("decodes several encoded words in one header", () => {
    expect(decodeEncodedWords({ value: "=?UTF-8?B?QQ==?= and =?UTF-8?B?Qg==?=" })).toBe("A and B");
  });

  it("leaves plain text untouched", () => {
    expect(decodeEncodedWords({ value: "Weekly sync notes" })).toBe("Weekly sync notes");
  });
});

describe("extractBodies", () => {
  it("finds text/plain nested two levels down under multipart wrappers", () => {
    const bodies = extractBodies({
      part: {
        mimeType: "multipart/mixed",
        parts: [
          {
            mimeType: "multipart/alternative",
            parts: [
              { body: { data: b64({ text: "plain body" }) }, mimeType: "text/plain" },
              { body: { data: b64({ text: "<p>rich body</p>" }) }, mimeType: "text/html" },
            ],
          },
        ],
      },
    });
    expect(bodies.text).toBe("plain body");
    expect(bodies.html).toBe("<p>rich body</p>");
  });

  it("keeps the FIRST text/plain, so a quoted part deeper in the tree cannot displace it", () => {
    const bodies = extractBodies({
      part: {
        mimeType: "multipart/mixed",
        parts: [
          { body: { data: b64({ text: "the reply" }) }, mimeType: "text/plain" },
          { body: { data: b64({ text: "the quoted original" }) }, mimeType: "text/plain" },
        ],
      },
    });
    expect(bodies.text).toBe("the reply");
  });

  it("passes over an earlier part that carries no data, so the first part WITH a body wins", () => {
    const bodies = extractBodies({
      part: {
        mimeType: "multipart/alternative",
        parts: [
          { mimeType: "text/plain" },
          { body: { data: b64({ text: "<p>rich</p>" }) }, mimeType: "text/html" },
          { body: { data: b64({ text: "second" }) }, mimeType: "text/plain" },
        ],
      },
    });
    expect(bodies).toStrictEqual({ html: "<p>rich</p>", text: "second" });
  });

  it("reads a single-part message whose body sits on the payload itself", () => {
    expect(extractBodies({ part: { body: { data: b64({ text: "just this" }) }, mimeType: "text/plain" } }).text).toBe(
      "just this",
    );
  });

  it("returns nothing for an absent payload", () => {
    expect(extractBodies({ part: undefined })).toStrictEqual({});
  });

  it("returns nothing for a part carrying no data", () => {
    expect(extractBodies({ part: { mimeType: "text/plain" } })).toStrictEqual({});
  });
});

describe("htmlToText", () => {
  it("drops tags, turns breaks into newlines and decodes the common entities", () => {
    expect(htmlToText({ html: "<p>Hi &amp; bye<br>line two</p>" })).toBe("Hi & bye\nline two");
  });

  it("drops a doctype declaration, which begins with neither a letter nor a slash", () => {
    expect(htmlToText({ html: "<!doctype html><p>Hello</p>" })).toBe("Hello");
  });

  it("drops an HTML comment whole", () => {
    expect(htmlToText({ html: "<p>Keep</p><!-- drop this --><p>And this</p>" })).toBe("Keep\n\nAnd this");
  });

  it("drops a CONDITIONAL comment including the > inside it, not just up to the first one", () => {
    // `<!--[if mso]>` contains a `>`, so closing on the first one would emit the branch a browser hides.
    expect(htmlToText({ html: "<!--[if mso]><table>Outlook only</table><![endif]--><p>Real</p>" })).toBe("Real");
  });

  it("ends the scan on a comment that is never closed, exactly as an unclosed tag does", () => {
    expect(htmlToText({ html: "<p>Kept</p><!-- never closed" })).toBe("Kept");
  });

  it("keeps a bare angle bracket that begins nothing markup-like", () => {
    expect(htmlToText({ html: "<p>5 <3 is false</p>" })).toBe("5 <3 is false");
  });

  it("removes script and style content entirely", () => {
    expect(htmlToText({ html: "<style>p{color:red}</style><p>visible</p>" })).toBe("visible");
  });

  it("does NOT double-unescape, so text an author escaped twice stays escaped", () => {
    // Sequential replaces turned `&amp;lt;` into `&lt;` and then into `<` — markup the author had escaped.
    expect(htmlToText({ html: "<p>&amp;lt;b&amp;gt;</p>" })).toBe("&lt;b&gt;");
  });

  it("removes a script whose end tag carries whitespace, which the old pattern missed", () => {
    expect(htmlToText({ html: "<p>before</p><script>evil()</script >after" })).toBe("before\n\nafter");
  });

  it("removes an UNCLOSED script's content rather than revealing it", () => {
    expect(htmlToText({ html: "<p>kept</p><script>secret()" })).toBe("kept");
  });

  it("leaves no TAG behind when one could be assembled out of what a pass removes", () => {
    // The property is "no `<…>` survives", not "the leftovers vanish". Removing `<scr<x>` leaves the inert
    // text `ipt>`, which is the right outcome: a second pass has no `<` to work with, so nothing can
    // reassemble into a tag. Asserted as the exact string rather than as an absence, so it stays falsifiable.
    expect(htmlToText({ html: "<scr<x>ipt>" })).toBe("ipt>");
  });

  it("leaves no MARKUP when a script tag is spelled through another tag, only inert text", () => {
    // `<scr<script>ipt>evil</script>` is the shape a pair-removing regex mangles into a live `<scr`. The
    // guarantee this function actually makes is narrower than "the content disappears" and is the one that
    // matters: no `<` survives, so nothing downstream can read a tag. The `ipt>evil` residue is plain text.
    const text = htmlToText({ html: "<p>kept</p><scr<script>ipt>evil</script>" });
    expect(text).toBe("kept\n\nipt>evil");
    expect(text.includes("<")).toBe(false);
  });

  it("drops an UNTERMINATED tag opener, which no complete-tag pass can match", () => {
    expect(htmlToText({ html: "<p>kept</p>trailing<script" })).toBe("kept\n\ntrailing");
  });

  it("leaves ordinary prose containing a bare `<` alone", () => {
    expect(htmlToText({ html: "<p>a &lt; b and 5 &lt;3</p>" })).toBe("a < b and 5 <3");
  });

  it("collapses a run of blank lines to one paragraph break", () => {
    expect(htmlToText({ html: "<div>a</div><div></div><div></div><div>b</div>" })).toBe("a\n\nb");
  });
});

describe("splitAddresses", () => {
  it("splits on commas", () => {
    expect(splitAddresses({ header: "a@example.test, b@example.test" })).toStrictEqual([
      "a@example.test",
      "b@example.test",
    ]);
  });

  it("does not split inside a quoted display name that contains a comma", () => {
    expect(splitAddresses({ header: '"Lovelace, Ada" <ada@example.test>, b@example.test' })).toStrictEqual([
      '"Lovelace, Ada" <ada@example.test>',
      "b@example.test",
    ]);
  });

  it("is empty for an absent header", () => {
    expect(splitAddresses({ header: undefined })).toStrictEqual([]);
  });
});

describe("extractAttachments", () => {
  it("collects a nested attachment's metadata and nothing else", () => {
    const attachments = extractAttachments({
      part: {
        mimeType: "multipart/mixed",
        parts: [
          { body: { data: b64({ text: "body" }) }, mimeType: "text/plain" },
          {
            body: { attachmentId: "att-1", size: 2048 },
            filename: "report.pdf",
            mimeType: "application/pdf",
          },
        ],
      },
    });
    expect(attachments).toStrictEqual([{ filename: "report.pdf", mimeType: "application/pdf", sizeBytes: 2048 }]);
  });

  it("ignores an inline part that has no filename", () => {
    expect(
      extractAttachments({ part: { body: { attachmentId: "att-2", size: 10 }, mimeType: "image/png" } }),
    ).toStrictEqual([]);
  });
});

describe("parseGmailMessage", () => {
  it("shapes a full message, decoding the subject and converting internalDate", () => {
    const parsed = parseGmailMessage({
      message: {
        id: "m1",
        internalDate: "1756300000000",
        labelIds: ["INBOX", "UNREAD"],
        payload: {
          body: { data: b64({ text: "the body" }) },
          headers: [
            { name: "From", value: "Ada <ada@example.test>" },
            { name: "To", value: "me@example.test" },
            { name: "Subject", value: "=?UTF-8?B?SGVsbG8=?=" },
          ],
          mimeType: "text/plain",
        },
        snippet: "the bod",
        threadId: "t1",
      },
    });
    expect(parsed!.subject).toBe("Hello");
    expect(parsed!.from).toBe("Ada <ada@example.test>");
    expect(parsed!.to).toStrictEqual(["me@example.test"]);
    expect(parsed!.body).toBe("the body");
    expect(parsed!.bodyFormat).toBe("text");
    expect(parsed!.sentAtIso).toBe("2025-08-27T13:06:40.000Z");
    expect(parsed!.labelIds).toStrictEqual(["INBOX", "UNREAD"]);
  });

  it("falls back to the flattened HTML body and says so", () => {
    const parsed = parseGmailMessage({
      message: {
        id: "m2",
        internalDate: "0",
        payload: { body: { data: b64({ text: "<p>only rich</p>" }) }, headers: [], mimeType: "text/html" },
        threadId: "t2",
      },
    });
    expect(parsed!.body).toBe("only rich");
    expect(parsed!.bodyFormat).toBe("html");
  });

  it("reports no readable body rather than inventing one", () => {
    const parsed = parseGmailMessage({ message: { id: "m3", internalDate: "0", threadId: "t3" } });
    expect(parsed!.body).toBe("");
    expect(parsed!.bodyFormat).toBe("none");
  });

  it("refuses a message with no id, because nothing could address it afterwards", () => {
    expect(parseGmailMessage({ message: { internalDate: "0", threadId: "t4" } })).toBe(undefined);
  });

  it("refuses a message with no threadId", () => {
    expect(parseGmailMessage({ message: { id: "m5", internalDate: "0" } })).toBe(undefined);
  });

  it("reports NO sent date when internalDate is absent, rather than dating it now or faking an empty one", () => {
    const parsed = parseGmailMessage({ message: { id: "m6", threadId: "t6" } });
    expect(parsed!.sentAtIso).toBe(undefined);
  });

  it("decodes the entities Gmail escapes its snippet with, so an apostrophe never reads as a numeric entity", () => {
    const parsed = parseGmailMessage({
      message: {
        id: "m8",
        internalDate: "0",
        snippet: "Thanks, I&#39;ll send the notes &amp; the &quot;draft&quot; &lt;today&gt;",
        threadId: "t8",
      },
    });
    expect(parsed!.snippet).toBe(`Thanks, I'll send the notes & the "draft" <today>`);
  });

  it("decodes a doubly-escaped snippet entity exactly once", () => {
    const parsed = parseGmailMessage({
      message: { id: "m9", internalDate: "0", snippet: "an author typed &amp;#39; literally", threadId: "t9" },
    });
    expect(parsed!.snippet).toBe("an author typed &#39; literally");
  });

  it("reports NO snippet when Gmail sent none, rather than an empty string", () => {
    const parsed = parseGmailMessage({ message: { id: "m10", internalDate: "0", snippet: null, threadId: "t10" } });
    expect(parsed!.snippet).toBe(undefined);
  });

  it("reports NO subject and NO sender when the headers are absent, rather than empty strings", () => {
    const parsed = parseGmailMessage({
      message: { id: "m7", internalDate: "0", payload: { headers: [] }, threadId: "t7" },
    });
    expect(parsed!.subject).toBe(undefined);
    expect(parsed!.from).toBe(undefined);
  });
});

describe("extractHtmlLinks", () => {
  it("lifts an absolute href out of the HTML part, which the plain-text alternative loses entirely", () => {
    const html = '<a href="https://docs.google.com/document/d/abc/edit">Open meeting notes</a>';
    expect(extractHtmlLinks({ html })).toEqual(["https://docs.google.com/document/d/abc/edit"]);
  });

  it("decodes the entity every query string in an attribute is escaped with", () => {
    const html = '<a href="https://example.test/x?a=1&amp;b=2">go</a>';
    expect(extractHtmlLinks({ html })).toEqual(["https://example.test/x?a=1&b=2"]);
  });

  it("decodes a doubly-escaped entity exactly once, so a link cannot arrive carrying markup", () => {
    // Sequential replaces turned `&amp;lt;` into `&lt;` on the ampersand pass and then into `<` on the next.
    const html = '<a href="https://example.test/x?q=&amp;lt;b&amp;gt;">go</a>';
    expect(extractHtmlLinks({ html })).toEqual(["https://example.test/x?q=&lt;b&gt;"]);
  });

  it("deduplicates, keeping document order", () => {
    const html = '<a href="https://a.test/1">a</a><a href="https://b.test/2">b</a><a href="https://a.test/1">a</a>';
    expect(extractHtmlLinks({ html })).toEqual(["https://a.test/1", "https://b.test/2"]);
  });

  it("takes only absolute http(s) targets, never a mailto or a fragment", () => {
    const html = '<a href="mailto:a@example.test">m</a><a href="#top">t</a><a href="https://a.test/1">a</a>';
    expect(extractHtmlLinks({ html })).toEqual(["https://a.test/1"]);
  });

  it("bounds what it lifts, so a message full of tracking URLs cannot bloat a parsed message", () => {
    const html = Array.from(
      { length: MAX_HTML_LINKS + 20 },
      (_unused, i) => `<a href="https://t.test/${String(i)}">x</a>`,
    ).join("");
    expect(extractHtmlLinks({ html }).length).toBe(MAX_HTML_LINKS);
  });

  it("is empty when the message carried no HTML part at all", () => {
    expect(extractHtmlLinks({ html: undefined })).toEqual([]);
  });
});
