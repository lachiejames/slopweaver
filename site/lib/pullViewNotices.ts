/**
 * The header's diff-on-base notice, a body's picture count and the checks summary. Split out of `./pullView.ts`, which
 * re-exports every name here.
 */

import { shieldBadgeOf } from "./githubMarkdown";
import type { PullCheck, PullView } from "./pullViewTypes";

/** The header's line about whether the diff is already on its base, and the receipt it was read off. */
export interface PullDiffOnBaseNotice {
  readonly tone: "success" | "warning" | "muted";
  readonly text: string;
  /** The base tip and the instant it was checked; `undefined` when nothing was checked. */
  readonly receipt: { readonly shortOid: string; readonly checkedAtIso: string } | undefined;
}

/**
 * What the header says about the base, so the +/− the page draws against the merge base cannot read as the base's
 * own state. A merged pull request says nothing here: its state pill already does.
 *
 * @returns the line, or `undefined` for a merged pull request
 */
export function pullDiffOnBaseNotice({ view }: { view: PullView }): PullDiffOnBaseNotice | undefined {
  if (view.lifecycle === "merged") {
    return undefined;
  }
  const receipt = view.diffOnBase;
  if (receipt === undefined) {
    return {
      receipt: undefined,
      text: `Not checked whether this diff is already on ${view.baseRef}. This read predates that check`,
      tone: "muted",
    };
  }
  const base = receipt.baseRef;
  // No tip to name when the base was never read — only ever an `unknown`, which `diffOnBaseOf` enforces.
  let at: PullDiffOnBaseNotice["receipt"];
  if (receipt.baseOid !== null) {
    at = { checkedAtIso: receipt.checkedAtIso, shortOid: receipt.baseOid.slice(0, 7) };
  }
  switch (receipt.verdict) {
    case "on-base": {
      return {
        receipt: at,
        text: `Every change in this diff is already on ${base}. The diff below is against the branch's old merge base`,
        tone: "success",
      };
    }
    case "partly": {
      return { receipt: at, text: `Some of this diff is already on ${base}, not all of it`, tone: "warning" };
    }
    case "not-on-base": {
      return { receipt: at, text: `This diff is not on ${base} yet`, tone: "muted" };
    }
    case "unknown": {
      let why = "";
      if (receipt.reason !== undefined) {
        why = ` (${receipt.reason})`;
      }
      return { receipt: at, text: `Could not tell whether this diff is already on ${base}${why}`, tone: "muted" };
    }
    default: {
      const unreachable: never = receipt.verdict;
      return unreachable;
    }
  }
}

/** An `<img>` tag or a markdown image, the two ways a body embeds a picture, with its address when one is written. */
const PICTURE = /<img\b[^>]*?(?:\bsrc=["'](?<tagSrc>[^"']*)["'][^>]*)?>|!\[[^\]]*\]\((?<mdSrc>[^)\s]*)/giu;

/** The address one {@link PICTURE} match names: the tag's `src`, else the markdown target, else none. */
function pictureSrc({ match }: { match: RegExpMatchArray }): string | undefined {
  const tagSrc = match.groups?.["tagSrc"];
  if (tagSrc !== undefined) {
    return tagSrc;
  }
  return match.groups?.["mdSrc"];
}

/**
 * How many pictures a body embeds that the page does not draw — the console never fetches a remote one
 * (`./markdownSafety.ts`), so the page says how many it left on GitHub rather than dropping them without a word. A
 * static shields badge is drawn from its own address (`./githubMarkdown.ts`), so it is not one of them.
 *
 * @returns the count
 */
export function pictureCount({ body }: { body: string }): number {
  let count = 0;
  for (const match of body.matchAll(PICTURE)) {
    // A tag with no `src` draws nothing GitHub would either, but it is still a picture the body named.
    const src = pictureSrc({ match });
    if (src === undefined || shieldBadgeOf({ src }) === undefined) {
      count += 1;
    }
  }
  return count;
}

/** How GitHub groups a check's result: the icon it draws and the count it adds to. */
export type CheckKind = "failing" | "pending" | "skipped" | "successful";

/** The conclusions GitHub counts as failing. */
const FAILING = new Set(["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "STARTUP_FAILURE", "ACTION_REQUIRED"]);

/**
 * The group GitHub puts one check result in — a check run's conclusion, its status while it has none, or a commit
 * status's state.
 *
 * @param result the `PullCheck.result` the read carried
 * @returns its group
 */
export function checkKind({ result }: { result: string }): CheckKind {
  if (result === "SUCCESS" || result === "NEUTRAL") {
    return "successful";
  }
  if (result === "SKIPPED" || result === "STALE") {
    return "skipped";
  }
  if (FAILING.has(result)) {
    return "failing";
  }
  return "pending";
}

/**
 * The checks as GitHub's merge box sums them: a headline and the counts, in GitHub's order, each group with any.
 *
 * @returns the headline and the "3 failing, 100 successful" parts
 */
export function checkSummary({ items }: { items: readonly PullCheck[] }): {
  headline: string;
  counts: readonly string[];
} {
  const tally: Record<CheckKind, number> = { failing: 0, pending: 0, skipped: 0, successful: 0 };
  for (const check of items) {
    tally[checkKind({ result: check.result })] += 1;
  }
  let headline = "All checks have passed";
  if (tally.failing > 0) {
    headline = "Some checks were not successful";
  } else if (tally.pending > 0) {
    headline = "Some checks haven't completed yet";
  }
  const order: readonly CheckKind[] = ["failing", "pending", "skipped", "successful"];
  const counts = order.filter((kind) => tally[kind] > 0).map((kind) => `${String(tally[kind])} ${kind}`);
  return { counts, headline };
}
