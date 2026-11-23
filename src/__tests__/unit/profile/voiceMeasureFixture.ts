/**
 * A throwaway home holding a profile and Slack bronze, shared by the voice-measure read and write tests. Every home
 * it mints is removed by {@link removeVoiceHomes}, which each test file calls from its `afterEach`.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The instant every measurement in these tests is stamped with. */
export const NOW = "2026-11-05T05:00:00.000Z";
/** The owner's synthetic Slack user id. */
export const OWNER = "U0SYNOWNER1";
/** Somebody else's synthetic Slack user id. */
export const OTHER = "U0SYNOTHER1";

const homes: string[] = [];

/** Remove every home minted since the last call. */
export function removeVoiceHomes(): void {
  homes.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
}

/**
 * A throwaway home with a profile and, when given, Slack bronze files keyed by file name.
 *
 * @param ownerId the owner's Slack id, declared as `slackBot.ownerUserId`; absent declares none
 * @param files bronze file name → its JSONL lines
 * @returns the home directory
 */
export function voiceHome({
  ownerId,
  files,
}: {
  ownerId?: string;
  files?: Readonly<Record<string, readonly string[]>>;
}): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-voicemeasure-"));
  homes.push(dir);
  writeFileSync(
    join(dir, "profile.json"),
    JSON.stringify({
      displayName: "",
      gitNamespace: "",
      id: "me",
      schemaVersion: 1,
      sources: [],
      ...(ownerId === undefined ? {} : { slackBot: { ownerUserId: ownerId, selfUserIds: [] } }),
    }),
  );
  if (files !== undefined) {
    const bronze = join(dir, "corpus", "bronze", "slack");
    mkdirSync(bronze, { recursive: true });
    Object.entries(files).forEach(([name, lines]) => {
      writeFileSync(join(bronze, name), `${lines.join("\n")}\n`);
    });
  }
  return dir;
}

/**
 * One serialised Slack bronze row.
 *
 * @param id the message's channel-local id
 * @param raw extra fields merged into the stored Slack payload
 * @returns the JSONL line
 */
export function voiceRow({
  id,
  text,
  author = OWNER,
  channel = "C0SYNCHAN01",
  raw = {},
}: {
  id: string;
  text: string;
  author?: string;
  channel?: string;
  raw?: Record<string, unknown>;
}): string {
  return JSON.stringify({
    author,
    container: `slack/${channel}`,
    kind: "message",
    raw: { text, user: author, ...raw },
    refs: [],
    source: "slack",
    sourceId: `${channel}:${id}`,
    text,
    tsIso: "2026-11-01T00:00:00.000Z",
    url: `https://acme.slack.com/archives/${channel}/p${id}`,
  });
}
