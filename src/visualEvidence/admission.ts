/**
 * The pure decision at the heart of image admission: given the bytes actually about to be uploaded and
 * every record the store holds for them, say what stands in the way.
 *
 * No fs, no clock, no environment, no Jimp. `./store.ts` finds the records, `./imageIo.ts` decodes the
 * bytes, `./prepareUploads.ts` sequences the two and applies the hatch; this module only judges.
 *
 * ## Order is the property, not an implementation detail
 *
 * {@link imageAdmissionVerdict} classifies FAILED records before MISSING ones, and that ordering is the
 * gate. Reverse it and a composer that drops a `receiptId` turns a known-bad picture into a
 * missing-record refusal, which is hatchable — so the one arm the owner said must have no way past it
 * would acquire one, by omission. {@link ImageAdmissionVerdict}'s `kind` is what callers branch on, and
 * `known-bad` outranks `missing` even when both are present in the same batch.
 *
 * ## Records are matched on the DIGEST the caller is about to send, never on what the caller claims
 *
 * Every lookup here is keyed by {@link ArtifactIdentity.digest} computed from the bytes in hand. A
 * `receiptId` a caller supplied is checked for AGREEMENT and is never how a record is found, so renaming
 * the file, quoting another receipt, omitting the receipt or switching upload lane all resolve the same
 * record. That is the "failure cannot be hidden" property, and it is a consequence of the lookup key
 * rather than a rule anybody has to remember.
 */

import type { DoorFinding } from "../admit/types.js";
import { type ImageAdmissionError, ImageAdmissionErrors } from "./errors.js";
import type { ArtifactIdentity, ImageFailureReason, ImageRecord, ImageRef } from "./types.js";
import { IMAGE_POLICY_VERSION } from "./types.js";

/** One attachment as admission sees it: the bytes' own identity, the reference, and any record found. */
export interface ResolvedImageEvidence {
  /** Computed from the bytes in hand — never taken from the reference. */
  readonly artifact: ArtifactIdentity;
  readonly ref: ImageRef;
  /** Every record the store holds for {@link artifact}'s digest, newest last. Empty means none. */
  readonly records: readonly ImageRecord[];
}

/** What admission concluded. `kind` is the arm a caller renders — each renders differently by contract. */
export type ImageAdmissionVerdict =
  /** Every attachment carries a believable `passed` record. */
  | { readonly kind: "admitted" }
  /** At least one attachment was looked at and recorded unfit. A `hold`: no hatch, ever. */
  | { readonly kind: "known-bad"; readonly findings: readonly DoorFinding[] }
  /** At least one attachment has no record. Policy: the `unread-image` hatch may waive it. */
  | { readonly kind: "missing"; readonly digests: readonly string[] }
  /** A record was found and cannot be believed. A fact, not a refusal. */
  | { readonly kind: "invalid"; readonly issues: readonly string[] };

/** The words a reader gets for each closed failure reason, so a refusal never has to narrate one. */
const FAILURE_SUMMARY: Readonly<Record<ImageFailureReason, string>> = {
  "context-lost": "the crop removed the context a reader needs to check the claim — the axes, query or time range",
  illegible: "it is unreadable at the size a reader actually sees it",
  "empty-panel": "the panel the claim rests on was still empty when the shutter fired",
  obscured: "a pop-up, banner or modal covers what it shows — dismiss it and retake the capture",
  unloaded: "the page had not finished rendering when the shutter fired",
};

/**
 * A FAILED record is TERMINAL for the bytes it names — the first thing asked of any digest.
 *
 * ## This replaced a last-record-wins rule, which was a hole
 *
 * The original rule took `records.at(-1)`, justified by "a correction produces new BYTES and therefore a
 * new digest, so the later look is the one that counts". The justification is false in one direction, and
 * that direction is the whole gate: nothing FORCES a correction to change the bytes. Recording the same
 * unchanged file a second time with `verdict: passed` produced a later record that silently overrode the
 * failure, and the same bytes then uploaded through any lane — needing no hatch and no override token. The
 * counterexample is in that review pass's own artifact, and a test in this repo had asserted the overriding behaviour as though it were intended, which is why the
 * defect survived its author's own review.
 *
 * So the rule is now the strictly safer one: **any** `failed` record for a digest refuses those bytes,
 * forever, whatever was written afterwards. That costs nothing legitimate, because a real correction —
 * re-capturing, waiting for the panel, cropping — changes the bytes and therefore asks about a different
 * digest. Re-asserting that an unchanged artifact is fine, after writing down that it was not, is exactly
 * the act the owner refused.
 *
 * @param records every record for one digest, in store order
 * @returns the failing record, or `undefined` when none of them failed
 */
function terminalFailure({
  records,
}: {
  records: readonly ImageRecord[];
}): Extract<ImageRecord, { outcome: "failed" }> | undefined {
  return records.find((record): record is Extract<ImageRecord, { outcome: "failed" }> => record.outcome === "failed");
}

/**
 * The record that speaks for a digest once no record has failed: the LAST one the store holds.
 *
 * Only reached when {@link terminalFailure} found nothing, so "last" here chooses between passes — a
 * re-look that tightened an observation, say — and can no longer overturn a failure.
 *
 * @param records every record for one digest, in store order
 * @returns the record that decides, or `undefined` when there are none
 */
function decidingRecord({ records }: { records: readonly ImageRecord[] }): ImageRecord | undefined {
  return records.at(-1);
}

/**
 * Why one resolved attachment's record cannot be believed, if it cannot.
 *
 * @param evidence the attachment and the record deciding it
 * @param record the deciding record
 * @returns the issues, empty when the record is believable
 */
function believabilityIssues({
  evidence,
  record,
}: {
  evidence: ResolvedImageEvidence;
  record: ImageRecord;
}): readonly string[] {
  const issues: string[] = [];
  const named = evidence.ref.path;
  if (record.artifact.digest !== evidence.artifact.digest) {
    issues.push(
      `${named}: the record names bytes ${record.artifact.digest} but the file holds ${evidence.artifact.digest}`,
    );
  }
  if (
    record.artifact.widthPx !== evidence.artifact.widthPx ||
    record.artifact.heightPx !== evidence.artifact.heightPx
  ) {
    issues.push(
      `${named}: the record was written about a ${String(record.artifact.widthPx)}x${String(record.artifact.heightPx)} ` +
        `image and these bytes decode to ${String(evidence.artifact.widthPx)}x${String(evidence.artifact.heightPx)}`,
    );
  }
  if (evidence.ref.receiptId !== undefined && evidence.ref.receiptId !== record.receiptId) {
    issues.push(
      `${named}: the attachment cites receipt ${evidence.ref.receiptId} and the record for these bytes is ${record.receiptId}`,
    );
  }
  if (record.policyVersion > IMAGE_POLICY_VERSION) {
    issues.push(
      `${named}: the record was judged by image policy v${String(record.policyVersion)}, ` +
        `which is newer than this build's v${String(IMAGE_POLICY_VERSION)}`,
    );
  }
  if (evidence.ref.artifactDigest !== evidence.artifact.digest) {
    issues.push(
      `${named}: the attachment reference names ${evidence.ref.artifactDigest} and the file holds ${evidence.artifact.digest}`,
    );
  }
  return issues;
}

/**
 * The `hold` finding for one attachment a session looked at and recorded as unfit.
 *
 * `severity: "hold"` is load-bearing rather than a label: `DoorFinding` is a discriminated union in which
 * only a `warn` carries an `override`, so a hold cannot be given a waiver token even by mistake — the
 * compiler refuses it. That is what makes "an image you have written down as bad has no way out" a
 * property of the types instead of a rule in prose.
 *
 * @param evidence the attachment
 * @param reason the closed reason the record gave
 * @param correction what the record said to do about it
 * @returns the finding
 */
function knownBadFinding({
  evidence,
  reason,
  correction,
}: {
  evidence: ResolvedImageEvidence;
  reason: ImageFailureReason;
  correction: string;
}): DoorFinding {
  return {
    code: `image.${reason}`,
    correction,
    severity: "hold",
    summary: `${evidence.ref.path} was looked at and recorded as unfit to send: ${FAILURE_SUMMARY[reason]}`,
  };
}

/**
 * Judge one whole batch of attachments.
 *
 * The WHOLE batch, never one member: a message with a good first image and a bad second must upload
 * neither, or the reader gets half an evidence set and a refusal they cannot see. Callers therefore pass
 * every attachment the send would make and act on one verdict.
 *
 * @param evidence every attachment the send would upload, with the records found for each
 * @returns what stands in the way, or that nothing does
 */
export function imageAdmissionVerdict({
  evidence,
}: {
  evidence: readonly ResolvedImageEvidence[];
}): ImageAdmissionVerdict {
  const findings: DoorFinding[] = [];
  const missing: string[] = [];
  const issues: string[] = [];
  for (const item of evidence) {
    // FIRST, and before believability: a failure is terminal for these bytes, so nothing written after it —
    // and no defect in a later record — can reach a verdict that admits them. See `terminalFailure`.
    const failed = terminalFailure({ records: item.records });
    if (failed !== undefined) {
      findings.push(knownBadFinding({ correction: failed.correction, evidence: item, reason: failed.reason }));
      continue;
    }
    const record = decidingRecord({ records: item.records });
    if (record === undefined) {
      missing.push(item.artifact.digest);
      continue;
    }
    const unbelievable = believabilityIssues({ evidence: item, record });
    if (unbelievable.length > 0) {
      issues.push(...unbelievable);
    }
  }
  // A hold outranks everything: see this module's header on why reversing these arms would hand the
  // no-hatch case a hatch through a dropped `receiptId`.
  if (findings.length > 0) {
    return { findings, kind: "known-bad" };
  }
  if (issues.length > 0) {
    return { issues, kind: "invalid" };
  }
  if (missing.length > 0) {
    return { digests: missing, kind: "missing" };
  }
  return { kind: "admitted" };
}

/**
 * The same verdict as this domain's typed error, for a caller that returns a `Result` rather than branching.
 *
 * Kept beside the verdict rather than replacing it: `prepareUploads` needs the ARM to decide whether the
 * hatch applies at all, and an error alone has thrown that away.
 *
 * @param verdict what {@link imageAdmissionVerdict} concluded
 * @returns the typed error, or `undefined` when the batch is admitted
 */
export function admissionErrorOf({ verdict }: { verdict: ImageAdmissionVerdict }): ImageAdmissionError | undefined {
  if (verdict.kind === "admitted") {
    return undefined;
  }
  if (verdict.kind === "known-bad") {
    return ImageAdmissionErrors.knownBad({ findings: verdict.findings });
  }
  if (verdict.kind === "invalid") {
    return ImageAdmissionErrors.evidenceInvalid({ issues: verdict.issues });
  }
  return ImageAdmissionErrors.recordMissing({ digests: verdict.digests });
}
