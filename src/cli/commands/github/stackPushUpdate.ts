/**
 * What `github stack push` writes when the branch already has an open pull request: an UPDATE of that pull request,
 * through the same gates and the same mutation `github pr update --form` uses, never a second create.
 *
 * Re-run on a branch whose pull request is open, a stack push used to amend, push, and then end at the create's
 * duplicate refusal, so the title, body and walkthrough it was given never reached the pull request. The open pull
 * request is now the write's target: before the lock and the push, `stackPushReviewedWrite` picks the create or the
 * update and asks the description review over its exact bytes, and for an update `stackPushUpdatePreflight` first
 * applies `pr update`'s authorship rule, its whole-form choice and render, and its two consent steps (settled
 * evidence, then the wholesale-replacement key); after the push, `./stackPushSend.ts` hands the result to
 * `./performWrite.ts`'s `performUpdate`, with only the expected head advanced to the commit the push just landed.
 */
import { err, ok, type Result } from "#lib/result.js";

import type { GithubWriteApi, WrittenPr } from "../../../corpus/github/write.js";
import type { InstallationIdentifiers } from "../../../hygiene/installationIdentifiers.js";
import { renderSelfReviewComments, type SelfReviewForm } from "../../../outbound/github/selfReview.js";
import type { PrForm, PrFormDraft } from "../../../outbound/github/types.js";
import { EXIT_ERROR } from "../../exitCodes.js";
import { resolveAndAuthorise } from "./addressRun.js";
import type { DescriptionWrite } from "./descriptionReviewCheck.js";
import type { GithubPrDeps } from "./prDeps.js";
import type { DescriptionPullRequest } from "./prDescriptionReviewCore.js";
import { previewCreateBody, writeGates } from "./prRenderGate.js";
import type { GatedStackPushPlan } from "./stackPushCore.js";
import { type GithubStackPushDeps, toGithubPrDeps } from "./stackPushDeps.js";
import { chooseUpdate } from "./updateChoice.js";
import { consentStops } from "./updateConsent.js";
import { previewedUpdate } from "./updatePreview.js";

/** Which mutation the locked write performs: a create on a branch with no open pull request, else its update. */
export type StackPushWrite =
  | { readonly kind: "create" }
  | {
      readonly kind: "update";
      /** The whole form as `pr update --form` would send it, its draft flag and target taken from the live pull request. */
      readonly draft: PrFormDraft;
      /** The pull request as read and authorised before the push: the snapshot the door's re-read is compared with. */
      readonly previewed: WrittenPr;
    };

/** An update that passed every gate before the push, and the exact bytes its early description review covers. */
interface StackPushUpdateReady {
  readonly write: Extract<StackPushWrite, { readonly kind: "update" }>;
  /** The body the PATCH sends, rendered exactly as the door will render it again. */
  readonly body: string;
  /** The stamped form those bytes render from. */
  readonly form: PrForm;
}

/**
 * The pre-push snapshot of the pull request, with only its head moved to the commit this push just put on the remote.
 *
 * `performUpdate` re-reads the pull request immediately before the PATCH and refuses when any field moved since the
 * snapshot it was given. The snapshot was taken BEFORE the push, so handed over as it is, the push's own new head
 * would read as somebody else's force-push and refuse every update. Every other field stays the snapshot's, so a
 * description, title, author, state, draft or base change in the window is still refused.
 *
 * @param previewed the pull request as read and authorised before the push
 * @param pushedHeadSha the commit the push landed on the branch
 * @returns the snapshot the door's re-read is compared with
 */
export function previewedAfterStackPush({
  previewed,
  pushedHeadSha,
}: {
  previewed: WrittenPr;
  pushedHeadSha: string;
}): WrittenPr {
  return { ...previewed, head: { ...previewed.head, sha: pushedHeadSha } };
}

/**
 * Every refusal an update of the branch's open pull request owes before anything is amended or pushed, in `pr
 * update`'s order: authorship, the whole-form choice, the render and its gates, then the two consent steps. Each
 * refusal is printed here; nothing is written.
 *
 * @param api the write API the authorship read goes through
 * @param deps `pr update`'s edges: the environment the overrides are read from, the clock and the output sink
 * @param home the state home whose ledger, board and grant journal the gates read
 * @param installationIdentifiers the installation's own identifiers, read once for the whole push
 * @param number the open pull request the branch's one read found
 * @param draft the gate-checked, linkified form the push was given
 * @param selfReviewRequested whether the push posts a walkthrough, which holds authorship to strict self-authorship
 * @returns the update and the bytes its review covers, or the exit code once a refusal is printed
 */
async function stackPushUpdatePreflight({
  api,
  deps,
  draft,
  home,
  installationIdentifiers,
  number,
  selfReviewRequested,
}: {
  api: GithubWriteApi;
  deps: GithubPrDeps;
  draft: PrFormDraft;
  home: string;
  installationIdentifiers: InstallationIdentifiers | undefined;
  number: number;
  selfReviewRequested: boolean;
}): Promise<Result<StackPushUpdateReady, number>> {
  const { owner, repo } = draft.target;
  const address = { kind: "number", number, owner, repo } as const;
  const admitted = await resolveAndAuthorise({ address, api, deps, home, selfReviewRequested });
  if ("reason" in admitted) {
    deps.out({ line: `refused: ${admitted.reason}` });
    return err(EXIT_ERROR);
  }
  const { live } = admitted;
  const chosen = chooseUpdate({ home, input: { form: draft, kind: "form" }, live });
  if ("reason" in chosen) {
    deps.out({ line: `refused: ${chosen.reason}` });
    return err(EXIT_ERROR);
  }
  const gates = { ...writeGates({ home }), installationIdentifiers };
  const preview = previewedUpdate({ chosen, ...gates, draft: chosen.draft, live, today: deps.now() });
  if (preview.kind === "refused") {
    deps.out({ line: `refused: ${preview.reason}` });
    return err(EXIT_ERROR);
  }
  for (const line of [...chosen.notices, ...preview.notices]) {
    deps.out({ line });
  }
  const { body, form } = preview;
  if (consentStops({ args: { dryRun: false }, body, deps, form, home, live, wholesale: chosen.wholesale })) {
    return err(EXIT_ERROR);
  }
  const write: StackPushUpdateReady["write"] = { draft: chosen.draft, kind: "update", previewed: live };
  return ok({ body, form, write });
}

/**
 * Which mutation the locked write performs, decided before the lock and the push, once a CLEAN description review
 * covers the exact bytes it sends.
 *
 * No open pull request: a create, whose body the early review covers when the gates accept it; a body they refuse is
 * left to the create, which prints their lines. An open one: an update of THAT pull request, through every gate `pr
 * update --form` applies, so a refusal there costs no push. The create and the update each ask the review again
 * immediately before their mutation; this earlier ask is what keeps a missing review from costing a pushed branch
 * and a hosted CI run.
 *
 * @param api the client the open pull request was read through
 * @param pullRequest the branch's open pull request, or `new`, as the one read resolved it; the write asks about the
 *   same one, so a single review covers both
 * @returns the write, or the exit code once a refusal is printed
 */
export async function stackPushReviewedWrite({
  api,
  deps,
  home,
  plan,
  pullRequest,
  selfReview,
}: {
  api: GithubWriteApi;
  deps: GithubStackPushDeps;
  home: string;
  plan: GatedStackPushPlan;
  pullRequest: DescriptionPullRequest;
  selfReview: SelfReviewForm | undefined;
}): Promise<Result<StackPushWrite, number>> {
  const { form, installationIdentifiers } = plan;
  let outgoing: { readonly body: string; readonly form: DescriptionWrite["form"] } | undefined;
  let write: StackPushWrite = { kind: "create" };
  if (pullRequest.kind === "new") {
    const rendered = previewCreateBody({ draft: form, home, installationIdentifiers, now: deps.now });
    outgoing = rendered.ok ? { body: rendered.body, form } : undefined;
  } else {
    // `pr update`'s gates read the environment for their overrides, which the create's adapter leaves unset.
    const ready = await stackPushUpdatePreflight({
      api,
      deps: { ...toGithubPrDeps({ deps, out: deps.out }), env: deps.env },
      draft: form,
      home,
      installationIdentifiers,
      number: pullRequest.number,
      selfReviewRequested: selfReview !== undefined,
    });
    if (!ready.isOk()) {
      return err(ready.error);
    }
    outgoing = { body: ready.value.body, form: ready.value.form };
    write = ready.value.write;
  }
  if (outgoing === undefined) {
    return ok(write);
  }
  const verdict = await deps.descriptionReview({
    body: outgoing.body,
    comments: renderSelfReviewComments({ form: selfReview }),
    form: outgoing.form,
    headRef: "HEAD",
    home,
    pullRequest,
    repoDir: plan.facts.repoRoot,
  });
  if (verdict.kind === "clear") {
    return ok(write);
  }
  deps.out({ line: "refused: no CLEAN description review covers this pull request's description" });
  for (const line of verdict.lines) {
    deps.out({ line });
  }
  return err(EXIT_ERROR);
}
