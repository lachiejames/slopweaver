/**
 * The gate that refuses to attach an animated GIF to a pull request, and names the video route instead.
 *
 * A VHS cassette GIF in a pull request's Proof cell runs for ages with no timeline control, and a reader who missed the start had to sit out an unknown loop to see it again. An
 * `.mp4` uploaded through the same door renders as a player — a scrubber, a duration, a pause — so a
 * recording goes out as one. Why a frame count rather than a loop flag: `../outbound/github/animatedGif.ts`.
 *
 * `warn` with a journalled override, like every gate on this door: a looping micro-interaction whose loop IS
 * the claim is a real exception, and the door records the waiver so it stays findable.
 */

import { gifFrameCount } from "../outbound/github/animatedGif.js";
import type { DoorFinding, DoorGate } from "./types.js";

/**
 * The override token that waives this gate, recorded by the door whenever it is used.
 *
 * @internal — named here so the value has one home; the verb and the tests quote it rather than re-spelling it.
 */
export const ANIMATED_GIF_OVERRIDE = "visual.animated-gif:v1";

/** One file the door is about to send: where it came from and its bytes. */
interface CandidateFile {
  readonly ref: string;
  readonly bytes: Uint8Array;
}

/**
 * Every animated GIF among the files, as door findings.
 *
 * @param files the files the seam is about to send
 * @returns one finding per GIF carrying more than one frame; empty for a still GIF, a video, or anything else
 */
export function animatedGifFindings({ files }: { files: readonly CandidateFile[] }): readonly DoorFinding[] {
  return files.flatMap(({ bytes, ref }): readonly DoorFinding[] => {
    const frames = gifFrameCount({ bytes });
    if (frames === undefined || frames < 2) {
      return [];
    }
    return [
      {
        code: "ANIMATED_GIF",
        correction:
          "ship it as an .mp4 so the reader gets a scrubber, a duration and a pause — a VHS tape renders " +
          "through `slopweaver proof cassette --tape <tape> --out <name>.mp4`, anything else through " +
          "`ffmpeg -i <name>.gif -movflags faststart -pix_fmt yuv420p -vf 'scale=trunc(iw/2)*2:trunc(ih/2)*2' " +
          "<name>.mp4` — or acknowledge this one, " +
          "carrying the reason its loop is the point",
        override: ANIMATED_GIF_OVERRIDE,
        severity: "warn",
        summary: `${ref} is an animated GIF (${String(frames)} frames): it autoplays and loops with no timeline control`,
      },
    ];
  });
}

/**
 * The animated-GIF gate, ready to compose into a door's gate list.
 *
 * @param files the files the seam is about to send
 * @returns a `DoorGate` reporting every recording that must not go out as a GIF unacknowledged
 */
export function animatedGifGate({ files }: { files: readonly CandidateFile[] }): DoorGate {
  return () => animatedGifFindings({ files });
}
