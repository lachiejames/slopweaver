/**
 * The effectful half of a `file_read` that came back a picture: decode the verb's bytes, fit them to what the
 * provider looks at, and re-encode them under the channel's byte budget — `read_screen`'s exact path, from a
 * file instead of a share. What is decided is `../../lib/fileImage.ts` and `../../lib/screenFrame.ts`.
 *
 * Re-encoding is the boundary as well as the fit: drawing onto a canvas keeps only pixels, so a picture's EXIF,
 * PNG text chunks and anything else riding in the file never leave this machine (docs/console-voice-boundary.md
 * § Any file on this machine).
 */
import { type FileImagePayload, fileImageOutputOf } from "../../lib/fileImage";
import { type FrameSize, fittedFrameSize, frameByteBudget, tileTokenEstimate } from "../../lib/screenFrame";
import { encodeUnderBudget } from "./screenGrab";
import type { ToolSeams } from "./talkToolRunTypes";

/**
 * One file picture as `file_read`'s answer, or the refusal saying why it could not be sent.
 *
 * @param image the verb's picture payload
 * @param maxMessageSize the channel's largest message, which bounds the picture
 * @returns the answer, the image output when there is one, and the log line's detail
 */
export async function fileImageAnswerOf({
  image,
  maxMessageSize,
}: {
  image: FileImagePayload;
  maxMessageSize: number | undefined;
}): ReturnType<ToolSeams["fileImage"]> {
  const refused = ({ why }: { why: string }): Awaited<ReturnType<ToolSeams["fileImage"]>> => ({
    answer: { refused: `${image.path}: ${why}` },
    detail: why,
    output: undefined,
  });
  let bitmap: ImageBitmap;
  try {
    const blob = await (await fetch(`data:${image.mediaType};base64,${image.base64}`)).blob();
    bitmap = await createImageBitmap(blob);
  } catch {
    return refused({ why: `the browser could not decode this ${image.mediaType}` });
  }
  const source: FrameSize = { height: bitmap.height, width: bitmap.width };
  const size = fittedFrameSize({ source });
  if (size.width === 0 || size.height === 0) {
    bitmap.close();
    return refused({ why: "the picture has no pixels" });
  }
  const canvas = new OffscreenCanvas(size.width, size.height);
  const context = canvas.getContext("2d");
  if (context === null) {
    bitmap.close();
    return refused({ why: "the page could not draw the picture" });
  }
  context.drawImage(bitmap, 0, 0, size.width, size.height);
  bitmap.close();
  const budget = frameByteBudget({ maxMessageSize });
  const encoded = await encodeUnderBudget({ budget, canvas, webpOnly: false });
  if (encoded.kind === "not-webp") {
    return refused({ why: "the page could not encode the picture" });
  }
  if (encoded.kind === "too-big") {
    return refused({
      why: `the picture was ${String(encoded.smallest)} bytes at the lowest quality and one message carries ${String(budget)}`,
    });
  }
  const frame = { ...encoded, size, source, tokens: tileTokenEstimate({ size }) };
  return {
    answer: undefined,
    detail:
      `${String(size.width)}×${String(size.height)} of ${image.path}, ` +
      `${String(Math.round(frame.dataUrl.length / 1024))} KiB, ~${String(frame.tokens)} image tokens (estimate)`,
    output: fileImageOutputOf({ frame, image }),
  };
}
