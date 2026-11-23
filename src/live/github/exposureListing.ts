/**
 * The read seam `github exposure` runs over, the one pagination loop, and the reduction of listings to a state.
 *
 * Pagination is where a false all-clear is born: a page ceiling read as the end, a failed page read as an empty
 * one, a `total_count` larger than what was listed. Every one of those becomes `partial` or `read-failed` here,
 * in one function, so no surface can reduce its own listing to `counted` by a different rule.
 */

import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import {
  GITHUB_EXPOSURE_CALLS,
  GITHUB_EXPOSURE_UNPAGED_CALLS,
  type GithubExposureCallId,
  type GithubExposureReadFailure,
  type GithubExposureState,
} from "./exposureModel.js";

/** GitHub's own per-page maximum, asked for on every listing. */
const EXPOSURE_PAGE_SIZE = 100;

/** The REST and GraphQL reads the inventory makes; a test passes plain functions. */
export interface GithubExposureSeam {
  readonly get: (args: {
    readonly call: GithubExposureCallId;
    readonly params: Readonly<Record<string, string | number>>;
  }) => Promise<Result<unknown, GithubExposureReadFailure>>;
  readonly graphql: (args: {
    readonly query: string;
    readonly variables: Readonly<Record<string, string>>;
  }) => Promise<Result<unknown, GithubExposureReadFailure>>;
}

/**
 * Wrap a seam so every REST and GraphQL read made through it is counted, for a report's read total.
 *
 * @returns the counting seam, and the number of reads it has forwarded so far
 */
export function countingSeam({ seam }: { seam: GithubExposureSeam }): {
  seam: GithubExposureSeam;
  calls: () => number;
} {
  let calls = 0;
  return {
    calls: () => calls,
    seam: {
      get: (args) => {
        calls += 1;
        return seam.get(args);
      },
      graphql: (args) => {
        calls += 1;
        return seam.graphql(args);
      },
    },
  };
}

/** Every item one listing collected, and how the listing ended. */
export type GithubExposureListing =
  | { readonly outcome: "complete"; readonly items: readonly unknown[]; readonly totalCount: number | undefined }
  | { readonly outcome: "ceiling"; readonly items: readonly unknown[]; readonly pages: number }
  | { readonly outcome: "failed"; readonly items: readonly unknown[]; readonly failure: GithubExposureReadFailure };

/**
 * The array one page carried, under the call's wrapper key when it has one.
 *
 * @param call which listing the page answers
 * @param data the page as GitHub answered it
 * @returns the page's items and GitHub's own total when it reports one, or why the page was not a listing
 */
export function pageItems({
  call,
  data,
}: {
  call: GithubExposureCallId;
  data: unknown;
}): Result<{ items: readonly unknown[]; totalCount: number | undefined }, GithubExposureReadFailure> {
  const { itemsKey } = GITHUB_EXPOSURE_CALLS[call];
  if (itemsKey === undefined) {
    return Array.isArray(data)
      ? ok({ items: data, totalCount: undefined })
      : err({ message: `${call}: the page was not a list`, status: undefined });
  }
  if (!isRecord(data) || !Array.isArray(data[itemsKey])) {
    return err({ message: `${call}: the page carried no \`${itemsKey}\` list`, status: undefined });
  }
  const total = data["total_count"];
  return ok({ items: data[itemsKey], totalCount: typeof total === "number" ? total : undefined });
}

/**
 * Read every page of one listing, up to a ceiling, and say how it ended.
 *
 * A page shorter than {@link EXPOSURE_PAGE_SIZE} is the end. Reaching `maxPages` full pages is a `ceiling`, never
 * `complete`, and a failed page keeps every item already read.
 *
 * @param seam the read seam
 * @param call which listing
 * @param params the route's path and query parameters, less paging
 * @param maxPages how many full pages to read before reporting a ceiling
 * @returns the collected items and the ending
 */
export async function listAll({
  seam,
  call,
  params,
  maxPages,
}: {
  seam: GithubExposureSeam;
  call: GithubExposureCallId;
  params: Readonly<Record<string, string | number>>;
  maxPages: number;
}): Promise<GithubExposureListing> {
  const items: unknown[] = [];
  let totalCount: number | undefined;
  if (GITHUB_EXPOSURE_UNPAGED_CALLS.has(call)) {
    const whole = (await seam.get({ call, params })).andThen((data) => pageItems({ call, data }));
    if (whole.isErr()) {
      return { failure: whole.error, items, outcome: "failed" };
    }
    return { items: whole.value.items, outcome: "complete", totalCount: whole.value.totalCount };
  }
  for (let page = 1; page <= maxPages; page += 1) {
    const read = await seam.get({ call, params: { ...params, page, per_page: EXPOSURE_PAGE_SIZE } });
    const parsed = read.andThen((data) => pageItems({ call, data }));
    if (parsed.isErr()) {
      return { failure: parsed.error, items, outcome: "failed" };
    }
    items.push(...parsed.value.items);
    totalCount = parsed.value.totalCount;
    if (parsed.value.items.length < EXPOSURE_PAGE_SIZE) {
      return { items, outcome: "complete", totalCount };
    }
  }
  return { items, outcome: "ceiling", pages: maxPages };
}

/**
 * Why one listing did not establish a complete count.
 *
 * @param listing the listing and how it ended
 * @param label the surface or listing the gap names
 * @returns each gap, or none when the listing was complete and matched GitHub's own total
 */
export function listingGaps({ listing, label }: { listing: GithubExposureListing; label: string }): readonly string[] {
  if (listing.outcome === "failed") {
    const status = listing.failure.status === undefined ? "" : ` (${String(listing.failure.status)})`;
    return [
      `${label}: a read failed after ${String(listing.items.length)} item(s)${status}: ${listing.failure.message}`,
    ];
  }
  if (listing.outcome === "ceiling") {
    return [`${label}: stopped at the ${String(listing.pages)}-page ceiling`];
  }
  if (listing.totalCount !== undefined && listing.totalCount > listing.items.length) {
    return [`${label}: GitHub reports ${String(listing.totalCount)}, ${String(listing.items.length)} listed`];
  }
  return [];
}

/**
 * Reduce a surface's count and every gap behind it to one state.
 *
 * No gap is `counted`. A gap with nothing observed at all is `read-failed`; a gap with something observed is
 * `partial`, the count a lower bound.
 *
 * @param count the number observed
 * @param detail the safe one-line breakdown
 * @param gaps every reason the count is not exact
 * @param limits what the API itself cannot enumerate
 * @returns the surface's state
 */
export function surfaceState({
  count,
  detail,
  gaps,
  limits = [],
}: {
  count: number;
  detail: string;
  gaps: readonly string[];
  limits?: readonly string[];
}): GithubExposureState {
  if (gaps.length === 0) {
    return { count, detail, kind: "counted", limits };
  }
  if (count === 0) {
    return { detail, kind: "read-failed", why: gaps };
  }
  return { detail, kind: "partial", observedAtLeast: count, why: gaps };
}

/**
 * One string field of an unknown provider record, or undefined.
 *
 * @param value the record
 * @param path the keys to walk, outermost first
 * @returns the string at that path, or undefined when any step is absent or not the right type
 */
export function stringAt({ value, path }: { value: unknown; path: readonly string[] }): string | undefined {
  let cursor: unknown = value;
  for (const key of path) {
    if (!isRecord(cursor)) {
      return undefined;
    }
    cursor = cursor[key];
  }
  return typeof cursor === "string" ? cursor : undefined;
}

/**
 * One number field of an unknown provider record, or undefined.
 *
 * @param value the record
 * @param path the keys to walk, outermost first
 * @returns the number at that path, or undefined
 */
export function numberAt({ value, path }: { value: unknown; path: readonly string[] }): number | undefined {
  let cursor: unknown = value;
  for (const key of path) {
    if (!isRecord(cursor)) {
      return undefined;
    }
    cursor = cursor[key];
  }
  return typeof cursor === "number" ? cursor : undefined;
}
