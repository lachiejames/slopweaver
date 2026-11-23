import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";
import { imageDigestOf } from "../../../visualEvidence/imageIo.js";
import {
  documentsAmongUploads,
  prepareImageUploads,
  prepareMediaPaths,
  prepareUploadBytes,
} from "../../../visualEvidence/prepareUploads.js";
import {
  evidenceUnreadableLines,
  knownBadImageLines,
  unreadImageRefusalLines,
} from "../../../visualEvidence/refusals.js";
import { appendImageRecord } from "../../../visualEvidence/store.js";
import type { ImageRecord } from "../../../visualEvidence/types.js";
import { IMAGE_POLICY_VERSION } from "../../../visualEvidence/types.js";
import { grantedEnv, grantSessionEnv } from "../../hatchGrantFixture.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAE0lEQVR4AWP8z8DwnwEImBigAAAfFwICgH3ifwAAAABJRU5ErkJggg==",
  "base64",
);
/** A second, different real PNG, so a batch can hold one good and one bad image. */
const PNG_B = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAMAAAADCAYAAABWKLW/AAAAF0lEQVR4AWNkYPj/nwEKmBiQABMDEgAAR1UCBM8FsaoAAAAASUVORK5CYII=",
  "base64",
);

/** A minimal but real PDF — the file class the whole document arm exists for. */
const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< >>\n%%EOF\n", "utf8");

/** A RIFF/WEBP head: a picture Slack renders, `jimp@1.6.1` cannot decode, and this door must still refuse. */
const WEBP = Buffer.concat([
  Buffer.from("RIFF", "ascii"),
  Buffer.from([0x1a, 0x00, 0x00, 0x00]),
  Buffer.from("WEBPVP8L", "ascii"),
  Buffer.alloc(10),
]);

const NOW = "2026-09-13T02:00:00.000Z";

let home = "";
let dir = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slopweaver-ve-home-"));
  dir = mkdtempSync(join(tmpdir(), "slopweaver-ve-shots-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
  rmSync(dir, { force: true, recursive: true });
});

const writePng = ({ name, bytes }: { name: string; bytes: Buffer }): string => {
  const path = join(dir, name);
  writeFileSync(path, bytes);
  return path;
};

/** Each fixture PNG's real decoded size, so a record matches the bytes it is written about. */
const SIZE_PX = new Map<string, number>([
  [imageDigestOf({ bytes: PNG }), 2],
  [imageDigestOf({ bytes: PNG_B }), 3],
]);

const record = ({ bytes, over = {} }: { bytes: Buffer; over?: Partial<ImageRecord> }): ImageRecord => {
  const side = SIZE_PX.get(imageDigestOf({ bytes }))!;
  return {
    artifact: { digest: imageDigestOf({ bytes }), heightPx: side, widthPx: side },
    crop: { kind: "already-framed", reason: "a tiny test artifact has nothing to crop" },
    outcome: "passed",
    policyVersion: IMAGE_POLICY_VERSION,
    readBack: {
      contextRetained: true,
      observedAtIso: NOW,
      observedContent: "a flat block of colour",
      observerSession: "unit-test",
      targetState: "data",
    },
    receiptId: "rec-1",
    schemaVersion: 1,
    ...over,
  } as ImageRecord;
};

describe("prepareImageUploads", () => {
  it("admits nothing to admit", async () => {
    const batch = unwrap(await prepareImageUploads({ env: {}, home, inputs: [], nowIso: NOW }));
    expect(batch.uploads).toEqual([]);
    expect(batch.exceptionOpened).toBe(false);
  });

  it("admits a recorded image and hands back its exact bytes", async () => {
    const path = writePng({ bytes: PNG, name: "panel.png" });
    unwrap(appendImageRecord({ home, record: record({ bytes: PNG }) }));
    const batch = unwrap(
      await prepareImageUploads({
        env: {},
        home,
        inputs: [{ kind: "path", ref: { artifactDigest: imageDigestOf({ bytes: PNG }), path } }],
        nowIso: NOW,
      }),
    );
    expect(batch.uploads).toHaveLength(1);
    expect(batch.uploads[0]!.filename).toBe("panel.png");
    expect(imageDigestOf({ bytes: batch.uploads[0]!.bytes })).toBe(imageDigestOf({ bytes: PNG }));
  });

  it("refuses an unrecorded image with the missing-record error", async () => {
    const path = writePng({ bytes: PNG, name: "panel.png" });
    const result = await prepareImageUploads({
      env: {},
      home,
      inputs: [{ kind: "path", ref: { artifactDigest: imageDigestOf({ bytes: PNG }), path } }],
      nowIso: NOW,
    });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe("IMAGE_RECORD_MISSING");
  });

  it("lets the unread-image hatch through the missing arm, and says it was used", async () => {
    const path = writePng({ bytes: PNG, name: "panel.png" });
    const batch = unwrap(
      await prepareImageUploads({
        env: grantedEnv({ hatchIds: ["unread-image"], home, issuedAtIso: NOW }),
        home,
        inputs: [{ kind: "path", ref: { artifactDigest: imageDigestOf({ bytes: PNG }), path } }],
        nowIso: NOW,
      }),
    );
    expect(batch.uploads).toHaveLength(1);
    expect(batch.exceptionOpened).toBe(true);
  });

  it("does not let the old unread-image variable through the missing arm without a grant", async () => {
    const path = writePng({ bytes: PNG, name: "panel.png" });
    const result = await prepareImageUploads({
      env: { ...grantSessionEnv({ home }), SLOPWEAVER_ALLOW_UNREAD_IMAGE: "1" },
      home,
      inputs: [{ kind: "path", ref: { artifactDigest: imageDigestOf({ bytes: PNG }), path } }],
      nowIso: NOW,
    });
    expect(result._unsafeUnwrapErr().code).toBe("IMAGE_RECORD_MISSING");
  });

  // The property wanted here: a picture written down as bad has no way out.
  it("refuses a recorded-bad image EVEN WITH the hatch wide open", async () => {
    const path = writePng({ bytes: PNG, name: "panel.png" });
    unwrap(
      appendImageRecord({
        home,
        record: record({
          bytes: PNG,
          over: { correction: "wait for the panel, then crop", outcome: "failed", reason: "empty-panel" },
        }),
      }),
    );
    const result = await prepareImageUploads({
      env: grantedEnv({ hatchIds: ["unread-image"], home, issuedAtIso: NOW }),
      home,
      inputs: [{ kind: "path", ref: { artifactDigest: imageDigestOf({ bytes: PNG }), path } }],
      nowIso: NOW,
    });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe("IMAGE_KNOWN_BAD");
  });

  it("refuses the WHOLE batch when only the second image is bad", async () => {
    const good = writePng({ bytes: PNG, name: "good.png" });
    const bad = writePng({ bytes: PNG_B, name: "bad.png" });
    unwrap(appendImageRecord({ home, record: record({ bytes: PNG }) }));
    unwrap(
      appendImageRecord({
        home,
        record: record({
          bytes: PNG_B,
          over: { correction: "re-capture it", outcome: "failed", reason: "illegible" },
        }),
      }),
    );
    const result = await prepareImageUploads({
      env: {},
      home,
      inputs: [
        { kind: "path", ref: { artifactDigest: imageDigestOf({ bytes: PNG }), path: good } },
        { kind: "path", ref: { artifactDigest: imageDigestOf({ bytes: PNG_B }), path: bad } },
      ],
      nowIso: NOW,
    });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe("IMAGE_KNOWN_BAD");
  });

  it("refuses when the bytes at the path changed after the record was written", async () => {
    const path = writePng({ bytes: PNG, name: "panel.png" });
    unwrap(appendImageRecord({ home, record: record({ bytes: PNG }) }));
    writeFileSync(path, PNG_B);
    const result = await prepareImageUploads({
      env: {},
      home,
      inputs: [{ kind: "path", ref: { artifactDigest: imageDigestOf({ bytes: PNG }), path } }],
      nowIso: NOW,
    });
    expect(result.isErr()).toBe(true);
    // The swapped bytes have no record of their own, so this is the missing arm — and crucially NOT a pass.
    expect(result._unsafeUnwrapErr().code).toBe("IMAGE_RECORD_MISSING");
  });

  it("refuses bytes this door cannot name — a WebP is a picture Jimp cannot read", async () => {
    const path = join(dir, "panel.webp");
    writeFileSync(path, WEBP);
    const result = await prepareImageUploads({
      env: {},
      home,
      inputs: [{ kind: "path", ref: { artifactDigest: imageDigestOf({ bytes: WEBP }), path } }],
      nowIso: NOW,
    });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe("IMAGE_EVIDENCE_INVALID");
  });

  // The same refusal with the hatch wide open: an undecodable, unnamed attachment is the `invalid` arm,
  // which the unread-image hatch has never waived and must not start waiving.
  it("refuses an SVG even with the hatch open, because an SVG is a picture that is also text", async () => {
    const path = join(dir, "chart.svg");
    writeFileSync(path, '<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4"/></svg>', "utf8");
    const result = await prepareImageUploads({
      env: grantedEnv({ hatchIds: ["unread-image"], home, issuedAtIso: NOW }),
      home,
      inputs: [{ kind: "path", ref: { artifactDigest: "sha256:unused", path } }],
      nowIso: NOW,
    });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe("IMAGE_EVIDENCE_INVALID");
  });

  it("carries an HTML briefing by the name it is uploaded under, and refuses the same bytes named .htm", async () => {
    const page = '<!doctype html>\n<html lang="en"><body><p>the short version</p></body></html>\n';
    const html = join(dir, "briefing.html");
    const htm = join(dir, "briefing.htm");
    writeFileSync(html, page, "utf8");
    writeFileSync(htm, page, "utf8");
    const batch = unwrap(
      await prepareImageUploads({
        env: {},
        home,
        inputs: [{ kind: "path", ref: { artifactDigest: "sha256:unused", path: html } }],
        nowIso: NOW,
      }),
    );
    expect(batch.uploads.map((upload) => upload.filename)).toEqual(["briefing.html"]);
    expect(batch.evidence).toEqual([]);
    const renamed = await prepareImageUploads({
      env: {},
      home,
      inputs: [{ kind: "path", ref: { artifactDigest: "sha256:unused", path: htm } }],
      nowIso: NOW,
    });
    expect(renamed._unsafeUnwrapErr().code).toBe("IMAGE_EVIDENCE_INVALID");
  });

  it("carries a PDF with no record at all, and NOT on the hatch", async () => {
    const path = join(dir, "pentest.pdf");
    writeFileSync(path, PDF);
    const batch = unwrap(
      await prepareImageUploads({
        env: {},
        home,
        inputs: [{ kind: "path", ref: { artifactDigest: imageDigestOf({ bytes: PDF }), path } }],
        nowIso: NOW,
      }),
    );
    expect(batch.uploads).toHaveLength(1);
    expect(batch.uploads[0]!.filename).toBe("pentest.pdf");
    expect(batch.evidence).toEqual([]);
    expect(batch.exceptionOpened).toBe(false);
  });

  it("carries a document beside a recorded image, and asks the store only about the image", async () => {
    const png = writePng({ bytes: PNG, name: "panel.png" });
    const pdf = join(dir, "report.pdf");
    writeFileSync(pdf, PDF);
    unwrap(appendImageRecord({ home, record: record({ bytes: PNG }) }));
    const batch = unwrap(
      await prepareImageUploads({
        env: {},
        home,
        inputs: [
          { kind: "path", ref: { artifactDigest: imageDigestOf({ bytes: PNG }), path: png } },
          { kind: "path", ref: { artifactDigest: imageDigestOf({ bytes: PDF }), path: pdf } },
        ],
        nowIso: NOW,
      }),
    );
    expect(batch.uploads.map((upload) => upload.filename)).toEqual(["panel.png", "report.pdf"]);
    expect(batch.evidence).toHaveLength(1);
    expect(batch.evidence[0]!.artifact.digest).toBe(imageDigestOf({ bytes: PNG }));
  });

  it("does not let a document dilute a hold on the batch", async () => {
    const png = writePng({ bytes: PNG, name: "panel.png" });
    const pdf = join(dir, "report.pdf");
    writeFileSync(pdf, PDF);
    unwrap(
      appendImageRecord({
        home,
        record: record({
          bytes: PNG,
          over: { correction: "re-capture it", outcome: "failed", reason: "illegible" },
        }),
      }),
    );
    const result = await prepareImageUploads({
      env: grantedEnv({ hatchIds: ["unread-image"], home, issuedAtIso: NOW }),
      home,
      inputs: [
        { kind: "path", ref: { artifactDigest: imageDigestOf({ bytes: PNG }), path: png } },
        { kind: "path", ref: { artifactDigest: imageDigestOf({ bytes: PDF }), path: pdf } },
      ],
      nowIso: NOW,
    });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe("IMAGE_KNOWN_BAD");
  });

  it("refuses a missing file as a store failure rather than admitting it", async () => {
    const result = await prepareImageUploads({
      env: {},
      home,
      inputs: [{ kind: "path", ref: { artifactDigest: imageDigestOf({ bytes: PNG }), path: join(dir, "gone.png") } }],
      nowIso: NOW,
    });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe("IMAGE_STORE_FAILED");
  });

  it("governs restored held bytes by the same records, with no grandfathered pass", async () => {
    const result = await prepareImageUploads({
      env: {},
      home,
      inputs: [
        {
          bytes: PNG,
          filename: "held.png",
          kind: "bytes",
          ref: { artifactDigest: imageDigestOf({ bytes: PNG }), path: "/gone/held.png" },
        },
      ],
      nowIso: NOW,
    });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe("IMAGE_RECORD_MISSING");
  });

  it("admits restored held bytes whose record stands, even though the original path is gone", async () => {
    unwrap(appendImageRecord({ home, record: record({ bytes: PNG }) }));
    const batch = unwrap(
      await prepareImageUploads({
        env: {},
        home,
        inputs: [
          {
            bytes: PNG,
            filename: "held.png",
            kind: "bytes",
            ref: { artifactDigest: imageDigestOf({ bytes: PNG }), path: "/gone/held.png" },
          },
        ],
        nowIso: NOW,
      }),
    );
    expect(batch.uploads[0]!.filename).toBe("held.png");
  });
});

/** ffmpeg's own MP4 head (isom/iso2/avc1/mp41) with a stub `mdat` — a video Jimp cannot decode. */
const MP4 = Buffer.concat([
  Buffer.from("000000206674797069736f6d0000020069736f6d69736f32617663316d703431", "hex"),
  Buffer.from("0000000c6d64617400000000", "hex"),
]);

/** An AVIF that ALSO lists isom — a still picture advertising a video brand, which must stay refused. */
const AVIF_ISOM = Buffer.concat([
  Buffer.from("0000001c66747970", "hex"),
  Buffer.from("avif", "ascii"),
  Buffer.alloc(4),
  Buffer.from("isommif1avif", "ascii"),
  Buffer.alloc(8),
]);

describe("a video is carried the way a PDF is — identified from its bytes, asked nothing", () => {
  it("carries an MP4 with no record at all, NOT on the hatch, and adds no image evidence", async () => {
    const path = join(dir, "side-by-side.mp4");
    writeFileSync(path, MP4);
    const batch = unwrap(await prepareMediaPaths({ env: {}, home, nowIso: NOW, paths: [path] }));
    expect(batch.uploads.map((upload) => upload.filename)).toEqual(["side-by-side.mp4"]);
    expect(Buffer.from(batch.uploads[0]!.bytes).equals(MP4)).toBe(true);
    expect(batch.evidence).toEqual([]);
    expect(batch.exceptionOpened).toBe(false);
  });

  it("refuses an AVIF advertising isom, even with the unread-image hatch open", async () => {
    const result = await prepareUploadBytes({
      env: grantedEnv({ hatchIds: ["unread-image"], home, issuedAtIso: NOW }),
      home,
      nowIso: NOW,
      uploads: [{ bytes: AVIF_ISOM, filename: "still.mp4" }],
    });
    expect(result._unsafeUnwrapErr().code).toBe("IMAGE_EVIDENCE_INVALID");
  });

  it("still asks the store about a picture beside the video, and refuses the batch when it has no record", async () => {
    const png = writePng({ bytes: PNG, name: "panel.png" });
    const mp4 = join(dir, "clip.mp4");
    writeFileSync(mp4, MP4);
    const result = await prepareMediaPaths({ env: {}, home, nowIso: NOW, paths: [mp4, png] });
    expect(result._unsafeUnwrapErr().code).toBe("IMAGE_RECORD_MISSING");
  });

  it("refuses an unreadable path as a store failure, before admitting anything", async () => {
    const result = await prepareMediaPaths({ env: {}, home, nowIso: NOW, paths: [join(dir, "gone.mp4")] });
    expect(result._unsafeUnwrapErr().code).toBe("IMAGE_STORE_FAILED");
  });
});

describe("the refusal renderers keep the two arms apart", () => {
  it("gives the missing arm four lines naming the hatch", () => {
    const lines = unreadImageRefusalLines({ command: "posting a bot answer", digests: [`sha256:${"a".repeat(64)}`] });
    expect(lines.length).toBeGreaterThan(0);
    const text = lines.join("\n");
    expect(text).toContain("unread-image");
    expect(text).toContain("browser image-record");
  });

  it("gives the hold arm NO override token and says there is no hatch", () => {
    const lines = knownBadImageLines({
      command: "posting a bot answer",
      verdict: {
        findings: [
          {
            code: "image.empty-panel",
            correction: "wait for the panel to render, then crop to the chart",
            severity: "hold",
            summary: "panel.png was looked at and recorded as unfit to send",
          },
        ],
        kind: "known-bad",
      },
    });
    const text = lines.join("\n");
    expect(text).toContain("There is no escape hatch for this one");
    expect(text).toContain("wait for the panel to render, then crop to the chart");
    expect(text).not.toContain("SLOPWEAVER_ALLOW");
    expect(text).not.toContain("SLOPWEAVER_DOOR_OVERRIDE");
  });

  it("states an unreadable record as a fact, never as a rule that caught something", () => {
    const lines = evidenceUnreadableLines({ issues: ["panel.png: the record names other bytes"] });
    const text = lines.join("\n");
    expect(text).toContain("could not be believed");
    expect(text).not.toContain("blocked because");
    expect(text).not.toContain("escape hatch");
  });
});

describe("documentsAmongUploads keeps the answer form's two lanes apart", () => {
  it("reports nothing when every upload is a picture", async () => {
    expect(await documentsAmongUploads({ uploads: [{ bytes: PNG, filename: "panel.png" }] })).toEqual([]);
  });

  it("names a deliverable left in the images lane, in the caller's order", async () => {
    const misplaced = await documentsAmongUploads({
      uploads: [
        { bytes: PNG, filename: "panel.png" },
        { bytes: PDF, filename: "report.pdf" },
        { bytes: Buffer.from("# notes\n", "utf8"), filename: "notes.md" },
      ],
    });
    expect(misplaced).toEqual(["report.pdf", "notes.md"]);
  });

  // A WebP is not a misplaced deliverable — it is an undecodable PICTURE, and admission must be the thing
  // that refuses it, so this check has to stay silent about one.
  it("says nothing about a WebP, which belongs to admission rather than to this lane check", async () => {
    expect(await documentsAmongUploads({ uploads: [{ bytes: WEBP, filename: "panel.webp" }] })).toEqual([]);
  });
});
