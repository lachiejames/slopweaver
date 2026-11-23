/**
 * The Gmail guard's MIME adapter over the pinned `postal-mime`, proven on hand-built messages: what a raw draft is
 * judged by, field by field, and every way it refuses rather than passing unjudged — malformed base64url, a parser
 * refusal, a text-like attachment that is not UTF-8, forwarded messages nested past the bound. One case pins a STATED
 * residue (a multipart preamble is not exposed), so a parser upgrade that starts exposing it shows up here. Pure: no
 * filesystem, no network. Synthetic names throughout.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  decodeBase64UrlStrict,
  type GmailWriteLeaf,
  gmailRawMimeLeaves,
  MAX_ATTACHED_MESSAGE_DEPTH,
} from "../../../../outbound/gmail/mimePrivacyPayload.js";

const LOCUS = "gmail drafts.create message.raw";

/** A message's text as Gmail's `raw` carries it: base64url, unpadded. */
const raw = ({ text }: { text: string }): string => Buffer.from(text, "utf8").toString("base64url");

/** CRLF-joined lines, the shape a MIME message is sent in. */
const lines = (...parts: string[]): string => parts.join("\r\n");

/** The leaves of a message, unwrapped. */
async function leavesOf({ text }: { text: string }): Promise<readonly GmailWriteLeaf[]> {
  return unwrap(await gmailRawMimeLeaves({ locus: LOCUS, raw: raw({ text }) }));
}

/** Just the texts of the leaves under one locus suffix. */
function textsAt({ leaves, suffix }: { leaves: readonly GmailWriteLeaf[]; suffix: string }): readonly string[] {
  return leaves.filter((leaf) => leaf.locus === `${LOCUS} ${suffix}`).map((leaf) => leaf.text);
}

describe("decodeBase64UrlStrict", () => {
  it("decodes unpadded and padded base64url to the same bytes", () => {
    expect(Buffer.from(unwrap(decodeBase64UrlStrict({ locus: LOCUS, text: "aGk" }))).toString("utf8")).toBe("hi");
    expect(Buffer.from(unwrap(decodeBase64UrlStrict({ locus: LOCUS, text: "aGk=" }))).toString("utf8")).toBe("hi");
  });

  it("refuses standard base64's alphabet, a stray character, and a tail no re-encode reproduces", () => {
    const refusal = ({ text }: { text: string }): readonly string[] => {
      const refused = unwrapErr(decodeBase64UrlStrict({ locus: LOCUS, text }));
      return [refused.code, refused.message];
    };
    const notBase64Url = ["RAW_NOT_BASE64URL", `${LOCUS}: a raw message that is not base64url, so it cannot be judged`];
    const notClean = [
      "RAW_NOT_CLEAN",
      `${LOCUS}: a raw message whose base64url does not decode cleanly, so it cannot be judged`,
    ];
    expect(refusal({ text: "a+/b" })).toEqual(notBase64Url);
    expect(refusal({ text: "aG k" })).toEqual(notBase64Url);
    expect(refusal({ text: "aGk=x" })).toEqual(notBase64Url);
    expect(refusal({ text: "aGl" })).toEqual(notClean);
    expect(refusal({ text: "a" })).toEqual(notClean);
  });
});

describe("gmailRawMimeLeaves: headers and addresses", () => {
  it("judges the decoded subject, every address and display name, a group, and other headers decoded", async () => {
    const leaves = await leavesOf({
      text: lines(
        "From: Quill Owner <owner@acme.test>",
        "To: Zed <zed@acme.test>, crew: a@acme.test, b@acme.test;",
        "Cc: cc@acme.test",
        "Bcc: hidden@acme.test",
        "Reply-To: replies@acme.test",
        "Subject: =?utf-8?q?Hello_there?=",
        `X-Note: =?utf-8?b?${Buffer.from("a note", "utf8").toString("base64")}?=`,
        "",
        "body line",
        "",
      ),
    });
    expect(leaves).toEqual([
      { locus: `${LOCUS} subject`, text: "Hello there" },
      { locus: `${LOCUS} from.name`, text: "Quill Owner" },
      { locus: `${LOCUS} from.address`, text: "owner@acme.test" },
      { locus: `${LOCUS} replyTo[0].name`, text: "" },
      { locus: `${LOCUS} replyTo[0].address`, text: "replies@acme.test" },
      { locus: `${LOCUS} to[0].name`, text: "Zed" },
      { locus: `${LOCUS} to[0].address`, text: "zed@acme.test" },
      { locus: `${LOCUS} to[1].name`, text: "crew" },
      { locus: `${LOCUS} to[1].group[0].name`, text: "" },
      { locus: `${LOCUS} to[1].group[0].address`, text: "a@acme.test" },
      { locus: `${LOCUS} to[1].group[1].name`, text: "" },
      { locus: `${LOCUS} to[1].group[1].address`, text: "b@acme.test" },
      { locus: `${LOCUS} cc[0].name`, text: "" },
      { locus: `${LOCUS} cc[0].address`, text: "cc@acme.test" },
      { locus: `${LOCUS} bcc[0].name`, text: "" },
      { locus: `${LOCUS} bcc[0].address`, text: "hidden@acme.test" },
      { locus: `${LOCUS} header.x-note`, text: "a note" },
      { locus: `${LOCUS} text`, text: "body line\n" },
    ]);
  });

  it("keeps a recipient with no address as its display name rather than dropping it", async () => {
    const leaves = await leavesOf({ text: lines("To: quillfeather", "", "b", "") });
    expect(textsAt({ leaves, suffix: "to[0].name" })).toEqual(["quillfeather"]);
  });
});

describe("gmailRawMimeLeaves: bodies and attachments", () => {
  const boundary = "zz-boundary";
  const inner = "yy-inner";
  const mixed = lines(
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    `Content-Type: multipart/alternative; boundary="${inner}"`,
    "",
    `--${inner}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    "plain body",
    `--${inner}`,
    "Content-Type: text/html; charset=utf-8",
    "",
    "<p>html <b>bo</b>dy</p>",
    `--${inner}--`,
    `--${boundary}`,
    'Content-Type: text/plain; name="notes.txt"',
    'Content-Disposition: attachment; filename="notes.txt"',
    "Content-Description: =?utf-8?q?the_notes?=",
    "",
    "attached notes",
    `--${boundary}`,
    "Content-Type: image/png",
    'Content-Disposition: attachment; filename="chart.png"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from("pixels that say zorvane", "utf8").toString("base64"),
    `--${boundary}`,
    "Content-Type: text/csv",
    "Content-Disposition: attachment",
    "",
    "a,b",
    `--${boundary}--`,
    "",
  );

  it("judges every text part, the HTML reduced to text, and each attachment's metadata", async () => {
    const leaves = await leavesOf({ text: mixed });
    expect(textsAt({ leaves, suffix: "text" })).toEqual(["plain body"]);
    expect(textsAt({ leaves, suffix: "html" })).toEqual(["<p>html <b>bo</b>dy</p>"]);
    expect(textsAt({ leaves, suffix: "html as text" })).toEqual(["html body"]);
    expect(leaves.filter((leaf) => leaf.locus.includes("attachments["))).toEqual([
      { locus: `${LOCUS} attachments[0].mimeType`, text: "text/plain" },
      { locus: `${LOCUS} attachments[0].filename`, text: "notes.txt" },
      { locus: `${LOCUS} attachments[0].disposition`, text: "attachment" },
      { locus: `${LOCUS} attachments[0].description`, text: "the notes" },
      { locus: `${LOCUS} attachments[0]`, text: "attached notes" },
      { locus: `${LOCUS} attachments[1].mimeType`, text: "image/png" },
      { locus: `${LOCUS} attachments[1].filename`, text: "chart.png" },
      { locus: `${LOCUS} attachments[1].disposition`, text: "attachment" },
      { locus: `${LOCUS} attachments[2].mimeType`, text: "text/csv" },
      { locus: `${LOCUS} attachments[2].disposition`, text: "attachment" },
      { locus: `${LOCUS} attachments[2]`, text: "a,b" },
    ]);
  });

  it("never reads an image's bytes: text drawn into it is the stated residue", async () => {
    const leaves = await leavesOf({ text: mixed });
    expect(leaves.some((leaf) => leaf.text.includes("zorvane"))).toBe(false);
  });

  it("refuses a text-like attachment that is not valid UTF-8", async () => {
    const message = lines(
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      'Content-Type: application/octet-stream; name="data.json"',
      'Content-Disposition: attachment; filename="data.json"',
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from([0xff, 0xfe, 0xfd]).toString("base64"),
      `--${boundary}--`,
      "",
    );
    const { message: refused } = unwrapErr(await gmailRawMimeLeaves({ locus: LOCUS, raw: raw({ text: message }) }));
    expect(refused).toBe(
      `${LOCUS} attachments[0]: a text-like attachment that is not valid UTF-8, so it cannot be judged`,
    );
  });

  it("opens a forwarded message attachment and judges it like the message carrying it", async () => {
    const forwarded = lines("Subject: forwarded subject", "To: fwd@acme.test", "", "forwarded body", "");
    const message = lines(
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: message/rfc822",
      'Content-Disposition: attachment; filename="old.eml"',
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from(forwarded, "utf8").toString("base64"),
      `--${boundary}--`,
      "",
    );
    const leaves = await leavesOf({ text: message });
    expect(textsAt({ leaves, suffix: "attachments[0].message subject" })).toEqual(["forwarded subject"]);
    expect(textsAt({ leaves, suffix: "attachments[0].message to[0].address" })).toEqual(["fwd@acme.test"]);
    expect(textsAt({ leaves, suffix: "attachments[0].message text" })).toEqual(["forwarded body\n"]);
  });

  it(`refuses forwarded messages nested more than ${String(MAX_ATTACHED_MESSAGE_DEPTH)} deep`, async () => {
    let message = lines("Subject: innermost", "", "deep", "");
    for (let level = 0; level <= MAX_ATTACHED_MESSAGE_DEPTH; level += 1) {
      message = lines(
        `Content-Type: multipart/mixed; boundary="b${String(level)}"`,
        "",
        `--b${String(level)}`,
        "Content-Type: message/rfc822",
        "Content-Disposition: attachment",
        "Content-Transfer-Encoding: base64",
        "",
        Buffer.from(message, "utf8").toString("base64"),
        `--b${String(level)}--`,
        "",
      );
    }
    const { message: refused } = unwrapErr(await gmailRawMimeLeaves({ locus: LOCUS, raw: raw({ text: message }) }));
    expect(refused).toContain(`forwarded messages nested more than ${String(MAX_ATTACHED_MESSAGE_DEPTH)} deep`);
  });
});

describe("gmailRawMimeLeaves: malformed input", () => {
  it("refuses a raw that is not base64url before parsing anything", async () => {
    const { message: refused } = unwrapErr(await gmailRawMimeLeaves({ locus: LOCUS, raw: "Subject: plain text" }));
    expect(refused).toBe(`${LOCUS}: a raw message that is not base64url, so it cannot be judged`);
  });

  it("refuses a message the parser rejects, naming why", async () => {
    let message = "";
    for (let level = 0; level < 300; level += 1) {
      message += lines(`Content-Type: multipart/mixed; boundary="b${String(level)}"`, "", `--b${String(level)}`, "");
    }
    const { message: refused } = unwrapErr(await gmailRawMimeLeaves({ locus: LOCUS, raw: raw({ text: message }) }));
    expect(refused).toBe(
      `${LOCUS}: a MIME message the parser refused (Maximum MIME nesting depth of 256 levels exceeded), so it cannot be judged`,
    );
  });

  it("judges a body with no header section as text, rather than losing it", async () => {
    const leaves = await leavesOf({ text: "no headers, just quillfeather\r\n" });
    expect(leaves).toEqual([{ locus: `${LOCUS} text`, text: "no headers, just quillfeather\n" }]);
  });

  it("does not expose a multipart preamble: the stated residue", async () => {
    const leaves = await leavesOf({
      text: lines(
        'Content-Type: multipart/mixed; boundary="p"',
        "",
        "preamble zorvane",
        "--p",
        "Content-Type: text/plain",
        "",
        "body",
        "--p--",
        "",
      ),
    });
    expect(textsAt({ leaves, suffix: "text" })).toEqual(["body"]);
    expect(leaves.some((leaf) => leaf.text.includes("zorvane"))).toBe(false);
  });
});
