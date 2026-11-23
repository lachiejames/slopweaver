/**
 * How `slopweaver desktop e2e` LOOKS at a test instance's pages: which page shows a path, whether a step's landmark
 * is drawn and its loading marks gone, the errors each page raises, and its photograph. Nothing here clicks; the
 * acts are `e2eDriver.ts`'s and `e2eControlsCheck.ts`'s.
 *
 * **What a step watches.** Every console page the instance opens is watched from the moment it appears: an uncaught
 * error, a `console.error` and a 5xx answer are each written against the step that was running, so a failure names
 * the step it happened on rather than the step that noticed it.
 */
import type { ElectronApplication, Frame, Page } from "playwright-core";

import { unsetFieldAsNull } from "#lib/absent.js";
import { err, ok, type Result } from "#lib/result.js";
import { type E2eStepBlock, E2eStepBlocks } from "../../../desktop/e2eErrors.js";
import {
  DOCS_PATH,
  type E2eLandmark,
  type E2eStep,
  type E2eViewerControl,
  landmarkOf,
  NEXT_ERROR_OVERLAY,
  STILL_LOADING,
} from "../../../desktop/e2ePlan.js";
import { E2E_SETTLE_CAP_DEFAULT_MS } from "../../../desktop/e2eSettleCap.js";

/**
 * How long a wait that is not a step's settle looks for a page to show (`--settle-cap` moves only the settle, never
 * this).
 */
export const SETTLE_CAP_MS = E2E_SETTLE_CAP_DEFAULT_MS;

/** How often a wait looks. */
const POLL_MS = 250;

/** The errors written against the step running when they happened. */
export interface StepLedger {
  pageErrors: string[];
  consoleErrors: string[];
  serverErrors: string[];
}

/**
 * A fresh, empty ledger.
 *
 * @returns a ledger with nothing written against it
 */
export function freshLedger(): StepLedger {
  return { consoleErrors: [], pageErrors: [], serverErrors: [] };
}

/**
 * Wait without holding the event loop.
 *
 * @param ms how long
 */
export async function pause({ ms }: { ms: number }): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * An address's console path, or `undefined` for one that is not on the console (a `data:` strip or note).
 *
 * @param url the whole address
 * @returns its path
 */
export function consolePathOfUrl({ url }: { url: string }): string | undefined {
  if (!url.startsWith("http")) {
    return undefined;
  }
  return new URL(url).pathname;
}

/**
 * Where an error happened, as a report line names it: the console path, or the whole address of a page off it.
 *
 * @param page the page that raised it
 * @returns the place
 */
function whereOf({ page }: { page: Page }): string {
  const url = page.url();
  const path = consolePathOfUrl({ url });
  if (path === undefined) {
    return url;
  }
  return path;
}

/**
 * The frame a step is judged in: the docs' own frame inside the viewer, the fixture page's frame at exactly its own
 * path (so another file, a stale frame or a slug sharing its prefix never stands in for it), or the page itself for
 * every other step.
 *
 * @param page the page the step stands on
 * @param step the step
 * @param framePath the fixture page's path in the viewer's frame, `undefined` when none was written
 * @returns the frame, or `undefined` while the viewer has not loaded the document into its frame
 */
function frameOf({
  page,
  step,
  framePath,
}: {
  page: Page;
  step: E2eStep;
  framePath: string | undefined;
}): Frame | undefined {
  if (step.kind === "docs") {
    return page.frames().find((frame) => consolePathOfUrl({ url: frame.url() })?.startsWith(DOCS_PATH) === true);
  }
  if (step.kind === "published-page") {
    if (framePath === undefined) {
      return undefined;
    }
    return page.frames().find((frame) => consolePathOfUrl({ url: frame.url() }) === framePath);
  }
  return page.mainFrame();
}

/**
 * Whether the page's main frame draws every control a step names, each found by its role and exact name.
 *
 * @param page the page the step stands on
 * @param controls the controls it must draw
 * @returns true when every one is on screen, and for none named
 */
async function drawsControls({
  page,
  controls,
}: {
  page: Page;
  controls: readonly E2eViewerControl[];
}): Promise<boolean> {
  const drawn = await Promise.all(
    controls.map(async (control) =>
      page
        .getByRole(control.role, { exact: true, name: control.name })
        .first()
        .isVisible()
        .catch(() => false),
    ),
  );
  return drawn.every(Boolean);
}

/**
 * Wait until a page shows a path, the newest first, so a tab a link opened wins over the one it left.
 *
 * @param app the instance
 * @param path the path, matched as a prefix
 * @param capMs how long to wait
 * @returns the page, or `undefined` at the cap
 */
export async function waitForPage({
  app,
  path,
  capMs,
}: {
  app: ElectronApplication;
  path: string;
  capMs: number;
}): Promise<Page | undefined> {
  const deadline = Date.now() + capMs;
  for (;;) {
    const page = app
      .context()
      .pages()
      .toReversed()
      .find((one) => !one.isClosed() && consolePathOfUrl({ url: one.url() })?.startsWith(path) === true);
    if (page !== undefined || Date.now() > deadline) {
      return page;
    }
    await pause({ ms: POLL_MS });
  }
}

/**
 * Wait for a page at a path to show, after the move meant to show it.
 *
 * @param app the instance
 * @param path the page's path
 * @param after the move, as the failure names it
 * @returns the page, or that none showed
 */
export async function pageAt({
  app,
  path,
  after,
}: {
  app: ElectronApplication;
  path: string;
  after: string;
}): Promise<Result<Page, E2eStepBlock>> {
  const page = await waitForPage({ app, capMs: SETTLE_CAP_MS, path });
  return page === undefined ? err(E2eStepBlocks.pageNeverShown({ after, path })) : ok(page);
}

/**
 * Wait for a step's landmark, then for every loading mark to clear, up to the cap.
 *
 * The landmark counts as shown only when the page's main frame also draws every viewer control the step names.
 *
 * @param page the page the step stands on
 * @param framePath the fixture page's path in the viewer's frame, `undefined` when none was written
 * @param capMs how long to wait before photographing whatever is drawn (`--settle-cap`, default {@link SETTLE_CAP_MS})
 * @returns whether the landmark showed, what still said loading at the end (empty when nothing did), and Next's error
 *   dialog
 */
export async function settle({
  page,
  step,
  framePath,
  capMs,
}: {
  page: Page;
  step: E2eStep;
  framePath: string | undefined;
  capMs: number;
}): Promise<{ readonly landed: boolean; readonly stillLoading: readonly string[]; readonly errorOverlay: boolean }> {
  const landmark = landmarkOf({ step });
  const deadline = Date.now() + capMs;
  let landed = false;
  let stillLoading: readonly string[] = ["the page, never looked at before the cap"];
  let errorOverlay = false;
  // The overlay and the viewer's bar are read BEFORE the frame's landmark, so the frame that can change under the
  // walk is the last thing seen before returning. The bar is drawn from the
  // viewer's own address, which the walk does not move. Two reads are never one instant: the residue is a document
  // swapped between this landmark read and the photograph, which every step shares.
  while (Date.now() <= deadline) {
    const frame = frameOf({ framePath, page, step });
    errorOverlay = await hasErrorOverlay({ frame });
    const controlsDrawn = await drawsControls({ controls: landmark.viewerControls, page });
    const read = await readFrame({ frame, landmark });
    // Re-resolved with no await after the read: a frame that navigated off the exact path while it was read is not
    // the frame the step asked for.
    const stillThere = frameOf({ framePath, page, step }) === frame;
    landed = controlsDrawn && read.landed && stillThere;
    stillLoading = read.loading;
    if (landed && stillLoading.length === 0) {
      break;
    }
    await pause({ ms: POLL_MS });
  }
  return { errorOverlay, landed, stillLoading };
}

/**
 * One look for Next's error dialog in the frame a step is judged in, for a step that took no action and so has no
 * landmark to settle on — the card step on an empty Queue.
 *
 * @param page the page the step stands on
 * @param framePath the fixture page's path in the viewer's frame, `undefined` when none was written
 * @returns true when the dialog is drawn
 */
export async function errorOverlayShown({
  page,
  step,
  framePath,
}: {
  page: Page;
  step: E2eStep;
  framePath: string | undefined;
}): Promise<boolean> {
  return hasErrorOverlay({ frame: frameOf({ framePath, page, step }) });
}

/**
 * Whether Next's error dialog is drawn in a frame. A frame not there yet has none.
 *
 * @param frame the frame, or `undefined` while it has not appeared
 * @returns true when the dialog is drawn
 */
async function hasErrorOverlay({ frame }: { frame: Frame | undefined }): Promise<boolean> {
  if (frame === undefined) {
    return false;
  }
  const overlays = await frame
    .locator(NEXT_ERROR_OVERLAY)
    .count()
    .catch(() => 0);
  return overlays > 0;
}

/**
 * One look at a frame: whether the landmark is drawn on a page with width, and what still says loading, named so a
 * failure points at the element rather than at "something". A frame not there yet, or one navigating mid-look, reads
 * as not landed and still loading.
 *
 * @param frame the frame, or `undefined` while it has not appeared
 * @param landmark what the step waits for
 * @returns the look: EVERY loading mark, none dropped, as `<tag> <selector parts that matched> saying "<its progress
 *   indicator's label>" in "<labelled region>"`, the last two only when present, empty when nothing says loading
 */
async function readFrame({
  frame,
  landmark,
}: {
  frame: Frame | undefined;
  landmark: E2eLandmark;
}): Promise<{ readonly landed: boolean; readonly loading: readonly string[] }> {
  const notYet = { landed: false, loading: ["the page's frame, not drawn yet"] };
  if (frame === undefined) {
    return notYet;
  }
  return frame
    .evaluate(
      ({ present, absent, loading }) => ({
        landed:
          window.innerWidth > 0 &&
          document.querySelector(present) !== null &&
          (absent === null || document.querySelector(absent) === null),
        loading: [...document.querySelectorAll(loading)].map((element) => {
          const parts = loading.split(",").map((part) => part.trim());
          const matched = parts.filter((part) => element.matches(part)).join(" ");
          // The labelled region it sits in, itself included: a busy section's own label is WHERE, never what it says.
          const region = element.closest("[aria-label], [data-testid]");
          // A region is found by either attribute, so the one it carries names it: its label when it has one, else its
          // test id.
          const naming = region?.hasAttribute("aria-label") === true ? "aria-label" : "data-testid";
          const named = region?.getAttribute(naming);
          const where = named == null ? "" : ` in "${named.slice(0, 80)}"`;
          // What it says is only ever the console's own progress indicator's label (`[data-spinner]`,
          // `site/components/ui/spinner.tsx`), never any other labelled descendant: a tone marker inside a busy
          // section, or an `<output>` holding data.
          const indicator = element.matches("[data-spinner][aria-label]")
            ? element
            : element.querySelector("[data-spinner][aria-label]");
          const inner = indicator?.getAttribute("aria-label");
          const says = inner == null ? "" : ` saying "${inner.slice(0, 80)}"`;
          return `${element.tagName.toLowerCase()} ${matched}${says}${where}`;
        }),
      }),
      {
        absent: unsetFieldAsNull({ key: "absent", record: landmark }),
        loading: STILL_LOADING,
        present: landmark.present,
      },
    )
    .catch(() => notYet);
}

/**
 * Watch one page for the errors a step is judged on, writing each against the step running when it happened.
 *
 * @param ledger the running step's ledger, read at the moment of each error
 */
export function watch({ page, ledger }: { page: Page; ledger: () => StepLedger }): void {
  page.on("pageerror", (error) => {
    ledger().pageErrors.push(`${whereOf({ page })}: ${error.message}`);
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      ledger().consoleErrors.push(`${whereOf({ page })}: ${message.text().slice(0, 400)}`);
    }
  });
  page.on("response", (response) => {
    if (response.status() >= 500) {
      ledger().serverErrors.push(`${String(response.status())} ${response.url()}`);
    }
  });
}

/**
 * Photograph a page, never failing the walk for want of one.
 *
 * @param path where the photograph goes
 * @returns the path, or `undefined` when it could not be taken
 */
export async function photograph({ page, path }: { page: Page; path: string }): Promise<string | undefined> {
  return page
    .screenshot({ path })
    .then(() => path)
    .catch(() => undefined);
}
