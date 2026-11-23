/**
 * The effectful half of `read_screen`: open the owner's screen share and grab one frame of it, or decode the one still
 * the desktop app took itself, when the model asks — the one frame a relay this turn may carry, since a relay
 * never grabs its own.
 *
 * Every decision — the size worth sending, the byte budget, the output shape — is `lib/screenFrame.ts`, which
 * is tested. This file only touches the browser: `getDisplayMedia`, a detached video element, an image bitmap
 * and a canvas.
 */
import { nativeScreenStillOf } from "../../lib/desktopShellWire";
import {
  FRAME_QUALITIES,
  type FrameSize,
  fittedFrameSize,
  fittedLongEdgeSize,
  RELAY_FRAME_DATA_URL_MAX,
  RELAY_FRAME_LONG_EDGE,
  RELAY_PICTURE_PREFIX,
  type ScreenFrame,
  tileTokenEstimate,
} from "../../lib/screenFrame";
import type { TalkRelayWire } from "../../lib/talkRelayRequestWire";

/** One open share: the stream, the element decoding it, and what the browser calls the surface. */
export interface ScreenShare {
  readonly stream: MediaStream;
  readonly video: HTMLVideoElement;
  readonly surface: string;
}

/**
 * Ask the owner for a screen share. The browser's own picker opens, offering the whole screen first; Chrome shows
 * its sharing bar for as long as the share runs, which is the visible mark this design rests on.
 *
 * @param onEnded called when the owner stops the share from the browser's own bar
 * @param onStream called with the stream the moment the picker returns, before the element decoding it plays, so
 *   a Stop pressed in between can end a capture the caller does not hold yet
 * @returns the open share
 */
export async function openScreenShare({
  onEnded,
  onStream,
}: {
  onEnded: () => void;
  onStream: (stream: MediaStream) => void;
}): Promise<ScreenShare> {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    audio: false,
    video: { displaySurface: "monitor", frameRate: { max: 5 } },
  });
  onStream(stream);
  const video = document.createElement("video");
  // A share that never became a ScreenShare has no owner to close it, so every failure below closes it here.
  const track = stream.getVideoTracks().at(0);
  if (track === undefined) {
    closeScreenShare({ share: { stream, surface: "", video } });
    throw new Error("the share carried no video");
  }
  track.addEventListener("ended", onEnded);
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  try {
    await video.play();
  } catch (cause) {
    closeScreenShare({ share: { stream, surface: "", video } });
    throw cause;
  }
  const settings = track.getSettings();
  let surface = "the owner's screen";
  if (settings.displaySurface === "monitor") {
    surface = "the owner's whole screen";
  } else if (settings.displaySurface === "window") {
    surface = "one window they picked";
  } else if (settings.displaySurface === "browser") {
    surface = "one browser tab they picked";
  }
  return { stream, surface, video };
}

/**
 * Stop a share and release its element.
 *
 * @param share the share to end
 */
export function closeScreenShare({ share }: { share: ScreenShare }): void {
  share.stream.getTracks().forEach((track) => {
    track.stop();
  });
  share.video.srcObject = null;
}

/** One look at the shared screen: what the model reads, and the same pixels kept as a relay's evidence. */
export interface ScreenCapture {
  /** The frame fitted to what the provider looks at, or why there is none. */
  readonly model: ScreenFrame | { readonly why: string };
  /** The same frame at a long edge of {@link RELAY_FRAME_LONG_EDGE}, for a relay this turn to carry. */
  readonly relay: TalkRelayWire["screen"];
}

/**
 * Grab the current frame ONCE and encode it twice: fitted for the model under its budget, and at a long edge of
 * {@link RELAY_FRAME_LONG_EDGE} as a relay's evidence. The video is drawn a single time and the model's copy is
 * scaled from that drawing, so the picture a relay carries is the one the voice looked at, never a later frame.
 *
 * In the desktop shell the voice is a window over the owner's whole desktop, and a share of their screen shows it exactly as
 * they see it — what the owner sees is what the voice sees.
 *
 * @param share the open share
 * @param modelBudget the most bytes the model's data URL may take
 * @returns both encodings; the relay's is `capture-failed` whenever the model's failed, so a look the voice
 *   never saw is never relayed
 */
export async function grabScreenFrames({
  share,
  modelBudget,
}: {
  share: ScreenShare;
  modelBudget: number;
}): Promise<ScreenCapture> {
  return grabNow({ modelBudget, share });
}

/**
 * A look that took no frame: the model hears why, and a relay this turn says the capture failed.
 *
 * @param why what stopped the grab, read to the model
 * @returns the capture carrying no picture on either side
 */
function failedCapture({ why }: { why: string }): ScreenCapture {
  return { model: { why }, relay: { kind: "none", reason: "capture-failed" } };
}

/**
 * Draw the frame the share's element holds now, once, and encode it for the model and as a relay's evidence.
 *
 * @param share the open share
 * @param modelBudget the most bytes the model's data URL may take
 * @returns both encodings, or why there is none
 */
async function grabNow({ share, modelBudget }: { share: ScreenShare; modelBudget: number }): Promise<ScreenCapture> {
  const source: FrameSize = { height: share.video.videoHeight, width: share.video.videoWidth };
  if (source.width === 0 || source.height === 0) {
    return failedCapture({ why: "the share has not produced a frame yet" });
  }
  return encodeFrames({ image: share.video, modelBudget, source }).catch(() =>
    failedCapture({ why: "the page could not encode the frame" }),
  );
}

/**
 * One look at the owner's screen in the desktop shell, with no share: the shell takes a still of the display the voice is on,
 * the voice included as the owner sees it (`desktop/src/nativeCapture.ts`), and the still is encoded exactly as a share's
 * frame is — so the model's copy and a relay's are the same pixels either way.
 *
 * @param capture the shell's `captureScreen`
 * @param modelBudget the most bytes the model's data URL may take
 * @returns both encodings, or why there is none — the shell's own refusal when it took no still, relayed as
 *   `screen-recording-off` when macOS Screen Recording refused it
 */
export async function grabNativeScreenFrames({
  capture,
  modelBudget,
}: {
  capture: () => Promise<unknown>;
  modelBudget: number;
}): Promise<ScreenCapture> {
  let reply: unknown;
  try {
    reply = await capture();
  } catch {
    // The look was attempted and gave nothing back, so it relays as a failed look, never as one not taken.
    return failedCapture({ why: "the desktop app did not answer the look" });
  }
  const still = nativeScreenStillOf({ value: reply });
  if (still.kind === "refused" && still.screenRecordingOff) {
    // No share was open: the row names the permission to grant, never a share that gave no frame.
    return { model: { why: still.why }, relay: { kind: "none", reason: "screen-recording-off" } };
  }
  if (still.kind === "refused") {
    return failedCapture({ why: still.why });
  }
  let bitmap: ImageBitmap;
  try {
    // A fresh copy of the bytes: the Blob takes a plain ArrayBuffer-backed view.
    bitmap = await createImageBitmap(new Blob([new Uint8Array(still.png)], { type: "image/png" }));
  } catch {
    return failedCapture({ why: "the page could not decode the still the desktop app took" });
  }
  try {
    if (bitmap.width !== still.width || bitmap.height !== still.height) {
      return failedCapture({ why: "the still the desktop app took is not the size it said" });
    }
    return await encodeFrames({
      image: bitmap,
      modelBudget,
      source: { height: bitmap.height, width: bitmap.width },
    });
  } catch {
    // An encoder that rejects is still a look that gave no frame, never one not taken.
    return failedCapture({ why: "the page could not encode the still the desktop app took" });
  } finally {
    bitmap.close();
  }
}

/**
 * Encode one drawn picture for the model and as a relay's evidence: drawn ONCE at the relay's size, and the model's
 * copy scaled from that drawing.
 *
 * @param image what to draw — the share's video element, or a still the shell took
 * @param source its own pixel size
 * @param modelBudget the most bytes the model's data URL may take
 * @returns both encodings, or why there is none
 */
async function encodeFrames({
  image,
  source,
  modelBudget,
}: {
  image: CanvasImageSource;
  source: FrameSize;
  modelBudget: number;
}): Promise<ScreenCapture> {
  const evidenceSize = fittedLongEdgeSize({ maxLongEdge: RELAY_FRAME_LONG_EDGE, source });
  const evidence = new OffscreenCanvas(evidenceSize.width, evidenceSize.height);
  const evidenceContext = evidence.getContext("2d");
  const size = fittedFrameSize({ source });
  const model = new OffscreenCanvas(size.width, size.height);
  const modelContext = model.getContext("2d");
  if (evidenceContext === null || modelContext === null) {
    return failedCapture({ why: "the page could not draw the frame" });
  }
  evidenceContext.drawImage(image, 0, 0, evidenceSize.width, evidenceSize.height);
  modelContext.drawImage(evidence, 0, 0, size.width, size.height);
  const encoded = await encodeUnderBudget({ budget: modelBudget, canvas: model, webpOnly: false });
  if (encoded.kind === "not-webp") {
    return failedCapture({ why: "the page could not encode the frame" });
  }
  if (encoded.kind === "too-big") {
    return failedCapture({
      why: `the frame was ${String(encoded.smallest)} bytes at the lowest quality and one message carries ${String(modelBudget)}`,
    });
  }
  const frame: ScreenFrame = {
    dataUrl: encoded.dataUrl,
    quality: encoded.quality,
    size,
    source,
    tokens: tileTokenEstimate({ size }),
  };
  const kept = await encodeUnderBudget({ budget: RELAY_FRAME_DATA_URL_MAX, canvas: evidence, webpOnly: true });
  if (kept.kind !== "fit") {
    return { model: frame, relay: { kind: "none", reason: "capture-failed" } };
  }
  return { model: frame, relay: { dataUrl: kept.dataUrl, kind: "attached" } };
}

/** What encoding one drawn canvas came to. */
export type CanvasEncoding =
  | { readonly kind: "fit"; readonly dataUrl: string; readonly quality: number }
  | { readonly kind: "too-big"; readonly smallest: number }
  | { readonly kind: "not-webp" };

/**
 * Encode a drawn canvas as WebP, stepping quality down through {@link FRAME_QUALITIES} until the data URL fits —
 * the ONE quality loop, for a screen frame here and a picture `file_read` returned (`./fileImageGrab.ts`). A browser that cannot write WebP falls back to PNG
 * silently: a model read takes that PNG like any frame, while `webpOnly` (the relay, which keeps only WebP)
 * answers `not-webp` at the first such result, before its size is judged.
 *
 * @param canvas the drawn picture, already at the size it is sent
 * @param budget the most bytes the data URL may take
 * @param webpOnly refuse a PNG fallback at once rather than send it
 * @returns the data URL and the quality that fit, the smallest size reached when none did, or `not-webp`
 */
export async function encodeUnderBudget({
  canvas,
  budget,
  webpOnly,
}: {
  canvas: OffscreenCanvas;
  budget: number;
  webpOnly: boolean;
}): Promise<CanvasEncoding> {
  let smallest = 0;
  for (const quality of FRAME_QUALITIES) {
    const dataUrl = await dataUrlOf({ blob: await canvas.convertToBlob({ quality, type: "image/webp" }) });
    if (webpOnly && !dataUrl.startsWith(RELAY_PICTURE_PREFIX)) {
      return { kind: "not-webp" };
    }
    if (dataUrl.length <= budget) {
      return { dataUrl, kind: "fit", quality };
    }
    smallest = dataUrl.length;
  }
  return { kind: "too-big", smallest };
}

/**
 * A blob as a base64 data URL — the voice's frame here.
 *
 * @param blob the encoded picture
 * @returns its data URL
 */
export async function dataUrlOf({ blob }: { blob: Blob }): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result !== "string") {
        reject(new Error("the frame was read back as something other than a data URL"));
        return;
      }
      resolve(reader.result);
    });
    reader.addEventListener("error", () => {
      if (reader.error === null) {
        reject(new Error("the frame could not be encoded, and the reader named no error"));
        return;
      }
      reject(reader.error);
    });
    reader.readAsDataURL(blob);
  });
}
