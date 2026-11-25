/**
 * `slopweaver github stack push` — the effectful shell, and the ONE door that opens a pull request.
 *
 * Owner ruling: `github pr create` is refused, so everything that used to be plain create's —
 * the `--file` authoring-file input, the shape printers, the three local creation gates and the write-access
 * preflight — is reached through this verb. `./stackPushGates.ts` holds the gates themselves.
 *
 * Reuses, unchanged: `pushCore.ts`'s exact-lease push-plan builder and `githubRepoFromRemote`,
 * `prRenderGate.ts`'s `previewCreateBody` and `performCreate.ts`'s `performCreate` (stamp → reserve → create → confirm),
 * and `pushRun.ts`'s production Git deps. This file owns only what is genuinely new: the amend step, and the
 * stack registration that follows a successful create.
 *
 * The order is the contract: parse → [example prints stop here] → read the form → read git facts → pin the
 * amend tree → plan → render+gate → commit-message scan → [dry-run stops here] → local gates → token → the
 * branch's open pull request, read once (`./stackPushPullRequest.ts`) → for an open one, `pr update`'s authorship
 * and consent gates (`./stackPushUpdate.ts`) → description review → door → amend (only the pinned tree) → push →
 * write preflight → create, or update the open one → register (a create only) → report.
 *
 * What an injectable EDGE is belongs to `./stackPushDeps.ts` (the file-size ratchet, step 3), including the
 * adapter that widens them for `performCreate`; this file states the order and calls them.
 * The operation lock is `./stackPushLock.ts` for the same reason (step 4) — it is the one step of the
 * sequence with two spellings, and `--wait` picks between them; that file also holds the lock across the send
 * and releases it.
 * The locked write — door → amend → push → carry → write preflight → create → register → report — is
 * `./stackPushSend.ts` for the same reason (step 5); this file resolves the plan and hands it to the lock.
 */

import { err, ok, type Result } from "../../../lib/result.js";
import { parseAuthoringFile } from "../../../outbound/github/authoringFile.js";
import type { SelfReviewForm } from "../../../outbound/github/selfReview.js";
import type { PrFormDraft } from "../../../outbound/github/types.js";
import { type AboveFoldVerdict, aboveFoldLines } from "../../aboveFoldDoor.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { linkifiedPrFormOrReported } from "./bareRefFlow.js";
import { dryRunLines } from "./core.js";
import { printedExample } from "./createExamples.js";
import { GithubVerbErrors, type GithubVerbResult, githubVerbErrorLines } from "./errors.js";
import { parsePrForm } from "./prFormParse.js";
import { previewCreateBody } from "./prRenderGate.js";
import { stackPushCommitMessagesRefused } from "./pushCommitMessages.js";
import { dryRunSelfReviewLine } from "./selfReviewCore.js";
import { decodeSelfReview } from "./selfReviewFlow.js";
import { runStackCarryGate, type StackCarryGate } from "./stackCarryRun.js";
import { stackPushBodyVerdict } from "./stackPushBodyVerdict.js";
import {
  type GatedStackPushPlan,
  type GithubStackPushArgs,
  type GithubStackPushPlan,
  githubStackPushPlan,
  parseGithubStackPushArgs,
} from "./stackPushCore.js";
import {
  type GithubStackPushDeps,
  productionGithubStackPushDeps,
  withholdingGithubStackPushDescriptionWriters,
} from "./stackPushDeps.js";
import { stackPushLocalGatesRefused } from "./stackPushGates.js";
import { resolveStackPushFacts } from "./stackPushGit.js";
import { sendUnderStackPushLock } from "./stackPushLock.js";
import { resolveStackPushPullRequest } from "./stackPushPullRequest.js";
import { type StackPushWrite, stackPushReviewedWrite } from "./stackPushUpdate.js";

const VERB_ARG_OFFSET = 5; // node, cli, "github", "stack", "push"

/** The parsed invocation and the deps it runs against — what each pre-Git resolution step reads. */
interface StackPushInvocation {
  readonly args: GithubStackPushArgs;
  readonly deps: GithubStackPushDeps;
}

/** What resolving args, the form, live facts and the plan produced. */
type ResolvedStackPush = Result<
  {
    readonly aboveFold: AboveFoldVerdict;
    readonly args: GithubStackPushArgs;
    readonly home: string;
    readonly plan: GatedStackPushPlan;
    readonly selfReview: SelfReviewForm | undefined;
  },
  number
>;

/** Parse the optional reviewer walkthrough with the operator's exact voice rules, or the exit code once refused. */
function resolveStackSelfReview({
  deps,
  home,
  source,
}: {
  deps: GithubStackPushDeps;
  home: string;
  source: string | undefined;
}): Result<SelfReviewForm | undefined, number> {
  if (source === undefined) {
    return ok(undefined);
  }
  return decodeSelfReview({
    home,
    nothingHappened: "nothing was pushed, no pull request was opened and no review was posted.",
    out: deps.out,
    readRaw: () => deps.readForm({ source }),
  });
}

/**
 * Decode the description input, whichever of the two shapes the caller used.
 *
 * `--form`'s source IS the JSON text; `--file`'s source is a PATH. They read through different deps for that
 * reason, and this is the one place the two modes converge on a single `PrFormDraft`.
 *
 * @param args the parsed invocation, naming exactly one description input
 * @param deps the two readers
 * @returns the validated draft, or every violation
 */
function readStackPushForm({ args, deps }: StackPushInvocation): GithubVerbResult<PrFormDraft> {
  if (args.fileSource !== undefined) {
    return parseAuthoringFile({ source: deps.readFileSource({ source: args.fileSource }) })
      .map(({ form }) => form)
      .mapErr((reasons) => GithubVerbErrors.formInvalid({ form: "--file", reasons }));
  }
  const formSource = args.formSource;
  if (formSource === undefined) {
    return err(GithubVerbErrors.stackPushFormMissing());
  }
  return parsePrForm({ raw: deps.readForm({ source: formSource }) });
}

/**
 * Decode the form and resolve every bare reference in it — everything before a single Git fact is read.
 *
 * @param args the parsed invocation
 * @param deps the two readers and the output sink
 * @param home the state home the invocation resolved, whose grant journal decides the bare-reference hatch
 * @returns the linkified draft, or the exit code once its refusal has been printed
 */
function resolveStackPushForm({
  args,
  deps,
  home,
}: StackPushInvocation & { readonly home: string }): Result<PrFormDraft, number> {
  const formParse = readStackPushForm({ args, deps });
  if (!formParse.isOk()) {
    for (const line of githubVerbErrorLines({ error: formParse.error })) deps.out({ line });
    return err(EXIT_USAGE);
  }
  // Resolve every bare PR number, owner/repo#N and issue key into a real link before anything renders, then refuse whatever
  // still can't resolve — the same ruling `pr update` enforces via ./bareRefFlow.ts. A stacked
  // pull request is built from the same PrFormDraft shape, so it gets the same gate.
  const linkified = linkifiedPrFormOrReported({ deps, form: formParse.value, home });
  return linkified === undefined ? err(EXIT_ERROR) : ok(linkified);
}

/** Parse → read the form → measure live facts → plan → render+gate, reporting any refusal as it goes. */
async function resolveStackPushPlan({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: GithubStackPushDeps;
}): Promise<ResolvedStackPush> {
  const parsed = parseGithubStackPushArgs({ argv: argv.slice(VERB_ARG_OFFSET) });
  if (parsed.isErr()) {
    for (const line of parsed.error) deps.out({ line });
    return err(EXIT_USAGE);
  }
  const args = parsed.value;
  // Before anything else: the two "show me the shape" flags answer what `--form`/`--file` want, and must
  // never touch git, a token or the network to do it.
  if (printedExample({ args, deps })) {
    return err(EXIT_OK);
  }
  const home = resolveHome({ named: args.home });
  const form = resolveStackPushForm({ args, deps, home });
  if (!form.isOk()) {
    return err(form.error);
  }
  const selfReview = resolveStackSelfReview({ deps, home, source: args.selfReviewSource });
  if (!selfReview.isOk()) {
    return err(selfReview.error);
  }
  const facts = resolveStackPushFacts({ args, deps });
  if (facts === undefined) {
    return err(EXIT_ERROR);
  }
  const planned = githubStackPushPlan({ facts, form: form.value });
  if (planned.isErr()) {
    deps.out({ line: `refused: ${planned.error.message}` });
    return err(EXIT_ERROR);
  }
  const verdict = await stackPushBodyVerdict({ args, deps, form: form.value, home });
  if (!verdict.isOk()) {
    return err(verdict.error);
  }
  const { aboveFold, installationIdentifiers } = verdict.value;
  // Every commit message this push publishes crosses the publication scan before the dry-run stop.
  const messages = { deps: { out: deps.out, readGit: deps.git.readGit }, facts, home, installationIdentifiers };
  if (stackPushCommitMessagesRefused({ ...messages, remote: args.remote })) {
    return err(EXIT_ERROR);
  }
  const plan = { ...planned.value, installationIdentifiers };
  return ok({ aboveFold, args, home, plan, selfReview: selfReview.value });
}

/**
 * Ask the shared carry gate what this stack push owes the entries above the branch it is about to amend.
 *
 * `stack push` amends and force-pushes the checked-out branch before it creates anything, so re-running it
 * on a branch that is ALREADY a mid-stack entry rewrites the base of everything above it — the same shape
 * `github push` produces on a mid-stack pull request. The gate runs before the amend, including under `--dry-run`.
 *
 * @param plan the gate-checked push plan, naming the branch and repository to ask about
 * @returns the gate's verdict, its lines already printed
 */
async function stackPushCarryGate({
  args,
  deps,
  home,
  plan,
}: {
  args: GithubStackPushArgs;
  deps: GithubStackPushDeps;
  home: string;
  plan: GithubStackPushPlan;
}): Promise<StackCarryGate> {
  const carry = deps.git.stackCarry;
  if (carry === undefined) {
    return { kind: "clear" };
  }
  return runStackCarryGate({
    out: deps.out,
    request: {
      branch: plan.facts.branch,
      carry,
      defaultBranch: plan.facts.defaultBranch,
      git: deps.git,
      home,
      orphanAbove: args.orphanAbove,
      remote: args.remote,
      repo: plan.facts.repo,
      repoRoot: plan.facts.repoRoot,
    },
  });
}

/**
 * `stack push --dry-run`'s own report: the exact body bytes, the real validator's verdict, the above-the-fold
 * reading, and the self-review preview.
 *
 * The bytes are printed AFTER the bare-reference gate has already run in `resolveStackPushPlan` above, so a bare
 * PR number in the form shows up here already linkified.
 *
 * @param deps the output sink and the environment reader the above-fold override needs
 * @param home the state home whose private hygiene denylist the secret scan reads
 * @param plan the gate-checked plan whose form would be sent
 * @param selfReview the decoded walkthrough, when one was passed
 * @returns the process exit code
 */
function printStackPushDryRun({
  aboveFold,
  deps,
  home,
  plan,
  selfReview,
}: {
  aboveFold: AboveFoldVerdict;
  deps: GithubStackPushDeps;
  home: string;
  plan: GatedStackPushPlan;
  selfReview: SelfReviewForm | undefined;
}): number {
  const { form, installationIdentifiers } = plan;
  const rendered = previewCreateBody({ draft: form, home, installationIdentifiers, now: deps.now });
  for (const line of dryRunLines({ body: rendered.body, form: plan.form, validation: rendered })) {
    deps.out({ line });
  }
  for (const line of aboveFoldLines({ verdict: aboveFold })) {
    deps.out({ line });
  }
  deps.out({ line: dryRunSelfReviewLine({ comments: selfReview?.comments.length, repoSlug: plan.facts.repo }) });
  deps.out({ line: "dry run: no git add/amend, no door record, no push, no create, no network." });
  return rendered.ok && aboveFold.refusals.length === 0 ? EXIT_OK : EXIT_ERROR;
}

/**
 * The local gates, the token, the one read of the branch's open pull request, an update's own gates, then the
 * description review: every refusal that must come before the lock and the push. The read answers which pull request
 * BOTH reviews describe, and whether the write creates one or updates it.
 *
 * @returns the token and the write, or the exit code once a refusal has been printed
 */
async function stackPushPreSend({
  args,
  deps,
  home,
  plan,
  selfReview,
}: {
  args: GithubStackPushArgs;
  deps: GithubStackPushDeps;
  home: string;
  plan: GatedStackPushPlan;
  selfReview: SelfReviewForm | undefined;
}): Promise<Result<{ readonly token: string; readonly write: StackPushWrite }, number>> {
  if (await stackPushLocalGatesRefused({ args, deps, home, target: plan.form.target })) {
    return err(EXIT_ERROR);
  }
  const token = deps.token({ home });
  if (token === undefined) {
    deps.out({ line: "refused: no GitHub token resolved ($SLOPWEAVER_HOME/secrets/github-token, or gh auth token)" });
    return err(EXIT_ERROR);
  }
  const api = deps.makeApi({ home, token });
  const pullRequest = await resolveStackPushPullRequest({ api, plan });
  if (!pullRequest.isOk()) {
    deps.out({ line: `refused: ${pullRequest.error.message}` });
    return err(EXIT_ERROR);
  }
  const write = await stackPushReviewedWrite({ api, deps, home, plan, pullRequest: pullRequest.value, selfReview });
  return write.map((decided) => ({ token, write: decided }));
}

/**
 * Run one governed stack push.
 *
 * @param argv the full process argv; this verb's arguments begin after node, CLI, noun, "stack" and "push"
 * @param deps injectable Git, form, API, clock and output edges
 * @returns the process exit code
 */
export async function runGithubStackPush({
  argv,
  deps: given = productionGithubStackPushDeps(),
}: {
  argv: readonly string[];
  deps?: GithubStackPushDeps;
}): Promise<number> {
  // Every line this push prints is the description door's, so both writers withhold a credential-shaped line from
  // here on — by construction, not at each exit (`withholdingGithubStackPushDescriptionWriters`).
  const deps = withholdingGithubStackPushDescriptionWriters({ deps: given });
  const resolved = await resolveStackPushPlan({ argv, deps });
  if (!resolved.isOk()) {
    return resolved.error;
  }
  const { aboveFold, args, home, plan, selfReview } = resolved.value;
  deps.out({ line: `would push ${plan.form.target.head} onto ${plan.form.target.base} in ${plan.facts.repo}` });
  const carry = await stackPushCarryGate({ args, deps, home, plan });
  if (carry.kind === "refused") {
    return EXIT_ERROR;
  }
  if (args.dryRun) {
    return printStackPushDryRun({ aboveFold, deps, home, plan, selfReview });
  }
  const preSend = await stackPushPreSend({ args, deps, home, plan, selfReview });
  if (!preSend.isOk()) {
    return preSend.error;
  }
  const { token, write } = preSend.value;
  // The write preflight is NOT here. It runs inside `performStackPush`, after the push — see that function's own
  // doc: a socket an earlier GET (the open pull request read above) left idle dies during the push, and the
  // retryable preflight GET, run immediately before the never-retried create POST or update PATCH, is what absorbs it.
  return sendUnderStackPushLock({ args, carry, deps, home, plan, selfReview, token, write });
}
