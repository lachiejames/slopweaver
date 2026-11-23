/**
 * A card's source line, built from parts its producer marks as the owner's to read or a session's to run. The line can carry a
 * session's own steps — the verbs that tie a card to the owner's words or to a standing ask of theirs — and drawn whole they made
 * the card's first block a wall of commands the owner never runs. Each producer says which sentence is a step, so the block
 * folds exactly those under one closed summary and never guesses from punctuation. Pure.
 */

import { withoutMachineIds } from "./machineIds";

/** One sentence of a source line: the owner's to read, or a step a session takes. */
export interface SourceLinePart {
  readonly kind: "reader" | "session-step";
  readonly text: string;
}

/** A source line, whole and split. */
export interface SourceLineCopy {
  /** Every part, in order, joined with one space — the line as a hover, a scan or a test reads it. */
  readonly whole: string;
  /** The parts the owner reads, in order, joined with one space. */
  readonly lead: string;
  /** The session steps, in order; empty when the line names none. */
  readonly steps: readonly string[];
}

/** The sentence a card with no covering standing ask opens on, before the step that records one. */
export const NO_COVERING_ASK = "No standing ask of yours is recorded over cards like this one.";

/**
 * How a session records the standing ask a card should have quoted. An act's kind is a session's free text, so one
 * shaped like a machine id is hidden here: the overlay must never be what trips the machine-id gate, or a card drawn
 * before it would be refused by it.
 *
 * @param coverage the coverage the ask would carry, most specific first
 * @returns the step, naming the two commands a session runs
 */
export function standingAddStep({ coverage }: { coverage: string }): string {
  return (
    `If one of your standing asks covers it, a session finds your turn with \`slopweaver profile words\` and records ` +
    `it with \`slopweaver profile standing add <id> --anchor <anchor> --covers ${withoutMachineIds({ text: coverage })}\`.`
  );
}

/**
 * Join a source line's parts whole, and split them into what the owner reads and the steps a session takes. An empty part is
 * dropped, so a producer can pass a sentence that may be blank.
 *
 * @param parts the line's sentences, in order, each marked by its producer
 * @returns the line whole, the sentences the owner reads, and the session steps
 */
export function sourceLineCopy({ parts }: { parts: readonly SourceLinePart[] }): SourceLineCopy {
  const said = parts.filter((part) => part.text !== "");
  return {
    lead: said
      .filter((part) => part.kind === "reader")
      .map((part) => part.text)
      .join(" "),
    steps: said.filter((part) => part.kind === "session-step").map((part) => part.text),
    whole: said.map((part) => part.text).join(" "),
  };
}
