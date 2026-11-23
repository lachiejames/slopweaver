/**
 * Which of Google's 528 published APIs the Admin console atlas is compiled from, and — just as important —
 * which adjacent ones it is NOT.
 *
 * "Where do you stop" is the question every atlas of a vendor this large has to answer out loud, and an
 * answer that lives only in the pin list is an answer nobody can check. So the criterion is here, the
 * eleven it selects are pinned in `generated/discoveryLock.ts`, and the near misses are named below with
 * the reason each one failed — a rejected candidate recorded is a decision on the record; a rejected
 * candidate omitted is indistinguishable from one nobody thought of.
 *
 * ## The criterion, in one sentence
 *
 * > **Every OAuth scope the API declares, other than Google's generic `cloud-platform` catch-all, is an
 * > ADMINISTRATOR scope — one granted over the whole Workspace account by an administrator rather than by
 * > an end user over their own data.**
 *
 * It is computable from each document's own `auth.oauth2.scopes`, which is why it is the criterion rather
 * than a vibe about which console a product lives in. MEASURED over the whole Discovery index,
 * it selects TWELVE documents, and exactly one judgement is then applied on top of it to reach eleven:
 * `reseller.v1` is dropped, because `apps.order` is granted to a RESELLER administering somebody else's
 * Workspace account rather than to an administrator of this one, so the Admin console this atlas maps
 * never renders it.
 *
 * That one judgement is stated rather than folded into the criterion on purpose. A criterion bent until it
 * excludes the case you wanted excluded is a criterion that has stopped being checkable.
 *
 * ## Why the mixed-audience APIs are out, and what that costs
 *
 * `drivelabels` and `cloudsearch` each declare an administrator scope AND an end-user one, so each fails
 * the criterion on its second half. Both have a real settings page in the Admin console, so this is a
 * genuine cost rather than a clean win: it means the atlas maps neither the Drive label manager's API nor
 * Cloud Search's settings API. `gaps.ts` raises that as `adjacent-api-unmapped` rather than leaving it to
 * a reader to notice, and the fix — should the owner want it — is to widen the criterion HERE, not to bolt a
 * document onto the pin list.
 */

/**
 * One API the criterion considered and did not select, with why.
 * @internal
 */
export interface GoogleAdminAdjacentApi {
  /** The Discovery index's own `name` for it. */
  readonly api: string;
  /** Whether the Admin console renders a settings page for it — which is what makes a miss cost something. */
  readonly hasConsolePage: boolean;
  /** Why the criterion did not select it. */
  readonly reason: string;
}

/**
 * Every API this atlas considered and rejected, sorted by name.
 *
 * The list is the near misses rather than all 517 non-selections: an API is here when it declares at least
 * one administrator scope, or when its documentation link puts it under Google's own Workspace-admin tree.
 * Anything further out was never a candidate and listing it would bury the ones that were.
 */
export const GOOGLE_ADMIN_ADJACENT_APIS: readonly GoogleAdminAdjacentApi[] = [
  {
    api: "appsmarket",
    hasConsolePage: false,
    reason:
      "its one scope, `appsmarketplace.license`, is granted to a Marketplace app VENDOR checking who has licensed its own listing — not to an administrator of this account. `hasConsolePage` is false rather than true even though the console HAS a Marketplace-apps page: that page is administered through the selected `directory` and `chrome-management` documents, so missing this API costs the map nothing",
  },
  {
    api: "chromewebstore",
    hasConsolePage: false,
    reason:
      "`chromewebstore` scopes are granted to an extension PUBLISHER and its console is the Chrome Web Store developer dashboard, not admin.google.com",
  },
  {
    api: "cloudsearch",
    hasConsolePage: true,
    reason:
      "it declares the administrator scope `cloud_search.settings` alongside the end-user `cloud_search.query`, so it fails the every-scope half of the criterion. The Admin console's Cloud Search settings page is therefore unmapped on the API side",
  },
  {
    api: "drivelabels",
    hasConsolePage: true,
    reason:
      "it declares `drive.admin.labels` alongside the end-user `drive.labels`, so it fails the every-scope half of the criterion. The Admin console's Drive label manager is therefore unmapped on the API side",
  },
  {
    api: "gmailpostmastertools",
    hasConsolePage: false,
    reason:
      "its scopes are granted to a DOMAIN owner and its console is postmaster.google.com, a separate product with its own sign-in rather than a page of the Admin console",
  },
  {
    api: "reseller",
    hasConsolePage: false,
    reason:
      "every scope it declares is administrator-only, so it PASSES the computed criterion and is dropped by judgement: `apps.order` administers a customer account a reseller sells to, and this installation is a direct customer, so the Admin console it maps never renders a reseller page",
  },
];

/**
 * The criterion itself, as one line a descriptor and a gap can both quote.
 *
 * Exported rather than restated, because this sentence appears in the descriptor's `question`, in the
 * `adjacent-api-unmapped` gap and in the atlases documentation — three copies of a criterion is three
 * places for it to drift.
 */
export const GOOGLE_ADMIN_SELECTION_CRITERION =
  "every OAuth scope the API declares, other than Google's generic cloud-platform catch-all, is an administrator scope granted over the whole Workspace account rather than by an end user over their own data";

/**
 * The adjacent APIs whose miss actually costs the atlas a console page.
 *
 * `hasConsolePage` means "the console renders a page for this AND no selected document administers it",
 * not merely "a page exists" — `appsmarket` is the case that forces the distinction, and its row says so.
 *
 * @returns their names, sorted
 */
export function googleAdminUnmappedConsoleApis(): readonly string[] {
  return GOOGLE_ADMIN_ADJACENT_APIS.filter((candidate) => candidate.hasConsolePage)
    .map((candidate) => candidate.api)
    .toSorted();
}
