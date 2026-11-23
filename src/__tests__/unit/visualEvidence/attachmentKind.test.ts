/**
 * `attachmentKindOf` — the allowlist that decides which undecodable bytes this door carries anyway.
 *
 * The cases that matter are the REFUSALS. A WebP, an AVIF, a HEIC and an SVG are all pictures Slack renders
 * and the pinned Jimp cannot decode, so each one is a witness against the rule this module was nearly
 * written as: "undecodable, therefore not an image, therefore send it".
 */
import { describe, expect, it } from "vitest";

import { attachmentKindOf } from "../../../visualEvidence/attachmentKind.js";

/**
 * Every case declares the ONE name the door reads, so a refusal below is the bytes' doing and never the name's:
 * the HTML-briefing condition on the name already holds, and still nothing else markup-shaped is carried.
 */
const AS_HTML = "briefing.html";

/** A real 2x2 PNG, so the "a picture is never a document" case is not asserted against invented bytes. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAE0lEQVR4AWP8z8DwnwEKmBigAAAfFwICgH3ifwAAAABJRU5ErkJggg==",
  "base64",
);

/** A RIFF/WEBP head — the exact shape `jimp@1.6.1` answers "does not support decoding" for. */
const WEBP = Buffer.concat([
  Buffer.from("RIFF", "ascii"),
  Buffer.from([0x1a, 0x00, 0x00, 0x00]),
  Buffer.from("WEBPVP8L", "ascii"),
  Buffer.alloc(10),
]);

/** An ISO-BMFF head, whose brand is the only thing separating an AVIF from a HEIC. */
const isoBmff = ({ brand }: { brand: string }): Buffer =>
  Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x18]), Buffer.from(`ftyp${brand}`, "ascii"), Buffer.alloc(8)]);

describe("attachmentKindOf names what this door carries", () => {
  it("names a PDF", () => {
    expect(attachmentKindOf({ filename: AS_HTML, bytes: Buffer.from("%PDF-1.4\n1 0 obj\n", "utf8") })).toBe("pdf");
  });

  it("names a zip container, which is every modern office format", () => {
    expect(attachmentKindOf({ filename: AS_HTML, bytes: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]) })).toBe(
      "zip-container",
    );
  });

  it("names a legacy OLE2 compound file", () => {
    expect(
      attachmentKindOf({
        filename: AS_HTML,
        bytes: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00]),
      }),
    ).toBe("ole2");
  });

  it("names a gzip", () => {
    expect(attachmentKindOf({ filename: AS_HTML, bytes: Buffer.from([0x1f, 0x8b, 0x08, 0x00]) })).toBe("gzip");
  });

  it("names an RTF", () => {
    expect(attachmentKindOf({ filename: AS_HTML, bytes: Buffer.from("{\\rtf1\\ansi ", "utf8") })).toBe("rtf");
  });

  it("names markdown and CSV as text", () => {
    expect(
      attachmentKindOf({ filename: AS_HTML, bytes: Buffer.from("# the pentest report\n\nfindings\n", "utf8") }),
    ).toBe("text");
    expect(attachmentKindOf({ filename: AS_HTML, bytes: Buffer.from("alert,count\nfoo,3\n", "utf8") })).toBe("text");
  });

  it("matches a signature at offset 0 ONLY, so a PDF quoted inside prose is judged as its own bytes", () => {
    expect(attachmentKindOf({ filename: AS_HTML, bytes: Buffer.from("see the %PDF-1.4 header\n", "utf8") })).toBe(
      "text",
    );
  });

  it("refuses a truncated signature rather than guessing", () => {
    expect(attachmentKindOf({ filename: AS_HTML, bytes: Buffer.from("%PDF", "utf8") })).toBe("text");
    expect(attachmentKindOf({ filename: AS_HTML, bytes: Buffer.from([0x50, 0x4b, 0x03]) })).toBeUndefined();
  });
});

describe("attachmentKindOf refuses every picture, decodable or not", () => {
  it("refuses a real PNG", () => {
    expect(attachmentKindOf({ filename: AS_HTML, bytes: PNG })).toBeUndefined();
  });

  it("refuses a WebP, which Slack renders and Jimp cannot read", () => {
    expect(attachmentKindOf({ filename: AS_HTML, bytes: WEBP })).toBeUndefined();
  });

  it("refuses an AVIF and a HEIC for the same reason", () => {
    expect(attachmentKindOf({ filename: AS_HTML, bytes: isoBmff({ brand: "avif" }) })).toBeUndefined();
    expect(attachmentKindOf({ filename: AS_HTML, bytes: isoBmff({ brand: "heic" }) })).toBeUndefined();
  });

  it("refuses an SVG, which is the one picture that is also text", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4"/></svg>';
    expect(attachmentKindOf({ filename: AS_HTML, bytes: Buffer.from(svg, "utf8") })).toBeUndefined();
  });

  it("refuses an SVG behind a byte-order mark and leading blank lines", () => {
    expect(
      attachmentKindOf({ filename: AS_HTML, bytes: Buffer.from("﻿\n  \t<svg width='1'></svg>", "utf8") }),
    ).toBeUndefined();
  });

  // The head-window defect, kept as a case: a draft decoded the first kibibyte and trimmed it, so a
  // kibibyte of leading whitespace trimmed to "", failed the `<` test, and carried the SVG behind it.
  it("refuses an SVG behind MORE leading whitespace than any head window would cover", () => {
    const padded = `${" ".repeat(4096)}<svg xmlns="http://www.w3.org/2000/svg"><rect width="4"/></svg>`;
    expect(attachmentKindOf({ filename: AS_HTML, bytes: Buffer.from(padded, "utf8") })).toBeUndefined();
  });

  it("refuses XML, even named .html — only an HTML opener is carried", () => {
    expect(
      attachmentKindOf({ bytes: Buffer.from('<?xml version="1.0"?><doc/>', "utf8"), filename: AS_HTML }),
    ).toBeUndefined();
  });
});

const BRIEFING = '<!doctype html>\n<html lang="en"><head><title>b</title></head><body><p>hi</p></body></html>\n';

describe("attachmentKindOf carries an HTML briefing, and only one holding no svg or script tag", () => {
  it("carries a doctype-opened briefing named .html", () => {
    expect(attachmentKindOf({ bytes: Buffer.from(BRIEFING, "utf8"), filename: "briefing.html" })).toBe("html");
  });

  it("carries one opening on <html> behind a BOM, in any case, with an upper-case name", () => {
    const bytes = Buffer.from('﻿\n<HTML lang="en"><body>hi</body></HTML>', "utf8");
    expect(attachmentKindOf({ bytes, filename: "Briefing.HTML" })).toBe("html");
  });

  it("refuses the same bytes under any other name, so the name is a condition and never the route", () => {
    const bytes = Buffer.from(BRIEFING, "utf8");
    expect(attachmentKindOf({ bytes, filename: "briefing.htm" })).toBeUndefined();
    expect(attachmentKindOf({ bytes, filename: "briefing.svg" })).toBeUndefined();
    expect(attachmentKindOf({ bytes, filename: "briefing.html.txt" })).toBeUndefined();
  });

  it("refuses an SVG named .html, which opens on no HTML tag", () => {
    expect(
      attachmentKindOf({ bytes: Buffer.from("<svg width='1'></svg>", "utf8"), filename: AS_HTML }),
    ).toBeUndefined();
  });

  it("refuses a tag that only STARTS like <html", () => {
    expect(attachmentKindOf({ bytes: Buffer.from("<htmlx></htmlx>", "utf8"), filename: AS_HTML })).toBeUndefined();
  });

  it("refuses a briefing carrying an <svg anywhere, in any case", () => {
    const inline = BRIEFING.replace("<p>hi</p>", '<p>hi</p><SvG width="1"></SvG>');
    expect(attachmentKindOf({ bytes: Buffer.from(inline, "utf8"), filename: AS_HTML })).toBeUndefined();
  });

  it("refuses a briefing carrying a <script anywhere, in any case", () => {
    const inline = BRIEFING.replace("<p>hi</p>", "<p>hi</p><SCRIPT>1</SCRIPT>");
    expect(attachmentKindOf({ bytes: Buffer.from(inline, "utf8"), filename: AS_HTML })).toBeUndefined();
  });

  it("carries a briefing that only MENTIONS svg in prose, since no tag opens", () => {
    const prose = BRIEFING.replace("<p>hi</p>", "<p>an svg or a script</p>");
    expect(attachmentKindOf({ bytes: Buffer.from(prose, "utf8"), filename: AS_HTML })).toBe("html");
  });
});

describe("attachmentKindOf refuses what it cannot name", () => {
  it("refuses an empty file, which is neither a picture nor a deliverable", () => {
    expect(attachmentKindOf({ filename: AS_HTML, bytes: new Uint8Array(0) })).toBeUndefined();
  });

  it("refuses text carrying a NUL, which is how unnamed binary announces itself", () => {
    expect(attachmentKindOf({ filename: AS_HTML, bytes: Buffer.from("report\u0000data", "utf8") })).toBeUndefined();
  });

  it("refuses a lone control byte below 0x20 that is not tab, newline or carriage return", () => {
    expect(attachmentKindOf({ filename: AS_HTML, bytes: Buffer.from("a\u001fb", "utf8") })).toBeUndefined();
  });

  it("carries text whose only control bytes are tab, newline and carriage return", () => {
    expect(attachmentKindOf({ filename: AS_HTML, bytes: Buffer.from("a\tb\r\nc\n", "utf8") })).toBe("text");
  });
});

/**
 * A leading `ftyp` box: size, `ftyp`, the major brand, a zero minor version, then each compatible brand.
 * `size` overrides the declared length so a malformed box can be built; `tail` is what follows the box.
 */
function ftyp({
  major,
  compatible = [],
  size,
  tail = Buffer.alloc(8),
}: {
  major: string;
  compatible?: readonly string[];
  size?: number;
  tail?: Buffer;
}): Buffer {
  const body = Buffer.concat([
    Buffer.from(`ftyp${major}`, "ascii"),
    Buffer.alloc(4),
    ...compatible.map((brand) => Buffer.from(brand, "ascii")),
  ]);
  const length = Buffer.alloc(4);
  // The box length a well-formed box declares, unless the case is building a malformed one on purpose.
  let declared = body.length + 4;
  if (size !== undefined) {
    declared = size;
  }
  length.writeUInt32BE(declared);
  return Buffer.concat([length, body, tail]);
}

describe("attachmentKindOf names an ISO-BMFF video from its ftyp brands", () => {
  it("names an MP4 whose major brand is mp42 and compatible brands isom", () => {
    expect(attachmentKindOf({ filename: AS_HTML, bytes: ftyp({ compatible: ["mp42", "isom"], major: "mp42" }) })).toBe(
      "iso-bmff-video",
    );
  });

  it("names an M4V and a QuickTime movie, whose brands carry a trailing space", () => {
    expect(
      attachmentKindOf({ filename: AS_HTML, bytes: ftyp({ compatible: ["M4V ", "M4A ", "mp42"], major: "M4V " }) }),
    ).toBe("iso-bmff-video");
    expect(attachmentKindOf({ filename: AS_HTML, bytes: ftyp({ compatible: ["qt  "], major: "qt  " }) })).toBe(
      "iso-bmff-video",
    );
  });

  it("names an avc1-branded file and a fragmented dash one", () => {
    expect(attachmentKindOf({ filename: AS_HTML, bytes: ftyp({ major: "avc1" }) })).toBe("iso-bmff-video");
    expect(attachmentKindOf({ filename: AS_HTML, bytes: ftyp({ compatible: ["iso6", "mp41"], major: "dash" }) })).toBe(
      "iso-bmff-video",
    );
  });

  it("accepts a video brand found ONLY among the compatible ones", () => {
    expect(attachmentKindOf({ filename: AS_HTML, bytes: ftyp({ compatible: ["iso5"], major: "zzzz" }) })).toBe(
      "iso-bmff-video",
    );
  });

  it("matches brands case-sensitively, so an upper-cased ISOM names nothing", () => {
    expect(attachmentKindOf({ filename: AS_HTML, bytes: ftyp({ major: "ISOM" }) })).toBeUndefined();
  });
});

describe("attachmentKindOf refuses a still picture that is ISO-BMFF too", () => {
  const STILL = ["heic", "heix", "hevc", "heim", "heis", "mif1", "msf1", "avif", "avis"];

  it("refuses every still-image brand as the major brand", () => {
    expect(STILL.length).toBeGreaterThan(0);
    expect(
      STILL.filter((brand) => attachmentKindOf({ filename: AS_HTML, bytes: ftyp({ major: brand }) }) !== undefined),
    ).toEqual([]);
  });

  it("refuses an isom file that ALSO lists avif — the deny list wins over any video brand", () => {
    expect(
      attachmentKindOf({ filename: AS_HTML, bytes: ftyp({ compatible: ["avif", "mp42"], major: "isom" }) }),
    ).toBeUndefined();
  });

  it("refuses every still-image brand hidden among the compatible brands of an mp42", () => {
    const carried = STILL.filter(
      (brand) =>
        attachmentKindOf({ filename: AS_HTML, bytes: ftyp({ compatible: ["isom", brand], major: "mp42" }) }) !==
        undefined,
    );
    expect(carried).toEqual([]);
  });
});

describe("attachmentKindOf refuses an ftyp box it cannot trust", () => {
  it("refuses a box truncated below its sixteen-byte header", () => {
    expect(attachmentKindOf({ filename: AS_HTML, bytes: ftyp({ major: "mp42" }).subarray(0, 15) })).toBeUndefined();
  });

  it("refuses a declared size larger than the bytes present", () => {
    expect(
      attachmentKindOf({ filename: AS_HTML, bytes: ftyp({ major: "mp42", size: 4096, tail: Buffer.alloc(0) }) }),
    ).toBeUndefined();
  });

  it("refuses a zero size and a 64-bit size marker, neither of which an ftyp is written with", () => {
    expect(attachmentKindOf({ filename: AS_HTML, bytes: ftyp({ major: "mp42", size: 0 }) })).toBeUndefined();
    expect(attachmentKindOf({ filename: AS_HTML, bytes: ftyp({ major: "mp42", size: 1 }) })).toBeUndefined();
  });

  it("refuses a compatible-brand run that is not a whole number of FourCCs", () => {
    expect(
      attachmentKindOf({ filename: AS_HTML, bytes: ftyp({ compatible: ["isom"], major: "mp42", size: 22 }) }),
    ).toBeUndefined();
  });

  it("refuses a first box that is not an ftyp, even when it names a video brand", () => {
    const moov = Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00, 0x10]),
      Buffer.from("moovmp42", "ascii"),
      Buffer.alloc(8),
    ]);
    expect(attachmentKindOf({ filename: AS_HTML, bytes: moov })).toBeUndefined();
  });

  it("refuses a box whose brands name no video container at all", () => {
    expect(
      attachmentKindOf({ filename: AS_HTML, bytes: ftyp({ compatible: ["M4A "], major: "M4A " }) }),
    ).toBeUndefined();
  });
});

describe("attachmentKindOf over the head ffmpeg actually writes", () => {
  // `ffmpeg -f lavfi -i testsrc=duration=1:size=64x64:rate=5 -pix_fmt yuv420p x.mp4 && xxd x.mp4 | head -3`
  // — the leading ftyp, free and mdat headers of a real 2,747-byte MP4, byte for byte.
  it("names ffmpeg's own isom/iso2/avc1/mp41 head", () => {
    const head = Buffer.from("000000206674797069736f6d0000020069736f6d69736f32617663316d7034310000000866726565", "hex");
    expect(attachmentKindOf({ filename: AS_HTML, bytes: head })).toBe("iso-bmff-video");
  });
});
