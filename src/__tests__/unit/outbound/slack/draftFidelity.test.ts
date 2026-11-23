/**
 * What stops the queue card drawing a parked draft as Slack will — a bare citation marker in prose, and an
 * attachment whose name and bytes would not draw the same thing — over plain payloads and bytes.
 */
import { describe, expect, it } from "vitest";

import { draftFidelityProblems } from "../../../../outbound/slack/draftFidelity.js";
import type { SlackPlainMessagePayload, SlackRichMessagePayload } from "../../../../outbound/slack/types.js";

/** A plain draft carrying exactly these bytes. */
function plain({ text }: { text: string }): SlackPlainMessagePayload {
  return { form: "plain", text, unfurl_links: true, unfurl_media: true };
}

/** A rich draft whose one section quotes a paragraph and links a source under the given label. */
function rich({ label, quoted }: { label: string; quoted: string }): SlackRichMessagePayload {
  return {
    blocks: [
      {
        elements: [
          {
            elements: [
              { text: "see ", type: "text" },
              { text: label, type: "link", url: "https://linear.app/acme/issue/JJJJ-1669" },
            ],
            type: "rich_text_section",
          },
          { elements: [{ text: quoted, type: "text" }], type: "rich_text_quote" },
        ],
        type: "rich_text",
      },
    ],
    form: "rich",
    text: "notification fallback [9]",
    unfurl_links: true,
    unfurl_media: true,
  };
}

/** A rich draft holding one code-styled run and one preformatted block, each quoting an index. */
function richWithCode(): SlackRichMessagePayload {
  return {
    blocks: [
      {
        elements: [
          {
            elements: [
              { text: "read ", type: "text" },
              { style: { code: true }, text: "items[0]", type: "text" },
            ],
            type: "rich_text_section",
          },
          { elements: [{ text: "ERROR [123] pool exhausted", type: "text" }], type: "rich_text_preformatted" },
        ],
        type: "rich_text",
      },
    ],
    form: "rich",
    text: "read items",
    unfurl_links: true,
    unfurl_media: true,
  };
}

/** The first bytes of each format the cases use. */
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const TIFF_LE = Uint8Array.from([0x49, 0x49, 0x2a, 0x00, 0x08]);
const TIFF_BE = Uint8Array.from([0x4d, 0x4d, 0x00, 0x2a, 0x00]);
const BIGTIFF_BE = Uint8Array.from([0x4d, 0x4d, 0x00, 0x2b, 0x00, 0x00, 0x00, 0x08]);
const PDF = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d]);
/** A whole sixteen-byte `ftyp` box naming the `isom` video brand — what admission identifies as a video. */
const MP4 = Uint8Array.from([0, 0, 0, 0x10, ...Buffer.from("ftypisom"), 0, 0, 0, 0]);

/** Text that opens with a format's first bytes — admission carries each as a text document. */
const TEXT_OPENING_LIKE: readonly { readonly filename: string; readonly bytes: Uint8Array }[] = [
  { bytes: Uint8Array.from([0xff, 0xd8, 0xff, ...Buffer.from(" notes")]), filename: "notes.jpg" },
  { bytes: Uint8Array.from(Buffer.from("GIF89a is the format")), filename: "notes.gif" },
  { bytes: Uint8Array.from(Buffer.from("BMI,weight,height")), filename: "data.bmp" },
  { bytes: Uint8Array.from(Buffer.from("RIFFabcdWEBPhello")), filename: "x.webp" },
  { bytes: Uint8Array.from(Buffer.from("abcdftypisom and more")), filename: "clip.mp4" },
];

/** The codes and first message words for one upload batch under an ordinary text. */
function attachmentVerdicts({
  uploads,
}: {
  uploads: readonly { readonly filename: string; readonly bytes: Uint8Array }[];
}): readonly string[] {
  return draftFidelityProblems({ payload: plain({ text: "scans" }), uploads }).map(
    (p) => `${p.code} ${p.message.split(" ")[0]!}`,
  );
}

describe("draftFidelityProblems", () => {
  it("answers nothing for a draft whose sources are labelled links and whose pictures a browser draws", () => {
    expect(
      draftFidelityProblems({
        payload: rich({ label: "the ticket", quoted: "pool exhausted" }),
        uploads: [{ bytes: PNG, filename: "graph.png" }],
      }),
    ).toEqual([]);
  });

  it("refuses a bare number in plain bytes, naming the marker", () => {
    const problems = draftFidelityProblems({ payload: plain({ text: "p95 doubled [12]" }), uploads: [] });
    expect(problems.map((p) => p.code)).toEqual(["BARE_CITATION"]);
    expect(problems[0]!.message).toContain('"[12]" is a bare citation marker');
  });

  it("refuses the list, range and footnote shapes of a bare citation", () => {
    expect(
      ["as measured [1, 2]", "as measured [1-3]", "as measured [^1]"].map(
        (text) => draftFidelityProblems({ payload: plain({ text }), uploads: [] })[0]!.message.split(" is ")[0],
      ),
    ).toEqual(['"[1, 2]"', '"[1-3]"', '"[^1]"']);
  });

  it("refuses the padded, semicolon, em-dash, named-footnote, source-dagger and CJK shapes", () => {
    expect(
      ["a [ 1 ]", "a [1; 2]", "a [1—3]", "a [^note]", "a [1†source]", "a 【1】"].map(
        (text) => draftFidelityProblems({ payload: plain({ text }), uploads: [] })[0]!.message.split(" is ")[0],
      ),
    ).toEqual(['"[ 1 ]"', '"[1; 2]"', '"[1—3]"', '"[^note]"', '"[1†source]"', '"【1】"']);
  });

  it("refuses a list padded by several spaces and a footnote name carrying an underscore", () => {
    expect(
      ["a [1,  2]", "a [^my_note]"].map(
        (text) => draftFidelityProblems({ payload: plain({ text }), uploads: [] })[0]!.message.split(" is ")[0],
      ),
    ).toEqual(['"[1,  2]"', '"[^my_note]"']);
  });

  it("refuses a plain draft's mrkdwn-styled and fullwidth markers, and leaves a styled bracketed word alone", () => {
    expect(
      ["p95 doubled [*2*]", "p95 doubled [_2_]", "p95 doubled [~2~]", "p95 doubled ［1］", "see [*draft*]"].map(
        (text) => draftFidelityProblems({ payload: plain({ text }), uploads: [] }).length,
      ),
    ).toEqual([1, 1, 1, 1, 0]);
  });

  it("refuses a model's file-search marker and a fullwidth-digit marker", () => {
    expect(
      ["as found 【4:0†source】", "as found [4:0†source]", "as found 【4:0†runbook.md】", "as found ［１］"].map(
        (text) => draftFidelityProblems({ payload: plain({ text }), uploads: [] }).length,
      ),
    ).toEqual([1, 1, 1, 1]);
  });

  it("refuses Codex's file and terminal-chunk citations and a fullwidth-colon marker, naming the whole marker", () => {
    expect(
      ["see 【F:src/a.ts†L308-L309】", "see 【a1b2c3†L1-L4】", "see ［１：０†source］"].map(
        (text) => draftFidelityProblems({ payload: plain({ text }), uploads: [] })[0]!.message.split(" is a ")[0],
      ),
    ).toEqual(['"【F:src/a.ts†L308-L309】"', '"【a1b2c3†L1-L4】"', '"［１：０†source］"']);
  });

  it("reads a marker split across styled runs as the one marker it draws", () => {
    const split: SlackRichMessagePayload = {
      blocks: [
        {
          elements: [
            {
              elements: [
                { text: "as measured [", type: "text" },
                { style: { bold: true }, text: "2", type: "text" },
                { text: "]", type: "text" },
              ],
              type: "rich_text_section",
            },
          ],
          type: "rich_text",
        },
      ],
      form: "rich",
      text: "as measured",
      unfurl_links: true,
      unfurl_media: true,
    };
    expect(draftFidelityProblems({ payload: split, uploads: [] }).map((p) => p.message.split(" ")[0])).toEqual([
      '"[2]"',
    ]);
  });

  it("finds a bare number as a link's label and inside a nested quote, one problem per string", () => {
    expect(
      draftFidelityProblems({ payload: rich({ label: "[1]", quoted: "as measured [2]" }), uploads: [] }).map(
        (p) => p.message.split(" ")[0],
      ),
    ).toEqual(['"[1]"', '"[2]"']);
  });

  it("never reads the rich draft's notification fallback, which the message does not draw", () => {
    expect(draftFidelityProblems({ payload: rich({ label: "the ticket", quoted: "ok" }), uploads: [] })).toEqual([]);
  });

  it("leaves a bracketed word and a four-digit year alone", () => {
    expect(draftFidelityProblems({ payload: plain({ text: "[draft] shipped in [2026]" }), uploads: [] })).toEqual([]);
  });

  it("leaves an index inside a code-styled run or a preformatted block alone", () => {
    expect(draftFidelityProblems({ payload: richWithCode(), uploads: [] })).toEqual([]);
  });

  it("leaves an index inside plain inline or fenced code alone, and still reads the prose around it", () => {
    expect(
      draftFidelityProblems({ payload: plain({ text: "read `items[0]` then\n```\nERROR [123]\n```" }), uploads: [] }),
    ).toEqual([]);
    expect(
      draftFidelityProblems({ payload: plain({ text: "read `items[0]` as cited [4]" }), uploads: [] }).map(
        (p) => p.code,
      ),
    ).toEqual(["BARE_CITATION"]);
  });

  it("refuses a TIFF in either byte order and either version word, whatever it is named", () => {
    expect(
      attachmentVerdicts({
        uploads: [
          { bytes: TIFF_LE, filename: "a.tif" },
          { bytes: PNG, filename: "b.png" },
          { bytes: TIFF_BE, filename: "c.tiff" },
          { bytes: BIGTIFF_BE, filename: "shot.png" },
        ],
      }),
    ).toEqual(["UNDRAWABLE_ATTACHMENT a.tif", "UNDRAWABLE_ATTACHMENT c.tiff", "UNDRAWABLE_ATTACHMENT shot.png"]);
  });

  it("refuses text that opens like a picture or a video, which admission carried as a document", () => {
    expect(attachmentVerdicts({ uploads: TEXT_OPENING_LIKE })).toEqual([
      "UNDRAWABLE_ATTACHMENT notes.jpg",
      "UNDRAWABLE_ATTACHMENT notes.gif",
      "UNDRAWABLE_ATTACHMENT data.bmp",
      "UNDRAWABLE_ATTACHMENT x.webp",
      "UNDRAWABLE_ATTACHMENT clip.mp4",
    ]);
    expect(
      draftFidelityProblems({ payload: plain({ text: "x" }), uploads: [TEXT_OPENING_LIKE[1]!] })[0]!.message,
    ).toContain("notes.gif opens like an image but is not one admission proved");
  });

  it("refuses a picture whose name does not say so, which the card would draw as a file", () => {
    const problems = draftFidelityProblems({
      payload: plain({ text: "graph" }),
      uploads: [{ bytes: PNG, filename: "shot" }],
    });
    expect(problems.map((p) => p.code)).toEqual(["UNDRAWABLE_ATTACHMENT"]);
    expect(problems[0]!.message).toContain("shot is an image whose name does not say so");
  });

  it("refuses a name promising a picture over bytes no browser draws", () => {
    expect(
      draftFidelityProblems({
        payload: plain({ text: "graph" }),
        uploads: [{ bytes: PDF, filename: "graph.png" }],
      })[0]!.message,
    ).toContain("graph.png is named as an image but its bytes are not one a browser draws inline");
  });

  it("refuses a video named as a picture", () => {
    expect(
      draftFidelityProblems({
        payload: plain({ text: "walkthrough" }),
        uploads: [{ bytes: MP4, filename: "walkthrough.png" }],
      })[0]!.message,
    ).toContain("walkthrough.png is named as an image but its bytes are a video");
  });

  it("accepts a document named as one, and a video named as one", () => {
    expect(
      attachmentVerdicts({
        uploads: [
          { bytes: PDF, filename: "runbook.pdf" },
          { bytes: MP4, filename: "walkthrough.mp4" },
        ],
      }),
    ).toEqual([]);
  });

  it("answers nothing for an upload shorter than a signature under a name that draws a file", () => {
    expect(attachmentVerdicts({ uploads: [{ bytes: Uint8Array.from([0x49]), filename: "x" }] })).toEqual([]);
  });
});
