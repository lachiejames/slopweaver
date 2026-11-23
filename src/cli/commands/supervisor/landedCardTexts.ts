/**
 * The texts a landed ask or hand card drew when the owner's words landed on it — where a draft id it named can sit. Pure; the
 * shell reads the doc, its run journal and the hand register (`./tickRecordApprovedDrafts.ts`).
 *
 * The field list mirrors what the Queue card draws (`site/lib/queueAskRow.ts`'s `askTexts` and
 * `site/lib/handStepAsk.ts`'s `handDrafts`), through the same action traversal the card-writing verbs use (`../handover/namedDraftAdmission.ts`'s `actionTexts`), so an
 * id the card drew is an id the binding sees. It reads the question that was OPEN when the card left the owner's queue rather
 * than the one open now: the owner's landing usually answers it, and an answered question draws no card at all.
 */
import type { HandStep } from "../../../hand/step.js";
import type { HandoverDoc } from "../../../handover/doc.js";
import type { RunEvent } from "../../../handover/ledger.js";
import { type OpenQuestion, openQuestionAfter } from "../../../handover/openQuestion.js";
import { actionTexts, exampleTexts } from "../handover/namedDraftAdmission.js";

/** The fields of a doc an ask card draws. */
type AskDoc = Pick<
  HandoverDoc,
  "blastRadius" | "lean" | "options" | "problem" | "risk" | "slug" | "stillReal" | "summary"
>;

/**
 * Every text an ask card drew at a landing: the doc's own shape, then the question open at the landing with its shape,
 * examples and action.
 *
 * @param doc the ask's doc
 * @param events the run journal's readable events, in file order
 * @param landedIso when the card left the owner's queue — a question asked after it is not one the owner saw
 * @returns the texts, an absent field left for the id reader to skip
 */
export function askCardTexts({
  doc,
  events,
  landedIso,
}: {
  doc: AskDoc;
  events: readonly RunEvent[];
  landedIso: string;
}): readonly (string | undefined)[] {
  const docTexts = [
    doc.slug,
    doc.summary,
    doc.problem,
    doc.risk,
    doc.blastRadius,
    doc.stillReal,
    ...doc.options.flatMap((one) => [one.option, one.tradeoff]),
    doc.lean,
  ];
  const open = questionAtLanding({ events, landedIso });
  if (open === undefined) {
    return docTexts;
  }
  return [...docTexts, ...questionTexts({ open })];
}

/**
 * The texts a hand step's card draws of its own record (`site/lib/handStepAsk.ts`'s `handDrafts`). A step that opens
 * an ask draws that ask too, which the shell reads as an ask card.
 *
 * @param step the hand step as it was posted when the owner spoke ({@link stepAtLanding})
 * @returns the texts
 */
export function handCardTexts({
  step,
}: {
  step: Pick<HandStep, "ifIgnored" | "unblocks" | "what" | "where" | "witness">;
}): readonly (string | undefined)[] {
  return [step.what, step.where, step.unblocks, step.ifIgnored, step.witness];
}

/**
 * The posting of a hand step the owner's card drew when the owner spoke: the latest one posted at or before the landing, so a repost
 * after the owner's yes cannot erase the draft id the owner answered. A landing that precedes every posting (a skewed clock) reads the
 * earliest, the nearest to what the owner saw; an instant that does not parse is never treated as later than the landing.
 *
 * @param postings every posting of one step id, in register order
 * @param landedIso when the owner spoke
 * @returns the posting, or `undefined` when the register holds none
 */
export function stepAtLanding<Step extends Pick<HandStep, "postedIso">>({
  landedIso,
  postings,
}: {
  landedIso: string;
  postings: readonly Step[];
}): Step | undefined {
  const cutoff = Date.parse(landedIso);
  const shown = postings.filter((step) => {
    const at = Date.parse(step.postedIso);
    return Number.isNaN(cutoff) || Number.isNaN(at) || at <= cutoff;
  });
  if (shown.length === 0) {
    return postings[0];
  }
  return shown.at(-1);
}

/**
 * The ask slug a hand step's link opens on the Queue, when it opens one — read off the `open=ask:<slug>` parameter
 * alone. Looser than the Queue's own join (`site/lib/queueLink.ts`), which also demands a loopback console origin:
 * reading an ask the card did not draw only binds a draft that then owes a judgement, never passes one.
 *
 * @param url the step's link
 * @returns the slug, or `undefined` when the link opens no ask
 */
export function openedAskSlug({ url }: { url: string | undefined }): string | undefined {
  if (url === undefined || !URL.canParse(url)) {
    return undefined;
  }
  const opened = new URL(url).searchParams.get("open");
  if (opened === null || !opened.startsWith("ask:")) {
    return undefined;
  }
  return opened.slice("ask:".length);
}

/**
 * The question the card showed when it left the owner's queue: the latest one open at any point up to the landing. The
 * landing's own answer can be stamped the same instant, so the last OPEN state counts rather than the state after it.
 */
function questionAtLanding({
  events,
  landedIso,
}: {
  events: readonly RunEvent[];
  landedIso: string;
}): OpenQuestion | undefined {
  const cutoff = Date.parse(landedIso);
  let open: OpenQuestion | undefined;
  let shown: OpenQuestion | undefined;
  for (const event of events) {
    const at = Date.parse(event.atIso);
    if (!Number.isNaN(cutoff) && !Number.isNaN(at) && at > cutoff) {
      break;
    }
    open = openQuestionAfter({ event, open });
    if (open !== undefined) {
      shown = open;
    }
  }
  return shown;
}

/** Every text one open question draws on its card. */
function questionTexts({ open }: { open: OpenQuestion }): readonly (string | undefined)[] {
  const texts: (string | undefined)[] = [open.question, ...exampleTexts({ examples: open.illustration })];
  if (open.shape !== undefined) {
    texts.push(open.shape.problem, ...open.shape.options.flatMap((one) => [one.option, one.tradeoff]), open.shape.lean);
    if (open.shape.stakes !== undefined) {
      texts.push(open.shape.stakes.risk, open.shape.stakes.blastRadius, open.shape.stakes.stillReal);
    }
  }
  return [...texts, ...actionTexts({ action: open.action })];
}
