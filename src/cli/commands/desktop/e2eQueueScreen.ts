/**
 * The `queue-screen-reading` step of `slopweaver desktop e2e`, its effectful half: on the real test instance, read the
 * keys the pinned Queue tab's rows carry, top to bottom, then ask for the Queue on screen from the voice's window
 * through the very bridge its Queue tools ask through, and judge the two together. What must hold, and why, is the
 * pure half's (`../../../desktop/e2eQueueScreen.ts`). No call is placed.
 */
import type { ElectronApplication, Page } from "playwright-core";

import { type E2eStepBlock, E2eStepBlocks, E2eStepNotApplicables } from "../../../desktop/e2eErrors.js";
import { QUEUE_EMPTY, QUEUE_ROW, queueCardState, VOICE_PATH } from "../../../desktop/e2ePlan.js";
import { queueScreenBreaks, sameKeys } from "../../../desktop/e2eQueueScreen.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { SETTLE_CAP_MS, waitForPage } from "./e2ePage.js";
import { acted, type E2eActed } from "./e2eQueueCard.js";

/**
 * The keys the Queue's rows carry, top to bottom.
 *
 * @param queue the pinned Queue tab's page
 * @returns the keys, one per row
 * @throws when the rows cannot be read or a row carries no key: either would read a drawn Queue as an empty one, which
 *   an empty answer then matches, so the step's own catch blocks it instead
 */
async function drawnKeysOn({ queue }: { queue: Page }): Promise<readonly string[]> {
  const keys = await queue
    .locator(QUEUE_ROW)
    .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-card-key")));
  return keys.map((key, index) => {
    if (key === null) {
      throw new Error(`the Queue's row ${String(index + 1)} carries no data-card-key, so its order cannot be read`);
    }
    return key;
  });
}

/**
 * Judge one ask: the Queue read before and after it must agree, so a Queue that redrew under the ask is said rather
 * than judged, and then the answer must be the Queue those reads saw.
 *
 * @param before the Queue rows' keys read just before the ask
 * @param after the same read just after it
 * @param answer what the voice window's bridge resolved
 * @returns why the step fails, or `undefined` when the voice was handed the Queue on screen
 */
export function queueScreenJudged({
  before,
  after,
  answer,
}: {
  before: readonly string[];
  after: readonly string[];
  answer: unknown;
}): E2eStepBlock | undefined {
  if (!sameKeys({ left: before, right: after })) {
    return E2eStepBlocks.queueScreenMoved({ after: after.length, before: before.length });
  }
  const breaks = queueScreenBreaks({ seen: { answer, drawnKeys: before } });
  if (breaks.length > 0) {
    return E2eStepBlocks.queueScreenNotOwners({ breaks });
  }
  return undefined;
}

/**
 * Take the step: the Queue's drawn keys, the voice window's ask, and the judgement over both. The Queue is read again
 * after the ask and both reads must agree, so a Queue that redrew under the ask is said rather than judged.
 *
 * @param app the instance
 * @param pinned the pinned tab's page, on the Queue
 * @returns the Queue's page to photograph, or every way the voice's Queue was not the owner's
 */
export async function proveQueueScreen({
  app,
  pinned,
}: {
  app: ElectronApplication;
  pinned: Page;
}): Promise<Result<E2eActed, E2eStepBlock>> {
  await pinned
    .locator(`${QUEUE_ROW}, ${QUEUE_EMPTY}`)
    .first()
    .waitFor({ timeout: SETTLE_CAP_MS })
    .catch(() => undefined);
  // An empty Queue matches any empty answer, so it proves nothing about order: the step did not run, exactly as the
  // card step on an empty Queue (`./e2eQueueCard.ts`).
  const state = queueCardState({
    emptyShown: (await pinned.locator(QUEUE_EMPTY).count()) > 0,
    rowShown: (await pinned.locator(QUEUE_ROW).count()) > 0,
  });
  if (state === "empty") {
    return ok({ notApplicable: E2eStepNotApplicables.queueEmpty(), page: pinned });
  }
  if (state === "unproven") {
    return err(E2eStepBlocks.noQueueCard());
  }
  const voice = await waitForPage({ app, capMs: SETTLE_CAP_MS, path: VOICE_PATH });
  if (voice === undefined) {
    return err(E2eStepBlocks.pageNeverShown({ after: "the app opened its voice window", path: VOICE_PATH }));
  }
  try {
    const before = await drawnKeysOn({ queue: pinned });
    // The bridge `desktop/src/preload.ts` exposes to the voice window, called as an expression string because `src/`
    // has no type for the preload's global (`./e2ePinnedQueue.ts` does the same).
    const answer: unknown = await voice.evaluate("globalThis.slopweaverDesktop.requestVoiceQueue()");
    const after = await drawnKeysOn({ queue: pinned });
    const block = queueScreenJudged({ after, answer, before });
    if (block !== undefined) {
      return err(block);
    }
  } catch (cause: unknown) {
    return err(E2eStepBlocks.actionThrew({ cause }));
  }
  return ok(acted({ page: pinned }));
}
