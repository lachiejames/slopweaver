/**
 * Read every open card the console draws, off a test instance's own Queue and Alignment pages, for `desktop e2e
 * --call --call-card all`: the effectful half of `src/desktop/e2eCardInventory.ts`. It opens each fold and reads the
 * `data-card-key` each card carries; it presses nothing else, and places no call.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Page } from "playwright-core";

import { err, ok, type Result } from "#lib/result.js";
import { type E2eCallError, E2eCallErrors } from "../../../desktop/e2eCallErrors.js";
import type { E2eCallStep } from "../../../desktop/e2eCallPlan.js";
import { type CardInventory, cardInventoryOf, inventorySettled } from "../../../desktop/e2eCardInventory.js";
import type { E2eWorkContext } from "../../../desktop/e2eWorkContext.js";
import type { OnCallHoldError } from "../../../desktop/onCallHold.js";
import { type CallSession, closeCallSession, openCallSession } from "./e2eCallSession.js";
import { pause, waitForPage } from "./e2ePage.js";

/** The pages read, in order: the Queue's cards before the Alignment page's, the order they are asked in. */
export const INVENTORY_PAGES = ["/queue", "/alignment"] as const;

/** How long the instance has to show its Queue, and each page to draw its cards. */
const PAGE_CAP_MS = 90_000;

/** The least time a page is read before an empty one counts as empty rather than still loading. */
const PAGE_MINIMUM_MS = 10_000;

/** How often a page is read. */
const READ_EVERY_MS = 2000;

/** The instance's microphone, which nothing presses Talk to hear: the session's launch needs one. */
const SILENT_STEP: E2eCallStep = {
  capMs: PAGE_CAP_MS,
  cardKey: undefined,
  holdMs: 0,
  id: "card-read-typed",
  kind: "call",
  prompt: "This is an automated end to end test.",
  silenceMs: 60_000,
};

/**
 * Read one page's card keys once every fold is open and the keys hold still.
 *
 * @param page the instance's console window
 * @param path the page's path
 * @returns the keys in drawn order, or that the page never settled
 */
async function keysOn({ page, path }: { page: Page; path: string }): Promise<Result<readonly string[], E2eCallError>> {
  await page.goto(new URL(path, page.url()).toString());
  const startedMs = Date.now();
  const reads: (readonly string[])[] = [];
  for (;;) {
    const folds = page.locator("[data-card-fold]");
    const foldsLeft = await folds.count();
    if (foldsLeft > 0) {
      await folds.first().click();
    }
    const keys = await page
      .locator("[data-card-key]")
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-card-key")));
    reads.push(keys.filter((key) => key !== null));
    const elapsedMs = Date.now() - startedMs;
    if (inventorySettled({ elapsedMs, foldsLeft, minimumMs: PAGE_MINIMUM_MS, reads })) {
      return ok(reads.at(-1)!);
    }
    if (elapsedMs > PAGE_CAP_MS) {
      return err(E2eCallErrors.controlMissing({ control: `${path}'s cards, which never held still` }));
    }
    await pause({ ms: READ_EVERY_MS });
  }
}

/**
 * Launch a test instance, read the Queue's and the Alignment page's cards, and close it.
 *
 * @param app the bundle
 * @param checkout the checkout whose console it reads
 * @param context the work context the console is read in, so the inventory is the context the calls are placed in
 * @param home the state home
 * @returns the inventory, or why it could not be read, the instance not proven closed, or the launch held on the owner's call
 */
export async function readCardInventory({
  app,
  checkout,
  context,
  home,
}: {
  app: string;
  checkout: string;
  context: E2eWorkContext | undefined;
  home: string;
}): Promise<Result<CardInventory, E2eCallError | OnCallHoldError>> {
  const scratch = mkdtempSync(join(tmpdir(), "sw-e2e-inventory-"));
  try {
    const spec = { app, checkout, context, home, menuBar: false, scratch, step: SILENT_STEP };
    const opened = await openCallSession({ spec });
    if (opened.isErr()) {
      return err(opened.error);
    }
    const session = opened.value;
    const read = await readPages({ session }).catch((cause: unknown) =>
      err(E2eCallErrors.controlMissing({ control: `the inventory (${String(cause)})` })),
    );
    const cleanup = await closeCallSession({ session });
    if (cleanup !== undefined) {
      return err(E2eCallErrors.cleanupFailed({ detail: cleanup }));
    }
    return read;
  } finally {
    rmSync(scratch, { force: true, recursive: true });
  }
}

/**
 * Both pages' keys, off the instance's console window.
 *
 * @param session the open instance
 * @returns the inventory, or why a page could not be read
 */
async function readPages({ session }: { session: CallSession }): Promise<Result<CardInventory, E2eCallError>> {
  const page = await waitForPage({ app: session.app, capMs: PAGE_CAP_MS, path: "/queue" });
  if (page === undefined) {
    return err(E2eCallErrors.controlMissing({ control: "the console window's Queue" }));
  }
  const [queuePath, alignmentPath] = INVENTORY_PAGES;
  const queue = await keysOn({ page, path: queuePath });
  if (queue.isErr()) {
    return err(queue.error);
  }
  const alignment = await keysOn({ page, path: alignmentPath });
  if (alignment.isErr()) {
    return err(alignment.error);
  }
  return ok(cardInventoryOf({ alignment: alignment.value, queue: queue.value }));
}
