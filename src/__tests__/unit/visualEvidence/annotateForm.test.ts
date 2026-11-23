import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { imageRecordFormForAnnotatedImage, parseAnnotateForm } from "../../../visualEvidence/annotateForm.js";

const DIGEST = `sha256:${"a".repeat(64)}`;

/** A form that passes, with `over` replacing its fields. */
function form({ over = {} }: { over?: Record<string, unknown> } = {}): Record<string, unknown> {
  return {
    annotations: [{ note: "the overdue check", rect: { height: 20, width: 100, x: 10, y: 30 } }],
    contextRetained: true,
    crop: { kind: "already-framed", reason: "the Vanta table fills the viewport" },
    observedContent: "two background checks overdue since 1 Oct",
    observerSession: "session-1",
    obstruction: "none",
    out: "/tmp/annotated.png",
    source: "/tmp/capture.png",
    targetState: "data",
    ...over,
  };
}

describe("parseAnnotateForm", () => {
  it("parses a complete form", () => {
    const parsed = unwrap(parseAnnotateForm({ value: form() }));

    expect(parsed.source).toBe("/tmp/capture.png");
    expect(parsed.annotations).toEqual([{ note: "the overdue check", rect: { height: 20, width: 100, x: 10, y: 30 } }]);
  });

  it("refuses a key it does not declare — a capture link, which annotating would break", () => {
    const problems = unwrapErr(parseAnnotateForm({ value: form({ over: { captureId: "cap-1" } }) }));

    expect(problems.join("\n")).toContain('Unrecognized key: "captureId"');
  });

  it("refuses zero boxes and five", () => {
    const box = { note: "x", rect: { height: 1, width: 1, x: 0, y: 0 } };

    const none = unwrapErr(parseAnnotateForm({ value: form({ over: { annotations: [] } }) }));
    const five = unwrapErr(parseAnnotateForm({ value: form({ over: { annotations: [box, box, box, box, box] } }) }));

    expect(none[0]).toContain("annotations:");
    expect(five[0]).toContain("annotations:");
  });

  it("refuses a cropped disposition — annotating cuts nothing out of a source", () => {
    const problems = unwrapErr(
      parseAnnotateForm({
        value: form({
          over: { crop: { kind: "cropped", rect: { height: 1, width: 1, x: 0, y: 0 }, sourceDigest: DIGEST } },
        }),
      }),
    );

    expect(problems[0]).toContain("crop.kind:");
  });

  it("refuses an unrendered target and an obstruction other than none", () => {
    const unloaded = unwrapErr(parseAnnotateForm({ value: form({ over: { targetState: "unloaded" } }) }));
    const covered = unwrapErr(parseAnnotateForm({ value: form({ over: { obstruction: "banner" } }) }));

    expect(unloaded[0]).toContain("targetState:");
    expect(covered[0]).toContain("obstruction:");
  });

  it("refuses a form the image-record form it becomes would refuse: context lost", () => {
    const problems = unwrapErr(parseAnnotateForm({ value: form({ over: { contextRetained: false } }) }));

    expect(problems[0]).toContain("`contextRetained` is false");
  });
});

describe("imageRecordFormForAnnotatedImage", () => {
  it("names the output, its digest and the boxes as drawn, passed, with no capture link", () => {
    const parsed = unwrap(parseAnnotateForm({ value: form() }));
    const drawn = [{ note: "the overdue check - HRS-56", rect: { height: 20, width: 100, x: 10, y: 30 } }];

    const recordForm = unwrap(
      imageRecordFormForAnnotatedImage({
        annotations: drawn,
        form: parsed,
        outputDigest: DIGEST,
        outputPath: "/abs/annotated.png",
      }),
    );

    expect(recordForm).toEqual({
      annotations: drawn,
      contextRetained: true,
      crop: { kind: "already-framed", reason: "the Vanta table fills the viewport" },
      expectDigest: DIGEST,
      observedContent: "two background checks overdue since 1 Oct",
      observerSession: "session-1",
      obstruction: "none",
      path: "/abs/annotated.png",
      targetState: "data",
      verdict: "passed",
    });
  });
});
