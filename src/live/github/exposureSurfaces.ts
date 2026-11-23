/**
 * The single-surface readers `github exposure inventory` composes: one listing reduced to a surface, a listing fanned
 * out over parents and summed, and the surfaces the repository document decides (settings, discussions, Pages, the
 * wiki) or GitHub caps (the events feed). Each returns counts only.
 */

import { isRecord } from "../../lib/parsers.js";
import {
  type GithubExposureListing,
  type GithubExposureSeam,
  listAll,
  listingGaps,
  numberAt,
  stringAt,
  surfaceState,
} from "./exposureListing.js";
import {
  GITHUB_EXPOSURE_DISCUSSIONS_QUERY,
  type GithubExposureCallId,
  type GithubExposureSurfaceId,
  type GithubExposureSurfaceResult,
} from "./exposureModel.js";

/**
 * GitHub serves a repository's events feed to 300 events, three pages of 100. The cap is MEASURED on every run
 * rather than assumed: the read asks for one page past it, and only a refusal or an empty page there proves the
 * feed ended at GitHub's limit. A fourth full page means the cap moved, so the count is a lower bound again.
 * Repro: `slopweaver github exposure inventory --repo <owner/name> --json` on a repository with 300+ events.
 */
const EVENTS_API_CAP = 300;
const EVENTS_MAX_PAGES = 4;

/**
 * The `body` of every item that has one.
 *
 * @param items the listed items
 * @returns each body, in order
 */
export function bodiesOf({ items }: { items: readonly unknown[] }): readonly string[] {
  return items.flatMap((item) => {
    const body = stringAt({ path: ["body"], value: item });
    return body === undefined ? [] : [body];
  });
}

/**
 * A whole listing read and reduced to one surface.
 *
 * @param seam the read seam
 * @param surface the surface it counts
 * @param call which listing
 * @param params the route's parameters, less paging
 * @param maxPages the page ceiling
 * @param detail the one-line summary of what was listed
 * @returns the surface, and the listing for a caller that reads its items further
 */
export async function listedSurface({
  seam,
  surface,
  call,
  params,
  maxPages,
  detail,
}: {
  seam: GithubExposureSeam;
  surface: GithubExposureSurfaceId;
  call: GithubExposureCallId;
  params: Readonly<Record<string, string | number>>;
  maxPages: number;
  detail: (args: { items: readonly unknown[] }) => string;
}): Promise<{ result: GithubExposureSurfaceResult; listing: GithubExposureListing }> {
  const listing = await listAll({ call, maxPages, params, seam });
  const state = surfaceState({
    count: listing.items.length,
    detail: detail({ items: listing.items }),
    gaps: listingGaps({ label: surface, listing }),
  });
  return { listing, result: { state, surface } };
}

/**
 * A listing read once per parent (per pull request, per commit, per run), summed into one surface.
 *
 * `parentGaps` is why the PARENT list itself is incomplete: a sum over an incomplete set of parents is a lower
 * bound however completely each parent's own listing was read.
 *
 * @param seam the read seam
 * @param surface the surface it counts
 * @param call which listing, once per parent
 * @param parents each parent's route parameters
 * @param parentGaps why the parent list is incomplete, if it is
 * @param maxPages the page ceiling per parent
 * @param detail the one-line summary of what was listed
 * @returns the surface, and every item listed
 */
export async function fannedSurface({
  seam,
  surface,
  call,
  parents,
  parentGaps,
  maxPages,
  detail,
}: {
  seam: GithubExposureSeam;
  surface: GithubExposureSurfaceId;
  call: GithubExposureCallId;
  parents: readonly Readonly<Record<string, string | number>>[];
  parentGaps: readonly string[];
  maxPages: number;
  detail: (args: { items: readonly unknown[]; parents: number }) => string;
}): Promise<{ result: GithubExposureSurfaceResult; items: readonly unknown[] }> {
  const items: unknown[] = [];
  const gaps: string[] = parentGaps.map((gap) => `the parent list is incomplete: ${gap}`);
  for (const params of parents) {
    const listing = await listAll({ call, maxPages, params, seam });
    items.push(...listing.items);
    gaps.push(...listingGaps({ label: surface, listing }));
  }
  const state = surfaceState({ count: items.length, detail: detail({ items, parents: parents.length }), gaps });
  return { items, result: { state, surface } };
}

/**
 * Whether the repository document turns a feature on.
 *
 * @param repository the repository document
 * @param key the flag's field
 * @returns true only for a literal `true`
 */
function flagOn({ repository, key }: { repository: unknown; key: string }): boolean {
  return isRecord(repository) && repository[key] === true;
}

/** A string field's presence as one word, so the value itself is never printed. */
function setOrEmpty({ repository, key }: { repository: unknown; key: string }): string {
  const value = stringAt({ path: [key], value: repository });
  return value !== undefined && value.length > 0 ? "set" : "empty";
}

/** The visibility GitHub reported, or a word saying it reported none. */
function visibilityOf({ repository }: { repository: unknown }): string {
  const visibility = stringAt({ path: ["visibility"], value: repository });
  if (visibility === undefined) {
    return "unreported";
  }
  return visibility;
}

/**
 * The repository's own settings, as one safe line: flags and presence, never a value.
 *
 * @param repository the repository document
 * @returns the settings surface
 */
export function settingsResult({ repository }: { repository: unknown }): GithubExposureSurfaceResult {
  const onOff = ({ key }: { key: string }): string => (flagOn({ key, repository }) ? "on" : "off");
  const topics = isRecord(repository) && Array.isArray(repository["topics"]) ? repository["topics"].length : 0;
  const flags = `wiki ${onOff({ key: "has_wiki" })}, pages ${onOff({ key: "has_pages" })}, discussions ${onOff({ key: "has_discussions" })}, issues ${onOff({ key: "has_issues" })}`;
  const texts = `description ${setOrEmpty({ key: "description", repository })}, homepage ${setOrEmpty({ key: "homepage", repository })}, ${String(topics)} topic(s)`;
  return {
    state: surfaceState({
      count: 1,
      detail: `visibility ${visibilityOf({ repository })}; ${flags}; ${texts}`,
      gaps: [],
    }),
    surface: "repository-settings",
  };
}

/** The sum of the comment counts a discussions answer carried, and how many carried none. */
function discussionComments({ nodes }: { nodes: readonly unknown[] }): { comments: number; unreadable: number } {
  let comments = 0;
  let unreadable = 0;
  for (const node of nodes) {
    const count = numberAt({ path: ["comments", "totalCount"], value: node });
    if (count === undefined) {
      unreadable += 1;
    } else {
      comments += count;
    }
  }
  return { comments, unreadable };
}

/**
 * Discussions, from the one GraphQL read, or `not-enabled` from the repository's own flag.
 *
 * @param seam the read seam
 * @param owner the repository owner
 * @param repo the repository name
 * @param repository the repository document, whose flag decides whether discussions are read at all
 * @returns the discussions surface
 */
export async function discussionsResult({
  seam,
  owner,
  repo,
  repository,
}: {
  seam: GithubExposureSeam;
  owner: string;
  repo: string;
  repository: unknown;
}): Promise<GithubExposureSurfaceResult> {
  if (!flagOn({ key: "has_discussions", repository })) {
    return {
      state: { detail: "discussions are off in the repository settings", kind: "not-enabled" },
      surface: "discussions",
    };
  }
  const read = await seam.graphql({ query: GITHUB_EXPOSURE_DISCUSSIONS_QUERY, variables: { owner, repo } });
  const connection =
    read.isOk() && isRecord(read.value) && isRecord(read.value["repository"])
      ? read.value["repository"]["discussions"]
      : undefined;
  const total = numberAt({ path: ["totalCount"], value: connection });
  const nodes = isRecord(connection) && Array.isArray(connection["nodes"]) ? connection["nodes"] : undefined;
  if (read.isErr() || total === undefined || nodes === undefined) {
    const why = read.isErr() ? read.error.message : "the answer carried no discussions connection";
    return { state: surfaceState({ count: 0, detail: "discussions", gaps: [why] }), surface: "discussions" };
  }
  const { comments, unreadable } = discussionComments({ nodes });
  const gaps = [
    ...(total > nodes.length ? [`discussions: GitHub reports ${String(total)}, ${String(nodes.length)} read`] : []),
    ...(unreadable > 0 ? [`discussions: ${String(unreadable)} carried no comment count`] : []),
  ];
  return {
    state: surfaceState({
      count: total,
      detail: `${String(total)} discussion(s), ${String(comments)} comment(s) on those read`,
      gaps,
    }),
    surface: "discussions",
  };
}

/**
 * Pages: its configuration when on, and always the limit that the deployed bytes are not an API read.
 *
 * @param seam the read seam
 * @param owner the repository owner
 * @param repo the repository name
 * @param repository the repository document, whose flag decides whether Pages is read at all
 * @returns the Pages surface
 */
export async function pagesResult({
  seam,
  owner,
  repo,
  repository,
}: {
  seam: GithubExposureSeam;
  owner: string;
  repo: string;
  repository: unknown;
}): Promise<GithubExposureSurfaceResult> {
  if (!flagOn({ key: "has_pages", repository })) {
    return { state: { detail: "Pages is off in the repository settings", kind: "not-enabled" }, surface: "pages" };
  }
  const read = await seam.get({ call: "pages", params: { owner, repo } });
  const gaps = read.isErr() ? [`pages: ${read.error.message}`] : [];
  return {
    state: surfaceState({
      count: read.isOk() ? 1 : 0,
      detail: "Pages is on; its source is in the file history",
      gaps,
      limits: ["the deployed site's built bytes are not readable through the API"],
    }),
    surface: "pages",
  };
}

/**
 * The wiki, decided from the repository's own flag: on is out of the API's reach, off is not enabled.
 *
 * @param repository the repository document
 * @returns the wiki surface
 */
export function wikiResult({ repository }: { repository: unknown }): GithubExposureSurfaceResult {
  if (flagOn({ key: "has_wiki", repository })) {
    return {
      state: {
        detail: "the wiki is on; its pages are a separate git repository no REST read reaches",
        kind: "not-readable-by-api",
      },
      surface: "wiki",
    };
  }
  return { state: { detail: "the wiki is off in the repository settings", kind: "not-enabled" }, surface: "wiki" };
}

/**
 * The events feed, whose 300-event cap is GitHub's and so a limit, never a gap.
 *
 * @param seam the read seam
 * @param owner the repository owner
 * @param repo the repository name
 * @returns the events surface
 */
export async function eventsResult({
  seam,
  owner,
  repo,
}: {
  seam: GithubExposureSeam;
  owner: string;
  repo: string;
}): Promise<GithubExposureSurfaceResult> {
  const listing = await listAll({ call: "events", maxPages: EVENTS_MAX_PAGES, params: { owner, repo }, seam });
  const refusedPastCap =
    listing.outcome === "failed" && listing.failure.status === 422 && listing.items.length === EVENTS_API_CAP;
  const gaps = refusedPastCap ? [] : listingGaps({ label: "events", listing });
  return {
    state: surfaceState({
      count: listing.items.length,
      detail: `${String(listing.items.length)} event(s) in the feed`,
      gaps,
      limits: ["GitHub serves at most the 300 most recent events from the last 90 days"],
    }),
    surface: "events",
  };
}
