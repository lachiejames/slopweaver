/**
 * THE HAND STEP — the one thing the owner must do right now, in the form that makes it performable.
 *
 * A floating macOS note carries the one step the owner must do right now (copy this, paste it there, click
 * that), so a run that needs the owner's hand reaches them when they are not looking at the window it happened
 * in. This module owns the RECORD and every rule about it; `./store.ts` writes it, `./note/` draws it and
 * `./push/` pings the owner about it.
 *
 * ## Why `unblocks` and `witness` are REQUIRED
 *
 * A step reading "sign in to Google Cloud", with nothing else on it, sends the owner hunting for what it was for
 * and how to say it is done — which is the exact context switch this feature exists to remove, re-created by
 * the feature meant to remove it. So a row cannot exist without naming what is waiting on it and the command
 * that settles it. `literal`, `where` and `url` are optional because a real step sometimes has none of them,
 * and a required field nobody can fill honestly gets filled dishonestly.
 *
 * ## The refusal: a step the fleet could take itself
 *
 * Under graduated autonomy (`AGENTS.md` rule 10) a session that can do a thing does it. A row saying "the
 * session rotates the key" is work being FILED rather than done, and a register that accepts those becomes
 * the fourth board the owner abandons. So {@link fleetActorPhrase} refuses a sentence naming the fleet as its
 * actor — see its own note for why a verb list is not the criterion here. A proof witness is the same case,
 * so {@link proofWitnessStep} refuses a step whose `unblocks` names one.
 *
 * Everything in this file is pure, total and clock-free: the caller supplies the instant.
 */
import { ownHandAction } from "../briefing/ownHandAction.js";
import { err, ok, type Result } from "../lib/result.js";
import { fleetWordsIn } from "../talk/glossary.js";
import { type WaitingTier, waitingTierOf } from "../waiting/rank.js";

import type { HandChecklistItem } from "./checklist.js";
import { checkedHandDecision, type HandDecisionContext } from "./decisionContext.js";
import { type HandStepError, HandStepErrors } from "./errors.js";
import type { HandQuote } from "./quotes.js";
import { checkedRecheck, type HandRecheck } from "./recheckShape.js";
import type { HandShot } from "./shot.js";
import { checkedAddress } from "./stepAddress.js";
import { checkedAttachments } from "./stepAttachments.js";
import { checkedIfIgnored } from "./stepConsequence.js";
import { checkedMarks, markPieces } from "./stepMarks.js";
import { requiredText } from "./stepText.js";

/**
 * How long the one sentence may be.
 *
 * It is the note's own headline and the notification's own body, and rule 7 caps what a reader cannot avoid
 * — so the cap is the narrower of the two surfaces rather than a round number. Measured on the panel at its
 * shipped width (`./note/panel.ts`'s `PANEL_WIDTH`, 15pt system font): 120 characters wrap to three lines
 * and still read; more starts clipping. Reproduce with `slopweaver hand post --what "$(printf 'x%.0s' {1..130})"`.
 */
export const WHAT_CAP = 120;

/** How long what is waiting on the step may be. Read in `hand list` and in the note's footer, never a banner. */
export const UNBLOCKS_CAP = 200;

/** How long the settling command may be. A verb line, never a paragraph. */
export const WITNESS_CAP = 200;

/** The settling command every monitor card carries (`../monitor/card.ts`) — how a posting rule tells one apart. */
export const MONITOR_WITNESS = "slopweaver monitor check --fire";

/**
 * How long the settling account may be.
 *
 * NOT `WITNESS_CAP`, and the difference is the whole reason this constant exists. `witness` is a COMMAND —
 * "a verb line, never a paragraph" — while `did` is PROSE about what happened, written by whoever watched
 * it. Sharing the command's cap bricked the live register once: a session settled
 * `gh-workflow-scope` with a 486-character account of why the step had been wrong and was being withdrawn,
 * `slopweaver hand done` wrote it without a check, and every read afterwards refused on that line. The
 * account was good writing; the cap was borrowed from a field with the opposite job.
 *
 * So the limit is about a FILE rather than about attention, which is the reasoning and the number of
 * `./stepAddress.ts`'s `LITERAL_CAP`: `did` is drawn on no surface — `hand done` echoes it and the register keeps it, and nothing else
 * reads it at all. Reproduce the failure it closes with
 * `slopweaver hand done <id> --did "$(printf 'x%.0s' {1..300})" --home <dir> && slopweaver hand list --home <dir>`.
 */
export const DID_CAP = 2_000;

/** The id's shape — short, lowercase, sayable, because the owner types it back at `hand done`. */
const ID = /^[a-z0-9]+(?:[-.][a-z0-9]+)*$/;

/** The id's length bounds, matching `../autonomy/row.ts`'s kind so two registers do not disagree on a slug. */
const ID_MIN = 2;
const ID_MAX = 60;

/**
 * A literal that is nothing but a link, optionally quoted.
 *
 * `open file:///…/index.html` as a literal hands the owner a command to copy, a terminal to find and a
 * paste, standing between them and a page one click could have shown.
 */
const BARE_LINK = /^(["']?)(?:https?:\/\/|file:\/\/)\S+\1$/i;

/**
 * An `open` or `xdg-open` line that names a link anywhere in it — flags, an application, a quoted path with
 * a space. `open -a "Google Chrome" file:///…` is the same paste as the bare form; `open -a Slack` names
 * no link and is left alone.
 */
const OPENS_A_LINK = /^(?:xdg-)?open\s(?:.*\s)?["']?(?:https?|file):\/\//is;

/**
 * A proof grade, or proof itself, named as what a step unblocks.
 *
 * A bare word rather than a collocation, unlike `../briefing/fleetJargon.ts`'s grade sense, because the field
 * it reads is narrower than a card: `unblocks` says what is waiting on the owner, and on this register nothing but a
 * pull request's proof has ever carried one of these words. MEASURED: 9 of the 37 steps then posted
 * matched, every one a gold proof or a PR's proof. Reproduce with
 * `grep -c '"kind":"posted"' "$SLOPWEAVER_HOME/hand-steps/steps.jsonl"` and the same pattern over `unblocks`.
 */
const PROOF_WORD = /\b(?:gold|silver|bronze|proofs?)\b/i;

/**
 * A sentence terminator with more text after it — what makes a `what` two sentences rather than one. Exported for
 * `../incident/findingFields.ts`, whose `meaning` opens a headline and so is refused on the same test.
 */
export const SECOND_SENTENCE = /[.?!]\s+\S/;

/**
 * The fleet, named as the actor of a step.
 *
 * **Why this rather than the verb list `../briefing/ownHandAction.ts` uses.** That gate's `HAND_ACTION` list
 * is deliberately short, and it carries no `sign`, no `approve` and no `pick` — so inverting it here would
 * refuse the three steps this register exists for, the owner's own flagship sign-in case first. The honest criterion
 * is the other end of the sentence: who is doing it. A session naming ITSELF has filed work it should have
 * performed, and that is checkable without guessing at a verb.
 *
 * Deliberately narrow, with an escape that needs no marker: a sentence that ALSO names the owner as the actor of a
 * hand action passes, because `ownHandAction` — the repository's own measured criterion for exactly that —
 * says it is the owner's. "Click Approve on the session's Vanta request" is the owner's step and reads as one.
 *
 * **It is a tell, not a fence, and a review pass measured where it ends.** The criterion is a determiner
 * plus one of five nouns, or `slopweaver` plus a modal, so a fleet-actor sentence phrased any other way is
 * recorded without a murmur: `Slopweaver rebases the branch` passes where `Slopweaver will rebase the branch`
 * is refused, and `Codex reviews the diff` names no noun in the set at all. The escape is the wider half —
 * `ownHandAction`'s imperative arm fires on ANY sentence opening with one of its verbs, before the fleet check
 * is reached, so `Push the branch the bot already rebased` passes on its first word. Both are the design: the
 * cost of a false refusal here is a session unable to file a step the owner really does have to take, and the cost
 * of a false pass is one junk row the owner can see. Widening the noun set is cheap; widening the escape is not.
 * Reproduce with `slopweaver hand post --id fleet-actor --what "Slopweaver rebases the branch, so the fix can land"
 * --unblocks y --witness z --standalone --blocks --quiet --no-address repro --home "$(mktemp -d)"`.
 */
const FLEET_ACTOR =
  /\b(?:the|a|this|another)\s+(?:session|fleet|bot|agent|supervisor)\b|\bslopweaver\s+(?:will|can|should)\b/i;

/**
 * Which of the two work contexts a step belongs to, when the step says so itself.
 *
 * The console's switcher reads a row's PROSE for a repository slug, and a step about the organisation's own
 * obligations names no repository at all — so "Give your ISO word on two Vanta group writes" was drawn under
 * Slopweaver as well as under Acme, which is the defect this field closes. A stated
 * context is the authoritative tier: the console prefers it over every guess it can make from the text.
 *
 * OPTIONAL, and it stays optional. Every row written before this field existed carries none, and a reader
 * that refused one would brick a live register — the console falls back to its text test for those, which is
 * a heuristic and says so. The two values are the console's own ids, restated here rather than imported:
 * `site/` and `src/` may not import each other (`tsconfig.build.json`'s `rootDir`).
 */
export type HandContext = "slopweaver" | "work";

/** One step only the owner's hands can take. */
export interface HandStep {
  /** Short, lowercase, sayable — the owner types it back at `hand done`. */
  readonly id: string;
  /** The ONE sentence: what the owner must do right now. */
  readonly what: string;
  /** The exact string the note puts on the owner's pasteboard, when the step has one. */
  readonly literal?: string;
  /** Where it goes — the field, the prompt, the console. */
  readonly where?: string;
  /** The ONE address the step happens at. */
  readonly url?: string;
  /**
   * The page the fleet already opened on the owner's screen for this step — a sign-in it ran the command for itself — so
   * the step happens in that window, which `where` names (`./runnableLiteral.ts`). Not an Open button: the note's
   * Open lands in the default browser, never the window the fleet opened. Absent on every row before the field.
   */
  readonly opened?: string;
  /**
   * Why the step has neither a `url` nor a `literal`, said out loud (`hand post --no-address`), so a card with
   * nothing to open is a stated choice rather than a silence. Absent on every row written before the field.
   */
  readonly unaddressed?: string;
  /** What is waiting on it: a run slug, a pull request, a Slack permalink. */
  readonly unblocks: string;
  /**
   * What happens if the owner does nothing, and what they might not like about it — the line they rank the card by
   * (`./stepConsequence.ts`). Absent on every row written before the field.
   */
  readonly ifIgnored?: string;
  /** The command that settles it, so the owner never has to work out how to say it is done. */
  readonly witness: string;
  readonly postedIso: string;
  /** Which session recorded it. Provenance, never proof. */
  readonly postedBy: string;
  /** Which context the step belongs to, when the poster said. Absent on every row written before the field. */
  readonly context?: HandContext;
  /**
   * The poster's word that this step is a CHECK-IN — an evaluation or a dogfood step asking whether something
   * the fleet already did is right — rather than work stopped on the owner. Every surface ranks it last
   * (`../waiting/rank.ts`). Present only as `true`; absent on every other step and every row before the field.
   * `hand post` makes the poster say `--check-in` or `--blocks` out loud, so a new step's absence is a stated
   * blocker — a dogfood step posted unmarked once led the voice's answer to "where do I start".
   */
  readonly checkIn?: true;
  /**
   * The poster's word that this step is a NOTICE — news the owner should see on their screen, with nothing waiting on
   * them: a stopped recipe a seat is already repairing, which is not a queue card or something blocked on the
   * owner. The floating note draws it; every list of what
   * waits on the owner leaves it off ({@link waitingHandSteps}). It asks nothing, so it carries no decision, no paste
   * and no check-in. Present only as `true`; absent on every other step and every row before the field.
   */
  readonly notice?: true;
  /**
   * The poster's word that this step STOPS the owner's work — an automation stopped on their word, a sync that stopped — so
   * the Queue draws it under "Stopped automations", straight after the owner's priorities, every day it stands.
   * Written
   * only by a monitor whose registry entry declares `stopsWork` (`../monitor/registry.ts`), never inferred from a
   * name. Present only as `true`; absent on every other step and every row written before the field.
   */
  readonly stopsWork?: true;
  /**
   * Every pull request and ticket the step's sentences name by number, as its address — what the queue card
   * resolves a bare number against, so the number is a chip. `url` is where the note's Open goes, most often a
   * console page, so it cannot carry them. Absent on every row written before the field.
   */
  readonly cites?: readonly string[];
  /**
   * The decision the step asks for, carried whole — problem, options, lean and stakes — when the step is a
   * choice whose only record is this card (`./decisionContext.ts`). The console draws it as the decision card.
   * Absent on every other step and every row written before the field.
   */
  readonly decision?: HandDecisionContext;
  /**
   * The board row this step unblocks, as its slug — the DATA `unblocks` says in prose. What lets the step leave
   * the owner's queue on evidence: `./evidence.ts` settles it the moment that row derives terminal, and a second open
   * step naming the same row is refused unless it supersedes the first (`./store.ts`). Absent on every row
   * written before the field, on a `--standalone` posting, and on every monitor step.
   */
  readonly row?: string;
  /**
   * The lines the note keeps behind its disclosure row — read only when the owner opens it (`./details.ts`, rule 7).
   * First carried by `fleet-unhealthy`: every failing run, when it failed and why. Absent on every other step and
   * every row written before the field.
   */
  readonly details?: readonly string[];
  /**
   * Up to three lines the room said, each with who said it and its Slack permalink, drawn ABOVE the fold directly
   * under the sentence (`./quotes.ts`). First carried by a live incident's note. Absent on every other step and every
   * row written before the field.
   */
  readonly quotes?: readonly HandQuote[];
  /**
   * The provider page the step happens on, as a stored picture with a red box around each thing to grab
   * (`./shot.ts`), so the card shows the owner where to look rather than describing it. Absent on
   * every other step and every row written before the field.
   */
  readonly shot?: HandShot;
  /**
   * The step as the script the owner runs through, one tickable line at a time — each command its own copy block, each value
   * to fetch named by where it sits on the page (`./checklist.ts`). A step carrying one carries no `literal`. Absent
   * on every other step and every row written before the field.
   */
  readonly checklist?: readonly HandChecklistItem[];
  /**
   * The precondition a sweep re-reads for itself — a sign-in the fleet can see, a channel the owner joins — so the step
   * leaves the owner's queue the tick it is already met (`./recheck.ts`). Absent on every row written
   * before the field; `hand recheck` derives one for a sign-in on a platform it reads.
   */
  readonly recheck?: HandRecheck;
}

/** What a caller hands {@link buildHandStep} — every field as typed, before a single rule has run. */
export interface HandStepDraft {
  readonly id: string;
  readonly what: string;
  readonly literal?: string | undefined;
  readonly where?: string | undefined;
  readonly url?: string | undefined;
  readonly opened?: string | undefined;
  readonly unblocks: string;
  readonly witness: string;
  readonly postedIso: string;
  readonly postedBy: string;
  /**
   * `unknown` rather than `HandContext | undefined`, because `./row.ts` hands this builder a value straight
   * off a JSONL line nobody checked. Every other field is re-validated on read for that reason; a typed
   * parameter here would move the one check that matters out of the one place a caller cannot skip.
   */
  readonly context?: unknown;
  /** `unknown` for the same reason as {@link HandStepDraft.context}: a register line nobody checked. */
  readonly checkIn?: unknown;
  /** `unknown` for the same reason as {@link HandStepDraft.context}: a register line nobody checked. */
  readonly notice?: unknown;
  /** `unknown` for the same reason as {@link HandStepDraft.context}: a register line nobody checked. */
  readonly stopsWork?: unknown;
  /** `unknown` for the same reason as {@link HandStepDraft.context}: a register line nobody checked. */
  readonly cites?: unknown;
  /** `unknown` for the same reason as {@link HandStepDraft.context}: a register line nobody checked. */
  readonly decision?: unknown;
  /** `unknown` for the same reason as {@link HandStepDraft.context}: a register line nobody checked. */
  readonly row?: unknown;
  readonly unaddressed?: unknown;
  /** `unknown` for the same reason as {@link HandStepDraft.context}: a register line nobody checked. */
  readonly details?: unknown;
  /** `unknown` for the same reason as {@link HandStepDraft.context}: a register line nobody checked. */
  readonly quotes?: unknown;
  /** `unknown` for the same reason as {@link HandStepDraft.context}: a register line nobody checked. */
  readonly shot?: unknown;
  /** `unknown` for the same reason as {@link HandStepDraft.context}: a register line nobody checked. */
  readonly checklist?: unknown;
  /** `unknown` for the same reason as {@link HandStepDraft.context}: a register line nobody checked. */
  readonly ifIgnored?: unknown;
  /** `unknown` for the same reason as {@link HandStepDraft.context}: a register line nobody checked. */
  readonly recheck?: unknown;
}

/**
 * The phrase naming the fleet as the actor, when a sentence carries one and is not also the owner's.
 *
 * @param what the step's own sentence
 * @returns the offending phrase, or `undefined` when the step is the owner's to take
 */
export function fleetActorPhrase({ what }: { what: string }): string | undefined {
  if (ownHandAction({ imperative: true, text: what }) !== undefined) {
    return undefined;
  }
  return FLEET_ACTOR.exec(what)?.[0];
}

/**
 * The step's sentence, checked as one instruction the owner can act on.
 *
 * @param what what the caller supplied
 * @returns the trimmed sentence, or the refusal
 */
function checkedWhat({ what }: { what: string }): Result<string, HandStepError> {
  const text = requiredText({ cap: WHAT_CAP, field: "what", value: what });
  if (text.isErr()) {
    return text;
  }
  if (SECOND_SENTENCE.test(text.value)) {
    return err(
      HandStepErrors.invalidField({
        field: "what",
        why: "is more than one sentence — a note carries ONE step, and the rest belongs in `where`, `unblocks` or the thread it came from",
      }),
    );
  }
  const phrase = fleetActorPhrase({ what: text.value });
  if (phrase !== undefined) {
    return err(HandStepErrors.fleetCanDoIt({ phrase }));
  }
  return ok(text.value);
}

/**
 * Where a step ranks among everything waiting on the owner — the one rule the push lane and the briefing both read.
 *
 * A check-in when its poster said so; team-blocked when it belongs to the work context; the fleet's otherwise.
 *
 * @param step the open step
 * @returns its tier
 */
export function handStepTier({ step }: { step: HandStep }): WaitingTier {
  return waitingTierOf({ checkIn: step.checkIn === true, teamFacing: step.context === "work" });
}

/**
 * Whether a string is exactly a step id — the one grammar every reader of an id off disk shares with `hand post`, so
 * a file named for anything else is no step's, and a verb printed an id can always be handed it back.
 *
 * @param id the candidate, untrimmed
 * @returns true when it is a step id as `hand post` would accept it
 */
export function isHandStepId({ id }: { id: string }): boolean {
  return id.length >= ID_MIN && id.length <= ID_MAX && ID.test(id);
}

/**
 * The step's id, checked as a slug the owner can type back.
 *
 * @param id what the caller supplied
 * @returns the trimmed id, or the refusal
 */
function checkedId({ id }: { id: string }): Result<string, HandStepError> {
  const trimmed = id.trim();
  if (trimmed.length < ID_MIN || trimmed.length > ID_MAX || !ID.test(trimmed)) {
    return err(HandStepErrors.invalidId({ id: trimmed }));
  }
  return ok(trimmed);
}

/**
 * When and by whom the step was posted, both required.
 *
 * @param draft the draft carrying the stamp
 * @returns the two fields, or the first refusal
 */
function checkedStamp({
  draft,
}: {
  draft: HandStepDraft;
}): Result<{ postedIso: string; postedBy: string }, HandStepError> {
  const postedIso = requiredText({ cap: WITNESS_CAP, field: "postedIso", value: draft.postedIso });
  if (postedIso.isErr()) {
    return err(postedIso.error);
  }
  const postedBy = requiredText({ cap: WITNESS_CAP, field: "postedBy", value: draft.postedBy });
  if (postedBy.isErr()) {
    return err(postedBy.error);
  }
  return ok({ postedBy: postedBy.value, postedIso: postedIso.value });
}

/**
 * Build one validated hand step, or say exactly which rule refused it.
 *
 * Every rule lives here rather than at the CLI edge, so a caller that is not the CLI cannot skip one — the
 * same boundary `../autonomy/row.ts` draws, and for the same reason.
 *
 * @param draft every field as the caller has it
 * @returns the validated step, or the first refusal
 */
export function buildHandStep({ draft }: { draft: HandStepDraft }): Result<HandStep, HandStepError> {
  const id = checkedId({ id: draft.id });
  if (id.isErr()) {
    return err(id.error);
  }
  const what = checkedWhat({ what: draft.what });
  if (what.isErr()) {
    return err(what.error);
  }
  const unblocks = requiredText({ cap: UNBLOCKS_CAP, field: "unblocks", value: draft.unblocks });
  if (unblocks.isErr()) {
    return err(unblocks.error);
  }
  const witness = requiredText({ cap: WITNESS_CAP, field: "witness", value: draft.witness });
  if (witness.isErr()) {
    return err(witness.error);
  }
  const optionals = checkedOptionals({ draft });
  if (optionals.isErr()) {
    return err(optionals.error);
  }
  const decision = checkedHandDecision({ value: draft.decision });
  if (decision.isErr()) {
    return err(decision.error);
  }
  const stamp = checkedStamp({ draft });
  if (stamp.isErr()) {
    return err(stamp.error);
  }
  const asks = noticeAsking({
    checkIn: optionals.value.checkIn,
    checklist: optionals.value.checklist,
    decision: decision.value,
    literal: optionals.value.literal,
  });
  if (optionals.value.notice === true && asks !== undefined) {
    return err(
      HandStepErrors.invalidField({
        field: "notice",
        why: `is set and the step also carries a ${asks} — a notice is news with nothing waiting on the owner, so it asks nothing; post a step the owner takes instead`,
      }),
    );
  }
  return ok({
    id: id.value,
    ...stamp.value,
    unblocks: unblocks.value,
    what: what.value,
    witness: witness.value,
    ...optionals.value,
    ...(decision.value === undefined ? {} : { decision: decision.value }),
  });
}

/**
 * What a step carries that asks the owner something, which a notice may not — or `undefined` when it carries none.
 *
 * @param decision the checked decision, when there is one
 * @param literal the paste, when there is one
 * @param checkIn the check-in mark, when there is one
 * @param checklist the script of steps, when there is one
 * @returns the field's name, the first one found, or `undefined`
 */
function noticeAsking({
  decision,
  literal,
  checkIn,
  checklist,
}: {
  decision: HandDecisionContext | undefined;
  literal: string | undefined;
  checkIn: true | undefined;
  checklist: readonly HandChecklistItem[] | undefined;
}): string | undefined {
  if (decision !== undefined) {
    return "decision";
  }
  if (literal !== undefined) {
    return "literal";
  }
  if (checklist !== undefined) {
    return "checklist";
  }
  if (checkIn !== undefined) {
    return "check-in";
  }
  return undefined;
}

/**
 * The open steps that wait on the owner — every one but a {@link HandStep.notice}.
 *
 * The one filter every surface listing what waits on the owner reads — `hand list` (and through its `--json` the
 * console queue), `hand push` and the Fleet Briefing — so a notice is drawn by its floating
 * note and nowhere else. A reader that acts on one id (`hand done`, `hand show`, the reconcile, the monitor
 * lane's own open ids) keeps every open step, notices included, so a notice still settles like any other.
 *
 * @param steps every open step, as `readOpenHandSteps` read them
 * @returns the same steps in the same order, less every notice
 */
export function waitingHandSteps({ steps }: { steps: readonly HandStep[] }): readonly HandStep[] {
  return steps.filter((step) => step.notice !== true);
}

/**
 * The refusal for a literal that is only a link — a POSTING rule, deliberately outside {@link buildHandStep}.
 *
 * A link belongs in `url`, where the note draws it as its primary **Open** button; as a literal it becomes a
 * command the owner copies into a terminal to read a page. That is the defect, so a new posting is refused and told
 * which flag to use rather than silently moved across: the poster learns the shape, and the register keeps
 * what was actually posted.
 *
 * Why not inside {@link buildHandStep}: `./row.ts` re-validates every register line through it on READ, and
 * rows already written carry exactly these literals. A read-side refusal would turn each of them into an
 * unreadable line, which every reading verb reports and the briefing counts as a step that may be open.
 *
 * @param step the step a caller is about to record
 * @returns the refusal, or `undefined` when the literal is something the owner genuinely pastes
 */
export function linkAsLiteral({ step }: { step: HandStep }): HandStepError | undefined {
  if (step.literal === undefined || !(BARE_LINK.test(step.literal) || OPENS_A_LINK.test(step.literal))) {
    return undefined;
  }
  return HandStepErrors.invalidField({
    field: "literal",
    why: "is a link, or a command that only opens one — pass the address as --url instead, so the note's own Open button opens it and the owner never pastes a command to read a page",
  });
}

/**
 * The refusal for a step posted to get a proof witness out of the owner — a POSTING rule, for `linkAsLiteral`'s reason.
 *
 * The rule: take the gold proof yourself under your current graduated autonomy, never block work or escalate
 * to the owner for a proof witness. A witness is the fleet's own to take; where the proof
 * needs a human half, a session posts it as the owner to the bot, never to a colleague. A note inviting the owner to TRY what landed is still
 * wanted — it just names what the step gives the owner, never a proof it would complete.
 *
 * Outside {@link buildHandStep} because the rows that prompted it are already in the register, and re-reading
 * each of them as corrupt would hide nine real steps from every reader.
 *
 * @param step the step a caller is about to record
 * @returns the refusal, or `undefined` when `unblocks` names no proof
 */
export function proofWitnessStep({ step }: { step: HandStep }): HandStepError | undefined {
  const phrase = PROOF_WORD.exec(step.unblocks)?.[0];
  if (phrase === undefined) {
    return undefined;
  }
  return HandStepErrors.proofWitnessIsOurs({ phrase });
}

/**
 * The refusal for a sentence carrying a fleet word the owner does not use — a POSTING rule, for `linkAsLiteral`'s reason.
 *
 * A step is not performable when it asks the owner to act on a term they cannot place, such as a "context pack",
 * with no page or button named. A floating note has to be very clear. The words that are the fleet's and not the
 * owner's are the glossary's own (`../talk/glossary.ts`'s `notOwners`), so the voice that explains a word and the
 * note that may not use it read one list.
 *
 * @param step the step a caller is about to record
 * @returns the refusal naming the first such word, or `undefined` when the sentence is all the owner's
 */
export function fleetWordInWhat({ step }: { step: HandStep }): HandStepError | undefined {
  const [found] = fleetWordsIn({ text: step.what });
  if (found === undefined) {
    return undefined;
  }
  return HandStepErrors.fleetWord({ means: found.entry.means, word: found.word });
}

/** The seventeen fields a step may leave off. */
type HandStepOptionals = Pick<
  HandStep,
  | "literal"
  | "where"
  | "url"
  | "opened"
  | "unaddressed"
  | "context"
  | "checkIn"
  | "checklist"
  | "notice"
  | "cites"
  | "row"
  | "details"
  | "quotes"
  | "shot"
  | "ifIgnored"
  | "recheck"
  | "stopsWork"
>;

/**
 * A draft's `recheck`, checked, as a piece to spread — empty when the draft names none.
 *
 * @param value whatever the draft carried
 * @returns the piece, or the refusal
 */
function recheckPiece({ value }: { value: unknown }): Result<{ recheck?: HandRecheck }, HandStepError> {
  return checkedRecheck({ value }).map((recheck) => (recheck === undefined ? {} : { recheck }));
}

/**
 * The seventeen fields a step may leave off, checked together so {@link buildHandStep} stays readable.
 *
 * An absent field is DROPPED rather than written as `undefined`: the register is JSONL, and a key whose
 * value is `undefined` serialises away on write and reads back as a key that was never there — so building
 * the object without it is what makes a round trip byte-stable.
 *
 * @param draft every field as the caller has it
 * @returns just the optionals that were supplied, or the first refusal
 */
function checkedOptionals({ draft }: { draft: HandStepDraft }): Result<HandStepOptionals, HandStepError> {
  const attachments = checkedAttachments({ draft }).andThen((pieces) =>
    checkedIfIgnored({ value: draft.ifIgnored }).andThen((ifIgnored) =>
      recheckPiece({ value: draft.recheck }).map((recheck) => ({ ...pieces, ifIgnored, recheck })),
    ),
  );
  if (attachments.isErr()) {
    return err(attachments.error);
  }
  const address = checkedAddress({ draft });
  if (address.isErr()) {
    return err(address.error);
  }
  const { literal, opened, unaddressed, url, where } = address.value;
  const marks = checkedMarks({ draft }).map((checked) => markPieces({ marks: checked }));
  if (marks.isErr()) {
    return err(marks.error);
  }
  // The key order a register line has always printed in (`hand list --json` stringifies the step as built).
  return ok({
    ...marks.value.checkIn,
    ...attachments.value.checklist,
    ...attachments.value.cites,
    ...marks.value.context,
    ...attachments.value.details,
    ...attachments.value.ifIgnored,
    ...(literal === undefined ? {} : { literal }),
    ...marks.value.notice,
    ...(opened === undefined ? {} : { opened }),
    ...attachments.value.quotes,
    ...attachments.value.recheck,
    ...marks.value.row,
    ...attachments.value.shot,
    ...marks.value.stopsWork,
    ...(url === undefined ? {} : { url }),
    ...(unaddressed === undefined ? {} : { unaddressed }),
    ...(where === undefined ? {} : { where }),
  });
}
