/**
 * A NOTE ASKING THE OWNER TO JUDGE SOMETHING OPENS ITS PROOF — three posting rules.
 *
 * A note on an incident row with `--url http://localhost:3000/queue` and `--what "Approve the fix PR to staging and
 * the team post …"` lands its Open button on the Queue list, and the only evidence reachable from there is a GitHub
 * Actions run. The owner validates findings from the proof, so the proof leads, never the PR. `./stepReaction.ts`
 * leaves `approve` out of its tell on purpose, since a phone or OS approval has no page.
 *
 * So three rules, each narrower than "every card":
 *
 * - {@link incidentWithoutProof} — a step on an `incident-` board row opens its PROOF: a page the fleet published
 *   (`slopweaver page publish`, opened in the console's viewer) or the Datadog view that shows it. Never the Queue,
 *   never a CI run, never a pull request — the PR is never the first thing the owner is shown.
 * - {@link approvalWithoutPage} — a step asking the owner to approve fleet work (a PR, a fix, a post, a draft …)
 *   opens a page or a pull request, never a console list the owner then hunts through and never a CI run.
 * - {@link postmortemWithoutBriefing} — a step on a `postmortem-` board row opens the briefing page the fleet
 *   published, so the owner knows what the room is talking about before asking to join it.
 *
 * MEASURED over the first 412 steps posted: each rule refuses exactly one. They hold the line going forward rather
 * than clean up history. The third refuses none of the first 443 posted, since no step had named a `postmortem-` row
 * before it. Reproduce by replaying
 * `grep '"kind":"posted"' "$SLOPWEAVER_HOME/hand-steps/steps.jsonl"` through `parseHandLine` then each rule.
 *
 * The address shapes are `./proofAddress.ts`'s. Pure: a built step in, a refusal or `undefined` out.
 */
import { isSignIn } from "./decision.js";
import { type HandStepError, HandStepErrors } from "./errors.js";
import {
  isCiRunUrl,
  isConsoleListUrl,
  isConsoleQueueAddress,
  isIncidentProofUrl,
  isPublishedPageUrl,
  isPullRequestUrl,
  onIncidentRow,
  onPostmortemRow,
} from "./proofAddress.js";
import type { HandStep } from "./step.js";

/**
 * The approval tell: `approve`, then at most THREE intervening words, then a noun naming fleet work — PR, pull
 * request, fix, post, draft, change, merge, deploy, release, plan, ticket, reply, message. Narrow on purpose, in
 * `./stepReaction.ts`'s house style: "approve the push on your phone" and "approve the sign-in prompt" are the owner's
 * steps with no page, and name no fleet noun.
 *
 * The edges, each a test: a word never spans punctuation, so "Approve it. The release …" is no approval; the noun
 * ends at a word boundary that is not a hyphen, so "post-mortem" and "deployment" are not one; `approved` is a
 * report, not an ask; "not approve", "don't approve" and "approve of" ask nothing. A paraphrase ("give the fix PR a
 * yes") posts — that is the residue.
 */
const APPROVAL =
  /(?<!\bnot\s)(?<!\bdon't\s)\bapprove\b(?!\s+of\b)(?:\s+[\w'-]+){0,3}?\s+(?:prs?|pull\s+requests?|fix(?:es)?|posts?|drafts?|changes?|merges?|deploys?|releases?|plans?|tickets?|repl(?:y|ies)|messages?)(?![\w-])/iu;

/**
 * The on-device tell: a step naming the surface the approval happens on — a system dialog, the owner's phone, macOS,
 * the keychain, Touch ID, Duo, an authenticator, a YubiKey or passkey. "Approve the macOS change in the system dialog"
 * names a fleet noun and still has no page, so naming the device exempts it. Not "prompt":
 * in this repository a prompt is as often the voice's text as a dialog, and a sign-in prompt is `isSignIn`'s. The
 * residue, stated: "Approve the fix PR from your phone" posts with no page.
 */
const ON_DEVICE =
  /\b(?:dialog|phone|mac\s?os|system\s+settings|keychain|touch\s+id|face\s+id|duo|authenticator|yubikey|passkey)\b/iu;

/**
 * Whether the step is one the owner PERFORMS rather than judges: a sign-in, a paste, a checklist, or a window the
 * fleet already opened. Each carries its own address, and none of them is the incident card.
 *
 * @returns true when the step's address is where the owner acts, not what they weigh
 */
function performedStep({ step }: { step: HandStep }): boolean {
  return (
    isSignIn({ what: step.what }) ||
    step.literal !== undefined ||
    step.checklist !== undefined ||
    step.opened !== undefined
  );
}

/** The fix every incident refusal names, so a poster knows the one command that makes the proof addressable. */
const PUBLISH_HINT =
  "publish the receipts with `slopweaver page publish <slug> --page <file> --review <id>` (the review from " +
  "`slopweaver page review-prepare`) and pass its viewer address " +
  "(http://localhost:3000/view?src=%2Fapi%2Fpage%2F<slug>%2Findex.html&back=%2Fqueue), or the Datadog view that shows it";

/**
 * The refusal for a step on an incident's row whose note does not open the proof — a POSTING rule.
 *
 * The note's Open button is `url`, and it is the first thing the owner presses. On an incident it lands on the proof:
 * a page the fleet published or the Datadog view that shows the errors. Refused: no `url` (`--no-address` included),
 * any Queue address (the list or one item on it — the card the owner came from is not the evidence), a CI run, a
 * pull request, and anything else. A step the owner performs — a sign-in the incident read waits on, a paste — carries its own
 * address and is left to the rules that judge it.
 *
 * The residue, stated: an outage card that names no `incident-` row is not read here. The criterion is the row,
 * since no pattern over prose can tell an outage from a slow afternoon.
 *
 * @param step the step a caller is about to record
 * @returns the refusal, or `undefined` when the step is not an incident card or opens its proof
 */
export function incidentWithoutProof({ step }: { step: HandStep }): HandStepError | undefined {
  if (!onIncidentRow({ step }) || performedStep({ step })) {
    return undefined;
  }
  if (step.url !== undefined && isIncidentProofUrl({ url: step.url })) {
    return undefined;
  }
  return HandStepErrors.invalidField({ field: "url", why: `${incidentUrlFault({ url: step.url })} — ${PUBLISH_HINT}` });
}

/**
 * The refusal for a step on a postmortem row whose card does not open the BRIEFING — a POSTING rule.
 *
 * The owner reads a briefing beforehand, so they know what the room is talking about. The card's Open button is that
 * briefing, a page the fleet published. Narrower than {@link incidentWithoutProof}: a Datadog view is the evidence
 * of an outage, not a briefing on what the room will discuss. Narrower in a second way: there is no exemption for a
 * step the owner performs. A postmortem row carries one thing, the card `incident postmortem`
 * composes, and {@link performedStep}'s sign-in test reads prose — a card whose headline merely said "auth" would
 * slip past. The residue, stated: "a published page" is `isPublishedPageUrl`'s judgement,
 * which reads the path's shape and authenticates no host, exactly as for {@link approvalWithoutPage}; the card
 * `incident postmortem` composes builds its address off the console base, so only a hand-typed step can carry a
 * page-shaped path on a host that serves nothing.
 *
 * @param step the step a caller is about to record
 * @returns the refusal, or `undefined` when the step is not a postmortem card or opens a published page
 */
export function postmortemWithoutBriefing({ step }: { step: HandStep }): HandStepError | undefined {
  if (!onPostmortemRow({ step })) {
    return undefined;
  }
  if (step.url !== undefined && isPublishedPageUrl({ url: step.url })) {
    return undefined;
  }
  const fault = step.url === undefined ? "is missing" : "is not a published page";
  return HandStepErrors.invalidField({
    field: "url",
    why:
      `${fault} on a step for a postmortem row — a postmortem card opens the briefing the owner reads before the meeting; ` +
      "publish it with `slopweaver page publish <slug> --page <file> --review <id>` (the review from " +
      "`slopweaver page review-prepare`) and pass its viewer address",
  });
}

/**
 * What is wrong with an incident card's address, in the words the refusal opens on.
 *
 * @param url the step's address, when it has one
 * @returns the fault
 */
function incidentUrlFault({ url }: { url: string | undefined }): string {
  if (url === undefined) {
    return "is missing on a step for an incident's row, so its note opens nothing — an incident note opens its proof";
  }
  if (isCiRunUrl({ url })) {
    return "opens a CI run on a step for an incident's row — a CI log is not the proof the owner judges an incident by";
  }
  if (isPullRequestUrl({ url })) {
    return "opens a pull request on a step for an incident's row — lead with the proof, never with the PR";
  }
  if (isConsoleQueueAddress({ url })) {
    return "opens the console on a step for an incident's row — the owner lands on the Queue, not on the proof";
  }
  return "is not a published page or a Datadog view on a step for an incident's row — an incident note opens its proof";
}

/**
 * The refusal for a step asking the owner to approve fleet work whose note opens nothing to judge it on — a POSTING rule.
 *
 * {@link APPROVAL} reads the ask. It posts with a `url` that is a page — a published page, a Queue item that carries
 * the decision, any web page that is not a CI run — or a pull request. Refused: no `url`, a console list (the Queue
 * with no item, the board, the root — a console route, never any other loopback page), and a CI run. A sign-in is left to the sign-in rules, and an approval that
 * names its device ({@link ON_DEVICE}) has no page to open.
 *
 * @param step the step a caller is about to record
 * @returns the refusal, or `undefined` when the step asks no approval or opens something to judge it on
 */
export function approvalWithoutPage({ step }: { step: HandStep }): HandStepError | undefined {
  const asked = APPROVAL.exec(step.what);
  if (asked === null || isSignIn({ what: step.what }) || ON_DEVICE.test(step.what)) {
    return undefined;
  }
  const phrase = asked[0];
  if (step.url === undefined) {
    return HandStepErrors.invalidField({
      field: "url",
      why: `is missing and the step asks the owner to "${phrase}" — pass the page that shows what the owner approves, or the pull request, so the note's Open button lands on it`,
    });
  }
  if (isConsoleListUrl({ url: step.url })) {
    return HandStepErrors.invalidField({
      field: "url",
      why: `opens a console list and the step asks the owner to "${phrase}" — the owner lands on the list and hunts; pass the page that shows what the owner approves, the pull request, or the one Queue item (open=<kind>%3A<id>) that carries it`,
    });
  }
  if (isCiRunUrl({ url: step.url })) {
    return HandStepErrors.invalidField({
      field: "url",
      why: `opens a CI run and the step asks the owner to "${phrase}" — a CI log is not what the owner approves; pass the page that shows it, or the pull request`,
    });
  }
  return undefined;
}
