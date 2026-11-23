/**
 * The filing half of the evidence profile, over a real temp home — and a counterexample a review
 * found: a capture-record write that fails must not cost the FAILED image record that makes
 * illegible bytes terminal.
 */

import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Jimp } from "jimp";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { fileEvidence } from "../../../../../cli/commands/browser/shotEvidenceRun.js";
import { unwrap } from "../../../../../lib/result.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { type ProcessedEvidence, processEvidenceCapture } from "../../../../../visualEvidence/capturePipeline.js";
import { readCaptureRecord } from "../../../../../visualEvidence/captureRecord.js";
import type { EvidenceCaptureResult, TargetObservation } from "../../../../../visualEvidence/observation.js";
import { readImageRecords } from "../../../../../visualEvidence/store.js";

const TARGET = { adapterId: "datadog-logs-v1", targetId: "timeseries" } as const;
const WHITE = 0xffffffff;
const BLUE = 0x3b82f6ff;

/** A 200x100 CSS frame painted at 2. `smallestFontPx` decides whether prominence passes. */
function observationWith({ smallestFontPx }: { smallestFontPx: number }): TargetObservation {
  return {
    chart: {
      canvasCount: 1,
      inkError: null,
      inkSamples: 500,
      rect: { height: 50, width: 120, x: 40, y: 40 },
      sampledPixels: 6000,
      visibility: "visible",
    },
    document: { height: 300, width: 200 },
    networkQuietMs: 3000,
    observedAtMs: 4000,
    progressIndicators: 0,
    query: { rect: { height: 10, width: 150, x: 20, y: 14 }, text: "env:staging", visibility: "visible" },
    scroll: { x: 0, y: 30 },
    smallestFontPx,
    summary: {
      groups: 2,
      logs: 32,
      rect: { height: 8, width: 60, x: 40, y: 28 },
      text: "2 service values found ( based on 32 logs )",
      visibility: "visible",
    },
    targetMatches: 1,
    targetRect: { height: 70, width: 140, x: 30, y: 25 },
    timeRange: { rect: { height: 8, width: 50, x: 140, y: 4 }, text: "Aug 29 - Sep 13", visibility: "visible" },
    viewport: { height: 100, width: 200 },
  };
}

function resultWith({ observation }: { observation: TargetObservation }): EvidenceCaptureResult {
  return {
    after: observation,
    before: observation,
    elapsedMs: 4200,
    finalUrl: "https://ap1.datadoghq.com/logs?viz=timeseries",
    geometry: { devicePixelRatio: 2, documentHeight: 300, documentWidth: 200, viewportHeight: 100, viewportWidth: 200 },
    pageText: {
      nodes: [{ rect: { height: 8, width: 60, x: 40, y: 28 }, text: "2 service values found ( based on 32 logs )" }],
      opaque: [],
      truncated: false,
    },
    polls: 8,
    readiness: "ready",
    screenshotError: null,
    screenshotWritten: true,
    title: "Log Explorer | Datadog",
  };
}

/** A 400x200 white PNG with bars drawn inside the chart's image rectangle. */
async function framePng(): Promise<Uint8Array> {
  const image = new Jimp({ color: WHITE, height: 200, width: 400 });
  for (let x = 90; x < 310; x += 20) {
    for (let y = 100; y < 170; y += 1) {
      for (let dx = 0; dx < 8; dx += 1) {
        image.setPixelColor(BLUE, x + dx, y);
      }
    }
  }
  return new Uint8Array(await image.getBuffer("image/png"));
}

async function processedWith({ smallestFontPx }: { smallestFontPx: number }): Promise<ProcessedEvidence> {
  const observation = observationWith({ smallestFontPx });
  return unwrap(
    await processEvidenceCapture({
      capturedAtIso: "2026-09-13T04:30:00.000Z",
      lead: null,
      result: resultWith({ observation }),
      screenshotPng: await framePng(),
      target: TARGET,
    }),
  );
}

describe("fileEvidence", () => {
  let home: string;
  let out: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "shot-evidence-"));
    out = join(mkdtempSync(join(tmpdir(), "shot-out-")), "evidence.png");
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
    rmSync(dirname(out), { force: true, recursive: true });
  });

  it("reports captured and writes a capture record for bytes that clear the prominence floor", async () => {
    const processed = await processedWith({ smallestFontPx: 10 });
    const report = fileEvidence({
      capturedAtIso: "2026-09-13T04:30:00.000Z",
      home,
      out,
      processed,
      result: resultWith({ observation: processed.observation }),
      url: "https://ap1.datadoghq.com/logs?viz=timeseries",
    });
    expect(report.outcome).toBe("captured");
    expect(report.evidence!.captureId).toBe(`cap-${processed.final.artifact.digest.slice(7, 23)}`);
    const record = unwrap(readCaptureRecord({ captureId: report.evidence!.captureId!, home }));
    expect(record!.final.artifact.digest).toBe(processed.final.artifact.digest);
    expect(record!.status).toBe("readback-pending");
    // The version-2 receipt: the verb, the frame text, the raw frame as the source and the crop taken from it.
    expect(record).toMatchObject({
      cropRect: processed.crop.rect,
      final: { metadata: "stripped", path: out },
      frameText: processed.frameText,
      schemaVersion: 2,
      source: { heightPx: 200, widthPx: 400 },
      verb: "browser shot",
    });
    // A passing capture writes NO image record — a pass needs a session to have looked.
    expect(unwrap(readImageRecords({ digest: processed.final.artifact.digest, home }))).toEqual([]);
  });

  it("records prominence-failing bytes as FAILED, and reports evidence-unfit", async () => {
    const processed = await processedWith({ smallestFontPx: 1 });
    const report = fileEvidence({
      capturedAtIso: "2026-09-13T04:30:00.000Z",
      home,
      out,
      processed,
      result: resultWith({ observation: processed.observation }),
      url: "https://ap1.datadoghq.com/logs?viz=timeseries",
    });
    expect(report.outcome).toBe("evidence-unfit");
    const records = unwrap(readImageRecords({ digest: processed.final.artifact.digest, home }));
    expect(records.length).toBe(1);
    expect(records[0]!.outcome).toBe("failed");
  });

  it("still records them FAILED when the capture-record directory cannot be written", async () => {
    // The r1 counterexample: `visual-evidence/captures` is an ordinary FILE, so `writeCaptureRecord` fails
    // at its mkdir while the records directory beside it stays writable.
    const paths = stateHomePaths({ home });
    mkdirSync(dirname(paths.visualEvidenceCaptures), { recursive: true });
    writeFileSync(paths.visualEvidenceCaptures, "not a directory");
    const processed = await processedWith({ smallestFontPx: 1 });
    const report = fileEvidence({
      capturedAtIso: "2026-09-13T04:30:00.000Z",
      home,
      out,
      processed,
      result: resultWith({ observation: processed.observation }),
      url: "https://ap1.datadoghq.com/logs?viz=timeseries",
    });
    expect(report.outcome).toBe("evidence-unfit");
    expect(report.because).toContain("the capture record could not be written");
    expect(report.evidence!.captureId).toBe(null);
    const records = unwrap(readImageRecords({ digest: processed.final.artifact.digest, home }));
    expect(records.length).toBe(1);
    expect(records[0]!.outcome).toBe("failed");
  });

  it("removes the image when its FAILED record cannot be written, so nothing attachable is left", async () => {
    // The r2 counterexample: the records directory is searchable but not writable, so `appendImageRecord`
    // fails with EACCES. Bytes this verb measured as illegible must not survive with no record — that is
    // the hatchable missing-record arm.
    const paths = stateHomePaths({ home });
    mkdirSync(paths.visualEvidenceRecords, { recursive: true });
    chmodSync(paths.visualEvidenceRecords, 0o555);
    try {
      const processed = await processedWith({ smallestFontPx: 1 });
      const report = fileEvidence({
        capturedAtIso: "2026-09-13T04:30:00.000Z",
        home,
        out,
        processed,
        result: resultWith({ observation: processed.observation }),
        url: "https://ap1.datadoghq.com/logs?viz=timeseries",
      });
      expect(report.outcome).toBe("evidence-unfit");
      expect(report.because).toContain("the unfit record could not be written");
      expect(report.because).toContain("the image was removed from");
      expect(existsSync(out)).toBe(false);
      // The raw capture stays: it never carried a record and no lane admits one.
      expect(existsSync(out.replace(/\.png$/, ".raw.png"))).toBe(true);
    } finally {
      chmodSync(paths.visualEvidenceRecords, 0o755);
    }
  });

  it("empties the image when the output directory refuses the delete — the r3 counterexample", async () => {
    // Unlinking needs write permission on the DIRECTORY; truncating needs only the permission the write
    // already had. With both the records directory and the output directory at 0555 over a pre-existing
    // writable PNG, the bytes must still end up unreadable.
    const paths = stateHomePaths({ home });
    mkdirSync(paths.visualEvidenceRecords, { recursive: true });
    chmodSync(paths.visualEvidenceRecords, 0o555);
    writeFileSync(out, "placeholder");
    writeFileSync(out.replace(/\.png$/, ".raw.png"), "placeholder");
    chmodSync(dirname(out), 0o555);
    try {
      const processed = await processedWith({ smallestFontPx: 1 });
      const report = fileEvidence({
        capturedAtIso: "2026-09-13T04:30:00.000Z",
        home,
        out,
        processed,
        result: resultWith({ observation: processed.observation }),
        url: "https://ap1.datadoghq.com/logs?viz=timeseries",
      });
      expect(report.outcome).toBe("evidence-unfit");
      expect(report.because).toContain("was emptied");
      expect(existsSync(out)).toBe(true);
      expect(statSync(out).size).toBe(0);
    } finally {
      chmodSync(dirname(out), 0o755);
      chmodSync(paths.visualEvidenceRecords, 0o755);
    }
  });

  it("reports record-failed for passing bytes when the capture record cannot be written", async () => {
    const paths = stateHomePaths({ home });
    mkdirSync(dirname(paths.visualEvidenceCaptures), { recursive: true });
    writeFileSync(paths.visualEvidenceCaptures, "not a directory");
    const processed = await processedWith({ smallestFontPx: 10 });
    const report = fileEvidence({
      capturedAtIso: "2026-09-13T04:30:00.000Z",
      home,
      out,
      processed,
      result: resultWith({ observation: processed.observation }),
      url: "https://ap1.datadoghq.com/logs?viz=timeseries",
    });
    expect(report.outcome).toBe("record-failed");
    expect(unwrap(readImageRecords({ digest: processed.final.artifact.digest, home }))).toEqual([]);
  });
});
