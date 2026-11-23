/**
 * One sweep's live-incident detection: every channel the scheduled recovery sweep just discovered, judged; each
 * live incident channel not yet registered gets ONE dispatch board row, and the report says what happened to every
 * channel that was a candidate.
 *
 * Detection writes a ROW and never launches a model (rule 2). The chair — a visible session — reads the board and
 * boots the one Opus seat with `cmux spawn <slug> --model opus`; a row nobody seats is a row on the board, never a
 * retry, a restart or a card asking the owner to start it.
 *
 * ## What is reported, and what is silent
 *
 * The workspace has hundreds of channels and every past incident's channel stays in it, so a report naming each
 * would be a wall nobody reads. Silent: a channel that is not incident-shaped, one opened before the live window,
 * and one the ledger already records. Reported as `skipped`, each with its reason: a drill inside the window, a
 * channel the window cannot be judged for, one this install cannot read, and a registration that was refused.
 *
 * ## Readability is probed, never inferred
 *
 * The sweep discovers channels on the BOT token, so a channel's membership flags describe the bot; the investigating
 * seat reads through `slack read-thread`, which resolves the USER token first. So `deps.probe` resolves the token the
 * same way, and reads one message of the channel's history with it — the probe proves channel-history access, which
 * is what the seat's first read needs, and says which principal it proved it for. A private incident channel the bot
 * is not in is never discovered by the sweep at all: invite the bot, and the next sweep inside the window finds it.
 *
 * Registering one candidate — its claim, its row and its ledger entry — is `./register.ts`.
 */
import type { SlackChannelRef } from "../corpus/slack/fetch.js";

import {
  classifyIncidentChannel,
  type IncidentChannel,
  incidentsCreatorOf,
  LIVE_INCIDENT_WINDOW_HOURS,
  liveAdmission,
} from "./channel.js";
import { type IncidentDetectDeps, type IncidentRegistered, type IncidentSkipped, registerOne } from "./register.js";

/** What one sweep's detection did. */
export interface IncidentDetectReport {
  readonly registered: readonly IncidentRegistered[];
  readonly skipped: readonly IncidentSkipped[];
  /** Set when detection could not run — discovery failed, the seen ledger would not read, or it threw — so nothing was registered. */
  readonly refused?: string;
}

/**
 * The sweep's discovered channel refs as the incident question reads them. A ref with no name cannot be an incident
 * channel (the name IS the convention), so it is dropped here rather than judged.
 *
 * @param refs every channel ref discovery returned
 * @returns the named ones, carrying only the fields detection reads
 */
export function incidentChannelsOf({ refs }: { refs: readonly SlackChannelRef[] }): readonly IncidentChannel[] {
  const channels: IncidentChannel[] = [];
  for (const ref of refs) {
    if (ref.name !== undefined) {
      channels.push(channelOfRef({ name: ref.name, ref }));
    }
  }
  return channels;
}

/** One named ref as an incident channel, carrying each optional field only when the ref had it. */
function channelOfRef({ ref, name }: { ref: SlackChannelRef; name: string }): IncidentChannel {
  return {
    id: ref.id,
    name,
    ...(ref.createdEpochSeconds === undefined ? {} : { createdEpochSeconds: ref.createdEpochSeconds }),
    ...(ref.creator === undefined ? {} : { creator: ref.creator }),
    ...(ref.topic === undefined ? {} : { topic: ref.topic }),
    ...(ref.isArchived === undefined ? {} : { isArchived: ref.isArchived }),
    ...(ref.isPrivate === undefined ? {} : { isPrivate: ref.isPrivate }),
    ...(ref.isMember === undefined ? {} : { isMember: ref.isMember }),
  };
}

/**
 * Whether a channel was opened before the live window — the silent case, and every past incident in the workspace.
 *
 * @param channel the channel
 * @param nowEpochSeconds the sweep's instant
 * @returns true when it carries a creation time older than the window
 */
function openedBeforeWindow({
  channel,
  nowEpochSeconds,
}: {
  channel: IncidentChannel;
  nowEpochSeconds: number;
}): boolean {
  const created = channel.createdEpochSeconds;
  return created !== undefined && nowEpochSeconds - created > LIVE_INCIDENT_WINDOW_HOURS * 3600;
}

/**
 * The incident channels this sweep should try, and the drills and unjudgeable channels it reports instead.
 *
 * A channel with a claim and no ledger entry is a candidate whatever its age or name now: it was admitted when the
 * claim was taken, and its row may be owed to a sweep that crashed near the window's end (`./claim.ts`).
 *
 * @param channels every discovered channel
 * @param seen the channel ids already registered
 * @param claimed the channel ids with a claim
 * @param nowEpochSeconds the sweep's instant
 * @returns the candidates, and the skips
 */
export function liveCandidates({
  channels,
  seen,
  claimed,
  nowEpochSeconds,
}: {
  channels: readonly IncidentChannel[];
  seen: ReadonlySet<string>;
  claimed: ReadonlySet<string>;
  nowEpochSeconds: number;
}): { readonly candidates: readonly IncidentChannel[]; readonly skipped: readonly IncidentSkipped[] } {
  const incidentsCreator = incidentsCreatorOf({ channels });
  const candidates: IncidentChannel[] = [];
  const skipped: IncidentSkipped[] = [];
  for (const channel of channels) {
    if (!seen.has(channel.id) && claimed.has(channel.id)) {
      candidates.push(channel);
      continue;
    }
    const verdict = classifyIncidentChannel({ channel, incidentsCreator });
    const past = openedBeforeWindow({ channel, nowEpochSeconds });
    if (verdict.kind === "not-incident" || past || seen.has(channel.id)) {
      continue;
    }
    if (verdict.kind === "drill") {
      skipped.push({ channelId: channel.id, name: channel.name, why: `drill: names itself "${verdict.token}"` });
      continue;
    }
    const admission = liveAdmission({ channel, nowEpochSeconds });
    if (!admission.admit) {
      skipped.push({ channelId: channel.id, name: channel.name, why: admission.why });
      continue;
    }
    candidates.push(channel);
  }
  return { candidates, skipped };
}

/**
 * A sweep that registers nothing because a prerequisite every row needs is missing: each candidate is skipped with
 * the one reason, so it is retried on the next sweep rather than marked seen.
 *
 * @returns the report, every candidate among its skips
 */
function noneRegistered({
  candidates,
  skipped,
  why,
}: {
  candidates: readonly IncidentChannel[];
  skipped: readonly IncidentSkipped[];
  why: string;
}): IncidentDetectReport {
  const unregistered = candidates.map((channel) => ({ channelId: channel.id, name: channel.name, why }));
  return { registered: [], skipped: [...skipped, ...unregistered] };
}

/**
 * Detect and register every live incident channel in one sweep's discovery.
 *
 * @param channels every channel the sweep discovered, as the incident question reads them
 * @param home the state home rows land in
 * @param nowMs the sweep's instant, epoch milliseconds
 * @param deps the effects
 * @returns what was registered and what was skipped, or the ledger refusal
 */
export async function detectLiveIncidents({
  channels,
  home,
  nowMs,
  deps,
}: {
  channels: readonly IncidentChannel[];
  home: string;
  nowMs: number;
  deps: IncidentDetectDeps;
}): Promise<IncidentDetectReport> {
  const seen = deps.seen();
  if (seen.isErr()) {
    return { refused: seen.error.message, registered: [], skipped: [] };
  }
  const claimed = deps.claimed();
  if (claimed.isErr()) {
    return { refused: claimed.error.message, registered: [], skipped: [] };
  }
  const { candidates, skipped } = liveCandidates({
    channels,
    claimed: claimed.value,
    nowEpochSeconds: Math.floor(nowMs / 1000),
    seen: seen.value,
  });
  if (candidates.length === 0) {
    return { registered: [], skipped };
  }
  const checkout = deps.checkout();
  if (checkout.isErr()) {
    const why = `no checkout to seat the investigation in: ${checkout.error.join("; ")}`;
    return noneRegistered({ candidates, skipped, why });
  }
  // The row's workspace comes off the channel's host, which only the organisation names: one that will not read
  // leaves every candidate unregistered, as a missing checkout does, rather than a row placed by a guess.
  const organisation = await deps.organisation();
  if (organisation.isErr()) {
    const why = `no organisation to place the row by: ${organisation.error.join("; ")}`;
    return noneRegistered({ candidates, skipped, why });
  }
  const registered: IncidentRegistered[] = [];
  const allSkipped = [...skipped];
  const placed = {
    checkout: checkout.value,
    deps,
    home,
    nowIso: new Date(nowMs).toISOString(),
    organisation: organisation.value,
  };
  for (const channel of candidates) {
    const one = await registerOne({ channel, ...placed });
    if ("registered" in one) {
      registered.push(one.registered);
    } else {
      allSkipped.push(one.skipped);
    }
  }
  return { registered, skipped: allSkipped };
}
