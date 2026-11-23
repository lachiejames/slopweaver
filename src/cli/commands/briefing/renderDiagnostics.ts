/**
 * WHAT THE OPERATOR READS AFTER A RENDER — the summary of what the gate measured, and every pull request
 * the projection held back.
 *
 * Its own module because neither line is part of building the page: both are read in a terminal by somebody
 * deciding whether the render did what they meant, and both exist because a gate that says nothing when it
 * passes is indistinguishable from one that never ran.
 */

import type { HeldBackPullRequest } from "../../../briefing/openPrCards.js";
import { cardsOfForm } from "../../../outbound/briefing/schemaWalk.js";
import type { BriefingForm } from "../../../outbound/briefing/types.js";

/**
 * The operator-facing summary of a render that succeeded.
 *
 * It names what the gate measured rather than saying "ok", because a gate that says nothing when it passes
 * is indistinguishable from a gate that never ran.
 *
 * @param form the validated form
 * @param destination where the page was written, or `stdout`
 * @returns the lines to print as diagnostics
 */
export function renderSummaryLines({
  form,
  destination,
}: {
  form: BriefingForm;
  destination: string;
}): readonly string[] {
  const folded = form.history.length + (form.earlierToday === undefined ? 0 : 1);
  const mine =
    form.yourList === undefined ? "no list of yours" : `${String(form.yourList.rows.length)} row(s) of yours`;
  const pending = form.awaiting.filter((artifact) => artifact.pending).length;
  // The index is reported by MARK, not as one number. An operator who reads "12 open pages" learns nothing
  // the owner could not count from the page; what the owner needs to see is how many of the twelve their own steer already
  // took out, since that is the arithmetic that matters.
  const index = form.reactNow.openArtifacts;
  const marked = ({ mark }: { mark: string }): number =>
    index.filter((artifact) => artifact.validity.mark === mark).length;
  return [
    `briefing render: ${mine}, ${String(cardsOfForm({ form }).length)} react-now card(s) ` +
      `(${String(form.reactNow.teamFacing.length)} team-facing, ${String(form.reactNow.meFacing.length)} yours), ` +
      `${String(pending)} artifact(s) directing you elsewhere, ` +
      `${String(form.recent.length)} recent block(s), ${String(folded)} folded section(s)`,
    // Emitted only when the page carries an index, so a run that was given no `--open-artifacts` prints what
    // it always printed rather than a line of three zeroes about a section it does not have.
    ...(index.length === 0
      ? []
      : [
          `${String(index.length)} open page(s) indexed: ${String(marked({ mark: "valid" }))} still valid, ` +
            `${String(marked({ mark: "partly-ruled" }))} partly ruled, ` +
            `${String(marked({ mark: "superseded" }))} superseded`,
        ]),
    `refreshed ${form.header.refreshedIso} · ready ${form.header.readyIso}`,
    `the page passes \`briefing check\`; written to ${destination}`,
  ];
}

/**
 * The diagnostics naming every pull request `--open-prs` held back, and why.
 *
 * One line per pull request rather than a count, because the operator's next question is always "which
 * one" — and nothing at all when none was held back, so a quiet render prints nothing it does not mean.
 *
 * @param heldBack what the projection left off the page
 * @returns the lines to print as diagnostics, empty when nothing was held back
 */
export function heldBackLines({ heldBack }: { heldBack: readonly HeldBackPullRequest[] }): readonly string[] {
  if (heldBack.length === 0) {
    return [];
  }
  return [
    `--open-prs held back ${String(heldBack.length)} pull request(s) the run says are already settled or not the owner's move:`,
    ...heldBack.map((one) => `  ${one.nativeId}: ${one.why}`),
  ];
}
