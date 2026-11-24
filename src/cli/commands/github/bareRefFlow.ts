/**
 * The bare-reference gate for a pull-request form, shared by `create`, `update` and `stack push`.
 *
 * Unlike Slack (`../slack/run.ts`) or Linear, a pull request's own repo is never ambiguous —
 * `form.target.owner`/`form.target.repo` name it directly — so this needs no injected context and no
 * filesystem read: the context is one field read off the form already in hand.
 *
 * That certainty about WHICH repo is exactly what once let a pull request here render three of another
 * repository's five-digit pull-request numbers as links into this one. So the context
 * also carries the numbers this body can PROVE exist in its own repo — every full GitHub link the form
 * already spells out, plus, on an update, the pull request being written to — and the resolver refuses a
 * bare number too large to be one of them. See `../../../outbound/linkify/bareRefs.ts`'s "a number that
 * CANNOT be one of this repo's own" section for why the test is magnitude rather than a second repo's
 * presence.
 */
import {
  attestedNumbersOfPrForm,
  bareRefIssuesOfPrForm,
  linkifyPrForm,
} from "../../../outbound/github/bareRefLinks.js";
import type { PrFormDraft } from "../../../outbound/github/types.js";
import type { BareRefContext } from "../../../outbound/linkify/bareRefs.js";
import { bareRefVerdictFor } from "../../bareRefDoor.js";
import type { GithubPrDeps } from "./prDeps.js";

/**
 * The only two edges this gate ever touches — the override environment variable and the refusal sink.
 *
 * Deliberately narrower than the full `GithubPrDeps`, so `stack push`'s own `GithubStackPushDeps` (which has
 * no `readFileSource`/`writeFileOut`/`measureBaseFreshness`) satisfies it directly, without a throw-stub
 * adapter standing between a real dep and the gate that reads it.
 */
type BareRefFlowDeps = Pick<GithubPrDeps, "env" | "out">;

/**
 * The bare-reference context for a pull-request write: its own repo, named directly by its target, plus every
 * number this body can prove belongs to that repo.
 *
 * `knownNumber` is the pull request being updated, when there is one. `create` and `stack push` have no
 * number yet — the pull request does not exist — so they fall back to whatever the form's own links attest,
 * and a body that links nothing numbered gets exactly the old behaviour.
 */
function bareRefContextOfForm({
  form,
  knownNumber,
}: {
  form: PrFormDraft;
  knownNumber: number | undefined;
}): BareRefContext {
  const target = { owner: form.target.owner, repo: form.target.repo };
  return {
    attested: [
      ...(knownNumber === undefined ? [] : [{ ...target, number: knownNumber }]),
      ...attestedNumbersOfPrForm({ form }),
    ],
    repos: [target],
  };
}

/**
 * Resolve every bare number, `owner/repo#N` and `SUP-N` reference in a pull-request form into a real link, and refuse
 * whatever still can't resolve.
 *
 * @param form the composed pull-request form
 * @param deps the injected world, for the override environment variable
 * @param home the state home the verb resolved, whose grant journal decides the bare-reference hatch
 * @param knownNumber the pull request being written to, when it already exists
 * @returns the linkified form, or every refusal when a bare reference survives
 */
function linkifiedPrForm({
  form,
  deps,
  home,
  knownNumber,
}: {
  form: PrFormDraft;
  deps: BareRefFlowDeps;
  home: string;
  knownNumber: number | undefined;
}): { readonly form: PrFormDraft } | { readonly refusals: readonly string[] } {
  const context = bareRefContextOfForm({ form, knownNumber });
  const linkified = linkifyPrForm({ context, form });
  const verdict = bareRefVerdictFor({
    env: deps.env,
    home,
    issues: bareRefIssuesOfPrForm({ context, form: linkified }).map(
      (issue) => `${issue.path.join(".")}: ${issue.message}`,
    ),
  });
  return verdict.refusals.length > 0 ? { refusals: verdict.refusals } : { form: linkified };
}

/**
 * {@link linkifiedPrForm}, printing any refusal on the door's own `refused:` channel itself — the shape
 * both `create` and `update` want at their own call site, since neither has anything left to do with a
 * refusal beyond reporting it and stopping.
 *
 * @param form the composed pull-request form
 * @param deps the injected world, for the override environment variable and the output sink
 * @param home the state home the verb resolved, whose grant journal decides the bare-reference hatch
 * @param knownNumber the pull request being written to, when it already exists — its own number is the
 *   strongest evidence of what this repo's numbering looks like
 * @returns the linkified form, or undefined once every refusal has already been printed
 */
export function linkifiedPrFormOrReported({
  form,
  deps,
  home,
  knownNumber,
}: {
  form: PrFormDraft;
  deps: BareRefFlowDeps;
  home: string;
  knownNumber?: number | undefined;
}): PrFormDraft | undefined {
  const bareRefs = linkifiedPrForm({ deps, form, home, knownNumber });
  if ("refusals" in bareRefs) {
    for (const refusal of bareRefs.refusals) {
      deps.out({ line: `refused: ${refusal}` });
    }
    return undefined;
  }
  return bareRefs.form;
}
