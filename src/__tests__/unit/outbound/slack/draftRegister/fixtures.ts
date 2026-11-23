/*
 * The pure fixtures the as-me draft register's test files share: the payload a parked row carries, the row builder
 * that digests it the way a park binds it, the golden pre-media row and two stored attachments. No disk, no clock.
 */
import { type ParkedSlackDraft, parkedDraftDigest } from "../../../../../outbound/slack/draftRegister.js";
import type { SlackDripMessagePayload } from "../../../../../outbound/slack/types.js";

/** The one-block rich payload every default row carries. */
export const PAYLOAD: SlackDripMessagePayload = {
  blocks: [{ elements: [], type: "rich_text" }],
  form: "rich",
  text: "a draft",
  unfurl_links: true,
  unfurl_media: true,
};

/**
 * One held top-level row in the launch channel, with each field `over` names replaced and its digest minted from
 * the result, exactly as a park binds it.
 *
 * @param over the fields this case changes from the default row
 * @returns the parked row, digested
 */
export function draft({ over = {} }: { over?: Partial<ParkedSlackDraft> } = {}): ParkedSlackDraft {
  const base = {
    advisory: [],
    authorId: "U0SYNADAOWN",
    channel: "C0ISO",
    channelName: "iso-27001",
    form: '{"kind":"one-card","lines":[]}',
    id: "sd-11111111",
    mentions: [{ key: "@ada-example", kind: "person" as const, target: "U1" }],
    payload: PAYLOAD,
    shape: "top-level" as const,
    tsIso: "2026-09-23T00:00:00.000Z",
    why: "the entry-group question for the launch channel",
    ...over,
  };
  return { ...base, digest: parkedDraftDigest({ draft: base }) };
}

/**
 * A real held row's content, read with `slopweaver slack draft show sd-f6b4af59 --json` with its
 * Slack ids since rewritten to synthetic stand-ins, and its digest under the hashing that held BEFORE media
 * existed. Every approval already given names a digest like this one, so adding a field to the hashed object
 * must leave it byte-for-byte unchanged.
 */
export const GOLDEN_CONTENT = {
  authorId: "U0SYN000001",
  channel: "C0SYN000002",
  mentions: [],
  payload: {
    blocks: [
      {
        elements: [
          {
            elements: [
              {
                text: "hey, been working on finding ways to get more confidence that a PR does what it says it does, without having to read through all the text",
                type: "text",
              },
              { text: "\n\n", type: "text" },
            ],
            type: "rich_text_section",
          },
          {
            elements: [
              {
                text: "something I find personally gives me more confidence is two Playwright videos side by side: the same script against the old version of the app vs the new one, without your change vs with it",
                type: "text",
              },
              { text: "\n\n", type: "text" },
            ],
            type: "rich_text_section",
          },
          {
            elements: [
              {
                text: "it's kinda similar to e2e tests, but instead of making everything into an e2e test, sometimes Playwright is just a convenient way to get a video of a journey through the app",
                type: "text",
              },
              { text: "\n\n", type: "text" },
            ],
            type: "rich_text_section",
          },
          {
            elements: [
              { text: "the recorder is ", type: "text" },
              {
                text: "record one Playwright journey against two refs as one side-by-side video #16400",
                type: "link",
                url: "https://github.com/acme/acme-admin/pull/16400",
              },
              { text: ", with an example video up top. keen to push on with these", type: "text" },
            ],
            type: "rich_text_section",
          },
        ],
        type: "rich_text",
      },
    ],
    form: "rich",
    text: "hey, been working on finding ways to get more confidence that a PR does what it says it does, without having to read through all the text\n\nsomething I find personally gives me more confidence is two Playwright videos side by side: the same script against the old version of the app vs the new one, without your change vs with it\n\nit's kinda similar to e2e tests, but instead of making everything into an e2e test, sometimes Playwright is just a convenient way to get a video of a journey through the app\n\nthe recorder is <https://github.com/acme/acme-admin/pull/16400|record one Playwright journey against two refs as one side-by-side video #16400>, with an example video up top. keen to push on with these",
    unfurl_links: true,
    unfurl_media: true,
  },
} satisfies Parameters<typeof parkedDraftDigest>[0]["draft"];
// Re-pinned once when the row's repository URL was sanitised; the digest function itself did not move.
export const GOLDEN_DIGEST = "16beb02c491b0abb4746a3973331243d";

/** One stored attachment's row entry. */
export const VIDEO = { bytes: 2747, name: "walkthrough.mp4", sha256: "a".repeat(64) };
export const STILL = { bytes: 12, name: "still.png", sha256: "b".repeat(64) };
