/**
 * The background full-screen guard: a background act may not put the owner's Chrome into macOS full screen.
 *
 * Pure — the two `run-code` sources, the decision whether an act is guarded, and the parse of what each source
 * returns. `./fullscreenGuardRun.ts` is the shell that sends them.
 *
 * ## Why it exists
 *
 * A bot loop session ran `browser act --do click --target f1e292` on a Datadog RUM
 * session replay, and `f1e292` was the replay player's `button "Enter fullscreen"`. The page called the HTML
 * Fullscreen API, and Chrome on macOS moved the window into a full-screen Space of its own and switched the owner to it —
 * their whole screen, front of focus, the first time browser work left the background. The foreground
 * restore (`./foreground.ts`) cannot answer that: it reorders windows and hands the front app back, and a Space
 * switch is neither. So the request is refused inside the page instead, before the act that would trigger it.
 *
 * ## The mechanism, and what it does not close
 *
 * {@link FULLSCREEN_GUARD_INSTALL_SOURCE} replaces `Element.prototype.requestFullscreen` and its two WebKit
 * spellings, in every frame `page.frames()` names, with a function that counts the request and rejects it with a
 * `NotAllowedError`. On the main document it also adds a `fullscreenchange` listener that leaves full screen the
 * moment anything enters it — the catch-all for a request the replacement did not see, because an iframe's element
 * going full screen makes the iframe the main document's own `fullscreenElement`. That listener is REACTIVE: by the
 * time it fires, macOS may already have begun the Space switch.
 *
 * The same arming is also registered as the page's init script, so every document committed AFTER the guard was
 * armed starts guarded too — a reload or navigation between arming and the dispatch, a frame attached later, or the
 * document the act itself navigates to. Without it, a document replaced in the admission round trip that sits
 * between arming and dispatch would be acted on unguarded.
 *
 * A background `browser open` arms it on the blank tab before its `goto`, so the first page's own scripts never see
 * the original method either — a page that keeps `requestFullscreen` at startup holds the refusal.
 *
 * Not closed, stated rather than discovered: a session whose open-time arming failed (said on stderr), where a
 * page that kept the original before the first act still holds it; browser-chrome full screen and every other way of
 * driving Chrome than `browser open` and `browser act`. Once armed the init script stays for the page's life, which a
 * background session keeps for its own: its placement is fixed at `browser open`.
 *
 * Foreground placement is never guarded: a run opened to be SHOWN (`browser present`, `SLOPWEAVER_BROWSER_FOREGROUND=1`)
 * may take full screen, because showing the owner a page is the point of it.
 */
import { type BrowserActionKind, isWriteCapableAction } from "./action.js";
import { evalReplyValue } from "./evalReply.js";
import type { WindowPlacement } from "./foreground.js";

/** What the install source reports: how many of the page's frames now refuse full screen. */
export interface FullscreenGuardInstallation {
  readonly attemptedFrames: number;
  readonly installedFrames: number;
  readonly failedFrames: number;
  /** Whether the main document's leave-full-screen listener is in place. */
  readonly mainListenerInstalled: boolean;
  /** Whether the page's init script is registered, so a document committed after arming starts guarded too. */
  readonly newDocumentsGuarded: boolean;
}

/** What the read source reports after the act: what the page asked for, and what had to be undone. */
export interface FullscreenGuardObservation {
  /** Full-screen requests the replacement refused during this act, summed over every frame it could read. */
  readonly refusedRequests: number;
  /** Times the main document's listener had to leave full screen after it was entered. */
  readonly emergencyExits: number;
  /** Frames whose counters could not be read, so the two counts are a lower bound when this is above zero. */
  readonly unreadableFrames: number;
}

/** Whether an act was guarded, and how far the guard got before the act was dispatched. */
export type FullscreenGuardPreparation =
  | { readonly kind: "not-required" }
  | { readonly kind: "armed"; readonly installation: FullscreenGuardInstallation }
  | { readonly kind: "unknown" };

/**
 * The `run-code` source that arms every frame of the session's page. Fixed, authored here, and one argv element:
 * no ref, URL, value or page text reaches it, the discipline `./keepForeground.ts`'s `TAB_ACTIVATION_ARGS` keeps.
 *
 * It resets each frame's counters, so a refusal is attributed to the act that caused it rather than to a later
 * one, and catches each frame on its own, so a detached child never costs the main frame its guard. `arm` takes no
 * argument and finds the main document itself, because the init script runs it with none. The init script is
 * registered once per page object; should the client hand a fresh one to each command, a repeat registration is a
 * second run of the same idempotent `arm`.
 */
export const FULLSCREEN_GUARD_INSTALL_SOURCE = `async (page) => {
  const arm = () => {
    const isMain = window.top === window;
    const state = { refused: 0, exits: 0 };
    window.__slopweaverFullscreenGuard = state;
    const refuse = function () {
      window.__slopweaverFullscreenGuard.refused += 1;
      return Promise.reject(new DOMException("full screen is refused while a background agent drives this browser", "NotAllowedError"));
    };
    for (const name of ["requestFullscreen", "webkitRequestFullscreen", "webkitRequestFullScreen"]) {
      if (typeof Element.prototype[name] === "function") {
        Object.defineProperty(Element.prototype, name, { configurable: true, writable: true, value: refuse });
      }
    }
    if (isMain && window.__slopweaverFullscreenExit !== true) {
      window.__slopweaverFullscreenExit = true;
      document.addEventListener("fullscreenchange", () => {
        if (document.fullscreenElement !== null) {
          window.__slopweaverFullscreenGuard.exits += 1;
          document.exitFullscreen().catch(() => undefined);
        }
      });
    }
    return isMain && window.__slopweaverFullscreenExit === true;
  };
  let newDocumentsGuarded = page.__slopweaverFullscreenInit === true;
  if (!newDocumentsGuarded) {
    try {
      await page.addInitScript(arm);
      page.__slopweaverFullscreenInit = true;
      newDocumentsGuarded = true;
    } catch {
      newDocumentsGuarded = false;
    }
  }
  const frames = page.frames();
  let installedFrames = 0;
  let failedFrames = 0;
  let mainListenerInstalled = false;
  for (const frame of frames) {
    try {
      const listening = await frame.evaluate(arm);
      installedFrames += 1;
      if (listening) mainListenerInstalled = true;
    } catch {
      failedFrames += 1;
    }
  }
  return { attemptedFrames: frames.length, installedFrames, failedFrames, mainListenerInstalled, newDocumentsGuarded };
}`;

/**
 * The `run-code` source that reads the counters back after the act. Fixed, like the install source. A document
 * committed after arming carries the init script's fresh counters, so a refusal there is counted; a frame with no
 * counters at all — the init script could not be registered — counts nothing rather than failing.
 */
export const FULLSCREEN_GUARD_READ_SOURCE = `async (page) => {
  let refusedRequests = 0;
  let emergencyExits = 0;
  let unreadableFrames = 0;
  for (const frame of page.frames()) {
    try {
      const counts = await frame.evaluate(() => {
        const state = window.__slopweaverFullscreenGuard;
        return state === undefined ? null : { refused: state.refused, exits: state.exits };
      });
      if (counts !== null) {
        refusedRequests += counts.refused;
        emergencyExits += counts.exits;
      }
    } catch {
      unreadableFrames += 1;
    }
  }
  return { refusedRequests, emergencyExits, unreadableFrames };
}`;

/**
 * Whether an act is guarded: every write-capable kind in a background session, and nothing else.
 *
 * The write-capable set rather than a full-screen-specific list, because a click, a key press, a drag or a check can
 * each carry the user activation a page's full-screen request needs, and a kind added to that set later is guarded
 * without anybody remembering to.
 *
 * @param kind the interaction
 * @param placement the session's window placement, chosen at `browser open`
 * @returns true when the guard is armed before this act
 */
export function shouldGuardFullscreen({
  kind,
  placement,
}: {
  kind: BrowserActionKind;
  placement: WindowPlacement;
}): boolean {
  return placement === "background" && isWriteCapableAction({ kind });
}

/**
 * Whether a parsed value is a whole, non-negative count.
 *
 * @returns true when the value is an integer of zero or more
 */
function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * Whether a parsed value is an object fields can be read off.
 *
 * @returns true when the value is a non-null, non-array object
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Read the install source's reply.
 *
 * @param stdout everything the client printed for the install command
 * @returns the installation, or `null` when the reply carried no readable, self-consistent one
 */
export function parseFullscreenGuardInstallation({ stdout }: { stdout: string }): FullscreenGuardInstallation | null {
  const value = evalReplyValue({ stdout });
  if (!isRecord(value)) {
    return null;
  }
  const { attemptedFrames, installedFrames, failedFrames, mainListenerInstalled, newDocumentsGuarded } = value;
  if (!isCount(attemptedFrames) || !isCount(installedFrames) || !isCount(failedFrames)) {
    return null;
  }
  if (typeof mainListenerInstalled !== "boolean" || typeof newDocumentsGuarded !== "boolean") {
    return null;
  }
  if (installedFrames + failedFrames !== attemptedFrames) {
    return null;
  }
  return { attemptedFrames, failedFrames, installedFrames, mainListenerInstalled, newDocumentsGuarded };
}

/**
 * Read the read source's reply.
 *
 * @param stdout everything the client printed for the read command
 * @returns the observation, or `null` when the reply carried no readable one
 */
export function parseFullscreenGuardObservation({ stdout }: { stdout: string }): FullscreenGuardObservation | null {
  const value = evalReplyValue({ stdout });
  if (!isRecord(value)) {
    return null;
  }
  const { refusedRequests, emergencyExits, unreadableFrames } = value;
  if (!isCount(refusedRequests) || !isCount(emergencyExits) || !isCount(unreadableFrames)) {
    return null;
  }
  return { emergencyExits, refusedRequests, unreadableFrames };
}

/**
 * What the receipt says about full screen, when anything happened.
 *
 * A refusal is the guard working, and it is said so the caller knows why its click showed nothing. An emergency
 * exit is NOT a clean success — full screen was entered first — and says so, with the one fact nothing here
 * observes: whether macOS had begun moving the owner to the full-screen Space before the exit.
 *
 * @param observation what the read source reported, or `null` when there was no reliable reading
 * @returns the receipt lines, empty when the page asked for nothing
 */
export function fullscreenReceiptLines({
  observation,
}: {
  observation: FullscreenGuardObservation | null;
}): readonly string[] {
  if (observation === null) {
    return [];
  }
  const lines: string[] = [];
  const { refusedRequests, emergencyExits } = observation;
  if (refusedRequests > 0) {
    const times = refusedRequests === 1 ? "" : ` (${String(refusedRequests)} requests)`;
    lines.push(
      `  full screen: the page asked for full screen${times}; it was refused, so the browser stayed in the background (SLOPWEAVER_BROWSER_FOREGROUND=1 at browser open allows it)`,
    );
  }
  if (emergencyExits > 0) {
    lines.push(
      "  full screen: the page ENTERED full screen and was taken back out of it; whether macOS had already switched your screen to it first is unknown",
    );
  }
  return lines;
}
