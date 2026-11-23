/**
 * Which of the shell's windows a message came from, judged by the page that sent it. Pure; `main.ts` names the
 * candidate from the sender's `WebContents` and asks this whether its page is on the console.
 *
 * The voice's window is judged against the origin its page was LOADED from, never the console's origin now: a
 * recovery unsets that while it runs, and judging against it refuses the voice's look at the owner's screen mid-call
 * ("only the voice's window may look at the owner's screen") while the call itself carries on. A console tab is still judged
 * against the console's origin now, so a recovery never widens what a tab may ask.
 */
import { consolePathOf } from "./persistedState";

/** A window allowed to send the shell messages. */
export type DesktopSenderRole = "main" | "overlay";

/**
 * The role a sender holds, once its page is proven on the console it belongs to.
 *
 * @param candidate the role its `WebContents` would hold — a tab is `main`, the voice's window `overlay`
 * @param consoleOrigin the console's origin now; unset while a recovery runs
 * @param frameUrl the sending frame's address
 * @param overlayOrigin the origin the voice's page was loaded from
 * @param topLevel whether the frame is the page itself rather than one framed inside it
 * @returns the role, or `undefined` when the sender is no window of the shell's or its page is off its console
 */
export function roleForSenderPage({
  candidate,
  consoleOrigin,
  frameUrl,
  overlayOrigin,
  topLevel,
}: {
  candidate: DesktopSenderRole | undefined;
  consoleOrigin: string | undefined;
  frameUrl: string;
  overlayOrigin: string | undefined;
  topLevel: boolean;
}): DesktopSenderRole | undefined {
  if (candidate === undefined || !topLevel) {
    return undefined;
  }
  let origin = consoleOrigin;
  if (candidate === "overlay") {
    origin = overlayOrigin;
  }
  if (origin === undefined || consolePathOf({ origin, url: frameUrl }) === undefined) {
    return undefined;
  }
  return candidate;
}
