/**
 * What every staleness mark on a settled page says, written beside the step's photograph, harness only.
 *
 * A mark draws as a warning triangle and says which readings did not answer only on hover, so a photograph of a
 * page drawing "No cards as of the last reading that answered" shows THAT something did not answer and never WHICH.
 * This reads the same words the hover shows — the mark's accessible label (`site/components/console/WarningMark.tsx`
 * renders the hover's plain words as it) and the "Full message" it describes itself with — straight from the DOM, so
 * a walk that draws stale names its unanswered registers instead of leaving them to a guess.
 */
import type { Page } from "playwright-core";

import { writeFileAtomic } from "#lib/writeAtomic.js";

/**
 * A mark in either of `WarningMark`'s two drawings: the plain one is a warning-coloured button carrying the label, the
 * one nested in a control an image carrying it inside a `data-warning-mark` frame.
 */
const STALE_MARK_SELECTOR = "button.text-warning[aria-label], [data-warning-mark] > [aria-label]";

/** One mark's words, as the hover shows them. */
export interface E2eStaleMark {
  /** The hover's plain words: which readings did not answer, and since when. */
  readonly label: string | null;
  /** The raw message the mark describes itself with, `null` when it carries none. */
  readonly full: string | null;
}

/**
 * Where a step's staleness marks are written: beside its photograph, under the same name.
 *
 * @param shot the photograph's path, `…/01-queue.png`
 * @returns e.g. `…/01-queue.stale-marks.json`
 */
export function staleMarksPath({ shot }: { shot: string }): string {
  return `${shot.replace(/\.png$/u, "")}.stale-marks.json`;
}

/**
 * Read every staleness mark the page draws now.
 *
 * @param page the settled page
 * @returns each mark's words, empty when none is drawn or the page closed under the read
 */
async function staleMarksOn({ page }: { page: Page }): Promise<readonly E2eStaleMark[]> {
  if (page.isClosed()) {
    return [];
  }
  return page
    .locator(STALE_MARK_SELECTOR)
    .evaluateAll((marks) =>
      marks.map((mark) => {
        let id = mark.getAttribute("aria-describedby");
        if (id === null && mark.parentElement !== null) {
          id = mark.parentElement.getAttribute("data-warning-mark");
        }
        let full: string | null = null;
        if (id !== null) {
          const described = mark.ownerDocument.getElementById(id);
          if (described !== null) {
            full = described.textContent;
          }
        }
        return { full, label: mark.getAttribute("aria-label") };
      }),
    )
    .catch((): readonly E2eStaleMark[] => []);
}

/**
 * Write the page's staleness marks beside the step's photograph when it draws any, so the proof folder names the
 * readings that did not answer. A page drawing none writes nothing.
 *
 * @param page the settled page
 * @param shot the step's photograph path
 * @returns the marks written, empty when none was drawn
 */
export async function recordStaleMarks({ page, shot }: { page: Page; shot: string }): Promise<readonly E2eStaleMark[]> {
  const marks = await staleMarksOn({ page });
  if (marks.length > 0) {
    writeFileAtomic({ contents: `${JSON.stringify(marks, null, 2)}\n`, path: staleMarksPath({ shot }) });
  }
  return marks;
}
