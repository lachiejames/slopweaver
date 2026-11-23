/**
 * The words the block an expanded queue card leads with draws — the owner's own words and where they said them, or
 * where the card came from instead (`./queueCardSource.ts`, drawn by `../components/console/SourceBlock.tsx`).
 *
 * Each kind of record says only what its instant means: a console turn carries when it was RELAYED, not when the
 * owner spoke; a call file carries when its stretch was last recorded; a card landing carries when the owner said it.
 * How the words arrived is said only where the record proves it — a console turn records typed or
 * spoken, a call or a session transcript does not. The quote itself is never reworded here, and never marked: where
 * the record cut it travels beside the words, and the block draws the ellipsis there as its own muted mark. A long
 * quote's folded summary is the one reading aid — the stretch naming what the card is
 * about, speech noise dropped (`./quoteLead.ts`) — and the verbatim quote is what opening it shows.
 *
 * The block's order: the words the card answers at the top; then, where several of the owner's steers bear on it,
 * each one in the order they said them, shut under one summary that keeps the UI uncluttered; then why the card is
 * in front of the owner — the registering session's bears-on line, last, because it is drawn FROM the owner's words
 * rather than in place of them.
 *
 * Pure: a source in, sentences out.
 */
import type { HisWordsCut } from "../components/live/readHisWords";
import { anchorInWords } from "./anchorInWords";
import { carriesMachineId, withoutMachineIds } from "./machineIds";
import type { CardSource, PendingRead, UnsteeredOrigin } from "./queueCardSource";
import type { QuotedReason } from "./quotedReason";
import { NO_COVERING_ASK, type SourceLinePart, sourceLineCopy, standingAddStep } from "./sessionSteps";
import { prSteersCopy, quoteLine, type SteersCopy, steersCopy, type WordsFold, wordsFold } from "./sourceBlockWords";

/** How the block reads at a glance: the owner's words, proven not theirs, not known, or refused. */
export type SourceTone = "owner" | "not-owner" | "unknown" | "refused";

/** The block's copy. */
export interface SourceBlockCopy {
  readonly tone: SourceTone;
  /** The block's small label. */
  readonly label: string;
  /** The owner's words, verbatim, and where the record cut them, when the card carries them. */
  readonly words: { readonly text: string; readonly cut: HisWordsCut } | undefined;
  /** The one sentence beside them: where and when the owner said it, or where the card came from instead. */
  readonly line: string;
  /**
   * {@link SourceBlockCopy.line} as the block draws it: the sentences the owner reads, and the session steps folded shut
   * beneath them, each marked by the code that wrote it (`site/lib/sessionSteps.ts`).
   */
  readonly sessionSteps: { readonly lead: string; readonly steps: readonly string[] };
  /**
   * The machine ids behind {@link SourceBlockCopy.line} — a session, a run, an anchor — drawn as the line's hover and
   * never in it, since the owner does not read ids. `undefined` when the line names none.
   */
  readonly hover: string | undefined;
  /**
   * The session's one line saying how the owner's words bear on the question — why the card is in front of them —
   * drawn LAST, after every quote of theirs, and never the owner's words.
   */
  readonly bearsOn: string | undefined;
  /**
   * How the owner's words fold, by default, when they run past the fold: the line shown in the summary, and the whole
   * length in words a reader can weigh before opening it. `undefined` when they are short enough to draw whole.
   */
  readonly fold: WordsFold;
  /** The owner's further steers on it, drawn between their words and the why line; `undefined` when there are none. */
  readonly steers: SteersCopy | undefined;
  /** The owner's words on its pull request stored on OTHER cards, drawn after their own steers; `undefined` when there are none. */
  readonly prSteers: SteersCopy | undefined;
  /**
   * A read the block waits on, drawn beside {@link SourceBlockCopy.line} as its spinner or staleness mark — never as a
   * sentence; `undefined` when the block waits on none.
   */
  readonly pending: SourcePending | undefined;
  /**
   * A read's own reason the line quotes, kept out of it: each drawn beneath the line, said plainly with the raw message
   * folded under it. Empty when the line quotes none.
   */
  readonly quoted: readonly QuotedReason[];
}

/**
 * A read a card's source waits on: what it is, mid-sentence, and its state — or `board`, the shared board read the
 * block takes off its own channel, since the row builders hold only its rows.
 */
export interface SourcePending {
  readonly subject: string;
  readonly read: PendingRead | "board";
}

/**
 * What a card with no record of the owner's words says can still be done: a session finds the turn and ties the row
 * to it, since a card always carries the quote that led to it.
 */
const TIE_TO_HIS_WORDS: SourceLinePart = {
  kind: "session-step",
  text:
    "If it came from you, a session finds your turn with `slopweaver profile words` and ties it here with " +
    "`slopweaver handover quote <slug> --anchor <anchor> --apply`.",
};

/** The block's copy before its line is joined: the line still as the parts its producer marked. */
type OriginCopy = Omit<SourceBlockCopy, "steers" | "prSteers" | "pending" | "quoted" | "line" | "sessionSteps"> & {
  readonly parts: readonly SourceLinePart[];
};

/** A sentence of the line the owner reads. */
function readerPart({ text }: { text: string }): SourceLinePart {
  return { kind: "reader", text };
}

/**
 * The hover an anchor puts on the line: the anchor itself, when the line named it in words rather than drawing it.
 *
 * @returns the anchor, or `undefined` when the line already draws it whole
 */
function anchorHover({ anchor }: { anchor: string }): string | undefined {
  if (anchorInWords({ anchor }) === `at ${anchor}`) {
    return undefined;
  }
  return anchor;
}

/**
 * A run's slug as a sentence names it — `fresh-supervisor-handoff-9295` reads "fresh supervisor handoff 9295" — or
 * `undefined` when the run, as a slug or as the words, carries a machine id — `session-9f3a-cleanup` reads
 * "session 9f3a cleanup" — which then rides the hover alone.
 *
 * @param run the run the registering session held
 * @returns the words, or `undefined`
 */
export function runInWords({ run }: { run: string }): string | undefined {
  const words = run.replaceAll(/[-_]+/g, " ").trim();
  if (carriesMachineId({ text: run }) || carriesMachineId({ text: words })) {
    return undefined;
  }
  return words;
}

/**
 * The copy for a card's source.
 *
 * @param source the card's source
 * @returns the label, the words when there are some, the sentence beside them, the owner's further steers, and their words on
 *   its pull request stored on other cards
 */
export function sourceBlockCopy({ source }: { source: CardSource }): SourceBlockCopy {
  const { parts, ...origin } = originCopy({ source });
  const line = sourceLineCopy({ parts });
  return {
    ...origin,
    line: line.whole,
    pending: pendingOf({ source }),
    prSteers: prSteersCopy({ steers: source.prSteers, subject: source.subject }),
    quoted: quotedOf({ source }),
    sessionSteps: { lead: line.lead, steps: line.steps },
    steers: steersCopy({ steers: source.steers, subject: source.subject }),
  };
}

/**
 * The reads' own reasons a source's line quotes, each lead with its machine ids hidden as the line's are; the raw
 * reason is left as the read gave it, for the fold.
 */
function quotedOf({ source }: { source: CardSource }): readonly QuotedReason[] {
  const quotes = source.kind === "standing-missing" || source.kind === "unread" || source.kind === "unreadable";
  if (!quotes || typeof source.why === "string") {
    return [];
  }
  return source.why.map((quoted) => ({ lead: withoutMachineIds({ text: quoted.lead }), why: quoted.why }));
}

/** The read a source waits on, when it waits on one. */
function pendingOf({ source }: { source: CardSource }): SourcePending | undefined {
  if (source.kind === "board-pending") {
    return { read: "board", subject: "the board row this card belongs to" };
  }
  if (source.kind === "standing-pending") {
    return { read: source.read, subject: "your standing asks, one of which this card may rest on" };
  }
  return undefined;
}

/**
 * The copy for where a card came from — everything but its further steers, the read it waits on and the reasons its
 * line quotes.
 */
function originCopy({ source }: { source: CardSource }): OriginCopy {
  switch (source.kind) {
    case "words": {
      const quote = source.quote;
      return {
        bearsOn: source.bearsOn,
        fold: wordsFold({ quote, subject: source.subject }),
        hover: undefined,
        label: "your words",
        parts: [readerPart({ text: quoteLine({ quote }) })],
        tone: "owner",
        words: { cut: quote.cut, text: quote.words },
      };
    }
    case "unquoted": {
      let where = "a record of your words";
      let hover: string | undefined;
      if (source.anchor !== undefined) {
        where = `your words ${anchorInWords({ anchor: source.anchor })}`;
        hover = anchorHover({ anchor: source.anchor });
      }
      return {
        bearsOn: undefined,
        fold: undefined,
        hover,
        label: "your words",
        parts: [readerPart({ text: `This card came from ${where}, and they are missing.` })],
        tone: "refused",
        words: undefined,
      };
    }
    // What the anchor pointed at may prove NOT the owner's — a voice segment, a session's own words, an accepted
    // suggestion, a line the console typed into the chair — so the card claims only the pointer, never that the
    // record behind it holds what they said.
    case "unreadable":
      // The read's reason is drawn beneath the line ({@link quotedOf}), never inside it.
      return {
        bearsOn: undefined,
        fold: undefined,
        hover: anchorHover({ anchor: source.anchor }),
        label: "where this came from",
        parts: [
          readerPart({
            text: `It points at something taken for your words ${anchorInWords({ anchor: source.anchor })}, but no words of yours were read there.`,
          }),
        ],
        tone: "unknown",
        words: undefined,
      };
    case "elsewhere":
      return {
        bearsOn: undefined,
        fold: undefined,
        hover: anchorHover({ anchor: source.anchor }),
        label: "where this came from",
        parts: [
          readerPart({
            text: `No record of your words is on this card; it points ${anchorInWords({ anchor: source.anchor })}.`,
          }),
        ],
        tone: "unknown",
        words: undefined,
      };
    case "none":
    case "registered":
    case "unrecorded":
      return unsteeredCopy({ origin: source });
    case "standing": {
      // A card no particular steer produced quotes the standing ask it rests on, and says no other particular steer
      // is behind it.
      const quote = source.quote;
      const came = cameFrom({ origin: source.immediate });
      return {
        bearsOn: undefined,
        fold: wordsFold({ quote, subject: source.subject }),
        hover: came.hover,
        label: "your standing ask",
        parts: [
          readerPart({
            text: `${quoteLine({ quote })} No particular steer of yours is behind this card beyond it; ${came.clause}.`,
          }),
        ],
        tone: "owner",
        words: { cut: quote.cut, text: quote.words },
      };
    }
    case "standing-missing": {
      const copy = unsteeredCopy({ origin: source.immediate });
      // The coverage no ask covers is the step's own, so the command folds shut and never rides inside `why`'s words.
      if (source.uncoveredCoverage !== undefined) {
        const step: SourceLinePart = {
          kind: "session-step",
          text: standingAddStep({ coverage: source.uncoveredCoverage }),
        };
        return { ...copy, parts: [...copy.parts, readerPart({ text: NO_COVERING_ASK }), step] };
      }
      // A quoted read's reason is drawn beneath the line ({@link quotedOf}), never inside it.
      if (typeof source.why !== "string") {
        return copy;
      }
      return { ...copy, parts: [...copy.parts, readerPart({ text: source.why })] };
    }
    case "standing-pending":
      return unsteeredCopy({ origin: source.immediate });
    case "board-pending":
      return {
        bearsOn: undefined,
        fold: undefined,
        hover: undefined,
        label: "where this came from",
        parts: [],
        tone: "unknown",
        words: undefined,
      };
    case "unread": {
      // A quoted read's reason is drawn beneath the line ({@link quotedOf}), never inside it.
      let line = "Not read yet.";
      if (typeof source.why === "string") {
        line = `Not read yet: ${withoutMachineIds({ text: source.why })}.`;
      }
      return {
        bearsOn: undefined,
        fold: undefined,
        hover: undefined,
        label: "where this came from",
        parts: [readerPart({ text: line })],
        tone: "unknown",
        words: undefined,
      };
    }
    default: {
      const never: never = source;
      return never;
    }
  }
}

/**
 * The session that registered a row, in words — named by the run it held — and its ids for the hover. The owner
 * does not read a session id, so the id, and a run that is itself an id, ride the hover.
 */
function registeredBy({ session, run }: { session: string; run: string | undefined }): {
  /** ` while it ran <run>`, or empty when the run is unknown or is itself an id. */
  readonly ran: string;
  readonly hover: string;
} {
  if (run === undefined) {
    return { hover: `session ${session}`, ran: "" };
  }
  const named = runInWords({ run });
  const hover = `session ${session}, run ${run}`;
  if (named === undefined) {
    return { hover, ran: "" };
  }
  return { hover, ran: ` while it ran ${named}` };
}

/** Where an unsteered card came from, as the clause a standing ask's line closes on, and its ids for the hover. */
function cameFrom({ origin }: { origin: UnsteeredOrigin }): {
  readonly clause: string;
  readonly hover: string | undefined;
} {
  switch (origin.kind) {
    case "none":
      return { clause: `it came from ${origin.origin}`, hover: origin.hover };
    case "registered": {
      const { ran, hover } = registeredBy({ run: origin.run, session: origin.session });
      return { clause: `a Claude session put it on your queue${ran}`, hover };
    }
    case "unrecorded":
      return { clause: `nothing records where it came from: ${origin.origin}`, hover: origin.hover };
    default: {
      const never: never = origin;
      return never;
    }
  }
}

/** The copy for a card no particular steer of the owner's is recorded behind, and no standing ask of theirs is quoted on. */
function unsteeredCopy({ origin }: { origin: UnsteeredOrigin }): OriginCopy {
  switch (origin.kind) {
    case "none":
      return {
        bearsOn: undefined,
        fold: undefined,
        hover: origin.hover,
        label: "not your words",
        parts: [readerPart({ text: `No words of yours behind this; it came from ${origin.origin}.` })],
        tone: "not-owner",
        words: undefined,
      };
    case "registered": {
      const { ran, hover } = registeredBy({ run: origin.run, session: origin.session });
      return {
        bearsOn: undefined,
        fold: undefined,
        hover,
        label: "where this came from",
        parts: [
          readerPart({
            text: `A Claude session put this on your queue${ran}; it recorded no link to words of yours behind it.`,
          }),
          TIE_TO_HIS_WORDS,
        ],
        tone: "unknown",
        words: undefined,
      };
    }
    case "unrecorded":
      return {
        bearsOn: undefined,
        fold: undefined,
        hover: origin.hover,
        label: "where this came from",
        parts: [
          readerPart({ text: `Nothing records whose words are behind this: ${origin.origin}.` }),
          TIE_TO_HIS_WORDS,
        ],
        tone: "unknown",
        words: undefined,
      };
    default: {
      const never: never = origin;
      return never;
    }
  }
}
