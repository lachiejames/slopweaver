/** The seeded draft register the list, show, drop, context and re-cut cases read instead of recording one. */
import { type ParkedSlackDraft, slackDraftEventLine } from "../../../../../../outbound/slack/draftRegister.js";
import { storeAnnotatedShot } from "../../../../../annotatedShotFixture.js";
import { SHOWN_LINK_TEXT } from "./forms.js";

/**
 * A register holding one held draft, written through the register's own encoder.
 *
 * @returns the register text, one event line
 */
export function seededLog({ over = {} }: { over?: Partial<ParkedSlackDraft> } = {}): string {
  const draft: ParkedSlackDraft = {
    advisory: [],
    authorId: "U0SYNADAOWN",
    channel: "C0ISO",
    channelName: "iso-27001",
    digest: "0123456789abcdef0123456789abcdef",
    form: "{}",
    id: "sd-11112222",
    kind: "message",
    mentions: [],
    payload: {
      blocks: [
        {
          elements: [{ elements: [{ text: "Four groups.", type: "text" }], type: "rich_text_section" }],
          type: "rich_text",
        },
      ],
      form: "rich",
      text: "Four groups.",
      unfurl_links: false,
      unfurl_media: false,
    },
    shape: "top-level",
    tsIso: "2026-09-22T10:00:00.000Z",
    why: "the ISO group question",
    ...over,
  };
  return `${slackDraftEventLine({ event: { draft, id: draft.id, kind: "parked", tsIso: draft.tsIso } })}\n`;
}

/**
 * The fields that make a {@link seededLog} row carry the receipts a first message in a channel owes: a real annotated screenshot kept under `home`, and its link in the words. Read it with `--home <home>`.
 *
 * @param home the throwaway state home both the draft media store and the image records live under
 * @returns the row fields to override
 */
export function receiptsIn({ home }: { home: string }): Partial<ParkedSlackDraft> {
  return {
    media: [storeAnnotatedShot({ home })],
    payload: { form: "plain", text: `Four groups. ${SHOWN_LINK_TEXT}`, unfurl_links: false, unfurl_media: false },
  };
}
