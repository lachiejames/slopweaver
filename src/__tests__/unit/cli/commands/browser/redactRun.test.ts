import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { redactParentOf, runBrowserRedact } from "../../../../../cli/commands/browser/redactRun.js";
import { unwrap } from "../../../../../lib/result.js";
import { captureIdFor, readCaptureRecord } from "../../../../../visualEvidence/captureRecord.js";
import { imageDigestOf } from "../../../../../visualEvidence/imageIo.js";
import { appendImageRecord } from "../../../../../visualEvidence/store.js";
import { IMAGE_POLICY_VERSION } from "../../../../../visualEvidence/types.js";
import {
  type AttachablePicture,
  fileAttachableEvidence,
  renderAttachablePicture,
} from "../../../../attachEvidenceFixture.js";

let PICTURE: AttachablePicture;
let root: string;
let home: string;
let source: string;

beforeAll(async () => {
  PICTURE = await renderAttachablePicture();
});

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "redact-run-"));
  home = join(root, "home");
  mkdirSync(home);
  source = join(root, "source.png");
  writeFileSync(source, PICTURE.bytes);
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

/** A form burning one small rectangle into the source. */
function redactForm({ out }: { out: string }): string {
  const path = join(root, "form.json");
  writeFileSync(path, JSON.stringify({ out, rects: [{ height: 4, width: 4, x: 0, y: 0 }], source }));
  return path;
}

const CAPTURED_AT = "2026-11-17T05:00:00.000Z";

describe("runBrowserRedact", () => {
  it("writes a NEW file and files a child receipt pointing at the parent", async () => {
    fileAttachableEvidence({ home, picture: PICTURE, viewed: false });
    const out = join(root, "redacted.png");
    expect(await runBrowserRedact({ capturedAtIso: CAPTURED_AT, form: redactForm({ out }), home, json: false })).toBe(
      0,
    );
    const bytes = readFileSync(out);
    expect(imageDigestOf({ bytes })).not.toBe(PICTURE.receipt.final.artifact.digest);
    expect(readFileSync(source)).toStrictEqual(Buffer.from(PICTURE.bytes));
    const child = unwrap(readCaptureRecord({ captureId: captureIdFor({ digest: imageDigestOf({ bytes }) }), home }));
    expect(child).toMatchObject({
      detail: { parentCaptureId: PICTURE.receipt.captureId, parentDigest: PICTURE.receipt.final.artifact.digest },
      verb: "browser redact",
    });
  });

  it("refuses a source no capture receipt names, writing nothing", async () => {
    const out = join(root, "redacted.png");
    expect(await runBrowserRedact({ capturedAtIso: CAPTURED_AT, form: redactForm({ out }), home, json: false })).toBe(
      1,
    );
    expect(existsSync(out)).toBe(false);
  });
});

describe("redactParentOf", () => {
  it("returns the parent receipt for receipted bytes", () => {
    fileAttachableEvidence({ home, picture: PICTURE, viewed: false });
    expect(redactParentOf({ bytes: PICTURE.bytes, home })).toStrictEqual({ parent: PICTURE.receipt });
  });

  it("refuses bytes already recorded unfit, which are retaken rather than redacted around", () => {
    fileAttachableEvidence({ home, picture: PICTURE, viewed: false });
    unwrap(
      appendImageRecord({
        home,
        record: {
          artifact: PICTURE.receipt.final.artifact,
          correction: "re-capture at a larger size",
          crop: { kind: "already-framed", reason: "rendered from the kept lines only" },
          outcome: "failed",
          policyVersion: IMAGE_POLICY_VERSION,
          readBack: {
            contextRetained: true,
            observedAtIso: "2026-11-17T05:01:00.000Z",
            observedContent: "text too small to read",
            observerSession: "unit-test",
            targetState: "data",
          },
          reason: "illegible",
          receiptId: "rec-unfit",
          schemaVersion: 1,
        },
      }),
    );
    expect(redactParentOf({ bytes: PICTURE.bytes, home })).toStrictEqual({
      problem:
        "the source bytes are already recorded unfit (illegible: re-capture at a larger size) — a picture recorded " +
        "unfit is retaken, never redacted around",
    });
  });
});
