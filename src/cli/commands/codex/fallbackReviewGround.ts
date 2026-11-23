/**
 * Which ground a `codex review-fallback prepare` request stands on — what `prepare`'s fleet read already found
 * (a cap, or no Codex plan registered), or the twice-refused pass `--after-refusal` names. Split out of `./fallbackReviewRun.ts` along that seam: the
 * refusal half reads a pass record off disk and checks it against the review just captured
 * (`../../../codex/policyFallback.ts`), which is a decision of its own, not part of writing the request.
 */

import type { FallbackReviewGround } from "../../../codex/fallbackReview.js";
import type { ReviewDiff } from "../../../codex/gitDiff.js";
import { readPassRecord } from "../../../codex/ledgerStore.js";
import { POLICY_REFUSAL_REVIEW_MODE, validatePolicyFallback } from "../../../codex/policyFallback.js";
import { CODEX_UNREGISTERED_REVIEW_MODE, type FallbackFleetGround } from "../../../codex/providerUnregistered.js";
import type { CodexPassTree, ReviewPassId, ReviewProperty } from "../../../codex/types.js";
import { logger } from "../../../lib/logger.js";
import { stateHomePaths } from "../../../stateHome.js";
import { EXIT_USAGE } from "../../exitCodes.js";

/**
 * The ground the request stands on: the fleet ground `prepare` already read, or the refused pass `--after-refusal`
 * names, validated against the review just captured. Prints the failed check and returns the exit code when
 * the pass does not ground this review.
 *
 * @param args the pass and property the review was prepared for
 * @param afterRefusal the `--after-refusal` artifact id, or `undefined` on the fleet path
 * @param fleetGround what the fleet read found — a cap, or no Codex plan registered — `undefined` on the refusal path
 * @returns the ground's fields, or the exit code to stop on
 */
export function requestGround({
  afterRefusal,
  args,
  diff,
  fleetGround,
  home,
  tree,
}: {
  afterRefusal: string | undefined;
  args: { readonly pass: ReviewPassId; readonly property: ReviewProperty };
  diff: ReviewDiff;
  fleetGround: FallbackFleetGround | undefined;
  home: string;
  tree: CodexPassTree;
}): FallbackReviewGround | number {
  if (afterRefusal === undefined) {
    const read = fleetGround!;
    if (read.kind === "unregistered") {
      return { ground: read.evidence, mode: CODEX_UNREGISTERED_REVIEW_MODE };
    }
    return { capEvidence: read.evidence };
  }
  const record = readPassRecord({
    artifactId: afterRefusal,
    orchestrationRoot: stateHomePaths({ home }).orchestration,
  });
  if (record === undefined) {
    logger.error({
      msg: `codex review-fallback prepare: --after-refusal ${afterRefusal} names no readable pass record under ${stateHomePaths({ home }).orchestration}`,
    });
    return EXIT_USAGE;
  }
  // The record is decoded shallowly and may be hand-edited: whatever it holds, a bad one is refused, never a crash.
  let evidence: ReturnType<typeof validatePolicyFallback>;
  try {
    evidence = validatePolicyFallback({
      artifactId: afterRefusal,
      record,
      subject: {
        diffBytes: diff.bytes,
        diffSha256: diff.sha256,
        pass: args.pass,
        property: args.property,
        repoRoot: diff.repoRoot,
        tree,
      },
    });
  } catch (error: unknown) {
    const why = error instanceof Error ? error.message : String(error);
    logger.error({ msg: `codex review-fallback prepare: pass ${afterRefusal} does not read as a pass record: ${why}` });
    return EXIT_USAGE;
  }
  if (evidence.isErr()) {
    logger.error({ msg: `codex review-fallback prepare: ${evidence.error.message} [${evidence.error.code}]` });
    return EXIT_USAGE;
  }
  return { ground: evidence.value, mode: POLICY_REFUSAL_REVIEW_MODE };
}
