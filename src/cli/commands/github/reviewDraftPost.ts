/**
 * `github review-draft post` — re-check a parked review against the live pull request, then send it once through
 * the door, whose approval gate (`../../../outbound/github/reviewDraftApi.ts`) holds unless `--approve` names the
 * digest of exactly the review the card showed the owner.
 *
 * `posted` is appended the moment GitHub accepts the review, BEFORE the readback, so a readback that fails can never
 * leave a sent review held and postable a second time. The register's lock is held from the held check to that
 * append, so a second `post` of the same row waits its turn and then finds it spent. Before sending it also asks
 * GitHub whether this account already has the same review at the approved head, which is the only record of a send
 * whose answer was lost.
 */
import { DEFAULT_GATES } from "../../../admit/door.js";
import { notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import type { PrRef } from "../../../corpus/github/write.js";
import type { PostedReview } from "../../../corpus/github/writeReviewDraft.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { type ParkedReviewDraft, recomputedDigest } from "../../../outbound/github/reviewDraft.js";
import { type GithubReviewDraftApi, reviewPostApprovalGate } from "../../../outbound/github/reviewDraftApi.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import {
  postRefusals,
  type ReviewDraftPostOptions,
  reviewDraftDoorRequest,
  submittedStateOf,
} from "./reviewDraftCore.js";
import {
  diagnose,
  type GithubReviewDraftDeps,
  readPullRequestNow,
  reviewDraftApiFor,
  reviewDraftFor,
  withReviewDraftLock,
} from "./reviewDraftDeps.js";

/** The pull request a stored row addresses. */
function refOf({ draft }: { draft: ParkedReviewDraft }): PrRef {
  const [owner = "", repo = ""] = draft.repo.split("/");
  return { number: draft.number, owner, repo };
}

/** A cleared review: the digest the owner's approval must name, and the account the review would go out as. */
interface Cleared {
  readonly expected: string;
  readonly viewerId: number;
}

/** Whether the review may go: the row is unedited and the pull request still matches the card. */
async function cleared({
  api,
  deps,
  draft,
}: {
  api: GithubReviewDraftApi;
  deps: GithubReviewDraftDeps;
  draft: ParkedReviewDraft;
}): Promise<Result<Cleared, number>> {
  const expected = recomputedDigest({ draft });
  if (expected.isErr()) {
    deps.writeDiagnostic(expected.error.message);
    return err(EXIT_ERROR);
  }
  const now = await readPullRequestNow({ api, ref: refOf({ draft }) });
  if (now.isErr()) {
    deps.writeDiagnostic(`could not read ${draft.repo}#${String(draft.number)}: ${now.error}. Nothing was posted.`);
    return err(EXIT_ERROR);
  }
  const refused = postRefusals({ draft, ...now.value });
  if (refused.length > 0) {
    diagnose({ deps, lines: [...refused, "Nothing was posted."] });
    return err(EXIT_ERROR);
  }
  return ok({ expected: expected.value, viewerId: now.value.viewerId });
}

/**
 * Refuse a review this account already has on the pull request at the approved head with the same body. A send
 * whose answer was lost, or whose `posted` line did not append, leaves the row held with the review on GitHub,
 * and only GitHub can say so.
 */
async function notAlreadyPosted({
  api,
  deps,
  draft,
  viewerId,
}: {
  api: GithubReviewDraftApi;
  deps: GithubReviewDraftDeps;
  draft: ParkedReviewDraft;
  viewerId: number;
}): Promise<Result<true, number>> {
  const reviews = await api.reviews(refOf({ draft }));
  if (reviews.isErr()) {
    deps.writeDiagnostic(
      `could not check whether ${draft.id} is already on ${draft.repo}#${String(draft.number)}: ` +
        `${reviews.error.message}. Nothing was posted.`,
    );
    return err(EXIT_ERROR);
  }
  const existing = reviews.value.find(
    (review) => review.authorId === viewerId && review.commitId === draft.headSha && review.body === draft.body,
  );
  if (existing === undefined) {
    return ok(true);
  }
  diagnose({
    deps,
    lines: [
      `refused: this account already posted this review as ${existing.url}. Nothing was posted.`,
      `Record it spent: slopweaver github review-draft drop ${draft.id} --note "posted as ${existing.url}"`,
    ],
  });
  return err(EXIT_ERROR);
}

/** Send the review once through the door, or the exit code once the door's or GitHub's refusal is printed. */
async function sendThroughDoor({
  api,
  deps,
  draft,
  expected,
  options,
}: {
  api: GithubReviewDraftApi;
  deps: GithubReviewDraftDeps;
  draft: ParkedReviewDraft;
  expected: string;
  options: ReviewDraftPostOptions;
}): Promise<Result<PostedReview, number>> {
  const through = await throughDoor({
    env: deps.doorEnv(),
    gates: [...DEFAULT_GATES, reviewPostApprovalGate({ expected, id: draft.id, supplied: options.approve })],
    home: options.home,
    ledger: deps.doorLedger,
    perform: async (): Promise<Result<PostedReview>> => {
      const sent = await api.createReview({
        ...refOf({ draft }),
        body: draft.body,
        comments: draft.comments,
        commitId: draft.headSha,
        event: draft.verdict,
      });
      return sent.isErr() ? err([sent.error.message]) : ok(sent.value);
    },
    request: reviewDraftDoorRequest({ draft, home: options.home }),
  });
  if (!through.performed) {
    diagnose({
      deps,
      lines: [...notPerformedLines({ command: "slopweaver github review-draft post", through }), "Nothing was posted."],
    });
    return err(EXIT_ERROR);
  }
  if (through.result.isErr()) {
    diagnose({
      deps,
      lines: [
        ...through.result.error,
        "GitHub did not answer with a posted review, but it may still have saved it. The draft is still held, " +
          "and posting again checks GitHub for it before sending.",
      ],
    });
    return err(EXIT_ERROR);
  }
  return ok(through.result.value);
}

/** Read the posted review back and report what GitHub holds, failing loudly on any disagreement. */
async function confirmPosted({
  api,
  deps,
  draft,
  json,
  posted,
}: {
  api: GithubReviewDraftApi;
  deps: GithubReviewDraftDeps;
  draft: ParkedReviewDraft;
  json: boolean;
  posted: PostedReview;
}): Promise<number> {
  const readBack = await api.readReview({ ...refOf({ draft }), reviewId: posted.reviewId });
  if (readBack.isErr()) {
    deps.writeDiagnostic(`posted ${posted.url}, and it could not be read back: ${readBack.error.message}`);
    return EXIT_ERROR;
  }
  const { state, commitId } = readBack.value;
  const wanted = submittedStateOf({ verdict: draft.verdict });
  if (state !== wanted || commitId !== draft.headSha) {
    deps.writeDiagnostic(
      `posted ${posted.url}, and GitHub reads it back as ${state} on ${String(commitId)} — ` +
        `expected ${wanted} on ${draft.headSha}`,
    );
    return EXIT_ERROR;
  }
  if (json) {
    deps.out(JSON.stringify({ id: draft.id, state, url: posted.url }, null, 2));
    return EXIT_OK;
  }
  deps.out(`posted ${draft.id}: ${state} on ${draft.repo}#${String(draft.number)} — ${posted.url}`);
  return EXIT_OK;
}

/**
 * Run `post`, holding the register's lock from the held check through the `posted` append.
 *
 * @param deps the injected world
 * @param options the parsed invocation
 * @returns the exit code
 */
export async function runReviewDraftPost({
  deps,
  options,
}: {
  deps: GithubReviewDraftDeps;
  options: ReviewDraftPostOptions;
}): Promise<number> {
  return withReviewDraftLock({ body: () => postHeld({ deps, options }), deps, home: options.home });
}

/** Check the row is still held, re-check it against the pull request, send it once and record it spent. */
async function postHeld({
  deps,
  options,
}: {
  deps: GithubReviewDraftDeps;
  options: ReviewDraftPostOptions;
}): Promise<number> {
  const found = reviewDraftFor({ deps, home: options.home, id: options.id, mustBeHeld: true });
  if (found.isErr()) {
    return found.error;
  }
  const api = reviewDraftApiFor({ deps, home: options.home });
  if (api.isErr()) {
    return api.error;
  }
  const { draft } = found.value;
  const clear = await cleared({ api: api.value, deps, draft });
  if (clear.isErr()) {
    return clear.error;
  }
  const fresh = await notAlreadyPosted({ api: api.value, deps, draft, viewerId: clear.value.viewerId });
  if (fresh.isErr()) {
    return fresh.error;
  }
  if (options.dryRun) {
    deps.out(
      `would post ${draft.verdict} on ${draft.repo}#${String(draft.number)} with ${String(draft.comments.length)} comment(s)`,
    );
    return EXIT_OK;
  }
  const posted = await sendThroughDoor({ api: api.value, deps, draft, expected: clear.value.expected, options });
  if (posted.isErr()) {
    return posted.error;
  }
  if (!recordedSpent({ deps, draft, home: options.home, url: posted.value.url })) {
    return EXIT_ERROR;
  }
  return confirmPosted({ api: api.value, deps, draft, json: options.json, posted: posted.value });
}

/** Record the review posted, or say loudly that a SENT review still reads as held and how to close it. */
function recordedSpent({
  deps,
  draft,
  home,
  url,
}: {
  deps: GithubReviewDraftDeps;
  draft: ParkedReviewDraft;
  home: string;
  url: string;
}): boolean {
  const appended = deps.appendEvent({ event: { id: draft.id, kind: "posted", tsIso: deps.nowIso(), url }, home });
  if (appended.isOk()) {
    return true;
  }
  diagnose({
    deps,
    lines: [
      `POSTED ${url}, and ${appended.error.message}.`,
      `The register still reads ${draft.id} as held — drop it by hand now so it cannot be posted twice: ` +
        `slopweaver github review-draft drop ${draft.id} --note "posted as ${url}"`,
    ],
  });
  return false;
}
