/**
 * What `github attach upload` holds one picture or recording to before any byte leaves the machine: a capture
 * receipt that names these exact bytes, written by the one capture verb admitted, a one-line statement of what it
 * proves, a publication scan over every word a reader will see in or beside it, the five image checks, the crop rule
 * and the metadata strip.
 *
 * ## Only `browser console-shot` is admitted
 *
 * Every other capture verb's receipt is held (`attach.capture-verb`) until a figure check exists, since its picture
 * can carry a figure from the operator's own accounts; `./attachCaptureVerb.ts` holds that rule and the content-type
 * checks. The checks below still run beside the hold, so every problem is named at once.
 *
 * ## A picture's words are read twice: as recorded, and off its pixels
 *
 * The receipt's frame text is what the capture verb drew or the page's DOM held, exact for text that is text. The
 * pixels can show more — words inside an `<img>`, a `<canvas>`, a video frame or a background image — so a picture's
 * text is also recognised on this machine (`../../visualEvidence/imageTextRecognition.ts`, macOS Vision, no egress) and
 * scanned as the `pixel-text` surface. Pixels whose text cannot be read hold the upload (`attach.pixel-text-unread`):
 * an unread picture is an unchecked one. What recognition cannot see — a face, a map, a photograph of a place, text too
 * small, blurred or rotated to read, a term split across two lines — stays the capture rule that no picture shows the
 * owner's real Queue, calls or home. A recording is not recognised: its screens are the transcript already scanned.
 *
 * ## A recording goes through the same checks, and is held
 *
 * `proof cassette` writes the same receipt as the picture verbs, its frame text the recording's transcript, so a
 * video is judged by exactly this path — found by its digest, scanned, viewed, declared as the type its verb wrote —
 * and then held on its verb, like every capture but a console shot.
 * Two checks read differently for it. The crop rule does not apply — the recorder drives a terminal of its own that
 * shows only what the tape typed, so there is no larger screen a crop was cut from. The metadata check reads PNG
 * chunks, so for an MP4 the receipt's own digest stands in: the bytes are the ones the verb stripped. A GIF, or a
 * video no verb recorded, has no receipt and stays refused.
 *
 * ## The receipt is found by the bytes, never by the path
 *
 * Every capture verb names its receipt from the final bytes' digest (`captureIdFor`), so this module hashes the file
 * it is about to send, looks up `cap-<digest>` and requires the receipt's own final digest to equal it. A renamed
 * file, a copied file and a file edited after capture therefore resolve to what the BYTES are: an edited file has a
 * new digest and no receipt, which is the refusal it should get. A legacy version-1 receipt is found and refused —
 * it carries no frame text, so there is nothing for the scan to read.
 *
 * ## The scan is a port
 *
 * {@link AttachTextScan} is the narrow seam: "scan this text, which a reader meets on this surface". Its default,
 * {@link publicationAttachScan}, is the publication scan every pull-request surface crosses
 * (`../publicationScan.ts`): frame text as a quotation of a screen (installation state and hygiene only), the
 * proves line and alt text as an image caption (first person and host wording too). It forgives none of the
 * installation's own identifiers — stricter than the description, the safe direction for text that can never be
 * edited out of a picture once uploaded.
 *
 * ## Every check is a HOLD, and the door records it
 *
 * Each problem is a `hold` `DoorFinding`, composed into the attachment door beside the invented-visual and
 * animated-GIF gates, so the ledger records the refusal and `--acknowledge` cannot waive it: none of these has a
 * legitimate exception a reason could carry. The dry run prints the same findings through the same renderer.
 *
 * Pure apart from {@link resolveAttachEvidence}, which reads the evidence store under an explicit home.
 */
import type { DoorFinding, DoorGate } from "../../admit/types.js";
import type { PrivateTerm } from "../../hygiene/privateTerms.js";
import type { Result } from "../../lib/result.js";
import {
  type CaptureReceipt,
  captureIdFor,
  isCaptureReceipt,
  readCaptureRecord,
} from "../../visualEvidence/captureRecord.js";
import { frameTextLines } from "../../visualEvidence/frameText.js";
import { imageCheckFailures, wholeFrameProblem } from "../../visualEvidence/imageChecks.js";
import { imageDigestOf } from "../../visualEvidence/imageIo.js";
import type { ImageTextError, RecognisedImageText } from "../../visualEvidence/imageTextRecognition.js";
import { metadataChunksIn } from "../../visualEvidence/pngMetadata.js";
import { readImageRecords } from "../../visualEvidence/store.js";
import type { ImageRecord } from "../../visualEvidence/types.js";
import { type PublicationSurface, publicationFindings } from "../publicationScan.js";
import {
  attachCaptureVerbFindings,
  capturedTypeFindings,
  attachHold as hold,
  uncapturedTypeFindings,
} from "./attachCaptureVerb.js";

/**
 * Where a reader meets a piece of text an attachment carries: in its pixels, in its proves line, in its alt text.
 *
 * @internal — named only through an exported finding's `surface` field
 */
export type AttachScanSurface = "frame-text" | "pixel-text" | "proves" | "alt";

/**
 * Which publication surface each attachment surface is: the recorded frame text and the text recognised in the
 * pixels are both quoted, the two lines beside them authored.
 */
const PUBLICATION_SURFACE: Readonly<Record<AttachScanSurface, PublicationSurface>> = {
  alt: "image-caption",
  "frame-text": "frame-text",
  "pixel-text": "pixel-text",
  proves: "image-caption",
};

/**
 * The scan port: every problem a publication scan finds in one text on one surface, empty when it is clean.
 *
 * Declared with one parameter, the shape the integrator's surface-aware scan is plugged in as.
 */
export type AttachTextScan = (input: {
  readonly surface: AttachScanSurface;
  readonly text: string;
}) => readonly string[];

/** The longest a proves line may be — one line a reader takes in at a glance, not a paragraph. */
export const MAX_PROVES_CHARS = 200;

/**
 * Why a proves statement cannot stand, or `null` when it can: one non-empty line, at most {@link MAX_PROVES_CHARS}.
 *
 * @param proves the statement as typed
 * @returns the reason, or `null`
 */
export function provesProblem({ proves }: { proves: string }): string | null {
  if (proves.trim() === "") {
    return "--proves must say what the picture proves, in one line";
  }
  if (/[\r\n]/u.test(proves)) {
    return "--proves is one line; put anything longer in the description, not beside the picture";
  }
  if (proves.length > MAX_PROVES_CHARS) {
    return `--proves is ${String(proves.length)} characters; at most ${String(MAX_PROVES_CHARS)}`;
  }
  return null;
}

/**
 * The default scan: the publication scan over the private denylist and private terms, forgiving no installation
 * identifier. Both are loaded before the upload contacts GitHub, so a policy that failed to load refuses the upload
 * there and never reaches this scan.
 *
 * @param denylist the private denylist's terms
 * @param privateTerms the installation's private terms, loaded from its state home
 * @param ownRepository the upload's own `owner/repo`, the one slug the description gate does not count either
 * @returns the scan port
 */
export function publicationAttachScan({
  denylist,
  privateTerms,
  ownRepository,
}: {
  denylist: readonly string[];
  privateTerms: readonly PrivateTerm[];
  ownRepository: string;
}): AttachTextScan {
  return ({ surface, text }) =>
    publicationFindings({
      hygiene: { denylist, ownRepository, privateTerms },
      surface: PUBLICATION_SURFACE[surface],
      text,
    }).map((finding) => finding.message);
}

/** What the evidence store holds for one file's bytes. */
export type AttachEvidence =
  | {
      readonly kind: "found";
      readonly digest: string;
      readonly receipt: CaptureReceipt;
      readonly records: readonly ImageRecord[];
    }
  | { readonly kind: "missing"; readonly digest: string; readonly why: string; readonly correction: string };

/**
 * Find the capture receipt and the image records for exactly these bytes.
 *
 * @param home the state home holding the evidence store
 * @param bytes the file's bytes, the same buffer the upload will send
 * @returns the receipt and records, or why none can stand behind these bytes
 */
export function resolveAttachEvidence({ home, bytes }: { home: string; bytes: Uint8Array }): AttachEvidence {
  const digest = imageDigestOf({ bytes });
  const recapture =
    "take it through `slopweaver browser console-shot`, the one capture verb attach admits, and attach the file it " +
    "wrote, unedited; any other proof stays local until a figure check exists";
  const captured = readCaptureRecord({ captureId: captureIdFor({ digest }), home });
  if (captured.isErr()) {
    return {
      correction: "repair or remove the receipt file it names",
      digest,
      kind: "missing",
      why: captured.error.message,
    };
  }
  if (captured.value === null) {
    return { correction: recapture, digest, kind: "missing", why: "no capture receipt names these bytes" };
  }
  if (!isCaptureReceipt(captured.value)) {
    return {
      correction: recapture,
      digest,
      kind: "missing",
      why: "the only receipt for these bytes is a version-1 record, which carries no frame text to scan",
    };
  }
  if (captured.value.final.artifact.digest !== digest) {
    return {
      correction: recapture,
      digest,
      kind: "missing",
      why: `the receipt found names ${captured.value.final.artifact.digest}, not these bytes`,
    };
  }
  const records = readImageRecords({ digest, home });
  if (records.isErr()) {
    return {
      correction: "repair or remove the record file it names",
      digest,
      kind: "missing",
      why: records.error.message,
    };
  }
  return { digest, kind: "found", receipt: captured.value, records: records.value };
}

/**
 * Every check the picture fails, as hold findings, in the order a reader fixes them.
 *
 * @param evidence what the store holds for the bytes
 * @param bytes the exact bytes the upload would send
 * @param contentType the content type the upload would declare, from the file's extension
 * @param proves the one-line statement of what the picture proves
 * @param alt the alt text the embed will carry — `--alt`, else the file's own name, which GitHub publishes too
 * @param pixelText the text recognised in a picture's pixels, or why it could not be read; `undefined` for a
 *   recording, whose screens are its transcript
 * @param scan the publication scan port
 * @returns the findings, empty when the picture may be uploaded
 */
export function attachEvidenceFindings({
  evidence,
  bytes,
  contentType,
  proves,
  alt,
  pixelText,
  scan,
}: {
  evidence: AttachEvidence;
  bytes: Uint8Array;
  contentType: string;
  proves: string;
  alt: string;
  pixelText: Result<RecognisedImageText, ImageTextError> | undefined;
  scan: AttachTextScan;
}): readonly DoorFinding[] {
  const textFindings = [
    ...scan({ surface: "proves", text: proves }).map((problem) =>
      hold({ code: "attach.scan.proves", correction: "reword the --proves line", summary: `--proves: ${problem}` }),
    ),
    ...scan({ surface: "alt", text: alt }).map((problem) =>
      hold({ code: "attach.scan.alt", correction: "reword the --alt text", summary: `--alt: ${problem}` }),
    ),
  ];
  const pixels = pixelTextFindings({ pixelText, scan });
  if (evidence.kind === "missing") {
    return [
      ...uncapturedTypeFindings({ contentType }),
      hold({ code: "attach.capture-receipt", correction: evidence.correction, summary: evidence.why }),
      ...pixels,
      ...textFindings,
    ];
  }
  const { receipt, records } = evidence;
  return [
    ...attachCaptureVerbFindings({ verb: receipt.verb }),
    ...capturedTypeFindings({ contentType, receipt }),
    ...frameTextFindings({ receipt, scan }),
    ...pixels,
    ...textFindings,
    ...recordFindings({ receipt, records }),
    ...pictureOnlyFindings({ bytes, receipt }),
  ];
}

/** The scan over every word the receipt recorded in the frame, or the hold for a frame it could not read whole. */
function frameTextFindings({
  receipt,
  scan,
}: {
  receipt: CaptureReceipt;
  scan: AttachTextScan;
}): readonly DoorFinding[] {
  if (receipt.frameText.kind !== "exact") {
    return [
      hold({
        code: "attach.frame-text-incomplete",
        correction: "re-capture a frame whose whole text the capture verb can read",
        summary: `the receipt could not record every word in the frame: ${receipt.frameText.reasons.join("; ")}`,
      }),
    ];
  }
  const recording = receipt.verb === "proof cassette";
  const correction = recording
    ? "re-record with a tape that does not show it"
    : "re-capture it with `slopweaver browser console-shot` so it does not show it";
  return scan({ surface: "frame-text", text: frameTextLines({ frameText: receipt.frameText }) }).map((problem) =>
    hold({
      code: "attach.scan.frame-text",
      correction,
      summary: `the ${recording ? "recording" : "picture"} shows ${problem}`,
    }),
  );
}

/**
 * The scan over the text recognised in a picture's own pixels, or the hold for pixels whose text could not be read.
 * Neither names what was read: a finding carries the scan's class-only sentence, and a failure only its cause.
 *
 * @param pixelText the recognition result, `undefined` for a recording
 * @param scan the publication scan port
 * @returns the findings
 */
function pixelTextFindings({
  pixelText,
  scan,
}: {
  pixelText: Result<RecognisedImageText, ImageTextError> | undefined;
  scan: AttachTextScan;
}): readonly DoorFinding[] {
  if (pixelText === undefined) {
    return [];
  }
  if (pixelText.isErr()) {
    return [
      hold({
        code: "attach.pixel-text-unread",
        correction: "attach it from macOS, where Vision reads the picture's text; retry once if it timed out",
        summary: `the text the picture shows could not be read, so it cannot be checked: ${pixelText.error.message}`,
      }),
    ];
  }
  return scan({ surface: "pixel-text", text: pixelText.value.lines.join("\n") }).map((problem) =>
    hold({
      code: "attach.scan.pixel-text",
      correction: "re-capture it with `slopweaver browser console-shot` so it does not show it",
      summary: `the picture's pixels show ${problem}`,
    }),
  );
}

/** The five image checks, read off the image records a session wrote after looking. */
function recordFindings({
  receipt,
  records,
}: {
  receipt: CaptureReceipt;
  records: readonly ImageRecord[];
}): readonly DoorFinding[] {
  const measured = receipt.verb === "browser shot" ? receipt.detail.legibility.issues : [];
  const correction =
    receipt.verb === "proof cassette"
      ? "read the recording's transcript, then record what it shows with `slopweaver browser image-record`"
      : "open the file, look at it, then record what you saw with `slopweaver browser image-record`; re-capture " +
        "if it fails";
  return imageCheckFailures({ measuredLegibilityIssues: measured, records }).map((failure) =>
    hold({ code: `attach.image-check.${failure.check}`, correction, summary: `${failure.check}: ${failure.why}` }),
  );
}

/**
 * The two checks that read a picture's geometry and chunks: the crop rule and the PNG metadata strip. A recording
 * has neither — its terminal was the recorder's own, and its strip is the verb's, proven by the receipt's digest.
 *
 * @param receipt the receipt the bytes resolved to
 * @param bytes the exact bytes the upload would send
 * @returns the findings
 */
function pictureOnlyFindings({
  receipt,
  bytes,
}: {
  receipt: CaptureReceipt;
  bytes: Uint8Array;
}): readonly DoorFinding[] {
  if (receipt.verb === "proof cassette") {
    return [];
  }
  const whole = wholeFrameProblem({ cropRect: receipt.cropRect, source: receipt.source });
  const metadata = metadataChunksIn({ bytes });
  return [
    ...(whole === null
      ? []
      : [hold({ code: "attach.whole-frame", correction: "re-capture cropped to what it proves", summary: whole })]),
    ...(metadata?.length === 0
      ? []
      : [
          hold({
            code: "attach.metadata",
            correction: "attach the file the capture verb wrote, which carries no metadata",
            summary: `the bytes carry chunks that are not pixels: ${metadata === null ? "not a PNG" : metadata.join(", ")}`,
          }),
        ]),
  ];
}

/**
 * The attachment door gate over findings already computed from the exact bytes being sent.
 *
 * @param findings what {@link attachEvidenceFindings} found
 * @returns the gate, which raises those findings whatever the request
 */
export function attachEvidenceGate({ findings }: { findings: readonly DoorFinding[] }): DoorGate {
  return () => findings;
}
