/**
 * The approved-draft gate's landing lines (`./tickRecordApprovedDrafts.ts`): each word of the owner's landed on a card,
 * the voice turn it answered and the relay's triage verdict beside it, then the judgement commands, the one the verdict
 * matches first. A bare yes read without the question it answered ("Needs more info here too?") approves a
 * draft the owner had sent back.
 */
import { ownerWordsSchemeOf } from "../../../handover/hisWords.js";
import type { BoundDraftLanding } from "../../../supervisor/draftLandingBinding.js";
import {
  type AnswerContext,
  answerContextLines,
  answerContextRequestOf,
  verdictLeadsWithHold,
} from "../../../talk/answerContext.js";
import type { CardLandedRow } from "../../../talk/cardLanding.js";
import { affirmativeActWhy } from "../slack/draftApprovalWords.js";

/** What an owed row no verb on this build can reach says in place of its release command. */
export const STATE_UNKNOWN =
  "    STATE UNKNOWN: a register line this build cannot read names it, so no verb here can release or drop it. " +
  "Rebuild this seat on current main (`slopweaver dev build`) so the line reads, then re-run this.";

/** How many characters of the owner's words each named draft carries — `slack draft show` prints them whole. */
export const HEARD_CHARS = 100;

/** What a landing owes: a judgement of the owner's words, recorded on the row. */
export const LANDED_ROUTE =
  "For EACH landing: read the owner's words above against the voice turn they answered and the relay's triage verdict, never " +
  "alone — a bare yes answers a question, and the question decides what it means. The command matching the verdict " +
  'is listed first. Not the owner\'s yes ("not yet", a question, about something else, or yes to "needs more info?"): ' +
  '`slopweaver slack draft hold <id> --reason not-owner-yes --why "<what they meant>"`. The owner\'s yes to the draft: ' +
  '`slopweaver slack draft approve <id> --anchor "<anchor>"`, then release it. A yes that is not sendable: approve it, ' +
  'then `slopweaver slack draft hold <id> --reason <thread-moved|no-fleet-slot|slack-refused> --why "<what blocks ' +
  "it>\"`. Every hold is printed on the owner's Queue card. An UNREADABLE card: fix what it names, or rebuild this seat on " +
  "current main (`slopweaver dev build`).";

/**
 * The lines naming one landing: the card, the owner's words, where and when they said them, then the voice turn they
 * answered and the relay's verdict.
 *
 * @param answer what the landing's words answered, or `undefined` when it was not read
 * @returns the head line, then the voice's turn and verdict lines, or the one line saying neither was read
 */
export function landingHead({
  answer,
  landing,
}: {
  answer: AnswerContext | undefined;
  landing: CardLandedRow;
}): readonly string[] {
  const head = `  ${landing.cardKey} — the owner said "${landing.words.trim().slice(0, HEARD_CHARS)}" at ${landing.anchor} (${landing.decidedIso})`;
  if (answer === undefined) {
    return [head, "    what these words answered was not read for this landing: read the call before judging them"];
  }
  return [head, ...answerContextLines({ context: answer, indent: "    " })];
}

/**
 * One bound landing as the refusal names it: the landing and what it answered, then the draft that stands and its two
 * judgement commands, the one the verdict matches first.
 *
 * @param answer what the landing's words answered, or `undefined` when it was not read
 * @param bound the landing and the draft it binds to
 * @param unsure whether a register line this build cannot read names the draft
 * @returns the landing's lines
 */
export function landedDraft({
  answer,
  bound,
  unsure,
}: {
  answer: AnswerContext | undefined;
  bound: BoundDraftLanding;
  unsure: boolean;
}): readonly string[] {
  const head = landingHead({ answer, landing: bound.landing });
  const via = bound.namedId === bound.item.id ? "" : ` (the card names ${bound.namedId}; this is the cut that stands)`;
  const draft = `    on ${bound.item.id}${via}, recorded ${bound.item.draft.tsIso}`;
  if (unsure) {
    return [...head, draft, STATE_UNKNOWN];
  }
  const refused = approveRefusedWhy({ anchor: bound.landing.anchor, answer, heard: bound.landing.words });
  if (bound.item.state === "dropped") {
    let yes = `    yes: re-record its exact words with slopweaver slack draft record … --approved ${bound.landing.anchor}, which owes the send`;
    if (refused !== undefined) {
      yes = `    yes: not at this anchor — ${refused}`;
    }
    return [
      ...head,
      `    on ${bound.item.id}, DROPPED ${String(bound.item.resolvedIso)} (${String(bound.item.outcome)}) before these words were landed, so the drop never weighed them`,
      yes,
      `    not: slopweaver talk restore --card ${bound.landing.cardKey} --anchor "<where you decided>" --why "<why the drop stands>"`,
    ];
  }
  const not = `    not: slopweaver slack draft hold ${bound.item.id} --reason not-owner-yes --why "${holdWhy({ answer })}"`;
  if (refused !== undefined) {
    return [...head, draft, not, `    yes: not at this anchor — ${refused}`];
  }
  const yes = `    yes: slopweaver slack draft approve ${bound.item.id} --anchor ${bound.landing.anchor}`;
  if (answer === undefined || verdictLeadsWithHold({ triage: answer.triage })) {
    return [...head, draft, not, yes];
  }
  return [...head, draft, yes, not];
}

/** The hold's `--why` as the refusal prints it: naming the relay's verdict when it stored one that sends the card back. */
function holdWhy({ answer }: { answer: AnswerContext | undefined }): string {
  if (answer?.triage.kind === "stored" && answer.triage.ruling.verdict !== "send-it") {
    return `relay verdict ${answer.triage.ruling.verdict}: <what they meant>`;
  }
  return "<what they meant>";
}

/** How every refusal below ends: what still approves the draft. */
const NEWER_YES = "only a newer yes from the owner, at its own anchor, approves it";

/**
 * Why `slack draft approve` will refuse this anchor (`../slack/draftApprovalGate.ts`): a relay's stored verdict that is
 * not send-it, none recorded at all, or a turn that would not read; or an unruled relay's or a `call:` landing's words that are no affirmative act.
 * Printing that command first would hand the chair a refusal as its next move.
 */
function approveRefusedWhy({
  anchor,
  answer,
  heard,
}: {
  anchor: string;
  answer: AnswerContext | undefined;
  heard: string;
}): string | undefined {
  // The approve reads every `call:` anchor as a card landing and word-checks it, so this asks the approve's own
  // scheme test, never the answer reader's narrower lowercase-uuid one, which misses an uppercase call id.
  if (ownerWordsSchemeOf({ anchor }) === "call") {
    return notAYesWhy({ heard });
  }
  const request = answerContextRequestOf({ anchor }).kind;
  if (answer === undefined || request !== "relay") {
    return undefined;
  }
  const { triage } = answer;
  if (triage.kind === "stored" && triage.ruling.verdict !== "send-it") {
    return `the relay stored ${triage.ruling.verdict}, so \`slack draft approve\` refuses this anchor; ${NEWER_YES}`;
  }
  if (triage.kind === "not-recorded") {
    return `the relay recorded no verdict, so \`slack draft approve\` refuses this anchor; ${NEWER_YES}`;
  }
  // The approve reads the same turn file first, so one this read could not read refuses there too.
  if (triage.kind === "unreadable") {
    return `the relay's turn would not read (${triage.why}), so \`slack draft approve\` refuses this anchor; ${NEWER_YES}`;
  }
  if (triage.kind === "none") {
    return notAYesWhy({ heard });
  }
  return undefined;
}

/** The refusal for words that are no affirmative act, or `undefined` when they are one. */
function notAYesWhy({ heard }: { heard: string }): string | undefined {
  const why = affirmativeActWhy({ text: heard });
  if (why === undefined) {
    return undefined;
  }
  return `${why}, so \`slack draft approve\` refuses this anchor; ${NEWER_YES}`;
}
