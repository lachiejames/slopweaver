/**
 * The count claim and the app figures it is checked against, split out of `./talkCountGrounding.ts`, which re-exports
 * every one it exported before.
 */

/** Which of the app's figures a count names. */
export type QueueCountSubject =
  | "everything"
  | "waiting"
  | "queue"
  | "asks"
  | "check-in"
  | "colleague"
  | "fleet"
  | "urgent"
  | "slack"
  | "review"
  | "finding"
  /** A count said with the words "Slopweaver context" — its own figure, never a bare count's. */
  | "slopweaver-context"
  /** A count said with the words "work context". */
  | "work-context";

/** One count of the owner's Queue, as the voice said it. */
export interface CountClaim {
  readonly count: number;
  readonly noun: "card" | "item" | "ask" | "check-in";
  readonly subject: QueueCountSubject;
  /** The words that said it, from the number to the last word naming what it counts. */
  readonly words: string;
  readonly start: number;
  readonly end: number;
}

/** One figure the app prints, under the label it prints it with; `undefined` where it prints none. */
export interface ShownField {
  readonly label: string;
  readonly count: number | undefined;
}
