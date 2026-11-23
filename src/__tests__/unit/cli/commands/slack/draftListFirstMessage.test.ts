/*
 * The first-message proof bar through `slack draft list`'s document: a row
 * parked at the top level of a channel owes an annotated screenshot and a link the reader sees, or it lists the pieces
 * it lacks (and the Queue draws no card for it). A DM owes nothing, and a cleared row carries the receipt it leads with.
 */
import { describe, expect, it } from "vitest";

import { draftListDocument } from "../../../../../cli/commands/slack/draftListDocument.js";
import type { DraftMediaOf } from "../../../../../outbound/slack/draftProof.js";
import {
  type ParkedSlackDraft,
  parkedDraftDigest,
  type SlackDraftItem,
} from "../../../../../outbound/slack/draftRegister.js";
import type { DraftMediaEvidence } from "../../../../../outbound/slack/firstMessageProof.js";
import type { SlackDripMessagePayload } from "../../../../../outbound/slack/types.js";
import { annotatedRecord, failedRecord, SHOT_NOTE } from "../../../../annotatedShotFixture.js";

const SHA = "1".repeat(64);
const DIGEST = `sha256:${SHA}`;

/** Rich text with no link in it. */
const BARE: SlackDripMessagePayload = {
  blocks: [
    {
      elements: [{ elements: [{ text: "Two laptops lack CrowdStrike.", type: "text" }], type: "rich_text_section" }],
      type: "rich_text",
    },
  ],
  form: "rich",
  text: "Two laptops lack CrowdStrike.",
  unfurl_links: true,
  unfurl_media: true,
};

/** Rich text showing the reader one link. */
const LINKED: SlackDripMessagePayload = {
  blocks: [
    {
      elements: [
        {
          elements: [
            { text: "Two laptops lack CrowdStrike: ", type: "text" },
            { text: "the Vanta test", type: "link", url: "https://app.vanta.com/tests/crowdstrike" },
          ],
          type: "rich_text_section",
        },
      ],
      type: "rich_text",
    },
  ],
  form: "rich",
  text: "Two laptops lack CrowdStrike.",
  unfurl_links: true,
  unfurl_media: true,
};

/** One held row, a top-level message in a channel unless `over` says otherwise. */
function held({ over = {} }: { over?: Partial<ParkedSlackDraft> } = {}): SlackDraftItem {
  const base = {
    advisory: [],
    authorId: "U0SYNADAOWN",
    channel: "C0ISO",
    channelName: "iso-27001",
    form: '{"kind":"one-card"}',
    id: "sd-11111111",
    kind: "message" as const,
    mentions: [],
    payload: BARE,
    shape: "top-level" as const,
    tsIso: "2026-10-21T00:00:00.000Z",
    why: "two laptops lack CrowdStrike",
    ...over,
  };
  const draft: ParkedSlackDraft = { ...base, digest: parkedDraftDigest({ draft: base }) };
  return { draft, id: draft.id, state: "held" };
}

/** A media reader answering `media` for every row. */
function mediaOf({ media }: { media: readonly DraftMediaEvidence[] }): DraftMediaOf {
  return () => media;
}

/** What the document lists for the only row it is given. */
function listed({ row, media }: { row: SlackDraftItem; media: readonly DraftMediaEvidence[] }) {
  return draftListDocument({ items: [row], mediaOf: mediaOf({ media }), people: [] }).items[0]!;
}

describe("a first message in a channel through draftListDocument", () => {
  it("lists a top-level channel row with no media as missing the screenshot, the link and the annotation", () => {
    const row = listed({ media: [], row: held() });
    expect(row.proofMissing).toEqual(["screenshot", "link", "annotation"]);
    expect(row.leadingReceipt).toBe(undefined);
  });

  it("lists nothing missing, and the receipt it leads with, for an annotated unobstructed picture and a visible link", () => {
    const row = listed({
      media: [{ kind: "picture", records: [annotatedRecord({ digest: DIGEST })], sha256: SHA }],
      row: held({ over: { payload: LINKED } }),
    });
    expect(row.proofMissing).toBe(undefined);
    expect(row.leadingReceipt).toEqual({ notes: [SHOT_NOTE], sha256: SHA });
  });

  it("still asks for the annotation once an older record for the same bytes failed", () => {
    const failed = failedRecord({
      correction: "retake it with the pop-up dismissed",
      digest: DIGEST,
      reason: "obscured",
    });
    const row = listed({
      media: [{ kind: "picture", records: [failed, annotatedRecord({ digest: DIGEST })], sha256: SHA }],
      row: held({ over: { payload: LINKED } }),
    });
    expect(row.proofMissing).toEqual(["annotation"]);
    expect(row.leadingReceipt).toBe(undefined);
  });

  it("asks for the annotation of a picture whose record names no box", () => {
    const row = listed({
      media: [
        { kind: "picture", records: [annotatedRecord({ digest: DIGEST, over: { annotations: [] } })], sha256: SHA },
      ],
      row: held({ over: { payload: LINKED } }),
    });
    expect(row.proofMissing).toEqual(["annotation"]);
  });

  it("asks for the link alone when the picture is annotated but the message shows the reader none", () => {
    const row = listed({
      media: [{ kind: "picture", records: [annotatedRecord({ digest: DIGEST })], sha256: SHA }],
      row: held(),
    });
    expect(row.proofMissing).toEqual(["link"]);
  });

  it("owes nothing in a DM, with no media and no link", () => {
    const row = listed({ media: [], row: held({ over: { channel: "D0SYNSOMEONE", channelName: undefined } }) });
    expect(row.proofMissing).toBe(undefined);
    expect(row.leadingReceipt).toBe(undefined);
  });

  it("owes nothing as a thread reply, with no media and no link", () => {
    const row = listed({
      media: [],
      row: held({ over: { shape: "thread", threadTs: "1789407961.767649" } }),
    });
    expect(row.proofMissing).toBe(undefined);
  });

  it("owes nothing for a bump, which re-surfaces an earlier message", () => {
    const row = listed({ media: [], row: held({ over: { act: "bump" } }) });
    expect(row.proofMissing).toBe(undefined);
  });
});
