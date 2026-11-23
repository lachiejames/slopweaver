/**
 * Withdrawing a screenshot claim from two declared pages that photographed the same bytes.
 *
 * ## The failure this exists to prevent, and it shipped once
 *
 * Artifacts are content-addressed, so two identical pictures share one file. That is correct storage and a
 * silent disaster for a coverage claim: MEASURED, the Notion walk's first run reported every declared
 * page reached AND photographed, and every one of those screenshots was the same not-found shell. Nothing in
 * the walk noticed, because each page really did produce a verified PNG.
 *
 * Two declared pages cannot legitimately be the same picture. Either the client rendered the same view for
 * both — in which case at most one of them is the page that was asked for — or the walk photographed
 * something that is not the page at all. Either way the shots evidence nothing, so BOTH lose the claim and
 * each raises its own gap rather than one of them being picked as the winner.
 *
 * ## Why the reason is the caller's
 *
 * A platform knows what its own duplicate shots MEAN and a shared helper does not. On a signed-out Docker
 * Hub every gated route renders one sign-in page; on Notion it was a not-found shell. The count is the same
 * check and the sentence is not, so the sentence is passed in.
 */

/**
 * The minimum this check needs of one page observation.
 *
 * @internal
 */
export interface ShotBearingPage {
  readonly artifacts: readonly { readonly sha256: string }[];
}

/**
 * Withdraw the screenshot claim from every page whose picture is byte-identical to another page's.
 *
 * @param pages every declared page's observation
 * @param reason what a withdrawn claim says, in the caller's own words about its own platform
 * @param withdraw how the caller rebuilds one observation without its artifacts — the platform owns the
 *   shape, so it owns the rewrite
 * @returns the observations, with any indistinguishable screenshot claim withdrawn
 */
export function withdrawIndistinguishableShots<TPage extends ShotBearingPage>({
  pages,
  reason,
  withdraw,
}: {
  pages: readonly TPage[];
  reason: string;
  withdraw: (input: { page: TPage; reason: string }) => TPage;
}): readonly TPage[] {
  // Counted once per PAGE, not per artifact: one page carrying the same picture twice is not two pages
  // rendering the same view, and withdrawing it would punish a page no other page resembles.
  const digestCounts = new Map<string, number>();
  for (const page of pages) {
    for (const sha256 of new Set(page.artifacts.map((artifact) => artifact.sha256))) {
      // A digest no earlier page carried is on its first page.
      const seen = digestCounts.get(sha256);
      digestCounts.set(sha256, seen === undefined ? 1 : seen + 1);
    }
  }
  // Every digest any page carries was counted above, so each lookup here is present.
  return pages.map((page) =>
    page.artifacts.some((artifact) => digestCounts.get(artifact.sha256)! > 1) ? withdraw({ page, reason }) : page,
  );
}
