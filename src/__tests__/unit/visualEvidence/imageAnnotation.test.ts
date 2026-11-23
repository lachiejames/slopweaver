/**
 * The annotation arm of the image record schema (`visualEvidence/schema.ts`): the boxes a passed record vouches for lie
 * inside the picture and each carries a note a reader sees.
 */
import { describe, expect, it } from "vitest";

import { annotationBoundsIssues, imageRecordSchema } from "../../../visualEvidence/schema.js";
import { annotatedRecord } from "../../annotatedShotFixture.js";

const DIGEST = `sha256:${"d".repeat(64)}`;
const PICTURE = { heightPx: 300, widthPx: 600 };

/** A box of the given size at the given corner. */
const box = ({ height, width, x, y }: { height: number; width: number; x: number; y: number }) => ({
  rect: { height, width, x, y },
});

describe("annotationBoundsIssues", () => {
  it("is empty when the record carries no annotations", () => {
    expect(annotationBoundsIssues({ annotations: undefined, artifact: PICTURE })).toEqual([]);
  });

  it("is empty for a box inside the picture, one touching the far edges included", () => {
    const annotations = [
      box({ height: 40, width: 120, x: 10, y: 20 }),
      box({ height: 100, width: 200, x: 400, y: 200 }),
    ];
    expect(annotationBoundsIssues({ annotations, artifact: PICTURE })).toEqual([]);
  });

  it("names the box past the right edge, by index", () => {
    const annotations = [box({ height: 10, width: 10, x: 0, y: 0 }), box({ height: 40, width: 120, x: 500, y: 20 })];
    expect(annotationBoundsIssues({ annotations, artifact: PICTURE })).toEqual([
      "annotations.1: the box 120x40 at 500,20 runs past the 600x300 picture",
    ]);
  });

  it("names the box past the bottom edge, and each out-of-bounds box once", () => {
    const annotations = [box({ height: 301, width: 10, x: 0, y: 0 }), box({ height: 10, width: 601, x: 0, y: 0 })];
    expect(annotationBoundsIssues({ annotations, artifact: PICTURE })).toEqual([
      "annotations.0: the box 10x301 at 0,0 runs past the 600x300 picture",
      "annotations.1: the box 601x10 at 0,0 runs past the 600x300 picture",
    ]);
  });
});

describe("imageRecordSchema — annotations on a passed record", () => {
  it("parses the fixture's annotated, unobstructed record", () => {
    const parsed = imageRecordSchema.safeParse(annotatedRecord({ digest: DIGEST }));
    expect(parsed.success).toBe(true);
    expect(parsed.data).toMatchObject({ obstruction: "none", outcome: "passed" });
  });

  it("rejects a passed record whose box runs past the picture, with the bounds message", () => {
    const record = annotatedRecord({
      digest: DIGEST,
      over: { annotations: [{ note: "the failing control", rect: { height: 1, width: 2, x: 1, y: 0 } }] },
    });
    const parsed = imageRecordSchema.safeParse(record);
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues.map((issue) => issue.message)).toEqual([
      "annotations.0: the box 2x1 at 1,0 runs past the 2x2 picture",
    ]);
  });

  it("rejects a note that is only whitespace, naming what a note is for", () => {
    const record = annotatedRecord({
      digest: DIGEST,
      over: { annotations: [{ note: "   \n\t", rect: { height: 1, width: 1, x: 0, y: 0 } }] },
    });
    const parsed = imageRecordSchema.safeParse(record);
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues.map((issue) => issue.message)).toEqual(["a note says what the box marks"]);
  });

  it("rejects an empty annotations list and an obstruction other than none", () => {
    const empty = imageRecordSchema.safeParse(annotatedRecord({ digest: DIGEST, over: { annotations: [] } }));
    const covered = imageRecordSchema.safeParse({ ...annotatedRecord({ digest: DIGEST }), obstruction: "banner" });
    expect([empty.error!.issues[0]!.path, covered.error!.issues[0]!.path]).toEqual([["annotations"], ["obstruction"]]);
  });

  it("rejects a failed record carrying annotations, which only a passed record may vouch with", () => {
    const failed = {
      ...annotatedRecord({ digest: DIGEST }),
      correction: "retake it",
      outcome: "failed",
      reason: "obscured",
    };
    const parsed = imageRecordSchema.safeParse(failed);
    expect(parsed.error!.issues.map((issue) => issue.message)).toEqual([
      'Unrecognized keys: "annotations", "obstruction"',
    ]);
  });
});
