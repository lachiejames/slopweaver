/**
 * Workspace discovery: every conversation `conversations.list` returns (paged, no membership pre-filter — a
 * channel we cannot read is dropped later, at its history call, with a warning) and the id→name directory
 * from `users.list`. Split out of `fetch.ts`, which calls both once per refresh before the per-channel crawl.
 *
 * Conversations arrive in TWO walks, not one: channels + DMs, then group DMs. Slack returns no `mpim` row
 * while `public_channel` is in the same `types` list, so asking for everything at once reaches less than
 * asking twice — the measurement is in `./lanes.ts`.
 */
import { advanceOrWarn, collectCursorPages, openCursorPage, pushCursorWarning } from "../../lib/paging.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type SlackFetchError, SlackFetchErrors } from "./errors.js";
import type { SlackApi, SlackChannelRef } from "./fetch.js";
import { SLACK_CONVERSATION_LANES, slackLaneLabel } from "./lanes.js";
import { memberName } from "./members.js";
import { optStr } from "./shape.js";

/** The user-directory lane label, named once so its two paging call sites cannot drift apart. */
const USER_DIRECTORY_LANE = "slack user directory";

/**
 * The id→name entries from one `users.list` page (skips non-object / id-less / name-less rows). Pure.
 *
 * @param members one page of raw member rows, of unvalidated shape
 * @returns the id→name map; a row missing either half is skipped, since a half-known user cannot be cited
 */
function usersFromPage({ members }: { members: readonly unknown[] }): Record<string, string> {
  const users: Record<string, string> = {};
  for (const raw of members) {
    if (!isRecord(raw)) {
      continue;
    }
    const id = optStr({ value: raw["id"] });
    const name = memberName({ raw });
    if (id !== undefined && name !== undefined) {
      users[id] = name;
    }
  }
  return users;
}

/**
 * Page the whole workspace directory off `users.list`, capped by {@link fetchCap}. Best-effort: a failure
 * partway through returns whatever was accumulated plus a warning, never fatal — a missing user directory
 * degrades name resolution, it does not sink the crawl.
 *
 * @param api the injected Slack seam
 * @param maxItems per-lane fetch cap
 * @returns the id→name map accumulated so far, and any warnings raised along the way
 */
export async function discoverUsers({
  api,
  maxItems,
}: {
  api: SlackApi;
  maxItems?: number;
}): Promise<{ users: Record<string, string>; warnings: readonly string[] }> {
  const users: Record<string, string> = {};
  const warnings: string[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  let pages = 0;
  try {
    for (;;) {
      const open = openCursorPage({
        collected: Object.keys(users).length,
        cursor,
        lane: USER_DIRECTORY_LANE,
        maxItems: maxItems,
        pages: pages,
        seen,
        warnings,
      });
      if (open === undefined) {
        break;
      }
      const page = await api.listUsers({ pageSize: open.pageSize, ...(cursor !== undefined ? { cursor } : {}) });
      pages += 1;
      // A page of only ALREADY-SEEN users grew this map by nothing, which is precisely what a re-served page
      // looks like — and it is now caught by the repeated cursor instead, which is the real signal.
      Object.assign(users, usersFromPage({ members: page.members }));
      const next = advanceOrWarn({
        lane: USER_DIRECTORY_LANE,
        next: page.nextCursor,
        seen,
        warnings,
      });
      if (next === undefined) {
        break;
      }
      cursor = next;
    }
  } catch (error: unknown) {
    // Non-fatal: return whatever was accumulated before the failure + a warning (unchanged behaviour).
    return {
      users,
      warnings: [...warnings, `user directory unavailable: ${error instanceof Error ? error.message : "unknown"}`],
    };
  }
  return { users, warnings };
}

/** The privacy/membership booleans from a raw `conversations.list` channel, spread-ready (false/absent stays absent). */
function rawChannelPrivacy({ raw }: { raw: Readonly<Record<string, unknown>> }): {
  isPrivate?: boolean;
  isIm?: boolean;
  isMpim?: boolean;
  isMember?: boolean;
  isArchived?: boolean;
} {
  return {
    ...(raw["is_private"] === true ? { isPrivate: true } : {}),
    ...(raw["is_im"] === true ? { isIm: true } : {}),
    ...(raw["is_mpim"] === true ? { isMpim: true } : {}),
    ...(raw["is_member"] === true ? { isMember: true } : {}),
    ...(raw["is_archived"] === true ? { isArchived: true } : {}),
  };
}

/**
 * When, by whom and under what topic a raw `conversations.list` channel was opened, spread-ready — each part
 * absent when the row carries none, never a stand-in value. `created` is epoch seconds; Slack sends `0` for a
 * conversation with no creation time (an `im`), which is read as absent rather than as 1970.
 */
function rawChannelOrigin({ raw }: { raw: Readonly<Record<string, unknown>> }): {
  createdEpochSeconds?: number;
  creator?: string;
  topic?: string;
} {
  const created = raw["created"];
  const creator = optStr({ value: raw["creator"] });
  const topicRecord = raw["topic"];
  const topic = isRecord(topicRecord) ? optStr({ value: topicRecord["value"] }) : undefined;
  return {
    ...(typeof created === "number" && Number.isInteger(created) && created > 0
      ? { createdEpochSeconds: created }
      : {}),
    ...(creator !== undefined && creator.length > 0 ? { creator } : {}),
    ...(topic !== undefined && topic.length > 0 ? { topic } : {}),
  };
}

/**
 * The channel refs from one `conversations.list` page (skips non-object / id-less rows). Pure.
 *
 * @param channels one page of raw channel rows, of unvalidated shape
 * @returns the refs; a row with no id is skipped rather than given a synthesised one
 */
export function channelsFromPage({ channels }: { channels: readonly unknown[] }): readonly SlackChannelRef[] {
  const out: SlackChannelRef[] = [];
  for (const raw of channels) {
    const id = isRecord(raw) ? optStr({ value: raw["id"] }) : undefined;
    if (!isRecord(raw) || id === undefined) {
      continue;
    }
    const name = optStr({ value: raw["name"] });
    out.push({
      id,
      ...(name !== undefined ? { name } : {}),
      ...rawChannelPrivacy({ raw }),
      ...rawChannelOrigin({ raw }),
    });
  }
  return out;
}

/**
 * Enumerate EVERY conversation `conversations.list` returns, paged to exhaustion (or the {@link fetchCap}
 * ceiling) — no membership pre-filter; a channel we cannot read is dropped later, at its history call, with
 * a warning (breadth is the point).
 *
 * **One walk PER LANE, and the cap applies per lane.** Slack serves no `mpim` row at all while
 * `public_channel` is in the same `types` list (measured — see `./lanes.ts`), so group
 * DMs are a second request rather than four types in one. The cap is per lane because a shared budget is
 * spent by whichever lane walks first: with hundreds of channels ahead of dozens of group DMs, any cap
 * below the channel count would return zero group DMs and report `capped`, which `cursorWalkWarning` deliberately does not warn about —
 * the original defect, silently, under a flag.
 *
 * @param api the injected Slack seam
 * @param warnings the run's warning list, MUTATED — a stuck cursor or a page ceiling is appended here,
 *   opening with the LANE that truncated so a short group-DM walk is not read as a short channel walk
 * @param maxItems per-lane fetch cap, applied to each conversation lane independently
 * @returns every discovered conversation ref, lane by lane, in the order `conversations.list` served them
 */
async function discoverChannels({
  api,
  warnings,
  maxItems,
}: {
  api: SlackApi;
  warnings: string[];
  maxItems?: number;
}): Promise<readonly SlackChannelRef[]> {
  const byId = new Map<string, SlackChannelRef>();
  for (const lane of SLACK_CONVERSATION_LANES) {
    const walk = await collectCursorPages({
      fetchPage: ({ cursor, pageSize }) =>
        api
          .listChannels({ lane, pageSize, ...(cursor !== undefined ? { cursor } : {}) })
          .then((page) => ({ items: channelsFromPage({ channels: page.channels }), nextCursor: page.nextCursor })),
      ...(maxItems !== undefined ? { maxItems } : {}),
    });
    pushCursorWarning({ end: walk.end, lane: slackLaneLabel({ lane }), warnings });
    // The lanes are disjoint by construction, so this de-duplication should never drop a row. It is here so
    // that a Slack change which starts serving mpims in the channel lane too widens nothing and repeats
    // nothing, rather than crawling every group DM twice.
    for (const ref of walk.items) {
      if (!byId.has(ref.id)) {
        byId.set(ref.id, ref);
      }
    }
  }
  return [...byId.values()];
}

/**
 * Resolve the workspace URL (`auth.test`) + discover channels (capped by {@link fetchCap}). `err` on a fatal
 * discovery failure or an unresolved workspace URL.
 *
 * @param api the injected Slack seam
 * @param maxItems per-lane fetch cap
 * @returns the workspace URL + every discovered channel + discovery warnings, or `err` when discovery threw
 *   or the workspace URL could not be resolved at all
 */
export async function discoverSlackWorkspace({
  api,
  maxItems,
}: {
  api: SlackApi;
  maxItems?: number;
}): Promise<
  Result<{ workspaceUrl: string; discovered: readonly SlackChannelRef[]; warnings: readonly string[] }, SlackFetchError>
> {
  const warnings: string[] = [];
  let workspaceUrl: string | undefined;
  let discovered: readonly SlackChannelRef[];
  try {
    workspaceUrl = await api.workspaceUrl();
    discovered = await discoverChannels({ api, warnings, ...(maxItems !== undefined ? { maxItems } : {}) });
  } catch (error: unknown) {
    return err(
      SlackFetchErrors.fetchFailed({
        cause: error,
        message: `channel discovery failed: ${error instanceof Error ? error.message : "unknown"}`,
      }),
    );
  }
  if (workspaceUrl === undefined) {
    return err(SlackFetchErrors.workspaceUrlUnresolved());
  }
  return ok({ discovered, warnings, workspaceUrl });
}
