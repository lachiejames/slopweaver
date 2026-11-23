/**
 * The capture record round trip under an explicit home, and the strict parse that refuses a document a
 * later build or a hand edit has changed. Every Datadog address in the record reads the synthetic `ap1` site
 * rather than the install's own.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import {
  type CaptureReceipt,
  type CaptureRecord,
  capturedUrlOf,
  captureIdFor,
  captureRecordPath,
  isCaptureReceipt,
  readCaptureRecord,
  writeCaptureRecord,
} from "../../../visualEvidence/captureRecord.js";
import { imageDigestOf } from "../../../visualEvidence/imageIo.js";
import { appendImageRecord } from "../../../visualEvidence/store.js";
import { IMAGE_POLICY_VERSION, type ImageRecord } from "../../../visualEvidence/types.js";

const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;
const DIGEST_C = `sha256:${"c".repeat(64)}`;

const OBSERVATION = {
  chart: {
    canvasCount: 3,
    inkError: null,
    inkSamples: 9403,
    rect: { height: 442, width: 1504, x: 472, y: 441 },
    sampledPixels: 183120,
    visibility: "visible" as const,
  },
  document: { height: 3256, width: 2016 },
  networkQuietMs: 2737,
  observedAtMs: 7515,
  progressIndicators: 0,
  query: { rect: { height: 112, width: 1824, x: 176, y: 88 }, text: "env:staging", visibility: "visible" as const },
  scroll: { x: 0, y: 53 },
  smallestFontPx: 10,
  summary: {
    groups: 2,
    logs: 32,
    rect: { height: 18, width: 242, x: 510, y: 372 },
    text: "2 service values found ( based on 32 logs )",
    visibility: "visible" as const,
  },
  targetMatches: 1,
  targetRect: { height: 597, width: 1537, x: 455, y: 310 },
  timeRange: {
    rect: { height: 28, width: 376, x: 1462, y: 89 },
    text: "Aug 29 - Sep 13",
    visibility: "visible" as const,
  },
  viewport: { height: 883, width: 2016 },
};

const RECORD: CaptureRecord = {
  annotations: [
    { kind: "highlight", rect: { height: 664, width: 2256, x: 462, y: 547 }, strokePx: 4 },
    { bandHeightPx: 216, kind: "caption", lines: ["2 service values found", "query: env:staging"] },
  ],
  capturedAtIso: "2026-09-13T01:34:36.672Z",
  captureId: "cap-a8b0dd6d4f2b8328",
  crop: {
    artifact: { digest: DIGEST_B, heightPx: 1294, widthPx: 2772 },
    panelInkRowFraction: 0.83,
    rect: { height: 1294, width: 2772, x: 246, y: 48 },
    regions: [{ name: "chart", rect: { height: 442, width: 1504, x: 472, y: 441 } }],
    scale: 1.5,
  },
  final: {
    artifact: { digest: DIGEST_C, heightPx: 1558, widthPx: 2772 },
    legibility: {
      featurePx: 15,
      issues: [],
      policyVersion: 1,
      profile: "slack-desktop-expanded-v1",
      projectedPx: 7.58,
    },
    path: "/tmp/live9/evidence.png",
  },
  finalUrl: "https://ap1.datadoghq.com/logs?viz=timeseries",
  raw: {
    artifact: { digest: DIGEST_A, heightPx: 1766, widthPx: 4032 },
    geometry: {
      devicePixelRatio: 1.5,
      documentHeight: 3256,
      documentWidth: 2016,
      viewportHeight: 883,
      viewportWidth: 2016,
    },
    path: "/tmp/live9/evidence.raw.png",
  },
  readiness: { after: OBSERVATION, elapsedMs: 8546, observation: OBSERVATION, polls: 14 },
  schemaVersion: 1,
  status: "readback-pending",
  target: { adapterId: "datadog-logs-v1", targetId: "timeseries" },
  url: "https://ap1.datadoghq.com/logs?viz=timeseries",
};

/** A version-2 terminal-shot receipt: the generic half plus the terminal verb's own detail. */
const RECEIPT: CaptureReceipt = {
  captureId: "cap-cccccccccccccccc",
  capturedAtIso: "2026-11-17T01:00:00.000Z",
  cropRect: { height: 120, width: 600, x: 0, y: 36 },
  detail: { label: "acme deploy pane", lines: { from: 2, to: 4 }, sourceLines: 9 },
  final: { artifact: { digest: DIGEST_C, heightPx: 120, widthPx: 600 }, metadata: "stripped", path: "/tmp/t.png" },
  frameText: {
    items: [{ rect: { height: 36, width: 80, x: 24, y: 24 }, text: "PASS" }],
    kind: "exact",
    origin: "terminal-screen",
  },
  schemaVersion: 2,
  source: { heightPx: 372, widthPx: 640 },
  status: "readback-pending",
  verb: "browser terminal-shot",
};

describe("capture records", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "capture-record-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("writes under the home's captures directory and reads back the same document", () => {
    const path = unwrap(writeCaptureRecord({ home, record: RECORD }));
    expect(path).toBe(join(home, "visual-evidence", "captures", "cap-a8b0dd6d4f2b8328.json"));
    expect(path).toBe(captureRecordPath({ captureId: "cap-a8b0dd6d4f2b8328", home }));
    expect(unwrap(readCaptureRecord({ captureId: "cap-a8b0dd6d4f2b8328", home }))).toEqual(RECORD);
  });

  it("round-trips a version-2 receipt and tells it apart from a legacy record", () => {
    unwrap(writeCaptureRecord({ home, record: RECEIPT }));
    const read = unwrap(readCaptureRecord({ captureId: RECEIPT.captureId, home }))!;
    expect(read).toEqual(RECEIPT);
    expect(isCaptureReceipt(read)).toBe(true);
    expect(isCaptureReceipt(RECORD)).toBe(false);
    expect(captureIdFor({ digest: DIGEST_C })).toBe("cap-cccccccccccccccc");
  });

  it("refuses a version-2 receipt whose frame text lost its kind, naming the field", () => {
    const path = captureRecordPath({ captureId: "cap-v2-edited", home });
    mkdirSync(dirname(path), { recursive: true });
    const edited = { ...RECEIPT, captureId: "cap-v2-edited", frameText: { items: [], origin: "terminal-screen" } };
    writeFileSync(path, JSON.stringify(edited));
    const error = unwrapErr(readCaptureRecord({ captureId: "cap-v2-edited", home }));
    expect(error.code).toBe("IMAGE_EVIDENCE_INVALID");
    expect(error.message).toContain("frameText.kind");
  });

  it("answers null for a record that does not exist", () => {
    expect(unwrap(readCaptureRecord({ captureId: "cap-missing", home }))).toBe(null);
  });

  it("refuses a document with a field the schema does not know, naming the path", () => {
    const path = captureRecordPath({ captureId: "cap-edited", home });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ ...RECORD, captureId: "cap-edited", status: "attachment-ready" }));
    const error = unwrapErr(readCaptureRecord({ captureId: "cap-edited", home }));
    expect(error.code).toBe("IMAGE_EVIDENCE_INVALID");
    expect(error.message).toContain("status");
  });

  it("refuses a document that is not JSON as invalid, never as absent", () => {
    const path = captureRecordPath({ captureId: "cap-broken", home });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{not json");
    expect(unwrapErr(readCaptureRecord({ captureId: "cap-broken", home })).code).toBe("IMAGE_EVIDENCE_INVALID");
  });

  it("writes one pretty document that a reader can open", () => {
    const path = unwrap(writeCaptureRecord({ home, record: RECORD }));
    const text = readFileSync(path, "utf8");
    expect(text.startsWith("{")).toBe(true);
    expect(JSON.parse(text).final.artifact.digest).toBe(DIGEST_C);
  });
});

describe("capturedUrlOf", () => {
  let home: string;
  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAE0lEQVR4AWP8z8DwnwEImBigAAAfFwICgH3ifwAAAABJRU5ErkJggg==",
    "base64",
  );

  /** One passing image record for these exact bytes, optionally naming the capture it came out of. */
  const imageRecord = ({ captureId }: { captureId: string | undefined }): ImageRecord => ({
    artifact: { digest: imageDigestOf({ bytes }), heightPx: 2, widthPx: 2 },
    captureId,
    crop: { kind: "already-framed", reason: "a 2x2 test artifact has nothing to crop" },
    outcome: "passed",
    policyVersion: IMAGE_POLICY_VERSION,
    readBack: {
      contextRetained: true,
      observedAtIso: "2026-09-16T01:00:00.000Z",
      observedContent: "four pixels",
      observerSession: "unit-test",
      targetState: "data",
    },
    receiptId: "rec-bound",
    schemaVersion: 1,
  });

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "captured-url-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("answers the address the capture record says these bytes were photographed at", () => {
    unwrap(writeCaptureRecord({ home, record: RECORD }));
    unwrap(appendImageRecord({ home, record: imageRecord({ captureId: RECORD.captureId }) }));
    expect(unwrap(capturedUrlOf({ bytes, home }))).toBe("https://ap1.datadoghq.com/logs?viz=timeseries");
  });

  it("answers null for bytes nothing here recorded", () => {
    expect(unwrap(capturedUrlOf({ bytes, home }))).toBe(null);
  });

  it("answers null for a record that names no capture — a hand-made picture", () => {
    unwrap(appendImageRecord({ home, record: imageRecord({ captureId: undefined }) }));
    expect(unwrap(capturedUrlOf({ bytes, home }))).toBe(null);
  });

  it("answers null when the record names a capture whose own record is gone", () => {
    unwrap(appendImageRecord({ home, record: imageRecord({ captureId: "cap-vanished" }) }));
    expect(unwrap(capturedUrlOf({ bytes, home }))).toBe(null);
  });
});
