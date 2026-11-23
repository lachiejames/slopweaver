/**
 * Shared fixtures for the `slack tagged` tests: a throwaway home carrying Slack bronze, a members index and a
 * profile, and the bronze and search shapes a tag really arrives in.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { advanceSlackChannelWatermarks } from "../../../../../corpus/slack/channelWatermark.js";
import { advanceWatermark } from "../../../../../corpus/watermark.js";
import type { SlackSearchMatch } from "../../../../../live/slack/searchMessages.js";

// Slack's own id shape: the mention matcher is structural (`<@[UW][A-Z0-9]+>`), so a readable placeholder would
// prove nothing about a mention run.
export const OWNER = "U0SYNOWNER1234";
export const HUMAN = "U0SYNHUMAN123";
export const STRANGER = "U0SYNSTRANGE1";
export const APP = "U0SYNAPP12345";
const BOT = "U0SYNBOT12345";

/** The run's frozen instant. */
export const NOW = "2026-09-30T00:00:00.000Z";

/** The newest message the fixture corpus holds, per its watermark. */
export const CORPUS_NEWEST = "2026-09-29T12:00:00.000Z";

/**
 * A throwaway home. Every file is written into it; the caller removes it.
 *
 * @param files bronze window files, each a list of records
 * @param ownerId the profile's owner id, null to leave it undeclared
 * @param watermark the Slack corpus's newest message, null to write no watermark
 * @param channelReach channel id → that channel's own crawl cursor; by default `C0CHAN1` reached the newest message
 * @param members whether to write a Slack members index at all
 * @returns the home's path
 */
export function taggedHome({
  files,
  ownerId = OWNER,
  watermark = CORPUS_NEWEST,
  channelReach = { C0CHAN1: CORPUS_NEWEST },
  members = true,
}: {
  files: readonly (readonly Record<string, unknown>[])[];
  ownerId?: string | null;
  watermark?: string | null;
  channelReach?: Readonly<Record<string, string>>;
  members?: boolean;
}): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-tagged-"));
  mkdirSync(join(dir, "corpus", "bronze", "slack"), { recursive: true });
  if (watermark !== null) {
    advanceWatermark({ home: dir, watermarks: [{ cursor: watermark, source: "slack" }] });
  }
  advanceSlackChannelWatermarks({
    advances: Object.entries(channelReach).map(([channel, cursor]) => ({ channel, cursor, fullHistory: false })),
    home: dir,
  });
  mkdirSync(join(dir, "corpus", "members"), { recursive: true });
  files.forEach((records, index) => {
    writeFileSync(
      join(dir, "corpus", "bronze", "slack", `window-${String(index)}.jsonl`),
      `${records.map((one) => JSON.stringify(one)).join("\n")}\n`,
    );
  });
  if (members) {
    writeFileSync(
      join(dir, "corpus", "members", "slack.jsonl"),
      `${[member({ id: HUMAN, name: "A Colleague" }), member({ bot: true, id: APP, name: "DLP" })]
        .map((one) => JSON.stringify(one))
        .join("\n")}\n`,
    );
  }
  writeFileSync(
    join(dir, "profile.json"),
    JSON.stringify({
      displayName: "",
      gitNamespace: "",
      id: "me",
      schemaVersion: 1,
      sources: [],
      ...(ownerId === null ? {} : { slackBot: { ownerUserId: ownerId, selfUserIds: [BOT] } }),
    }),
  );
  return dir;
}

/**
 * One members-index row.
 *
 * @param id the Slack id
 * @param name the display name
 * @param bot whether Slack calls it a bot
 * @returns the row
 */
function member({ id, name, bot = false }: { id: string; name: string; bot?: boolean }): Record<string, unknown> {
  return {
    fetchedAtIso: "2026-08-01T00:00:00.000Z",
    identity: { emailTrust: "missing", name, nativeId: id, source: "slack" },
    profile: { bot },
    provenance: ["slack.users.list"],
    raw: {},
    source: "slack",
    sourceId: id,
    version: 1,
    warnings: [],
  };
}

/**
 * One bronze message: a root when `rootTs` is absent, a thread reply otherwise. A tag of the owner is carried in
 * `raw.text` as a mention run and in `text` as a display name, which is how the corpus really stores one.
 *
 * @param author the author id
 * @param ts the message's own Slack `ts`
 * @param tsIso its instant
 * @param rootTs the thread root, for a reply
 * @param channel the conversation id
 * @param tags whether it tags the owner
 * @returns the record
 */
export function bronze({
  author,
  ts,
  tsIso,
  rootTs,
  channel = "C0CHAN1",
  tags = false,
}: {
  author: string;
  ts: string;
  tsIso: string;
  rootTs?: string;
  channel?: string;
  tags?: boolean;
}): Record<string, unknown> {
  return {
    attrs: { channel: "dev" },
    author,
    container: `slack/${channel}`,
    kind: rootTs === undefined ? "message" : "comment",
    raw: { text: tags ? `<@${OWNER}> can you look at this` : "noted" },
    source: "slack",
    sourceId: rootTs === undefined ? `${channel}:${ts}` : `${channel}:${rootTs}:reply:${ts}`,
    text: tags ? "@Owner Name can you look at this" : "noted",
    tsIso,
    url: `https://example.slack.com/archives/${channel}/p${ts.replace(".", "")}`,
  };
}

/**
 * One live search hit.
 *
 * @param userId the author id, empty for an authorless app post
 * @param ts the hit's own Slack `ts`
 * @param tsIso its instant
 * @param rootTs the thread root, for a reply — carried the way search carries it, as the permalink's `thread_ts`
 * @param channelId the conversation id
 * @param tags whether it tags the owner
 * @returns the hit
 */
export function hit({
  userId,
  ts,
  tsIso,
  rootTs,
  channelId = "C0CHAN1",
  tags = true,
}: {
  userId: string;
  ts: string;
  tsIso: string;
  rootTs?: string;
  channelId?: string;
  tags?: boolean;
}): SlackSearchMatch {
  const base = `https://example.slack.com/archives/${channelId}/p${ts.replace(".", "")}`;
  return {
    channelId,
    channelName: "dev",
    permalink: rootTs === undefined ? base : `${base}?thread_ts=${rootTs}`,
    text: tags ? `<@${OWNER}> ping <@${HUMAN}>` : `the owner said U0SYNOWNER1234 in passing`,
    ts,
    tsIso,
    userId,
  };
}
