/**
 * What each attachment under a draft IS (`cli/commands/slack/draftMediaEvidence.ts`): read off a real draft media
 * store and image store in a throwaway home, and off the bytes a recording admitted, so the first-message proof judges
 * the same thing at record, at list and at release.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  admittedMediaEvidence,
  draftMediaEvidence,
  heldMediaOf,
} from "../../../../../cli/commands/slack/draftMediaEvidence.js";
import type { SlackDraftItem } from "../../../../../outbound/slack/draftRegister.js";
import { imageDigestOf } from "../../../../../visualEvidence/imageIo.js";
import { imageRecordPath } from "../../../../../visualEvidence/store.js";
import { annotatedRecord, storeAnnotatedShot, TINY_PNG } from "../../../../annotatedShotFixture.js";

/** The digest the image store files the fixture PNG under. */
const DIGEST = imageDigestOf({ bytes: TINY_PNG });

/** The register's bare hex for the same bytes. */
const SHA256 = DIGEST.slice("sha256:".length);

/** A digest naming bytes no attachment carries. */
const OTHER_DIGEST = `sha256:${"b".repeat(64)}`;

let home = "";
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "draft-media-evidence-"));
});
afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("draftMediaEvidence", () => {
  it("reads nothing for a row carrying no media", () => {
    expect(draftMediaEvidence({ home, media: undefined })).toEqual([]);
  });

  it("finds a stored picture's records by its bytes' digest", () => {
    const entry = storeAnnotatedShot({ home });
    const [evidence] = draftMediaEvidence({ home, media: [entry] });
    expect(evidence).toEqual({ kind: "picture", records: [annotatedRecord({ digest: DIGEST })], sha256: SHA256 });
  });

  it("is unread for a picture whose filed record describes other bytes, so it lends no notes to a receipt", () => {
    const entry = storeAnnotatedShot({ home, records: () => [] });
    const path = imageRecordPath({ digest: DIGEST, home });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(annotatedRecord({ digest: OTHER_DIGEST }))}\n`);
    expect(draftMediaEvidence({ home, media: [entry] })).toEqual([
      {
        kind: "unread",
        sha256: SHA256,
        why: `an image record for control.png describes other bytes (${OTHER_DIGEST})`,
      },
    ]);
  });

  it("is unread for an entry whose bytes the store does not hold, which never clears a row", () => {
    const [evidence] = draftMediaEvidence({ home, media: [{ bytes: 4, name: "gone.png", sha256: "0".repeat(64) }] });
    expect(evidence!.kind).toBe("unread");
    expect(evidence!.sha256).toBe("0".repeat(64));
  });
});

describe("admittedMediaEvidence", () => {
  it("is a picture carrying the records admission resolved for its digest", () => {
    const records = [annotatedRecord({ digest: DIGEST })];
    const evidence = admittedMediaEvidence({
      evidence: [
        {
          artifact: { digest: DIGEST, heightPx: 2, widthPx: 2 },
          records,
          ref: { artifactDigest: DIGEST, path: "/x/control.png" },
        },
      ],
      uploads: [{ bytes: TINY_PNG, filename: "control.png" }],
    });
    expect(evidence).toEqual([{ kind: "picture", records, sha256: SHA256 }]);
  });

  it("is unread for a picture whose resolved records include one for other bytes", () => {
    const evidence = admittedMediaEvidence({
      evidence: [
        {
          artifact: { digest: DIGEST, heightPx: 2, widthPx: 2 },
          records: [annotatedRecord({ digest: OTHER_DIGEST })],
          ref: { artifactDigest: DIGEST, path: "/x/control.png" },
        },
      ],
      uploads: [{ bytes: TINY_PNG, filename: "control.png" }],
    });
    expect(evidence).toEqual([
      {
        kind: "unread",
        sha256: SHA256,
        why: `an image record for control.png describes other bytes (${OTHER_DIGEST})`,
      },
    ]);
  });

  it("is unread for a picture admission resolved no records for, naming the file", () => {
    const evidence = admittedMediaEvidence({ evidence: [], uploads: [{ bytes: TINY_PNG, filename: "control.png" }] });
    expect(evidence).toEqual([
      { kind: "unread", sha256: SHA256, why: "admission resolved no image record for control.png" },
    ]);
  });
});

describe("heldMediaOf", () => {
  it("reads a held row's media and never a resolved row's", () => {
    const entry = storeAnnotatedShot({ home });
    const item = { draft: { media: [entry] }, id: "sd-1", state: "held" } as unknown as SlackDraftItem;
    const mediaOf = heldMediaOf({ home });
    expect([mediaOf({ item }).length, mediaOf({ item: { ...item, state: "released" } }).length]).toEqual([1, 0]);
  });
});
