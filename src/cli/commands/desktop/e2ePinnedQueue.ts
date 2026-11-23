/**
 * The `queue-pinned` step of `slopweaver desktop e2e`, its effectful half: make the step's three moves on the real
 * test instance — a deep link beside the Queue, the voice window's own `presentConsoleCard`, the Queue deep link the
 * voice's `browser_open` minted — and read the tab strip after each. What each move must leave, and
 * why, is the pure half's (`../../../desktop/e2ePinnedQueue.ts`).
 *
 * The deep links are handed to the instance's own `open-url` handler from its main process, because macOS would route
 * a real `open slopweaver://…` to the owner's app, which holds the scheme; the test instance must never be reached that way and
 * the owner's must never be touched. The card is sent from the instance's voice window, the one sender main takes it from.
 */
import type { ElectronApplication, Page } from "playwright-core";

import { type E2eStepBlock, E2eStepBlocks } from "../../../desktop/e2eErrors.js";
import { type PinnedQueueMove, type PinnedQueueSnapshot, pinnedQueueBreaks } from "../../../desktop/e2ePinnedQueue.js";
import { QUEUE_ROW, VOICE_PATH } from "../../../desktop/e2ePlan.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { consolePathOfUrl, pause, photograph, SETTLE_CAP_MS, waitForPage } from "./e2ePage.js";
import { acted, type E2eActed } from "./e2eQueueCard.js";

/** The page beside the Queue the step opens, a sidebar page that is not the Queue. */
const BESIDE_PATH = "/alignment";

/** The address the voice's `browser_open` handed the app on a real call. */
const VOICE_QUEUE_PATH = "/queue?context=slopweaver";

/** How long one move has to settle before its snapshot is judged as it stands. */
const MOVE_CAP_MS = 15_000;

/** How often a settling move is re-read. */
const MOVE_POLL_MS = 250;

/** One tab in the strip (`desktop/src/tabStrip.ts` `stripMarkup`). */
export const STRIP_TAB = '#strip [role="tab"]';

/** The most tabs the cleanup closes: the step opens two, a broken shell perhaps a duplicate Queue tab per move. */
const MAX_CLOSES = 8;

/**
 * Hand a console path to the instance's own deep-link handler, exactly as macOS hands it a `slopweaver://open` address.
 *
 * @param app the instance
 * @param path the console path
 */
async function emitDeepLink({ app, path }: { app: ElectronApplication; path: string }): Promise<void> {
  const link = new URL("slopweaver://open");
  link.searchParams.set("path", path);
  await app.evaluate(({ app: shell }, url) => {
    // `src/` has no Electron types; `open-url` is the event `desktop/src/launch.ts` listens on.
    shell.emit("open-url", { preventDefault: () => undefined }, url);
  }, link.toString());
}

/**
 * The instance's tab strip: the one `data:` page drawing `#strip` (`desktop/src/tabStripLook.ts`).
 *
 * @param app the instance
 * @returns the strip's page, or `undefined` when none draws it
 */
export async function stripPage({ app }: { app: ElectronApplication }): Promise<Page | undefined> {
  for (const page of app.context().pages()) {
    if (!page.isClosed() && page.url().startsWith("data:") && (await page.locator("#strip").count()) > 0) {
      return page;
    }
  }
  return undefined;
}

/**
 * Read what the app shows now.
 *
 * @param app the instance
 * @param strip the tab strip
 * @param pinned the pinned tab's page
 * @returns the snapshot
 */
async function snapshotOf({
  app,
  strip,
  pinned,
}: {
  app: ElectronApplication;
  strip: Page;
  pinned: Page;
}): Promise<PinnedQueueSnapshot> {
  const queuePages = app
    .context()
    .pages()
    .filter((page) => !page.isClosed() && consolePathOfUrl({ url: page.url() }) === "/queue").length;
  let pinnedAddress: string | undefined;
  if (!pinned.isClosed() && pinned.url().startsWith("http")) {
    const url = new URL(pinned.url());
    pinnedAddress = `${url.pathname}${url.search}`;
  }
  return {
    pinnedAddress,
    pinnedSelected: (await strip.locator('#strip .tab.pinned[aria-selected="true"]').count()) === 1,
    queuePages,
    tabs: await strip.locator(STRIP_TAB).count(),
  };
}

/**
 * Make one move and wait, bounded, for the strip to show what it should; judge it as it stands at the cap.
 *
 * @param app the instance
 * @param strip the tab strip
 * @param pinned the pinned tab's page
 * @param move what to judge it as
 * @param make the move itself
 * @returns the snapshot it settled on, or every requirement it broke
 */
async function moveAndJudge({
  app,
  strip,
  pinned,
  move,
  make,
}: {
  app: ElectronApplication;
  strip: Page;
  pinned: Page;
  move: PinnedQueueMove;
  make: () => Promise<unknown>;
}): Promise<Result<PinnedQueueSnapshot, E2eStepBlock>> {
  const before = await snapshotOf({ app, pinned, strip });
  await make();
  const deadline = Date.now() + MOVE_CAP_MS;
  for (;;) {
    const after = await snapshotOf({ app, pinned, strip });
    const breaks = pinnedQueueBreaks({ after, before, move });
    if (breaks.length === 0) {
      return ok(after);
    }
    if (Date.now() > deadline) {
      return err(E2eStepBlocks.queueNotPinned({ breaks, move: move.kind }));
    }
    await pause({ ms: MOVE_POLL_MS });
  }
}

/** One planned move: what it is judged as, and the address it hands the app by which route. */
export interface PinnedQueuePlannedMove {
  readonly move: PinnedQueueMove;
  /** `deep-link` hands the path to the app's `open-url` handler; `voice-card` sends it as the voice's `open_card`. */
  readonly via: "deep-link" | "voice-card";
  readonly path: string;
}

/**
 * The step's four moves, in order: beside, the voice's card, beside again, the voice's Queue link.
 *
 * @param cardKey the first Queue row's card, the one the voice's card opens
 * @returns the moves the step makes
 */
export function pinnedQueuePlan({ cardKey }: { cardKey: string }): readonly PinnedQueuePlannedMove[] {
  const beside: PinnedQueuePlannedMove = { move: { kind: "beside" }, path: BESIDE_PATH, via: "deep-link" };
  return [
    beside,
    { move: { cardKey, kind: "card" }, path: `/queue?open=${encodeURIComponent(cardKey)}`, via: "voice-card" },
    beside,
    { move: { kind: "queue" }, path: VOICE_QUEUE_PATH, via: "deep-link" },
  ];
}

/**
 * Make one planned move on the instance.
 *
 * @param app the instance
 * @param voice the instance's voice window, the one sender main takes a card from
 * @param planned the move
 * @returns whatever the move's call resolved to
 */
async function makeMove({
  app,
  voice,
  planned,
}: {
  app: ElectronApplication;
  voice: Page;
  planned: PinnedQueuePlannedMove;
}): Promise<unknown> {
  if (planned.via === "deep-link") {
    return emitDeepLink({ app, path: planned.path });
  }
  // The bridge `desktop/src/preload.ts` exposes to the voice window. It is called as an expression string because
  // `src/` has no type for the preload's global, and asserting one is the unsafe cast lint refuses.
  return voice.evaluate(`globalThis.slopweaverDesktop.presentConsoleCard(${JSON.stringify({ path: planned.path })})`);
}

/**
 * Take the step: beside, the voice's card, beside again, the voice's Queue link — each judged as it lands — then
 * photograph the strip, so the report shows which tab was in front, and close the tabs it opened.
 *
 * @param app the instance
 * @param pinned the pinned tab's page, the Queue the walk landed on
 * @param stripShot where the strip's photograph goes
 * @returns the pinned tab's page to photograph, or the first move that broke the steer
 */
export async function proveQueuePinned({
  app,
  pinned,
  stripShot,
}: {
  app: ElectronApplication;
  pinned: Page;
  stripShot: string;
}): Promise<Result<E2eActed, E2eStepBlock>> {
  const strip = await stripPage({ app });
  if (strip === undefined) {
    return err(E2eStepBlocks.noTabStrip());
  }
  const row = pinned.locator(QUEUE_ROW).first();
  await row.waitFor({ timeout: SETTLE_CAP_MS }).catch(() => undefined);
  const cardKey = await row.getAttribute("data-card-key").catch(() => null);
  if (cardKey === null) {
    return err(E2eStepBlocks.noQueueCard());
  }
  const voice = await waitForPage({ app, capMs: SETTLE_CAP_MS, path: VOICE_PATH });
  if (voice === undefined) {
    return err(E2eStepBlocks.pageNeverShown({ after: "the app opened its voice window", path: VOICE_PATH }));
  }
  const baseline = await strip.locator(STRIP_TAB).count();
  const standing = new Set(app.context().pages());
  let broke: E2eStepBlock | undefined;
  // A move that throws is a block like any break, and the tabs already opened are closed either way: a leaked one is
  // what the next step's newest-page lookup would land on.
  try {
    for (const planned of pinnedQueuePlan({ cardKey })) {
      const make = async (): Promise<unknown> => makeMove({ app, planned, voice });
      const judged = await moveAndJudge({ app, make, move: planned.move, pinned, strip });
      if (judged.isErr()) {
        broke = judged.error;
        break;
      }
    }
  } catch (cause: unknown) {
    broke = E2eStepBlocks.actionThrew({ cause });
  } finally {
    await photograph({ page: strip, path: stripShot }).catch(() => undefined);
    await closeOpenedTabs({ baseline, strip }).catch(() => undefined);
    await closeOpenedPages({ app, standing });
  }
  if (broke !== undefined) {
    return err(broke);
  }
  return ok(acted({ page: pinned }));
}

/**
 * Close every tab the step opened, from the strip's own close buttons, so the steps after it find the console page
 * the walk is on rather than one of this step's: `waitForPage` takes the newest page at a path.
 *
 * @param strip the tab strip
 * @param baseline how many tabs stood before the step
 */
export async function closeOpenedTabs({ strip, baseline }: { strip: Page; baseline: number }): Promise<void> {
  for (let left = MAX_CLOSES; left > 0 && (await strip.locator(STRIP_TAB).count()) > baseline; left -= 1) {
    await strip
      .locator(`${STRIP_TAB} button.close`)
      .last()
      .click()
      .catch(() => undefined);
    await pause({ ms: MOVE_POLL_MS });
  }
}

/**
 * The backstop when the strip could not close a tab (its renderer gone, say): close every page the step opened
 * directly. `waitForPage` never takes a closed page, so none of them can stand in for a later step's.
 *
 * @param app the instance
 * @param standing every page that stood before the step's first move
 */
export async function closeOpenedPages({
  app,
  standing,
}: {
  app: ElectronApplication;
  standing: ReadonlySet<Page>;
}): Promise<void> {
  for (const page of app.context().pages()) {
    if (!standing.has(page) && !page.isClosed()) {
      await page.close().catch(() => undefined);
    }
  }
}
