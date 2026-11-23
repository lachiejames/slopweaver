/**
 * `github review-draft record` — read the pull request, anchor every comment, park the review under an id nothing
 * else holds. Sends nothing.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import {
  type ParkedReviewDraft,
  type ReviewDraftComment,
  reviewDraftDigest,
} from "../../../outbound/github/reviewDraft.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { githubVerbErrorLines } from "./errors.js";
import {
  anchoredComments,
  type ReviewDraftRecordOptions,
  reviewPostCommand,
  targetRefusals,
} from "./reviewDraftCore.js";
import {
  diagnose,
  type GithubReviewDraftDeps,
  loadReviewDrafts,
  type PullRequestNow,
  readPullRequestNow,
  reviewDraftApiFor,
  reviewDraftConsoleUrl,
  withReviewDraftLock,
} from "./reviewDraftDeps.js";
import { parseReviewDraftForm, type ReviewDraftForm } from "./reviewDraftForm.js";

/** Read the form from its flag or stdin and judge it, or the exit code once its refusal is printed. */
async function formFor({
  deps,
  options,
}: {
  deps: GithubReviewDraftDeps;
  options: ReviewDraftRecordOptions;
}): Promise<Result<ReviewDraftForm, number>> {
  const rules = deps.exactVoiceRules({ home: options.home });
  if (rules.isErr()) {
    deps.writeDiagnostic(`refused: ${rules.error.message}. Nothing was parked.`);
    return err(EXIT_ERROR);
  }
  const raw = options.formSource === "-" ? await deps.readStdin() : options.formSource;
  const form = parseReviewDraftForm({ exactVoiceRules: rules.value, raw });
  if (form.isErr()) {
    diagnose({ deps, lines: githubVerbErrorLines({ error: form.error }) });
    return err(EXIT_USAGE);
  }
  return ok(form.value);
}

/** Every comment anchored on the pull request as it stands, or the exit code once a refusal is printed. */
function commentsFor({
  deps,
  form,
  now,
}: {
  deps: GithubReviewDraftDeps;
  form: ReviewDraftForm;
  now: PullRequestNow;
}): Result<readonly ReviewDraftComment[], number> {
  const refused = targetRefusals({ target: now.target, viewerId: now.viewerId });
  if (refused.length > 0) {
    diagnose({ deps, lines: [...refused, "Nothing was parked."] });
    return err(EXIT_ERROR);
  }
  const comments = anchoredComments({ files: now.files, form });
  if (comments.isErr()) {
    diagnose({ deps, lines: [...githubVerbErrorLines({ error: comments.error }), "Nothing was parked."] });
    return err(EXIT_USAGE);
  }
  return ok(comments.value);
}

/** The row `record` parks, its digest bound to exactly what would be posted. */
function parkedDraft({
  deps,
  options,
  form,
  comments,
  now,
}: {
  deps: GithubReviewDraftDeps;
  options: ReviewDraftRecordOptions;
  form: ReviewDraftForm;
  comments: readonly ReviewDraftComment[];
  now: PullRequestNow;
}): ParkedReviewDraft {
  const bound = {
    body: form.body,
    comments,
    headSha: now.target.headSha,
    number: options.number,
    repo: `${options.owner}/${options.repo}`,
    verdict: form.verdict,
  };
  return {
    ...bound,
    author: now.target.authorLogin,
    ...(form.deeperReview === undefined ? {} : { deeperReview: form.deeperReview }),
    digest: reviewDraftDigest({ draft: bound }),
    id: deps.mintId(),
    title: now.target.title,
    tsIso: deps.nowIso(),
    url: now.target.url,
    why: options.why,
  };
}

/** Say where the parked review is and the one command the owner's yes becomes. */
function reportParked({
  deps,
  draft,
  json,
}: {
  deps: GithubReviewDraftDeps;
  draft: ParkedReviewDraft;
  json: boolean;
}): void {
  const command = reviewPostCommand({ digest: draft.digest, id: draft.id });
  const url = reviewDraftConsoleUrl({ deps, id: draft.id });
  if (json) {
    deps.out(JSON.stringify({ consoleUrl: url, digest: draft.digest, id: draft.id, post: { command } }, null, 2));
    return;
  }
  deps.out(
    `parked ${draft.id}: ${draft.verdict} on ${draft.repo}#${String(draft.number)}, ` +
      `${String(draft.comments.length)} comment(s) — nothing posted`,
  );
  deps.out(`  card: ${url}`);
  deps.out(`  on the owner's word: ${command}`);
}

/**
 * Run `record`.
 *
 * @param deps the injected world
 * @param options the parsed invocation
 * @returns the exit code
 */
export async function runReviewDraftRecord({
  deps,
  options,
}: {
  deps: GithubReviewDraftDeps;
  options: ReviewDraftRecordOptions;
}): Promise<number> {
  const api = reviewDraftApiFor({ deps, home: options.home });
  if (api.isErr()) {
    return api.error;
  }
  const form = await formFor({ deps, options });
  if (form.isErr()) {
    return form.error;
  }
  const ref = { number: options.number, owner: options.owner, repo: options.repo };
  const now = await readPullRequestNow({ api: api.value, ref });
  if (now.isErr()) {
    deps.writeDiagnostic(`could not read ${options.owner}/${options.repo}#${String(options.number)}: ${now.error}`);
    return EXIT_ERROR;
  }
  const comments = commentsFor({ deps, form: form.value, now: now.value });
  if (comments.isErr()) {
    return comments.error;
  }
  const draft = parkedDraft({ comments: comments.value, deps, form: form.value, now: now.value, options });
  return withReviewDraftLock({
    body: () => Promise.resolve(park({ deps, draft, options })),
    deps,
    home: options.home,
  });
}

/** Append the parked row under an id nothing else holds, and say where it is. */
function park({
  deps,
  draft,
  options,
}: {
  deps: GithubReviewDraftDeps;
  draft: ParkedReviewDraft;
  options: ReviewDraftRecordOptions;
}): number {
  const existing = loadReviewDrafts({ deps, home: options.home });
  if (existing.isErr()) {
    diagnose({ deps, lines: [...existing.error, "Nothing was parked."] });
    return EXIT_ERROR;
  }
  if (existing.value.some((item) => item.id === draft.id)) {
    deps.writeDiagnostic(`the minted id ${draft.id} is already in the register. Nothing was parked; record again.`);
    return EXIT_ERROR;
  }
  const appended = deps.appendEvent({
    event: { draft, id: draft.id, kind: "parked", tsIso: draft.tsIso },
    home: options.home,
  });
  if (appended.isErr()) {
    deps.writeDiagnostic(`${appended.error.message} — nothing was parked.`);
    return EXIT_ERROR;
  }
  reportParked({ deps, draft, json: options.json });
  return EXIT_OK;
}
