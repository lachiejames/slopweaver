/**
 * The review half of `page publish`: decide the record a page publishes with, or refuse it.
 *
 * Every briefing that reaches them gets at least one Codex review pass first. So a page with
 * no `--review` is refused with the `unreviewed-page` hatch's four lines unless that hatch is open — and an open
 * hatch publishes a WAIVED record whose fold tells them so, never a silent page. A cited review that is false is a
 * fact, not a policy refusal: the hatch does not turn it into a waiver. Kept out of `./publishRun.ts` so the verb's
 * shell stays a sequence of steps.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import { RECORD_FILENAME } from "../../../codex/artifactStore.js";
import { fallbackRegisterPort } from "../../../codex/fallbackPort.js";
import { isArtifactIdShape, readPassRecord } from "../../../codex/ledgerStore.js";
import type { CodexArtifactRecord } from "../../../codex/types.js";
import { hatchFor } from "../../../hatch/lookup.js";
import { hatchRefusalLines } from "../../../hatch/render.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { decidePageReview, type PageReviewRecord } from "../../../pages/review.js";
import { type PageReviewError, PageReviewErrors } from "../../../pages/reviewErrors.js";
import { fragmentSha256, preparedCommitFacts, readPreparationAt } from "../../../pages/reviewRepo.js";
import { type PageReviewReads, resolvePageReviews } from "../../../pages/reviewResolve.js";

/**
 * Read one cited Codex pass. The ledger's own reader answers `undefined` for a corrupt record as well as an absent
 * one, which is right for a scan and wrong here: a corrupt pass named by `--review` refuses as unreadable rather
 * than reading as "no such review".
 *
 * @param orchestrationRoot `$SLOPWEAVER_HOME/orchestration`
 * @param artifactId the cited id
 * @returns the record, `undefined` when no record file exists for the id, or the unreadable refusal
 */
export function readCitedPass({
  orchestrationRoot,
  artifactId,
}: {
  orchestrationRoot: string;
  artifactId: string;
}): Result<CodexArtifactRecord | undefined, PageReviewError> {
  const record = readPassRecord({ artifactId, orchestrationRoot });
  if (record !== undefined) {
    return ok(record);
  }
  if (!isArtifactIdShape({ artifactId })) {
    return ok(undefined);
  }
  const path = join(orchestrationRoot, artifactId, RECORD_FILENAME);
  if (!existsSync(path)) {
    return ok(undefined);
  }
  return err(PageReviewErrors.reviewUnreadable({ path, reviewId: artifactId }));
}

/**
 * The reads a production publish resolves reviews through: the home's Codex pass records, the fallback store, and
 * the preparation repositories under `page-reviews/`.
 *
 * @returns the production reads
 */
export function productionPageReviewReads(): PageReviewReads {
  return {
    commitFacts: preparedCommitFacts,
    readPass: readCitedPass,
    readPreparation: readPreparationAt,
    scanFallback: (args) => fallbackRegisterPort().scan(args),
  };
}

/**
 * Decide the review record one publish carries.
 *
 * @param home the state home
 * @param slug the page being published
 * @param fragment the fragment exactly as publish writes it, links added — the bytes `review-prepare` committed
 * @param reviewIds every id `--review` cites
 * @param reviewChanged what the author changed after the review, as passed
 * @param publishedAtIso the publish instant
 * @param reviewWaived whether the `unreviewed-page` hatch is open for this publish
 * @param reads how reviews are resolved
 * @returns the record, or the lines that refuse the publish
 */
export async function pagePublishReview({
  home,
  slug,
  fragment,
  reviewIds,
  reviewChanged,
  publishedAtIso,
  reviewWaived,
  reads,
}: {
  home: string;
  slug: string;
  fragment: string;
  reviewIds: readonly string[];
  reviewChanged: string | undefined;
  publishedAtIso: string;
  reviewWaived: boolean;
  reads: PageReviewReads;
}): Promise<Result<PageReviewRecord>> {
  const publishedFragmentSha256 = fragmentSha256({ fragment });
  if (reviewIds.length === 0) {
    if (reviewWaived) {
      return ok({
        hatch: "unreviewed-page",
        publishedAtIso,
        publishedFragmentSha256,
        schemaVersion: 1,
        slug,
        status: "waived",
      });
    }
    return err(
      hatchRefusalLines({
        detail: `"${slug}" was passed no --review`,
        hatch: hatchFor({ id: "unreviewed-page" }),
      }),
    );
  }
  const reviews = await resolvePageReviews({ home, ids: reviewIds, reads, slug });
  if (reviews.isErr()) {
    return err([reviews.error.message]);
  }
  const decided = decidePageReview({
    publishedAtIso,
    publishedFragmentSha256,
    reviewChanged,
    reviews: reviews.value,
    slug,
  });
  return decided.isErr() ? err([decided.error.message]) : ok(decided.value);
}
