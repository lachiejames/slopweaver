/**
 * The last two steps a rendered cassette goes through before its capture receipt is written: strip the container's
 * metadata, then read the frame size of the bytes that will be uploaded.
 *
 * ## What the strip removes, MEASURED
 *
 * VHS hands its frames to ffmpeg, which writes `encoder` tags into the container, and any `title` or other tag a
 * future VHS adds would ride along. The strip re-muxes with `-map_metadata -1 -map_chapters -1 -c copy` and the
 * bit-exact flags, so no frame is re-encoded and nothing but the streams survives. Measured on a generated clip
 * carrying a title tag (ffmpeg 8): before, the format tags held `title` and `encoder` and the stream tags `encoder`;
 * after, only `major_brand`, `minor_version`, `compatible_brands`, `language` and `handler_name` remained — the
 * structural fields every MP4 has. Repro, from an empty scratch directory:
 *
 *     ffmpeg -v error -f lavfi -i color=c=black:s=64x32:d=1 -metadata title=T -pix_fmt yuv420p in.mp4
 *     ffmpeg -v error -i in.mp4 -map 0 -map_metadata -1 -map_chapters -1 -c copy -fflags +bitexact \
 *       -flags:v +bitexact -movflags +faststart out.mp4
 *     ffprobe -v error -show_entries format_tags:stream_tags -of json out.mp4
 *
 * What a copy cannot remove: x264 writes its encoding settings into the video bitstream itself. Those are encoder
 * options, never a name, path or account.
 *
 * ## The size is read off the bytes, never the tape
 *
 * A tape may `Set Width` and VHS has defaults of its own, so the frame size is probed from the stripped file
 * (`ffprobe ... -of csv=p=0:s=x`, which printed `64x32` for the clip above).
 */
import { execFileSync } from "node:child_process";
import { renameSync, rmSync } from "node:fs";

import { err, ok, type Result } from "#lib/result.js";

/** How long one ffmpeg or ffprobe run may block — a re-mux of a short cassette takes well under a second. */
const FFMPEG_TIMEOUT_MS = 60_000;

/** A video's frame size. */
export interface VideoFrameSize {
  readonly widthPx: number;
  readonly heightPx: number;
}

/**
 * Read `WIDTHxHEIGHT`, as `ffprobe -of csv=p=0:s=x` prints a video stream's size.
 *
 * @param text what ffprobe printed
 * @returns the size, or why the text is not one
 */
export function parseProbedSize({ text }: { text: string }): Result<VideoFrameSize> {
  const match = /^(\d+)x(\d+)$/u.exec(text.trim());
  if (match === null) {
    return err([`ffprobe reported no video size: ${JSON.stringify(text.trim())}`]);
  }
  const widthPx = Number(match[1]);
  const heightPx = Number(match[2]);
  if (widthPx <= 0 || heightPx <= 0) {
    return err([`ffprobe reported an empty video frame: ${String(widthPx)}x${String(heightPx)}`]);
  }
  return ok({ heightPx, widthPx });
}

/** The message a failed child process carries. */
function failure({ cause }: { cause: unknown }): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Strip a rendered video's container metadata in place, then read its frame size.
 *
 * @param path the rendered `.mp4`
 * @returns the stripped file's frame size, or why it could not be finalised
 */
export function finaliseCassetteVideo({ path }: { path: string }): Result<VideoFrameSize> {
  const stripped = `${path}.stripped.mp4`;
  try {
    const input = ["-v", "error", "-y", "-i", path, "-map", "0", "-map_metadata", "-1", "-map_chapters", "-1"];
    const output = ["-c", "copy", "-fflags", "+bitexact", "-flags:v", "+bitexact", "-movflags", "+faststart", stripped];
    execFileSync("ffmpeg", input.concat(output), { encoding: "utf8", timeout: FFMPEG_TIMEOUT_MS });
    renameSync(stripped, path);
  } catch (cause: unknown) {
    rmSync(stripped, { force: true });
    return err([`could not strip the video's metadata with ffmpeg: ${failure({ cause })}`]);
  }
  let probed: string;
  try {
    probed = execFileSync(
      "ffprobe",
      ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", path],
      { encoding: "utf8", timeout: FFMPEG_TIMEOUT_MS },
    );
  } catch (cause: unknown) {
    return err([`could not read the video's frame size with ffprobe: ${failure({ cause })}`]);
  }
  return parseProbedSize({ text: probed });
}
