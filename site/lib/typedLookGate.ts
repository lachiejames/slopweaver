/**
 * Whether one typed message may take one look at the owner's screen. A typed ask to
 * look is first class, screen reading is not constant between questions, only on an explicit ask.
 *
 * The authority is the owner's words, never the model's choice to call a tool: a message that did not ask gets no frame however
 * the turn goes. It is spent before the capture starts, so two `read_screen` calls in one turn take one frame between
 * them. A question ABOUT seeing ("are you looking at my screen?") is not an ask, and is answered in words.
 *
 * Pure. The state's owner is `useTypedTalk.ts`, and the capture's own check is `lookRefusal` in the desktop shell.
 */
/** The one typed message that may take a look, while it may. */
export interface TypedLookState {
  /** The message the authority belongs to. */
  readonly messageId: string;
  /** The owner's words in it. */
  readonly text: string;
  /** `sending` until the thread announces a turn, so a late tool call of the turn before takes no frame. */
  readonly phase: "sending" | "replying";
  /** Whether its one look has been taken. */
  readonly spent: boolean;
}

/** What the gate rules on one tool call. */
export type TypedLookDecision =
  { readonly kind: "allow"; readonly messageId: string } | { readonly kind: "refuse"; readonly reason: string };

/** Questions about whether the voice can or does see, which look like asks and are not. */
const SIGHT_QUESTIONS: readonly RegExp[] = [
  /\bare you (?:\w+ )?(?:looking|seeing|reading|watching|viewing)\b/,
  /\b(?:can|could) you (?:\w+ )?see\b/,
  /\bdo you (?:\w+ )?(?:see|have access)\b/,
  /\bhave you (?:\w+ )?(?:seen|looked)\b/,
  /\bdid you (?:\w+ )?(?:see|look)\b/,
  /\bhow do you (?:\w+ )?(?:see|look)\b/,
  /\bwhat can you see\b/,
];

/*
 * A typed ask is held to more than a spoken one. A call's look-ask list (`lookAck.ts`) only picks the voice's
 * acknowledgement, so "I deleted this screenshot" matching it costs a line; here a match lets a frame be taken. So the
 * ask must OPEN a clause, after nothing but softeners: "can you look at my screen" asks, "I'll look at this later",
 * "don't look at my screen" and "I deleted this screenshot" do not. A blank line opens a clause as a full stop does, so
 * an ask opening a new paragraph asks; a single line break is a wrap and does not.
 */

/** What may stand before an ask in its clause: the start or a stop, then any run of softeners. */
const CLAUSE_OPENER =
  "(?:^|[.!?,;:]\\s*)(?:(?:please|pls|can you|could you|would you|will you|just|now|ok|okay|then|so|hey|quickly|go ahead and)\\s+)*";

/** The asks themselves, each an imperative. */
const TYPED_ASK_VERBS: readonly string[] = [
  "look at (?:my|the|this|that|your) (?:screen|image|picture|screenshot|screen ?shot|page|card|window)\\b",
  // Bare only: "look at this code: …" names what the owner pasted, not their screen.
  "look at (?:this|that|it)(?: (?:please|pls|now|for me))?\\s*(?:$|[.!?,;])",
  "(?:take|have) (?:a (?:quick |closer |proper )?|another )look(?: at (?:this|that|these|it|my screen|the screen)\\b)?(?! (?:at|into|through|over|for|around|later|of)\\b)",
  "(?:take|grab|get) (?:a |another |a new |one more )?screenshot",
  "screenshot (?:this|that|it|my screen)\\b",
  "look here\\b",
  // Pointing at what is on screen names it as surely as "look" does; "open this card's link" points past it.
  "(?:open|read|start) (?:this|that) (?:card|page)\\b(?!'s\\b)",
  "(?:bring|pull) up (?:my|the) screen\\b",
  "what am i looking at\\b",
];

/** One typed look ask: an imperative opening its clause. */
const TYPED_LOOK_ASK = new RegExp(`${CLAUSE_OPENER}(?:${TYPED_ASK_VERBS.join("|")})`);

/**
 * A negation anywhere in the message vetoes the ask: "Don't, please, look at my screen" opens a clause with the ask and
 * still refuses it. A real ask with a "don't" elsewhere gets words, and the owner can ask again.
 */
const NEGATION = /\b(?:don'?t|dont|do not|never|not|no need|stop|without|won'?t|shouldn'?t|can'?t|cannot|couldn'?t)\b/;

/** What the model is told when a typed turn's look is refused. */
const NOT_ASKED =
  "No look was taken: the owner did not ask for one in this message. Ask what the owner is looking at, or for its link.";

/**
 * The detail a typed turn's not-asked refusal carries on the voice's failure record (`screenLooks.ts`). The toast
 * classifier (`voiceFailureToast.ts`) keeps exactly this one quiet: the gate working as designed is not a failure the
 * owner should see, while every other refused look still toasts.
 */
export const TYPED_LOOK_NOT_ASKED_DETAIL = "not asked for in this message";

/**
 * Whether one typed message asks for a look at the owner's screen.
 *
 * @param text the owner's message
 * @returns true for an explicit ask, false for anything else, a question about seeing included
 */
export function isTypedLookAsk({ text }: { text: string }): boolean {
  const lowered = text.toLowerCase().replace(/[‘’]/g, "'");
  const words = lowered.replace(/\s+/g, " ").trim();
  if (NEGATION.test(words) || SIGHT_QUESTIONS.some((question) => question.test(words))) {
    return false;
  }
  // Only the ask reads a blank line as a stop: a veto split across one ("can you\n\nsee my screen?") still vetoes.
  const clauses = lowered
    .replace(/\r?\n[ \t]*\r?\n\s*/g, ". ")
    .replace(/\s+/g, " ")
    .trim();
  return TYPED_LOOK_ASK.test(clauses);
}

/**
 * The provider's hold on the one typed look, read and replaced through functions: a hook handed the ref itself would be
 * mutating its own argument, which React's compiler refuses.
 */
export interface TypedLookCell {
  /** The authority held now. */
  readonly get: () => TypedLookState | undefined;
  /** Replaces it. */
  readonly set: (next: TypedLookState | undefined) => void;
}

/**
 * The authority one sent message carries. None beside an earlier send of unknown fate: that send may still start a
 * turn, and a turn's notice does not say which message started it, so the turn heard next could be the earlier one's
 * and its `read_screen` would spend this message's look.
 *
 * @param text the owner's words in it
 * @param setAside whether an earlier send of unknown fate is still owed a turn
 * @returns its unspent authority, or `undefined` when it did not ask or could not be told apart
 */
export function typedLookOnSend({
  messageId,
  text,
  setAside,
}: {
  messageId: string;
  text: string;
  setAside: boolean;
}): TypedLookState | undefined {
  if (setAside || !isTypedLookAsk({ text })) {
    return undefined;
  }
  return { messageId, phase: "sending", spent: false, text };
}

/**
 * Rule on one tool call of a typed turn. The caller marks the authority spent synchronously on `allow`, before anything
 * awaits.
 *
 * @param state the authority held
 * @param tool the tool being called
 * @returns `allow` for this turn's one `read_screen`, else `refuse` with what the model is told
 */
export function typedLookGate({ state, tool }: { state: TypedLookState | undefined; tool: string }): TypedLookDecision {
  if (tool !== "read_screen" || state === undefined || state.spent || state.phase !== "replying") {
    return { kind: "refuse", reason: NOT_ASKED };
  }
  return { kind: "allow", messageId: state.messageId };
}
