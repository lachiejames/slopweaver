/**
 * One app-hosted session's card window: opened BEFORE its worker, so the lease that clears the worker can be minted
 * from a window that is really on screen with its Stop control (`visibleSessionLease.ts`). Like the fleet's pages
 * (`fleetWindows.ts`) it runs with JavaScript off and no preload; a press on Stop is a `slopweaver-session:` link this
 * module intercepts and hands back.
 *
 * Closing the card IS a stop: a session whose card is gone is a session nobody can see, so the window's `closed`
 * reports a stop exactly as the button does.
 *
 * Every redraw is a whole-document reload, so when one happens is `sessionCardRedraw.ts`'s call: streamed agent text
 * coalesced, loads never overlapping, and nothing reloading while a press on the Stop is landing.
 */
import { app, BrowserWindow, screen } from "electron";
import { err, ok, type Result } from "neverthrow";

import { type CardStop, cardStopFor, type ScheduleTimeout } from "./cardStop";
import { SESSION_LINK_SCHEME, type SessionLink, stopLink, withinStopControl } from "./sessionCard";
import { clickAndWait } from "./sessionCardClick";
import { type CardRedraw, cardRedrawFor, TAIL_REDRAW_MS } from "./sessionCardRedraw";
import type { LeaseWindow } from "./visibleSessionLease";

/** How long a new card has to come up on screen before the launch is refused. */
const CARD_SHOWN_MS = 15_000;

/**
 * How long a mouse press on the Stop holds the card still when no Stop navigation follows it (the owner dragged off
 * the control, say). Not measured: a starting value, longer than a click and short enough that a held card is not
 * noticed.
 */
const MOUSE_HOLD_MS = 1_500;

/** How long the card's handler has to see a press made again for the owner, the same window a `--via-card` press has. */
const PRESS_AGAIN_SEEN_MS = 5_000;

/** How long a press waits for a reload already under way to finish before it clicks. */
const LOAD_SETTLE_MS = 2_000;

/** What a card window reports. */
export interface SessionWindowHost {
  /** The owner pressed Stop, or closed the card; settles once the stop it starts has finished. */
  readonly stop: (options: { readonly link: SessionLink }) => Promise<void>;
  /** A window's title, naming Slopweaver and, in a dev run, the dev build. */
  readonly titleFor: (options: { readonly page: string }) => string;
}

const cards = new Map<string, BrowserWindow>();

/**
 * Each card's Stop, by session (`cardStop.ts`): a press is answered by the stop the card's own navigation handler
 * started, the same path an owner's click takes, and never by one of its own.
 */
const cardStops = new Map<string, CardStop>();

/** Each card's reloads, by session (`sessionCardRedraw.ts`). */
const redraws = new Map<string, CardRedraw>();

/** Set once the app begins quitting, before it closes any window, so a card the quit closes is never read as a Stop. */
let quitting = false;
app.once("before-quit", () => {
  quitting = true;
});

/** The app's timer for a press's deadline and a card's tail interval. */
const scheduleTimeout: ScheduleTimeout = ({ afterMs, run }) => {
  const timer = setTimeout(run, afterMs);
  return () => {
    clearTimeout(timer);
  };
};

/**
 * Open a session's card and wait until it is shown and loaded. A card opens before its agent has said anything, so
 * its first document is its own frame.
 *
 * @param sessionId the control plane's id
 * @param title the session's title
 * @param url the card's page
 * @param host what the window reports to
 * @returns the window as the lease reads it, bound to this session, or why it never came up
 */
export async function openSessionCard({
  sessionId,
  title,
  url,
  host,
}: {
  sessionId: string;
  title: string;
  url: string;
  host: SessionWindowHost;
}): Promise<Result<LeaseWindow, string>> {
  const created = cardWindow({ title: host.titleFor({ page: title }) });
  cards.set(sessionId, created);
  const redraw: CardRedraw = cardRedrawFor({
    frame: url,
    load: ({ url: next }) => {
      if (!created.isDestroyed()) {
        void loadInto({ card: created, redraw, url: next });
      }
    },
    schedule: scheduleTimeout,
    tailMs: TAIL_REDRAW_MS,
    url,
  });
  redraws.set(sessionId, redraw);
  listenForStop({ created, host, redraw, sessionId });
  created.on("closed", () => {
    if (cards.get(sessionId) === created) {
      forget({ sessionId });
      // A quit closes every card, and that is no Stop: `will-quit` ends each group without asking, so the session
      // stays one a later run may resume rather than being journalled closed on the way out.
      if (!quitting) {
        void host.stop({ link: { act: "stop", sessionId } });
      }
    }
  });
  const shown = new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      resolve(false);
    }, CARD_SHOWN_MS);
    created.once("ready-to-show", () => {
      created.show();
      clearTimeout(timer);
      resolve(true);
    });
  });
  await loadInto({ card: created, redraw, url });
  if (!(await shown) || created.isDestroyed()) {
    return err("the session's card did not come up on screen");
  }
  return ok({
    isDestroyed: () => created.isDestroyed(),
    isLoading: () => created.webContents.isLoading(),
    isVisible: () => created.isVisible(),
    sessionId,
    shownUrl: () => created.webContents.getURL(),
  });
}

/** Load one document into a card and tell its reloads how the load ended; never rejects. */
async function loadInto({
  card,
  redraw,
  url,
}: {
  card: BrowserWindow;
  redraw: CardRedraw;
  url: string;
}): Promise<void> {
  const failed = await card.loadURL(url).then(
    () => false,
    () => true,
  );
  redraw.loaded({ failed });
}

/** A new card window, hidden until its page is ready, stacked beside the cards already open. */
function cardWindow({ title }: { title: string }): BrowserWindow {
  const workArea = screen.getPrimaryDisplay().workArea;
  const width = 420;
  const offset = 24 * cards.size;
  const created = new BrowserWindow({
    backgroundColor: "#0f1115",
    height: 360,
    minHeight: 220,
    minWidth: 320,
    show: false,
    title,
    webPreferences: { contextIsolation: true, javascript: false, nodeIntegration: false, sandbox: true },
    width,
    x: workArea.x + workArea.width - width - 16 - offset,
    y: workArea.y + 64 + offset,
  });
  created.on("page-title-updated", (event) => {
    event.preventDefault();
  });
  created.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  return created;
}

/** Drop a card's window, Stop and reloads from the maps, cancelling anything its reloads still had waiting. */
function forget({ sessionId }: { sessionId: string }): void {
  redraws.get(sessionId)?.retire();
  cards.delete(sessionId);
  cardStops.delete(sessionId);
  redraws.delete(sessionId);
}

/**
 * Feed the card's navigations to its Stop (`cardStop.ts`), which starts the card's one stop when its own Stop link is
 * followed, however many of the events below report the one click.
 *
 * MEASURED on the installed app: a click on the Stop link raises `did-start-navigation` for
 * `slopweaver-session:stop/<id>` and never `will-navigate`, since nothing loads an unregistered scheme. So the card
 * catches its link there as well and leaves that navigation alone: the link loads nothing, so it ends by itself, and
 * `webContents.stop()` from inside that callback crashed the whole app (SIGTRAP). Repro: `cmux close --via-card` with
 * only the `will-navigate` handler; its refusal lists the navigations the card raised.
 *
 * A left mouse press on the Stop holds the card's reloads until that navigation is seen, or {@link MOUSE_HOLD_MS}
 * passes without one, so a reload never replaces the page between the press and the release.
 */
function listenForStop({
  created,
  host,
  redraw,
  sessionId,
}: {
  created: BrowserWindow;
  host: SessionWindowHost;
  redraw: CardRedraw;
  sessionId: string;
}): void {
  const stop = cardStopFor({ schedule: scheduleTimeout, sessionId, startStop: host.stop });
  cardStops.set(sessionId, stop);
  const { release } = holdOnMousePress({ created, redraw, sessionId });
  // Only this card's own Stop link ends a mouse hold early; any other navigation leaves it to its timer.
  const releaseOnStop = ({ target }: { target: string }): void => {
    if (target === stopLink({ sessionId })) {
      release();
    }
  };
  created.webContents.on("will-navigate", (event, target) => {
    event.preventDefault();
    stop.observe({ target });
    releaseOnStop({ target });
  });
  created.webContents.on("did-start-navigation", (details) => {
    if (details.isMainFrame && details.url.startsWith(SESSION_LINK_SCHEME)) {
      stop.observe({ target: details.url });
      releaseOnStop({ target: details.url });
    }
  });
}

/**
 * Hold a card's reloads from a left mouse press on its Stop until `release` (the Stop link followed) or
 * {@link MOUSE_HOLD_MS}. A reload already under way at the press is not one a hold can stop, and when it swaps the page
 * between press and release the page sees no click at all. So a release on the Stop after any page committed since the
 * press presses the Stop again, through the same real click a `--via-card` press sends, which a stop already started
 * refuses.
 */
function holdOnMousePress({
  created,
  redraw,
  sessionId,
}: {
  created: BrowserWindow;
  redraw: CardRedraw;
  sessionId: string;
}): { readonly release: () => void } {
  let letGo: (() => void) | undefined;
  // Pages the card has committed, counted rather than compared by URL, so a swap away and back again still shows.
  let commits = 0;
  created.webContents.on("did-navigate", () => {
    commits += 1;
  });
  // The page the left button went down on, kept until it comes up: the fallback timer lets the hold go, never this.
  let pressedOn: number | undefined;
  const letHoldGo = (): void => {
    letGo?.();
    letGo = undefined;
  };
  created.webContents.on("before-mouse-event", (_event, mouse) => {
    if (mouse.button !== "left") {
      return;
    }
    const onStop = withinStopControl({ contentHeight: created.getContentBounds().height, x: mouse.x, y: mouse.y });
    if (mouse.type === "mouseDown") {
      pressedOn = onStop ? commits : undefined;
      if (onStop) {
        // The new press holds before the one it replaces lets go, so no reload slips in between; a press anywhere
        // else leaves an earlier press's hold to its own link or timer.
        const earlier = letGo;
        const held = redraw.hold();
        const cancel = scheduleTimeout({ afterMs: MOUSE_HOLD_MS, run: letHoldGo });
        letGo = () => {
          cancel();
          held();
        };
        earlier?.();
      }
      return;
    }
    if (mouse.type === "mouseUp") {
      const swapped = onStop && pressedOn !== undefined && pressedOn !== commits;
      pressedOn = undefined;
      if (swapped) {
        // The press takes its own hold before its first await, so the page cannot be swapped again in between.
        const again = pressSessionStop({ sessionId, timeoutMs: PRESS_AGAIN_SEEN_MS });
        letHoldGo();
        void again;
      }
    }
  });
  // A Stop link seen mid-press may be another press's, so it lets the hold go and leaves this press's page alone: a
  // swap still presses again at the release, refused if that other press's stop has started.
  return { release: letHoldGo };
}

/**
 * Redraw a card from the session's current state, when its window is still open.
 *
 * @param sessionId the control plane's id
 * @param url the card's page now
 * @param frame that page without the streamed agent text, so a change of the text alone may wait its interval
 */
export function drawSessionCard({ sessionId, url, frame }: { sessionId: string; url: string; frame: string }): void {
  redraws.get(sessionId)?.request({ frame, url });
}

/**
 * Click a session's card's Stop control, as the owner would: a mouse press on the control where the page draws it,
 * answered only once the card's own navigation handler saw it. Nothing here calls the stop; a click that never reaches
 * the control times out and stops nothing. The card's reloads are held from before the click until it is seen or given
 * up on, so no reload replaces the page under it.
 *
 * @param sessionId the control plane's id
 * @param timeoutMs how long the card's handler has to see the click
 * @returns the stop the handler started, or why the press did not land
 */
export async function pressSessionStop({
  sessionId,
  timeoutMs,
}: {
  sessionId: string;
  timeoutMs: number;
}): Promise<Result<Promise<void>, string>> {
  const card = cards.get(sessionId);
  const stop = cardStops.get(sessionId);
  const redraw = redraws.get(sessionId);
  if (card === undefined || stop === undefined || redraw === undefined) {
    return err("that session has no card on screen");
  }
  // Held before anything else, so every exit from here on, a refusal included, lets go exactly once.
  const held = redraw.hold();
  try {
    if (card.isDestroyed()) {
      return err("that session has no card on screen");
    }
    if (!card.isVisible()) {
      return err("that session's card is not shown, so its Stop cannot be pressed");
    }
    if (!(await loadSettled({ card }))) {
      return err(
        `that session's card was still loading after ${String(LOAD_SETTLE_MS / 1000)}s, so its Stop was not pressed`,
      );
    }
    const press = stop.press();
    if (press.isErr()) {
      return err(press.error);
    }
    return await clickAndWait({ card, press: press.value, sessionId, timeoutMs });
  } finally {
    held();
  }
}

/** Whether the card has no load under way, waiting up to {@link LOAD_SETTLE_MS} for one already started to end. */
async function loadSettled({ card }: { card: BrowserWindow }): Promise<boolean> {
  if (!card.webContents.isLoading()) {
    return true;
  }
  return new Promise<boolean>((resolve) => {
    const ended = (): void => {
      cancel();
      resolve(!card.isDestroyed() && !card.webContents.isLoading());
    };
    const cancel = scheduleTimeout({
      afterMs: LOAD_SETTLE_MS,
      run: () => {
        if (!card.isDestroyed()) {
          card.webContents.removeListener("did-stop-loading", ended);
        }
        resolve(false);
      },
    });
    card.webContents.once("did-stop-loading", ended);
  });
}

/**
 * Close a card without reporting a stop — the session already ended, or its launch was abandoned.
 *
 * @param sessionId the control plane's id
 */
export function retireSessionCard({ sessionId }: { sessionId: string }): void {
  const card = cards.get(sessionId);
  forget({ sessionId });
  if (card !== undefined && !card.isDestroyed()) {
    card.close();
  }
}
