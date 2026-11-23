import { describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";
import { imageRecordOf, parseImageRecordForm } from "../../../visualEvidence/recordForm.js";

/** A passing, cropped form — the shape `browser image-record` takes when a screenshot was cut down. */
const croppedForm = ({ sourceDigest }: { sourceDigest: string }): Record<string, unknown> => ({
  contextRetained: true,
  crop: { kind: "cropped", rect: { height: 400, width: 800, x: 20, y: 60 }, sourceDigest },
  observedContent: "the p95 latency panel, axes and time range intact",
  observerSession: "unit-test",
  path: "/tmp/panel.png",
  targetState: "data",
  verdict: "passed",
});

describe("parseImageRecordForm — crop.sourceDigest is a digest, not any string", () => {
  it("refuses a bare hex sourceDigest, naming the field and the read edge's own message", () => {
    // MEASURED: this exact value was admitted, written
    // and printed `passed`; the next read refused the whole file with the message asserted here.
    const result = parseImageRecordForm({ value: croppedForm({ sourceDigest: "39cc95c7" }) });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toEqual(["crop.sourceDigest: expected sha256:<64 hex>"]);
  });

  it("refuses an empty sourceDigest with the same message — min(1) is not the bar any more", () => {
    const result = parseImageRecordForm({ value: croppedForm({ sourceDigest: "" }) });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toEqual(["crop.sourceDigest: expected sha256:<64 hex>"]);
  });

  it("refuses uppercase hex — the read edge is lowercase-only, so the write edge is too", () => {
    const result = parseImageRecordForm({ value: croppedForm({ sourceDigest: `sha256:${"A".repeat(64)}` }) });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toEqual(["crop.sourceDigest: expected sha256:<64 hex>"]);
  });

  it("parses a well-formed sourceDigest and carries it through unchanged", () => {
    const sourceDigest = `sha256:${"39cc95c7".repeat(8)}`;
    const form = unwrap(parseImageRecordForm({ value: croppedForm({ sourceDigest }) }));
    expect(form.crop).toEqual({ kind: "cropped", rect: { height: 400, width: 800, x: 20, y: 60 }, sourceDigest });
  });

  it("holds expectDigest to the same regex with the same message", () => {
    const value = { ...croppedForm({ sourceDigest: `sha256:${"b".repeat(64)}` }), expectDigest: "sha256:short" };
    const result = parseImageRecordForm({ value });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toEqual(["expectDigest: expected sha256:<64 hex>"]);
  });
});

/** A passing, already-framed form: the shape a first channel message's screenshot is recorded with. */
const framedForm = (): Record<string, unknown> => ({
  contextRetained: true,
  crop: { kind: "already-framed", reason: "the panel fills the capture" },
  observedContent: "the failing control, boxed, nothing covering it",
  observerSession: "unit-test",
  path: "/tmp/control.png",
  targetState: "data",
  verdict: "passed",
});

const BOX = { note: "the failing control", rect: { height: 40, width: 120, x: 10, y: 20 } };
const ARTIFACT = { digest: `sha256:${"c".repeat(64)}`, heightPx: 300, widthPx: 600 };
const FAILED_WITH_BOXES =
  "a failed record carries no `annotations` or `obstruction` — those vouch for a picture fit to send; an " +
  "obscured one is `reason: obscured`";

describe("parseImageRecordForm — annotations and obstruction", () => {
  it("carries a passed form's annotations and obstruction into the record from imageRecordOf", () => {
    const form = unwrap(parseImageRecordForm({ value: { ...framedForm(), annotations: [BOX], obstruction: "none" } }));
    const record = imageRecordOf({ artifact: ARTIFACT, form, receiptId: "img-1" });
    expect(record).toMatchObject({ annotations: [BOX], obstruction: "none", outcome: "passed" });
  });

  it("writes neither key into a passed record whose form named none", () => {
    const form = unwrap(parseImageRecordForm({ value: framedForm() }));
    const record = imageRecordOf({ artifact: ARTIFACT, form, receiptId: "img-2" });
    expect(Object.keys(record).toSorted()).toEqual([
      "artifact",
      "crop",
      "outcome",
      "policyVersion",
      "readBack",
      "receiptId",
      "schemaVersion",
    ]);
  });

  it("refuses a failed form carrying annotations, naming what a failed record omits", () => {
    const value = {
      ...framedForm(),
      annotations: [BOX],
      correction: "retake it",
      reason: "illegible",
      verdict: "failed",
    };
    expect(parseImageRecordForm({ value })._unsafeUnwrapErr()).toEqual([FAILED_WITH_BOXES]);
  });

  it("refuses a failed form carrying obstruction with the same message", () => {
    const value = {
      ...framedForm(),
      correction: "retake it",
      obstruction: "none",
      reason: "illegible",
      verdict: "failed",
    };
    expect(parseImageRecordForm({ value })._unsafeUnwrapErr()).toEqual([FAILED_WITH_BOXES]);
  });

  it("accepts reason obscured on a failed form and records it", () => {
    const value = {
      ...framedForm(),
      correction: "dismiss the banner and retake",
      reason: "obscured",
      verdict: "failed",
    };
    const form = unwrap(parseImageRecordForm({ value }));
    const record = imageRecordOf({ artifact: ARTIFACT, form, receiptId: "img-3" });
    expect(record).toMatchObject({
      correction: "dismiss the banner and retake",
      outcome: "failed",
      reason: "obscured",
    });
  });

  it("refuses an obstruction other than none, and an empty annotations list", () => {
    const covered = parseImageRecordForm({ value: { ...framedForm(), obstruction: "banner" } });
    const empty = parseImageRecordForm({ value: { ...framedForm(), annotations: [] } });
    expect(covered._unsafeUnwrapErr()[0]).toContain("obstruction:");
    expect(empty._unsafeUnwrapErr()[0]).toContain("annotations:");
  });
});
