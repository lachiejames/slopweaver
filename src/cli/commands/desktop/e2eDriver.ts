/**
 * The effectful half of `slopweaver desktop e2e`: launch a real bundle as a TEST INSTANCE beside the owner's app, walk it the
 * way the owner does, and photograph every step. With `e2ePage.ts`, which looks at what this module's acts left on screen,
 * `e2eControlsCheck.ts`, the voice step's controls check, `e2eQueueCard.ts`, the card step that an empty Queue makes
 * not applicable, and `e2eSettings.ts`, the Settings step's presses, the only modules the verb has that import
 * `playwright-core`.
 *
 * **A test instance, never the owner's app.** The bundle is launched by `./e2eApp.ts` with `--slopweaver-desktop-e2e=<dir>`
 * (`desktop/src/e2eMode.ts`): its saved state and its single-instance lock live in a throwaway folder, and it does
 * none of the shell's automatic acts — no fleet launch into cmux, no update, no console started, and no menu bar icon
 * unless `--menu-bar` asks for its own, named Slopweaver Test. It
 * READS the console the owner's app reads, so a walk is the console the owner is running, inside the shell under test. The call leg
 * (`./e2eCallDriver.ts`) uses the same launcher, with a fake microphone.
 */
import { join } from "node:path";

import type { ElectronApplication, Page } from "playwright-core";

import { type DesktopE2eError, type E2eStepBlock, E2eStepBlocks } from "../../../desktop/e2eErrors.js";
import type { E2ePageFixture } from "../../../desktop/e2eFixture.js";
import { type E2eObserved, judgeStep } from "../../../desktop/e2eOutcome.js";
import { DOCS_PATH, type E2eStep, landmarkOf, sidebarLink, VIEWER_PATH } from "../../../desktop/e2ePlan.js";
import type { E2eStepResult } from "../../../desktop/e2eReport.js";
import type { E2eWorkContext } from "../../../desktop/e2eWorkContext.js";
import type { OnCallHoldError } from "../../../desktop/onCallHold.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { closeE2eApp, launchE2eApp } from "./e2eApp.js";
import { consoleInE2eContext } from "./e2eContext.js";
import { openVoice } from "./e2eControlsCheck.js";
import { proveNewTab } from "./e2eNewTab.js";
import { proveOrbDrag } from "./e2eOrbDrag.js";
import { freshLedger, pageAt, pause, photograph, type StepLedger, watch } from "./e2ePage.js";
import { proveQueuePinned } from "./e2ePinnedQueue.js";
import { acted, type E2eActed, openQueueCard, settledOf, stillNotApplicable } from "./e2eQueueCard.js";
import { proveQueueScreen } from "./e2eQueueScreen.js";
import { openSettingsAt } from "./e2eSettings.js";
import { recordStaleMarks } from "./e2eStaleMarks.js";

/** What the driver needs from the verb. */
export interface E2eDriveOptions {
  /** The bundle, `…/Slopweaver.app`. */
  readonly app: string;
  /** The checkout whose console the instance reads. */
  readonly checkout: string;
  /** The test instance's own saved state and lock. */
  readonly userData: string;
  /** Whether the instance draws its own Slopweaver Test menu bar icon (`--menu-bar`). */
  readonly menuBar: boolean;
  /** The work context the console is put in before the first step (`--context`); `undefined` leaves it as it opened. */
  readonly context: E2eWorkContext | undefined;
  /** How long each step waits to settle before it is photographed (`--settle-cap`). */
  readonly settleCapMs: number;
  /** Where the photographs go. */
  readonly out: string;
  /** The steps to take, in order. */
  readonly steps: readonly E2eStep[];
  /** The fixture page the published-page step opens, written before the walk; `undefined` when that step is not taken. */
  readonly publishedPage: E2ePageFixture | undefined;
  /** Each step's line as it finishes, so a long walk is never silent. */
  readonly progress: (options: { readonly result: E2eStepResult }) => void;
  /**
   * Whether the owner is on a call now, read just before the launch and before every step, so a call the owner picks up mid-walk
   * stops it (`../../../desktop/onCallHold.ts`). Injected so this module reads no microphone itself.
   */
  readonly onCall: () => OnCallHoldError | undefined;
}

/**
 * Where one step's photograph goes: numbered from one in walk order, so the folder lists in the order it was taken.
 *
 * @param out the run's folder
 * @param index the step's place in this run, from zero
 * @param id the step's id
 * @returns the file's path
 */
export function shotPathOf({ out, index, id }: { out: string; index: number; id: string }): string {
  return join(out, `${String(index + 1).padStart(2, "0")}-${id}.png`);
}

/**
 * Click the sidebar's link to a path, the way the owner moves between pages, and wait for the page it opens.
 *
 * @param app the instance
 * @param current the console page the walk is on
 * @param link the sidebar link's path
 * @param opens the path of the page the click should show, which for the docs link is the viewer
 * @param after the move, as a failure names it
 * @returns the page it opened, or that the sidebar has no such link or nothing showed
 */
async function followSidebar({
  app,
  current,
  link,
  opens,
  after,
}: {
  app: ElectronApplication;
  current: Page;
  link: string;
  opens: string;
  after: string;
}): Promise<Result<Page, E2eStepBlock>> {
  const anchor = current.locator(sidebarLink({ path: link })).first();
  if ((await anchor.count()) === 0) {
    return err(E2eStepBlocks.noSidebarLink({ path: link }));
  }
  await anchor.click();
  return pageAt({ after, app, path: opens });
}

/**
 * Take a step's action and say which page it left standing, or why it could not.
 *
 * @param app the instance
 * @param current the console page the walk is on
 * @param step the step
 * @param publishedPage the fixture page the published-page step opens
 * @param shot where the step's photograph goes, beside which the pinned-tab step puts its tab strip's
 * @returns the page to judge and photograph and why it did not act when it had nothing to, or what blocked the step
 */
async function act({
  app,
  current,
  step,
  publishedPage,
  shot,
}: {
  app: ElectronApplication;
  current: Page;
  step: E2eStep;
  publishedPage: E2ePageFixture | undefined;
  shot: string;
}): Promise<Result<E2eActed, E2eStepBlock>> {
  if (step.kind === "queue-card") {
    return openQueueCard({ current });
  }
  if (step.kind === "queue-pinned") {
    return proveQueuePinned({ app, pinned: current, stripShot: shot.replace(/\.png$/u, "-strip.png") });
  }
  if (step.kind === "queue-screen") {
    return proveQueueScreen({ app, pinned: current });
  }
  if (step.kind === "new-tab") {
    return proveNewTab({ app, pinned: current, stripShot: shot.replace(/\.png$/u, "-strip.png") });
  }
  if (step.kind === "orb-drag") {
    return proveOrbDrag({ app, shot });
  }
  const moved = await moveTo({ app, current, publishedPage, step });
  return moved.map((page) => acted({ page }));
}

/**
 * Take every action that always acts, and say which page it left standing.
 *
 * @param app the instance
 * @param current the console page the walk is on
 * @param step the step, never the card step nor the pinned-tab one
 * @param publishedPage the fixture page the published-page step opens
 * @returns the page to judge and photograph, or what blocked the step
 */
async function moveTo({
  app,
  current,
  step,
  publishedPage,
}: {
  app: ElectronApplication;
  current: Page;
  step: Exclude<E2eStep, { readonly kind: "queue-card" | "queue-pinned" | "queue-screen" | "new-tab" | "orb-drag" }>;
  publishedPage: E2ePageFixture | undefined;
}): Promise<Result<Page, E2eStepBlock>> {
  switch (step.kind) {
    case "page": {
      if (step.reach === "address") {
        await current.goto(new URL(step.path, current.url()).toString());
        return pageAt({ after: "the address move", app, path: step.path });
      }
      return followSidebar({ after: "the sidebar move", app, current, link: step.path, opens: step.path });
    }
    case "settings": {
      await openSettingsAt({ page: current, step });
      return ok(current);
    }
    case "voice":
      return openVoice({ app });
    case "docs":
      return followSidebar({ after: "the docs link", app, current, link: DOCS_PATH, opens: VIEWER_PATH });
    case "published-page": {
      // By address, the way a card's page link reaches the viewer; the step after the docs already stands on `/view`,
      // so the settle waits on the fixture's own frame and marker rather than on the viewer's address.
      if (publishedPage === undefined) {
        return err(E2eStepBlocks.pageFixtureMissing());
      }
      await current.goto(new URL(publishedPage.viewerPath, current.url()).toString());
      return pageAt({ after: "the address move to the published page", app, path: VIEWER_PATH });
    }
    default: {
      const unreachable: never = step;
      return unreachable;
    }
  }
}

/**
 * Leave a step the way the owner would: a dialog it opened is closed, so the next step starts on the page. A step that was
 * not applicable opened nothing, so nothing is pressed.
 *
 * @param page the page the step stood on
 * @param result the step as it ran
 * @param step the step
 */
async function leave({ page, result, step }: { page: Page; result: E2eStepResult; step: E2eStep }): Promise<void> {
  if (!result.verdict.passed && result.verdict.kind === "not-applicable") {
    return;
  }
  const opened = step.kind === "queue-card" || step.kind === "queue-pinned" || step.kind === "new-tab";
  if (opened || step.kind === "settings") {
    await page.keyboard.press("Escape").catch(() => undefined);
    await pause({ ms: 500 });
  }
}

/** A walk that ran: every step it took, and the hold that stopped it part way when the owner picked up a call. */
export interface E2eWalk {
  readonly results: readonly E2eStepResult[];
  /** Kept beside the results, never instead of them, so a step that failed before the call still fails the run. */
  readonly held: OnCallHoldError | undefined;
}

/**
 * Launch the bundle as a test instance, take every step, and end the instance.
 *
 * @param options the bundle, the checkout, the folders and the steps
 * @returns each step's result in order and any mid-walk hold, or why the walk could not start — the owner is on a call,
 *   among others
 */
export async function driveE2e(options: E2eDriveOptions): Promise<Result<E2eWalk, DesktopE2eError | OnCallHoldError>> {
  const held = options.onCall();
  if (held !== undefined) {
    return err(held);
  }
  const launched = await launchE2eApp({
    app: options.app,
    checkout: options.checkout,
    fakeAudioPath: undefined,
    menuBar: options.menuBar,
    userData: options.userData,
  });
  if (launched.isErr()) {
    return err(launched.error);
  }
  const app = launched.value;
  try {
    return await walk({ app, options });
  } finally {
    await closeE2eApp({ app });
  }
}

/**
 * The walk itself, over a launched instance.
 *
 * @param app the instance
 * @param options the steps and folders
 * @returns each step's result and the hold when the owner picked up a call mid-walk, or that the console never showed
 */
async function walk({
  app,
  options,
}: {
  app: ElectronApplication;
  options: E2eDriveOptions;
}): Promise<Result<E2eWalk, DesktopE2eError>> {
  let ledger = freshLedger();
  const watched = new WeakSet<Page>();
  const watchAll = (): void => {
    for (const page of app.context().pages()) {
      if (!watched.has(page)) {
        watched.add(page);
        watch({ ledger: () => ledger, page });
      }
    }
  };
  app.context().on("page", watchAll);
  watchAll();
  const queue = await consoleInE2eContext({ app, context: options.context, out: options.out });
  if (queue.isErr()) {
    return err(queue.error);
  }
  let current = queue.value;
  const results: E2eStepResult[] = [];
  for (const [index, step] of options.steps.entries()) {
    const held = options.onCall();
    if (held !== undefined) {
      // The steps already taken are photographed and kept; the walk stops here and the instance closes (Codex oncall-r8).
      return ok({ held, results });
    }
    ledger = freshLedger();
    const shot = shotPathOf({ id: step.id, index, out: options.out });
    const { page, result } = await takeStep({
      app,
      current,
      ledger,
      publishedPage: options.publishedPage,
      settleCapMs: options.settleCapMs,
      shot,
      step,
      watchAll,
    });
    results.push(result);
    options.progress({ result });
    await leave({ page, result, step });
    // The voice window is never where the next step starts: the walk goes back to the console page it was on.
    if (step.kind !== "voice" && step.kind !== "orb-drag" && !page.isClosed()) {
      current = page;
    }
  }
  return ok({ held: undefined, results });
}

/**
 * One step: act, settle, photograph, judge.
 *
 * @param app the instance
 * @param current the console page the walk is on
 * @param ledger the errors the watchers write against this step
 * @param publishedPage the fixture page the published-page step opens
 * @param settleCapMs how long the step waits to settle before it is photographed (`--settle-cap`)
 * @param shot where its photograph goes
 * @param step the step
 * @param watchAll start watching any page the action opened
 * @returns the page it left standing, and its result
 */
async function takeStep({
  app,
  current,
  ledger,
  publishedPage,
  settleCapMs,
  shot,
  step,
  watchAll,
}: {
  app: ElectronApplication;
  current: Page;
  ledger: StepLedger;
  publishedPage: E2ePageFixture | undefined;
  settleCapMs: number;
  shot: string;
  step: E2eStep;
  watchAll: () => void;
}): Promise<{ readonly page: Page; readonly result: E2eStepResult }> {
  const started = Date.now();
  const outcome = await act({ app, current, publishedPage, shot, step }).catch((cause: unknown) =>
    err(E2eStepBlocks.actionThrew({ cause })),
  );
  watchAll();
  const page = outcome.isOk() ? outcome.value.page : current;
  const sampled = outcome.isOk() ? outcome.value.notApplicable : undefined;
  const settled = await settledOf({
    didAct: outcome.isOk(),
    framePath: publishedPage?.framePath,
    notApplicable: sampled,
    page,
    settleCapMs,
    step,
  });
  const screenshot = await photograph({ page, path: shot });
  await recordStaleMarks({ page, shot });
  // A not-applicable verdict stands on its photograph: the line proving the Queue empty must still be drawn after it.
  const { blocked, notApplicable } = await stillNotApplicable({
    blocked: outcome.isErr() ? outcome.error.message : undefined,
    notApplicable: sampled,
    page,
    screenshot,
  });
  const observed: E2eObserved = {
    blocked,
    consoleErrors: ledger.consoleErrors,
    notApplicable,
    pageErrors: ledger.pageErrors,
    serverErrors: ledger.serverErrors,
    ...settled,
  };
  const result: E2eStepResult = {
    elapsedMs: Date.now() - started,
    screenshot,
    step,
    url: page.isClosed() ? undefined : page.url(),
    verdict: judgeStep({ landmark: landmarkOf({ step }).words, observed }),
  };
  return { page, result };
}
