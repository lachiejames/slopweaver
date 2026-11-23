/**
 * The capture receipt a proof cassette writes: the same version-2 shape every capture verb writes, so
 * `github attach` admits a recording through the same checks as a picture — a receipt naming these exact bytes, a
 * frame text to scan, the five image checks and the metadata strip.
 *
 * The frame is the whole video frame and the crop rectangle is all of it: the recorder drives a terminal of its own
 * that shows only what the tape typed, so there is no larger screen a crop was cut from. The frame text is the
 * recorder's transcript (`transcriptFrameText`).
 */
import { createHash } from "node:crypto";

import { type CaptureReceipt, captureIdFor } from "../../visualEvidence/captureRecord.js";
import { transcriptFrameText } from "../../visualEvidence/frameText.js";
import { imageDigestOf } from "../../visualEvidence/imageIo.js";
import type { VideoFrameSize } from "./finalise.js";

/**
 * Build a cassette's capture receipt from the stripped video and the transcript written beside it.
 *
 * @param bytes the stripped video's bytes, exactly what an upload would send
 * @param frame the video's frame size, probed off those bytes
 * @param out where the video was written
 * @param tape the tape file the session wrote, as named on the command line
 * @param tapeSource that tape's text, as read
 * @param transcript the transcript's text, `null` when the recorder wrote none
 * @param transcriptPath where the transcript was expected
 * @param capturedAtIso when the recording finished
 * @returns the receipt
 */
export function cassetteReceiptOf({
  bytes,
  frame,
  out,
  tape,
  tapeSource,
  transcript,
  transcriptPath,
  capturedAtIso,
}: {
  bytes: Uint8Array;
  frame: VideoFrameSize;
  out: string;
  tape: string;
  tapeSource: string;
  transcript: string | null;
  transcriptPath: string;
  capturedAtIso: string;
}): CaptureReceipt {
  const digest = imageDigestOf({ bytes });
  return {
    captureId: captureIdFor({ digest }),
    capturedAtIso,
    cropRect: { height: frame.heightPx, width: frame.widthPx, x: 0, y: 0 },
    detail: {
      tape,
      tapeDigest: `sha256:${createHash("sha256").update(tapeSource).digest("hex")}`,
      transcript: transcriptPath,
    },
    final: { artifact: { digest, heightPx: frame.heightPx, widthPx: frame.widthPx }, metadata: "stripped", path: out },
    frameText: transcriptFrameText({ frame, transcript }),
    schemaVersion: 2,
    source: { heightPx: frame.heightPx, widthPx: frame.widthPx },
    status: "readback-pending",
    verb: "proof cassette",
  };
}
