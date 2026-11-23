/**
 * The Slack STRUCTURE lane: capture the workspace/enterprise (`auth.test` + `team.info`), every channel's
 * and group DM's metadata (topic/purpose/created/creator/flags — already carried on the `conversations.list` objects, so no
 * per-channel `conversations.info` is needed), channel MEMBERSHIP (`conversations.members`, the one N-call
 * risk — bounded by a cap + archived-skip + logged), and usergroups (`usergroups.list` with inline users)
 * into {@link StructureBronzeRow}s. Every SDK call is a {@link safeProviderCall}-wrapped, injected seam so it's unit-tested
 * with a fake; membership is deliberately bounded so "all my channels" never becomes a thundering herd.
 */
import { WebClient } from "@slack/web-api";
import { SDK_REPLACEMENT_ATTEMPTS, safeProviderCall, scopeIdForToken } from "../../lib/providerCall.js";
import { err, ok, type Result } from "../../lib/result.js";
import { orThrow } from "../../lib/safeBoundary.js";
import type { StructureBronzeRow } from "../structures/types.js";
import {
  SLACK_STRUCTURE_LANE_TYPES,
  SLACK_STRUCTURE_LANES,
  type SlackStructureLane,
  slackStructureLaneLabel,
} from "./lanes.js";
import { type ChannelMembershipPlan, planChannelMembership } from "./membershipPlan.js";
import { projectChannelRow, projectUsergroupRow, projectWorkspaceRow } from "./structureRows.js";

const PAGE_LIMIT = 200;

/** The injected Slack structure seam — raw shapes stay `unknown`, parsed defensively by the projectors. */
export interface SlackStructuresApi {
  authTest: () => Promise<unknown>;
  teamInfo: () => Promise<unknown>;
  listChannels: (args: {
    lane: SlackStructureLane;
    cursor?: string;
  }) => Promise<{ channels: readonly unknown[]; nextCursor?: string }>;
  channelMembers: (args: { channel: string }) => Promise<readonly string[]>;
  listUsergroups: () => Promise<readonly unknown[]>;
}

/** Build every channel row, fetching membership only for planned channels (a per-channel failure warns). */
async function buildChannelRows({
  api,
  plan,
  fetchedAtIso,
}: {
  api: SlackStructuresApi;
  plan: ChannelMembershipPlan;
  fetchedAtIso: string;
}): Promise<{ rows: readonly StructureBronzeRow[]; warnings: readonly string[] }> {
  const rows: StructureBronzeRow[] = [];
  const warnings: string[] = [];
  for (const entry of plan.entries) {
    let memberIds: readonly string[] = [];
    if (entry.fetchMembership) {
      try {
        memberIds = await api.channelMembers({ channel: entry.id });
      } catch (error: unknown) {
        warnings.push(`slack channel ${entry.id} members: ${error instanceof Error ? error.message : "unknown"}`);
      }
    }
    const row = projectChannelRow({
      fetchedAtIso,
      memberIds,
      membershipFetched: entry.fetchMembership,
      raw: entry.raw,
    });
    if (row !== undefined) {
      rows.push(row);
    }
  }
  return { rows, warnings };
}

/**
 * Page every conversation from the seam to exhaustion, ONE {@link SlackStructureLane} at a time, and keep
 * the lanes APART in the return value rather than concatenating them. The separation is what lets
 * {@link planChannelMembership} spend a membership cap per lane; flattened here, the channel lane's hundreds
 * of rows would spend the whole budget before the group-DM lane's dozens were reached.
 */
async function discoverChannels({ api }: { api: SlackStructuresApi }): Promise<{
  lanes: readonly { lane: SlackStructureLane; channels: readonly unknown[] }[];
  warnings: readonly string[];
}> {
  const lanes: { lane: SlackStructureLane; channels: readonly unknown[] }[] = [];
  const warnings: string[] = [];
  for (const lane of SLACK_STRUCTURE_LANES) {
    const channels: unknown[] = [];
    // Each lane's cursor set is its OWN, and a repeated one stops the walk rather than spinning. Slack's
    // cursor is the only termination signal `conversations.list` gives — there is no `has_more` to
    // cross-check — so a server-side loop here would accumulate the same page forever. `live/slack/
    // pagination.ts` makes the identical walk `err`; this lane degrades to what it has plus a NAMED
    // warning instead, because a structure refresh that drops every row is worse than one missing a tail —
    // and a short walk that said nothing is the defect this whole change exists to remove.
    const seenCursors = new Set<string>();
    let cursor: string | undefined;
    for (;;) {
      const page = await api.listChannels({ lane, ...(cursor !== undefined ? { cursor } : {}) });
      channels.push(...page.channels);
      const next = page.nextCursor;
      if (next === undefined || next.length === 0) {
        break;
      }
      if (seenCursors.has(next)) {
        warnings.push(
          `slack ${slackStructureLaneLabel({ lane })} structure discovery: repeated pagination cursor — stopped at ${String(channels.length)} row(s), the tail is missing`,
        );
        break;
      }
      seenCursors.add(next);
      cursor = next;
    }
    lanes.push({ channels, lane });
  }
  return { lanes, warnings };
}

/**
 * Hydrate the Slack workspace structure: the workspace/enterprise row, every channel (metadata +
 * membership), and usergroups. A workspace-discovery failure is fatal (`err`); a usergroups gap degrades to
 * a warning.
 *
 * @param api the injected Slack structure seam
 * @param membershipCap the max active conversations PER LANE to resolve membership for; omit for every one
 *   of them, which is the default — see {@link planChannelMembership} for the cost that buys
 * @param fetchedAtIso the hydration timestamp
 * @returns the structure rows + warnings, or `err` on a fatal discovery failure
 */
export async function fetchSlackStructures({
  api,
  membershipCap,
  fetchedAtIso,
}: {
  api: SlackStructuresApi;
  membershipCap?: number;
  fetchedAtIso: string;
}): Promise<Result<{ rows: readonly StructureBronzeRow[]; warnings: readonly string[] }>> {
  let discovery: {
    lanes: readonly { lane: SlackStructureLane; channels: readonly unknown[] }[];
    warnings: readonly string[];
  };
  let workspaceRow: StructureBronzeRow | undefined;
  try {
    const auth = await api.authTest();
    const team = await api.teamInfo();
    workspaceRow = projectWorkspaceRow({ auth, fetchedAtIso, team });
    discovery = await discoverChannels({ api });
  } catch (error: unknown) {
    return err([`slack structure discovery failed: ${error instanceof Error ? error.message : "unknown"}`]);
  }
  // One plan per lane, so the cap is a per-lane budget — see `planChannelMembership` for what a shared one
  // costs the group-DM lane.
  const lanePlans = discovery.lanes.map(({ lane, channels }) =>
    planChannelMembership({ channels, lane, ...(membershipCap !== undefined ? { cap: membershipCap } : {}) }),
  );
  const plan: ChannelMembershipPlan = {
    entries: lanePlans.flatMap((lanePlan) => lanePlan.entries),
    warnings: lanePlans.flatMap((lanePlan) => lanePlan.warnings),
  };
  const channelRows = await buildChannelRows({ api, fetchedAtIso, plan });
  const usergroups = await hydrateUsergroups({ api, fetchedAtIso });
  return ok({
    rows: [...(workspaceRow !== undefined ? [workspaceRow] : []), ...channelRows.rows, ...usergroups.rows],
    warnings: [...discovery.warnings, ...plan.warnings, ...channelRows.warnings, ...usergroups.warnings],
  });
}

/** Fetch + project usergroups; a scope gap degrades to a warning (no rows). */
async function hydrateUsergroups({
  api,
  fetchedAtIso,
}: {
  api: SlackStructuresApi;
  fetchedAtIso: string;
}): Promise<{ rows: readonly StructureBronzeRow[]; warnings: readonly string[] }> {
  try {
    const groups = await api.listUsergroups();
    const rows = groups
      .map((raw) => projectUsergroupRow({ fetchedAtIso, raw }))
      .filter((row): row is StructureBronzeRow => row !== undefined);
    return { rows, warnings: [] };
  } catch (error: unknown) {
    return {
      rows: [],
      warnings: [`slack usergroups unavailable: ${error instanceof Error ? error.message : "unknown"}`],
    };
  }
}

/** The `nextCursor` off a Slack `response_metadata` — absent/empty ⇒ stop paging. Pure. */
function nextCursorOf({ metadata }: { metadata: { next_cursor?: string } | undefined }): string | undefined {
  return metadata?.next_cursor !== undefined && metadata.next_cursor.length > 0 ? metadata.next_cursor : undefined;
}

/**
 * Build the production Slack structure seam over a live `WebClient`. Every SDK call is ONE raw call routed
 * through {@link safeProviderCall} (shared 429 block, pacing, typed error, retry) then re-thrown, so the
 * orchestrator's fatal/degrade policy runs unchanged. `conversations.members` is paged to exhaustion PER planned channel.
 *
 * @param token the Slack read token
 * @returns the live Slack structure seam
 */
export function makeSlackStructuresApi({ token }: { token: string }): SlackStructuresApi {
  // Same opt-out as the READ seam: surface each 429 to the shared block rather than sleeping it off inside
  // the SDK, and leave the attempt budget to `safeProviderCall`. See `api.ts` for the measurement.
  // devlint: sdk-factory -- the PR4.2 structural read lane builds its own client
  const client = new WebClient(token, { rejectRateLimitedCalls: true, retryConfig: { retries: 0 } });
  const scopeId = scopeIdForToken({ token });
  return {
    authTest: async () =>
      orThrow({
        result: await safeProviderCall({
          execute: () => client.auth.test(),
          maxAttempts: SDK_REPLACEMENT_ATTEMPTS,
          operation: "slack.auth.test",
          paced: false,
          provider: "slack",
          retryMode: "transient",
          scopeId,
        }),
      }),
    channelMembers: ({ channel }) => channelMembersAll({ channel, client, scopeId }),
    listChannels: structuresListChannels({ client, scopeId }),
    listUsergroups: structuresListUsergroups({ client, scopeId }),
    teamInfo: structuresTeamInfo({ client, scopeId }),
  };
}

/**
 * The structural `conversations.list` seam, ONE lane per call (archived INCLUDED — a dead channel is still
 * structure). See {@link SlackStructureLane} for why group DMs are a separate request and `im` is not one.
 */
function structuresListChannels({
  client,
  scopeId,
}: {
  client: WebClient;
  scopeId: string;
}): SlackStructuresApi["listChannels"] {
  return async ({ lane, cursor }) => {
    const res = orThrow({
      result: await safeProviderCall({
        execute: () =>
          client.conversations.list({
            exclude_archived: false,
            limit: PAGE_LIMIT,
            types: SLACK_STRUCTURE_LANE_TYPES[lane],
            ...(cursor !== undefined ? { cursor } : {}),
          }),
        maxAttempts: SDK_REPLACEMENT_ATTEMPTS,
        operation: "slack.conversations.list",
        paced: false,
        provider: "slack",
        retryMode: "transient",
        scopeId,
      }),
    });
    const next = nextCursorOf({ metadata: res.response_metadata });
    return { channels: res.channels ?? [], ...(next !== undefined ? { nextCursor: next } : {}) };
  };
}

/**
 * The `usergroups.list` seam, with inline members so no per-group follow-up call is needed.
 *
 * `include_disabled` is on, deliberately. Slack DISABLES a usergroup rather than deleting it, and a message
 * written while the group was live still carries `<!subteam^S…>` forever — so a listing that omits disabled
 * groups leaves permanent mentions permanently unresolvable. The projection keeps `date_delete` in `raw`
 * and the Slack atlas's own `usergroup` detail carries the flag, so a disabled group is visible AS disabled
 * rather than silently missing.
 */
function structuresListUsergroups({
  client,
  scopeId,
}: {
  client: WebClient;
  scopeId: string;
}): SlackStructuresApi["listUsergroups"] {
  return async () => {
    const res = orThrow({
      result: await safeProviderCall({
        execute: () => client.usergroups.list({ include_disabled: true, include_users: true }),
        maxAttempts: SDK_REPLACEMENT_ATTEMPTS,
        operation: "slack.usergroups.list",
        paced: false,
        provider: "slack",
        retryMode: "transient",
        scopeId,
      }),
    });
    return res.usergroups ?? [];
  };
}

/** The `team.info` seam — the workspace/enterprise row. */
function structuresTeamInfo({
  client,
  scopeId,
}: {
  client: WebClient;
  scopeId: string;
}): SlackStructuresApi["teamInfo"] {
  return async () => {
    const res = orThrow({
      result: await safeProviderCall({
        execute: () => client.team.info(),
        maxAttempts: SDK_REPLACEMENT_ATTEMPTS,
        operation: "slack.team.info",
        paced: false,
        provider: "slack",
        retryMode: "transient",
        scopeId,
      }),
    });
    return res.team;
  };
}

/** Page one channel's members to exhaustion (`conversations.members`), each page safe-wrapped. */
async function channelMembersAll({
  client,
  channel,
  scopeId,
}: {
  client: WebClient;
  channel: string;
  scopeId: string;
}): Promise<readonly string[]> {
  const members: string[] = [];
  let cursor: string | undefined;
  do {
    const res = orThrow({
      result: await safeProviderCall({
        execute: () =>
          client.conversations.members({ channel, limit: PAGE_LIMIT, ...(cursor !== undefined ? { cursor } : {}) }),
        maxAttempts: SDK_REPLACEMENT_ATTEMPTS,
        operation: "slack.conversations.members",
        paced: false,
        provider: "slack",
        retryMode: "transient",
        scopeId,
      }),
    });
    members.push(...(res.members ?? []));
    cursor = nextCursorOf({ metadata: res.response_metadata });
  } while (cursor !== undefined && cursor.length > 0);
  return members;
}
