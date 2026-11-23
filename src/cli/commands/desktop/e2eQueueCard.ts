/**
 * The Queue card step of `slopweaver desktop e2e`, apart from the walk that takes it (`./e2eDriver.ts`): open the
 * first card, or find the Queue proven empty and call the step not applicable. An empty Queue is a state, never a
 * failure, so it is not a block; a Queue that never says it is empty is not proven empty, so that still is one.
 *
 * A not-applicable verdict stands on its photograph. The step's photograph must have been taken, and the
 * measured-zero line must still be drawn once it was, else nothing shows the Queue empty and the step is blocked.
 * Before it, such a step settles differently from one that acted: it has no landmark to wait for.
 */
import type { Page } from "playwright-core";

import {
  type E2eStepBlock,
  E2eStepBlocks,
  type E2eStepNotApplicable,
  E2eStepNotApplicables,
} from "../../../desktop/e2eErrors.js";
import { type E2eStep, QUEUE_EMPTY, QUEUE_ROW, queueCardState } from "../../../desktop/e2ePlan.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { errorOverlayShown, SETTLE_CAP_MS, settle } from "./e2ePage.js";

/** What a step's action left: the page to judge, and why it had nothing to act on when it did not act. */
export interface E2eActed {
  readonly page: Page;
  readonly notApplicable: E2eStepNotApplicable | undefined;
}

/**
 * An action that acted, on the page it left standing.
 *
 * @returns the acted shape
 */
export function acted({ page }: { page: Page }): E2eActed {
  return { notApplicable: undefined, page };
}

/**
 * Open the first Queue card. A Queue still reading draws neither a row nor its measured-zero line, so the step waits,
 * bounded, for one of the two before it decides: a row is opened, the line makes the step not applicable, and neither
 * is a block, because a Queue that never says it is empty has not been proven empty.
 *
 * @param current the Queue page
 * @returns the same page, its card open or the Queue proven empty, or that the Queue showed neither
 */
export async function openQueueCard({ current }: { current: Page }): Promise<Result<E2eActed, E2eStepBlock>> {
  await current
    .locator(`${QUEUE_ROW}, ${QUEUE_EMPTY}`)
    .first()
    .waitFor({ timeout: SETTLE_CAP_MS })
    .catch(() => undefined);
  const row = current.locator(QUEUE_ROW).first();
  const state = queueCardState({
    emptyShown: (await current.locator(QUEUE_EMPTY).count()) > 0,
    rowShown: (await row.count()) > 0,
  });
  switch (state) {
    case "row": {
      await row.click();
      return ok(acted({ page: current }));
    }
    case "empty":
      return ok({ notApplicable: E2eStepNotApplicables.queueEmpty(), page: current });
    case "unproven":
      return err(E2eStepBlocks.noQueueCard());
    default: {
      const unreachable: never = state;
      return unreachable;
    }
  }
}

/**
 * What the judge takes once the step is photographed. A step that acted keeps its block, if any. A step sampled as not
 * applicable stays so only when its photograph was taken and the measured-zero line was still drawn after it; either
 * missing, it is blocked, because nothing then shows the Queue empty.
 *
 * @param blocked what blocked the action, `undefined` when nothing did
 * @param notApplicable why the step had nothing to act on when it looked, `undefined` when it acted
 * @param screenshot the photograph's path, `undefined` when it could not be taken
 * @param emptyDrawn the measured-zero line was drawn once the photograph was taken
 * @returns the block and the not-applicable reason the judge takes
 */
export function afterPhotograph({
  blocked,
  notApplicable,
  screenshot,
  emptyDrawn,
}: {
  blocked: string | undefined;
  notApplicable: E2eStepNotApplicable | undefined;
  screenshot: string | undefined;
  emptyDrawn: boolean;
}): { readonly blocked: string | undefined; readonly notApplicable: string | undefined } {
  if (notApplicable === undefined) {
    return { blocked, notApplicable: undefined };
  }
  if (screenshot === undefined) {
    return { blocked: E2eStepBlocks.queueEmptyUnphotographed().message, notApplicable: undefined };
  }
  if (!emptyDrawn) {
    return { blocked: E2eStepBlocks.queueEmptyLost().message, notApplicable: undefined };
  }
  return { blocked, notApplicable: notApplicable.message };
}

/**
 * {@link afterPhotograph} over the page as it stands once photographed: it looks for the measured-zero line only when
 * the step was sampled as not applicable.
 *
 * @param blocked what blocked the action, `undefined` when nothing did
 * @param notApplicable why the step had nothing to act on when it looked, `undefined` when it acted
 * @param page the page photographed
 * @param screenshot the photograph's path, `undefined` when it could not be taken
 * @returns the block and the not-applicable reason the judge takes
 */
export async function stillNotApplicable({
  blocked,
  notApplicable,
  page,
  screenshot,
}: {
  blocked: string | undefined;
  notApplicable: E2eStepNotApplicable | undefined;
  page: Page;
  screenshot: string | undefined;
}): Promise<{ readonly blocked: string | undefined; readonly notApplicable: string | undefined }> {
  const emptyDrawn =
    notApplicable !== undefined &&
    (await page
      .locator(QUEUE_EMPTY)
      .count()
      .catch(() => 0)) > 0;
  return afterPhotograph({ blocked, emptyDrawn, notApplicable, screenshot });
}

/**
 * What a step settled into. A blocked step never settled; a step with nothing to act on has no landmark to wait 30s
 * for, so it takes one look for Next's error overlay and nothing else; every other step settles on its landmark.
 *
 * @param didAct the action did not block
 * @param notApplicable why the step had nothing to act on, `undefined` when it acted
 * @param page the page it left standing
 * @param step the step taken
 * @param framePath the fixture page's path in the viewer's frame
 * @param settleCapMs how long the landmark and the loading marks are waited on (`--settle-cap`)
 * @returns the landmark, loading and overlay reads the judge takes
 */
export async function settledOf({
  didAct,
  notApplicable,
  page,
  step,
  framePath,
  settleCapMs,
}: {
  didAct: boolean;
  notApplicable: E2eStepNotApplicable | undefined;
  page: Page;
  step: E2eStep;
  framePath: string | undefined;
  settleCapMs: number;
}): Promise<{ readonly errorOverlay: boolean; readonly landed: boolean; readonly stillLoading: readonly string[] }> {
  if (!didAct) {
    return { errorOverlay: false, landed: false, stillLoading: [] };
  }
  if (notApplicable !== undefined) {
    return { errorOverlay: await errorOverlayShown({ framePath, page, step }), landed: false, stillLoading: [] };
  }
  return settle({ capMs: settleCapMs, framePath, page, step });
}
