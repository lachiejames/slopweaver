/**
 * The backtest panel's reading, parsed in Node rather than in the page.
 *
 * ## Why the parsing is here and not in the browser
 *
 * The script this design was ported from read the counts INSIDE the Datadog page, where no unit test can
 * reach them: the parse ran in a serialised function whose only observable output was a settled reading, so
 * a wording change in Datadog's own panel could only ever be found by capturing a real monitor. Splitting it
 * means the page returns TEXT and this file turns text into numbers, which makes the whole reading contract
 * a pure function with a table of fixtures — and a Datadog rewording becomes a failing unit test rather than
 * a wrong image.
 *
 * ## What the numbers are
 *
 * The panel's own sentence, verbatim in shape: "The monitor would have transitioned 24 times ..." followed
 * by a counts row reading "12 Alert 0 Warn 12 Recover 0 No Data". Every one of the five is required — a
 * partial reading is refused rather than defaulted, because a zero that came from an absent match and a zero
 * the panel actually reported are the same number and mean opposite things.
 */
import { err, ok, type Result } from "../../lib/result.js";
import { type DatadogShotError, DatadogShotErrors } from "./errors.js";

/**
 * What the "Monitor behavior with this threshold" panel reported over the captured window.
 * @internal
 */
export interface BacktestReading {
  /** The panel's own sentence: how many times the monitor would have changed state. */
  readonly transitions: number;
  readonly alert: number;
  readonly warn: number;
  readonly recover: number;
  readonly noData: number;
}

/** Collapse whitespace the way the page-side reader does, so a fixture and a live read normalise alike. */
function normalise({ text }: { text: string }): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Read one `<n> <label>` count out of the panel's text.
 *
 * @param panelText the panel's normalised text
 * @param label the count's label, e.g. `Alert`
 * @returns the count, or `null` when the label carries no number in this text
 */
function readCount({ panelText, label }: { panelText: string; label: string }): number | null {
  const found = new RegExp(String.raw`(\d+)\s+${label}\b`).exec(panelText);
  return found?.[1] === undefined ? null : Number(found[1]);
}

/**
 * Parse the backtest panel's text into the reading the image is captioned with.
 *
 * @param panelText the panel's text, exactly as the page returned it
 * @returns the five counts, or the typed reason this text is not a backtest panel's
 */
export function parseBacktestPanel({ panelText }: { panelText: string }): Result<BacktestReading, DatadogShotError> {
  const text = normalise({ text: panelText });
  const transitionsMatch = /transitioned\s+(\d+)\s+times?/.exec(text);
  const alert = readCount({ label: "Alert", panelText: text });
  const warn = readCount({ label: "Warn", panelText: text });
  const recover = readCount({ label: "Recover", panelText: text });
  const noData = readCount({ label: "No Data", panelText: text });

  const missing: string[] = [];
  if (transitionsMatch?.[1] === undefined) {
    missing.push("transition count");
  }
  for (const [label, value] of [
    ["Alert", alert],
    ["Warn", warn],
    ["Recover", recover],
    ["No Data", noData],
  ] as const) {
    if (value === null) {
      missing.push(label);
    }
  }
  if (transitionsMatch?.[1] === undefined || alert === null || warn === null || recover === null || noData === null) {
    return err(DatadogShotErrors.panelUnreadable({ missing, panelText: text }));
  }
  return ok({ alert, noData, recover, transitions: Number(transitionsMatch[1]), warn });
}

/**
 * The one-line caption a captured monitor shot is reported with.
 *
 * The same shape the PR's Proof cell wants, so the number a reviewer reads and the number the verb printed
 * are one string rather than two renderings that can disagree.
 *
 * @param reading the counts the panel reported
 * @param windowLabel the window the picker was showing, e.g. `Past 1 Week`
 * @returns the caption line
 */
export function formatReadingLine({ reading, windowLabel }: { reading: BacktestReading; windowLabel: string }): string {
  return (
    `${String(reading.transitions)} transitions over ${windowLabel} — ` +
    `${String(reading.alert)} Alert / ${String(reading.warn)} Warn / ` +
    `${String(reading.recover)} Recover / ${String(reading.noData)} No Data`
  );
}

/**
 * The file one monitor's backtest shot is written as.
 *
 * Not configurable, for the reason the crop is not: two monitor PRs whose proof is named differently is
 * half the problem this verb exists to remove.
 *
 * @param monitorId the monitor's numeric id, already validated
 * @returns the file name, without a directory
 */
export function monitorShotFilename({ monitorId }: { monitorId: string }): string {
  return `monitor-${monitorId}-7d-backtest.png`;
}

/**
 * The file one Explorer capture is written as.
 *
 * Explorer views have no id to name them by, so the name carries a slug of what was asked for plus the
 * instant it was read — two shots of the same query taken an hour apart are different evidence and must not
 * overwrite each other.
 *
 * @param label the query or view the shot was taken of
 * @param nowIso the instant the shot was taken, which makes the name unique
 * @returns the file name, without a directory
 */
export function explorerShotFilename({ label, nowIso }: { label: string; nowIso: string }): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  const stamp = nowIso.replace(/[:.]/g, "-");
  return `explorer-${slug === "" ? "view" : slug}-${stamp}.png`;
}
