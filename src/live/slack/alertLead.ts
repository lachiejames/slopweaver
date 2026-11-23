/**
 * The ONE thing prose contributes to an alert summary: the single editorial sentence, and nothing else.
 *
 * ## Where the sentence comes from
 *
 * There is no model call in this file, or anywhere in this verb — see AGENTS.md § "No spawned model, anywhere".
 * The sentence is supplied by the OPERATOR, via `--lead` on `slack alert-summary`: the visible session runs the
 * verb once to see the counted rows, composes the sentence itself with the same rows in front of it, and passes
 * it back in. {@link resolveAlertLead} is what stands between that free-form input and the card.
 *
 * ## Why a number in the SENTENCE is refused, and how that is not prose scanning
 *
 * A number the tally does not contain is the one failure this whole feature is built around: nobody reading
 * `roughly 500 fired` can tell whether it was counted or recalled, and it would sit directly above a table that
 * says otherwise. So {@link leadNumberRefusal} rejects a digit that is not already inside one of the row names. A
 * supplied sentence that fails this is DROPPED — the field is optional and its absence is visible, where a wrong
 * number is not.
 *
 * That check is deliberately a character class over a known set of strings, not a judgement about the prose. It
 * asks "does this contain a digit I cannot account for", which is shape. It has no opinion on wording, tone,
 * length of sentence, banned words or em-dashes — the owner rejected content blocking for this layer, and this is
 * not a way back to it. A row name that genuinely carries digits (`token refresh 401`, `5xx rate`) is allowed
 * through precisely because it IS accounted for.
 *
 * ## Length is cosmetic, so length is TRIMMED rather than refused
 *
 * Over-long is a different failure from wrong. The form caps `lead` at
 * {@link ALERT_SUMMARY_LEAD_VISIBLE_MAX} so the derived TL;DR provably fits, and an over-long sentence is cut at
 * that bound with a visible ellipsis. Dropping the send over four characters of prose would turn a cosmetic
 * problem into no summary at all — the same argument `alertSummary.ts` makes for trimming an index line rather
 * than failing it.
 */

import { ALERT_SUMMARY_LEAD_VISIBLE_MAX } from "../../outbound/artifact/alertSummary.js";
import type { AlertTallyRow } from "./alertTally.js";

/**
 * Whether a lead carries a digit the tally cannot account for.
 *
 * Row names are removed from a folded copy before the digit test, so a monitor whose own name contains digits can
 * be quoted. Implemented with literal `replaceAll` rather than a constructed pattern: a regex built from a row
 * name is a regex built from remote input, which is how a ReDoS gets into a program that had no reason to have
 * one — and this repo's lint bans exactly that.
 *
 * The row type is structural — anything carrying a `label` — so the rule has ONE implementation across
 * every card that renders its own counts beside an authored sentence. `datadog alert-digest` calls it with
 * its probe titles; a second copy of this test would be a second copy that drifts.
 *
 * @param lead the supplied sentence
 * @param rows the rows the card will render, whose names may legitimately carry digits
 * @returns why the sentence is refused, or undefined when it accounts for every digit
 */
export function leadNumberRefusal({
  lead,
  rows,
}: {
  lead: string;
  rows: readonly { readonly label: string }[];
}): string | undefined {
  const folded = rows.reduce((text, row) => text.replaceAll(row.label.toLowerCase(), " "), lead.toLowerCase());
  if (!/\d/.test(folded)) {
    return undefined;
  }
  return (
    "the sentence contains a number that is not part of any alert name. The card renders the real counts itself, " +
    "so a number here can only contradict them. Rewrite it with no digits at all, unless the digits are inside " +
    "an alert name exactly as given."
  );
}

/**
 * Collapse whitespace and cut to the form's cap with a VISIBLE ellipsis.
 *
 * The ellipsis is the point rather than the trimming: an elision a reader can see is a degrade they were told
 * about, which is the difference between this and the silent drop `../../outbound/strictForm.ts` exists to stop.
 *
 * @param lead the supplied sentence
 * @returns the sentence, whitespace-collapsed and at most `ALERT_SUMMARY_LEAD_VISIBLE_MAX` characters
 */
export function fitLead({ lead, max = ALERT_SUMMARY_LEAD_VISIBLE_MAX }: { lead: string; max?: number }): string {
  const collapsed = lead
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .join(" ");
  if (collapsed.length <= max) {
    return collapsed;
  }
  // One character of the budget is spent on the ellipsis, so the result lands ON the cap rather than one over it.
  return `${collapsed.slice(0, max - 1).trimEnd()}…`;
}

/** An attempt to include a lead: the sentence when one survives, plus anything worth telling the operator. */
export interface AlertLeadOutcome {
  /** The sentence, or undefined when none was supplied or it did not survive validation — `lead` is optional. */
  readonly lead?: string;
  /** Diagnostics for stderr. Never empty when `lead` is absent, so a missing sentence always has a stated reason. */
  readonly warnings: readonly string[];
}

/**
 * Validate an operator-supplied sentence against the tally, and fit it to the card.
 *
 * Never fails the caller. An absent `--lead`, an empty tally, a sentence carrying a number the tally cannot
 * account for — each produces no lead and (bar the plain-absent case) a warning, because the summary itself is
 * still worth sending and its numbers do not depend on this. That is the whole reason `lead` is optional in the
 * form.
 *
 * @param supplied the `--lead` text, or undefined when the operator gave none
 * @param rows the tallied rows, already counted
 * @param skipped how many messages were read without being recognised, which decides whether an empty
 *   `rows` is a quiet window or an unparsed one
 * @returns the sentence when one survives, plus any warnings
 */
export function resolveAlertLead({
  supplied,
  rows,
  skipped,
}: {
  supplied: string | undefined;
  rows: readonly AlertTallyRow[];
  skipped: number;
}): AlertLeadOutcome {
  if (supplied === undefined) {
    return { warnings: [] };
  }
  if (rows.length === 0 && skipped === 0) {
    // A window that held nothing at all needs no editorial read, and printing one invites a sentence about
    // nothing. The card already says `nothing fired.` in words the code chose.
    //
    // `skipped === 0` is load-bearing and was added with the change to `countSentence`
    // (`outbound/artifact/alertSummary.ts`). An empty `rows` with a non-zero `skipped` is NOT a quiet window
    // — it is a window whose every message went unrecognised, the card now says exactly that instead of
    // `nothing fired.`, and it is the one case where a human sentence has something to add that the code
    // cannot: WHY nothing parsed. Dropping the lead there would have been this branch telling the operator
    // the card says something it no longer says.
    return {
      warnings: [
        "a --lead sentence was supplied but nothing fired in this window, so it was dropped: the card already " +
          "says nothing fired, in words the code chose.",
      ],
    };
  }
  // Everything past here falls through to the ordinary number check, INCLUDING the nothing-recognised window.
  // That is deliberate rather than an omission: `leadNumberRefusal` is handed the same empty `rows`, so a
  // sentence quoting a figure is unaccountable and gets refused exactly as it would with rows present, while
  // a sentence saying why nothing parsed survives. One path, not a second copy of it.
  const refusal = leadNumberRefusal({ lead: supplied, rows });
  if (refusal !== undefined) {
    return {
      warnings: [
        "the supplied --lead sentence was dropped, so the card goes out with its counts and no prose read. The " +
          `card is still correct — the numbers never came from the sentence. Why: ${refusal}`,
      ],
    };
  }
  return { lead: fitLead({ lead: supplied }), warnings: [] };
}
