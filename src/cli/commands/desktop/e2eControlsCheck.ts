/**
 * The voice step's controls check, against a real bundle: draw a fixture on the voice page, tap the report its preload
 * sends main, and hand both to `src/desktop/e2eControls.ts` to judge. `e2eDriver.ts` reaches it through
 * {@link openVoice}, which opens the voice window and its card the way the owner does first.
 */
import type { ElectronApplication, JSHandle, Page } from "playwright-core";

import {
  controlsVerdict,
  type E2eControlsBox,
  type E2eControlsProbes,
  type E2eControlsVerdict,
} from "../../../desktop/e2eControls.js";
import { type E2eStepBlock, E2eStepBlocks } from "../../../desktop/e2eErrors.js";
import { VOICE_MESSAGE, VOICE_ORB, VOICE_PATH } from "../../../desktop/e2ePlan.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { pageAt, pause, SETTLE_CAP_MS } from "./e2ePage.js";

/** How long the voice page has to report the clipping fixture, from drawing it. Its preload measures on the next frame. */
const CONTROLS_REPORT_CAP_MS = 5_000;

/** A controls report as the preload sends it to main. */
type Report = { boxes: E2eControlsBox[]; viewport: { width: number; height: number } };

/** The probed page's latest report since the fixture count, and how many it had sent by then. */
type Latest = { readonly sent: number; readonly value: Report };

/** One read of the voice page: the fixture's probes, whether a control is under the clipped one, and the viewport. */
type Seen = E2eControlsProbes & {
  readonly probeOnControl: boolean;
  readonly viewport: { readonly width: number; readonly height: number };
};

/** What a poll that held still found. */
type ControlsPoll = E2eControlsVerdict | { readonly kind: "probe-on-control" } | { readonly kind: "unreported" };

/**
 * The listener main's `ipcMain` runs for each controls report, and every report it kept with the page that sent it.
 * The listener takes its arguments as one list, in the order `ipcMain` passes them: the event, then what was sent.
 */
type Tap = {
  readonly listener: (...sent: [event: { sender: { id: number } }, value: Report]) => void;
  readonly reports: { sender: number; value: Report }[];
};

/**
 * Judge one poll. The page can change under a report (a fit turns the window from whole to its corner, a real control
 * moves), so a poll judges nothing when its two page reads differ, or when the page sent another report between the
 * report read and the read after it. One that held still answers with what is under the clipped probe, then with the
 * report when it was measured in the viewport the probes were read in.
 *
 * @param seen the page read before the two frames
 * @param again the page read after them and after the report
 * @param report the latest report read after the two frames, if the page has sent one
 * @param reportAgain the latest report read after `again`
 * @returns what the poll found, or `undefined` when the page moved between the reads
 */
export function judgePoll({
  seen,
  again,
  report,
  reportAgain,
}: {
  seen: Seen;
  again: Seen;
  report: Latest | undefined;
  reportAgain: Latest | undefined;
}): ControlsPoll | undefined {
  if (JSON.stringify(seen) !== JSON.stringify(again) || report?.sent !== reportAgain?.sent) {
    return undefined;
  }
  if (seen.probeOnControl) {
    return { kind: "probe-on-control" };
  }
  if (
    report !== undefined &&
    report.value.viewport.width === seen.viewport.width &&
    report.value.viewport.height === seen.viewport.height
  ) {
    return controlsVerdict({ boxes: report.value.boxes, probes: seen });
  }
  return { kind: "unreported" };
}

/**
 * The step's answer from the last poll, `unreported` when it moved.
 *
 * @param last what that poll found
 * @returns the block it names, or `undefined` when the fixture was clipped as drawn
 */
export function controlsBlock({ last }: { last: ControlsPoll }): E2eStepBlock | undefined {
  switch (last.kind) {
    case "probe-on-control":
      return E2eStepBlocks.controlsProbeOnControl();
    case "unreported":
      return E2eStepBlocks.controlsUnreported({ ms: CONTROLS_REPORT_CAP_MS });
    case "clipped":
      return undefined;
    case "unclipped":
      return E2eStepBlocks.controlsUnclipped(last.point);
    case "undrawn":
      return E2eStepBlocks.controlsUndrawn(last.point);
    default: {
      const unreachable: never = last;
      return unreachable;
    }
  }
}

/**
 * Draw the fixture, run in the page: a marked box holding a scroller of rows scrolled to its end, and a marked box
 * with a child drawn over its shoulder. Any fixture an earlier run left is removed first.
 *
 * @returns the fixture, as a handle, so cleanup removes this very node wherever it has been moved to
 */
function drawFixture(): HTMLDivElement {
  for (const stale of document.querySelectorAll("[data-e2e-controls]")) {
    stale.remove();
  }
  const fixture = document.createElement("div");
  fixture.dataset["e2eControls"] = "";
  const card = document.createElement("div");
  card.dataset["overlayInteractive"] = "";
  // A third of the window's height at most, so it sits well below the top whether the window is the whole display
  // (the messenger open) or its corner.
  const height = Math.min(240, Math.floor(window.innerHeight / 3));
  card.style.cssText = `position:fixed;left:8px;bottom:8px;width:120px;height:${String(height)}px;overflow:hidden`;
  const scroller = document.createElement("div");
  scroller.style.cssText = "height:100%;overflow-y:auto";
  for (let row = 0; row < 120; row += 1) {
    const line = document.createElement("p");
    line.style.cssText = "margin:0;height:40px";
    line.textContent = `row ${String(row)}`;
    scroller.append(line);
  }
  card.append(scroller);
  card.dataset["e2eCard"] = "";
  const control = document.createElement("div");
  control.dataset["overlayInteractive"] = "";
  control.style.cssText = "position:fixed;left:144px;bottom:8px;width:32px;height:32px";
  const shoulder = document.createElement("span");
  shoulder.dataset["e2eShoulder"] = "";
  shoulder.style.cssText = "position:absolute;top:-12px;right:-12px;width:16px;height:16px";
  control.append(shoulder);
  fixture.append(card, control);
  document.body.append(fixture);
  scroller.scrollTop = scroller.scrollHeight;
  return fixture;
}

/**
 * Read the fixture's probes, run in the page: the clipped one at the window's top, above the card, and one drawn in
 * each marked box.
 *
 * @returns the probes, whether a control is under the clipped one, and the viewport they were read in
 */
function readProbes(): Seen {
  const cardBox = document.querySelector("[data-e2e-card]")!.getBoundingClientRect();
  const shoulderBox = document.querySelector("[data-e2e-shoulder]")!.getBoundingClientRect();
  const clipped = { x: cardBox.left + cardBox.width / 2, y: 2 };
  const under = document.elementFromPoint(clipped.x, clipped.y);
  return {
    clipped,
    drawn: [
      { x: cardBox.left + cardBox.width / 2, y: cardBox.top + cardBox.height / 2 },
      { x: shoulderBox.left + shoulderBox.width / 2, y: shoulderBox.top + shoulderBox.height / 2 },
    ],
    probeOnControl: under !== null && under.closest("[data-overlay-interactive]") !== null,
    viewport: { height: window.innerHeight, width: window.innerWidth },
  };
}

/**
 * Let two frames pass, run in the page: the preload measures on the frame after any change, and sends only what
 * differs.
 *
 * @returns once the second frame has run
 */
async function twoFrames(): Promise<void> {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        resolve();
      });
    });
  });
}

/**
 * Poll until a poll that held still finds the fixture clipped or not, or the cap runs out. Each poll reads the probes,
 * lets two frames pass, takes the latest report, reads the probes again, then the latest report again (`judgePoll`).
 * A poll that moved settles nothing, so it clears an older verdict rather than letting one main's later reports have
 * overtaken stand.
 *
 * @param page the voice page
 * @param readLatest the probed page's latest report main has received since the fixture count
 * @returns what the last poll found
 */
async function pollControls({
  page,
  readLatest,
}: {
  page: Page;
  readLatest: () => Promise<Latest | undefined>;
}): Promise<ControlsPoll> {
  let last: ControlsPoll = { kind: "unreported" };
  const deadline = Date.now() + CONTROLS_REPORT_CAP_MS;
  while (last.kind !== "clipped" && last.kind !== "unclipped" && Date.now() < deadline) {
    await pause({ ms: 100 });
    const seen = await page.evaluate(readProbes);
    await page.evaluate(twoFrames);
    const report = await readLatest();
    const again = await page.evaluate(readProbes);
    const judged = judgePoll({ again, report, reportAgain: await readLatest(), seen });
    if (judged === undefined) {
      last = { kind: "unreported" };
    } else {
      last = judged;
    }
  }
  return last;
}

/**
 * Remove the fixture and the listener this check made, each tried whatever happened to the other.
 *
 * @param app the instance
 * @param page the voice page
 * @param tap the listener's handle, once it was held
 * @param fixtureNode the fixture's handle, once it was drawn
 */
async function clearControlsCheck({
  app,
  page,
  tap,
  fixtureNode,
}: {
  app: ElectronApplication;
  page: Page;
  tap: JSHandle<Tap> | undefined;
  fixtureNode: JSHandle<HTMLDivElement> | undefined;
}): Promise<void> {
  await page
    .evaluate((made) => {
      for (const fixture of document.querySelectorAll("[data-e2e-controls]")) {
        fixture.remove();
      }
      made?.remove();
    }, fixtureNode)
    .catch(() => undefined);
  await fixtureNode?.dispose().catch(() => undefined);
  if (tap !== undefined) {
    await app
      .evaluate(({ ipcMain }, listening) => {
        ipcMain.removeListener("slopweaver:overlay-controls", listening.listener);
      }, tap)
      .catch(() => undefined);
    await tap.dispose().catch(() => undefined);
  }
}

/**
 * Check that the controls the voice page tells main about are clipped as drawn (`src/desktop/e2eControls.ts`). It draws
 * a fixture on the left of the voice page, clear of the widget: a marked box holding a scroller of rows scrolled to its
 * end, so all but the last few sit above it in layout, reaching the top of the window — more than the preload's
 * 32-box cap — and a second marked box with a child drawn over its shoulder. It then reads the report the built preload
 * sent main (`slopweaver:overlay-controls`) until the fixture is in it. Nothing is pressed or sent; the fixture and the
 * listener go before the step is photographed.
 *
 * @param app the instance
 * @param page the voice page
 * @returns the same page, or the point the report got wrong
 */
async function checkControlsClipped({
  app,
  page,
}: {
  app: ElectronApplication;
  page: Page;
}): Promise<Result<Page, E2eStepBlock>> {
  // Handles into main and the page, so cleanup reaches the very listener and node this check made.
  let tap: JSHandle<Tap> | undefined;
  let fixtureNode: JSHandle<HTMLDivElement> | undefined;
  try {
    // Held before it listens, so a hold that fails leaves no listener, and one that listens is always found to remove.
    // The listener is taken out of an array rather than bound to a name or a property: run from source, tsx's
    // keepNames wraps a named function in a `__name` helper that exists only in this process, and Electron's main
    // threw `__name is not defined` on it. Repro, none inside this callback:
    // `node_modules/.bin/esbuild src/cli/commands/desktop/e2eControlsCheck.ts --keep-names | grep -n __name`
    const held = await app.evaluateHandle((): Tap => {
      const reports: Tap["reports"] = [];
      // Each report keeps the page that sent it, so only the probed page's own is ever judged.
      const [listener]: Tap["listener"][] = [
        (event, value) => {
          reports.push({ sender: event.sender.id, value });
        },
      ];
      return { listener: listener!, reports };
    });
    tap = held;
    await app.evaluate(({ ipcMain }, listening) => {
      ipcMain.on("slopweaver:overlay-controls", listening.listener);
    }, held);
    const pageWindow = await app.browserWindow(page);
    const pageSender = await pageWindow.evaluate((window) => window.webContents.id);
    // Counted before the fixture goes in: the preload measures it within a frame, so a count taken after can already
    // include its report, and a settled page sends nothing more.
    const before = await app.evaluate((_modules, listening) => listening.reports.length, held);
    fixtureNode = await page.evaluateHandle(drawFixture);
    const readLatest = async (): Promise<Latest | undefined> =>
      app.evaluate(
        (_modules, { after, listening, sender }): Latest | undefined => {
          const mine = listening.reports.slice(after).filter((sent) => sent.sender === sender);
          const newest = mine.at(-1);
          return newest === undefined ? undefined : { sent: mine.length, value: newest.value };
        },
        { after: before, listening: held, sender: pageSender },
      );
    const block = controlsBlock({ last: await pollControls({ page, readLatest }) });
    if (block !== undefined) {
      return err(block);
    }
    return ok(page);
  } finally {
    await clearControlsCheck({ app, fixtureNode, page, tap });
  }
}

/**
 * Open the voice's card the way the owner does, by pressing the orb, when it shows the orb alone: a click into another app
 * folds it there, so a walk on a machine in use can land on the fold.
 *
 * @param page the voice window
 * @returns the same page, its card asked open
 */
export async function openVoiceCard({ page }: { page: Page }): Promise<Page> {
  await page
    .locator(`${VOICE_MESSAGE}, ${VOICE_ORB}`)
    .first()
    .waitFor({ timeout: SETTLE_CAP_MS })
    .catch(() => undefined);
  const orb = page.locator(VOICE_ORB).first();
  if ((await page.locator(VOICE_MESSAGE).count()) === 0 && (await orb.count()) > 0) {
    await orb.click();
  }
  return page;
}

/**
 * Reach the voice window, open its card, and check what it reports to main.
 *
 * @param app the instance
 * @returns the voice page, or why it never showed or reported wrong
 */
export async function openVoice({ app }: { app: ElectronApplication }): Promise<Result<Page, E2eStepBlock>> {
  const voice = await pageAt({ after: "the app opened its voice window", app, path: VOICE_PATH });
  if (voice.isErr()) {
    return voice;
  }
  return checkControlsClipped({ app, page: await openVoiceCard({ page: voice.value }) });
}
