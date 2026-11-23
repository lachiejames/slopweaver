/**
 * Whether the reviewer's image observations cover the pictures this send is actually carrying — exactly.
 *
 * Pure: no fs, no clock, no environment. `../live/turn/answerImageObservations.ts` resolves the bytes and
 * persists what this module's classifier condemns; this only judges.
 *
 * ## Why coverage is checked against the BYTES and not against the answer
 *
 * `answerDigestOf` (`../live/turn/posterAnswer.ts`) hashes `JSON.stringify(answer)`, and an answer's
 * `images` are path strings — so the digest a verdict binds to covers the PATHS and never the pictures.
 * Replace the PNG at a reviewed path and every verdict about it still binds, unchanged and unfalsifiable.
 * Every judgement here is therefore made against `attached`, whose digests are computed from the upload
 * bytes in hand, so a picture swapped after review shows up as a `stale` observation rather than a covered
 * one. That is the same reasoning `../visualEvidence/admission.ts` gives for keying records by digest.
 *
 * ## A PAIR, not a digest
 *
 * Coverage matches `(path, digest)` together. Matching digests alone would let two observations whose paths
 * are swapped between two attached images cover both — each naming real bytes, neither describing the
 * picture it claims to. Matching paths alone is the hole in the paragraph above. Only the pair says "I
 * opened the file the answer names, and these are the bytes I found there".
 *
 * ## What the warn arm honestly is
 *
 * The five coverage-shape findings are `warn`s carrying {@link IMAGE_OBSERVATION_OVERRIDE}, so an operator
 * who names the token can send with a coverage gap, and the door records that they did. That is the house
 * contract — block by default WITH a break-glass — and it is stated rather than dressed up: this makes
 * exact coverage the default, not an arithmetic invariant.
 *
 * {@link imageObservationUnfitReasons} is the exception and has no token at all. A reviewer that opened a
 * picture and wrote down that it is unreadable, or that its panel never rendered, has described the
 * incident itself; that arm is a hold with no way past it, exactly as
 * `../visualEvidence/admission.ts`'s `known-bad` is.
 */

import type { ImageFailureReason } from "../visualEvidence/types.js";
import type { ReviewedImage } from "./reviewVerdict.js";
import type { DoorFinding, DoorGate } from "./types.js";

/** The token that waives a coverage-SHAPE finding. It never waives an unfit observation: that has none. */
export const IMAGE_OBSERVATION_OVERRIDE = "answer.image-observations:v1";

/** One picture this send is about to upload, as coverage sees it: the path named, and the bytes found. */
export interface AttachedReviewImage {
  /** The path the answer's `images` names. */
  readonly path: string;
  /** `sha256:<64 hex>` computed from the bytes in hand — never read off the answer or the verdict. */
  readonly digest: string;
}

/** Build one coverage-shape finding — every one of them is fixed by re-reviewing, so every one is a warn. */
function coverageWarn({
  code,
  summary,
  correction,
}: {
  code: string;
  summary: string;
  correction: string;
}): DoorFinding {
  return { code, correction, override: IMAGE_OBSERVATION_OVERRIDE, severity: "warn", summary };
}

/**
 * Every way this observation says the picture is unfit to send, derived from what it OBSERVED.
 *
 * Derived rather than read off `unfitReason`, and that is the whole point of the function existing: a
 * reviewer that filled in `legible: false` and left the reason blank has still told you the picture is
 * unreadable, and a classifier trusting the optional field would report it fit. The optional field is
 * checked FOR AGREEMENT at the parse edge (`./reviewVerdictFile.ts`) and is never how a defect is found.
 *
 * `zero-results` is deliberately fit: a query that legitimately matched nothing is evidence, and conflating
 * it with a panel that never loaded would refuse every honest empty result. That distinction is
 * `../visualEvidence/types.ts`'s `TargetState`, and it is the one the incident turned on.
 *
 * @param observation what the reviewer wrote down about one attachment
 * @returns each defect, in a stable order; empty when the picture is fit
 */
export function imageObservationUnfitReasons({
  observation,
}: {
  observation: ReviewedImage;
}): readonly ImageFailureReason[] {
  const reasons: ImageFailureReason[] = [];
  if (observation.targetState === "unloaded") {
    reasons.push("unloaded");
  }
  if (observation.targetState === "empty-panel") {
    reasons.push("empty-panel");
  }
  if (!observation.legible) {
    reasons.push("illegible");
  }
  if (!observation.contextRetained) {
    reasons.push("context-lost");
  }
  return reasons;
}

/** The words a reader gets for each closed reason, so a refusal names rather than narrates. */
const UNFIT_SUMMARY: Readonly<Record<ImageFailureReason, string>> = {
  "context-lost":
    "the context a reader needs to check the claim — the axes, the query, the time range — is not in frame",
  illegible: "it cannot be read at the size Slack renders the preview",
  "empty-panel": "the panel the claim rests on was still empty in the picture",
  obscured: "a pop-up, banner or modal covers what the picture shows",
  unloaded: "the page had not finished rendering in the picture",
};

/** `path=…` and its digest, spelled one way everywhere a finding names an attachment. */
function named({ path, digest }: { path: string; digest: string }): string {
  return `${path} (${digest})`;
}

/** An attachment list that repeats a path or a digest cannot be covered one-observation-per-picture. */
function attachmentShapeFindings({ attached }: { attached: readonly AttachedReviewImage[] }): readonly DoorFinding[] {
  const repeatedPaths = duplicatesOf({ values: attached.map((image) => image.path) });
  const repeatedDigests = duplicatesOf({ values: attached.map((image) => image.digest) });
  if (repeatedPaths.length === 0 && repeatedDigests.length === 0) {
    return [];
  }
  return [
    coverageWarn({
      code: "ANSWER_IMAGE_ATTACHMENT_DUPLICATE",
      correction: "attach each picture once, then re-review the answer as it now stands",
      summary:
        "this answer attaches the same picture more than once, so one observation per picture cannot say " +
        `which attachment it covers — repeated ${[...repeatedPaths, ...repeatedDigests].join(", ")}`,
    }),
  ];
}

/**
 * The values that appear more than once, each named once, in first-appearance order.
 *
 * @param values the list to inspect
 * @returns every repeated value
 */
function duplicatesOf({ values }: { values: readonly string[] }): readonly string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      repeated.add(value);
    }
    seen.add(value);
  }
  return [...repeated];
}

/** An attachment no observation covers as a pair — the reviewer did not look at this picture. */
function missingFindings({
  attached,
  observations,
}: {
  attached: readonly AttachedReviewImage[];
  observations: readonly ReviewedImage[];
}): readonly DoorFinding[] {
  const covered = new Set(observations.map((observation) => pairKeyOf({ observation })));
  const uncovered = attached.filter((image) => !covered.has(`${image.digest} ${image.path}`));
  if (uncovered.length === 0) {
    return [];
  }
  return [
    coverageWarn({
      code: "ANSWER_IMAGE_OBSERVATION_MISSING",
      correction: "have the reviewer OPEN each attachment and record what it saw, then re-supply the verdict",
      summary:
        `${String(uncovered.length)} attached image(s) carry no reviewer observation, so nothing but their ` +
        `author has looked at them: ${uncovered.map((image) => named(image)).join("; ")}`,
    }),
  ];
}

/** The pair an observation covers, as one comparable key. */
function pairKeyOf({ observation }: { observation: ReviewedImage }): string {
  return `${observation.artifactDigest} ${observation.path}`;
}

/** Two observations about one picture cannot both be the record of what was seen, even if they agree. */
function duplicateObservationFindings({
  observations,
}: {
  observations: readonly ReviewedImage[];
}): readonly DoorFinding[] {
  const repeated = duplicatesOf({ values: observations.map((observation) => observation.artifactDigest) });
  if (repeated.length === 0) {
    return [];
  }
  return [
    coverageWarn({
      code: "ANSWER_IMAGE_OBSERVATION_DUPLICATE",
      correction: "record one observation per attached picture, then re-supply the verdict",
      summary: `${String(repeated.length)} image(s) carry more than one observation: ${repeated.join("; ")}`,
    }),
  ];
}

/** How an observation fails to name an attachment. Each is a different fact about what went wrong. */
type UnmatchedKind = "stale" | "path-mismatch" | "extra";

/**
 * Why this observation covers no attachment, when it covers none.
 *
 * @param attached every picture this send carries
 * @param observation the observation being placed
 * @returns the kind of mismatch, or `undefined` when it covers an attachment exactly
 */
function unmatchedKindOf({
  attached,
  observation,
}: {
  attached: readonly AttachedReviewImage[];
  observation: ReviewedImage;
}): UnmatchedKind | undefined {
  const exact = attached.some(
    (image) => image.digest === observation.artifactDigest && image.path === observation.path,
  );
  if (exact) {
    return undefined;
  }
  const digestAttached = attached.some((image) => image.digest === observation.artifactDigest);
  if (digestAttached) {
    return "path-mismatch";
  }
  return attached.some((image) => image.path === observation.path) ? "stale" : "extra";
}

/** What each mismatch means, in the words a reader needs to act on it. */
const UNMATCHED_SUMMARY: Readonly<Record<UnmatchedKind, string>> = {
  extra: "names neither a path nor bytes this send carries — it is about some other picture entirely",
  "path-mismatch":
    "names bytes this send carries but under a different path, so it does not say which attachment was opened",
  stale:
    "names an attached path whose bytes are now different — the picture was replaced after it was reviewed, " +
    "which the answer digest cannot see because `images` are path strings",
};

/** Every observation that matches no attachment as a pair, classified by how it misses. */
function unmatchedFindings({
  attached,
  observations,
}: {
  attached: readonly AttachedReviewImage[];
  observations: readonly ReviewedImage[];
}): readonly DoorFinding[] {
  const codes: Readonly<Record<UnmatchedKind, string>> = {
    extra: "ANSWER_IMAGE_OBSERVATION_EXTRA",
    "path-mismatch": "ANSWER_IMAGE_OBSERVATION_PATH_MISMATCH",
    stale: "ANSWER_IMAGE_OBSERVATION_STALE",
  };
  const findings: DoorFinding[] = [];
  for (const observation of observations) {
    const kind = unmatchedKindOf({ attached, observation });
    if (kind === undefined) {
      continue;
    }
    findings.push(
      coverageWarn({
        code: codes[kind],
        correction: "re-review the pictures this answer now attaches, then supply the new verdict",
        summary: `the observation of ${named({ digest: observation.artifactDigest, path: observation.path })} ${UNMATCHED_SUMMARY[kind]}`,
      }),
    );
  }
  return findings;
}

/**
 * Every observation that says its picture is unfit — a hold, with no token and no hatch.
 *
 * Raised for an unfit observation whatever it names, including one that matches no attachment: a verdict
 * that says "I looked at this and it is unreadable" cannot become sendable by also being malformed.
 * Persisting the failure is the separate, effectful half, and it selects strictly by ATTACHED digest —
 * a stale observation must never condemn the replacement bytes it does not describe.
 */
function unfitFindings({ observations }: { observations: readonly ReviewedImage[] }): readonly DoorFinding[] {
  const findings: DoorFinding[] = [];
  for (const observation of observations) {
    const reasons = imageObservationUnfitReasons({ observation });
    if (reasons.length === 0) {
      continue;
    }
    findings.push({
      code: "ANSWER_IMAGE_OBSERVATION_UNFIT",
      correction:
        "capture or crop the evidence again so the target has rendered and the picture reads at preview " +
        "size, then have the NEW bytes reviewed — these ones are recorded unfit and can never be sent",
      severity: "hold",
      summary:
        `the reviewer opened ${named({ digest: observation.artifactDigest, path: observation.path })} and ` +
        `recorded it unfit: ${reasons.map((reason) => UNFIT_SUMMARY[reason]).join("; ")}`,
    });
  }
  return findings;
}

/**
 * Every reason these observations do not cover these attachments.
 *
 * Returned as a LIST rather than the first failure, for `./answerQualityGate.ts`'s reason: a reviewer
 * fixing one problem at a time, learning about the next only after another round trip, is the loop this
 * repository's typed forms exist to avoid. The order is deterministic — attachment shape, then missing in
 * attachment order, then duplicates, then unmatched and unfit in observation order — so a reader compares
 * two runs by reading rather than by sorting.
 *
 * @param attached every picture this send carries, digests computed from the bytes in hand
 * @param observations what the reviewer wrote down, or the empty list when it wrote nothing
 * @returns every finding that stands; empty when coverage is exact and every picture is fit
 */
export function imageObservationFindings({
  attached,
  observations,
}: {
  attached: readonly AttachedReviewImage[];
  observations: readonly ReviewedImage[];
}): readonly DoorFinding[] {
  return [
    ...attachmentShapeFindings({ attached }),
    ...missingFindings({ attached, observations }),
    ...duplicateObservationFindings({ observations }),
    ...unmatchedFindings({ attached, observations }),
    ...unfitFindings({ observations }),
  ];
}

/**
 * The image-observation gate, ready to compose into the door's gate list.
 *
 * Always composed, including when no verdict arrived: `./answerQualityGate.ts` already refuses an
 * unreviewed answer, and an answer that reaches the door on that gate's token must still not carry a
 * picture nobody looked at.
 *
 * @param attached every picture this send carries, digests computed from the bytes in hand
 * @param observations what the reviewer wrote down, or the empty list when it wrote nothing
 * @returns a `DoorGate` reporting every reason the pictures are not covered
 */
export function imageObservationGate({
  attached,
  observations,
}: {
  attached: readonly AttachedReviewImage[];
  observations: readonly ReviewedImage[];
}): DoorGate {
  return () => imageObservationFindings({ attached, observations });
}
