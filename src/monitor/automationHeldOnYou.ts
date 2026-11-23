/**
 * `automation-held-on-you` — an automation stopped on the owner's OWN uncleared hold, as one card per held row that
 * stands on the owner's Queue, straight after their priorities, until they answer it: a hold of theirs ("disabled for
 * now") is not a blocker on their priorities, so it ranks below them (`site/lib/queueStopping.ts`,
 * `src/waiting/queueOrder.ts`). Once the owner closes it, that hold stays answered until it is lifted or placed again.
 *
 * The first thing on the owner's Queue is this card, on any given day an automation has stopped running. An
 * automation stopped on the owner's hold needs a card, because `recipe-stopped` is about a row that stopped ON ITS
 * OWN and deliberately excludes a held one (`./evaluateStopped.ts`). This is the other card: not "seat a repair", but
 * "this is stopped on your word — lift it, keep it, or switch it off for good".
 *
 * The predicate is {@link standingHoldOf} answering `owner`, whatever `enabled` says — a hold with no finding is one
 * only the owner's word clears (`../live/automation/definition.ts`). A row merely disabled with no hold is one the
 * owner switched off for good: nothing waits on them, so it never fires. A FIX hold is a broken row the store paused,
 * which a seat repairs, so it never fires here either.
 *
 * One subject per held row (`perSubject`): each has its own reason, its own instant and its own answer, so one card for
 * the set would make the owner's one answer ambiguous. The key carries the hold's own instant, so a hold lifted and
 * placed again is a new card rather than the old one standing.
 *
 * Pure: definitions and the keys the owner closed in, a reading out. The read is `./automationHeldOnYouSource.ts`.
 */
import { standingHoldOf } from "../automations/health.js";
import { purposeOf } from "../automations/purpose.js";
import type { HandDecisionContext } from "../hand/decisionContext.js";
import { DETAIL_LINE_CAP, DETAILS_MAX } from "../hand/details.js";
import { fitLine } from "../hand/push/notice.js";
import { UNBLOCKS_CAP, WHAT_CAP } from "../hand/step.js";
import { IF_IGNORED_CAP } from "../hand/stepConsequence.js";
import type { RecipeDefinition } from "../live/automation/definition.js";

import { subjectKey } from "./evaluate.js";
import { CLOSED_BY_OWNER_SUMMARY_ID } from "./evaluateStopped.js";
import type { MonitorDefinition } from "./registry.js";
import type { MonitorReading, MonitorSubject } from "./types.js";

/** One parsed definition, with the file it was read from and its kind's own summary. */
export interface OwnerHeldAutomationInput {
  readonly definition: RecipeDefinition;
  /** The file the definition was read from — two files may carry one recipe id, and each is its own card. */
  readonly definitionFile: string;
  /** The registered kind's one-line summary, or `null` for a kind this build does not register. */
  readonly kindSummary: string | null;
}

/** The verb that prints a hold whole, named where a card ends a reason it could not carry. */
const STATUS_VERB = "slopweaver automation status";

/** What opens the first line of the hold's own words, and each line carrying more of them. */
const HOLD_OPEN = "Your hold, word for word: ";
const HOLD_MORE = "…continued: ";

/** No atlas descriptor is read on a monitor pass, so an atlas row's purpose falls to its kind's summary. */
const NO_ATLAS_QUESTIONS: ReadonlyMap<string, string> = new Map();

/** A data value as one sentence of a card: a terminator followed by a space would read as a second sentence. */
function oneSentence({ text }: { text: string }): string {
  return text
    .replaceAll(/([.?!])\s+/g, "$1")
    .replaceAll(/\s+/g, " ")
    .trim();
}

/** What a held row is called, and what it is for — or the stated reason nothing in this build says. */
interface HeldPurpose {
  readonly name: string;
  readonly forWhat: string;
}

/**
 * The held row's name and purpose: the Automations page's own purpose, which every registered kind has, else its
 * recipe id and that this build does not register its kind.
 *
 * @param input the held definition
 * @returns its name and what it is for
 */
function heldPurposeOf({ input }: { input: OwnerHeldAutomationInput }): HeldPurpose {
  const { definition } = input;
  const purpose = purposeOf({ atlasQuestions: NO_ATLAS_QUESTIONS, definition });
  if (purpose !== null) {
    return { forWhat: purpose.forWhat, name: purpose.name };
  }
  return {
    forWhat: `not recorded for this row, and this build does not register its kind, ${definition.kind}`,
    name: definition.recipeId,
  };
}

/**
 * The owner's hold reason as detail lines, word for word: a reason past one line's cap runs on to the next rather than
 * being cut, and only one longer than every line the note may carry ends on a marked cut naming the verb that prints
 * it whole. Whitespace runs fold to one space, since a detail line is one line.
 *
 * @param reason the owner's recorded reason
 * @param room how many lines the reason may take
 * @returns the lines, in order
 */
export function holdReasonLines({ reason, room }: { reason: string; room: number }): readonly string[] {
  const words = reason.replaceAll(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let line = HOLD_OPEN;
  let started = false;
  for (const word of words) {
    const joined = started ? `${line} ${word}` : `${line}${word}`;
    if (joined.length <= DETAIL_LINE_CAP) {
      line = joined;
      started = true;
      continue;
    }
    lines.push(line);
    line = fitLine({ cap: DETAIL_LINE_CAP, text: `${HOLD_MORE}${word}` });
    started = true;
  }
  lines.push(line);
  if (lines.length <= room) {
    return lines;
  }
  const kept = lines.slice(0, room - 1);
  return [...kept, `…the rest of your hold is cut here — \`${STATUS_VERB}\` prints it whole`];
}

/**
 * The decision the card asks for: lift the owner's hold, keep it standing on its own condition, or switch the row off
 * for good. "Lift" and "switch it off" rather than restart, repair or retire: `./card.ts` refuses a card offering a
 * stopped job's repair choice, which is a seat's, never the owner's. The condition is the one the owner's hold
 * records, quoted in the details below the fold — never paraphrased into an option, where a long reason would break
 * the option's cap.
 *
 * @param name what the row is called
 * @param sinceDay the day the owner's hold was placed, `YYYY-MM-DD`
 * @returns the decision, every field inside the ask shape's caps
 */
function heldDecision({ name, sinceDay }: { name: string; sinceDay: string }): HandDecisionContext {
  return {
    lean: "Keep it stopped until the condition your hold names is met; lift it once that has happened.",
    options: [
      {
        letter: "A",
        option: "Lift your hold and switch it back on",
        tradeoff: "It runs from its next slot, whether or not the condition your hold named has happened yet",
      },
      {
        letter: "B",
        option: "Keep it stopped until the condition in your recorded hold is met",
        tradeoff: "Nothing it does happens meanwhile; this card goes, and comes back only if the hold changes",
      },
      {
        letter: "C",
        option: "Switch it off for good",
        tradeoff: "Your hold clears and it stays disabled, so this card goes; bringing it back means enabling it again",
      },
    ],
    problem: `${fitLine({ cap: 60, text: name })} has been stopped on your own hold since ${sinceDay}, and only your word lifts it.`,
    stakes: {
      blastRadius: "Every run it would make until you decide, and whoever relies on what it produces.",
      risk: "Whatever it does stays undone every day the hold stands; lifting early runs it before your condition is met.",
      stillReal: `\`${STATUS_VERB} --json\` shows its hold standing, uncleared, with no finding behind it.`,
    },
  };
}

/**
 * One held definition as the card's subject, or `null` when it is not under the owner's own standing hold.
 *
 * @param input the definition, its file and its kind's summary
 * @returns the subject, or `null`
 */
export function heldSubjectOf({ input }: { input: OwnerHeldAutomationInput }): MonitorSubject | null {
  const hold = standingHoldOf({ definition: input.definition });
  if (hold?.kind !== "owner") {
    return null;
  }
  const { forWhat, name } = heldPurposeOf({ input });
  const sinceDay = hold.sinceIso.slice(0, "YYYY-MM-DD".length);
  const fixed = [
    fitLine({ cap: DETAIL_LINE_CAP, text: `Stopped on your hold since ${hold.sinceIso}` }),
    fitLine({ cap: DETAIL_LINE_CAP, text: `What it is for: ${forWhat}` }),
    fitLine({ cap: DETAIL_LINE_CAP, text: `Recipe ${input.definition.recipeId}, defined in ${input.definitionFile}` }),
  ];
  const reasonLines = holdReasonLines({ reason: hold.reason, room: DETAILS_MAX - fixed.length });
  return {
    decision: heldDecision({ name: oneSentence({ text: name }), sinceDay }),
    details: [fixed[0]!, ...reasonLines, ...fixed.slice(1)],
    id: oneSentence({ text: name }),
    key: subjectKey({ name: `${input.definition.recipeId} ${input.definitionFile} ${hold.sinceIso}` }),
    label: `stopped on your hold since ${sinceDay}`,
  };
}

/**
 * Whether the owner's close answers the hold standing now: they closed this key, and not provably before the hold was
 * placed. Only a close both instants show came EARLIER is for another hold. When either will not read — `askedIso` is
 * any non-empty string to the schema — the key is the only evidence left, and reading it as no answer re-cards the
 * owner every tick over a hold they did answer.
 *
 * The residue, stated: a re-placed hold whose six-hex key collides with the answered one AND whose instant falls in
 * the same millisecond as the owner's close still reads answered, since `Date.parse` keeps no finer order. What
 * would close it is a key carrying the hold's instant whole rather than digested, which re-keys every open card.
 *
 * @param closedIso the instant the owner closed the card, absent when never closed
 * @param sinceIso the instant the hold was placed
 * @returns whether the close answers this hold
 */
function answeredSince({ closedIso, sinceIso }: { closedIso: string | undefined; sinceIso: string }): boolean {
  if (closedIso === undefined) {
    return false;
  }
  const closedMs = Date.parse(closedIso);
  const sinceMs = Date.parse(sinceIso);
  if (Number.isNaN(closedMs) || Number.isNaN(sinceMs)) {
    return true;
  }
  return closedMs >= sinceMs;
}

/** What a held row whose card the owner already closed reads as instead of a card. */
const CLOSED_HOLD_WHY = "you answered this hold's card, and the hold has not changed since";

/**
 * Judge every definition: one subject per row under the owner's own standing hold, in the order the definitions came —
 * less every hold whose card the owner already closed.
 *
 * The open card is this monitor's only memory, and a held row is still held after the owner's Done, so without
 * `closed` the answer comes straight back as the next occurrence on the next supervisor tick (a measurement of that
 * recurrence reads `$SLOPWEAVER_HOME/hand-steps/steps.jsonl`, `grep mon-held-`: closed cards of held rows rose again
 * as `.2` and `.3`). So the hold is on the KEY, which carries the hold's own instant: a hold lifted and placed again
 * is a new key, and a new card. The key is a six-hex digest, so a re-placed hold CAN share one (two `askedIso`s a
 * second apart do); the owner's close counts only when it came at or after the hold's own instant, since a close
 * before the hold was placed answered an earlier one. Steered rather than a firing subject held back, so the pass
 * settles any other open card of this monitor, exactly as `./evaluateStopped.ts`'s `closedSteers` does.
 *
 * @param rows every parsed definition, with its file and its kind's summary
 * @param closed card key → the instant the owner closed it themselves (`./heldKeys.ts` § `closedByOwner`); absent for a
 *   reader with no card history
 * @returns firing over every held row the owner has not answered, steered when they have answered every one, clear
 *   when none is held
 */
export function evaluateAutomationHeldOnYou({
  rows,
  closed = new Map(),
}: {
  rows: readonly OwnerHeldAutomationInput[];
  closed?: ReadonlyMap<string, string>;
}): MonitorReading {
  const held = rows.flatMap((input) => {
    const subject = heldSubjectOf({ input });
    const hold = standingHoldOf({ definition: input.definition });
    return subject === null || hold === null ? [] : [{ sinceIso: hold.sinceIso, subject }];
  });
  const subjects = held
    .filter(({ sinceIso, subject }) => !answeredSince({ closedIso: closed.get(subject.key), sinceIso }))
    .map(({ subject }) => subject);
  const answered = held.length - subjects.length;
  const steers =
    answered === 0 ? [] : [{ count: answered, instead: CLOSED_HOLD_WHY, steerId: CLOSED_BY_OWNER_SUMMARY_ID }];
  if (subjects.length > 0) {
    const withSteers = steers.length === 0 ? {} : { steers };
    return { monitorId: "automation-held-on-you", state: "firing", subjects, ...withSteers };
  }
  if (steers.length > 0) {
    return { monitorId: "automation-held-on-you", state: "steered", steers };
  }
  return { monitorId: "automation-held-on-you", state: "clear" };
}

/** What the card says either side of the row's name. */
const HELD_WHAT_OPEN = "Decide whether to lift your hold on ";
const HELD_WHAT_CLOSE = " — it stays stopped until you say";

/** `automation-held-on-you`: one work card per automation stopped on the owner's own uncleared hold. */
export const AUTOMATION_HELD_ON_YOU: MonitorDefinition = {
  blurb:
    "An automation stopped on the owner's own uncleared hold — one card per row, straight after their priorities on their Queue until they answer it.",
  context: "work",
  floats: true,
  id: "automation-held-on-you",
  ifIgnored: ({ subject }) =>
    fitLine({
      cap: IF_IGNORED_CAP,
      text: `${subject.id} stays stopped every day your hold stands, and this card stays on your Queue after your priorities`,
    }),
  perSubject: true,
  plainWhat: "Decide whether to lift your hold on a stopped automation — its name is below",
  prefix: "held",
  resolves:
    "the owner's hold is cleared (lifted, or cleared with the row left disabled for good), or the definition is gone",
  source:
    "$SLOPWEAVER_HOME/live/recipe/definitions/ — every definition's `hold`, read through `standingHoldOf` — and the " +
    "hand register, for the cards the owner closed",
  stopsWork: true,
  unblocks: ({ subject }) =>
    fitLine({ cap: UNBLOCKS_CAP, text: `${subject.id} — nothing it does runs until you decide on your hold` }),
  what: ({ subject }) =>
    `${HELD_WHAT_OPEN}${fitLine({ cap: WHAT_CAP - HELD_WHAT_OPEN.length - HELD_WHAT_CLOSE.length, text: subject.id })}${HELD_WHAT_CLOSE}`,
};
