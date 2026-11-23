/**
 * NUMBERS-ONLY output: a pure transform that strips every org-identifying string out of a progress event or a
 * summary line, leaving counts, timestamps, phases and shape.
 *
 * ## The gap this closes, precisely
 *
 * The public hygiene gate scans TRACKED FILES. It cannot scan a terminal capture pasted into a pull request,
 * and a terminal capture is exactly what a `silver`-grade proof is made of. So the leak path is: run the verb
 * against the real workspace, screenshot the progress stream, paste it — and ship a repo owner, a team key, an
 * issue title and a channel name into a public repository, with every committed gate green.
 *
 * The Linear expansion sharpens it. `Issue.branchName` embeds the team key AND a slugified title, and the issue
 * lane's own progress preview uses the issue IDENTIFIER as its subject, which is a team key by construction.
 * There is no way to show that stream safely by being careful about it.
 *
 * ## What survives, and why that is still evidence
 *
 * Everything a claim about coverage actually rests on: how many, of what kind, over what window, at what cost,
 * in what order. What goes is every free-text string — previews, item titles, and the per-source labels that
 * carry an `owner/repo` or a channel name. A reader can still check that 24,000 issues arrived across 480
 * pages for 2,100 requests; they simply cannot read anyone's issue titles.
 *
 * The redaction is DELIBERATELY not a denylist over the strings. A denylist has to know the org's words, and
 * the whole point of the private-denylist design is that this repo does not contain them. This drops the field
 * instead of trying to clean it, which is the only version that cannot be defeated by a name nobody predicted.
 */

/** The placeholder that replaces a withheld string, so a reader can SEE that something was withheld. */
export const WITHHELD = "[withheld]";

/**
 * The shape of a progress event this transform can sanitise — structurally the intersection of the connector
 * event and the rich event, so ONE transform covers both without either importing the other.
 *
 * `currentItem` is typed as fully optional rather than mirroring `ProgressCurrentItem`, because the transform
 * only ever reads whether the field is PRESENT: it replaces the whole object rather than editing it.
 */
export interface SanitisableEvent {
  readonly lane: string;
  readonly phase: string;
  readonly done?: number | undefined;
  readonly total?: number | undefined;
  readonly currentItem?: { readonly title: string } | undefined;
  readonly metrics?: Readonly<Record<string, number>> | undefined;
  readonly preview?: unknown;
  readonly learning?: unknown;
}

/**
 * Whether an event survives numbers-only mode at all.
 *
 * A content preview is nothing BUT content — its entire payload is a snippet, a subject and a source content
 * id — so there is no sanitised version of one, and it is dropped rather than blanked into a row of
 * placeholders. Pure.
 *
 * @param event the progress event
 * @returns true when the event has something non-identifying left to say
 */
export function survivesNumbersOnly({ event }: { event: SanitisableEvent }): boolean {
  return event.lane !== "content_preview";
}

/**
 * Strip the identifying strings from one progress event, keeping lane, phase, counts and metrics.
 *
 * `currentItem.title` is the field that catches people out: it is an issue identifier (`TEAM-123`), a repo slug
 * (`owner/repo`) or a channel name at almost every call site, and it reads as harmless because it is short.
 * Any other `currentItem` field is dropped too rather than allow-listed — a future field would otherwise leak
 * by default, which is the wrong direction for a gate to fail in. Pure.
 *
 * @param event the progress event
 * @returns the sanitised event (counts and metrics intact)
 */
export function sanitiseEvent({ event }: { event: SanitisableEvent }): SanitisableEvent {
  return {
    lane: event.lane,
    phase: event.phase,
    ...(event.done !== undefined ? { done: event.done } : {}),
    ...(event.total !== undefined ? { total: event.total } : {}),
    ...(event.metrics !== undefined ? { metrics: event.metrics } : {}),
    ...(event.currentItem !== undefined ? { currentItem: { title: WITHHELD } } : {}),
  };
}

/**
 * Sanitise one summary line by replacing a LABEL with the placeholder.
 *
 * The refresh summary and the per-window log lines are built around a label, and for GitHub that label is
 * `owner/repo` — the single most obviously private string the verb prints. The label is passed in rather than
 * pattern-matched out, because the caller is the only thing that knows which substring was the label; guessing
 * would either miss it or mangle the numbers around it. Pure.
 *
 * @param text the summary line
 * @param label the label to withhold (an empty label leaves the line unchanged)
 * @returns the line with every occurrence of the label withheld
 */
export function sanitiseLine({ text, label }: { text: string; label: string }): string {
  return label.length === 0 ? text : text.replaceAll(label, WITHHELD);
}
