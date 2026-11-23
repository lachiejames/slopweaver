/**
 * The hand-step failures that refuse a step at POSTING time because of its own fields or text: an absent or
 * malformed field, an id that is not a slug, and every sentence-level rule (the fleet as the actor, a proof
 * witness, a fleet word, a decision with no ask, a purchase ask, a secret name the registry will not take).
 *
 * `./errors.ts` composes this sub-union with the register and surface groups into the one `HandStepError`, and
 * spreads this factory into the one `HandStepErrors`. A new posting-time refusal goes here.
 */
import { handStepKindsPhrase } from "./handKinds.js";

/** A field is absent, empty, too long, or not the shape its own rule requires. */
export interface InvalidFieldError {
  readonly code: "INVALID_FIELD";
  readonly message: string;
  readonly field: string;
}

/** The id is not a slug, so it cannot be typed back at `hand done` or matched across two writes. */
export interface InvalidIdError {
  readonly code: "INVALID_ID";
  readonly message: string;
  readonly id: string;
}

/**
 * The step's own sentence names the FLEET as the actor, so it is not a hand step at all.
 *
 * The one refusal that keeps this register from becoming a second board: a session that can perform a step
 * itself must perform it, and a row saying "the session rotates the key" is work being filed rather than
 * done.
 */
export interface FleetCanDoItError {
  readonly code: "FLEET_CAN_DO_IT";
  readonly message: string;
  /** The phrase naming the fleet, so the sentence can be rewritten rather than guessed at. */
  readonly phrase: string;
}

/**
 * The step's `unblocks` names a proof, so it asks the owner for a witness the fleet takes itself.
 *
 * A POSTING refusal, never a read one: `../step.ts`'s `proofWitnessStep` says why.
 */
export interface ProofWitnessIsOursError {
  readonly code: "PROOF_WITNESS_IS_OURS";
  readonly message: string;
  /** The proof word `unblocks` carried, so the poster can see what to take out. */
  readonly phrase: string;
}

/**
 * The step's sentence carries a word that is the fleet's and not the owner's, so the owner cannot act on it without looking
 * it up. A POSTING refusal, never a read one: `../step.ts`'s `fleetWordInWhat` says why.
 */
export interface FleetWordError {
  readonly code: "FLEET_WORD";
  readonly message: string;
  /** The fleet word the sentence carried, so the poster can see what to say plainly instead. */
  readonly word: string;
}

/**
 * The step asks the owner to DECIDE and opens nothing that carries the choice, so its card could only offer the note's
 * own buttons as options. A POSTING refusal, never a read one: `./decision.ts`'s `decisionWithoutAsk` says why.
 */
export interface DecisionWithoutAskError {
  readonly code: "DECISION_WITHOUT_ASK";
  readonly message: string;
  /** The phrase that made the sentence a decision, so the poster can see what the rule read. */
  readonly phrase: string;
}

/**
 * The step asks the owner to buy, raise or top up a plan, a subscription, usage or credits — money the owner ruled
 * they will not spend. A POSTING refusal with no hatch: `./purchase.ts`'s `purchaseAsk` says why.
 */
export interface PurchaseAskError {
  readonly code: "PURCHASE_ASK";
  readonly message: string;
  /** The phrase that read as a purchase ask, so the poster can see what to take out. */
  readonly phrase: string;
}

/**
 * The step tells the owner to run `slopweaver secrets set <name>` for a name the shipped secrets registry has no row for,
 * so their paste would be refused "unknown secret name". A POSTING refusal: `./secretName.ts` says why, and `hand
 * post` names the branch that adds the row beside it.
 */
export interface SecretNameUnregisteredError {
  readonly code: "SECRET_NAME_UNREGISTERED";
  readonly message: string;
  /** Every name the step pastes that the registry lacks, in the order the step names them. */
  readonly names: readonly string[];
}

/**
 * The step tells the owner to run `slopweaver secrets set <name>` for a registry row `secrets set` refuses — a grant file,
 * a hand-installed file or a retired name. A POSTING refusal: `./secretName.ts` says why.
 */
export interface SecretNameUnsettableError {
  readonly code: "SECRET_NAME_UNSETTABLE";
  readonly message: string;
  readonly name: string;
  /** How the registry says that value really gets into the store. */
  readonly writtenBy: string;
  /** Whether the row is retired, so nothing reads it and `writtenBy` is history. */
  readonly retired: boolean;
}

/** Every posting-time refusal of a hand step's own fields or text. */
export type HandPostingError =
  | InvalidFieldError
  | InvalidIdError
  | FleetCanDoItError
  | ProofWitnessIsOursError
  | FleetWordError
  | DecisionWithoutAskError
  | PurchaseAskError
  | SecretNameUnregisteredError
  | SecretNameUnsettableError;

/** Constructors for {@link HandPostingError}, spread into `HandStepErrors` by `./errors.ts`. */
export const HandPostingErrors = {
  invalidField: ({ field, why }: { field: string; why: string }): InvalidFieldError => ({
    code: "INVALID_FIELD",
    field,
    message: `${field} ${why}`,
  }),
  invalidId: ({ id }: { id: string }): InvalidIdError => ({
    code: "INVALID_ID",
    id,
    message:
      `"${id}" is not a step id — lowercase letters and digits separated by single hyphens or dots, ` +
      "2-60 characters. The owner types it back at `slopweaver hand done`, so it has to be short and sayable",
  }),
  fleetCanDoIt: ({ phrase }: { phrase: string }): FleetCanDoItError => ({
    code: "FLEET_CAN_DO_IT",
    message:
      `the step names the fleet as the actor with "${phrase}", so it is not a step only the owner's hands can take ` +
      `— go and do it. This register is for ${handStepKindsPhrase()}: the narrow set where ` +
      "a session has genuinely run out of ability",
    phrase,
  }),
  proofWitnessIsOurs: ({ phrase }: { phrase: string }): ProofWitnessIsOursError => ({
    code: "PROOF_WITNESS_IS_OURS",
    message:
      `the step says it unblocks a proof ("${phrase}"), and a proof witness is the fleet's own to take ` +
      "(an owner ruling) — take it yourself, posting the human half as the owner to the bot, never to a colleague, if the proof needs " +
      "one. If the owner should still try what landed, re-post with --unblocks naming what it gives THEM, not a proof",
    phrase,
  }),
  purchaseAsk: ({ phrase }: { phrase: string }): PurchaseAskError => ({
    code: "PURCHASE_ASK",
    message:
      `the step asks the owner to spend money ("${phrase}"), and the owner's ruling is that enough plans ` +
      "are bought and nobody asks for more money. There is no override. A cap is answered by routing and the " +
      "`codex plan-fallback` / `codex review-fallback` passes until the reset; a Codex cap note names only the " +
      "capped accounts and when each resets",
    phrase,
  }),
  fleetWord: ({ word, means }: { word: string; means: string }): FleetWordError => ({
    code: "FLEET_WORD",
    message:
      `the step says "${word}", which is the fleet's word and not the owner's (it means: ${means}) — say what to do in ` +
      "words the owner already has, naming the page and the button, so the note never sends them digging for what a " +
      "term means",
    word,
  }),
  decisionWithoutAsk: ({ phrase, id }: { phrase: string; id: string }): DecisionWithoutAskError => ({
    code: "DECISION_WITHOUT_ASK",
    message:
      `the step asks the owner to decide ("${phrase}") and opens no item carrying the choice, so its card could only ` +
      "offer the note's own buttons as options. Record the decision as a shaped ask first — `slopweaver handover " +
      "ask --problem --options --lean --risk --blast-radius --still-real` — then post this step with " +
      `--open ask:<slug>, so the card draws the real options, their trade-offs and the context. ` +
      `A step the owner performs rather than decides may open itself (--open hand:${id}); if ", or" names what happens ` +
      'when the owner does not act, say it without one ("Press Continue before the window closes")',
    phrase,
  }),
  secretNameUnregistered: ({ names }: { names: readonly string[] }): SecretNameUnregisteredError => ({
    code: "SECRET_NAME_UNREGISTERED",
    message:
      `the step has the owner run \`slopweaver secrets set\` for ${names.join(", ")}, and the secrets registry this ` +
      `checkout ships (src/secrets/registry.ts) has no row for ${names.length === 1 ? "it" : "them"}, so their paste ` +
      'would be refused "unknown secret name". A hand step is never posted before the verb it needs: land the ' +
      "branch that adds the row, pull the main checkout, then post the step",
    names,
  }),
  secretNameUnsettable: ({
    name,
    writtenBy,
    retired,
  }: {
    name: string;
    writtenBy: string;
    /** Whether the row is retired — nothing reads it, so its `writtenBy` is history, never a step to post. */
    retired: boolean;
  }): SecretNameUnsettableError => {
    const route = retired
      ? "it is retired, so nothing reads it: drop it from the step and have the owner store nothing"
      : `its value gets into the store by: ${writtenBy}. Post that step instead`;
    return {
      code: "SECRET_NAME_UNSETTABLE",
      message:
        `the step has the owner run \`slopweaver secrets set ${name}\`, and the secrets registry says \`secrets set\` ` +
        `refuses that name — ${route}`,
      name,
      retired,
      writtenBy,
    };
  },
} as const;
