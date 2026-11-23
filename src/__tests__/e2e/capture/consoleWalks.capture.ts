/**
 * The click-throughs `browser console-shot` photographs, one test per registered walk (`visualEvidence/consoleWalks.ts`),
 * run over the console lane's OWN fixtures: the run's throwaway store, each worker's throwaway home seeded with the
 * synthetic organisation, and its own `next start` (`../fixtures/`). Nothing here reads an installation's state.
 *
 * Only `config/playwright/capture.ts` collects this file (`*.capture.ts`), and only `browser console-shot` runs that
 * config, naming one walk with `--grep` and the directory to write into with {@link CONSOLE_SHOT_DIR_ENV}. Each test
 * opens the walk's path, runs its steps, waits on every witness and for no tile still reading, walks the page's visible text, cuts the region, and
 * walks the text again; the verb turns what it leaves into a capture receipt.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Page } from "@playwright/test";

import { MAX_PAGE_TEXT_NODES, PAGE_TEXT_SOURCE } from "../../../browser/evidenceCaptureSnippet.js";
import {
  CONSOLE_OBSERVATION_FILE,
  CONSOLE_RAW_SHOT_FILE,
  CONSOLE_SHOT_DIR_ENV,
  type ConsoleObservation,
} from "../../../visualEvidence/consoleShot.js";
import { CONSOLE_WALKS, type ConsoleWalk } from "../../../visualEvidence/consoleWalks.js";
import { expect, LIVE_READ_TIMEOUT_MS, test } from "../fixtures/test.js";

/**
 * A live tile still on its first read: `ReadingIndicator`'s block spinner marks itself `aria-busy`. The shutter waits until
 * none is left in `main`, so a picture shows what the page read rather than a spinner where it goes (measured: the
 * first automations-context capture fired with the Automations tile still reading).
 */
const STILL_READING = 'main [aria-busy="true"]';

/** The clicks each walk makes after opening its path, keyed by the walk's registered name. */
const STEPS: Readonly<Record<string, ({ page }: { page: Page }) => Promise<void>>> = {
  "automations-context": async ({ page }) => {
    await page.locator("[data-context]").locator('button[aria-haspopup="menu"]').click();
    await page.locator('ul[aria-label="context"] button', { hasText: "Slopweaver" }).click();
  },
};

/**
 * The directory the verb handed this run, refused by name when absent.
 *
 * @returns the directory
 */
function captureDirectory(): string {
  const directory = process.env[CONSOLE_SHOT_DIR_ENV];
  if (directory === undefined || directory === "") {
    throw new Error(`${CONSOLE_SHOT_DIR_ENV} is unset: only \`slopweaver browser console-shot\` runs this config`);
  }
  return directory;
}

/**
 * The page's visible text, by `browser shot`'s own walker.
 *
 * @param page the page
 * @returns what the walker reported
 */
async function walkText({ page }: { page: Page }): Promise<ConsoleObservation["before"]> {
  return page.evaluate(`(${PAGE_TEXT_SOURCE})(${String(MAX_PAGE_TEXT_NODES)})`);
}

/**
 * The union of the walk's region selectors, in viewport CSS pixels, clipped to the viewport.
 *
 * @param page the page
 * @param walk the walk
 * @returns the rectangle
 */
async function regionOf({ page, walk }: { page: Page; walk: ConsoleWalk }): Promise<ConsoleObservation["regionCss"]> {
  const boxes = await Promise.all(
    walk.region.map(async (selector) => {
      const box = await page.locator(selector).first().boundingBox();
      if (box === null) {
        throw new Error(`the region selector ${selector} has no box on the page`);
      }
      return box;
    }),
  );
  const viewport = page.viewportSize()!;
  const left = Math.max(0, Math.min(...boxes.map((box) => box.x)));
  const top = Math.max(0, Math.min(...boxes.map((box) => box.y)));
  const right = Math.min(viewport.width, Math.max(...boxes.map((box) => box.x + box.width)));
  const bottom = Math.min(viewport.height, Math.max(...boxes.map((box) => box.y + box.height)));
  return { height: bottom - top, width: right - left, x: left, y: top };
}

test.describe.configure({ mode: "serial" });

test("every registered walk has steps here, and every step a registered walk", () => {
  expect(CONSOLE_WALKS.length).toBeGreaterThan(0);
  expect(Object.keys(STEPS).toSorted()).toEqual(CONSOLE_WALKS.map((walk) => walk.name).toSorted());
});

for (const walk of CONSOLE_WALKS) {
  test(`walk:${walk.name}`, async ({ page }) => {
    const directory = captureDirectory();
    mkdirSync(directory, { recursive: true });
    await page.goto(walk.initialPath);
    await STEPS[walk.name]!({ page });
    for (const witness of walk.witnesses) {
      await expect(page.locator(witness).first()).toBeVisible({ timeout: LIVE_READ_TIMEOUT_MS });
    }
    await expect(page.locator(STILL_READING)).toHaveCount(0, { timeout: LIVE_READ_TIMEOUT_MS });
    const regionCss = await regionOf({ page, walk });
    const before = await walkText({ page });
    await page.screenshot({ clip: regionCss, path: join(directory, CONSOLE_RAW_SHOT_FILE) });
    const after = await walkText({ page });
    const viewport = page.viewportSize()!;
    const deviceScaleFactor = await page.evaluate("window.devicePixelRatio");
    const finalUrl = new URL(page.url());
    const observation: ConsoleObservation = {
      after,
      before,
      finalPath: `${finalUrl.pathname}${finalUrl.search}`,
      initialPath: walk.initialPath,
      regionCss,
      schemaVersion: 1,
      viewport: { deviceScaleFactor: Number(deviceScaleFactor), heightPx: viewport.height, widthPx: viewport.width },
      walk: walk.name,
      witnessesSeen: [...walk.witnesses],
    };
    writeFileSync(join(directory, CONSOLE_OBSERVATION_FILE), `${JSON.stringify(observation, null, 2)}\n`);
  });
}
