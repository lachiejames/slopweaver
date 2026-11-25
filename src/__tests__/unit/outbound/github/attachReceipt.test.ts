import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  type GithubUploadReceipt,
  isUploadReceiptId,
  readUploadReceipt,
  uploadReceiptPath,
  writeUploadReceipt,
} from "../../../../outbound/github/attachReceipt.js";

const ID = "upl-00000000-0000-4000-8000-0000000000aa";
const DIGEST = `sha256:${"a".repeat(64)}`;

const RECEIPT: GithubUploadReceipt = {
  asset: {
    assetId: 7,
    byteLength: 1200,
    contentType: "image/png",
    href: "https://github.com/user-attachments/assets/uuid-1",
    uploadName: "pane.png",
  },
  image: {
    alt: "a terminal pane",
    captureId: "cap-aaaaaaaaaaaaaaaa",
    captureVerb: "browser console-shot",
    digest: DIGEST,
    heightPx: 40,
    imageReceiptId: "rec-attachable",
    proves: "the unit suite passes",
    widthPx: 60,
  },
  readBack: { byteLength: 1200, digest: DIGEST, fetchedAtIso: "2026-11-17T02:00:01.000Z" },
  schemaVersion: 1,
  target: { number: 12, owner: "acme", repo: "app" },
  uploadedAtIso: "2026-11-17T02:00:00.000Z",
  uploadReceiptId: ID,
};

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "sw-upload-receipt-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("isUploadReceiptId", () => {
  it("accepts upl-<uuid> and refuses anything else", () => {
    expect(isUploadReceiptId({ value: ID })).toBe(true);
    expect(isUploadReceiptId({ value: "upl-1" })).toBe(false);
    expect(isUploadReceiptId({ value: "../upl-00000000-0000-4000-8000-0000000000aa" })).toBe(false);
  });
});

describe("writeUploadReceipt and readUploadReceipt", () => {
  it("round-trips a receipt under visual-evidence/uploads", () => {
    const path = unwrap(writeUploadReceipt({ home, receipt: RECEIPT }));
    expect(path).toBe(join(home, "visual-evidence", "uploads", `${ID}.json`));
    expect(unwrap(readUploadReceipt({ home, uploadReceiptId: ID }))).toStrictEqual(RECEIPT);
  });

  it("refuses to write a receipt that fails its own schema", () => {
    const error = unwrapErr(writeUploadReceipt({ home, receipt: { ...RECEIPT, uploadReceiptId: "upl-1" } }));
    expect(error.code).toBe("UPLOAD_RECEIPT_FAILED");
  });

  it("refuses a malformed id before touching the disk", () => {
    const error = unwrapErr(readUploadReceipt({ home, uploadReceiptId: "../../secrets/x" }));
    expect(error.code).toBe("UPLOAD_RECEIPT_UNREADABLE");
    expect(error.message).toContain("not an upl-<uuid> id");
  });

  it("refuses a receipt that is not there", () => {
    expect(unwrapErr(readUploadReceipt({ home, uploadReceiptId: ID })).code).toBe("UPLOAD_RECEIPT_UNREADABLE");
  });

  it("refuses an edited document rather than believing it", () => {
    unwrap(writeUploadReceipt({ home, receipt: RECEIPT }));
    writeFileSync(uploadReceiptPath({ home, uploadReceiptId: ID }), JSON.stringify({ ...RECEIPT, extra: true }));
    const error = unwrapErr(readUploadReceipt({ home, uploadReceiptId: ID }));
    expect(error.code).toBe("UPLOAD_RECEIPT_UNREADABLE");
  });

  it("refuses a document filed under another receipt's id", () => {
    const other = "upl-00000000-0000-4000-8000-0000000000bb";
    unwrap(writeUploadReceipt({ home, receipt: RECEIPT }));
    writeFileSync(uploadReceiptPath({ home, uploadReceiptId: other }), JSON.stringify(RECEIPT));
    const error = unwrapErr(readUploadReceipt({ home, uploadReceiptId: other }));
    expect(error.message).toContain(`names ${ID}`);
  });
});
