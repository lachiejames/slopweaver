/**
 * What `slopweaver handover register` prints once a row is on the board: the receipt line a caller watches for, and
 * every warning that needs the author's hand; `--full` adds where the row landed and how to settle it. Split out of
 * `./askRowRun.ts` under the file-size ratchet.
 */

import type { RegisterOut } from "./askRowRun.js";

/**
 * Say that a row registered with no `--repo` is held. Not a refusal: `recipe`'s dead-letter finding and the
 * console's relayed steer both register with no repo on purpose. But no verb can SEAT such a row, so the
 * reconciliation holds it, and the one moment to say so is while the author still has the row in hand.
 */
function heldForRepoLine({ slug }: { slug: string }): string {
  return (
    "  no --repo: `cmux spawn` cannot seat this row, so it is held rather than ready until: " +
    `slopweaver handover set-repo ${slug} --repo <checkout>`
  );
}

/**
 * The first receipt line a registration prints — written ONLY by the invocation whose `createRowDoc` just created the
 * doc, from inside the board lock, so a caller watching its own `out` for this line knows its call created the row
 * (`incident detect` decides `created` against `already-existed` this way, race-safe).
 *
 * @param slug the row that was written
 * @returns the line
 */
export function registeredReceiptLine({ slug }: { slug: string }): string {
  return `handover register: ${slug} is on the board`;
}

/**
 * What a registered row prints. By default the receipt line, then only what needs the author's hand: its finding
 * origin, whether it is held for a repo, whether it is unplaced. `--full` adds where it was written and how to
 * settle it, in the order they always printed.
 *
 * MEASURED over 81 supervisor passes (`slopweaver transcripts draw --session <id>` per chair, page
 * `$SLOPWEAVER_HOME/pages/chair-token-waste/index.html`): 1.0 registers a pass returning a mean 426 tokens, about
 * 16,000 carried a pass, because every later model call that pass reads them again.
 *
 * @param full whether `--full` was passed
 * @param slug the row that was written
 * @param path where it was written
 * @param observedBy the session a finding row names as its observer, undefined for any other row
 * @param held whether the row names no repo, so `cmux spawn` cannot seat it yet
 * @param unplaced whether the row states no workspace, so unless a pull request or Slack destination it names places
 *   it, only the self Queue view shows it, marked placed by default
 * @returns the lines, the receipt first
 */
export function registeredReceiptLines({
  full,
  slug,
  path,
  observedBy,
  held,
  unplaced,
}: {
  full: boolean;
  slug: string;
  path: string;
  observedBy: string | undefined;
  held: boolean;
  unplaced: boolean;
}): readonly string[] {
  const lines = [registeredReceiptLine({ slug })];
  if (full) {
    lines.push(`  ${path}`);
  }
  if (observedBy !== undefined) {
    lines.push(
      `  origin: a fleet finding observed by ${observedBy} — a team-facing door refuses it until ` +
        `the owner rules: slopweaver handover rule ${slug} --anchor <where> --words "<the owner's words>"`,
    );
  }
  if (held) {
    lines.push(heldForRepoLine({ slug }));
  }
  if (unplaced) {
    lines.push(
      "  no --workspace: unless a pull request or Slack destination it names places it, only the self Queue view " +
        "shows it, marked placed by default, until: " +
        `slopweaver handover set-workspace ${slug} --workspace team|self --because "<why>"`,
    );
  }
  if (full) {
    lines.push(
      `  settle it with: slopweaver handover settle ${slug} --as <state> --witness <value> [--card done|recut|kept]`,
    );
  }
  return lines;
}

/**
 * Print what a registered row prints — {@link registeredReceiptLines}, one `out` call a line.
 *
 * @param out where the lines go — stdout for the verb, stderr when a `--json` caller owns stdout
 */
export function printRegistered({
  out,
  ...receipt
}: {
  full: boolean;
  slug: string;
  path: string;
  observedBy: string | undefined;
  held: boolean;
  unplaced: boolean;
  out: RegisterOut;
}): void {
  for (const line of registeredReceiptLines(receipt)) {
    out({ line });
  }
}
