/**
 * Where an atlas's two channels disagree about a PAGE — an OUTPUT, never a build-time check.
 *
 * Owner's ruling, `docs/atlas-intent/04-corroboration.md`: corroboration between the API and the browser is a thing the
 * atlas SHOWS, both records are kept regardless, and which surface wins when they differ is the owner's call once
 * the owner can see real instances. So this module reports the instances and resolves none of them.
 *
 * ## Why this is kit-owned rather than each atlas's own
 *
 * The comparison is identical wherever a `page` kind carries a declared address on one channel and a
 * witness on the other, and it had been written twice — once by the GraphQL Hive atlas and once, by copying
 * it, by the WorkOS atlas. That is the same family `kit/projection.ts` and `kit/withheld.ts` are in and the
 * same argument closes it: a shape that regenerates through ordinary careful work, because the next atlas's
 * author opens whichever sibling they find first. What a platform still owns is which entities are pages
 * and what its walk writes into `unreachableBecause`; neither is here.
 *
 * ## The three findings, each a different sentence
 *
 * - **declared and unwitnessed** — the atlas knows the address and no browser has ever landed on it. On an
 *   install whose browser surface has never been filled this is every page, which is why it is reported as
 *   a count with a cause rather than as a per-page finding.
 * - **declared and unreachable** — a walk tried and could not open it. This is the one a reader acts on:
 *   either the route no longer exists, or the account's role does not reach it, and the walk's own reason
 *   says which.
 * - **witnessed and undeclared** — the walk landed somewhere the atlas's route table does not name. That is
 *   the most interesting of the three, because it is the browser showing something the API's own view of
 *   the account could not have produced.
 */

import { unsetFieldAsNull } from "#lib/absent.js";

/** What one channel contributed about one page, reduced to what the comparison actually reads. *
 * @internal
 */
export interface AtlasPageChannelView {
  readonly detail: unknown;
  readonly source: { readonly deepLink: string | null } | null;
}

/** One page entity, reduced to what the comparison actually reads. *
 * @internal
 */
export interface AtlasPageEntity {
  readonly providerId: string;
  readonly declared: AtlasPageChannelView | null;
  readonly witnessed: AtlasPageChannelView | null;
}

/** Which of the three findings one page produced. */
type AtlasPageFinding = "declared-and-unwitnessed" | "declared-and-unreachable" | "witnessed-and-undeclared";

/** One page the two channels do not agree about. */
export interface AtlasPageDisagreement {
  readonly providerId: string;
  readonly finding: AtlasPageFinding;
  /** The address, from whichever channel holds one. */
  readonly url: string | null;
  /** What the disagreeing channel said, when it said anything. */
  readonly reason: string | null;
}

/** Every disagreement one generation holds, plus the counts a reader needs to size them. */
export interface AtlasPageDisagreementReport {
  readonly declaredCount: number;
  readonly witnessedCount: number;
  readonly disagreements: readonly AtlasPageDisagreement[];
}

/** A page's address: the declared channel's own link when it carries one, else the one a walk witnessed. */
function pageUrl({ page }: { page: AtlasPageEntity }): string | null {
  const declared = page.declared?.source?.deepLink;
  if (declared == null) {
    return unsetFieldAsNull({ key: "deepLink", record: page.witnessed?.source });
  }
  return declared;
}

/**
 * Compare the two channels across every page.
 *
 * @param pages every page the generation holds, each reduced to its two channel views
 * @param unwitnessedReason what to say about a page no walk has landed on — the platform's own wording,
 *   because "console" and "dashboard" are its vocabulary rather than the kit's
 * @returns the counts and every disagreement, sorted by provider id so a printed report is stable
 */
export function atlasPageDisagreementReport({
  pages,
  unwitnessedReason,
}: {
  pages: readonly AtlasPageEntity[];
  unwitnessedReason: string;
}): AtlasPageDisagreementReport {
  const disagreements: AtlasPageDisagreement[] = [];
  let declaredCount = 0;
  let witnessedCount = 0;
  for (const page of pages) {
    if (page.declared !== null) {
      declaredCount += 1;
    }
    if (page.witnessed !== null) {
      witnessedCount += 1;
    }
    const finding = findingFor({ declared: page.declared !== null, witnessed: page.witnessed });
    if (finding === null) {
      continue;
    }
    disagreements.push({
      finding,
      providerId: page.providerId,
      reason: page.witnessed === null ? unwitnessedReason : unreachableBecause({ witnessed: page.witnessed }),
      url: pageUrl({ page }),
    });
  }
  return {
    declaredCount,
    disagreements: disagreements.toSorted((left, right) => left.providerId.localeCompare(right.providerId)),
    witnessedCount,
  };
}

/**
 * Which finding, if any, one page's two channels produce.
 *
 * @param declared whether the API channel published an address for it
 * @param witnessed the browser channel's own view, or `null` when no walk has seen it
 * @returns the finding, or `null` when the two channels agree or neither holds a view to compare
 */
function findingFor({
  declared,
  witnessed,
}: {
  declared: boolean;
  witnessed: AtlasPageChannelView | null;
}): AtlasPageFinding | null {
  if (!declared) {
    return witnessed === null ? null : "witnessed-and-undeclared";
  }
  if (witnessed === null) {
    return "declared-and-unwitnessed";
  }
  return unreachableBecause({ witnessed }) === null ? null : "declared-and-unreachable";
}

/**
 * What the walk said about a page it could not open.
 *
 * Read off the channel's opaque detail rather than a typed field, because the detail shape is the
 * platform's and this module deliberately holds none of them.
 *
 * @param witnessed the browser channel's own view
 * @returns the reason, or `null` when the walk opened the page
 */
function unreachableBecause({ witnessed }: { witnessed: AtlasPageChannelView }): string | null {
  const detail = witnessed.detail;
  if (typeof detail !== "object" || detail === null || !("unreachableBecause" in detail)) {
    return null;
  }
  const reason = detail.unreachableBecause;
  return typeof reason === "string" && reason.length > 0 ? reason : null;
}
