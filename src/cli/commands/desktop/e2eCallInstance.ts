/**
 * The call leg's acts on the test instance rather than on one page: a reading of the voice page's heap, crashing the
 * voice window's renderer — the one act no person can perform — finding the voice window that answers, on a fresh
 * instance and after a crash, and hanging up on every voice window before closing the instance.
 */
import type { ElectronApplication, Page } from "playwright-core";

import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";
import { type E2eCallError, E2eCallErrors } from "../../../desktop/e2eCallErrors.js";
import type { E2eHeapSample } from "../../../desktop/e2eHeapTrend.js";
import { VOICE_PATH } from "../../../desktop/e2ePlan.js";
import { closeE2eApp } from "./e2eApp.js";
import { hangUp, isIdle, until, voiceAnswers } from "./e2eCallPage.js";
import { contentsView, pageView, type VoiceView } from "./e2eCallView.js";
import { consolePathOfUrl, pause } from "./e2ePage.js";

/**
 * Hang up on every voice page, and on the voice window's web contents for a page Playwright lost to a crash, then
 * close the instance.
 *
 * @param app the instance
 */
export async function hangUpAndClose({ app }: { app: ElectronApplication }): Promise<void> {
  const voices = app
    .context()
    .pages()
    .filter((page) => !page.isClosed() && consolePathOfUrl({ url: page.url() }) === VOICE_PATH)
    .map((page) => pageView({ page }));
  for (const view of [...voices, contentsView({ app })]) {
    if (await hangUp({ view })) {
      await until({ capMs: 15_000, test: async () => isIdle({ view }) });
    }
  }
  await closeE2eApp({ app });
}

/**
 * One raw reading of the page's JavaScript heap, through a debugging session on the channel Playwright already
 * holds. No collection is forced: that would change what is being measured.
 *
 * @param app the instance
 * @param page the voice page
 * @param elapsedMs when, from the start of the hold
 * @returns the sample, or `undefined` when the page could not be read
 */
export async function sampleJsHeap({
  app,
  page,
  elapsedMs,
}: {
  app: ElectronApplication;
  page: Page;
  elapsedMs: number;
}): Promise<E2eHeapSample | undefined> {
  try {
    const session = await app.context().newCDPSession(page);
    const usage: unknown = await session.send("Runtime.getHeapUsage");
    await session.detach().catch(() => undefined);
    if (!isRecord(usage) || typeof usage["usedSize"] !== "number") {
      return undefined;
    }
    return { elapsedMs, usedBytes: usage["usedSize"] };
  } catch {
    return undefined;
  }
}

/**
 * Crash the voice window's renderer, the way an out-of-memory death does: through Electron's own
 * `forcefullyCrashRenderer`, on the ONE live window whose page is `/voice`.
 *
 * @param app the instance
 * @returns nothing once crashed, or how many windows matched when it was not exactly one
 */
export async function crashVoiceRenderer({ app }: { app: ElectronApplication }): Promise<Result<void, E2eCallError>> {
  const found = await app
    .evaluate(({ webContents }, path) => {
      // `src/` has no Electron types, so the one shape read here is spelled out.
      const all: readonly {
        isDestroyed: () => boolean;
        isCrashed: () => boolean;
        getURL: () => string;
        forcefullyCrashRenderer: () => void;
      }[] = webContents.getAllWebContents();
      const matching = all.filter((contents) => {
        try {
          return !contents.isDestroyed() && !contents.isCrashed() && new URL(contents.getURL()).pathname === path;
        } catch {
          return false;
        }
      });
      if (matching.length === 1) {
        matching[0]!.forcefullyCrashRenderer();
      }
      return matching.length;
    }, VOICE_PATH)
    .catch(() => -1);
  return found === 1 ? ok(undefined) : err(E2eCallErrors.voiceWindowUnclear({ found }));
}

/**
 * The voice window after a renderer crash, once its reloaded page answers: driven through its web contents, because
 * Playwright's page for it stays crashed (`./e2eCallView.ts`).
 *
 * @param app the instance
 * @param capMs how long to wait
 * @returns the view, or `undefined` at the cap
 */
export async function recoveredVoiceView({
  app,
  capMs,
}: {
  app: ElectronApplication;
  capMs: number;
}): Promise<VoiceView | undefined> {
  const view = contentsView({ app });
  return (await until({ capMs, test: async () => voiceAnswers({ view }) })) ? view : undefined;
}

/**
 * A fresh instance's voice page that answers, newest first.
 *
 * @param app the instance
 * @param capMs how long to wait
 * @returns the page, or `undefined` at the cap
 */
export async function answeringVoicePage({
  app,
  capMs,
}: {
  app: ElectronApplication;
  capMs: number;
}): Promise<Page | undefined> {
  const deadline = Date.now() + capMs;
  while (Date.now() <= deadline) {
    const candidates = app
      .context()
      .pages()
      .filter((page) => !page.isClosed() && consolePathOfUrl({ url: page.url() }) === VOICE_PATH)
      .toReversed();
    for (const page of candidates) {
      if (await voiceAnswers({ view: pageView({ page }) })) {
        return page;
      }
    }
    await pause({ ms: 500 });
  }
  return undefined;
}
