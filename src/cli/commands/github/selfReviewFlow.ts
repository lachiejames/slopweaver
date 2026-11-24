/**
 * Decoding and posting the optional self-review round that rides along with `pr update`.
 *
 * Split out of `run.ts` to keep that file under this repo's own line ceiling. `stack push` — the creation
 * door — decodes its own round in `./stackPushRun.ts` and posts it in
 * `./stackPushSend.ts`, because it has no `GithubPrArgs` and no pull-request number to preview against.
 */
import type { GithubWriteApi, WrittenPr } from "../../../corpus/github/write.js";
import { privateTermsOrRefusal } from "../../../hygiene/privateTerms.js";
import { loadDenylistResult, unreadableDenylistMessage } from "../../../hygiene/scan.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { readPrRecord } from "../../../outbound/github/prLedger.js";
import { recoverPrForm } from "../../../outbound/github/recovery.js";
import { renderSelfReviewComments, type SelfReviewForm } from "../../../outbound/github/selfReview.js";
import { readExactVoiceRules } from "../../../profileStore.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { liveLocusFor, liveTargetFor } from "./addressRun.js";
import type { GithubPrArgs } from "./core.js";
import { githubVerbErrorLines } from "./errors.js";
import type { GithubPrDeps } from "./prDeps.js";
import { parseSelfReviewForm } from "./selfReviewCore.js";
import { selfReviewOutcomeLines } from "./selfReviewOutcome.js";
import { sendSelfReviewRound } from "./selfReviewRun.js";
import { updateHeadRefusal } from "./updateCore.js";

/**
 * Decode a review round against the operator's exact voice rules and the publication scan, refusing a profile,
 * a denylist or private terms that cannot be trusted.
 *
 * The one decoder `pr update`, `push` and `stack push` share. The rules are read before the form, because a
 * round judged against a corrupt profile's empty list would post every word the owner bans. That refusal exits 1, a
 * fact about the install. A form that does not parse exits 2, a bad invocation, as it always has.
 *
 * @param home the state home the owner's voice profile is read from
 * @param readRaw reads the form's text, called only once the profile is trusted
 * @param nothingHappened the sentence the refusal ends on, naming what the verb left undone
 * @returns the decoded form, or the exit code once the refusal is printed
 */
export function decodeSelfReview({
  home,
  nothingHappened,
  out,
  readRaw,
}: {
  home: string;
  nothingHappened: string;
  out: (args: { line: string }) => void;
  readRaw: () => string;
}): Result<SelfReviewForm, number> {
  const rules = readExactVoiceRules({ home });
  if (rules.isErr()) {
    out({ line: `refused: ${rules.error.message}. ${nothingHappened}` });
    return err(EXIT_ERROR);
  }
  // The publication scan's hygiene half reads the same private denylist the description gate does. One that
  // exists and cannot be read refuses, for the reason the profile above does: scanning with an empty list would
  // pass this install's own secret strings.
  const denylist = loadDenylistResult({ home });
  if (denylist.kind === "unreadable") {
    out({ line: `refused: ${unreadableDenylistMessage({ load: denylist })} ${nothingHappened}` });
    return err(EXIT_ERROR);
  }
  // Private terms refuse on anything but a load, absence included: a fact about the install, so exit 1.
  const privateTerms = privateTermsOrRefusal({ home });
  if (privateTerms.isErr()) {
    out({ line: `refused: ${privateTerms.error} ${nothingHappened}` });
    return err(EXIT_ERROR);
  }
  const parsed = parseSelfReviewForm({
    denylist: denylist.kind === "absent" ? [] : denylist.lines,
    exactVoiceRules: rules.value,
    privateTerms: privateTerms.value,
    raw: readRaw(),
  });
  if (parsed.isErr()) {
    for (const line of githubVerbErrorLines({ error: parsed.error })) {
      out({ line });
    }
    return err(EXIT_USAGE);
  }
  return ok(parsed.value);
}

/**
 * Parse the optional review round with the same private exact rules as owner-authored Slack prose.
 *
 * @param args the parsed CLI arguments, naming the optional self-review source
 * @param deps the injectable form reader, profile home and output sink
 * @param home the state home the owner's voice profile is read from
 * @returns the decoded form (or `undefined` when none was requested), or the exit code once its refusal is printed
 */
export function resolveSelfReview({
  args,
  deps,
  home,
}: {
  args: GithubPrArgs;
  deps: GithubPrDeps;
  home: string;
}): Result<SelfReviewForm | undefined, number> {
  const source = args.selfReviewSource;
  if (source === undefined) {
    return ok(undefined);
  }
  return decodeSelfReview({
    home,
    nothingHappened: "nothing was updated and no review was posted.",
    out: deps.out,
    readRaw: () => deps.readForm({ source }),
  });
}

/**
 * Dry-run proof that the optional walkthrough was parsed without claiming it was posted.
 *
 * The pull request always already exists here: this rides `pr update`, and the create-side preview is
 * `stack push`'s own, which has no number to name yet.
 *
 * @param form the decoded self-review form
 * @param deps the output sink
 * @param number the pull request number the round would be posted against
 * @returns nothing
 */
export function previewSelfReview({
  form,
  deps,
  number,
}: {
  form: SelfReviewForm;
  deps: GithubPrDeps;
  number: number;
}): void {
  deps.out({
    line: `would post ${String(form.comments.length)} inline self-review comment(s) on #${String(number)}`,
  });
}

/**
 * Whether a CLEAN description review covers this round beside the live description and every comment already on
 * the pull request. A round posted without a description change is the comment-only write, and it answers to the
 * same review: the description is recovered from the live body exactly as a partial `--edit` recovers it.
 *
 * @returns undefined when the round may be posted, else the refusal lines
 */
async function roundReviewRefusal({
  deps,
  form,
  home,
  pr,
}: {
  deps: Pick<GithubPrDeps, "cwd" | "descriptionReview">;
  form: SelfReviewForm;
  home: string;
  pr: WrittenPr;
}): Promise<readonly string[] | undefined> {
  const liveBody = pr.body;
  if (liveBody === undefined) {
    return ["self-review refused: the round answers to the live description, and the pull request carries none"];
  }
  const recovered = recoverPrForm({
    live: { draft: pr.draft, target: liveTargetFor({ pr }), title: pr.title },
    liveBody,
    number: pr.number,
    record: readPrRecord({ home, locus: liveLocusFor({ pr }) }),
  });
  if (recovered.kind === "refused") {
    return [
      `self-review refused: the round answers to the live description, which cannot be read back: ${recovered.reason}`,
    ];
  }
  const verdict = await deps.descriptionReview({
    body: liveBody,
    comments: renderSelfReviewComments({ form }),
    form: recovered.form,
    headRef: pr.head.sha,
    home,
    pullRequest: { kind: "existing", number: pr.number },
    repoDir: deps.cwd(),
  });
  if (verdict.kind === "clear") {
    return undefined;
  }
  return [
    "self-review refused: no CLEAN description review covers this round beside the live description",
    ...verdict.lines,
  ];
}

/**
 * Re-read the current head, post the round, and report only a confirmed outcome as success.
 *
 * @param api the write API
 * @param deps the output sink
 * @param home the state home the review's own ledger lives under
 * @param form the decoded self-review form
 * @param owner the repository owner
 * @param repo the repository name
 * @param number the pull request number to post against
 * @param expectHead the head the caller derived its update at, refused when the head this reads differs
 * @returns the process exit code
 */
export async function postSelfReview({
  api,
  deps,
  home,
  form,
  owner,
  repo,
  number,
  expectHead,
}: {
  api: GithubWriteApi;
  deps: GithubPrDeps;
  home: string;
  form: SelfReviewForm;
  owner: string;
  repo: string;
  number: number;
  expectHead?: string | undefined;
}): Promise<number> {
  const current = await api.getPr({ number, owner, repo });
  if (current.isErr()) {
    deps.out({
      line: `self-review refused: could not read #${String(number)} at its current head: ${current.error.message}`,
    });
    return EXIT_ERROR;
  }
  // The round is posted against THIS read's head, so `--expect-head` is checked here too, not only at admission.
  const headRefusal = updateHeadRefusal({ expectHead, headSha: current.value.head.sha, number });
  if (headRefusal !== undefined) {
    deps.out({ line: `self-review refused: ${headRefusal}` });
    return EXIT_ERROR;
  }
  const unreviewed = await roundReviewRefusal({ deps, form, home, pr: current.value });
  if (unreviewed !== undefined) {
    for (const line of unreviewed) {
      deps.out({ line });
    }
    return EXIT_ERROR;
  }
  return sendAndReportSelfReview({ api, command: "slopweaver github pr update", deps, form, home, pr: current.value });
}

/**
 * Post one self-review round against a pull request already read at its current head, print its outcome, and
 * answer success only for a confirmed post. Shared by `pr update` and `stack push`.
 *
 * @param pr the pull request as just read, whose head the round is posted against
 * @param deps the door ledger the round's write is recorded through, the clock and the output sink
 * @param command the invocation carrying the round, as the owner would type it, which a door refusal names
 * @returns the process exit code
 */
export async function sendAndReportSelfReview({
  api,
  command,
  deps,
  form,
  home,
  pr,
}: {
  api: GithubWriteApi;
  command: string;
  deps: Pick<GithubPrDeps, "doorLedger" | "now" | "out">;
  form: SelfReviewForm;
  home: string;
  pr: WrittenPr;
}): Promise<number> {
  const outcome = await sendSelfReviewRound({
    api,
    form,
    home,
    ledger: deps.doorLedger,
    nowIso: deps.now().toISOString(),
    pr,
  });
  for (const line of selfReviewOutcomeLines({ command, outcome })) {
    deps.out({ line });
  }
  return outcome.kind === "posted" ? EXIT_OK : EXIT_ERROR;
}
