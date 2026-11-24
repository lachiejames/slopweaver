/**
 * Review-lane admission, the CLI shell's half of `../../../codex/reviewLane.ts`: which lane one `codex review`
 * invocation runs in, read before the two-pass cap is asked, and the refusal of every invocation that carries a
 * reserved `baseline-bump-` property id without being the exact witness.
 *
 * ## No acknowledgement or hatch opens either refusal
 *
 * Not `SLOPWEAVER_ALLOW_CODEX_REVIEW_PASS_CAP`, not a door acknowledgement, nothing. The witness lane loosens the
 * owner's two-pass cap for one narrow review only, and these refusals are what keep it narrow: a hatch here would
 * let a broad review ride a reserved id past the general count. A session meeting one fixes the invocation — the
 * exact command `slopweaver dev baseline-bump` printed — or takes an ordinary review under an ordinary id.
 *
 * ## A READ only
 *
 * The bump records are read, never written: the state home's through `readBumpRecords`, and any the change commits
 * under `.baselines/bumps/` through `committedBumpManifests`, merged by `landingBumpRecords` so admission judges
 * exactly the records a landing would. A record that will not read refuses, never demotes the review to general.
 * A general invocation reads neither.
 */

import { logger } from "#lib/logger.js";
import { err, ok, type Result } from "#lib/result.js";
import { readBumpRecords } from "../../../codex/bumpRecordStore.js";
import { committedBumpManifests, landingBumpRecords } from "../../../codex/committedBumpManifests.js";
import type { FallbackRegisterPort } from "../../../codex/fallbackPort.js";
import type { ReviewDiff } from "../../../codex/gitDiff.js";
import { isReservedWitnessPropertyId, type ReviewLane, reviewLaneAdmission } from "../../../codex/reviewLane.js";
import type { SupersessionPort } from "../../../codex/supersessionPort.js";
import type { ReviewPassId, ReviewProperty } from "../../../codex/types.js";
import { refusedByReviewCap } from "./reviewCapGate.js";

/**
 * Why an invocation was refused a lane.
 *
 * @internal the error arm of {@link readReviewLane}, matched by `code` rather than imported.
 */
export interface ReviewLaneReadError {
  readonly code: "WITNESS_INVOCATION_REFUSED" | "BUMP_RECORDS_UNREADABLE";
  readonly message: string;
}

/** The closing clause every refusal here carries, so none reads as one a hatch could open. */
const NO_HATCH = "no acknowledgement or hatch opens this refusal, SLOPWEAVER_ALLOW_CODEX_REVIEW_PASS_CAP included";

/** The factory every lane refusal is built through. */
const ReviewLaneReadErrors = {
  invocationRefused: ({ reason }: { reason: string }): ReviewLaneReadError => ({
    code: "WITNESS_INVOCATION_REFUSED",
    message:
      `property ids starting baseline-bump- are reserved for the exact baseline-bump witness (${reason}) — run the ` +
      `one command \`slopweaver dev baseline-bump\` printed, or review under an ordinary property id; ${NO_HATCH}`,
  }),
  recordsUnreadable: ({ reason }: { reason: string }): ReviewLaneReadError => ({
    code: "BUMP_RECORDS_UNREADABLE",
    message: `the baseline-bump witness could not be admitted, because its bump records would not read: ${reason}; ${NO_HATCH}`,
  }),
} as const;

/**
 * The lane one invocation runs in, or why it is refused one. IO edge: reads bump records only when a property
 * carries a reserved id.
 *
 * @internal exported so its test can drive admission over a synthetic home without a review.
 * @param home the state home the bump records are read from
 * @param diff the frozen diff, whose base and head bound the committed manifests read
 * @param pass the review profile the invocation runs
 * @param properties every property the invocation would fan out over
 * @returns the lane, or the refusal
 */
export function readReviewLane({
  home,
  diff,
  pass,
  properties,
}: {
  home: string;
  diff: { readonly baseSha: string; readonly headSha: string; readonly repoRoot: string };
  pass: ReviewPassId;
  properties: readonly ReviewProperty[];
}): Result<ReviewLane, ReviewLaneReadError> {
  if (!properties.some((property) => isReservedWitnessPropertyId({ propertyId: property.id }))) {
    return ok("general");
  }
  const stored = readBumpRecords({ home });
  if (stored.isErr()) {
    return err(ReviewLaneReadErrors.recordsUnreadable({ reason: stored.error.message }));
  }
  const committed = committedBumpManifests({ base: diff.baseSha, candidate: diff.headSha, root: diff.repoRoot });
  if (committed.isErr()) {
    return err(ReviewLaneReadErrors.recordsUnreadable({ reason: committed.error.message }));
  }
  const records = landingBumpRecords({ committed: committed.value, stored: stored.value });
  const admission = reviewLaneAdmission({ pass, properties, records });
  if (admission.kind === "refused") {
    return err(ReviewLaneReadErrors.invocationRefused({ reason: admission.reason }));
  }
  return ok(admission.kind === "witness" ? "baseline-bump-witness" : "general");
}

/**
 * Lane admission, then the cap in that lane — the one call `codex review` makes before it spends. Admission runs
 * FIRST, so the cap's hatch can never carry a refused invocation past it.
 *
 * @param branch the branch the diff's tree was captured on; `null` or `undefined` lands on no branch's count
 * @param diff the frozen diff about to be reviewed
 * @param env the environment the cap's hatch is read from — never this module's refusals
 * @param fallbackPort where the Claude fallback receipts are read
 * @param pass the review profile the invocation runs
 * @param properties every property the invocation would fan out over
 * @param supersessions the register of retired passes
 * @param verb the verb asking, so every line it prints names it
 * @returns true when the review is refused and must not run
 */
export async function refusedByLaneOrCap({
  branch,
  diff,
  env,
  fallbackPort,
  home,
  pass,
  properties,
  supersessions,
  verb,
}: {
  branch: string | null | undefined;
  diff: ReviewDiff;
  env: Readonly<Record<string, string | undefined>>;
  fallbackPort: FallbackRegisterPort;
  home: string;
  pass: ReviewPassId;
  properties: readonly ReviewProperty[];
  supersessions: SupersessionPort;
  verb: string;
}): Promise<boolean> {
  const lane = readReviewLane({ diff, home, pass, properties });
  if (lane.isErr()) {
    logger.error({ msg: `${verb}: refused: ${lane.error.message}` });
    return true;
  }
  return refusedByReviewCap({ branch, diff, env, fallbackPort, home, lane: lane.value, supersessions, verb });
}

/**
 * The fallback review's reservation: a Claude review can never witness a bump, so any reserved id is refused
 * before anything is read or written. No acknowledgement or hatch opens it.
 *
 * @param propertyId the id the fallback request was asked to judge under
 * @returns true when the id is reserved and the request must not be prepared
 */
export function refusedAsReservedWitness({ propertyId }: { propertyId: string }): boolean {
  if (!isReservedWitnessPropertyId({ propertyId })) {
    return false;
  }
  logger.error({
    msg:
      "codex review-fallback prepare: refused: property ids starting baseline-bump- are reserved for an r3 Codex " +
      `witness, and a Claude fallback can never witness a baseline bump; ${NO_HATCH}`,
  });
  return true;
}
