/*
 * The flattened step `handNotePanelSource` embeds for the constant program to read (`PanelStep`), and the window
 * levels a note floats at. Split out of `./panel.ts`, which holds the program itself, so that file reads as the
 * program and this one as its wire.
 */
import type { DetailEntry } from "../details.js";
import type { KindAnswerOffer } from "../kindAnswers.js";
import type { PanelChecklistLine } from "./checklist.js";
import type { TriageNotePaths } from "./triagePaths.js";

/**
 * Which window level a note floats at, and so which cascade it takes a slot in (`./cascade.ts`). `ordinary` is
 * every hand step and every monitor's notice, the newest in front with every older title showing above it;
 * `meeting-prep` stays in front of every later note, because it is the page the owner needs going into a meeting inside
 * the hour, and cascades from the other corner so it never sits over an ordinary note's title.
 */
export type NoteLevel = "ordinary" | "meeting-prep";

/** How many levels above `NSFloatingWindowLevel` each {@link NoteLevel} draws. */
export const LEVEL_OFFSET: Readonly<Record<NoteLevel, number>> = { "meeting-prep": 1, ordinary: 0 };

/**
 * The step, exactly as the program reads it — every optional flattened to a string, so the JXA never
 * branches on `undefined` and the emitted JSON has one stable shape.
 *
 * @internal — the wire between `handNotePanelSource` and the constant program in `./panel.ts`.
 */
export interface PanelStep {
  readonly id: string;
  /** The digest of the CONSTANT program, never of this object. See `./panel.ts`'s overview. */
  readonly build: string;
  /** The step's wanted-token file. Never part of the build digest: it varies per step, the program does not. */
  readonly wantPath: string;
  /** Where a failed raise's `<token>.failed` tombstone sits, and every panel's beat. */
  readonly liveDir: string;
  /** This panel's own beat file, carrying {@link PanelStep.build}. */
  readonly beatPath: string;
  /** This raise's own token, so a newer raise of the same step can close this note. */
  readonly token: string;
  /** The cascade slot the raise reserved, which `cascadeOrigin` turns into a place on screen. */
  readonly slot: number;
  /** Whether this note's cascade runs from the top-left corner, as the meeting-prep level's does. */
  readonly cascadeFromLeft: boolean;
  /** How many window levels above `NSFloatingWindowLevel` this note draws. */
  readonly levelOffset: number;
  /** The small line above the step: a check-in says it is one, so it never reads as work stopped on the owner. */
  readonly eyebrow: string;
  readonly what: string;
  /**
   * The step's quotes as the rows drawn directly under {@link PanelStep.what} — `“text” — who`, and the permalink
   * a click on the row opens (`../quotes.ts`); empty when it has none.
   */
  readonly quotes: readonly { readonly line: string; readonly url: string }[];
  readonly literal: string;
  /** The step's checklist lines (`./checklist.ts`); empty when it has none. */
  readonly checklist: readonly PanelChecklistLine[];
  readonly where: string;
  readonly unaddressed: string;
  readonly url: string;
  /** The footer line — the do-nothing line when the step carries one, else `unblocks` (`./footer.ts`). */
  readonly unblocks: string;
  /**
   * The step's details as the entries the opened region draws (`../details.ts` § detailEntry); empty when none. `url`
   * opens the card an entry's act marker names, on the console the step's own link opens, or is empty.
   */
  readonly detailEntries: readonly (DetailEntry & { readonly url: string })[];
  /** How many detail lines the disclosure row names. */
  readonly detailCount: number;
  /** What the disclosure row adds after its count: ` · 2 need you`, or empty when no entry is the owner's. */
  readonly detailsNeedYou: string;
  readonly witness: string;
  readonly markerDir: string;
  /** Rapid triage's two paths and how fresh its state must be to show the buttons (`./triage.ts`). */
  readonly triage: TriageNotePaths & { readonly freshMs: number };
  /** Which kind answers the band's More… page offers (`../kindAnswers.ts`); neither, and there is no More… page. */
  readonly kindAnswers: KindAnswerOffer;
  readonly width: number;
  readonly pollSeconds: number;
  readonly pad: number;
  readonly buttonWidth: number;
  readonly buttonGap: number;
  /**
   * Each console link this note can open, mapped to the desktop app's address for it (`./desktopLink.ts`); a link
   * elsewhere — a Slack permalink, a provider page — has no entry and opens in the owner's browser; a console link the app
   * refuses maps to `null` and opens nothing while a desktop app is there.
   */
  readonly desktopLinks: Readonly<Record<string, string | null>>;
}
