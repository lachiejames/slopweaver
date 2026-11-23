/**
 * A step only the owner's hands can take, as a queue card carrying that step's own record and nothing else — and the
 * check that refuses one carrying anything more.
 *
 * Generic boilerplate (about 95% of a step card's text, by the owner's count) is text the owner skips and gets no
 * value from, and it bottlenecks their feedback
 * loop when they must keep steering to fix it. A card that is the fleet briefing repeats every PROBLEM, STAKES,
 * WHY YOU, OPTIONS, LEAN and IF SILENT line as the same sentence on every step. So a step's card is a {@link StepCard}: its heading
 * is the step's sentence, its rows are the step's own fields under a label, an absent field is no row, and a step
 * opening a shaped ask adds that ask's own problem, options, lean and stakes. {@link stepCardTemplateText} names any
 * drawn text the record did not write, and {@link handCard} hands back a refused form when it names one — so no
 * surface can take the card without the verdict on it.
 *
 * Apart from `./queueCard.ts` because that module imports nothing and sits near the file-length cap; this one
 * imports it, as `./findingActCard.ts` does.
 */
import { artifactCitedForm, withArtifactPage } from "./cardPages";
import { cardChecklist, checklistLineTexts, pasteFieldsCoverLiteral, stepCardTexts } from "./handCardTexts";
import {
  type AskRecordOption,
  foldedText,
  localPagesIn,
  type StepCard,
  type StepChecklistLine,
  type StepDecision,
  type StepOption,
  type StepRow,
} from "./queueCard";
import { opensOwnHandStep } from "./queueLink";
import type { ReasonWords } from "./quotedReason";
import { whereBehind } from "./stepRowFold";

/**
 * The `no address` row of a step that carries no link, nothing to paste and no stated reason — every row posted
 * before `hand post` required one of the three (`src/hand/posting.ts`'s `addressRefusal`). Said rather than left
 * out, so a card never silently lacks a link; the one sentence a card draws that its record did not write, and
 * {@link stepCardTemplateText} admits it only on a record that truly carries none of the three.
 */
export const NO_ADDRESS_STATED = "not stated: this step names no link, nothing to paste, and no reason";

/** The step register's row, as much of it as a card reads. */
export interface HandRecord {
  readonly id: string;
  readonly what: string;
  readonly unblocks: string | undefined;
  /** What happens if the owner does nothing (`hand post --if-ignored`) — required for `literal`'s reason. */
  readonly ifIgnored: string | undefined;
  readonly where: string | undefined;
  /** The one address the note opens (`hand post --url`). */
  readonly url: string | undefined;
  /**
   * The page the fleet already opened for the step (`hand post --opened`) — required so a caller that forgets it fails
   * to compile rather than drawing a sign-in card with no link to its page.
   */
  readonly opened: string | undefined;
  readonly witness: string | undefined;
  /** What the owner pastes — required so a caller that forgets it fails to compile rather than drawing no copy block. */
  readonly literal: string | undefined;
  /** The script the owner runs through (`hand post --checklist`) — required for `literal`'s reason. */
  readonly checklist: readonly StepChecklistLine[] | undefined;
  /** Why it has no link and nothing to paste (`hand post --no-address`) — required for `literal`'s reason. */
  readonly unaddressed: string | undefined;
  /** The pull requests and tickets the step names (`hand post --cites`). */
  readonly cites: readonly string[];
  /** Why its named board row has not taken it down (`hand list --json`'s `rowProblem`), when it has not. */
  readonly rowProblem?: string | undefined;
  /** Why a settle left it up after answering the owner (`hand list --json`'s `keptReason`), when one did. */
  readonly keptReason?: string | undefined;
  /** The secrets the card draws a paste field for (`hand list --json`'s `secrets`), when it stores any. */
  readonly secrets?: readonly string[] | undefined;
  /** The field of its register line that did not read (`../components/live/read.ts`), when one did not. */
  readonly unreadable?: string | undefined;
}

/**
 * The `could not read` row of a step whose register line did not read whole — the one card the Queue draws for it,
 * in place of the list blanking. Template text {@link stepCardTemplateText} admits for that
 * step alone, as it admits {@link NO_ADDRESS_STATED}.
 *
 * @param field the field that did not read
 * @param id the step's id, which `hand show` takes
 * @returns the row's sentence
 */
export function unreadableStepLine({ field, id }: { field: string; id: string }): string {
  return `its ${field} did not read, so only its sentence is drawn: slopweaver hand show ${id} prints the whole line; re-post it to repair`;
}

/**
 * The shaped ask a DECISION step opens (`hand post --open ask:<slug>`), as much of it as the card reads.
 *
 * Joined by `./handStepAsk.ts` off the board row the step's `url` names, WHATEVER that row's owner-wait —
 * two steps once each opened an ask the queue itself never listed, because
 * neither was parked on the owner's word. `problem`, `lean` and at least two options are what make it shaped, so they
 * are required here; the three stakes lines arrive whole or not at all, as `handover ask` records them.
 */
export interface HandDecisionRecord {
  readonly slug: string;
  readonly summary: string | undefined;
  readonly problem: string;
  readonly options: readonly AskRecordOption[];
  readonly lean: string;
  readonly risk: string | undefined;
  readonly blastRadius: string | undefined;
  readonly stillReal: string | undefined;
  readonly stillRealIso: string | undefined;
}

/**
 * The ONE place the step sends the owner, which the card draws first as its call to action: the page the fleet
 * opened, else the step's link unless that link is this very card, else its one cited address when it cites exactly
 * one.
 *
 * A sign-in card's record can carry the page as `opened` while its `url` is its own queue card — the one link a card
 * the owner is already on cannot use. A monitor sign-in whose page would not open cites it instead (`src/monitor/card.ts`), so a sole cite
 * beside a self-link is the place too.
 *
 * @param step the hand register's row
 * @returns the address, or `undefined` when the step sends the owner nowhere a link reaches
 */
export function stepDestination({ step }: { step: HandRecord }): string | undefined {
  if (step.opened !== undefined) {
    return step.opened;
  }
  if (step.url !== undefined && !opensOwnHandStep({ id: step.id, url: step.url })) {
    return step.url;
  }
  if (step.cites.length === 1) {
    return step.cites[0];
  }
  return undefined;
}

/**
 * The step's own fields as labelled rows, in the order the owner acts on them: where to go first ({@link stepDestination}),
 * what happens if they do nothing (else what it unblocks), any other link — or why there is nowhere, stated or
 * {@link NO_ADDRESS_STATED} — and, behind the fold (`./stepRowFold.ts`), a `where` the chip answers, the unblocks
 * line a do-nothing line replaced, what settles it and what it names. Who posted it is no row: provenance the owner never
 * acts on. Any other field the record left off is no row, and no address is drawn twice.
 *
 * @param step the hand register's row
 * @returns the rows
 */
export function stepRows({ step }: { step: HandRecord }): readonly StepRow[] {
  const rows: StepRow[] = [];
  const add = ({
    label,
    value,
    behind = false,
  }: {
    label: StepRow["label"];
    value: string | undefined;
    behind?: boolean;
  }): void => {
    if (value !== undefined && value.trim().length > 0) {
      rows.push(behind ? { behind: true, label, value } : { label, value });
    }
  };
  const destination = stepDestination({ step });
  add({ label: "go to", value: destination });
  const costed = step.ifIgnored !== undefined && step.ifIgnored.trim().length > 0;
  if (costed) {
    add({ label: "if you do nothing", value: step.ifIgnored });
  } else {
    add({ label: "unblocks", value: step.unblocks });
  }
  if (step.unreadable !== undefined) {
    add({ label: "could not read", value: unreadableStepLine({ field: step.unreadable, id: step.id }) });
  }
  add({ label: "still here because", value: step.rowProblem });
  add({ label: "kept because", value: step.keptReason });
  // Its own card, beside a place to go, is a link back to where the owner already is.
  const selfBesideDestination =
    destination !== undefined && step.url !== undefined && opensOwnHandStep({ id: step.id, url: step.url });
  if (step.url !== destination && !selfBesideDestination) {
    add({ label: "open", value: step.url });
  }
  add({ label: "no address", value: step.unaddressed });
  // A step that did not read has its address blanked, not unstated: the `could not read` row already says why.
  if (unaddressedSilently({ step }) && step.unreadable === undefined) {
    add({ label: "no address", value: NO_ADDRESS_STATED });
  }
  add({ behind: whereBehind({ destination, step }), label: "where", value: step.where });
  if (costed) {
    add({ behind: true, label: "unblocks", value: step.unblocks });
  }
  add({ behind: true, label: "done when", value: step.witness });
  for (const cite of step.cites.filter((one) => one !== destination)) {
    add({ behind: true, label: "cites", value: cite });
  }
  return rows;
}

/**
 * Whether a step carries no link, nothing to paste and no stated reason — a row from before the three were required.
 *
 * @param step the hand register's row
 * @returns true when the card has to say the address was never stated
 */
function unaddressedSilently({ step }: { step: HandRecord }): boolean {
  return (
    step.url === undefined &&
    step.opened === undefined &&
    step.literal === undefined &&
    step.checklist === undefined &&
    step.unaddressed === undefined
  );
}

/**
 * Whether a panel may draw a step card: `refused` names the first text its record did not write.
 *
 * The same two arms as the act card's form in `./queueActRow.ts`, so one renderer draws both refusals.
 */
export type StepCardForm = { readonly kind: "drawn" } | { readonly kind: "refused"; readonly why: ReasonWords };

/** A built step card, and the verdict on whether it may be drawn — never one without the other. */
export interface BuiltStepCard {
  readonly card: StepCard;
  readonly form: StepCardForm;
}

/**
 * The ask a decision step opens, as that ask's own recorded fields and nothing composed around them.
 *
 * @param decision the shaped ask
 * @returns the card's decision block
 */
function stepDecision({ decision }: { decision: HandDecisionRecord }): StepDecision {
  const options = decision.options.map((one): StepOption => ({
    ...(one.command === undefined ? {} : { command: one.command }),
    letter: one.letter,
    sentence: one.option,
    tradeoff: one.tradeoff,
  }));
  const { risk, blastRadius, stillReal } = decision;
  let stakes: StepDecision["stakes"];
  if (risk !== undefined && blastRadius !== undefined && stillReal !== undefined) {
    stakes = { blastRadius, checkedIso: decision.stillRealIso, kind: "stated", risk, stillReal };
  }
  return { lean: decision.lean, options, problem: decision.problem, stakes, summary: decision.summary };
}

/**
 * The card for a step only the owner's hands can take — with the linked ask's own decision when the step opens one — and
 * its form: refused, quoting the text, when the card would draw anything the step or its ask did not record.
 *
 * @param step the hand register's row
 * @param decision the shaped ask the step opens, when it opens one
 * @param artifact the page the ask the step opens published — shaped or not, so read apart from `decision`
 * @returns the card and its form
 */
export function handCard({
  step,
  decision,
  artifact,
}: {
  step: HandRecord;
  decision?: HandDecisionRecord | undefined;
  artifact?: string | undefined;
}): BuiltStepCard {
  // The ask it opens may publish a page; the step points the owner at that ask, so it cites the page as the ask card would.
  const card = withArtifactPage({ artifact, card: stepCardOf({ decision, step }) });
  return { card, form: stepCardForm({ artifact, card, decision, step }) };
}

/**
 * Whether a built step card may be drawn: refused, quoting the first text its records did not write, or naming the
 * page the ask it opens published when the card does not cite it (`./cardPages.ts`).
 *
 * @param card the built card
 * @param step the record it was built from
 * @param decision the ask it opens, when it opens one
 * @param artifact the page that ask published, which the card must cite first
 * @returns `drawn`, or the refusal
 */
export function stepCardForm({
  card,
  step,
  decision,
  artifact,
}: {
  card: StepCard;
  step: HandRecord;
  decision?: HandDecisionRecord | undefined;
  artifact?: string | undefined;
}): StepCardForm {
  const first = stepCardTemplateText({ card, decision, step }).at(0);
  if (first === undefined) {
    return artifactCitedForm({ artifact, pages: card.pages });
  }
  return {
    kind: "refused",
    why: `This card would draw text its step did not record ("${first}"), so it is refused rather than drawn.`,
  };
}

/**
 * The step card itself, before its form is judged.
 *
 * @param step the hand register's row
 * @param decision the shaped ask the step opens, when it opens one
 * @returns the card
 */
function stepCardOf({ step, decision }: { step: HandRecord; decision: HandDecisionRecord | undefined }): StepCard {
  let subject = step.id;
  let shaped: StepDecision | undefined;
  if (decision !== undefined) {
    subject = decision.slug;
    shaped = stepDecision({ decision });
  }
  const named = [step.what, step.url, decision?.summary].filter((text): text is string => text !== undefined);
  let copy = step.literal;
  if (
    copy !== undefined &&
    step.secrets !== undefined &&
    pasteFieldsCoverLiteral({ literal: copy, secrets: step.secrets })
  ) {
    copy = undefined;
  }
  return {
    checklist: cardChecklist({ checklist: step.checklist, secrets: step.secrets }),
    copy,
    decision: shaped,
    kind: "step",
    pages: localPagesIn({ text: named.join(" ") }),
    question: step.what,
    rows: stepRows({ step }),
    subject,
    what: foldedText({ text: step.what }),
  };
}

/**
 * Every text a step card draws that its record did not write — template text, which the queue refuses to draw.
 *
 * Template text on a card must be impossible, so this is a check over the
 * built card rather than a convention in the builder: a row, a sentence or a line composed around a field is no
 * record value, and it is named here whichever function added it.
 *
 * @param card the built card
 * @param step the record it was built from
 * @param decision the ask it opens, when it opens one
 * @returns each drawn text with no source in the record — empty on a card fit to draw
 */
export function stepCardTemplateText({
  card,
  step,
  decision,
}: {
  card: StepCard;
  step: HandRecord;
  decision?: HandDecisionRecord | undefined;
}): readonly string[] {
  const written = new Set<string>([step.what, ...step.cites]);
  if (unaddressedSilently({ step }) && step.unreadable === undefined) {
    written.add(NO_ADDRESS_STATED);
  }
  if (step.unreadable !== undefined) {
    written.add(unreadableStepLine({ field: step.unreadable, id: step.id }));
  }
  for (const value of [
    step.unblocks,
    step.ifIgnored,
    step.url,
    step.opened,
    step.unaddressed,
    step.where,
    step.witness,
    step.literal,
    step.rowProblem,
    step.keptReason,
  ]) {
    if (value !== undefined) {
      written.add(value);
    }
  }
  if (step.checklist !== undefined) {
    for (const text of step.checklist.flatMap((line) => checklistLineTexts({ line }))) {
      written.add(text);
    }
  }
  if (decision !== undefined) {
    written.add(decision.problem);
    written.add(decision.lean);
    for (const option of decision.options) {
      written.add(option.option);
      written.add(option.tradeoff);
    }
    for (const value of [decision.summary, decision.risk, decision.blastRadius, decision.stillReal]) {
      if (value !== undefined) {
        written.add(value);
      }
    }
  }
  // Surrounding whitespace is layout, not text: `foldedText` trims the sentence it folds, and no record's padding is a
  // sentence a template added.
  const trimmed = new Set([...written].map((text) => text.trim()));
  return stepCardTexts({ card }).filter((text) => !trimmed.has(text.trim()));
}
