/**
 * Redaction through real Jimp: solid opaque pixels burned in and read back, a new metadata-free file, the child
 * receipt pointing at its parent with the covered frame text dropped, and every refusing arm.
 */
import { Jimp } from "jimp";
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import type { CaptureReceipt } from "../../../visualEvidence/captureRecord.js";
import { visualEvidenceErrorLines } from "../../../visualEvidence/evidenceErrors.js";
import { imageDigestOf } from "../../../visualEvidence/imageIo.js";
import { metadataChunksIn } from "../../../visualEvidence/pngMetadata.js";
import {
  burnRedactions,
  MAX_REDACTION_RECTS,
  REDACTION_FILL,
  redactionReceiptOf,
  redactionRectProblems,
} from "../../../visualEvidence/redact.js";

const WHITE = 0xffffffff;
const PARENT_DIGEST = `sha256:${"e".repeat(64)}`;

async function whitePng(): Promise<Uint8Array> {
  return new Uint8Array(await new Jimp({ color: WHITE, height: 40, width: 60 }).getBuffer("image/png"));
}

const PARENT: CaptureReceipt = {
  captureId: "cap-eeeeeeeeeeeeeeee",
  capturedAtIso: "2026-11-17T01:00:00.000Z",
  cropRect: { height: 40, width: 60, x: 0, y: 12 },
  detail: { label: "acme pane", lines: { from: 2, to: 3 }, sourceLines: 5 },
  final: { artifact: { digest: PARENT_DIGEST, heightPx: 40, widthPx: 60 }, metadata: "stripped", path: "/tmp/p.png" },
  frameText: {
    items: [
      { rect: { height: 10, width: 20, x: 5, y: 5 }, text: "ok" },
      { rect: { height: 10, width: 30, x: 5, y: 20 }, text: "token=FIXTURE" },
    ],
    kind: "exact",
    origin: "terminal-screen",
  },
  schemaVersion: 2,
  source: { heightPx: 100, widthPx: 60 },
  status: "readback-pending",
  verb: "browser terminal-shot",
};

describe("redactionRectProblems", () => {
  it("names an empty set, too many rectangles, and each rectangle off the image", () => {
    expect(redactionRectProblems({ height: 40, rects: [], width: 60 })).toEqual([
      "a redaction needs at least one rectangle",
    ]);
    const many = Array.from({ length: MAX_REDACTION_RECTS + 1 }, () => ({ height: 1, width: 1, x: 0, y: 0 }));
    expect(redactionRectProblems({ height: 40, rects: many, width: 60 })).toEqual([
      `a redaction burns at most ${String(MAX_REDACTION_RECTS)} rectangles, got ${String(MAX_REDACTION_RECTS + 1)}`,
    ]);
    expect(redactionRectProblems({ height: 40, rects: [{ height: 10, width: 10, x: 55, y: 0 }], width: 60 })).toEqual([
      "rectangle 1 (55,0 10x10) does not lie inside the 60x40 image",
    ]);
  });
});

describe("burnRedactions", () => {
  it("paints every pixel of each rectangle opaque, leaves the rest, and writes a metadata-free PNG", async () => {
    const parent = await whitePng();
    const redacted = unwrap(await burnRedactions({ bytes: parent, rects: [{ height: 12, width: 32, x: 4, y: 19 }] }));
    expect(redacted.artifact.digest).toBe(imageDigestOf({ bytes: redacted.bytes }));
    expect(redacted.artifact.digest).not.toBe(imageDigestOf({ bytes: parent }));
    expect(metadataChunksIn({ bytes: redacted.bytes })).toEqual([]);
    const decoded = await Jimp.fromBuffer(Buffer.from(redacted.bytes));
    expect(decoded.getPixelColor(4, 19)).toBe(REDACTION_FILL);
    expect(decoded.getPixelColor(35, 30)).toBe(REDACTION_FILL);
    expect(decoded.getPixelColor(36, 30)).toBe(WHITE);
    expect(decoded.getPixelColor(4, 31)).toBe(WHITE);
  });

  it("refuses a rectangle off the image, and bytes that are not an image", async () => {
    const off = unwrapErr(
      await burnRedactions({ bytes: await whitePng(), rects: [{ height: 5, width: 5, x: 0, y: 39 }] }),
    );
    expect(off.code).toBe("REDACTION_REFUSED");
    expect(visualEvidenceErrorLines({ error: off })).toContain(
      "rectangle 1 (0,39 5x5) does not lie inside the 60x40 image",
    );
    expect(unwrapErr(await burnRedactions({ bytes: new Uint8Array([1]), rects: [] })).code).toBe("UNDECODABLE");
  });
});

describe("redactionReceiptOf", () => {
  it("points at the parent, keeps its frame and crop, and drops only the wholly covered frame text", () => {
    const burned = [{ height: 12, width: 32, x: 4, y: 19 }];
    const redacted = { digest: `sha256:${"f".repeat(64)}`, heightPx: 40, widthPx: 60 };
    expect(
      redactionReceiptOf({
        burned,
        capturedAtIso: "2026-11-17T02:00:00.000Z",
        out: "/tmp/r.png",
        parent: PARENT,
        redacted,
      }),
    ).toEqual({
      captureId: "cap-ffffffffffffffff",
      capturedAtIso: "2026-11-17T02:00:00.000Z",
      cropRect: PARENT.cropRect,
      detail: { burned, parentCaptureId: "cap-eeeeeeeeeeeeeeee", parentDigest: PARENT_DIGEST },
      final: { artifact: redacted, metadata: "stripped", path: "/tmp/r.png" },
      frameText: { items: [PARENT.frameText.items[0]], kind: "exact", origin: "terminal-screen" },
      schemaVersion: 2,
      source: PARENT.source,
      status: "readback-pending",
      verb: "browser redact",
    });
  });
});
