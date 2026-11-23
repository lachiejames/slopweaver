/**
 * `github review-draft` — every DECISION, pure. The form it parks is `./reviewDraftForm.ts`; the shell that reads
 * GitHub and writes the register is `./reviewDraftRun.ts`.
 *
 * ## Why a review is parked rather than posted
 *
 * A review of somebody else's pull request goes out under the owner's name, to a colleague, and an APPROVE can
 * unblock a merge. The owner approves the draft comments on the relevant lines in a queue card,
 * the way they approve Slack native UI drafts. So `record` runs
 * every check it can against the live pull request, parks the result where the console draws it, and stops;
 * `post` is the second step, and the door holds it without the digest the owner's yes is carried by.
 */
import type { DoorRequest } from "../../../admit/types.js";
import type { PullRequestDiffFile } from "../../../corpus/github/write.js";
import type { ReviewTarget } from "../../../corpus/github/writeReviewDraft.js";
import { err, ok } from "../../../lib/result.js";
import type { ParkedReviewDraft, ReviewDraftComment, ReviewVerdict } from "../../../outbound/github/reviewDraft.js";
import { flagValueOr, parseFlagTail } from "../../optionParsers.js";
import { GithubVerbErrors, type GithubVerbResult, githubVerbErrorLines } from "./errors.js";
import { hunkExcerpt, reviewAnchorRefusals } from "./reviewDraftDiff.js";
import type { ReviewDraftForm } from "./reviewDraftForm.js";

/** The sub-commands, in the order the usage block lists them. */
const REVIEW_DRAFT_SUBCOMMANDS = ["record", "list", "show", "drop", "post"] as const;

/** One sub-command. */
type ReviewDraftSubcommand = (typeof REVIEW_DRAFT_SUBCOMMANDS)[number];

/** Every flag any sub-command accepts — one spec, so usage cannot drift from behaviour. */
const REVIEW_DRAFT_FLAG_SPEC = {
  boolean: ["all", "dry-run", "json"],
  value: ["approve", "form", "home", "id", "note", "number", "repo", "why"],
} as const;

/** Every flag with the `--` callers type, sorted — for the help-truth ratchet. */
export const GITHUB_REVIEW_DRAFT_FLAG_NAMES: readonly string[] = [
  ...REVIEW_DRAFT_FLAG_SPEC.boolean,
  ...REVIEW_DRAFT_FLAG_SPEC.value,
]
  .map((name) => `--${name}`)
  .toSorted();

/** What every sub-command shares. */
interface Shared {
  readonly json: boolean;
  readonly home: string;
}

/** `review-draft record`, parsed. */
export interface ReviewDraftRecordOptions extends Shared {
  readonly mode: "record";
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
  /** The `--form` value as typed: the JSON itself, or `-` for stdin. */
  readonly formSource: string;
  readonly why: string;
}

/** `review-draft list`, parsed. */
export interface ReviewDraftListOptions extends Shared {
  readonly mode: "list";
  readonly all: boolean;
}

/** `review-draft show`, parsed. */
export interface ReviewDraftShowOptions extends Shared {
  readonly mode: "show";
  readonly id: string;
}

/** `review-draft drop`, parsed. */
export interface ReviewDraftDropOptions extends Shared {
  readonly mode: "drop";
  readonly id: string;
  readonly note: string;
}

/** `review-draft post`, parsed. */
export interface ReviewDraftPostOptions extends Shared {
  readonly mode: "post";
  readonly id: string;
  /** The digest the owner's approval names; absent means the door will hold, and says what to run. */
  readonly approve: string | undefined;
  readonly dryRun: boolean;
}

/** One parsed invocation. */
export type ReviewDraftOptions =
  | ReviewDraftRecordOptions
  | ReviewDraftListOptions
  | ReviewDraftShowOptions
  | ReviewDraftDropOptions
  | ReviewDraftPostOptions;

/** The draft id: `--id` when it was passed, else the bare word after the sub-command, else absent. */
function draftIdOf({ flagged, bare }: { flagged: string | undefined; bare: string | undefined }): string | undefined {
  if (flagged !== undefined) {
    return flagged;
  }
  return bare;
}

/** Whether the first argument names a sub-command. */
function isSubcommand(value: string | undefined): value is ReviewDraftSubcommand {
  return REVIEW_DRAFT_SUBCOMMANDS.some((candidate) => candidate === value);
}

/**
 * Parse one invocation. The id of `show`, `drop` and `post` may be the bare word after the sub-command — the
 * card hands out `… post rd-1a2b3c4d --approve …` — or `--id`.
 *
 * @param rest the argv tail, starting at the sub-command
 * @param defaultHome the home to use when `--home` is absent
 * @returns the parsed invocation, or every reason it was refused
 */
export function parseReviewDraftArgs({
  rest,
  defaultHome,
}: {
  rest: readonly string[];
  defaultHome: string;
}): GithubVerbResult<ReviewDraftOptions> {
  const sub = rest[0];
  if (!isSubcommand(sub)) {
    return err(
      GithubVerbErrors.argumentsRefused({
        reasons: [`review-draft needs a sub-command: ${REVIEW_DRAFT_SUBCOMMANDS.join(", ")}`],
      }),
    );
  }
  const tail = rest.slice(1);
  const bare = tail[0] !== undefined && !tail[0].startsWith("--") ? tail[0] : undefined;
  const parsed = parseFlagTail({ rest: bare === undefined ? tail : tail.slice(1), spec: REVIEW_DRAFT_FLAG_SPEC });
  if (parsed.isErr()) {
    return err(GithubVerbErrors.flagsRefused({ reasons: parsed.error }));
  }
  const { values, flags } = parsed.value;
  const shared: Shared = {
    home: flagValueOr({ fallback: defaultHome, name: "home", parsed: parsed.value }),
    json: flags.has("json"),
  };
  if (sub === "record") {
    return parseRecord({ shared, values });
  }
  if (sub === "list") {
    return ok({ all: flags.has("all"), mode: "list", ...shared });
  }
  const id = draftIdOf({ bare, flagged: values["id"] });
  if (id === undefined || id.trim() === "") {
    return err(GithubVerbErrors.argumentsRefused({ reasons: [`review-draft ${sub} needs the draft id`] }));
  }
  if (sub === "show") {
    return ok({ id, mode: "show", ...shared });
  }
  if (sub === "post") {
    return ok({ approve: values["approve"], dryRun: flags.has("dry-run"), id, mode: "post", ...shared });
  }
  const note = values["note"];
  if (note === undefined || note.trim() === "") {
    return err(GithubVerbErrors.argumentsRefused({ reasons: ["review-draft drop needs --note <why it is dropped>"] }));
  }
  return ok({ id, mode: "drop", note, ...shared });
}

/** `owner/name`, each half one path segment. */
const REPO_SLUG = /^([^/\s]+)\/([^/\s]+)$/;

/** Build `record`'s options, or every reason they were refused. */
function parseRecord({
  shared,
  values,
}: {
  shared: Shared;
  values: Readonly<Record<string, string>>;
}): GithubVerbResult<ReviewDraftOptions> {
  const reasons: string[] = [];
  const repoFlag = values["repo"];
  const slug = repoFlag === undefined ? null : REPO_SLUG.exec(repoFlag);
  const owner = slug?.[1];
  const repo = slug?.[2];
  if (slug === null) {
    reasons.push("review-draft record needs --repo <owner/name>");
  }
  const number = Number(values["number"]);
  if (!Number.isSafeInteger(number) || number <= 0) {
    reasons.push("review-draft record needs --number <pull request>");
  }
  const formSource = values["form"];
  if (formSource === undefined || formSource.trim() === "") {
    reasons.push("review-draft record needs --form <json|->: a parked review is a typed form");
  }
  const why = values["why"];
  if (why === undefined || why.trim() === "") {
    reasons.push("review-draft record needs --why <text>: the line the owner's queue shows before they open the card");
  }
  if (
    owner === undefined ||
    repo === undefined ||
    formSource === undefined ||
    why === undefined ||
    reasons.length > 0
  ) {
    return err(GithubVerbErrors.argumentsRefused({ reasons }));
  }
  return ok({ formSource, mode: "record", number, owner, repo, why, ...shared });
}

/**
 * Every reason the target pull request cannot take this review — checked at record, and again at post.
 *
 * @param target the pull request as GitHub reads it now
 * @param viewerId the token's own account id
 * @returns one sentence per refusal, empty when it can
 */
export function targetRefusals({ target, viewerId }: { target: ReviewTarget; viewerId: number }): readonly string[] {
  const refusals: string[] = [];
  if (target.merged) {
    refusals.push("the pull request is already merged");
  } else if (target.state !== "open") {
    refusals.push(`the pull request is ${target.state}`);
  }
  if (target.authorId === undefined) {
    refusals.push("GitHub named no author for the pull request, so it cannot be shown to be somebody else's");
  } else if (target.authorId === viewerId) {
    refusals.push(
      "this is the token's own pull request — a review draft is for somebody else's; your own gets a self-review walkthrough",
    );
  }
  return refusals;
}

/**
 * Anchor every comment against the diff and capture its hunk, or refuse every comment GitHub would refuse.
 *
 * @param form the decoded form
 * @param files the pull request's patches at the head being reviewed
 * @returns the anchored comments, or one sentence per refused anchor
 */
export function anchoredComments({
  form,
  files,
}: {
  form: ReviewDraftForm;
  files: readonly PullRequestDiffFile[];
}): GithubVerbResult<readonly ReviewDraftComment[]> {
  const refusals = reviewAnchorRefusals({ anchors: form.comments, files });
  if (refusals.length > 0) {
    return err(GithubVerbErrors.argumentsRefused({ reasons: refusals }));
  }
  const patches = new Map(files.map((file) => [file.path, file.patch]));
  return ok(
    form.comments.map((comment) => {
      // Every anchor landed above, so every path has a patch; the guard is for the type, not a fallback.
      const patch = patches.get(comment.path);
      return { ...comment, hunk: patch === undefined ? [] : hunkExcerpt({ anchor: comment, patch }) };
    }),
  );
}

/**
 * Every reason a parked review cannot be posted NOW: the pull request moved on, or the diff under a comment is
 * no longer what the card showed the owner.
 *
 * @param draft the stored row
 * @param target the pull request as GitHub reads it now
 * @param viewerId the token's own account id
 * @param files the pull request's patches now
 * @returns one sentence per refusal, empty when it can be posted
 */
export function postRefusals({
  draft,
  target,
  viewerId,
  files,
}: {
  draft: ParkedReviewDraft;
  target: ReviewTarget;
  viewerId: number;
  files: readonly PullRequestDiffFile[];
}): readonly string[] {
  const refusals = [...targetRefusals({ target, viewerId })];
  if (target.headSha !== draft.headSha) {
    refusals.push(
      `the pull request's head moved from ${draft.headSha.slice(0, 10)} to ${target.headSha.slice(0, 10)} since ` +
        "this review was recorded — review the new commits and record it again",
    );
    return refusals;
  }
  const anchored = anchoredComments({ files, form: draft });
  if (anchored.isErr()) {
    return [...refusals, ...githubVerbErrorLines({ error: anchored.error })];
  }
  anchored.value.forEach((comment, index) => {
    if (JSON.stringify(comment.hunk) !== JSON.stringify(draft.comments[index]?.hunk)) {
      refusals.push(
        `${comment.path}:${String(comment.line)}: the diff around this comment is not what the card showed ` +
          "(the base branch moved) — record the review again",
      );
    }
  });
  return refusals;
}

/**
 * The door record for one review post: prose-free, so the ledger names what was sent without holding it.
 *
 * @param home the state home whose ledger records the effect
 * @param draft the row being posted
 * @returns the request, declaring the approval its gate enforces
 */
export function reviewDraftDoorRequest({ home, draft }: { home: string; draft: ParkedReviewDraft }): DoorRequest {
  return {
    action: { kind: "verb", noun: "github", verb: "review-draft post" },
    artifact: {
      comments: draft.comments.length,
      digest: draft.digest,
      headSha: draft.headSha,
      id: draft.id,
      number: draft.number,
      repo: draft.repo,
      verdict: draft.verdict,
    },
    meta: { createsWorkItem: false, effect: "external-write", home, requiresApproval: true },
  };
}

/**
 * The command the owner's yes turns into —the one line the card, `record` and `show` all print.
 *
 * @param id the draft
 * @param digest the digest the owner's approval binds
 * @returns the command
 */
export function reviewPostCommand({ id, digest }: { id: string; digest: string }): string {
  return `slopweaver github review-draft post ${id} --approve ${digest}`;
}

/**
 * What GitHub calls the state a verdict submits, for the readback.
 *
 * @param verdict the review event
 * @returns the review `state` GitHub reports once it is submitted
 */
export function submittedStateOf({ verdict }: { verdict: ReviewVerdict }): string {
  if (verdict === "APPROVE") {
    return "APPROVED";
  }
  return verdict === "COMMENT" ? "COMMENTED" : "CHANGES_REQUESTED";
}
