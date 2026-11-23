/**
 * The capture record — every stage one evidence capture went through, written once, linked from the final
 * image record by `captureId`.
 *
 * ## One versioned document rather than eleven optional fields
 *
 * Use a versioned capture record linked from the final artifact record, not
 * eleven optional fields that allow nonsensical stage combinations. The image record (`./types.ts`) stays
 * about the FINAL bytes and what a session saw in them; this document is about how those bytes came to
 * exist — the raw capture's identity and geometry, the readiness observation the shutter fired on, the
 * crop rectangle and the cropped identity, the annotations, and the final identity with its prominence
 * measurement. A stage that did not happen is not a missing field here; a capture that failed before a
 * final image exists writes no record at all, and reports a capture-attempt failure instead.
 *
 * ## `readback-pending` is the only status this verb can write
 *
 * The verb cannot look at its own output — rule 2, no headless model — so a capture ends here and the
 * visible session's `browser image-record` is what turns it into something an outbound form admits. The
 * link is the form's optional `captureId`, and `image-record` refuses a `captureId` naming a document whose
 * final digest is not the bytes being recorded.
 *
 * ## Version 2: one receipt shape for every capture verb
 *
 * Version 1 was `browser shot`'s alone. Version 2 is the CAPTURE RECEIPT every capture verb writes —
 * `browser shot`, `browser terminal-shot`, `browser console-shot`, `browser redact` and `proof cassette` — and its
 * common half is what
 * `github attach` reads before a picture or a recording may reach GitHub: the verb, the exact text in the frame
 * (`./frameText.ts`), the source frame's dimensions and the rectangle cut from it, and the final bytes' digest with
 * their metadata stripped (`./pngMetadata.ts` for a PNG, the container strip in `../proof/cassette/finalise.ts` for a
 * video). The verb-specific stages sit under `detail`. A version-1 record still parses, so the image
 * records citing one stay believable to Slack; `github attach` refuses one, because frame text was never recorded.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import { err, ok, type Result } from "#lib/result.js";
import { safeJsonParse, safeJsonStringify } from "#lib/safeJson.js";
import { writeFileAtomic } from "#lib/writeAtomic.js";
import { stateHomePaths } from "../stateHome.js";
import {
  annotationSchema,
  artifactSchema,
  cropStageSchema,
  digestSchema,
  legibilitySchema,
  rawStageSchema,
  readinessStageSchema,
  targetSchema,
} from "./captureStages.js";
import { type ImageAdmissionError, ImageAdmissionErrors } from "./errors.js";
import { frameTextSchema, pixelRectSchema } from "./frameText.js";
import { imageDigestOf } from "./imageIo.js";
import { readImageRecords, recordReadFailure } from "./store.js";

/**
 * A version-1 capture record: a `browser shot` capture written before frame text, the source frame and the
 * metadata strip were recorded. Still READ — the image records citing one stay believable for Slack — and refused by
 * `github attach`, which needs what only version 2 carries.
 */
const versionOneCaptureRecordSchema = z
  .object({
    annotations: z.array(annotationSchema).readonly(),
    capturedAtIso: z.string().min(1),
    captureId: z.string().min(1),
    crop: cropStageSchema,
    final: z.object({ artifact: artifactSchema, legibility: legibilitySchema, path: z.string().min(1) }).strict(),
    finalUrl: z.string().min(1),
    raw: rawStageSchema,
    readiness: readinessStageSchema,
    schemaVersion: z.literal(1),
    status: z.literal("readback-pending"),
    target: targetSchema,
    url: z.string().min(1),
  })
  .strict();

/**
 * What every version-2 capture receipt carries whatever verb wrote it — the generic half the attachment gate reads:
 * which verb, the exact text in the frame, the frame it was cut from and the rectangle cut, and the final bytes'
 * digest with their metadata stripped.
 */
const receiptFields = {
  capturedAtIso: z.string().min(1),
  captureId: z.string().min(1),
  /** The rectangle kept, in {@link source}'s pixels. Equal to the whole source means nothing was cropped. */
  cropRect: pixelRectSchema,
  final: z.object({ artifact: artifactSchema, metadata: z.literal("stripped"), path: z.string().min(1) }).strict(),
  frameText: frameTextSchema,
  schemaVersion: z.literal(2),
  /** The whole frame the crop was taken from — a viewport's raw capture, or a terminal screen's full render. */
  source: z.object({ heightPx: z.number().int().positive(), widthPx: z.number().int().positive() }).strict(),
  status: z.literal("readback-pending"),
};

const browserShotReceiptSchema = z
  .object({
    ...receiptFields,
    detail: z
      .object({
        annotations: z.array(annotationSchema).readonly(),
        crop: cropStageSchema,
        finalUrl: z.string().min(1),
        legibility: legibilitySchema,
        raw: rawStageSchema,
        readiness: readinessStageSchema,
        target: targetSchema,
        url: z.string().min(1),
      })
      .strict(),
    verb: z.literal("browser shot"),
  })
  .strict();

const terminalShotReceiptSchema = z
  .object({
    ...receiptFields,
    detail: z
      .object({
        /** The caller's own name for where the text came from (a cmux workspace, a command). */
        label: z.string().min(1),
        /** The 1-based inclusive line range kept out of the source text. */
        lines: z.object({ from: z.number().int().positive(), to: z.number().int().positive() }).strict(),
        /** How many lines the whole source text held. */
        sourceLines: z.number().int().positive(),
      })
      .strict(),
    verb: z.literal("browser terminal-shot"),
  })
  .strict();

const redactionReceiptSchema = z
  .object({
    ...receiptFields,
    detail: z
      .object({
        /** The rectangles burned solid into the parent's final pixels. */
        burned: z.array(pixelRectSchema).min(1).readonly(),
        parentCaptureId: z.string().min(1),
        parentDigest: digestSchema,
      })
      .strict(),
    verb: z.literal("browser redact"),
  })
  .strict();

/**
 * A terminal recording: the frame is the whole video frame and nothing was cut from it, because the recorder drove a
 * terminal of its own that showed only what the tape typed. Its frame text is the recorder's transcript.
 */
const cassetteReceiptSchema = z
  .object({
    ...receiptFields,
    detail: z
      .object({
        /** The tape the session wrote, as read, and its digest — the script the recording followed. */
        tape: z.string().min(1),
        tapeDigest: digestSchema,
        /** The transcript the frame text was read from, beside the video. */
        transcript: z.string().min(1),
      })
      .strict(),
    verb: z.literal("proof cassette"),
  })
  .strict();

/**
 * A click-through of the console served over a THROWAWAY store and home holding the synthetic organisation's fixtures
 * only (`browser console-shot`): the walk named, where it started and ended, the region cut, and every witness the walk
 * waited on before the shutter. Its frame text is the page's visible text inside that region, read twice around the
 * shutter by the same walker `browser shot` uses.
 */
const consoleShotReceiptSchema = z
  .object({
    ...receiptFields,
    detail: z
      .object({
        /** Always the synthetic organisation: a console shot never reads an installation's own home or store. */
        fixture: z.literal("acme"),
        /** The path the walk ended on, origin dropped: the throwaway server's port means nothing afterwards. */
        finalPath: z.string().startsWith("/"),
        /** The path the walk opened. */
        initialPath: z.string().startsWith("/"),
        /** The selectors whose union was cut, in the order the walk names them. */
        region: z.array(z.string().min(1)).min(1).readonly(),
        /** CSS pixels, and the device scale the frame was rendered at. */
        viewport: z
          .object({
            deviceScaleFactor: z.number().positive(),
            heightPx: z.number().int().positive(),
            widthPx: z.number().int().positive(),
          })
          .strict(),
        /** The walk, by its registered name (`./consoleWalks.ts`). */
        walk: z.string().min(1),
        /** Every selector the walk waited to see before the shutter fired. */
        witnesses: z.array(z.string().min(1)).min(1).readonly(),
      })
      .strict(),
    verb: z.literal("browser console-shot"),
  })
  .strict();

/**
 * The strict schema for one version-2 capture receipt, one arm per capture verb.
 * @internal — parsed only through {@link captureRecordSchema}; exported so the type is inferable.
 */
export const captureReceiptSchema = z.discriminatedUnion("verb", [
  browserShotReceiptSchema,
  terminalShotReceiptSchema,
  redactionReceiptSchema,
  cassetteReceiptSchema,
  consoleShotReceiptSchema,
]);

/** Every verb that writes a capture receipt. */
export type CaptureVerb = z.infer<typeof captureReceiptSchema>["verb"];

/**
 * The strict schema for one capture record of either version.
 * @internal — parsed only by {@link readCaptureRecord}; exported so the type is inferable.
 */
export const captureRecordSchema = z.union([versionOneCaptureRecordSchema, captureReceiptSchema]);

/** One capture record, as parsed — a legacy version-1 `browser shot` record or a version-2 receipt. */
export type CaptureRecord = z.infer<typeof captureRecordSchema>;

/** One version-2 capture receipt: the record shape every capture verb writes now. */
export type CaptureReceipt = z.infer<typeof captureReceiptSchema>;

/**
 * Whether a capture record is a version-2 receipt — the shape carrying frame text, the source frame and the strip.
 *
 * Positional because TypeScript error TS1230 forbids destructuring in a type predicate.
 *
 * @returns whether the record carries the receipt fields
 */
export function isCaptureReceipt(record: CaptureRecord): record is CaptureReceipt {
  return record.schemaVersion === 2;
}

/**
 * Mint a capture id from the final bytes' digest, the way every capture verb names its record.
 *
 * @param digest the final bytes' `sha256:` digest
 * @returns the capture id
 */
export function captureIdFor({ digest }: { digest: string }): string {
  return `cap-${digest.slice(7, 23)}`;
}

/**
 * Where a capture record lives.
 *
 * @param home the state home
 * @param captureId the record's own id
 * @returns the JSON path
 */
export function captureRecordPath({ home, captureId }: { home: string; captureId: string }): string {
  return join(stateHomePaths({ home }).visualEvidenceCaptures, `${captureId}.json`);
}

/**
 * Write one capture record, atomically.
 *
 * @param home the state home
 * @param record the document to write
 * @returns the path it landed at, or the store failure
 */
export function writeCaptureRecord({
  home,
  record,
}: {
  home: string;
  record: CaptureRecord;
}): Result<string, ImageAdmissionError> {
  const path = captureRecordPath({ captureId: record.captureId, home });
  try {
    mkdirSync(stateHomePaths({ home }).visualEvidenceCaptures, { recursive: true });
    writeFileAtomic({ contents: safeJsonStringify({ label: "capture record", value: record }), path });
  } catch (error) {
    return err(ImageAdmissionErrors.storeFailed({ cause: error }));
  }
  return ok(path);
}

/**
 * Read one capture record. Absence is `ok(null)`; anything else that stops the read is a failure.
 *
 * @param home the state home
 * @param captureId the record's own id
 * @returns the record, `null` when none exists, or why it could not be read or believed
 */
export function readCaptureRecord({
  home,
  captureId,
}: {
  home: string;
  captureId: string;
}): Result<CaptureRecord | null, ImageAdmissionError> {
  const path = captureRecordPath({ captureId, home });
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (recordReadFailure({ error }) === "absent") {
      return ok(null);
    }
    return err(ImageAdmissionErrors.storeFailed({ cause: error }));
  }
  let decoded: unknown;
  try {
    decoded = safeJsonParse({ label: `capture record at ${path}`, text });
  } catch (error) {
    return err(
      ImageAdmissionErrors.evidenceInvalid({
        issues: [`${path}: ${error instanceof Error ? error.message : String(error)}`],
      }),
    );
  }
  // The version picks the schema, so a refusal names the offending field rather than "matched no arm of the union".
  const isReceipt =
    typeof decoded === "object" && decoded !== null && "schemaVersion" in decoded && decoded.schemaVersion === 2;
  const parsed = isReceipt ? captureReceiptSchema.safeParse(decoded) : versionOneCaptureRecordSchema.safeParse(decoded);
  if (!parsed.success) {
    return err(
      ImageAdmissionErrors.evidenceInvalid({
        issues: parsed.error.issues.map((issue) => `${path}: ${issue.path.join(".")}: ${issue.message}`),
      }),
    );
  }
  return ok(parsed.data);
}

/**
 * The address one image's bytes were photographed at, as its own records say — or `null` when nothing here
 * recorded them.
 *
 * Two hops, both by content rather than by path: the bytes' digest finds the image records
 * (`./store.ts`), the newest record carrying a `captureId` finds the capture record, and the capture
 * record carries the URL `browser shot` was pointed at. A renamed file, a copied file or a file quoting
 * someone else's receipt therefore resolves to what its BYTES actually are, which is the same property
 * admission rests on.
 *
 * @param home the state home holding both stores
 * @param bytes the image as it will be sent
 * @returns the captured address, or `null` when these bytes have no capture record
 */
export function capturedUrlOf({
  home,
  bytes,
}: {
  home: string;
  bytes: Uint8Array;
}): Result<string | null, ImageAdmissionError> {
  const records = readImageRecords({ digest: imageDigestOf({ bytes }), home });
  if (records.isErr()) {
    return err(records.error);
  }
  const captureIds = records.value.flatMap((record) => (record.captureId === undefined ? [] : [record.captureId]));
  const captureId = captureIds.at(-1);
  if (captureId === undefined) {
    return ok(null);
  }
  const capture = readCaptureRecord({ captureId, home });
  if (capture.isErr()) {
    return err(capture.error);
  }
  return ok(capturedAddressOf({ capture: capture.value }));
}

/**
 * The address a capture record says its picture was photographed at, or `null` when it names none — a terminal
 * render and a redaction were photographed nowhere, and a console shot's throwaway loopback server is gone the moment
 * the shot ends, so its address names nothing a reader could open.
 *
 * @param capture the record, or `null` when none was found
 * @returns the address `browser shot` was pointed at, or `null`
 */
function capturedAddressOf({ capture }: { capture: CaptureRecord | null }): string | null {
  if (capture === null) {
    return null;
  }
  if (!isCaptureReceipt(capture)) {
    return capture.url;
  }
  if (capture.verb === "browser shot") {
    return capture.detail.url;
  }
  return null;
}
