/**
 * Waiting for a page to finish rendering before it is photographed.
 *
 * Pure. No browser, no clock; `src/cli/commands/browser/sessionShell.ts` and `./actionExecutor.ts` run the
 * loop this file describes.
 *
 * ## The defect this closes, MEASURED on the owner's own Chrome
 *
 * `slopweaver browser open --url https://<this install's site>/apm/home` came back with `title: (untitled)` and a
 * screenshot that was 1512x662 pixels of WHITE. The client's `goto` resolves on the document's load event,
 * and Datadog is a single-page application that renders after it — so the first look was taken of a page
 * that had not drawn anything yet. A second `read` moments later showed the whole console.
 *
 * A blank picture is worse than no picture, because it is evidence-shaped: an earlier incident
 * was a Datadog panel photographed before it had rendered, and this is the same failure one verb upstream.
 * It is unacceptable here rather than merely untidy: seeing the result of every action instantly only means
 * something if the picture is of the result.
 *
 * ## The signal is the DOM's own shape, not its text
 *
 * {@link PAGE_PULSE_SOURCE} reads four things and {@link pulsesAgree} settles on three of them. Text length
 * is deliberately NOT one: a console with a live relative timestamp (*"3 minutes ago"*) or a ticking counter
 * changes its text forever, so a text-stable rule would spend the whole budget on every page and settle on
 * none of them. The element COUNT is what actually stops moving when a page has finished drawing, and it is
 * carried in the pulse anyway so a reader of a `--json` receipt can see what settled.
 *
 * ## It is a budget, never a guarantee
 *
 * A page that never settles is photographed anyway when {@link PAGE_SETTLE_BUDGET_MS} runs out, because a
 * picture of a page still drawing is strictly better than an error where evidence should be — and the agent
 * can look, and look again. Nothing here claims the page was ready; the loop just stops asking.
 */
import { isRecord } from "../lib/parsers.js";
import { evalReplyValue } from "./evalReply.js";

/** How long to wait between two readings of the page's own shape. */
export const PAGE_PULSE_INTERVAL_MS = 250;

/**
 * The most a look will wait for a page to stop drawing.
 *
 * Six seconds is a POLICY choice stated as one: comfortably past a heavy console's first paint, and well
 * under `src/browser/terminalClient.ts`'s own 60-second command timeout, so a page that never settles costs a
 * pause rather than a failure. `browser shot`'s readiness wait is longer because it is waiting for one named
 * target to carry real data; this is only waiting for the page to be drawn at all.
 */
export const PAGE_SETTLE_BUDGET_MS = 6000;

/**
 * What the page says about its own state, asked once.
 *
 * Takes no element, so it is the client's `eval <func>` with no target. One string literal authored here,
 * returning two strings and two numbers — the same closed shape `./aim.ts` and `./aimShot.ts` use, and no
 * caller data reaches it.
 */
export const PAGE_PULSE_SOURCE = `() => ({
  ready: document.readyState,
  title: document.title,
  elementCount: document.getElementsByTagName("*").length,
  textLength: document.body ? document.body.innerText.length : 0,
})`;

/** One reading of the page's own state. */
export interface PagePulse {
  /** `document.readyState` — `loading`, `interactive` or `complete`. */
  readonly ready: string;
  readonly title: string;
  /** Every element in the document. The thing that stops moving when a page has finished drawing. */
  readonly elementCount: number;
  /** Carried for a reader of a receipt; deliberately not part of the settle test — see this file's header. */
  readonly textLength: number;
}

/**
 * Read one pulse out of the client's reply.
 *
 * @param stdout everything the client printed for the pulse command
 * @returns the reading, or `null` when the reply carried no readable one
 */
export function parsePagePulse({ stdout }: { stdout: string }): PagePulse | null {
  const value = evalReplyValue({ stdout });
  if (!isRecord(value)) {
    return null;
  }
  if (typeof value["ready"] !== "string" || typeof value["title"] !== "string") {
    return null;
  }
  if (typeof value["elementCount"] !== "number" || typeof value["textLength"] !== "number") {
    return null;
  }
  return {
    elementCount: value["elementCount"],
    ready: value["ready"],
    textLength: value["textLength"],
    title: value["title"],
  };
}

/**
 * Whether two consecutive readings say the page has finished drawing.
 *
 * Three conditions, and each earns its place. The document must be `complete`, because anything else is a
 * page still loading its own resources. The element count must not have moved between the two readings,
 * which is what "finished drawing" actually looks like. And the title must not be empty — the measured
 * symptom of the blank Datadog capture was `title: (untitled)`, a single-page application that had not run
 * its own first render, and a page genuinely without a title settles on the budget instead.
 *
 * @param earlier the first reading
 * @param later the reading taken {@link PAGE_PULSE_INTERVAL_MS} afterwards
 * @returns true when the page may be photographed
 */
export function pulsesAgree({ earlier, later }: { earlier: PagePulse; later: PagePulse }): boolean {
  if (later.ready !== "complete" || later.title.length === 0) {
    return false;
  }
  return earlier.elementCount === later.elementCount;
}
