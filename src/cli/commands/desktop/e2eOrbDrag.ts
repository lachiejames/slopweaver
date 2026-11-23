/**
 * The `orb-drag` step of `slopweaver desktop e2e`, its effectful half: on the real test instance, open the voice's card,
 * drag its orb to the top left of the work area, hold it there,
 * let go, then drag it back past the bottom-right corner and let go again. Every move is dispatched into the page, so
 * the owner's own cursor never moves; the pointer is aimed in SCREEN points and turned into the window's client pixels
 * at each move, because the shell grows the window under the drag exactly as it would under the owner's hand. What must
 * hold is the pure half's (`../../../desktop/e2eOrbDrag.ts`). Its photographs sit beside the step's: held in the top
 * left, and let go there.
 */
import type { ElectronApplication, Page } from "playwright-core";

import { type E2eStepBlock, E2eStepBlocks } from "../../../desktop/e2eErrors.js";
import { type E2eScreenPoint, orbDragBreaks } from "../../../desktop/e2eOrbDrag.js";
import { VOICE_MESSAGE, VOICE_ORB_BUTTON, VOICE_PATH } from "../../../desktop/e2ePlan.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { writeFileAtomicBytes } from "../../../lib/writeAtomic.js";
import { captureVoiceContents } from "./e2eCallView.js";
import { openVoiceCard } from "./e2eControlsCheck.js";
import { pause, photograph, SETTLE_CAP_MS, waitForPage } from "./e2ePage.js";
import { acted, type E2eActed } from "./e2eQueueCard.js";

/** How many moves one leg of the drag takes, and how long the walk leaves between them: about a 60Hz mouse. */
const MOVES_PER_LEG = 45;
const MOVE_GAP_MS = 16;

/** How long a held or let-go orb is left before it is read, so the shell's re-fit and its origin word have landed. */
const SETTLE_MS = 900;

/** How far in from the work area's top-left corner the drag holds the orb, screen points. */
const TOP_LEFT_INSET = 110;

/** How far past the work area's bottom-right corner the drag back aims, screen points: the orb stops at its rest. */
const PAST_CORNER = 400;

/** The page's key for the orb's kept place (`site/lib/messengerPlace.ts` `MESSENGER_PLACE_KEY`). */
const PLACE_KEY = "slopweaver.messenger-place";

/** The voice window's place on the screen, and the work area it sits over. */
export interface WindowGeometry {
  readonly bounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly zoom: number;
  readonly workArea: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
}

/**
 * Where the voice window is now, its zoom, and the work area of the display it is on.
 *
 * @param app the instance
 * @param voice the voice window's page
 * @returns the geometry
 */
async function geometryOf({ app, voice }: { app: ElectronApplication; voice: Page }): Promise<WindowGeometry> {
  const window = await app.browserWindow(voice);
  const { bounds, zoom } = await window.evaluate((shown) => ({
    bounds: shown.getBounds(),
    zoom: shown.webContents.getZoomFactor(),
  }));
  const workArea = await app.evaluate(({ screen }, on) => screen.getDisplayMatching(on).workArea, bounds);
  return { bounds, workArea, zoom };
}

/**
 * The orb's centre in the window's client pixels.
 *
 * @param voice the voice window's page
 * @returns the centre, or `undefined` when no orb is drawn
 */
async function orbClientCentre({ voice }: { voice: Page }): Promise<E2eScreenPoint | undefined> {
  return voice.evaluate((selector) => {
    const orb = document.querySelector(selector);
    if (orb === null) {
      return undefined;
    }
    const box = orb.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  }, VOICE_ORB_BUTTON);
}

/**
 * A client point as a screen point, through the window's place and zoom.
 *
 * @param point the client point
 * @param geometry the window
 * @returns the screen point
 */
export function toScreen({ point, geometry }: { point: E2eScreenPoint; geometry: WindowGeometry }): E2eScreenPoint {
  return { x: geometry.bounds.x + point.x * geometry.zoom, y: geometry.bounds.y + point.y * geometry.zoom };
}

/**
 * A screen point as a client point of the window as it is now.
 *
 * @param point the screen point
 * @param geometry the window
 * @returns the client point
 */
export function toClient({ point, geometry }: { point: E2eScreenPoint; geometry: WindowGeometry }): E2eScreenPoint {
  return { x: (point.x - geometry.bounds.x) / geometry.zoom, y: (point.y - geometry.bounds.y) / geometry.zoom };
}

/**
 * The orb's centre on the screen.
 *
 * @param app the instance
 * @param voice the voice window's page
 * @returns the centre, or `undefined` when no orb is drawn
 */
async function orbScreenCentre({
  app,
  voice,
}: {
  app: ElectronApplication;
  voice: Page;
}): Promise<E2eScreenPoint | undefined> {
  const geometry = await geometryOf({ app, voice });
  const client = await orbClientCentre({ voice });
  if (client === undefined) {
    return undefined;
  }
  return toScreen({ geometry, point: client });
}

/**
 * Drag the pointer from one screen point to another in even moves, each re-aimed through the window as it is then.
 *
 * @param app the instance
 * @param voice the voice window's page
 * @param from where the press is
 * @param to where the drag ends
 * @returns the window's bounds read at every move, as `<x>,<y>,<width>,<height>`
 */
async function dragAlong({
  app,
  voice,
  from,
  to,
}: {
  app: ElectronApplication;
  voice: Page;
  from: E2eScreenPoint;
  to: E2eScreenPoint;
}): Promise<readonly string[]> {
  const bounds: string[] = [];
  for (let step = 1; step <= MOVES_PER_LEG; step += 1) {
    const geometry = await geometryOf({ app, voice });
    const { x, y, width, height } = geometry.bounds;
    bounds.push(`${String(x)},${String(y)},${String(width)},${String(height)}`);
    const along = step / MOVES_PER_LEG;
    const aim = { x: from.x + (to.x - from.x) * along, y: from.y + (to.y - from.y) * along };
    const client = toClient({ geometry, point: aim });
    await voice.mouse.move(client.x, client.y);
    await pause({ ms: MOVE_GAP_MS });
  }
  return bounds;
}

/**
 * Press the pointer at a screen point on the voice window.
 *
 * @param app the instance
 * @param voice the voice window's page
 * @param at the screen point
 */
async function pressAt({
  app,
  voice,
  at,
}: {
  app: ElectronApplication;
  voice: Page;
  at: E2eScreenPoint;
}): Promise<void> {
  const client = toClient({ geometry: await geometryOf({ app, voice }), point: at });
  await voice.mouse.move(client.x, client.y);
  await voice.mouse.down();
}

/**
 * Start recording every animation frame's start and the widget's drawn size at it.
 *
 * @param voice the voice window's page
 */
async function startFrameRecord({ voice }: { voice: Page }): Promise<void> {
  await voice.evaluate(() => {
    const widget = document.querySelector('aside[aria-label="voice"]');
    const record = { frames: [] as number[], on: true, sizes: [] as string[] };
    const tick = (time: number): void => {
      if (!record.on) {
        return;
      }
      record.frames.push(time);
      const box = widget?.getBoundingClientRect();
      record.sizes.push(
        box === undefined ? "none" : `${String(Math.round(box.width))}x${String(Math.round(box.height))}`,
      );
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    Object.assign(globalThis, { slopweaverOrbDragRecord: record });
  });
}

/**
 * Stop the frame record and read it back.
 *
 * @param voice the voice window's page
 * @returns every frame's start and the widget's size at each
 */
async function stopFrameRecord({
  voice,
}: {
  voice: Page;
}): Promise<{ readonly frames: readonly number[]; readonly sizes: readonly string[] }> {
  return voice.evaluate(() => {
    const record: unknown = Reflect.get(globalThis, "slopweaverOrbDragRecord");
    if (typeof record !== "object" || record === null) {
      throw new Error("the drag's frame record was never started on the voice page");
    }
    Reflect.set(record, "on", false);
    const frames: unknown = Reflect.get(record, "frames");
    const sizes: unknown = Reflect.get(record, "sizes");
    if (!Array.isArray(frames) || !Array.isArray(sizes)) {
      throw new Error("the drag's frame record on the voice page carries no frames or sizes");
    }
    return {
      frames: frames.filter((time): time is number => typeof time === "number"),
      sizes: sizes.filter((size): size is string => typeof size === "string"),
    };
  });
}

/**
 * How many of the widget's parts besides the orb's wrapper are drawn, visible, with a box of their own.
 *
 * @param voice the voice window's page
 * @returns the count
 */
async function visibleBesideOrb({ voice }: { voice: Page }): Promise<number> {
  return voice.evaluate(() => {
    const widget = document.querySelector('aside[aria-label="voice"]');
    if (widget === null) {
      return 0;
    }
    const parts = [...widget.children].slice(0, -1);
    return parts.filter((part) => {
      const box = part.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && getComputedStyle(part).visibility === "visible";
    }).length;
  });
}

/**
 * Run one press-and-drag with the pointer let go however it ends, so a throw mid-hold (a photograph that cannot be
 * written, a page gone) never leaves the instance's pointer held down.
 *
 * @param hold presses the orb and drags it; whatever it answers is answered once the pointer is up
 * @param voice the voice page whose pointer is let go
 * @returns what `hold` answered
 */
async function whileHeld<T>({ hold, voice }: { hold: () => Promise<T>; voice: Page }): Promise<T> {
  try {
    return await hold();
  } finally {
    await voice.mouse.up();
  }
}

/**
 * Photograph the voice window as the shell draws it. A page screenshot taken while the pointer is held came out blank
 * white on the installed app, so the main process captures the contents instead, as the call leg does;
 * only when that capture finds no one voice contents does the page photograph itself.
 *
 * @param app the instance
 * @param path where the PNG goes
 * @param voice the voice page, photographed directly only when the shell's capture found nothing
 */
async function photographFromShell({
  app,
  path,
  voice,
}: {
  app: ElectronApplication;
  path: string;
  voice: Page;
}): Promise<void> {
  const png = await captureVoiceContents({ app });
  if (png === undefined) {
    await photograph({ page: voice, path });
    return;
  }
  writeFileAtomicBytes({ bytes: Buffer.from(png, "base64"), path });
}

/**
 * The drag's first leg: record every frame, press the orb where it rests, drag it up to the top left and hold it
 * there, and read what the hold shows before the pointer is let go.
 *
 * @param app the instance
 * @param voice the voice window's page
 * @param from where the orb rests, screen points
 * @param to where the drag holds it
 * @param shot the step's photograph, beside which the held photograph goes
 * @returns where the orb was held, the frames recorded on the way, the parts drawn beside it and the window's bounds
 */
async function dragUpAndHold({
  app,
  voice,
  from,
  to,
  shot,
}: {
  app: ElectronApplication;
  voice: Page;
  from: E2eScreenPoint;
  to: E2eScreenPoint;
  shot: string;
}): Promise<{
  readonly heldAt: E2eScreenPoint | undefined;
  readonly recorded: { readonly frames: readonly number[]; readonly sizes: readonly string[] };
  readonly visibleWhileHeld: number;
  readonly windowBounds: readonly string[];
}> {
  await startFrameRecord({ voice });
  return whileHeld({
    hold: async () => {
      await pressAt({ app, at: from, voice });
      const bounds = await dragAlong({ app, from, to, voice });
      const frames = await stopFrameRecord({ voice });
      await pause({ ms: SETTLE_MS });
      const visible = await visibleBesideOrb({ voice });
      await photographFromShell({ app, path: shot.replace(/\.png$/u, "-held-top-left.png"), voice });
      const at = await orbScreenCentre({ app, voice });
      return { heldAt: at, recorded: frames, visibleWhileHeld: visible, windowBounds: bounds };
    },
    voice,
  });
}

/**
 * The drag's second leg: press the orb where it was let go, drag it past the bottom-right corner, let go, and read
 * where it came to rest.
 *
 * @param app the instance
 * @param voice the voice window's page
 * @param from where the orb was let go, screen points
 * @param to the point past the corner the drag aims at
 * @returns where the orb rests once the release settled, or `undefined` when no orb is drawn
 */
async function dragBack({
  app,
  voice,
  from,
  to,
}: {
  app: ElectronApplication;
  voice: Page;
  from: E2eScreenPoint;
  to: E2eScreenPoint;
}): Promise<E2eScreenPoint | undefined> {
  await whileHeld({
    hold: async () => {
      await pressAt({ app, at: from, voice });
      await dragAlong({ app, from, to, voice });
    },
    voice,
  });
  await pause({ ms: SETTLE_MS });
  return orbScreenCentre({ app, voice });
}

/**
 * Take the step: open the card, drag the orb up to the top left and hold it, let go, drag it back into the corner, and
 * judge all of it.
 *
 * @param app the instance
 * @param shot the step's photograph, beside which the held and let-go photographs go
 * @returns the voice page to photograph, or every way the drag broke
 */
export async function proveOrbDrag({
  app,
  shot,
}: {
  app: ElectronApplication;
  shot: string;
}): Promise<Result<E2eActed, E2eStepBlock>> {
  const shown = await waitForPage({ app, capMs: SETTLE_CAP_MS, path: VOICE_PATH });
  if (shown === undefined) {
    return err(E2eStepBlocks.pageNeverShown({ after: "the app opened its voice window", path: VOICE_PATH }));
  }
  const voice = await openVoiceCard({ page: shown });
  await voice.locator(VOICE_MESSAGE).first().waitFor({ timeout: SETTLE_CAP_MS });
  await pause({ ms: SETTLE_MS });
  const restAt = await orbScreenCentre({ app, voice });
  if (restAt === undefined) {
    return err(E2eStepBlocks.noOrb());
  }
  const { workArea } = await geometryOf({ app, voice });
  const topLeft = { x: workArea.x + TOP_LEFT_INSET, y: workArea.y + TOP_LEFT_INSET };
  const { heldAt, recorded, visibleWhileHeld, windowBounds } = await dragUpAndHold({
    app,
    from: restAt,
    shot,
    to: topLeft,
    voice,
  });
  await pause({ ms: SETTLE_MS });
  const releasedAt = await orbScreenCentre({ app, voice });
  await photographFromShell({ app, path: shot.replace(/\.png$/u, "-let-go-top-left.png"), voice });
  if (heldAt === undefined || releasedAt === undefined) {
    return err(E2eStepBlocks.noOrb());
  }
  const corner = { x: workArea.x + workArea.width + PAST_CORNER, y: workArea.y + workArea.height + PAST_CORNER };
  const backAt = await dragBack({ app, from: releasedAt, to: corner, voice });
  if (backAt === undefined) {
    return err(E2eStepBlocks.noOrb());
  }
  const keptBack = await voice.evaluate((key) => window.localStorage.getItem(key), PLACE_KEY);
  const breaks = orbDragBreaks({
    seen: {
      backAt,
      frameTimes: recorded.frames,
      heldAt,
      keptBack,
      releasedAt,
      restAt,
      visibleWhileHeld,
      widgetSizes: recorded.sizes,
      windowBounds,
    },
  });
  if (breaks.length > 0) {
    return err(E2eStepBlocks.orbDragBroken({ breaks }));
  }
  return ok(acted({ page: voice }));
}
