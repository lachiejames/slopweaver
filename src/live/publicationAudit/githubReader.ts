/**
 * The publication audit's GitHub door: every pull request, issue, comment, review and review comment on one
 * repository, read back as it stands now through the same doored listings `github exposure` reads.
 *
 * ## Why the whole repository, not a ledger of the fleet's own pull requests
 *
 * Once the repository is public, everything on it is published — the fleet's text and anybody's reply quoting it —
 * so the surface to audit is the repository's threads, not whichever objects a ledger happened to record. It also
 * means a pull request opened before any ledger existed is covered like any other.
 *
 * ## Reuse, not a second reader
 *
 * The listings are `../github/exposureListing.ts`'s `listAll` over `../github/exposureModel.ts`'s closed GET table,
 * and the fields judged per item are exactly `../github/exposureTexts.ts`'s: one table decides what text a GitHub
 * object publishes. What this module adds is the object's coordinates and its canonical address (`html_url`,
 * checked against the repository's own shape).
 *
 * ## A partial read is never clean
 *
 * A failed page, a page ceiling or a total larger than what was listed is a fixed gap label, and any gap makes the
 * door `partial`. Uploaded files are counted and never fetched: a text check cannot judge an image, so they are
 * reported as not swept rather than as clean. No provider error body is kept — a gap is its listing and its ending.
 */
import { isRecord } from "../../lib/parsers.js";
import { type GithubExposureListing, type GithubExposureSeam, listAll, numberAt } from "../github/exposureListing.js";
import type { GithubExposureCallId } from "../github/exposureModel.js";
import { githubExposureTexts } from "../github/exposureTexts.js";
import { referencedUploads } from "../github/exposureUploads.js";

import type { PublicationDoorCoverage, PublishedText } from "./types.js";

/** Full pages one listing reads before it reports a ceiling — the exposure inventory's own bound. */
const PUBLICATION_GITHUB_MAX_PAGES = 30;

/** The listings this door reads, each with the coordinate prefix its objects are keyed under. */
const LISTED_CALLS = [
  { call: "pulls", key: "pull", keyField: "number", state: true },
  { call: "issues", key: "issue", keyField: "number", state: true },
  { call: "issue-comments", key: "issue-comment", keyField: "id", state: false },
  { call: "review-comments", key: "review-comment", keyField: "id", state: false },
] as const satisfies readonly {
  readonly call: GithubExposureCallId;
  readonly key: string;
  readonly keyField: "number" | "id";
  readonly state: boolean;
}[];

/** What one GitHub read of the audit produced: the texts to judge, and how much of the door it covered. */
export interface GithubPublicationRead {
  readonly texts: readonly PublishedText[];
  readonly coverage: PublicationDoorCoverage;
}

/**
 * The shape a canonical address on this repository takes: a pull request or an issue, optionally anchored on one
 * comment, review or review comment.
 *
 * @param owner the repository owner
 * @param repo the repository name
 * @returns the anchored pattern
 */
function canonicalLinkPattern({ owner, repo }: { owner: string; repo: string }): RegExp {
  const escape = ({ value }: { value: string }): string => value.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(
    `^https://github\\.com/${escape({ value: owner })}/${escape({ value: repo })}/(?:pull|issues)/\\d+(?:#(?:issuecomment-|pullrequestreview-|discussion_r)\\d+)?$`,
    "u",
  );
}

/**
 * The fixed labels one listing's ending contributes as gaps — never the provider's message.
 *
 * @param listing the listing and how it ended
 * @param label the listing's call id
 * @returns one label per gap, none for a complete listing that matched GitHub's own total
 */
export function githubListingGapLabels({
  listing,
  label,
}: {
  listing: GithubExposureListing;
  label: string;
}): readonly string[] {
  if (listing.outcome === "failed") {
    return [`${label}: read failed`];
  }
  if (listing.outcome === "ceiling") {
    return [`${label}: page ceiling`];
  }
  if (listing.totalCount !== undefined && listing.totalCount > listing.items.length) {
    return [`${label}: fewer listed than GitHub reports`];
  }
  return [];
}

/**
 * The published texts of one listed item, keyed and linked.
 *
 * @returns the texts, empty for an item with no text field or no coordinate; `unlinked` when the item has no
 *   coordinate or its address did not match the repository's shape — judged whether or not it carries text, because
 *   a malformed item that reads as textless must make the door partial, never complete — in which case the
 *   repository's own address stands in
 */
function itemTexts({
  call,
  params,
  item,
  key,
  keyField,
  linkPattern,
  repositoryLink,
}: {
  call: GithubExposureCallId;
  params: Readonly<Record<string, string | number>>;
  item: unknown;
  key: string;
  keyField: "number" | "id";
  linkPattern: RegExp;
  repositoryLink: string;
}): { readonly texts: readonly PublishedText[]; readonly unlinked: boolean } {
  const coordinate = numberAt({ path: [keyField], value: item });
  const htmlUrl = isRecord(item) ? item["html_url"] : undefined;
  const linked = coordinate !== undefined && typeof htmlUrl === "string" && linkPattern.test(htmlUrl);
  const pieces = githubExposureTexts({ call, data: [item], params });
  if (coordinate === undefined || pieces.length === 0) {
    return { texts: [], unlinked: !linked };
  }
  const link = linked ? htmlUrl : repositoryLink;
  const objectKey = `${key} ${String(coordinate)}`;
  return {
    // Both the canonical shape and the repository address stand in for it carry no free text but the own address.
    texts: pieces.map((piece) => ({
      door: "github" as const,
      field: piece.field,
      link,
      linkCarriesNoText: true,
      objectKey,
      text: piece.text,
    })),
    unlinked: !linked,
  };
}

/** Where one repository's objects link: its canonical address shape, and the address that stands in off it. */
interface RepositoryLinks {
  readonly linkPattern: RegExp;
  readonly repositoryLink: string;
}

/** One listing's items as texts: each object's texts, the keys of the objects that had any, and how many were unlinked. */
interface CollectedItems {
  readonly texts: readonly PublishedText[];
  readonly objectKeys: readonly string[];
  readonly unlinked: number;
}

/** Every item of one listing, as its texts, keyed and linked. */
function collectItems({
  call,
  params,
  items,
  key,
  keyField,
  links,
}: {
  call: GithubExposureCallId;
  params: Readonly<Record<string, string | number>>;
  items: readonly unknown[];
  key: string;
  keyField: "number" | "id";
  links: RepositoryLinks;
}): CollectedItems {
  const texts: PublishedText[] = [];
  const objectKeys: string[] = [];
  let unlinked = 0;
  for (const item of items) {
    const read = itemTexts({ call, item, key, keyField, params, ...links });
    if (read.texts.length > 0) {
      objectKeys.push(read.texts[0]!.objectKey);
      texts.push(...read.texts);
    }
    if (read.unlinked) {
      unlinked += 1;
    }
  }
  return { objectKeys, texts, unlinked };
}

/** Every pull request number a `pulls` listing carries, in order. */
function pullNumbersOf({ items }: { items: readonly unknown[] }): readonly number[] {
  return items.flatMap((item) => {
    const number = numberAt({ path: ["number"], value: item });
    return number === undefined ? [] : [number];
  });
}

/**
 * Every review on each listed pull request, one listing per pull request, with one gap counting those not fully read.
 */
async function readPullReviews({
  seam,
  base,
  pullNumbers,
  maxPages,
  links,
}: {
  seam: GithubExposureSeam;
  base: { readonly owner: string; readonly repo: string };
  pullNumbers: readonly number[];
  maxPages: number;
  links: RepositoryLinks;
}): Promise<{ readonly collected: readonly CollectedItems[]; readonly gaps: readonly string[] }> {
  const collected: CollectedItems[] = [];
  let reviewFailures = 0;
  for (const pullNumber of pullNumbers) {
    const params = { ...base, pull_number: pullNumber };
    const listing = await listAll({ call: "pull-reviews", maxPages, params, seam });
    if (githubListingGapLabels({ label: "pull-reviews", listing }).length > 0) {
      reviewFailures += 1;
    }
    collected.push(
      collectItems({ call: "pull-reviews", items: listing.items, key: "review", keyField: "id", links, params }),
    );
  }
  if (reviewFailures === 0) {
    return { collected, gaps: [] };
  }
  return { collected, gaps: [`pull-reviews: ${String(reviewFailures)} pull request(s) not fully read`] };
}

/**
 * Read every published thread on one repository.
 *
 * @param seam the doored GitHub read seam (`../github/exposureRead.ts` in production, plain functions in a test)
 * @param owner the repository owner
 * @param repo the repository name
 * @param maxPages full pages per listing before a ceiling is reported
 * @returns the texts to judge and the door's coverage
 */
export async function readGithubPublications({
  seam,
  owner,
  repo,
  maxPages = PUBLICATION_GITHUB_MAX_PAGES,
}: {
  seam: GithubExposureSeam;
  owner: string;
  repo: string;
  maxPages?: number;
}): Promise<GithubPublicationRead> {
  const base = { owner, repo };
  const links = {
    linkPattern: canonicalLinkPattern({ owner, repo }),
    repositoryLink: `https://github.com/${owner}/${repo}`,
  };
  const collected: CollectedItems[] = [];
  const gaps: string[] = [];
  let pullNumbers: readonly number[] = [];
  for (const listed of LISTED_CALLS) {
    const params = listed.state ? { ...base, state: "all" } : base;
    const listing = await listAll({ call: listed.call, maxPages, params, seam });
    gaps.push(...githubListingGapLabels({ label: listed.call, listing }));
    const { call, key, keyField } = listed;
    collected.push(collectItems({ call, items: listing.items, key, keyField, links, params }));
    if (call === "pulls") {
      pullNumbers = pullNumbersOf({ items: listing.items });
    }
  }
  const reviews = await readPullReviews({ base, links, maxPages, pullNumbers, seam });
  collected.push(...reviews.collected);
  gaps.push(...reviews.gaps);
  const unlinked = collected.reduce((sum, one) => sum + one.unlinked, 0);
  if (unlinked > 0) {
    gaps.push(`${String(unlinked)} object(s) without a canonical address`);
  }
  const texts = collected.flatMap((one) => one.texts);
  const objects = new Set(collected.flatMap((one) => one.objectKeys));
  const attachmentsNotSwept = referencedUploads({ texts: texts.map((piece) => piece.text) }).length;
  if (attachmentsNotSwept > 0) {
    gaps.push(`${String(attachmentsNotSwept)} uploaded file(s) not read`);
  }
  return {
    coverage: {
      attachmentsNotSwept,
      door: "github",
      gaps,
      objects: objects.size,
      state: gaps.length === 0 ? "complete" : "partial",
      texts: texts.length,
    },
    texts,
  };
}
