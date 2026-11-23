/**
 * The layout rules the queue card's Slack draft follows, each checked against the render Slack drew
 * (`../../lib/slackDraftLayout.ts` header names the messages).
 */
import { describe, expect, it } from "vitest";

import {
  attachmentsHeader,
  draftLinkPieces,
  draftTextPieces,
  drawnAs,
  paragraphPieces,
  predictedUnfurls,
  slackClock,
} from "../../lib/slackDraftLayout";

describe("predictedUnfurls", () => {
  it("draws a Linear issue as its key, once per distinct link, in first-seen order", () => {
    expect(
      predictedUnfurls({
        urls: [
          "https://linear.app/acme/issue/JJJJ-1669/staging-pool",
          "https://linear.app/acme/issue/JJJJ-1683",
          "https://linear.app/acme/issue/JJJJ-1669/staging-pool",
        ],
      }),
    ).toEqual([
      { key: "JJJJ-1669", kind: "linear-issue", url: "https://linear.app/acme/issue/JJJJ-1669/staging-pool" },
      { key: "JJJJ-1683", kind: "linear-issue", url: "https://linear.app/acme/issue/JJJJ-1683" },
    ]);
  });

  it("predicts nothing under a Datadog console link, on either site", () => {
    expect(
      predictedUnfurls({
        urls: ["https://ap1.datadoghq.com/logs?query=x", "https://app.datadoghq.eu/apm", "https://datadoghq.com/"],
      }),
    ).toEqual([]);
  });

  it("names a host nobody measured rather than drawing or dropping it", () => {
    expect(
      predictedUnfurls({
        urls: ["https://github.com/acme/acme-admin/pull/17870", "https://linear.app/acme/view/x"],
      }),
    ).toEqual([
      { host: "github.com", kind: "unmeasured", url: "https://github.com/acme/acme-admin/pull/17870" },
      { host: "linear.app", kind: "unmeasured", url: "https://linear.app/acme/view/x" },
    ]);
  });

  it("skips an address that is not a web link at all", () => {
    expect(predictedUnfurls({ urls: ["mailto:a@example.com", "not a url", "slack://open"] })).toEqual([]);
  });

  it("does not take a look-alike host for Datadog", () => {
    expect(predictedUnfurls({ urls: ["https://notdatadoghq.com/x"] }).map((u) => u.kind)).toEqual(["unmeasured"]);
  });
});

describe("attachmentsHeader", () => {
  it("captions one image with its own name, as Slack drew F0C48KM8VAB.png", () => {
    expect(attachmentsHeader({ files: ["F0C48KM8VAB.png"], unfurls: 0 })).toEqual({
      downloadAll: false,
      text: "F0C48KM8VAB.png",
    });
  });

  it("counts three images and offers Download all", () => {
    expect(attachmentsHeader({ files: ["a.png", "b.png", "c.png"], unfurls: 0 })).toEqual({
      downloadAll: true,
      text: "3 attachments",
    });
  });

  it("counts an unfurl as an attachment, without Download all for one file", () => {
    expect(attachmentsHeader({ files: ["a.png"], unfurls: 2 })).toEqual({ downloadAll: false, text: "3 attachments" });
  });

  it("draws no line for nothing attached, or for a lone unfurl", () => {
    expect([attachmentsHeader({ files: [], unfurls: 0 }), attachmentsHeader({ files: [], unfurls: 1 })]).toEqual([
      undefined,
      undefined,
    ]);
  });
});

describe("drawnAs", () => {
  it("draws a picture, a video and anything else by the name Slack reads its type from", () => {
    expect(
      ["a.PNG", "b.jpeg", "c.webp", "d.mov", "e.mp4", "f.pdf", "g.tiff", "noext"].map((name) => drawnAs({ name })),
    ).toEqual(["image", "image", "image", "video", "video", "file", "file", "file"]);
  });
});

describe("paragraphPieces", () => {
  it("splits at each paragraph break, keeping a trailing one as an empty last piece", () => {
    expect(paragraphPieces({ text: "one\n\ntwo\nstill two\n\n" })).toEqual(["one", "two\nstill two", ""]);
  });

  it("answers one piece for a run with no break", () => {
    expect(paragraphPieces({ text: "one line" })).toEqual(["one line"]);
  });
});

describe("draftTextPieces", () => {
  it("draws a standard shortcode as its emoji in a plain line and in a quote", () => {
    const plain = draftTextPieces({ code: false, frame: undefined, text: "ship :tada:" });
    const quoted = draftTextPieces({ code: false, frame: "quote", text: "ship :tada:" });
    expect([plain, quoted]).toEqual([
      [
        { kind: "text", text: "ship " },
        { glyph: "🎉", kind: "emoji", name: "tada", written: ":tada:" },
      ],
      [
        { kind: "text", text: "ship " },
        { glyph: "🎉", kind: "emoji", name: "tada", written: ":tada:" },
      ],
    ]);
  });

  it("keeps the shortcode as written in a code block, whose runs carry no code style of their own", () => {
    expect(draftTextPieces({ code: false, frame: "code", text: ":tada:" })).toEqual([{ kind: "text", text: ":tada:" }]);
  });

  it("keeps the shortcode as written in a run styled as inline code", () => {
    expect(draftTextPieces({ code: true, frame: undefined, text: ":tada:" })).toEqual([
      { kind: "text", text: ":tada:" },
    ]);
  });

  it("has no pieces for empty text, code or not", () => {
    expect([
      draftTextPieces({ code: false, frame: "code", text: "" }),
      draftTextPieces({ code: false, frame: undefined, text: "" }),
    ]).toEqual([[], []]);
  });
});

describe("draftLinkPieces", () => {
  it("draws the shortcodes in an authored label, in plain and quoted lines alike", () => {
    const drawn = [
      { kind: "text", text: "ship " },
      { glyph: "🎉", kind: "emoji", name: "tada", written: ":tada:" },
    ];
    expect([
      draftLinkPieces({ frame: undefined, label: "ship :tada:", url: "https://example.com" }),
      draftLinkPieces({ frame: "quote", label: "ship :tada:", url: "https://example.com" }),
    ]).toEqual([drawn, drawn]);
  });

  it("leaves a bare address, and any label inside a code block, exactly as written", () => {
    const url = "https://example.com/a:tada:b";
    expect([
      draftLinkPieces({ frame: undefined, label: url, url }),
      draftLinkPieces({ frame: "code", label: "ship :tada:", url: "https://example.com" }),
    ]).toEqual([[{ kind: "text", text: url }], [{ kind: "text", text: "ship :tada:" }]]);
  });
});

describe("slackClock", () => {
  it("writes the time as an English Slack client does, in the reader's zone", () => {
    expect(slackClock({ iso: "2026-09-27T23:29:00.000Z", timeZone: "Australia/Sydney" })).toBe("9:29 AM");
    expect(slackClock({ iso: "2026-09-28T05:05:00.000Z", timeZone: "UTC" })).toBe("5:05 AM");
  });
});
