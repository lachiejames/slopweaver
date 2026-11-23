/**
 * The vocabulary of IMAGE EVIDENCE — what a session recorded about a picture it looked at, keyed by the
 * picture's own bytes.
 *
 * ## The incident this shape exists for, and the two words that decide its design
 *
 * Two Datadog screenshots the owner's own bot posted into their DM were not something a human would find okay,
 * and the mistake has to be structurally impossible to repeat. Both images were full-page captures — 4032x6722 and 4032x6512 — and one showed
 * `6 service values found (based on 100,794 logs)` above a panel that had not rendered.
 *
 * The investigation's FINDINGS.md holds one finding that
 * is what this module is shaped by: **the worker DID read both pictures back**, three `Read` calls in its
 * own transcript, and shipped them anyway. So "read it back" is not the property. The property is that
 * looking produces a RECORD, against stated criteria, that something downstream can refuse on. A read-back
 * nothing wrote down is indistinguishable from no read-back, and that is exactly what happened.
 *
 * ## Keyed by DIGEST, never by path — measured, not defensive
 *
 * `answerDigestOf` (`../live/turn/posterAnswer.ts`) hashes `JSON.stringify(answer)`, and an answer's
 * `images` were path STRINGS, so the reviewed digest covered the paths and never the bytes: replacing a PNG
 * at the same path left every verdict about it still binding. `lockUploads` (`../live/turn/run.ts`) had
 * already learned this once — its own header says "a path alone is not a proof" — which is why the record
 * here is found by `sha256` of the actual bytes and a caller-supplied {@link ImageRef.receiptId} is only
 * ever a cross-check, never the lookup.
 *
 * ## Two outcomes, and only one of them has a way past it
 *
 * A record is `passed` or `failed`, and that discriminant is the whole gate:
 *
 * - **no record at all** is a POLICY refusal with a working hatch — a hand-made diagram, a photograph of a
 *   physical thing, an image from a source no verb here can capture are all real exceptions;
 * - **a `failed` record** is a `hold` with no hatch, because sending a picture you have looked at and
 *   written down as unreadable is not a case any exception covers.
 *
 * `PASSED`/`FAILED` is deliberately about the FINAL bytes — annotation happens after cropping and can
 * cover the very label the evidence rests on, so a record about an intermediate file proves nothing about
 * what Slack would show.
 *
 * **A `failed` record is TERMINAL for the bytes it names.** Nothing written afterwards clears them: a
 * correction re-captures or crops, which changes the bytes and so asks about a different digest. An earlier
 * draft let the LAST record win, and re-recording one unchanged file as
 * `passed` then admitted it through every lane with no hatch and no override — see `./admission.ts`'s
 * `terminalFailure` for the counterexample and why the safer rule costs nothing legitimate.
 */

/** A PNG's identity: its bytes' digest and the dimensions those bytes actually decode to. */
export interface ArtifactIdentity {
  /** `sha256:<64 hex>` over the exact bytes, the same spelling `ReviewVerdict.answerDigest` uses. */
  readonly digest: string;
  readonly widthPx: number;
  readonly heightPx: number;
}

/**
 * A rectangle in image pixels.
 *
 * @internal — a field type of {@link CropDisposition}; callers read the disposition, never the rect alone.
 */
export interface PixelRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * What was done about framing — and why there is no third arm meaning "not considered".
 *
 * A full-page capture that nobody cropped is the incident. So a record either names the rectangle it cut,
 * or states in words why the picture was already framed. Both are judgements; neither is silence.
 *
 * @internal — a field type of {@link ImageRecord}.
 */
export type CropDisposition =
  | { readonly kind: "cropped"; readonly sourceDigest: string; readonly rect: PixelRect }
  | { readonly kind: "already-framed"; readonly reason: string };

/**
 * Framing as a FAILED record may describe it — the two producer arms, plus one only a reviewer can write.
 *
 * A reviewing session that opens an attachment and finds it unreadable knows nothing about how the picture
 * was framed: it did not take it, and the composer's own record may not exist. `already-framed` would be a
 * lie whenever the composer cropped, and inventing a `rect` would be worse. So there is a third arm — and
 * it is reachable on the `failed` arm ONLY. A record saying "I did not see how this was framed" must never
 * also be able to say "and it is fine to send", so the passing contract is left exactly as it was.
 *
 * @internal — a field type of {@link ImageRecord}'s `failed` arm.
 */
export type FailedCropDisposition = CropDisposition | { readonly kind: "reviewer-unobserved"; readonly reason: string };

/**
 * Whether the thing the claim rests on had actually RENDERED when the shutter fired.
 *
 * `zero-results` is separate from `empty-panel` on purpose and it is the distinction the incident turned
 * on: a query that legitimately matched nothing and a panel that never loaded look identical as pixels, and
 * conflating them would either refuse every honest empty result or admit every unloaded one.
 *
 * @internal — a field type of {@link ImageReadBack}.
 */
export type TargetState = "data" | "zero-results" | "unloaded" | "empty-panel";

/**
 * Why a looked-at picture is unfit to send. A closed set, so a refusal can name one rather than narrate. `obscured` is
 * a pop-up, banner or modal over the thing the claim rests on: the capture is retaken,
 * never worked around, so like every reason here it is terminal for those bytes.
 */
export type ImageFailureReason = "unloaded" | "empty-panel" | "illegible" | "context-lost" | "obscured";

/**
 * One box drawn INTO the final pixels over what the reader should look at, and the note beside it — an attestation
 * about bytes already annotated, never an instruction to draw one ("annotated" means a
 * rectangle over the thing, with notes).
 */
export interface ImageAnnotation {
  readonly rect: PixelRect;
  readonly note: string;
}

/**
 * What a session saw when it opened the final image, and when.
 *
 * @internal — a field type of {@link ImageRecord}.
 */
export interface ImageReadBack {
  /** How the observing session named itself. Not authenticated — see {@link ImageRecord}'s own note. */
  readonly observerSession: string;
  readonly observedAtIso: string;
  /** Concrete content actually visible — values, labels, a query string. Never "looks fine". */
  readonly observedContent: string;
  readonly targetState: TargetState;
  /** Whether the context a reader needs to check the claim (axes, query, time range) survived the crop. */
  readonly contextRetained: boolean;
}

/**
 * One durable record about one picture's final bytes.
 *
 * **This is an attestation, not proof that eyes saw pixels**, and the distinction is stated here rather
 * than discovered: `../admit/reviewVerdict.ts` already says session identities are not authenticated, and
 * nothing changes that. A session can write `observedContent` without opening the file. What the record
 * buys is that the claim is BOUND to specific bytes, is checkable against them, and is refusable — so a
 * wrong one is visible afterwards instead of being absent.
 */
export type ImageRecord = {
  readonly schemaVersion: 1;
  /** Which criteria version judged it, so a later ratchet can tell an old pass from a current one. */
  readonly policyVersion: number;
  readonly receiptId: string;
  /**
   * The `browser shot` capture record these bytes came out of (`./captureRecord.ts`), when they came out
   * of one. Absent for an image no verb here produced — a hand-made diagram, a photograph. Present, it is
   * checked: the capture's final digest must be the digest being recorded.
   */
  readonly captureId?: string | undefined;
  readonly artifact: ArtifactIdentity;
  readonly readBack: ImageReadBack;
} & (
  | {
      readonly outcome: "passed";
      readonly crop: CropDisposition;
      /**
       * The boxes drawn into these bytes, each with its note — at least one when present. What a FIRST channel message
       * owes (`../outbound/slack/firstMessageProof.ts`); ordinary admission does not read it. Absent on every record
       * written before the field.
       */
      readonly annotations?: readonly ImageAnnotation[] | undefined;
      /** `none`: the observer read the capture back and nothing — pop-up, banner, modal — covers what it shows. */
      readonly obstruction?: "none" | undefined;
    }
  | {
      readonly outcome: "failed";
      readonly crop: FailedCropDisposition;
      readonly reason: ImageFailureReason;
      readonly correction: string;
    }
);

/**
 * How an outbound form names one attachment, replacing the bare path string.
 *
 * `artifactDigest` is what makes the answer's own digest cover the BYTES: change the picture and either the
 * reference stops matching or the reference changes, and changing the reference changes the answer digest.
 */
export interface ImageRef {
  readonly path: string;
  readonly artifactDigest: string;
  /**
   * The record the composer believes covers it. Optional for exactly one reason — the missing-record
   * exception has to be expressible — and never the lookup key: admission finds records by digest, so
   * omitting this, renaming the file or quoting a different receipt cannot hide a `failed` record.
   */
  readonly receiptId?: string | undefined;
}

/** The criteria version this build judges by. Bump it when a threshold moves, never silently. */
export const IMAGE_POLICY_VERSION = 1;
