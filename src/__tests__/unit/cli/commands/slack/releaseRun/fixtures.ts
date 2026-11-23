/*
 * The shared fixtures for the held-draft release tests: the row's form, one stored attachment, the held row and the
 * register holding it, a release approving it, and an install with no bot token. Each is pure; no fixture touches
 * the filesystem.
 */
import type { VerifiedDraftMedia } from "../../../../../../admit/slackDraftMediaStore.js";
import type { SlackDraftReleaseOptions } from "../../../../../../cli/commands/slack/coreTypes.js";
import {
  type ParkedSlackDraft,
  type ParkedSlackDraftMedia,
  parkedDraftDigest,
  slackDraftEventLine,
} from "../../../../../../outbound/slack/draftRegister.js";

export const FORM = '{"sections":[{"kind":"prose","text":"hello"}]}';

/** One stored attachment's row entry. */
export const VIDEO: ParkedSlackDraftMedia = { bytes: 2747, name: "walkthrough.mp4", sha256: "a".repeat(64) };

/**
 * What the store answers for one entry it verified.
 *
 * @returns the store's answer for that media record, its upload bytes fixed.
 */
export function verifiedOf({ record }: { record: ParkedSlackDraftMedia }): VerifiedDraftMedia {
  return { path: `/h/${record.sha256}`, record, upload: { bytes: new Uint8Array([1, 2, 3]), filename: record.name } };
}

/**
 * One held row, its digest computed the way the recorder computes it.
 *
 * @returns the held row, digested as a recording digests one.
 */
export function heldRow({
  form = FORM,
  media = [],
  text = "hello",
}: { form?: string; media?: readonly ParkedSlackDraftMedia[]; text?: string } = {}): ParkedSlackDraft {
  const content = {
    authorId: "U0ME",
    channel: "D1",
    mentions: [],
    payload: { form: "plain" as const, text, unfurl_links: false, unfurl_media: false },
    ...(media.length > 0 ? { media } : {}),
  };
  return {
    ...content,
    advisory: [],
    digest: parkedDraftDigest({ draft: content }),
    form,
    id: "sd-1a2b3c4d",
    shape: "top-level",
    tsIso: "2026-09-23T12:00:00.000Z",
    why: "the release under test",
  };
}

/**
 * The register holding just that row.
 *
 * @returns one parked event line naming the row.
 */
export function logOf({ row }: { row: ParkedSlackDraft }): readonly string[] {
  return [slackDraftEventLine({ event: { draft: row, id: row.id, kind: "parked", tsIso: row.tsIso } })];
}

/**
 * A release of that row, approving whatever digest the caller names.
 *
 * @returns the release options an as-me post of draft sd-1a2b3c4d parses to.
 */
export function releaseOf({ approve, formSource }: { approve: string; formSource?: string }): SlackDraftReleaseOptions {
  return {
    actor: "me",
    dryRun: false,
    formSource,
    home: "/unused",
    json: false,
    release: { approve, draftId: "sd-1a2b3c4d" },
    resendUnconfirmed: false,
    verb: "post",
  };
}

/** An install with no bot token: nothing about a plain row ever asks the bot's membership. */
export const NO_BOT = {
  botMembership: async () => "unknown" as const,
  botToken: (): undefined => undefined,
  conversationGroupDm: async (): Promise<undefined> => undefined,
  doorEnv: (): Record<string, never> => ({}),
};
