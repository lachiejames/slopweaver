/**
 * The text an image SHOWS, read off its pixels on this machine: macOS's own Vision text recogniser, called through
 * `osascript -l JavaScript`. No byte leaves the machine and no model runs, so an outbound write can judge what a
 * picture shows before it sends one, by the same privacy check as its words.
 *
 * ## Why pixels as well as the recorded frame text
 *
 * A capture verb records the text it drew or the page's DOM held (`./frameText.ts`). That is exact for what it
 * covers, but it covers only text that is text: words inside an `<img>`, a `<canvas>`, a video frame, a background
 * image or CSS-generated content are pixels to the DOM walk, and an image no capture verb took has no recorded text
 * at all. Recognition reads what is drawn, whatever drew it, so the two are run side by side and neither replaces
 * the other.
 *
 * ## Fail-closed
 *
 * Every way recognition can fail is an `Err`: a host that is not macOS, a recogniser that exits non-zero or is
 * killed at its bound, output that is not the shape below. A caller refuses the upload on any of them. Nothing here
 * turns a failure into an empty list of lines, because an empty list reads as "the picture shows no text".
 *
 * ## What it cannot see, stated rather than claimed
 *
 * An empty result means "no text was recognised", never "the picture holds no text". Recognition misses or misreads
 * small, blurred, rotated, low-contrast or handwritten text, and a term split across two recognised lines matches
 * neither. It reads no faces, maps, photographs of a place, logos or layouts at all. Those stay the capture rule:
 * no picture shows the owner's real Queue, calls or home.
 *
 * ## Measured
 *
 * A synthetic 640x160 PNG reading "Ticket ABC-1 for Acme Widgets" came back exactly, at confidence 1: 0.41s warm,
 * 66.7s on the first run of a loaded machine (Vision loading its model), so the bound is generous. Repro: write
 * {@link RECOGNISE_PROGRAM} to `ocr.js`, then `/usr/bin/time -p osascript -l JavaScript ocr.js <png>`.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";

/** The text recognised in one image: each recognised line's best reading, top to bottom as Vision reports them. */
export interface RecognisedImageText {
  readonly lines: readonly string[];
}

/** Recognition was asked of a host with no Vision framework. */
interface UnsupportedHostError {
  readonly code: "UNSUPPORTED_HOST";
  readonly message: string;
  readonly hostOs: string;
}

/** The recogniser could not run, or exited non-zero. Its output is never carried: it may hold what the image shows. */
interface RecogniserFailedError {
  readonly code: "RECOGNISER_FAILED";
  readonly message: string;
}

/** The recogniser was killed at its bound. */
interface RecogniserTimedOutError {
  readonly code: "RECOGNISER_TIMED_OUT";
  readonly message: string;
  readonly timeoutMs: number;
}

/** The recogniser answered with something that is not the agreed shape. Never echoed, for the same reason. */
interface RecogniserOutputMalformedError {
  readonly code: "RECOGNISER_OUTPUT_MALFORMED";
  readonly message: string;
}

/** Every way the text an image shows could not be read. Each one refuses the upload that asked. */
export type ImageTextError =
  UnsupportedHostError | RecogniserFailedError | RecogniserTimedOutError | RecogniserOutputMalformedError;

/** The factory every recognition failure is built through. */
export const ImageTextErrors = {
  outputMalformed: (): RecogniserOutputMalformedError => ({
    code: "RECOGNISER_OUTPUT_MALFORMED",
    message: "the text recogniser's answer was not the shape it is asked for",
  }),
  recogniserFailed: ({ exitStatus }: { exitStatus: number | undefined }): RecogniserFailedError => ({
    code: "RECOGNISER_FAILED",
    message:
      exitStatus === undefined
        ? "the text recogniser could not be run"
        : `the text recogniser exited ${String(exitStatus)}`,
  }),
  timedOut: ({ timeoutMs }: { timeoutMs: number }): RecogniserTimedOutError => ({
    code: "RECOGNISER_TIMED_OUT",
    message: `the text recogniser did not finish within ${String(timeoutMs / 1000)}s`,
    timeoutMs,
  }),
  unsupportedHost: ({ hostOs }: { hostOs: string }): UnsupportedHostError => ({
    code: "UNSUPPORTED_HOST",
    hostOs,
    message: `text in an image is read with macOS Vision, and this host is ${hostOs}`,
  }),
} as const;

/**
 * The constant JXA program: recognise the text in the image at `argv[0]` and print one JSON object, `{ "lines":
 * [{ "text", "confidence" }] }`, each recognised line's top candidate. Accurate recognition with language correction
 * off, so a code, an id or a name is read as drawn rather than corrected toward a dictionary word. A Vision failure
 * throws, which exits non-zero; its message is never printed back.
 */
export const RECOGNISE_PROGRAM =
  'ObjC.import("Foundation");ObjC.import("Vision");' +
  "function run(argv){" +
  "const request=$.VNRecognizeTextRequest.alloc.init;" +
  "request.recognitionLevel=0;request.usesLanguageCorrection=false;" +
  "const handler=$.VNImageRequestHandler.alloc.initWithURLOptions($.NSURL.fileURLWithPath(argv[0]),$({}));" +
  'if(!handler.performRequestsError($([request]),$())){throw new Error("recognition failed");}' +
  "const results=request.results;const lines=[];" +
  "for(let i=0;i<results.count;i++){const top=results.objectAtIndex(i).topCandidates(1);" +
  "if(top.count>0){const c=top.objectAtIndex(0);lines.push({text:ObjC.unwrap(c.string),confidence:c.confidence});}}" +
  "return JSON.stringify({lines:lines});}";

/** How long recognition may run before it is killed: the measured cold start, with room on a loaded machine. */
export const RECOGNISE_TIMEOUT_MS = 150_000;

/** The most output recognition may print; a picture's text is a few kilobytes, so anything near this is wrong. */
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

const recogniserOutputSchema = z
  .object({
    lines: z.array(z.object({ confidence: z.number().min(0).max(1), text: z.string() }).strict()),
  })
  .strict();

/**
 * Pure: the recogniser's printed answer, as the lines it read. Every top candidate is kept whatever its confidence,
 * because a scan over more text refuses at least as much; a blank candidate carries nothing a scan reads and is dropped.
 *
 * @param stdout what the program printed
 * @returns the lines, or that the answer was malformed (never echoed)
 */
export function parseRecognisedImageText({ stdout }: { stdout: string }): Result<RecognisedImageText, ImageTextError> {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    return err(ImageTextErrors.outputMalformed());
  }
  const parsed = recogniserOutputSchema.safeParse(raw);
  if (!parsed.success) {
    return err(ImageTextErrors.outputMalformed());
  }
  return ok({ lines: parsed.data.lines.map(({ text }) => text).filter((text) => text.trim() !== "") });
}

/** The process seam: run one program to completion and return what it printed, throwing as `execFileSync` throws. */
export type RecogniserRun = (command: {
  readonly file: string;
  readonly args: readonly string[];
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
}) => string;

/** The production seam: a bounded, blocking `osascript`, killed outright at its bound. */
const runRecogniser: RecogniserRun = ({ file, args, timeoutMs, maxOutputBytes }) =>
  execFileSync(file, args, {
    encoding: "utf8",
    killSignal: "SIGKILL",
    maxBuffer: maxOutputBytes,
    stdio: ["ignore", "pipe", "ignore"],
    timeout: timeoutMs,
  });

/**
 * Pure: the failure a thrown recogniser run means. Node marks a child killed at its bound `ETIMEDOUT`.
 *
 * @param cause what the run threw
 * @param timeoutMs the bound it ran under
 * @returns the typed failure, carrying no output
 */
export function recogniserRunFailure({ cause, timeoutMs }: { cause: unknown; timeoutMs: number }): ImageTextError {
  if (isRecord(cause) && cause["code"] === "ETIMEDOUT") {
    return ImageTextErrors.timedOut({ timeoutMs });
  }
  const status = isRecord(cause) && typeof cause["status"] === "number" ? cause["status"] : undefined;
  return ImageTextErrors.recogniserFailed({ exitStatus: status });
}

/**
 * Read the text an image shows, on this machine. The exact buffer is written to a fresh owner-only file the recogniser
 * reads, so what is judged is what will be sent, and the directory is removed whatever happens.
 *
 * @param bytes the image's bytes, the same buffer the caller will send
 * @param hostOs the host's operating system, `process.platform` (injected so the refusal is testable on any host)
 * @param run the process seam (injected so every failure is testable without Vision)
 * @param timeoutMs the bound recognition runs under
 * @returns the lines the image shows, or why they could not be read
 */
export function recogniseImageText({
  bytes,
  hostOs = process.platform,
  run = runRecogniser,
  timeoutMs = RECOGNISE_TIMEOUT_MS,
}: {
  bytes: Uint8Array;
  hostOs?: string;
  run?: RecogniserRun;
  timeoutMs?: number;
}): Result<RecognisedImageText, ImageTextError> {
  if (hostOs !== "darwin") {
    return err(ImageTextErrors.unsupportedHost({ hostOs }));
  }
  const dir = mkdtempSync(join(tmpdir(), "sw-img-"));
  try {
    const path = join(dir, "image");
    writeFileSync(path, bytes, { flag: "wx", mode: 0o600 });
    let stdout: string;
    try {
      stdout = run({
        args: ["-l", "JavaScript", "-e", RECOGNISE_PROGRAM, path],
        file: "/usr/bin/osascript",
        maxOutputBytes: MAX_OUTPUT_BYTES,
        timeoutMs,
      });
    } catch (cause: unknown) {
      return err(recogniserRunFailure({ cause, timeoutMs }));
    }
    return parseRecognisedImageText({ stdout });
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
}
