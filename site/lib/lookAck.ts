/**
 * When the voice owes the owner "having a look": the owner's open turn asks it to look at their screen, and that turn
 * has been handed to the thinking model, with the voice not yet saying anything since. Pure, so the moment is a test
 * over the owner's real words rather than a property of a running call; the line itself is the server's
 * (`lookSpeech`, `./talkPlanWords.ts`), spoken through the same `appendSpeech` as the owner's nudge.
 *
 * Measured on one call, each of the owner's three explicit look asks was handed off within a second of the words and
 * looked at 6–7s later, and the voice's first words came 11–13s after the hand-off. Up to D Mon the realtime model
 * said "one sec, pulling that up" on its own; from the next day no look in any call file was acknowledged, so the line
 * is the console's, not a prompt's. Repro: for each `read_screen` tool line, the voice segments between it and
 * the `codex turn … started` before it, in `$SLOPWEAVER_HOME/talk/calls/*.jsonl`.
 *
 * A lookup the owner asks for is owed the same, worded "finding it": even a lookup that blocks the discussion must not
 * leave the voice silent like a blocked thread. Measured: on one call "surely you can find that" was handed off 12s
 * before the voice's first words. Repro: the `codex … started` tool line and the next voice segment, in
 * `$SLOPWEAVER_HOME/talk/calls/<call>-*.jsonl`.
 *
 * Read in either order, because both happen: the hand-off can come before the transcript fragment carrying "Look at
 * my screen". Any voice speech after the hand-off closes the window — the voice has already said something, and a
 * second line on top of it is noise.
 */
import type { PlanEffect } from "./talkPlanEvents";

/**
 * The owner's explicit asks for a look, as speech-to-text writes them. Only asks that name the screen, a screenshot
 * taken or "this" — "take a look at the logs" asks for a lookup, which is not a look at their screen.
 */
const LOOK_ASKS: readonly RegExp[] = [
  /\blook(?:ing)? at (?:my|the|this|your) screen\b/,
  /\b(?:take|have) a (?:quick )?look at (?:this|that|these|it)\b/,
  // "Look at this" alone is the ask: the voice then responds as if it had just looked.
  /\blook at this\b/,
  /\blook at (?:that|my) (?:image|picture|screenshot|screen ?shot|page|card)\b/,
  // A screenshot TAKEN, or one of the owner's — never a screenshot merely named: a sentence naming a dashboard
  // screenshot the card lacked, and another naming a kind of screenshot, each had the voice say it was looking at
  // nothing. A SECOND one is the same ask, and one call missed it twice: "take another screenshot" after the page
  // moved, and again after the voice agreed with the owner's correction of a price without looking again — the
  // console took no frame for either.
  /\b(?:take|grab|get) (?:a |some |another |a new |one more )?(?:new )?screenshots?\b/,
  /\bscreenshot (?:this|that|it|my screen)\b/,
  /^\W*screenshot\b/,
  /\b(?:this|my) screenshot\b/,
  /\bsee (?:my|the|this) screen\b/,
  /\blook here\b/,
  /\bwhat am i looking at\b/,
  // A look with no object at all, which is the owner's screen's: "have a quick look", then "have another look"
  // at a DM the owner had open (the voice's first words came 13.3s after the hand-off), and "have a look now" once
  // back at the screen. A look AT, INTO or THROUGH something
  // names that thing instead, and "a look OF" is a face's.
  /\b(?:take|have) (?:a (?:quick |closer |proper )?|another )look\b(?! (?:at|into|through|over|for|around|later|of)\b)/,
  /\b(?:bring|pull) up (?:my|the) screen\b/,
];

/**
 * Where a figure starts, as speech-to-text writes one: digits, or a number word up to million. A bare "one" is not a
 * figure here ("in one place, not ten different places"), only "one hundred", "one thousand", "one million".
 */
const FIGURE =
  "(?:a\\$|us\\$|\\$)?(?:\\d|one (?:hundred|thousand|million)\\b|(?:two|three|four|five|six|seven|eight|nine|ten|" +
  "eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|" +
  "seventy|eighty|ninety|hundred|thousand|million)\\b)";

/**
 * The owner's correction of a figure the voice read off their screen — an implicit look ask, because agreeing with
 * the owner is not knowing. "No, four hundred and twenty dollars, not five hundred and twenty dollars" can draw
 * "You're right, 420 dollars" 1 ms later with no frame taken, which is the failure: the owner wants the voice to know,
 * not to agree.
 *
 * Two shapes, each a cue COUPLED to a figure, because neither cue alone is a correction. MEASURED over the
 * 3,898 final turns of the owner's in every call file: `not <figure>` alone matched 4, one of them this correction and three
 * "not ten new PRs, but five"-shaped; `it says|reads|shows` alone matched 238, nearly all about a thread, a PR or a
 * doc; `it says <figure>` still caught "next it says three of the sources" and "that says two things to me". This
 * one and {@link FIGURE_REPLACED} add exactly the two correction turns and nothing else. Repro: the owner's final
 * segments of `$SLOPWEAVER_HOME/talk/calls/*.jsonl` run through {@link isLookAsk}, `afterFigure` folded as
 * {@link foldLookFrame} folds it (526 of the 3,898 open after a figure of the voice's), against the same with both
 * shapes removed.
 * A corrected name or date has no shape a pattern can hold safely, so it is the prompts' alone
 * (`src/talk/screenLookLines.ts`).
 */
const READING_CORRECTION = new RegExp(
  // The owner reading the figure off their screen against what they heard: "it actually says four hundred and twenty
  // dollars a month". The "actually" or the "no" is the correction; "next it says three of the sources" is not.
  `\\b(?:(?:it|that|this) (?:actually|really)|no,? (?:it|that|this)) (?:says|reads|shows) ${FIGURE}`,
);

/**
 * A figure and the figure it replaces, in one sentence: "four hundred and twenty dollars, not five hundred". It is a
 * correction only of something the voice just SAID, so it counts only in a turn of the owner's opening right after the voice's
 * words carried a figure: "We should invite two reviewers, not three" is a preference, not a correction.
 * "The voice's words" are its transcript SEGMENTS: a `spoke` effect carries no text and overlaps the
 * voice's own turn (`./talkPlanEvents.ts`), so clearing the figure on one would lose it from the very turn the owner
 * corrects. The cost is that a textless backchannel between the figure and the owner's turn does not clear it — one
 * extra frame at most.
 */
const FIGURE_REPLACED = new RegExp(`${FIGURE}[^.?!]{0,60}?\\bnot ${FIGURE}`);

/** Any figure at all, for whether the voice's words carried one. */
const ANY_FIGURE = new RegExp(FIGURE);

/**
 * The owner's explicit asks for a lookup — a card, a thread, a PR found and brought up — as speech-to-text writes
 * them: "you can look this up, right?", "surely you can find that", "look at this queue card, bring it up". "Bring it
 * up" alone is left out: it is said of raising a topic with a person.
 */
const FIND_ASKS: readonly RegExp[] = [
  /\blook (?:this|that|it|them) up\b/,
  /\blook up (?:the|that|this|my)\b/,
  /\bpull (?:this|that|it|them) up\b/,
  /\bpull up (?:the|that|this|my)\b/,
  /\bbring (?:up )?(?:this|that|the|my) (?:queue )?(?:card|thread|pr|page|message|draft|item)\b/,
  /\bbring (?:this|that|the|my) (?:queue )?(?:card|thread|pr|page|message|draft|item) up\b/,
  /\b(?:you|u) (?:can|could) (?:just |go )?find\b/,
  /\b(?:can|could|would) you (?:just |go |please )?find\b/,
  /\bgo (?:and )?find\b/,
];

/** Which acknowledgement a handed-off ask is owed: "having a look" at the owner's screen, or "finding it" for a lookup. */
export type LookAsk = "look" | "find";

/** Every {@link LookAsk}, the closed set the look route takes. */
const LOOK_ASK_KINDS: readonly LookAsk[] = ["look", "find"];

/**
 * The ask a look route's body names, from the closed set.
 *
 * @param body the route's parsed JSON body
 * @returns the ask, or `undefined` when the body names none of the set
 */
export function lookAskOf({ body }: { body: Record<string, unknown> }): LookAsk | undefined {
  return LOOK_ASK_KINDS.find((kind) => kind === body["ask"]);
}

/** The owner's words, lowercased with whitespace collapsed, as the ask lists read them. */
function normalised({ text }: { text: string }): string {
  return text.toLowerCase().replace(/\s+/g, " ");
}

/**
 * Whether the owner's words ask the voice to look at their screen: an explicit look ask, or a correction of a figure
 * on it.
 *
 * @param text the owner's words so far in one turn, as transcribed
 * @param afterFigure whether the owner's turn opened right after the voice's words carried a figure — what makes "770,
 *   not 870" a correction rather than a preference
 * @returns true when any explicit look ask, or any figure the owner corrects, is in them
 */
export function isLookAsk({ text, afterFigure }: { text: string; afterFigure: boolean }): boolean {
  const words = normalised({ text });
  if (LOOK_ASKS.some((ask) => ask.test(words)) || READING_CORRECTION.test(words)) {
    return true;
  }
  return afterFigure && FIGURE_REPLACED.test(words);
}

/**
 * Whether the voice's words carry a figure the owner could correct.
 *
 * @param text the voice's words, as transcribed
 * @returns true when a figure, in digits or number words, is in them
 */
export function carriesFigure({ text }: { text: string }): boolean {
  return ANY_FIGURE.test(normalised({ text }));
}

/**
 * Whether the owner's words ask the voice to find something and bring it up.
 *
 * @param text the owner's words so far in one turn, as transcribed
 * @returns true when any explicit lookup ask is in them
 */
export function isFindAsk({ text }: { text: string }): boolean {
  const words = normalised({ text });
  return FIND_ASKS.some((ask) => ask.test(words));
}

/**
 * The acknowledgement the owner's words are owed once handed off: a look at their screen wins over a lookup, since a
 * look is what the frame and the "having a look" line both serve.
 *
 * @param text the owner's words so far in one turn, as transcribed
 * @param afterFigure whether the owner's turn opened right after the voice's words carried a figure
 * @returns `look`, `find`, or `undefined` when they ask neither
 */
export function askOf({ text, afterFigure }: { text: string; afterFigure: boolean }): LookAsk | undefined {
  if (isLookAsk({ afterFigure, text })) {
    return "look";
  }
  if (isFindAsk({ text })) {
    return "find";
  }
  return undefined;
}

/** The owner's open turn, as the acknowledgement reads it. */
export interface LookAckState {
  /** The owner's open turn's id, `undefined` before the owner has spoken on this call. */
  readonly turnId: string | undefined;
  /** The owner's words in that turn so far. */
  readonly text: string;
  /** Whether that turn was handed to the thinking model with the voice silent since. */
  readonly handedOff: boolean;
  /**
   * Every turn of the owner's opened on this call, oldest first. A late segment of one that is not the open turn
   * updates nothing: it neither takes the open turn's place nor reopens itself.
   */
  readonly seenTurns: readonly string[];
  /**
   * Every turn of the owner's the voice has spoken over — all of those seen when it spoke — so a hand-off arriving
   * while one is open belongs to the owner's next turn, whose words have not arrived yet.
   */
  readonly answeredTurns: readonly string[];
  /**
   * Every turn of the owner's that has had its line, so none gets two — kept by id rather than as one flag, because a
   * late segment of an earlier turn can arrive after the next turn opened and would otherwise reopen it.
   */
  readonly saidTurns: readonly string[];
  /**
   * Turns of the owner's a hand-off named before any of their words arrived, so the hand-off is theirs when they open.
   * A hand-off naming a turn is that turn's alone: a late one for an earlier turn never lands on the open one.
   */
  readonly earlyHandOffs: readonly string[];
  /** Whether the voice's latest words carried a figure the owner could correct, and no turn of theirs has opened since. */
  readonly voiceFigure: boolean;
  /** Whether the owner's open turn opened right after such words, which makes "770, not 870" a correction. */
  readonly afterFigure: boolean;
}

/** Before the owner has said anything on a call; a reconnect starts here too. */
export const LOOK_ACK_START: LookAckState = {
  afterFigure: false,
  answeredTurns: [],
  earlyHandOffs: [],
  handedOff: false,
  saidTurns: [],
  seenTurns: [],
  text: "",
  turnId: undefined,
  voiceFigure: false,
};

/**
 * Fold one of the page's data-channel effects into the owner's open turn, and say whether the voice now owes "having a
 * look" or "finding it".
 *
 * @param state the owner's open turn so far
 * @param effect one effect `foldPlanEvent` produced
 * @returns the next state, and `say` naming the line exactly once per turn of the owner's that asked for a look or a lookup
 *   and was handed off, else `undefined`
 */
export function foldLookAck({ state, effect }: { state: LookAckState; effect: PlanEffect }): {
  readonly state: LookAckState;
  readonly say: LookAsk | undefined;
} {
  let next = state;
  if (effect.kind === "segment" && effect.who === "owner") {
    if (effect.id === state.turnId) {
      next = { ...state, text: effect.text };
    } else if (!state.seenTurns.includes(effect.id)) {
      const seenTurns = [...state.seenTurns, effect.id];
      const handedOff = state.earlyHandOffs.includes(effect.id);
      // The owner's turn consumes the voice's figure: the turn after it is not "right after".
      const afterFigure = state.voiceFigure;
      next = { ...state, afterFigure, handedOff, seenTurns, text: effect.text, turnId: effect.id, voiceFigure: false };
    }
  } else if (effect.kind === "segment") {
    const voiceFigure = carriesFigure({ text: effect.text });
    next = { ...state, answeredTurns: state.seenTurns, handedOff: false, voiceFigure };
  } else if (effect.kind === "spoke") {
    next = { ...state, answeredTurns: state.seenTurns, handedOff: false };
  } else if (effect.kind === "delegated") {
    next = handOff({ state, named: effect.turnId });
  }
  const turnId = next.turnId;
  if (turnId === undefined || !next.handedOff || next.saidTurns.includes(turnId)) {
    return { say: undefined, state: next };
  }
  const ask = askOf({ afterFigure: next.afterFigure, text: next.text });
  if (ask === undefined) {
    return { say: undefined, state: next };
  }
  return { say: ask, state: { ...next, saidTurns: [...next.saidTurns, turnId] } };
}

/**
 * A hand-off, attributed: to the turn it names when it names one, else to the owner's open turn. One naming a turn not
 * yet heard waits for that turn's words; one naming an earlier turn changes nothing.
 */
function handOff({ state, named }: { state: LookAckState; named: string | undefined }): LookAckState {
  const turnId = state.turnId;
  if (named !== undefined && !state.seenTurns.includes(named)) {
    return { ...state, earlyHandOffs: [...state.earlyHandOffs, named] };
  }
  const isOpenTurn = named === undefined || named === turnId;
  if (turnId === undefined || !isOpenTurn || state.answeredTurns.includes(turnId)) {
    return state;
  }
  return { ...state, handedOff: true };
}

/** The owner's open turn, as the frame fold reads it. */
export interface LookFrameState {
  /** The owner's open turn's id, `undefined` before the owner has spoken on this call. */
  readonly turnId: string | undefined;
  /** The owner's words in that turn so far. */
  readonly text: string;
  /** Whether that turn has been handed to the thinking model — unlike the line's window, speech never closes it. */
  readonly delegated: boolean;
  /** Whether the owner's words in that turn are final: they have finished asking, handed off or not. */
  readonly finished: boolean;
  /** Every turn of the owner's opened on this call, so a late segment of an earlier one never takes the open turn's place. */
  readonly seenTurns: readonly string[];
  /** Turns of the owner's a hand-off named before any of their words arrived, so the hand-off is theirs when they open. */
  readonly earlyHandOffs: readonly string[];
  /** Every turn of the owner's that has had its frame, so none gets two. */
  readonly framedTurns: readonly string[];
  /** Whether the voice's latest words carried a figure the owner could correct, and no turn of theirs has opened since. */
  readonly voiceFigure: boolean;
  /** Whether the owner's open turn opened right after such words, which makes "770, not 870" a correction. */
  readonly afterFigure: boolean;
}

/** Before the owner has said anything on a call; a reconnect starts here too. */
export const LOOK_FRAME_START: LookFrameState = {
  afterFigure: false,
  delegated: false,
  earlyHandOffs: [],
  finished: false,
  framedTurns: [],
  seenTurns: [],
  text: "",
  turnId: undefined,
  voiceFigure: false,
};

/**
 * Fold one data-channel effect into the owner's open turn, and say whether the console now owes the thinking model a
 * frame of their screen for it: once per turn of the owner's that asked for a look, the moment it is handed off OR
 * their words in it are final, whichever comes first. Only on the owner's ask, never on a timer or because of what is
 * open: the owner tells the voice when to look. Unlike the "having a look" line, the voice speaking does not close it:
 * the frame is for the model answering the owner, not for filling silence.
 *
 * Why not on the hand-off alone: the voice can say "Having a look now." itself three times without handing anything
 * off, so no frame is taken, the screen edge never pulses, and the next frame comes 28.8s, 98.4s and 61.6s later.
 * A frame taken on the owner's finished words reaches the server first; `PlanCall.attachLook` steers it into the turn
 * the hand-off starts, or starts that turn itself when nothing has. Repro: the voice segments saying it is looking
 * with no `look` tool line in the six seconds before them, in `$SLOPWEAVER_HOME/talk/calls/<call-id>-*.jsonl`.
 *
 * @param state the owner's open turn so far
 * @param effect one effect `foldPlanEvent` produced
 * @returns the next state, and `frame: true` exactly once per turn of the owner's that asked for a look, once it is
 *   handed off or finished
 */
export function foldLookFrame({ state, effect }: { state: LookFrameState; effect: PlanEffect }): {
  readonly state: LookFrameState;
  readonly frame: boolean;
} {
  let next = state;
  if (effect.kind === "segment" && effect.who === "owner") {
    if (effect.id === state.turnId) {
      next = { ...state, finished: effect.final, text: effect.text };
    } else if (!state.seenTurns.includes(effect.id)) {
      next = {
        ...state,
        afterFigure: state.voiceFigure,
        delegated: state.earlyHandOffs.includes(effect.id),
        finished: effect.final,
        seenTurns: [...state.seenTurns, effect.id],
        text: effect.text,
        turnId: effect.id,
        voiceFigure: false,
      };
    }
  } else if (effect.kind === "segment") {
    next = { ...state, voiceFigure: carriesFigure({ text: effect.text }) };
  } else if (effect.kind === "delegated") {
    next = frameHandOff({ named: effect.turnId, state });
  }
  const turnId = next.turnId;
  const due = next.delegated || next.finished;
  const asked = isLookAsk({ afterFigure: next.afterFigure, text: next.text });
  if (turnId === undefined || !due || next.framedTurns.includes(turnId) || !asked) {
    return { frame: false, state: next };
  }
  return { frame: true, state: { ...next, framedTurns: [...next.framedTurns, turnId] } };
}

/**
 * A hand-off, attributed for the frame exactly as {@link handOff} attributes it for the line: to the turn it names,
 * else to the owner's open turn. One naming a turn not yet heard waits for that turn's words; one naming an earlier
 * turn changes nothing. Unlike the line's, a turn the voice has spoken over is still handed off — the frame is for the
 * answer.
 */
function frameHandOff({ state, named }: { state: LookFrameState; named: string | undefined }): LookFrameState {
  if (named !== undefined && !state.seenTurns.includes(named)) {
    return { ...state, earlyHandOffs: [...state.earlyHandOffs, named] };
  }
  const isOpenTurn = named === undefined || named === state.turnId;
  if (state.turnId === undefined || !isOpenTurn) {
    return state;
  }
  return { ...state, delegated: true };
}
