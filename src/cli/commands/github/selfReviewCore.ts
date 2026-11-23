/** Pure parsing and readback decisions for inline self-review rounds. */
import type { DoorRequest } from "../../../admit/types.js";
import type { ReviewThreadSnapshot } from "../../../corpus/github/write.js";
import type { PrivateTerm } from "../../../hygiene/privateTerms.js";
import { err, ok } from "../../../lib/result.js";
import {
  type SelfReviewComment,
  type SelfReviewForm,
  selfReviewFormSchema,
  selfReviewVoiceFindings,
} from "../../../outbound/github/selfReview.js";
import { publicationFindings } from "../../../outbound/publicationScan.js";
import type { ExactVoiceRule } from "../../../outbound/voice/exactRules.js";
import { GithubVerbErrors, type GithubVerbResult } from "./errors.js";

/**
 * Refuse a self-review unless the authenticated account authored the pull request.
 *
 * Description updates have a deliberate foreign-PR escape hatch. A self-review never inherits it: speaking
 * as the author on somebody else's diff would make the review actively misleading.
 *
 * @param authedUserId the authenticated GitHub account id, when GitHub could establish it
 * @param prAuthorId the pull-request author's account id, when GitHub returned one
 * @returns the refusal reason, or undefined when both ids prove this is the caller's own pull request
 */
export function selfReviewAuthorshipRefusal({
  authedUserId,
  prAuthorId,
}: {
  authedUserId: number | undefined;
  prAuthorId: number | undefined;
}): string | undefined {
  if (authedUserId === undefined) {
    return "could not establish which GitHub account this token belongs to, so self-review authorship cannot be checked";
  }
  if (prAuthorId === undefined) {
    return "GitHub returned no pull-request author, so self-review authorship cannot be checked";
  }
  return authedUserId === prAuthorId
    ? undefined
    : "inline self-review comments may only be posted on the authenticated account's own pull request";
}

/**
 * The warning `stack push` prints when it opens a pull request with no `--self-review` round.
 *
 * Every pull request of the owner's, on BOTH repositories, opens with inline notes guiding the
 * reviewer, and it matters most on `acme/acme-admin` because humans read every pull request there. A
 * warning rather than a refusal: the schema never invents prose, and a missing note is not a reason to hold
 * back a push that is otherwise valid (`skills/github/reference/self-review.md`).
 *
 * @param repoSlug the repository, `owner/name`
 * @param number the pull request just opened, or undefined on a dry run where none exists yet
 * @returns the line
 */
export function missingWalkthroughLine({ repoSlug, number }: { repoSlug: string; number: number | undefined }): string {
  if (number === undefined) {
    return (
      "⚠ would open with no self-review walkthrough: pass --self-review with inline notes guiding the reviewer " +
      "(what to read first, why a surprising line is there)"
    );
  }
  return (
    `⚠ opened #${String(number)} with no self-review walkthrough. Every pull request of the owner's carries inline notes ` +
    `guiding the reviewer — post a round with \`slopweaver github pr update --repo ${repoSlug} --number ` +
    `${String(number)} --self-review -\``
  );
}

/**
 * What a `stack push --dry-run` says about the self-review round: the comments it would post, or the warning.
 *
 * @param repoSlug the repository, `owner/name`
 * @param comments how many inline comments the supplied round carries, or undefined when none was supplied
 * @returns the line
 */
export function dryRunSelfReviewLine({
  repoSlug,
  comments,
}: {
  repoSlug: string;
  comments: number | undefined;
}): string {
  if (comments === undefined) {
    return missingWalkthroughLine({ number: undefined, repoSlug });
  }
  return `would post ${String(comments)} inline self-review comment(s) once created`;
}

/**
 * Every publication-scan finding across a round's comment bodies, each prefixed with the comment it is in.
 *
 * The rendered emoji prefix is never scanned: it is the kind's fixed character, not authored text. The scan is
 * strict on purpose — no installation identifiers are forgiven here, because a comment names code rather than
 * the organisation — so it can only ever refuse more than the description gate, never less.
 *
 * @param form the schema-valid round
 * @param denylist the private hygiene denylist; empty still catches every credential shape
 * @param privateTerms the installation's private terms, loaded by the caller
 * @returns one reason per finding, empty when every body may be published
 * @internal — exported for its unit test; {@link parseSelfReviewForm} is its one caller.
 */
export function selfReviewPublicationReasons({
  form,
  denylist,
  privateTerms,
}: {
  form: SelfReviewForm;
  denylist: readonly string[];
  privateTerms: readonly PrivateTerm[];
}): readonly string[] {
  return form.comments.flatMap((comment, index) =>
    publicationFindings({
      hygiene: { denylist, privateTerms },
      surface: "self-review-comment",
      text: comment.body,
    }).map((finding) => `comments.${String(index)}.body: ${finding.message}`),
  );
}

/**
 * Decode a strict review form, apply the operator's exact deterministic voice rules, then the publication scan.
 *
 * @param raw the JSON supplied to --self-review
 * @param exactVoiceRules private exact rules from profile.json
 * @param denylist the private hygiene denylist the publication scan's hygiene half reads
 * @param privateTerms the installation's private terms the publication scan matches
 * @returns the form or every refusal
 */
export function parseSelfReviewForm({
  raw,
  exactVoiceRules,
  denylist,
  privateTerms,
}: {
  raw: string;
  exactVoiceRules: readonly ExactVoiceRule[];
  denylist: readonly string[];
  privateTerms: readonly PrivateTerm[];
}): GithubVerbResult<SelfReviewForm> {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error: unknown) {
    return err(GithubVerbErrors.selfReviewNotJson({ cause: error }));
  }
  const decoded = selfReviewFormSchema.safeParse(value);
  if (!decoded.success) {
    const reasons = decoded.error.issues.map((issue) => {
      const path = issue.path.map((part) => String(part)).join(".");
      return path.length === 0 ? issue.message : `${path}: ${issue.message}`;
    });
    return err(GithubVerbErrors.formInvalid({ form: "--self-review", reasons }));
  }
  const findings = selfReviewVoiceFindings({ form: decoded.data, rules: exactVoiceRules });
  if (findings.length > 0) {
    const reasons = findings.map(
      (finding) =>
        `${finding.path} ${finding.label}. ` +
        "Rewrite the authored prose; inline self-review comments have no voice-rule override.",
    );
    return err(GithubVerbErrors.formInvalid({ form: "--self-review", reasons }));
  }
  const unpublishable = selfReviewPublicationReasons({ denylist, form: decoded.data, privateTerms });
  if (unpublishable.length > 0) {
    return err(GithubVerbErrors.formInvalid({ form: "--self-review", reasons: unpublishable }));
  }
  return ok(decoded.data);
}

/**
 * Map every returned comment id to exactly one live thread.
 *
 * @param commentIds ids returned by addPullRequestReview
 * @param threads the pull request's newest bounded thread window
 * @returns ordered owning thread ids, refusing missing or ambiguous mappings
 */
export function reviewThreadIdsFor({
  commentIds,
  threads,
}: {
  commentIds: readonly string[];
  threads: readonly ReviewThreadSnapshot[];
}): GithubVerbResult<readonly string[]> {
  const threadIds: string[] = [];
  for (const commentId of commentIds) {
    const matches = threads.filter((thread) => thread.commentIds.includes(commentId));
    if (matches.length !== 1) {
      return err(GithubVerbErrors.threadMappingNotOne({ commentId, count: matches.length }));
    }
    const threadId = matches[0]!.id;
    if (threadIds.includes(threadId)) {
      return err(GithubVerbErrors.threadMappedTwice({ threadId }));
    }
    threadIds.push(threadId);
  }
  return ok(threadIds);
}

/** One changed file's unified diff patch at the reviewed head SHA, or no patch when GitHub reports none. */
export interface SelfReviewDiffFile {
  readonly path: string;
  readonly patch: string | undefined;
}

/**
 * The RIGHT-side line numbers a unified diff patch exposes — every line GitHub will accept a `RIGHT`-side
 * single-line review comment on: an added line, or an unchanged line shown as hunk context. A removed line
 * never advances the right-side counter, so it is never a valid anchor.
 *
 * @param patch one file's unified diff patch, exactly as GitHub's `pulls.listFiles` returns it
 * @returns every addressable right-side line number
 */
export function selfReviewDiffLineSet({ patch }: { patch: string }): ReadonlySet<number> {
  const valid = new Set<number>();
  let rightLine = 0;
  for (const line of patch.split("\n")) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk !== null) {
      rightLine = Number(hunk[1]);
      continue;
    }
    if (line.startsWith("+") || line.startsWith(" ")) {
      valid.add(rightLine);
      rightLine += 1;
    }
    // a "-" line and the "\ No newline at end of file" marker never advance the right-side counter
  }
  return valid;
}

/**
 * Refuse a review round whose comments target a path+line the live diff at the reviewed head SHA does not
 * expose, before anything is sent to GitHub.
 *
 * A stale line number after a rebase is the measured cause of a self-review submit landing PARTIALLY: the
 * composite mutation's `addPullRequestReview` field fails on the bad anchor while its sibling
 * `resolveReviewThread` fields still execute, resolving the previous round's threads with nothing new
 * posted. Checking every anchor against the live diff before that mutation is attempted turns the failure
 * into a clean, nothing-sent refusal instead.
 *
 * @param comments every comment in the round
 * @param files every changed file's diff patch at the reviewed head SHA
 * @returns every bad anchor, in form order, or an empty array when every comment lands inside the diff
 */
export function selfReviewDiffAnchorRefusals({
  comments,
  files,
}: {
  comments: readonly SelfReviewComment[];
  files: readonly SelfReviewDiffFile[];
}): readonly string[] {
  const validLinesByPath = new Map(
    files.map((file) => [
      file.path,
      file.patch === undefined ? new Set<number>() : selfReviewDiffLineSet({ patch: file.patch }),
    ]),
  );
  return comments
    .filter((comment) => !anchoredInDiff({ comment, validLinesByPath }))
    .map((comment) => `${comment.path}:${String(comment.line)}`);
}

/** Whether the live diff exposes a comment's line — a path the diff never touched exposes no line at all. */
function anchoredInDiff({
  comment,
  validLinesByPath,
}: {
  comment: SelfReviewComment;
  validLinesByPath: ReadonlyMap<string, ReadonlySet<number>>;
}): boolean {
  const lines = validLinesByPath.get(comment.path);
  if (lines === undefined) {
    return false;
  }
  return lines.has(comment.line);
}

/**
 * Build the door record for one composite submit-and-resolve review operation.
 *
 * @param home the state home whose door ledger records the effect
 * @param repo the owner/name repository
 * @param number the pull-request number
 * @param headSha the exact reviewed commit
 * @param comments the number of fresh inline comments
 * @param previousThreads the number of owned threads requested for resolution
 * @returns a prose-free external-write request for the admit door
 */
export function githubSelfReviewDoorRequest({
  home,
  repo,
  number,
  headSha,
  comments,
  previousThreads,
}: {
  home: string;
  repo: string;
  number: number;
  headSha: string;
  comments: number;
  previousThreads: number;
}): DoorRequest {
  return {
    action: { kind: "verb", noun: "github", verb: "pr self-review" },
    artifact: { comments, headSha, number, previousThreads, repo },
    meta: { createsWorkItem: false, effect: "external-write", home, requiresApproval: false },
  };
}
