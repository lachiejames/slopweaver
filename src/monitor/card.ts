/**
 * Turning one watched subject into the hand step it posts — and refusing one the register would refuse.
 *
 * The card IS a hand step: `src/hand/` already owns the floating note, the clipboard, the Done/Later markers,
 * the reconcile and the one-banner-on-arrival push. A second card shape beside it would be a second surface
 * to keep in step, and the first time the two disagreed the owner would get two notes about one thing.
 *
 * ONE STEP PER SUBJECT, and a monitor has ONE subject — its whole set — unless it declares `perSubject`
 * (`./registry.ts`), which only a monitor whose every subject is a separate act of the owner's does: `prs-backed-up`,
 * one code-owner pick per pull request. A set subject is keyed by which members are in it, so a changed set is
 * a fresh id, never a conflicting re-posting of an open one, and `hand push` sees it as an arrival. The pass
 * refuses any other monitor's reading carrying more than one subject: 25 parked runs would fan out into 25
 * notes in one second.
 *
 * Pure: a subject and a clock reading in, a draft or a typed refusal out. No I/O.
 */

import { CONSOLE_URL_ENV, consoleQueueLink } from "../hand/consoleLink.js";
import { postingRefusal } from "../hand/posting.js";
import { opensOwnHandStep } from "../hand/queueLink.js";
import {
  buildHandStep,
  fleetActorPhrase,
  type HandStep,
  type HandStepDraft,
  MONITOR_WITNESS,
  WHAT_CAP,
} from "../hand/step.js";
import { err, ok, type Result } from "../lib/result.js";
import { type MonitorError, MonitorErrors } from "./errors.js";
import { handStepId, type MonitorDefinition, occurrenceId } from "./registry.js";
import type { MonitorSubject, SteeredSummary } from "./types.js";

/**
 * The settling line a monitor writes when a subject's condition clears on its own.
 *
 * Worded as an OBSERVATION rather than as a claim that the owner did it: the pull request may have been merged by
 * the queue, and `hand list --json` carries this text forward as what happened.
 *
 * @returns the sentence the settled row records
 */
export function clearedBy({ definition }: { definition: MonitorDefinition }): string {
  return `the monitor cleared: ${definition.resolves}`;
}

/**
 * The settling line for a subject that left the condition while its monitor still fires on others — never
 * "the monitor cleared", which would report a still-firing monitor clear.
 *
 * @param replacedBy the cards this same pass posted, named so a replaced set card points at its successor
 * @returns the sentence the settled row records
 */
export function departedWhileFiring({
  definition,
  replacedBy,
}: {
  definition: MonitorDefinition;
  replacedBy: readonly string[];
}): string {
  const replaced = replacedBy.length === 0 ? "" : `; replaced by ${replacedBy.join(", ")}`;
  return `the subject cleared, the monitor still fires: ${definition.resolves}${replaced}`;
}

/**
 * The settling line for a card whose every subject a recorded owner steer now answers — never "the monitor
 * cleared", because the rows are still stopped; the choice on the card is what went away.
 *
 * @param steers the steers the reading carries, each with how many subjects it answers
 * @returns the sentence the settled row records
 */
export function steeredBy({ steers }: { steers: readonly SteeredSummary[] }): string {
  const named = steers.map((steer) => `${steer.steerId} (${String(steer.count)}): ${steer.instead}`).join("; ");
  return `answered by a recorded steer, not cleared — ${named}`;
}

/** How the settling line for a card a newer card of the same subject replaced opens (`./passSettle.ts`). */
export const SUPERSEDED_SETTLE_OPENING = "superseded by ";

/**
 * What a departure's settling line opens with when the owner had put the card's note down first (`./passSettle.ts`): the
 * pass still wrote the line, so the wrapper never makes it the owner's close.
 */
export const PUT_DOWN_SETTLE_OPENINGS = {
  later: "the owner pressed Later on the note before it left — ",
  snoozed: "the owner snoozed the note before it left — ",
} as const;

/**
 * What doing nothing costs the owner, when the monitor declares a way to say it from its subject's own data
 * (`../hand/stepConsequence.ts`). A monitor that declares none leaves the field off, and its card draws `unblocks`.
 *
 * @param definition the monitor speaking
 * @param subject the thing it is speaking about
 * @returns the draft's `ifIgnored` field, present only when the monitor declares one
 */
function subjectCost({
  definition,
  subject,
}: {
  definition: MonitorDefinition;
  subject: MonitorSubject;
}): Pick<HandStepDraft, "ifIgnored"> {
  return definition.ifIgnored === undefined ? {} : { ifIgnored: definition.ifIgnored({ subject }) };
}

/**
 * Where a subject's card happens: the literal the owner pastes, the page the pass opens on their screen, or — no window opened
 * on it — the page cited instead, so a sentence naming the place still links it (`../hand/placeLink.ts`).
 *
 * @param subject the thing the monitor is speaking about
 * @returns the draft's `literal`, `opened` and `cites` fields, each present only when the subject carries it
 */
function subjectPlace({
  subject,
}: {
  subject: MonitorSubject;
}): Pick<HandStepDraft, "literal" | "opened"> & { cites?: readonly string[] } {
  return {
    ...(subject.literal === undefined ? {} : { literal: subject.literal }), // beside `where`, or the form refuses it
    ...(subject.opens === undefined ? {} : { opened: subject.opens }), // the pass opens it on the owner's screen (`./pass.ts`)
    ...(subject.page === undefined || subject.opens !== undefined ? {} : { cites: [subject.page] }),
  };
}

/**
 * Why a monitor's composed sentence may not be posted — too long, the fleet as its actor, or a stopped job's
 * choice offered to the owner — or `undefined` when it may.
 *
 * @param definition the monitor speaking
 * @param subject the thing it is speaking about
 * @param what the sentence the monitor composed for that subject
 * @returns the refusal, or `undefined`
 */
function cardRefusal({
  definition,
  subject,
  what,
}: {
  definition: MonitorDefinition;
  subject: MonitorSubject;
  what: string;
}): MonitorError | undefined {
  if (what.length > WHAT_CAP) {
    return MonitorErrors.cardTooLong({
      cap: WHAT_CAP,
      field: `what (${definition.id}/${subject.id})`,
      length: what.length,
    });
  }
  const offending = fleetActorPhrase({ what });
  if (offending !== undefined) {
    // A declaration defect rather than a runtime one — `unit/monitor/registry.test.ts` asserts every
    // monitor's sentence clears this, so reaching it means a registry edit broke the rule.
    return MonitorErrors.sourceShape({
      detail: `its card names the fleet as the actor: "${offending}"`,
      monitorId: definition.id,
    });
  }
  // A subject with no decision offers nothing beyond its sentence.
  const optionLines = subject.decision === undefined ? [] : subject.decision.options.map((option) => option.option);
  const choice = restartRepairRetireChoice({ texts: [what, ...optionLines] });
  if (choice !== undefined) {
    return MonitorErrors.sourceShape({
      detail: `its card offers the owner ${choice.join(" / ")} — a stopped job is never the owner's choice: a seat takes the repair (\`slopweaver automation repair\`) and the owner gets a note`,
      monitorId: definition.id,
    });
  }
  return undefined;
}

/**
 * Compose the hand step one subject posts, or refuse it.
 *
 * The cap check is here rather than left to `buildHandStep` for one reason: a monitor's sentence is BUILT
 * from a subject's own label, so it grows with data and a cap is reached by arithmetic rather than by an
 * author typing too much. Refusing here names the monitor and the subject; refusing inside the register would
 * name only a field.
 *
 * @param definition the monitor speaking
 * @param subject the thing it is speaking about
 * @param nowIso the instant the step is posted at
 * @param postedBy which session recorded it — provenance, never proof
 * @returns the draft the hand register takes, or why it could not be composed
 */
export function composeHandStep({
  definition,
  subject,
  nowIso,
  postedBy,
}: {
  definition: MonitorDefinition;
  subject: MonitorSubject;
  nowIso: string;
  postedBy: string;
}): Result<HandStepDraft, MonitorError> {
  const what = definition.what({ subject });
  const refused = cardRefusal({ definition, subject, what });
  if (refused !== undefined) {
    return err(refused);
  }
  return ok({
    // The monitor's DECLARED context, never one guessed from the card's words — it decides the queue tier.
    ...(definition.context === undefined ? {} : { context: definition.context }),
    // News with nothing waiting on the owner: drawn on the note, left off every list of what waits (`../hand/step.ts`).
    ...(definition.notice === undefined ? {} : { notice: true }),
    // A card that STOPS the owner's work stands after their priorities every day it stands — the registry's word, never the id's.
    ...(definition.stopsWork === undefined ? {} : { stopsWork: true }),
    // A check-in the fleet is already acting on, ranked after what waits on the owner (`../waiting/rank.ts`).
    ...(subject.checkIn === true ? { checkIn: true } : {}),
    // The subject's own decision, whole, when its card is a choice nothing else records (`../hand/decisionContext.ts`).
    ...(subject.decision === undefined ? {} : { decision: subject.decision }),
    ...(subject.details === undefined ? {} : { details: subject.details }), // capped by the register, never cut here
    id: handStepId({ prefix: definition.prefix, subject }),
    ...subjectCost({ definition, subject }),
    ...subjectPlace({ subject }),
    ...(definition.where === undefined ? {} : { where: definition.where }),
    postedBy,
    postedIso: nowIso,
    unblocks: definition.unblocks({ subject }),
    what,
    witness: MONITOR_WITNESS,
  });
}

/** The three choices a stopped job's card may never ask the owner to pick between, each with its inflections. */
const STOPPED_JOB_CHOICES: readonly { readonly word: string; readonly pattern: RegExp }[] = [
  { pattern: /\brestart(?:s|ed|ing)?\b/i, word: "restart" },
  { pattern: /\brepair(?:s|ed|ing)?\b/i, word: "repair" },
  { pattern: /\bretir(?:e|es|ed|ing|ement)\b/i, word: "retire" },
];

/**
 * The restart / repair / retire choice, when a card's words offer it — two or more of the three, anywhere in
 * its sentence or its decision's option lines.
 *
 * A job that stopped is fixed by a seat and the owner is told, so a card asking the owner to choose how is refused
 * by its SHAPE rather than left to a review to catch. One of the words alone is
 * ordinary — "Seat a repair for …" names one act, not a choice — so the refusal needs two distinct ones.
 *
 * @param texts the card's sentence and each option line
 * @returns the distinct choice words found, in declared order, or `undefined` when fewer than two appear
 */
export function restartRepairRetireChoice({ texts }: { texts: readonly string[] }): readonly string[] | undefined {
  const found = STOPPED_JOB_CHOICES.filter((choice) => texts.some((text) => choice.pattern.test(text))).map(
    (choice) => choice.word,
  );
  if (found.length < 2) {
    return undefined;
  }
  return found;
}

/** Why one arrival could not be posted, and the step id it was for. */
interface ArrivalRefusal {
  readonly detail: string;
  readonly stepId: string;
}

/** Which recording of a subject's card a build is for, and the console origin its own link opens on. */
interface ArrivalAddress {
  /** 1 for the base id, `n` for the `.n` a subject returning past spent ids is recorded under (`./registry.ts`). */
  readonly occurrence: number;
  /** The console origin, `SLOPWEAVER_CONSOLE_URL` or `yarn console`'s own (`../hand/consoleLink.ts`). */
  readonly consoleBase: string;
}

/**
 * The hand step one arrival is posted as, falling back to the monitor's {@link MonitorDefinition.plainWhat} sentence
 * when the register or the posting form refuses the subject's own. The form is the one `hand post` runs, so a
 * monitor card that opens nothing holding its choice, or uses a word the owner does not, is refused like any other.
 *
 * Every card opens ITSELF on the console queue — `hand:<the id it is recorded under>` — because the posting form
 * refuses a step that does not say where it happens (`../hand/posting.ts`'s `addressRefusal`), and a monitor card's
 * place is its own queue item, where its decision, when it carries one, is drawn. The link is minted per occurrence,
 * so a `.2` recording opens `hand:<base>.2`, never the base card already settled.
 *
 * @param definition the monitor speaking
 * @param subject the thing it is speaking about
 * @param nowIso the instant the step is posted at
 * @param postedBy which session recorded it — provenance, never proof
 * @param address which occurrence of the card this is, and the console origin its link opens on
 * @returns the built step, or the refusal and the step id it was for
 */
export function buildArrival({
  definition,
  subject,
  nowIso,
  postedBy,
  address,
}: {
  definition: MonitorDefinition;
  subject: MonitorSubject;
  nowIso: string;
  postedBy: string;
  address: ArrivalAddress;
}): Result<HandStep, ArrivalRefusal> {
  const own = builtFrom({ address, definition, nowIso, postedBy, subject });
  const { plainWhat } = definition;
  if (own.isOk() || plainWhat === undefined) {
    return own;
  }
  const plainDefinition = { ...definition, what: () => plainWhat };
  return builtFrom({ address, definition: plainDefinition, nowIso, postedBy, subject });
}

/** One attempt at {@link buildArrival}: compose the draft, address it to its own card, then let the register judge it. */
function builtFrom({
  definition,
  subject,
  nowIso,
  postedBy,
  address,
}: {
  definition: MonitorDefinition;
  subject: MonitorSubject;
  nowIso: string;
  postedBy: string;
  address: ArrivalAddress;
}): Result<HandStep, ArrivalRefusal> {
  const draft = composeHandStep({ definition, nowIso, postedBy, subject });
  if (draft.isErr()) {
    return err({ detail: draft.error.message, stepId: subject.id });
  }
  const id = occurrenceId({ base: draft.value.id, occurrence: address.occurrence });
  if (definition.notice !== undefined) {
    // A notice is on no queue, so it opens no queue card — it says so instead, unless its
    // subject carries the page the news IS, which its Open button opens (`meeting-prep-due`'s prep page). A subject may
    // say its own sentence: a steer note on a question to the owner names the Queue card that question already has.
    if (subject.address !== undefined) {
      return judged({ draft: { ...draft.value, id, url: subject.address } });
    }
    if (subject.unaddressed !== undefined) {
      return judged({ draft: { ...draft.value, id, unaddressed: subject.unaddressed } });
    }
    return judged({ draft: { ...draft.value, id, unaddressed: definition.notice.unaddressed } });
  }
  // A base carrying a query or a fragment mints a link that is not the card's own, whatever it then parses to: a base
  // ending `?open=hand%3A<id>&` mints a link that reads as the very card it named. Refused
  // here on the BASE rather than by tightening `opensOwnHandStep`, which the go-ahead gate reads the other way round.
  if (/[?#]/u.test(address.consoleBase)) {
    return err({
      detail: `the console base ${address.consoleBase} carries a query or a fragment, so the link it mints does not open hand:${id} — set ${CONSOLE_URL_ENV} to an http(s) origin, with a path if the console has one, and no query or fragment`,
      stepId: id,
    });
  }
  const url = consoleQueueLink({ base: address.consoleBase, context: definition.context, key: `hand:${id}` });
  if (url.isErr()) {
    return err({ detail: url.error.join("; "), stepId: id });
  }
  // Minted from a configured base, so checked rather than trusted: a base carrying a query or a fragment mints a
  // link that opens no card at all, and a card recorded with it would say where it happens while pointing nowhere.
  if (!opensOwnHandStep({ id, url: url.value })) {
    return err({
      detail: `the console base ${address.consoleBase} mints ${url.value}, which does not open hand:${id} — set ${CONSOLE_URL_ENV} to an http(s) origin, with a path if the console has one, and no query or fragment`,
      stepId: id,
    });
  }
  return judged({ draft: { ...draft.value, id, url: url.value } });
}

/** Let the register build a draft, then the posting form judge it — the last two steps of {@link builtFrom}. */
function judged({ draft }: { draft: HandStepDraft }): Result<HandStep, ArrivalRefusal> {
  const id = draft.id;
  const built = buildHandStep({ draft });
  if (built.isErr()) {
    return err({ detail: built.error.message, stepId: id });
  }
  // The posting form `hand post` answers to, asked here too: a monitor card is a posting like any other, and
  // skipping this lets context-free cards reach the owner's queue (`../hand/posting.ts`).
  const refused = postingRefusal({ step: built.value });
  if (refused !== undefined) {
    return err({ detail: refused.message, stepId: id });
  }
  return ok(built.value);
}
