/*
 * The fakes every `readSlackThreads` test file shares: the run's instant, the Slack-shaped ids of the owner, the
 * bot, a colleague and an app, a throwaway state home carrying a Slack bronze window, a members index and a
 * profile, and the bronze and member record builders. Each home it mints is registered in `homes`, which every
 * test file empties in its own `afterEach`.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const NOW = "2026-08-31T00:00:00.000Z";
// Slack's own id shape, not a readable placeholder: `../../../../review/prLink`'s mention matcher is
// deliberately structural (`<@[UW][A-Z0-9]+>`), so a fixture using `owner-id` would prove nothing about
// a mention run and would pass whatever the reader did.
export const OWNER = "U0SYNOWNER1234";
export const BOT = "U0SYNBOT12345";
export const HUMAN = "U0SYNHUMAN123";
export const APP = "U0SYNAPP12345";

export const homes: string[] = [];

/**
 * A throwaway state home carrying a Slack bronze window, a members index and a profile.
 *
 * @param records the bronze rows to write, already in the shape the reader parses
 * @param members the members index rows
 * @returns the home's path
 */
export function home({
  records,
  members = [],
}: {
  records: readonly Record<string, unknown>[];
  members?: readonly Record<string, unknown>[];
}): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-slackread-"));
  homes.push(dir);
  mkdirSync(join(dir, "corpus", "bronze", "slack"), { recursive: true });
  mkdirSync(join(dir, "corpus", "members"), { recursive: true });
  writeFileSync(
    join(dir, "corpus", "bronze", "slack", "window.jsonl"),
    `${records.map((one) => JSON.stringify(one)).join("\n")}\n`,
  );
  writeFileSync(
    join(dir, "corpus", "members", "slack.jsonl"),
    `${members.map((one) => JSON.stringify(one)).join("\n")}\n`,
  );
  writeFileSync(
    join(dir, "profile.json"),
    JSON.stringify({
      displayName: "",
      gitNamespace: "",
      id: "me",
      schemaVersion: 1,
      slackBot: { ownerUserId: OWNER, selfUserIds: [BOT] },
      sources: [],
    }),
  );
  return dir;
}

/**
 * One Slack reply as the bronze corpus stores it, in `channel-one`'s thread unless the caller names another.
 *
 * @returns the bronze record, carrying `raw.text` only when the caller supplied one
 */
export const message = ({
  author,
  ts,
  threadTs = "1787705115.489199",
  channel = "channel-one",
  text = "hello",
  tsIso = "2026-08-30T00:00:00.000Z",
  rawText,
}: {
  author: string;
  ts: string;
  threadTs?: string;
  channel?: string;
  text?: string;
  tsIso?: string;
  /** Slack's own `raw.text`, which is the ONLY half that ever carries a mention run. */
  rawText?: string;
}): Record<string, unknown> => ({
  attrs: { channel: "#a-channel" },
  author,
  container: `slack/${channel}`,
  kind: "comment",
  source: "slack",
  sourceId: `${channel}:${threadTs}:reply:${ts}`,
  text,
  tsIso,
  url: `https://example.slack.com/archives/${channel}/p${ts.replace(".", "")}`,
  ...(rawText === undefined ? {} : { raw: { text: rawText } }),
});

/**
 * How the corpus really stores a message tagging the owner: the run in `raw.text`, a display name in `text`.
 *
 * MEASURED over four bronze files — 170 records carry the token in `raw.text` and ZERO carry
 * it in the projected `text`. Every mention case below is built this way so it fails if the reader ever
 * goes back to reading the projection.
 *
 * @returns the bronze record whose mention run tags the owner ahead of what the author `says`
 */
export const tagging = (args: Parameters<typeof message>[0] & { readonly says: string }): Record<string, unknown> =>
  message({
    ...args,
    rawText: `<@${OWNER}> ${args.says}`,
    text: `@Owner Name ${args.says}`,
  });

/**
 * One Slack members-index row, a person unless the caller marks it a bot.
 *
 * @returns the members-index record the reader resolves an author's name and bot flag through
 */
export const member = ({
  id,
  name,
  bot = false,
}: {
  id: string;
  name: string;
  bot?: boolean;
}): Record<string, unknown> => ({
  fetchedAtIso: "2026-08-01T00:00:00.000Z",
  identity: { emailTrust: "missing", name, nativeId: id, source: "slack" },
  profile: { bot },
  provenance: ["slack.users.list"],
  raw: {},
  source: "slack",
  sourceId: id,
  version: 1,
  warnings: [],
});
