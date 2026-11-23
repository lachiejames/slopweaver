/**
 * Test seams for the image-admission boundary every Slack send now crosses.
 *
 * Plain injected functions, not mocks: `.claude/rules/testing.md` bans `vi.mock`/`vi.spyOn`/`vi.fn` and
 * names exactly this shape — "a plain fake function passed in, which is not a mock" — as the way to isolate
 * a seam. Each records what it was asked about, so a test asserts on an exact call list rather than on a
 * spy's internals.
 */

import { err, ok, type Result } from "#lib/result.js";
import type { SlackUpload } from "../corpus/slack/writeTransport.js";
import type { ImageAdmit } from "../visualEvidence/admitUploads.js";
import { type ImageAdmissionError, ImageAdmissionErrors } from "../visualEvidence/errors.js";

/** An admit seam that always allows, plus the batches it was asked about. */
export interface AdmitAllFake {
  readonly admit: ImageAdmit;
  /** One entry per call, holding that call's filenames in order. */
  readonly asked: readonly (readonly string[])[];
}

/**
 * A seam that admits every batch, recording each one.
 *
 * @returns the seam and its record of calls
 */
export function admitAll(): AdmitAllFake {
  const asked: string[][] = [];
  return {
    admit: async ({
      uploads,
    }: {
      readonly uploads: readonly SlackUpload[];
    }): Promise<Result<null, ImageAdmissionError>> => {
      asked.push(uploads.map((upload) => upload.filename));
      return ok(null);
    },
    get asked() {
      return asked;
    },
  };
}

/**
 * A seam that refuses every batch with a `hold`, as a recorded-bad image does.
 *
 * @param filename the file the refusal names
 * @returns the seam
 */
export function refuseKnownBad({ filename }: { filename: string }): ImageAdmit {
  return async (): Promise<Result<null, ImageAdmissionError>> =>
    err(
      ImageAdmissionErrors.knownBad({
        findings: [
          {
            code: "image.empty-panel",
            correction: "wait for the panel to render, then crop to the chart",
            severity: "hold",
            summary: `${filename} was looked at and recorded as unfit to send`,
          },
        ],
      }),
    );
}

/**
 * A seam that refuses every batch for having no record at all.
 *
 * @param digest the artifact digest the refusal names
 * @returns the seam
 */
export function refuseUnrecorded({ digest }: { digest: string }): ImageAdmit {
  return async (): Promise<Result<null, ImageAdmissionError>> =>
    err(ImageAdmissionErrors.recordMissing({ digests: [digest] }));
}

/**
 * A seam that admits its FIRST call and refuses every later one — the concurrent-failure race.
 *
 * Models a review-found sequence: a batch is admitted, and while its members are uploading
 * another session records one of them as unfit. The second consultation is the one that must refuse.
 *
 * @param filename the file the later refusal names
 * @returns the seam and a live count of how many times it was consulted
 */
export function admitThenFail({ filename }: { filename: string }): {
  readonly admit: ImageAdmit;
  readonly calls: () => number;
} {
  let seen = 0;
  const bad = refuseKnownBad({ filename });
  return {
    admit: async (args): Promise<Result<null, ImageAdmissionError>> => {
      seen += 1;
      if (seen === 1) {
        return ok(null);
      }
      return bad(args);
    },
    calls: () => seen,
  };
}
