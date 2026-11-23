/**
 * The posting form: every rule a NEW hand step answers to beyond what the register re-checks on read.
 *
 * One function, and no posting reaches the register without it: `./store.ts`'s append runs it under the lock
 * for every posted row, and `hand post` and the monitor lane call it first only to report a refusal early. A writer
 * that builds and appends its steps directly, as `monitor check --fire` does, would otherwise skip every rule and post
 * cards reading only "Answer: <question>", opening nothing and giving the owner no context for an honest reaction.
 * Every writer asks the rules, so there is nothing to skip.
 *
 * Outside `./step.ts`'s `buildHandStep` for the reason its `linkAsLiteral` gives: the register re-validates
 * every line through the builder on READ, and rows already written predate these rules.
 */
import { draftIdsNamed } from "../handover/namedDraftGate.js";

import { checklistRefusal } from "./checklist.js";
import { uncitedNumbers } from "./cites.js";
import { commandInProse } from "./commandInProse.js";
import { decisionWithoutAsk, goAheadPhrase, isSignIn, misplacedDecision } from "./decision.js";
import { type HandStepError, HandStepErrors } from "./errors.js";
import { headlineCode } from "./headlineCode.js";
import { headlineWithoutPurpose } from "./headlinePurpose.js";
import { htmlInProse } from "./htmlInProse.js";
import { imageInProse } from "./imageInProse.js";
import { localFileUrl } from "./localFileUrl.js";
import { machineIdInProse } from "./machineIdInProse.js";
import { placeWithoutLink } from "./placeLink.js";
import { prLedHeadline } from "./prLedHeadline.js";
import { approvalWithoutPage, incidentWithoutProof, postmortemWithoutBriefing } from "./proofLink.js";
import { purchaseAsk } from "./purchase.js";
import { opensOwnHandStep } from "./queueLink.js";
import { fleetRunnableLiteral } from "./runnableLiteral.js";
import { secretNameRefusal } from "./secretName.js";
import { fleetWordInWhat, type HandStep, linkAsLiteral, proofWitnessStep } from "./step.js";
import { reactionWithoutQueueLink } from "./stepReaction.js";
import { typedInstruction } from "./typedInstruction.js";

/**
 * The first refusal a built step earns from the posting form — a purchase ask, a link typed as a literal, a `file://`
 * address as its link (`./localFileUrl.ts`), more than one
 * command in one copy block (`./checklist.ts`), a command the fleet can run typed as a literal, a secret name the registry cannot take, a command of the owner's written into prose
 * rather than the literal, quoted words dictated for the owner to type or say (`./typedInstruction.ts`), a picture file named in prose rather than attached (`./imageInProse.ts`), an HTML file named rather than cited (`./htmlInProse.ts`), a proof witness, an incident card that does not open its proof, a postmortem card that does not open its briefing and an approval that opens no page (`./proofLink.ts`), plain words (a fleet word, a decision opening nothing that holds its choice, a reaction opening no queue
 * item), an embedded decision in the wrong place, a bare go-ahead, a step that does not say where it happens, a
 * place it names with no link to it (`./placeLink.ts`), prose the card draws naming a session, call, talk, turn or
 * run by its machine id, which the Queue would withhold the card for (`./machineIdInProse.ts`), a cited number, a headline naming a code before saying what it
 * is (`./headlineCode.ts`), a headline leading with a pull request instead of the discussion (`./prLedHeadline.ts`), and last a headline that does not say what it is about (`./headlinePurpose.ts`), whose broad criterion would otherwise mask every sharper rule — in that order, or none. The secret name comes before the prose rule on purpose: a step whose
 * verb has not landed is told to wait before it is told where to write the command.
 *
 * @param step the step a writer is about to record
 * @returns the refusal to report, or `undefined` when the step passes every rule
 */
export function postingRefusal({ step }: { step: HandStep }): HandStepError | undefined {
  for (const check of [
    purchaseAsk,
    linkAsLiteral,
    localFileUrl,
    checklistRefusal,
    fleetRunnableLiteral,
    secretNameRefusal,
    commandInProse,
    typedInstruction,
    imageInProse,
    htmlInProse,
    proofWitnessStep,
    incidentWithoutProof,
    postmortemWithoutBriefing,
    approvalWithoutPage,
    unplainStep,
    misplacedDecision,
    bareGoAhead,
    addressRefusal,
    placeWithoutLink,
    machineIdInProse,
    uncitedNumbers,
    headlineCode,
    prLedHeadline,
    headlineWithoutPurpose,
  ]) {
    const refused = check({ step });
    if (refused !== undefined) {
      return refused;
    }
  }
  return undefined;
}

/**
 * Every plain-words posting rule in its order: {@link fleetWordInWhat}, {@link decisionWithoutAsk}, then
 * {@link reactionWithoutQueueLink}.
 *
 * @param step the step a caller is about to record
 * @returns the first refusal, or `undefined` when the line is in the owner's words and a reaction opens its item
 */
export function unplainStep({ step }: { step: HandStep }): HandStepError | undefined {
  const word = fleetWordInWhat({ step });
  if (word !== undefined) {
    return word;
  }
  const decision = decisionWithoutAsk({ step });
  if (decision !== undefined) {
    return decision;
  }
  return reactionWithoutQueueLink({ step });
}

/**
 * The refusal for a step asking the owner only for a go-ahead while carrying NOTHING to weigh — a POSTING rule.
 *
 * A card reading "Say the word if you want the stale store-backup lease cleared before load drops", opening nothing,
 * citing nothing and carrying no decision, gives the owner nothing to judge. Clearing a stale lease on the owner's own
 * machine is an obvious act under `AGENTS.md` rule 10. So a go-ahead sentence (`./decision.ts`'s `goAheadPhrase`) posts only with something to weigh: a carried
 * `decision`, a non-empty `cites`, a `url` to the record — never the step's own card, which draws only this same
 * sentence — or a named `sd-` Slack draft in `what`, `where`, `unblocks`, `ifIgnored` or `witness`. A `literal` is not one: it is
 * what the owner pastes, not what they judge.
 *
 * The residue, stated: a paraphrase outside the phrase list posts; a `cites` or `url` exempts on presence, since
 * no pattern can read whether it is the record being weighed; and the draft exemption is syntactic here — `hand post` separately refuses an id the draft register does not hold,
 * while a writer that is not the verb (the monitor lane names no draft) is not checked for one.
 *
 * MEASURED over the first 128 steps posted: 3 of the 5 go-ahead sentences are refused —
 * `vanta-entry-group-approval`, `vulnfix-where-on-the-app` and `store-backup-daily-stopped-firing`, each opening
 * nothing — while `steer-iso-rosa-replies` opens its ask and `mon-park-local-e2es-become-a-3bfd69` names its draft.
 * Reproduce by replaying
 * `grep '"kind":"posted"' "$SLOPWEAVER_HOME/hand-steps/steps.jsonl"` through `parseHandLine` then `bareGoAhead`.
 *
 * @param step the step a caller is about to record
 * @returns the refusal, or `undefined` when the sentence asks no go-ahead or the step carries something to weigh
 */
export function bareGoAhead({ step }: { step: HandStep }): HandStepError | undefined {
  const phrase = goAheadPhrase({ what: step.what });
  if (phrase === undefined || step.decision !== undefined) {
    return undefined;
  }
  if (step.cites !== undefined && step.cites.length > 0) {
    return undefined;
  }
  if (step.url !== undefined && !opensOwnHandStep({ id: step.id, url: step.url })) {
    return undefined;
  }
  if (draftIdsNamed({ texts: [step.what, step.where, step.unblocks, step.ifIgnored, step.witness] }).length > 0) {
    return undefined;
  }
  return HandStepErrors.invalidField({
    field: "what",
    why:
      `asks the owner for a go-ahead ("${phrase}") and carries nothing to weigh — no decision, no --cites, no link to the ` +
      "record, no named Slack draft. Under rule 10 an obvious act is done, not asked: do it and record it with " +
      "`slopweaver autonomy record`. An act reserved to the owner — a send as the owner to a person, a closure the owner must judge — " +
      "carries its draft (name the sd- id) or its decision",
  });
}

/**
 * The refusal for a step that does not say where it happens — a POSTING rule.
 *
 * A card reading "Sign in to Typeform in the work Chrome profile" with no link leaves the owner without the place to
 * go. So every new step carries an address — a `url` (or `--open`), a `literal` the owner pastes with the `where` it
 * goes (a paste is payload, not a place: "Enter the approval code" posted with `--literal 123456` and nothing saying
 * which prompt is that shape; 1 of the first 131 steps posted was), or both — or says why it has none in
 * `unaddressed` (`hand post --no-address "<why>"`), which the card draws. Never silence, and never a reason beside
 * an address, which the record would then contradict.
 *
 * A sign-in (`./decision.ts`'s `isSignIn`) is stricter, and `--no-address` never excuses one: it carries the page
 * the poster opened itself as `url`, or a `literal` command with `where` saying where to run it — the
 * `gcloud auth application-default login` shape, whose page exists only once the command runs. The check is
 * PRESENCE, on purpose: of the 10 sign-ins among the first 131 posted, two complete ones name a provider
 * root that redirects to its login (`acme.trelica.app`, `console.jumpcloud.com`), and `codex login` in
 * "any terminal" and `op account add` prompting in the terminal say no browser, so a homepage or a "browser opens"
 * pattern would refuse real steps. Whether a url is the right page, or a command opens consent, is the poster's to
 * have checked — a pattern cannot read it.
 *
 * The third shape is `opened` plus `where`: the fleet ran the sign-in itself and the window is already
 * on the owner's screen (`./runnableLiteral.ts`), so `where` names that window and nothing is pasted. `opened` without
 * `where` is refused — a window the owner cannot tell from the others is no place — and so is `opened` beside a
 * `literal`, since a window already open needs no command to open it.
 *
 * MEASURED over the first 128 steps posted: 48 say nowhere they happen and would be refused, 27 of them
 * monitor cards, which `../monitor/card.ts` now gives their own queue link; of the 21 a session wrote, 9 typed a
 * link into `where` instead of `url`, where the card draws it as text. All 9 sign-ins among those 128 already carry a page or a paste
 * with its `where` — `typeform-signin-for-atlas-resync` needed a url added after posting. Reproduce by replaying
 * `grep '"kind":"posted"' "$SLOPWEAVER_HOME/hand-steps/steps.jsonl"` through `parseHandLine` then `addressRefusal`.
 *
 * @param step the step a caller is about to record
 * @returns the refusal, or `undefined` when the step says where it happens or why it cannot
 */
export function addressRefusal({ step }: { step: HandStep }): HandStepError | undefined {
  // A checklist line carrying a command or a page says where that line happens, so the script is an address too.
  const scripted = step.checklist?.some((item) => item.command !== undefined || item.url !== undefined) === true;
  const addressed = step.url !== undefined || step.literal !== undefined || step.opened !== undefined || scripted;
  if (step.opened !== undefined && step.where === undefined) {
    return HandStepErrors.invalidField({
      field: "where",
      why: "is missing beside --opened — name the window the fleet opened (which browser, which page), so the owner knows where to look",
    });
  }
  if (step.opened !== undefined && step.literal !== undefined) {
    return HandStepErrors.invalidField({
      field: "literal",
      why: "is beside --opened — the window is already open, so there is nothing for the owner to paste: drop the --literal",
    });
  }
  if (pagelessSignIn({ step })) {
    return HandStepErrors.invalidField({
      field: "url",
      why:
        "is missing and the step is a sign-in — pass --url with its sign-in page, --opened with the page the fleet " +
        "opened plus --where naming that window, or a --literal command with --where saying where to run it. " +
        "--no-address never excuses a sign-in",
    });
  }
  if (step.literal !== undefined && step.url === undefined && step.where === undefined) {
    return HandStepErrors.invalidField({
      field: "where",
      why:
        "is missing and a --literal is the step's only address — a paste is WHAT the owner puts somewhere, not where: say " +
        "where it goes with --where (a terminal, the prompt, the app), or give the page as --url",
    });
  }
  if (step.unaddressed !== undefined && addressed) {
    return HandStepErrors.invalidField({
      field: "unaddressed",
      why: "says the step has no address, and it carries a --url, --opened or --literal — drop --no-address, or the address",
    });
  }
  if (!addressed && step.unaddressed === undefined) {
    return HandStepErrors.invalidField({
      field: "url",
      why:
        "is missing, and so are --literal and --no-address — say where it happens: --url (or --open <kind>:<id>), " +
        '--literal, or --no-address "<why there is none>", which the card draws so the owner sees the reason',
    });
  }
  return undefined;
}

/**
 * Whether a sign-in step names no page to sign in on: no `url`, no checklist line opening one, no window the fleet
 * opened, and no `literal` with a `where` to run it.
 *
 * A checklist line opening a page is the sign-in's page, the way a top-level `url` is.
 *
 * @param step the step a caller is about to record
 * @returns true when the step is a sign-in with nowhere to sign in
 */
function pagelessSignIn({ step }: { step: HandStep }): boolean {
  if (!isSignIn({ what: step.what })) {
    return false;
  }
  const scriptedPage = step.checklist?.some((item) => item.url !== undefined) === true;
  const pasteWithPlace = step.literal !== undefined && step.where !== undefined;
  return step.url === undefined && !scriptedPage && step.opened === undefined && !pasteWithPlace;
}
