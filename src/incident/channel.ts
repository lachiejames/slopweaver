/**
 * Whether a Slack channel is a LIVE INCIDENT's channel — read off the naming convention incidents.io writes, which
 * the corpus already holds, never a new data source.
 *
 * When a new incident channel appears, an investigation starts without anyone asking. The trigger is the channel itself, so this module is the one place
 * that decides what counts as one.
 *
 * ## The convention, measured from the corpus
 *
 * Every channel incidents.io opens is named `inc-` + the date it opened + a slug of its title.
 * Measured over `$SLOPWEAVER_HOME/corpus/structures/slack.jsonl` — a few dozen distinct `inc-` names, repro
 * `grep -o '"name":"inc-[^"]*"' $SLOPWEAVER_HOME/corpus/structures/slack.jsonl | sort -u`:
 *
 * - the date is `YYYY-MM-DD` on all but a couple, which write it `YYYY_MM_DD` (`inc-YYYY_MM_DD-<slug>`),
 *   so either separator is the convention;
 * - several are drills, and each names itself with a whole word — `test`, `testing`, `tutorial` — while the one
 *   non-dated name, `inc-1-this-is-an-example-incident`, says `example`. A drill token is checked FIRST, which is
 *   what lets the example read as a drill rather than as nothing at all;
 * - one drill does not name itself (`inc-YYYY-MM-DD-maybe-this-time`, opened beside several that do) and reads as an
 *   incident. That is the known miss, and it is harmless here: a past channel is outside the live window.
 *
 * The creator and topic are EVIDENCE, never a gate — printed beside the verdict against who created `#incidents`,
 * so a channel that broke the pattern is visible without a hand-opened one following the convention being refused.
 *
 * ## Admitting a channel to a live investigation
 *
 * {@link liveAdmission} is the stricter question the scheduled sweep asks: is this an incident channel opened in
 * the last {@link LIVE_INCIDENT_WINDOW_HOURS} hours and still open. A channel with no creation time is refused
 * rather than read as fresh, because "fresh" is the claim that would backfill every incident ever run.
 *
 * Pure: a channel in, a verdict out.
 */

import type { StructureBronzeRow } from "../corpus/structures/types.js";
import { latestStructureRows } from "../silver/structures.js";

/** The name incidents.io gives an incident's channel: `inc-` then the date it opened, then a slug of its title. */
const INCIDENT_NAME = /^inc-\d{4}([-_])\d{2}\1\d{2}-[a-z0-9]+(?:[-_][a-z0-9]+)*$/u;

/** The words a drill names itself with — one of them as a whole token between `-` or `_` separators. */
const DRILL_TOKENS = ["test", "testing", "tutorial", "example"] as const;

/**
 * How recently a channel must have been opened for the sweep to start an investigation on it.
 *
 * Two days, because the sweep runs every five minutes and an incident is investigated while it is live: a window
 * this wide survives a machine asleep over a weekend night, and nothing wider is ever a LIVE incident. It is also
 * what keeps the first deployment from opening an investigation on every past incident in the workspace.
 */
export const LIVE_INCIDENT_WINDOW_HOURS = 48;

/**
 * How far ahead of this machine's clock a creation time may sit and still read as now — ordinary drift between
 * Slack's clock and this one. Further ahead is malformed data or a badly skewed clock, refused rather than admitted
 * for a window that would not start closing until the clock caught up.
 */
export const CLOCK_SKEW_SECONDS = 300;

/** The name of the channel incidents.io's own app user created first — the baseline a creator is compared with. */
const INCIDENTS_CHANNEL = "incidents";

/** A channel, as much of it as the incident question reads — from the live discovery or from a corpus row. */
export interface IncidentChannel {
  readonly id: string;
  readonly name: string;
  /** When Slack created it, in epoch seconds; absent when the source carried none. */
  readonly createdEpochSeconds?: number;
  /** The user id that created it. */
  readonly creator?: string;
  /** Its topic, where incidents.io writes the incident reference. */
  readonly topic?: string;
  readonly isArchived?: boolean;
  readonly isPrivate?: boolean;
  /** Whether the token that discovered it is a member — absent when the source did not say. */
  readonly isMember?: boolean;
}

/** What a channel is, and the evidence it was judged on. */
export type IncidentChannelClassification =
  | { readonly kind: "incident"; readonly evidence: readonly string[] }
  | { readonly kind: "drill"; readonly evidence: readonly string[]; readonly token: string }
  | { readonly kind: "not-incident"; readonly evidence: readonly string[] };

/** Whether the sweep may start an investigation on a channel, and why not when it may not. */
export type LiveAdmission = { readonly admit: true } | { readonly admit: false; readonly why: string };

/**
 * The drill token a channel's name carries, when it carries one.
 *
 * @param name the channel's name
 * @returns the token, or `undefined`
 */
function drillToken({ name }: { name: string }): string | undefined {
  const tokens = name.split(/[-_]/u);
  return DRILL_TOKENS.find((token) => tokens.includes(token));
}

/**
 * The evidence lines every classification prints: the name rule, who made it against who made `#incidents`, when,
 * the topic, and whether it is archived, private and joined.
 *
 * @param channel the channel judged
 * @param incidentsCreator who created `#incidents`, when the batch knows
 * @returns the lines, in that order
 */
function evidenceOf({
  channel,
  incidentsCreator,
}: {
  channel: IncidentChannel;
  incidentsCreator: string | undefined;
}): readonly string[] {
  const matches = INCIDENT_NAME.test(channel.name) ? "matches" : "does not match";
  const lines = [`name ${channel.name} ${matches} inc-YYYY-MM-DD-<slug>`];
  if (channel.creator === undefined) {
    lines.push("creator unknown");
  } else if (incidentsCreator === undefined) {
    lines.push(`creator ${channel.creator}; the #incidents creator is unknown`);
  } else {
    const same = channel.creator === incidentsCreator ? "is" : "is not";
    lines.push(`creator ${channel.creator} ${same} the #incidents creator ${incidentsCreator}`);
  }
  lines.push(
    channel.createdEpochSeconds === undefined
      ? "created time unknown"
      : `created ${String(channel.createdEpochSeconds)}`,
  );
  if (channel.topic !== undefined) {
    lines.push(`topic ${channel.topic}`);
  }
  lines.push(
    `${channel.isArchived === true ? "archived" : "open"}, ${channel.isPrivate === true ? "private" : "public"}, ${channel.isMember === true ? "joined" : "not joined"}`,
  );
  return lines;
}

/**
 * Classify one channel: a drill when its name carries a drill token, an incident when it follows the dated
 * convention, otherwise not an incident's channel at all.
 *
 * @param channel the channel to judge
 * @param incidentsCreator who created `#incidents`, when the batch knows — evidence only
 * @returns the classification and the evidence it rests on
 */
export function classifyIncidentChannel({
  channel,
  incidentsCreator,
}: {
  channel: IncidentChannel;
  incidentsCreator: string | undefined;
}): IncidentChannelClassification {
  const evidence = evidenceOf({ channel, incidentsCreator });
  const isIncidentShaped = channel.name.startsWith("inc-");
  const token = isIncidentShaped ? drillToken({ name: channel.name }) : undefined;
  if (token !== undefined) {
    return { evidence: [...evidence, `drill: names itself "${token}"`], kind: "drill", token };
  }
  if (INCIDENT_NAME.test(channel.name)) {
    return { evidence, kind: "incident" };
  }
  return { evidence, kind: "not-incident" };
}

/**
 * Who created `#incidents` — the app user incidents.io opens every incident channel as — read off the batch.
 *
 * @param channels every channel the batch holds
 * @returns the creator, or `undefined` when the batch has no `#incidents` or it names no creator
 */
export function incidentsCreatorOf({ channels }: { channels: readonly IncidentChannel[] }): string | undefined {
  return channels.find((channel) => channel.name === INCIDENTS_CHANNEL)?.creator;
}

/**
 * Whether the scheduled sweep may start an investigation on an incident channel now.
 *
 * Refused, in this order: archived (the incident is over); no creation time (fresh cannot be claimed); created
 * further ahead of this clock than {@link CLOCK_SKEW_SECONDS}; opened outside the live window. Whether the investigation can READ it is deliberately not judged here: discovery runs
 * on the bot token, so a channel's membership flags describe the bot, while `slack read-thread` reads with the user
 * token it prefers. The detector probes one read with that same resolved token instead (`./detect.ts`).
 *
 * @param channel an incident channel
 * @param nowEpochSeconds the sweep's own instant
 * @returns admitted, or why not
 */
export function liveAdmission({
  channel,
  nowEpochSeconds,
}: {
  channel: IncidentChannel;
  nowEpochSeconds: number;
}): LiveAdmission {
  if (channel.isArchived === true) {
    return { admit: false, why: "archived" };
  }
  if (channel.createdEpochSeconds === undefined) {
    return { admit: false, why: "no created time" };
  }
  const ageSeconds = nowEpochSeconds - channel.createdEpochSeconds;
  if (ageSeconds < -CLOCK_SKEW_SECONDS) {
    return { admit: false, why: `created ${String(-ageSeconds)}s ahead of this clock` };
  }
  const ageHours = ageSeconds / 3600;
  if (ageHours > LIVE_INCIDENT_WINDOW_HOURS) {
    return {
      admit: false,
      why: `opened ${String(Math.floor(ageHours))}h ago, outside the ${String(LIVE_INCIDENT_WINDOW_HOURS)}h live window`,
    };
  }
  return { admit: true };
}

/** One attribute off a structure row, when it is the type asked for. */
function attrString({ row, key }: { row: StructureBronzeRow; key: string }): string | undefined {
  const value = row.attrs[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * The corpus's Slack channels, each at its newest capture, as the incident question reads them.
 *
 * Newest capture per channel (`latestStructureRows`), so a renamed channel is judged by its current name once.
 *
 * @param rows every Slack structure row the corpus holds
 * @returns one channel per channel id, in the order the newest captures are listed
 */
export function latestIncidentChannels({ rows }: { rows: readonly StructureBronzeRow[] }): readonly IncidentChannel[] {
  const channels: IncidentChannel[] = [];
  for (const row of latestStructureRows({ rows })) {
    const name = row.identity.name;
    const isSlackChannel = row.source === "slack" && row.kind === "channel";
    if (isSlackChannel && name !== undefined) {
      channels.push(channelOfRow({ name, row }));
    }
  }
  return channels;
}

/** One Slack channel structure row as an incident channel, carrying each optional field only when the row had it. */
function channelOfRow({ row, name }: { row: StructureBronzeRow; name: string }): IncidentChannel {
  const created = row.attrs["created"];
  const creator = attrString({ key: "creator", row });
  const topic = attrString({ key: "topic", row });
  return {
    id: row.sourceId,
    name,
    ...(typeof created === "number" && created > 0 ? { createdEpochSeconds: created } : {}),
    ...(creator === undefined ? {} : { creator }),
    ...(topic === undefined ? {} : { topic }),
    ...(row.attrs["archived"] === true ? { isArchived: true } : {}),
    ...(row.attrs["private"] === true ? { isPrivate: true } : {}),
    ...(row.attrs["isMember"] === true ? { isMember: true } : {}),
  };
}
