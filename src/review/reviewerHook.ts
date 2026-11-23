/**
 * Who a pull request is on the hook with — the one answer per row the pull-request page groups and prints.
 *
 * Decided in a fixed order, first match wins:
 *
 * 1. a draft is `not-due`: nobody is asked on a draft;
 * 2. a stacked row is `not-due`: nobody is asked until its base lands;
 * 3. the owner's APPROVE of a suggested reviewer newer than the newest ask is `picked` — approving parks the ask and
 *    sends nothing, so the row reads "picked, no ask seen since" until an ask for it shows up in a later reading — "seen", because
 *    a reading that could not rule an ask out has not seen one either;
 * 4. an ask trail is `asked`, and its primary is the newest ask's first recipient — the exact person the
 *    bump verdict judged (`./askTrail.ts`);
 * 5. Slack answering `no` is `nobody-asked` — the ONLY way to that word, because the verb says `no` only
 *    over a window that can carry an absence;
 * 6. anything else is `unknown`, carrying the verb's own reason.
 *
 * Pure.
 */
import type { LandingAsk } from "./askTrail.js";
import type { BumpVerdict } from "./cadence.js";
import type { ReviewerReadingRow } from "./reviewerReading.js";
import type { ReviewerPickRow } from "./reviewerRegister.js";

/** Who one pull request is on the hook with. */
export type ReviewHook =
  | { readonly kind: "not-due"; readonly why: "draft" | "stacked" }
  | { readonly kind: "picked"; readonly reviewer: string; readonly atIso: string }
  | {
      readonly kind: "asked";
      /** The newest ask's first recipient — who a chase is judged against. */
      readonly primary: string;
      readonly newest: LandingAsk;
      readonly asks: number;
      readonly bump: BumpVerdict | undefined;
    }
  | { readonly kind: "nobody-asked" }
  | { readonly kind: "unknown"; readonly why: string };

/**
 * `owner/repo#number` — the key the register and the hook share.
 *
 * @returns the key
 */
export function prKeyOfRow({ row }: { row: Pick<ReviewerReadingRow, "repoSlug" | "number"> }): string {
  return `${row.repoSlug}#${String(row.number)}`;
}

/**
 * The latest pick recorded on one pull request, whatever its verdict.
 *
 * @param picks every pick the register holds
 * @returns the latest, or `undefined` when there is none
 */
function latestPickOn({
  prKey,
  picks,
}: {
  prKey: string;
  picks: readonly ReviewerPickRow[];
}): ReviewerPickRow | undefined {
  let latest: ReviewerPickRow | undefined;
  for (const pick of picks) {
    if (pick.prKey === prKey && (latest === undefined || pick.atIso >= latest.atIso)) {
      latest = pick;
    }
  }
  return latest;
}

/**
 * The hook for one row.
 *
 * @param row the row as the last reading carried it
 * @param picks every pick the register holds, on any pull request
 * @returns the hook
 */
export function reviewHookOf({
  row,
  picks,
}: {
  row: ReviewerReadingRow;
  picks: readonly ReviewerPickRow[];
}): ReviewHook {
  if (row.draft) {
    return { kind: "not-due", why: "draft" };
  }
  if (row.stacked) {
    return { kind: "not-due", why: "stacked" };
  }
  const trail = row.askTrail;
  const newest = trail?.[0];
  const pick = latestPickOn({ picks, prKey: prKeyOfRow({ row }) });
  if (pick?.verdict === "approve" && (newest === undefined || pick.atIso > newest.atIso)) {
    return { atIso: pick.atIso, kind: "picked", reviewer: pick.reviewer };
  }
  if (trail !== undefined && newest !== undefined) {
    const primary = newest.recipients[0];
    if (primary !== undefined) {
      return { asks: trail.length, bump: row.bump, kind: "asked", newest, primary };
    }
  }
  if (row.askTrail === undefined) {
    return { kind: "unknown", why: "this reading predates the ask trail" };
  }
  if (row.slackAsked === "no") {
    return { kind: "nobody-asked" };
  }
  if (row.slackWhy.trim() === "") {
    return { kind: "unknown", why: "the verb did not say why" };
  }
  return { kind: "unknown", why: row.slackWhy };
}
