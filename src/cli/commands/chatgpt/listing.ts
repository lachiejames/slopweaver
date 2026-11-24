/**
 * Every conversation on the owner's ChatGPT account, listed through the web backend: the inventory a full-history
 * sync walks. Pure except for the injected GET and pacer; each page is read by `./listingPages.ts`, through its
 * endpoint's strict boundary.
 *
 * ## Three places a chat lives, MEASURED
 *
 * One request each, against the owner's own session, printing key names and value types only:
 *
 * - **active** — `GET /backend-api/conversations?offset&limit&order=updated`: `{items, total, limit, offset}`,
 *   paged by offset, newest update first. `total` is NOT the lane's size: at `limit=3` it read `4` on an account
 *   whose lane held 1,833. It reads as "one past what you have" while more remain, so the walk stops once the
 *   offset reaches it, and an empty page short of it is a stall, never an end.
 * - **archived** — the same path with `is_archived=true`; archived chats are not in the active lane.
 * - **project** — Projects come from `GET /backend-api/gizmos/snorlax/sidebar` (`{items, cursor}`, paged by
 *   cursor), and each project's chats from `GET /backend-api/gizmos/<project id>/conversations?cursor=`
 *   (`{items, cursor}`, first cursor `0`). A whole walk of one account found every project chat in the active lane
 *   too (90 of 90), so this lane is a cross-check: it costs a request per project, and a chat only it lists is
 *   still listed. Repeats are counted, never stored twice.
 *
 * Reproduce: `slopweaver chatgpt list` — the summary line counts each lane and the repeats.
 *
 * ## A private API, read gently
 *
 * This backend is undocumented and can change shape or close; a change of shape refuses by name rather than
 * reading past it. Every request goes through one {@link ChatgptPacer}, serially. The page size is the one the web
 * app's own sidebar asks with, never probed upward. Paths are built here from constants and validated ids; the one
 * response-derived value sent back is a listing's own opaque `cursor`, URL-encoded into the query of the path it
 * came from.
 */

import { err, ok, type Result } from "#lib/result.js";

import { type ChatgptError, ChatgptErrors } from "./errors.js";
import {
  type ListedChatgptProject,
  parseConversationsPage,
  parseProjectConversationsPage,
  parseProjectsPage,
} from "./listingPages.js";
import type { ChatgptPacer } from "./pacer.js";

/** Conversations per listing page — what the web app's own sidebar asks with. */
const LISTING_PAGE_SIZE = 28;

/** The three places a conversation is listed from. */
export type ChatgptListingLane = "active" | "archived" | "project";

/** One conversation as a listing names it. */
export interface ListedChatgptConversation {
  readonly id: string;
  readonly title: string | null;
  readonly createdIso: string;
  readonly updatedIso: string;
  readonly lane: ChatgptListingLane;
  /** The project it sits in, for the `project` lane; `null` otherwise. */
  readonly projectId: string | null;
}

/**
 * One page of the active or archived listing.
 *
 * @param archived whether to list archived chats rather than active ones
 * @param offset how many conversations earlier pages already gave
 * @returns the path, relative to the chatgpt.com origin
 */
export function conversationsPagePath({ archived, offset }: { archived: boolean; offset: number }): string {
  const base = `/backend-api/conversations?offset=${String(offset)}&limit=${String(LISTING_PAGE_SIZE)}&order=updated`;
  return archived ? `${base}&is_archived=true` : base;
}

/**
 * One page of the owner's ChatGPT Projects.
 *
 * @param cursor the previous page's `cursor`, or `null` for the first page
 * @returns the path, relative to the chatgpt.com origin
 */
export function projectsPagePath({ cursor }: { cursor: string | null }): string {
  const base = "/backend-api/gizmos/snorlax/sidebar?owned_only=true&conversations_per_gizmo=0";
  return cursor === null ? base : `${base}&cursor=${encodeURIComponent(cursor)}`;
}

/**
 * One page of one project's conversations.
 *
 * @param projectId a project id the sidebar page's parser already accepted
 * @param cursor the previous page's `cursor`, or `null` for the first page, which the web app asks for as `cursor=0`
 * @returns the path, relative to the chatgpt.com origin
 */
export function projectConversationsPagePath({
  projectId,
  cursor,
}: {
  projectId: string;
  cursor: string | null;
}): string {
  const asked = cursor === null ? "0" : encodeURIComponent(cursor);
  return `/backend-api/gizmos/${projectId}/conversations?cursor=${asked}`;
}

/** The edges one inventory walk reads through. */
export interface ChatgptListingDeps {
  /** One GET of a path under chatgpt.com, answered as the body's text. */
  readonly fetchText: (args: { path: string }) => Promise<Result<string, ChatgptError>>;
  readonly pacer: ChatgptPacer;
  /**
   * Waits before the retry of a listing page ChatGPT answered with a 5xx; `attempt` counts from 0. Absent, a 5xx
   * stops the walk like any other refusal. Never taken for a 429 or a 4xx: a rate limit is not slept through.
   */
  readonly backoff?: ((args: { attempt: number }) => Promise<void>) | undefined;
  /** Told just before each page of every lane is asked for, so a stop can say where it stopped. */
  readonly onPage?: ((page: ListingPage) => void) | undefined;
}

/**
 * One page a walk is about to ask for. An offset lane (active, archived) is placed by its offset; a cursor lane (the
 * project sidebar, one project's chats) by its page number from 1, since a cursor is opaque and means nothing to a reader.
 */
export type ListingPage =
  | { readonly kind: "offset"; readonly lane: string; readonly offset: number }
  | { readonly kind: "cursor"; readonly lane: string; readonly page: number };

/** The whole account, as one walk listed it. */
export interface ChatgptInventory {
  /** Every distinct conversation, in the order first listed: active, then archived, then each project's. */
  readonly conversations: readonly ListedChatgptConversation[];
  readonly projects: readonly ListedChatgptProject[];
  /** Listings that named a conversation an earlier page or lane already gave — counted, never stored twice. */
  readonly repeats: number;
  /** GETs the walk made, retries included. */
  readonly requests: number;
}

/** How many times one listing page is retried after a 5xx, each after {@link ChatgptListingDeps.backoff}. */
const LISTING_5XX_RETRIES = 3;

/**
 * Whether the backend answered with a server error, the one refusal a listing page is retried for. A Cloudflare
 * challenge can carry a 5xx status too, and is never retried.
 */
function isServerError({ error }: { error: ChatgptError }): boolean {
  return error.code === "HTTP_REFUSED" && error.status >= 500 && !error.challenged;
}

/** One paced GET, retried after a 5xx up to {@link LISTING_5XX_RETRIES} times when the deps give a backoff. */
async function pacedGet({
  deps,
  path,
  counter,
}: {
  deps: ChatgptListingDeps;
  path: string;
  counter: { requests: number };
}): Promise<Result<string, ChatgptError>> {
  for (let attempt = 0; ; attempt += 1) {
    await deps.pacer.beforeRequest();
    counter.requests += 1;
    const body = await deps.fetchText({ path });
    if (body.isOk() || !isServerError({ error: body.error }) || deps.backoff === undefined) {
      return body;
    }
    if (attempt >= LISTING_5XX_RETRIES) {
      return body;
    }
    await deps.backoff({ attempt });
  }
}

/** The name an offset lane goes by in a refusal and in a stop line. */
function offsetLaneName({ archived }: { archived: boolean }): string {
  return archived ? "archived" : "active";
}

/**
 * Whether an offset lane has nothing more to give: every chat it holds is listed, or, with `knownThroughIso`, this
 * page reached a chat that last moved before it, so nothing further down the newest-update-first lane is newer.
 */
function offsetLaneDone({
  items,
  knownThroughIso,
  offset,
  total,
}: {
  items: readonly ListedChatgptConversation[];
  knownThroughIso: string | undefined;
  offset: number;
  total: number;
}): boolean {
  if (offset >= total) {
    return true;
  }
  if (knownThroughIso === undefined) {
    return false;
  }
  return items.some((one) => Date.parse(one.updatedIso) < Date.parse(knownThroughIso));
}

/**
 * The active or archived lane, offset page by offset page. With `knownThroughIso` the walk stops after the first page
 * whose oldest chat last moved before it: the lane is newest-update-first, so nothing further down is newer.
 */
async function walkOffsetLane({
  deps,
  archived,
  maxPages,
  counter,
  knownThroughIso,
}: {
  deps: ChatgptListingDeps;
  archived: boolean;
  maxPages: number;
  counter: { requests: number };
  knownThroughIso: string | undefined;
}): Promise<Result<readonly ListedChatgptConversation[], ChatgptError>> {
  const lane = offsetLaneName({ archived });
  const listed: ListedChatgptConversation[] = [];
  let offset = 0;
  for (let page = 0; ; page += 1) {
    if (page >= maxPages) {
      return err(ChatgptErrors.listingBoundExceeded({ lane, maxPages }));
    }
    const path = conversationsPagePath({ archived, offset });
    deps.onPage?.({ kind: "offset", lane, offset });
    const body = await pacedGet({ counter, deps, path });
    if (body.isErr()) {
      return err(body.error);
    }
    const parsed = parseConversationsPage({ archived, path, text: body.value });
    if (parsed.isErr()) {
      return err(parsed.error);
    }
    const { items, total } = parsed.value;
    listed.push(...items);
    offset += items.length;
    if (offsetLaneDone({ items, knownThroughIso, offset, total })) {
      return ok(listed);
    }
    if (items.length === 0) {
      return err(
        ChatgptErrors.listingStalled({ detail: `an empty page at offset ${String(offset)} of ${String(total)}`, lane }),
      );
    }
  }
}

/** A cursor-paged lane: the first page is asked with no cursor, and each names the next's, `null` on the last. */
async function walkCursorLane<T>({
  deps,
  lane,
  pathFor,
  parse,
  maxPages,
  counter,
}: {
  deps: ChatgptListingDeps;
  lane: string;
  pathFor: (args: { cursor: string | null }) => string;
  parse: (args: { path: string; text: string }) => Result<{ items: readonly T[]; cursor: string | null }, ChatgptError>;
  maxPages: number;
  counter: { requests: number };
}): Promise<Result<readonly T[], ChatgptError>> {
  // Keyed by the PATH asked, never the cursor: the first page's `null` cursor goes out on the wire as `cursor=0`, so a
  // page answering `0` asks the very same URL again, which a cursor-keyed set cannot see.
  const asked = new Set<string>();
  const all: T[] = [];
  let path = pathFor({ cursor: null });
  for (let page = 0; ; page += 1) {
    if (page >= maxPages) {
      return err(ChatgptErrors.listingBoundExceeded({ lane, maxPages }));
    }
    asked.add(path);
    deps.onPage?.({ kind: "cursor", lane, page: page + 1 });
    const body = await pacedGet({ counter, deps, path });
    if (body.isErr()) {
      return err(body.error);
    }
    const parsed = parse({ path, text: body.value });
    if (parsed.isErr()) {
      return err(parsed.error);
    }
    all.push(...parsed.value.items);
    const next = parsed.value.cursor;
    if (next === null) {
      return ok(all);
    }
    const nextPath = pathFor({ cursor: next });
    if (asked.has(nextPath)) {
      return err(ChatgptErrors.listingStalled({ detail: "a page handed back a cursor already asked with", lane }));
    }
    path = nextPath;
  }
}

/**
 * List the whole account: the active lane, the archived lane, then every project's conversations. Serial, every GET
 * through the one pacer; the first refusal stops the walk, and nothing partial is returned as whole.
 *
 * @param deps the GET and the pacer
 * @param maxPages the most pages any one lane may take before the walk refuses
 * @param knownThroughIso when given, the walk lists only what moved since this instant: each offset lane stops after
 *   the page that reaches an older chat, and the projects lane (a cross-check of the active lane) is skipped, so the
 *   result is the NEWER part of the account for the caller to lay over a carried list. Absent, the whole account.
 * @returns every distinct conversation and project, or the first failure
 */
export async function listChatgptInventory({
  deps,
  maxPages,
  knownThroughIso,
}: {
  deps: ChatgptListingDeps;
  maxPages: number;
  knownThroughIso?: string | undefined;
}): Promise<Result<ChatgptInventory, ChatgptError>> {
  const counter = { requests: 0 };
  const lanes: ListedChatgptConversation[] = [];
  for (const archived of [false, true]) {
    const lane = await walkOffsetLane({ archived, counter, deps, knownThroughIso, maxPages });
    if (lane.isErr()) {
      return err(lane.error);
    }
    lanes.push(...lane.value);
  }
  if (knownThroughIso !== undefined) {
    return ok({ ...dedupe({ lanes }), projects: [], requests: counter.requests });
  }
  const projects = await walkCursorLane<ListedChatgptProject>({
    counter,
    deps,
    lane: "projects",
    maxPages,
    parse: ({ path, text }) =>
      parseProjectsPage({ path, text }).map(({ cursor, projects: page }) => ({ cursor, items: page })),
    pathFor: ({ cursor }) => projectsPagePath({ cursor }),
  });
  if (projects.isErr()) {
    return err(projects.error);
  }
  const distinctProjects = [...new Map(projects.value.map((project) => [project.id, project])).values()];
  for (const project of distinctProjects) {
    const listed = await walkCursorLane<ListedChatgptConversation>({
      counter,
      deps,
      lane: `project ${project.id}`,
      maxPages,
      parse: ({ path, text }) => parseProjectConversationsPage({ path, projectId: project.id, text }),
      pathFor: ({ cursor }) => projectConversationsPagePath({ cursor, projectId: project.id }),
    });
    if (listed.isErr()) {
      return err(listed.error);
    }
    lanes.push(...listed.value);
  }
  return ok({ ...dedupe({ lanes }), projects: distinctProjects, requests: counter.requests });
}

/** Each conversation once, in the order first listed, and how many repeats were dropped. */
function dedupe({ lanes }: { lanes: readonly ListedChatgptConversation[] }): {
  conversations: readonly ListedChatgptConversation[];
  repeats: number;
} {
  const byId = new Map<string, ListedChatgptConversation>();
  let repeats = 0;
  for (const conversation of lanes) {
    if (byId.has(conversation.id)) {
      repeats += 1;
      continue;
    }
    byId.set(conversation.id, conversation);
  }
  return { conversations: [...byId.values()], repeats };
}
