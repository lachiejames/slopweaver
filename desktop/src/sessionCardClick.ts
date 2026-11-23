/**
 * One synthetic left click on a session card's Stop, through the card page's own DevTools input domain, sent only once
 * the element under the point is that card's Stop link, and answered once the card's own handler saw it.
 * `sessionWindow.ts`'s `pressSessionStop` is its one caller.
 */
import type { BrowserWindow } from "electron";
import { err, ok, type Result } from "neverthrow";

import type { CardPress, PressSeen } from "./cardStop";
import { stopControlPoint, stopLink } from "./sessionCard";

/**
 * The element the page draws at a point, named for a press that went astray (`A.stop`, say, or why it is unknown),
 * and whether it is this card's own Stop link: an anchor whose href is exactly {@link stopLink}.
 */
async function nodeUnder({
  devtools,
  point,
  sessionId,
}: {
  devtools: Electron.Debugger;
  point: { x: number; y: number };
  sessionId: string;
}): Promise<{ described: string; isStop: boolean }> {
  try {
    await devtools.sendCommand("DOM.getDocument", { depth: 0 });
    const located: unknown = await devtools.sendCommand("DOM.getNodeForLocation", point);
    const backendNodeId =
      typeof located === "object" && located !== null && "backendNodeId" in located ? located.backendNodeId : undefined;
    const described: unknown = await devtools.sendCommand("DOM.describeNode", { backendNodeId });
    const node =
      typeof described === "object" && described !== null && "node" in described ? described.node : undefined;
    return { described: JSON.stringify(node).slice(0, 160), isStop: isStopAnchor({ node, sessionId }) };
  } catch (error: unknown) {
    return { described: `unknown (${error instanceof Error ? error.message : String(error)})`, isStop: false };
  }
}

/** Whether a DevTools node description is an anchor whose href is exactly this card's Stop link. */
function isStopAnchor({ node, sessionId }: { node: unknown; sessionId: string }): boolean {
  if (typeof node !== "object" || node === null || !("nodeName" in node) || !("attributes" in node)) {
    return false;
  }
  const { attributes, nodeName } = node;
  if (nodeName !== "A" || !Array.isArray(attributes)) {
    return false;
  }
  // DevTools lists an element's attributes flat, as name then value.
  const hrefAt = attributes.findIndex((entry, index) => index % 2 === 0 && entry === "href");
  return hrefAt >= 0 && attributes[hrefAt + 1] === stopLink({ sessionId });
}

/**
 * One click on a card's Stop, answered with the stop the card's own handler started, or why it never saw one.
 *
 * @param card the card window to click
 * @param press the card's press, armed just before the click
 * @param sessionId the control plane's id, naming which Stop link counts
 * @param timeoutMs how long the card's handler has to see the click
 * @returns the stop the handler started, or why the press did not land
 */
export async function clickAndWait({
  card,
  press,
  sessionId,
  timeoutMs,
}: {
  card: BrowserWindow;
  press: CardPress;
  sessionId: string;
  timeoutMs: number;
}): Promise<Result<Promise<void>, string>> {
  const contentHeight = card.getContentBounds().height;
  const point = stopControlPoint({ contentHeight });
  // What the card itself raised while the press waited, so a click that never became a Stop says where it went.
  const sawEvents: string[] = [];
  const started = (details: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>): void => {
    sawEvents.push(`did-start-navigation ${details.url.slice(0, 80)}`);
  };
  const failed = (_event: Electron.Event, code: number, description: string, url: string): void => {
    sawEvents.push(`did-fail-load ${String(code)} ${description} ${url.slice(0, 80)}`);
  };
  card.webContents.on("did-start-navigation", started);
  card.webContents.on("did-fail-load", failed);
  const unlisten = (): void => {
    if (!card.isDestroyed()) {
      card.webContents.removeListener("did-start-navigation", started);
      card.webContents.removeListener("did-fail-load", failed);
    }
  };
  const clicked = await clickThroughDevtools({ card, point, press, sessionId, timeoutMs });
  if (clicked.isErr()) {
    press.abandon();
    unlisten();
    return err(
      `the click was not sent to the card: ${clicked.error}; this press saw no stop, so read cmux list before pressing again`,
    );
  }
  const pressed = await clicked.value.seen;
  unlisten();
  if (pressed === undefined) {
    const raised = sawEvents.length === 0 ? "no navigation at all" : sawEvents.join("; ");
    return err(
      `the card's Stop did not see the click at (${String(point.x)}, ${String(point.y)}) of a ${String(contentHeight)}px card, on ${clicked.value.hit}, within ${String(timeoutMs / 1000)}s (the card raised ${raised}); no stop had started by then, so read cmux list before pressing again`,
    );
  }
  return ok(pressed.stopping);
}

/**
 * One left click at a point of the card's page, through the page's own DevTools input domain: Blink hit-tests it as
 * a real click on whatever the page draws there. Chosen over `webContents.sendInputEvent`, which Electron delivers
 * only to a focused window, and a background app on current macOS cannot bring its own window to the front.
 *
 * The click is sent only when the element at the point is the card's own Stop link, and the press's waiter is armed
 * only then, just before the click: a stop started before it, or a click landing anywhere else, never answers it.
 */
async function clickThroughDevtools({
  card,
  point,
  press,
  sessionId,
  timeoutMs,
}: {
  card: BrowserWindow;
  point: { x: number; y: number };
  press: CardPress;
  sessionId: string;
  timeoutMs: number;
}): Promise<Result<{ hit: string; seen: PressSeen }, string>> {
  const devtools = card.webContents.debugger;
  const attachedHere = !devtools.isAttached();
  try {
    if (attachedHere) {
      devtools.attach("1.3");
    }
    const hit = await nodeUnder({ devtools, point, sessionId });
    if (!hit.isStop) {
      return err(`the point (${String(point.x)}, ${String(point.y)}) is over ${hit.described}, not the card's Stop`);
    }
    const seen = press.arm({ timeoutMs });
    const button = { button: "left", clickCount: 1, ...point };
    await devtools.sendCommand("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
    await devtools.sendCommand("Input.dispatchMouseEvent", { type: "mousePressed", ...button });
    await devtools.sendCommand("Input.dispatchMouseEvent", { type: "mouseReleased", ...button });
    return ok({ hit: hit.described, seen });
  } catch (error: unknown) {
    return err(error instanceof Error ? error.message : String(error));
  } finally {
    if (attachedHere && !card.isDestroyed() && devtools.isAttached()) {
      devtools.detach();
    }
  }
}
