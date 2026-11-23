/**
 * The card for a run parked on a recorded question, and the lead it heads with — split out of `./queueCard.ts`, which
 * holds the shapes and text helpers it builds from and still imports nothing.
 */

import {
  type AskRecord,
  type BriefingCard,
  type CardExamples,
  type CardHead,
  type CardOption,
  type CardStakes,
  localPagesIn,
  peopleVerbOf,
  QUESTION_MAX_WORDS,
  readable,
  saidText,
  sentencesOf,
  subjectLabel,
  whatOf,
} from "./queueCard";

// Re-exported so the two over-cap console files reading the lead beside these keep one import line each and stay
// under their ratchet floors, which a split may not raise.
export { steerDraft } from "./queueCardAct";
export { type ActLinks, liveActNotices } from "./queueCardActLinks";
export { readable, subjectLabel };

/**
 * Where recorded prose already pauses: an em dash, a colon or a semicolon. A session's question may carry the dash.
 * Zero-width, so two pauses sharing a space (`one — — two`) are both found, exactly as `lastIndexOf` finds them.
 */
const PROSE_PAUSE = /(?= — |: |; )/gu;

/**
 * How many opening sentences {@link leadQuestion} will look through for a real question.
 *
 * Two, not all of them: a board question's third sentence onwards is background, and a `?` found down
 * there reads as the ask when it is a detail. Past two the first sentence is used as written.
 */
const LEAD_SENTENCES = 2;

/**
 * The one sentence a long recorded question actually ASKS.
 *
 * A board row's `question` is a paragraph — measured, eight asks standing on the queue
 * ran 42 to 205 words each, and printing one whole into a row is the wall of text `AGENTS.md` rule 7
 * bans. The rest is not lost: the caller puts it in the card's `what`, folded.
 *
 * It never manufactures a question mark. A row whose opening sentences ask nothing is reported as
 * written, because `asQuestion` on a statement produces a sentence the register never wrote.
 *
 * @param text the record's own prose
 * @returns the first sentence that asks something, else the first sentence, capped
 */
export function leadQuestion({ text }: { text: string }): string {
  const sentences = sentencesOf({ text });
  const asked = sentences.slice(0, LEAD_SENTENCES).find((sentence) => sentence.endsWith("?"));
  if (asked !== undefined) {
    // A real question is never cut. Cutting one loses the thing it asks, and drops the mark that makes it
    // a question at all — worse than the extra line it costs.
    return asked;
  }
  const [first = ""] = sentences;
  return cappedLead({ text: first });
}

/**
 * A statement lead cut to the question cap, at a pause a reader already reads.
 *
 * `leadQuestion`'s fallback branch returns ONE sentence, and a sentence is not automatically short: the
 * `before-versus-after-proof-as-a-general-slopweaver-feature-architectures` row ran its whole A/B/C/D
 * option list into a single em-dashed sentence and took four lines of the queue — the wall this change
 * exists to remove, in the one row the sentence splitter could not help with. Repro: `slopweaver browser
 * shot --raw --full-page --url http://localhost:3100/queue`. What is cut is not lost; `askCard` puts the
 * remainder in the folded `what`.
 *
 * The cut lands on an em dash, colon or semicolon inside the cap when there is one, so the lead ends where
 * the prose already pauses rather than mid-clause.
 *
 * @param text one sentence of the question as recorded, before `readable` names its pages
 * @returns the sentence, or its opening clause when it runs past `QUESTION_MAX_WORDS`
 */
export function cappedLead({ text }: { text: string }): string {
  const words = text.split(" ");
  if (words.length <= QUESTION_MAX_WORDS) {
    return text;
  }
  const head = words.slice(0, QUESTION_MAX_WORDS).join(" ");
  const at = Math.max(-1, ...[...head.matchAll(PROSE_PAUSE)].map((pause) => pause.index));
  if (at > 0) {
    return head.slice(0, at);
  }
  return head;
}

/**
 * What a run's parked REASON says beyond the question the card already prints.
 *
 * A `WAITING ON OWNER` row's reason is built as `waiting on the owner: <question>` — one line, for a board
 * that has nowhere else to put the question (`src/handover/boardEvidence.ts`, `waitingReason`). That is
 * right there and wrong here: the card prints the question already, so appending the reason printed the
 * whole record twice. MEASURED — repro: `slopweaver handover list --json`, keep the rows
 * whose `ownerWait` is none of `not-waiting`, `settled`, `already-ruled` and `not-runnable`, with a question, and count the ones whose `reason` contains their own
 * `question` — 21 of 21. The doubling was every row, not one bad record.
 *
 * It removes the question and keeps what is left, which is not always nothing: `waitingReason`'s other arm
 * puts a pre-approved-stop line before the question, and that line is the row's most important fact. A
 * blanket "drop the reason" would have deleted it.
 *
 * @param reason the row's reason exactly as the board wrote it
 * @param question the row's question, as the card prints it
 * @returns what the reason adds, or the empty string when it adds nothing
 */
export function reasonBeyondQuestion({ reason, question }: { reason: string; question: string }): string {
  const asked = question.trim();
  // The empty guard is load-bearing: `indexOf("")` answers 0, so without it an absent question would
  // splice the reason at position zero rather than leaving it alone.
  if (asked.length === 0 || !reason.includes(asked)) {
    return reason.trim();
  }
  // EVERY occurrence, not the first: review pass r2 found that a reason quoting its question twice would
  // have left the second copy, and one copy of a 1,562-character question is the wall this exists to remove.
  const left = reason.split(asked).join(" ");
  // The two punctuation classes are deliberately the SAME: the trailing one once omitted the full stop,
  // so a remainder ending in one rendered "The run is parked: waiting on the owner.." — `askCard` writes
  // the sentence's own stop. Zero of the 43 board rows reach it today; that is the data, not the code.
  return left
    .replace(/\s+/gu, " ")
    .replace(/^[\s:;,.—-]+/u, "")
    .replace(/[\s:;,.—-]+$/u, "")
    .trim();
}

/**
 * The card for a run parked on a recorded question.
 *
 * No press: `handover answer` is gated on the run's own writer session, which this page is not, and a
 * button that would always be refused is worse than none.
 *
 * @returns the card
 */
export function askCard({ row }: { row: AskRecord }): BriefingCard {
  const asked = readable({ text: row.question });
  // The lead is picked from the question AS RECORDED, the text the recording verbs' gate judged, and only
  // then made readable: a page named `v1.` reads as "the v1. page", a sentence break the gate never saw.
  const lead = readable({ text: leadQuestion({ text: row.question }) });
  // The lead sentence is already the card's question, so `what` opens at the sentence after it rather
  // than repeating one line twice above the fold.
  const rest = asked.startsWith(lead) ? asked.slice(lead.length).trim() : asked;
  // The reason usually restates the whole question — see `reasonBeyondQuestion`. Appended anyway, it put
  // the record on the page twice.
  const beyond = reasonBeyondQuestion({ question: asked, reason: readable({ text: row.reason }) });
  const parked = beyond.length === 0 ? "" : ` The run is parked: ${beyond}.`;
  const own = row.artifactPage === undefined ? [] : [row.artifactPage];
  return {
    examples: askExamples({ row }),
    head: askHead({ lead }),
    // No `if silent` and no `why you`: each was ONE sentence drawn on every ask card, and the owner's spoken words over the
    // cards the console voice read never once reacted to either. MEASURED — repro,
    // one distinct value each across every card read: `grep -ho '\\"whyYou\\":\\"[^\\]*'
    // $SLOPWEAVER_HOME/talk/calls/*.jsonl | sort | uniq -c` (and `ifSilent`). The same boilerplate is
    // absent from the hand card (`StepCard`).
    ifSilent: undefined,
    lean: saidText({ text: row.lean }),
    options: askOptions({ row }),
    commands: row.commands,
    pages: [...own, ...localPagesIn({ text: row.question }).filter((page) => !own.some((o) => o.url === page.url))],
    problem: saidText({ text: row.problem }),
    stakes: askStakes({ row }),
    // The lead as written, never labelled. Every verb that records an ask — `ask`, `correct`, `register` —
    // refuses one whose opening asks nothing (`src/handover/cardAlignment.ts`), so a statement here is an old
    // row to reword, and a prefix bolted onto it reads as nonsense ("No question stated: yes to the exact Vanta
    // write …").
    question: lead,
    subject: row.slug,
    what: whatOf({ text: `${rest}${parked}` }),
    kind: "briefing",
    whyYou: undefined,
  };
}

/**
 * An ask card's example slot — the row's scenes, its gap line, or the plain admission that it recorded neither.
 *
 * A blank scene counts as none, as a blank lean does: a numbered slot drawing an empty paragraph would read as a
 * scene the page failed to load.
 *
 * @param row the board's row
 * @returns what the slot draws
 */
function askExamples({ row }: { row: Pick<AskRecord, "examples" | "exampleGap"> }): CardExamples {
  const scenes = row.examples.map((text) => text.trim()).filter((text) => text.length > 0);
  if (scenes.length > 0) {
    return { kind: "scenes", scenes };
  }
  const gap = saidText({ text: row.exampleGap });
  if (gap !== undefined) {
    return { kind: "gap", line: gap };
  }
  return { kind: "unrecorded" };
}

/**
 * An ask card's head: the `Question` badge when its lead actually asks one, else none — an old row whose lead
 * states rather than asks draws unlabelled, and a Question badge above it would claim what the words do not.
 *
 * @param lead the sentence {@link leadQuestion} chose
 * @returns the head, or `undefined` on an ask that asks nothing
 */
function askHead({ lead }: { lead: string }): CardHead | undefined {
  if (!lead.endsWith("?")) {
    return undefined;
  }
  return { act: "question", context: undefined, people: [], peopleVerb: peopleVerbOf({ act: "question" }) };
}

/**
 * An ask row's stakes — stated only when all three are, because two of three reads as a whole card that is
 * merely short.
 *
 * @param row the board's row
 * @returns the stated stakes, or `undefined` when the row states fewer than all three
 */
function askStakes({ row }: { row: AskRecord }): CardStakes | undefined {
  const risk = saidText({ text: row.risk });
  const blastRadius = saidText({ text: row.blastRadius });
  const stillReal = saidText({ text: row.stillReal });
  if (risk === undefined || blastRadius === undefined || stillReal === undefined) {
    return undefined;
  }
  return { blastRadius, checkedIso: row.stillRealIso, kind: "stated", risk, stillReal };
}

/**
 * The card's options for an ask row — the RECORDED ones, and nothing the panel makes up.
 *
 * Options are never boilerplate, and each names the concrete consequence of
 * picking it. So a shaped row draws exactly what its verb recorded, and an unshaped row draws NONE — the reaction
 * field above them is how the owner answers it, and "answer it / read the thread / leave it" says nothing a reader of
 * the card does not already know. Doing nothing is still a real choice, and on an ask its cost is always the same — the
 * run stays parked on the owner — so a fourth option saying so would be the same boilerplate.
 *
 * The offered draft keeps its HOLD, because there the verb RECORDED it as the last destination
 * (`src/handover/askActionOptions.ts`) and it is one of the things the owner can pick.
 *
 * Every option is taken `elsewhere`: `handover answer` is gated on the run's own writer session, which this
 * page is not, and a button that would always be refused is worse than none.
 *
 * @param row the board's row
 * @returns the options in the verb's own order — empty on an ask that recorded none
 */
function askOptions({ row }: { row: AskRecord }): readonly CardOption[] {
  const leave: CardOption = {
    how: { kind: "silence" },
    letter: "",
    sentence: "Leave it: the board keeps the row parked on you and no session picks it up.",
  };
  const offered = row.offered;
  if (offered !== undefined && offered.length > 0) {
    // An OFFERED ask: the options ARE the destinations, so each one carries the line that sends it rather
    // than "the supervisor chat". The HOLD the verb recorded last is `leave` below — drawn from the panel's
    // own constant so it reads as silence, which is what it is, and never as a command to run.
    const sends = offered.map((one, index): CardOption => ({
      how: { command: one.command, kind: "elsewhere", where: one.where },
      letter: letterAfter({ count: index }),
      sentence: one.label,
      tradeoff: one.tradeoff,
    }));
    return [...sends, { ...leave, letter: letterAfter({ count: sends.length }) }];
  }
  return row.options.map((one): CardOption => ({
    how: { command: undefined, kind: "elsewhere", where: "the supervisor chat" },
    letter: one.letter,
    sentence: one.option,
    tradeoff: one.tradeoff,
  }));
}

/**
 * The letter for the option AFTER a recorded run of them.
 *
 * The verb letters its own options from A and caps them at four, so the silence option is E at the very
 * most. Read off a literal rather than computed from a char code, because a card that labelled an option
 * with an unprintable byte would still render.
 *
 * @param count how many recorded options came first
 * @returns the next letter, or the 1-based number when the count is past the verb's own cap
 */
function letterAfter({ count }: { count: number }): string {
  const after: readonly string[] = ["A", "B", "C", "D", "E"];
  const letter = after.at(count);
  if (letter === undefined) {
    return String(count + 1);
  }
  return letter;
}
