/**
 * What one candidate's screen says about whether its workspace may close: the screen half of `session close-done`
 * (`./closeDone.ts` plans which rows are candidates; this reads what each one's surface shows), shared by the
 * forced-close decision in `./closeForce.ts`.
 */
import { backgroundWorkOf } from "../cmux/backgroundWork.js";
import {
  hostShowsQueuedMessage,
  hostShowsRunningTurn,
  screenShowsQueuedMessage,
  screenShowsRunningTurn,
} from "../cmux/turnBusy.js";
import { screenHostAtBottom } from "../cmux/turnState.js";

/** What a candidate's screen said when it was read. Only `idle` closes. */
export type ScreenVerdict = "idle" | "busy" | "queued" | "unreadable";

/**
 * Judge one candidate's screen. A turn visibly running, a background shell or Monitor on its footer
 * (`../cmux/backgroundWork.ts` — work that will complete and wake it), or a line queued
 * behind one keeps the workspace; a screen that could not be read keeps it too, because a guess is the expensive
 * direction to be wrong in.
 *
 * When one host's own composer is the bottom of the screen (`../cmux/turnState.ts`'s `screenHostAtBottom`), only
 * that host's markers are read. Otherwise both hosts' are, summed, so an unrecognised screen still errs toward
 * holding. MEASURED on a retired chair that every closer held as `busy` on every tick: an Edit diff in its
 * transcript drew a blank source line as `      202 `, and Codex's terminal count, which accepts a bare number alone
 * on its line, read 202 background terminals above Claude Code's idle footer. Re-check by reading one
 * retired chair's screen with `slopweaver cmux read-screen --workspace <ref>` and passing it here.
 *
 * @param screen the surface's rendered text, or `undefined` when it could not be read
 * @returns the verdict
 */
export function judgeScreen({ screen }: { screen: string | undefined }): ScreenVerdict {
  if (screen === undefined) {
    return "unreadable";
  }
  const host = screenHostAtBottom({ screen });
  let queued = screenShowsQueuedMessage({ screen });
  let running = screenShowsRunningTurn({ screen });
  if (host !== undefined) {
    queued = hostShowsQueuedMessage({ host, screen });
    running = hostShowsRunningTurn({ host, screen });
  }
  if (queued) {
    return "queued";
  }
  const background = backgroundWorkOf({ host, screen });
  const backgroundRuns = background !== undefined && background.shells + background.monitors > 0;
  if (running || backgroundRuns) {
    return "busy";
  }
  return "idle";
}
