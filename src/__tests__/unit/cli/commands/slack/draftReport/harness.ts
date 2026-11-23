/*
 * What the `slack draft` report test files share: the one-card payload the ISO draft takes, a parked draft
 * carrying its real digest, the folded row built from it, and the attachment evidence a row brings or does not.
 * It moved here when `draftReport.test.ts` was split by behaviour.
 */
import {
  type ParkedSlackDraft,
  parkedDraftDigest,
  type SlackDraftItem,
} from "../../../../../../outbound/slack/draftRegister.js";
import type { DraftMediaEvidence } from "../../../../../../outbound/slack/firstMessageProof.js";
import type { SlackDripMessagePayload } from "../../../../../../outbound/slack/types.js";
import type { ImageRecord } from "../../../../../../visualEvidence/types.js";

/** A one-card payload with a paragraph and a bullet, which is the shape the ISO draft actually takes. */
export const RICH: SlackDripMessagePayload = {
  blocks: [
    {
      elements: [
        { elements: [{ text: "Four groups, one question.", type: "text" }], type: "rich_text_section" },
        {
          elements: [{ elements: [{ text: "Everyone", type: "text" }], type: "rich_text_section" }],
          style: "bullet",
          type: "rich_text_list",
        },
      ],
      type: "rich_text",
    },
  ],
  form: "rich",
  text: "Four groups, one question.\n\nEveryone",
  unfurl_links: true,
  unfurl_media: true,
};

/**
 * One parked draft, with its real digest so a report cannot print a digest nothing computed.
 *
 * @returns the draft with `over` applied and its digest computed over the result
 */
export function draft({ over = {} }: { over?: Partial<ParkedSlackDraft> } = {}): ParkedSlackDraft {
  const base = {
    advisory: [],
    authorId: "U0SYNADAOWN",
    channel: "C0ISO",
    channelName: "iso-27001",
    form: '{"kind":"one-card"}',
    id: "sd-11111111",
    kind: "message" as const,
    mentions: [{ key: "@ada-example", kind: "person" as const, target: "U1" }],
    payload: RICH,
    shape: "top-level" as const,
    tsIso: "2026-09-23T00:00:00.000Z",
    why: "the entry-group question the four-group thread left open",
    ...over,
  };
  return { ...base, digest: parkedDraftDigest({ draft: base }) };
}

/**
 * One folded row.
 *
 * @returns the register row wrapping that draft, in `state`
 */
export function item({
  over = {},
  state = "held",
}: { over?: Partial<ParkedSlackDraft>; state?: SlackDraftItem["state"] } = {}): SlackDraftItem {
  const parked = draft({ over });
  return { draft: parked, id: parked.id, state };
}

/**
 * No attachment under any row: what a row that brings no media reads as.
 *
 * @returns an empty evidence list
 */
export const NO_MEDIA = (): readonly DraftMediaEvidence[] => [];

/** The picture's bytes, as a digest the image store keys its records by. */
export const SHOT_DIGEST = `sha256:${"1".repeat(64)}`;

/**
 * One stored picture under a row, read with `records`.
 *
 * @returns a single picture's evidence carrying those image records
 */
export function picture({ records }: { records: readonly ImageRecord[] }): readonly DraftMediaEvidence[] {
  return [{ kind: "picture", records, sha256: "1".repeat(64) }];
}
