/**
 * The SCROLL WALK — moving the page one screen at a time and photographing each screen, which is what a
 * person does when the thing they want is not in front of them.
 *
 * Pure. No browser, no clock, no filesystem; `src/cli/commands/browser/actionRun.ts` runs what this file
 * describes.
 *
 * ## Whose decision this is
 *
 * A person walking a Datadog page sees no resource toggle, goes down to the left sidebar, scrolls one
 * page's worth, asks whether a resource control is anywhere, and finds it on the left.
 *
 * That is a loop with a picture in it, and `browser act --do scroll` is not it: a scroll through `act` must
 * cite a fresh `--observation` each time, so walking three screens down a page costs six commands and the
 * caller assembles the pictures itself. This verb is the loop — scroll a screen, photograph it, say where in
 * the document that screen is, repeat — and the judgement stays exactly where the owner put it, with the agent
 * looking at each picture and deciding.
 *
 * ## The delta is read off the live viewport, never a constant
 *
 * "One page's worth" is a property of the screen the page is being viewed on, and a laptop and an external
 * display differ by a factor of two — a hardcoded 800 pixels would be wrong on both. {@link SCROLL_POSITION_SOURCE}
 * reports `window.innerHeight` and the walk scrolls {@link PAGE_OVERLAP} of it.
 *
 * ## The two limits, stated rather than discovered
 *
 * **A wheel acts on what is under the POINTER.** `./action.ts` already says so about `--do scroll`, and it
 * is why a page with an inner scroll region may not move the document at all. The walk's answer is to read
 * the position back after every step and STOP when it did not move, so that case is visible in the output
 * instead of producing N identical pictures of the same screen.
 *
 * **There is no "scroll until you can see X" here, on purpose.** The client's `find` searches the page
 * SNAPSHOT, which is the whole document, so a stopping rule built on it would stop the moment the text
 * existed anywhere — including three screens below the fold. A flag whose name promises viewport semantics
 * while delivering document semantics is worse than no flag, so the stopping rule is `--pages <n>` and the
 * agent's own eyes.
 */
import { isRecord } from "../lib/parsers.js";
import { evalReplyValue } from "./evalReply.js";

/**
 * How much of one viewport a single step moves.
 *
 * Deliberately under 1: two adjacent screens overlap by the remainder, so a row of a table or a facet in a
 * sidebar cannot fall between two pictures by landing exactly on the seam. It is the same reason a person
 * scrolling with a keyboard's Page Down key gets an overlap rather than a clean cut.
 */
export const PAGE_OVERLAP = 0.85;

/**
 * Where the page is, how tall the window is, and how tall the document is.
 *
 * Takes no element, so it is the client's `eval <func>` with no target at all. One string literal authored
 * here, returning three numbers — the same closed shape `./aim.ts` and `./aimShot.ts` use, and no caller
 * data reaches it.
 */
export const SCROLL_POSITION_SOURCE = `() => ({
  y: window.scrollY,
  viewportHeight: window.innerHeight,
  documentHeight: document.documentElement.scrollHeight,
})`;

/** Where the page is, as the page itself reports it. */
export interface ScrollPosition {
  readonly y: number;
  readonly viewportHeight: number;
  readonly documentHeight: number;
}

/** One screen of a walk: its picture, where it is, and whether the page moved to get there. */
export interface ScrollPageStep {
  /** 1-based, so the output counts the way a person does. */
  readonly page: number;
  readonly picturePath: string;
  readonly at: ScrollPosition;
  /** False when the wheel moved nothing — the end of the document, or a scroller that swallowed it. */
  readonly moved: boolean;
}

/**
 * Read the page's own answer about where it is.
 *
 * @param stdout everything the client printed for the position step
 * @returns the position, or `null` when the reply carried no readable one
 */
export function parseScrollPosition({ stdout }: { stdout: string }): ScrollPosition | null {
  const value = evalReplyValue({ stdout });
  if (!isRecord(value)) {
    return null;
  }
  const keys = ["y", "viewportHeight", "documentHeight"] as const;
  if (keys.some((key) => typeof value[key] !== "number")) {
    return null;
  }
  return {
    documentHeight: Number(value["documentHeight"]),
    viewportHeight: Number(value["viewportHeight"]),
    y: Number(value["y"]),
  };
}

/**
 * How far one step of the walk moves the wheel, in CSS pixels.
 *
 * Always at least one pixel: a viewport the page reports as zero-height — an unrendered tab, a page still
 * laying out — would otherwise produce a wheel event of nothing and a walk that reported the end of the
 * document without ever having tried to move.
 *
 * @param position what the page said about itself
 * @param up whether the walk is going up the page rather than down
 * @returns the `dy` for one `mousewheel`, negative when going up
 */
export function pageDelta({ position, up }: { position: ScrollPosition; up: boolean }): number {
  const step = Math.max(1, Math.round(position.viewportHeight * PAGE_OVERLAP));
  if (up) {
    return -step;
  }
  return step;
}

/**
 * Roughly how many screens this document is, for a reader of one viewport picture.
 *
 * Rounded UP, because a document 1.2 screens tall really does take two screens to look at. A viewport the
 * page reports as zero-height answers 1 rather than dividing by it.
 *
 * @param position what the page said about itself
 * @returns the number of screens
 */
export function screenCount({ position }: { position: ScrollPosition }): number {
  if (position.viewportHeight <= 0) {
    return 1;
  }
  return Math.max(1, Math.ceil(position.documentHeight / position.viewportHeight));
}

/**
 * Which screen of the document one position is on, counting from 1.
 *
 * @param position what the page said about itself
 * @returns the screen number
 */
export function screenAt({ position }: { position: ScrollPosition }): number {
  if (position.viewportHeight <= 0) {
    return 1;
  }
  return Math.min(screenCount({ position }), Math.floor(position.y / position.viewportHeight) + 1);
}

/**
 * Where one screen's picture is written.
 *
 * @param stem the path every picture of one walk is named from, without an extension
 * @param page the 1-based screen number
 * @returns the path
 */
export function scrollPicturePath({ stem, page }: { stem: string; page: number }): string {
  return `${stem}-${String(page)}.png`;
}

/**
 * What one walk prints: a line per screen, saying where in the document that screen is.
 *
 * A step that did not move says so and is the last one, because that is the answer the caller needs — the
 * walk asked for five screens and the document had two, or a scroller under the pointer ate the wheel.
 *
 * @param steps the screens the walk actually photographed
 * @param up whether the walk was going up the page
 * @returns the lines to print
 */
export function scrollWalkLines({ steps, up }: { steps: readonly ScrollPageStep[]; up: boolean }): readonly string[] {
  return steps.map((step) => {
    const where =
      `  ${step.picturePath} — screen ${String(screenAt({ position: step.at }))} of ` +
      `~${String(screenCount({ position: step.at }))}, y ${String(step.at.y)} of ${String(step.at.documentHeight)}`;
    if (step.moved) {
      return where;
    }
    const edge = up ? "top" : "bottom";
    return `${where} — the page did not move, so this is the ${edge} of what the wheel can reach here`;
  });
}
