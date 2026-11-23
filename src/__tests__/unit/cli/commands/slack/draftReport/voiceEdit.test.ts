/*
 * A voice edit's words and versions: a held as-me row lists the words the voice edits, and every version is
 * listed as its payload's text and digest, oldest first, drawn from the payload a release binds.
 */
import { describe, expect, it } from "vitest";

import { draftListDocument } from "../../../../../../cli/commands/slack/draftListDocument.js";
import type { SlackDraftItem } from "../../../../../../outbound/slack/draftRegister.js";
import type { SlackDripMessagePayload } from "../../../../../../outbound/slack/types.js";
import { draft, item, NO_MEDIA } from "./harness.js";

describe("a voice edit's words and versions", () => {
  const card = JSON.stringify({ kind: "one-card", lines: [{ runs: [{ text: "Can you look?" }] }] });
  const warmer = JSON.stringify({ kind: "one-card", lines: [{ runs: [{ text: "Hey, could you look?" }] }] });

  it("lists a held as-me row's words as the voice edits them, and none on a bot row", () => {
    const document = draftListDocument({
      items: [item({ over: { form: card } }), item({ over: { actor: "bot", form: card, id: "sd-22222222" } })],
      mediaOf: NO_MEDIA,
      people: [],
    });
    expect(document.items.map((row) => row.editableText)).toEqual(["Can you look?", undefined]);
  });

  /** A one-line rich payload saying `text`. */
  function said({ text }: { text: string }): SlackDripMessagePayload {
    const section = { elements: [{ text, type: "text" as const }], type: "rich_text_section" as const };
    return {
      blocks: [{ elements: [section], type: "rich_text" }],
      form: "rich",
      text,
      unfurl_links: true,
      unfurl_media: true,
    };
  }

  it("lists every version as its payload's text and digest, oldest first, never the whole words twice", () => {
    const v1 = draft({ over: { form: card, payload: said({ text: "Can you look?" }) } });
    const v2 = draft({ over: { form: warmer, payload: said({ text: "Hey, could you look?" }) } });
    const held: SlackDraftItem = {
      ...item({ over: { form: warmer } }),
      versions: [
        { atIso: v1.tsIso, number: 1, words: v1 },
        { atIso: "2026-10-04T04:34:00.000Z", heard: "make it warmer", number: 2, words: v2 },
      ],
    };
    const [listed] = draftListDocument({ items: [held], mediaOf: NO_MEDIA, people: [] }).items;
    expect(listed!.versions).toEqual([
      { atIso: v1.tsIso, digest: v1.digest, number: 1, text: "Can you look?" },
      {
        atIso: "2026-10-04T04:34:00.000Z",
        digest: v2.digest,
        heard: "make it warmer",
        number: 2,
        text: "Hey, could you look?",
      },
    ]);
    expect(listed!.editableText).toBe("Hey, could you look?");
  });

  it("draws a version whose form says other words from its payload, the words a release binds", () => {
    const v1 = draft({ over: { form: card, payload: said({ text: "Actual voice words" }) } });
    const held: SlackDraftItem = {
      ...item({ over: { form: card } }),
      versions: [{ atIso: v1.tsIso, number: 1, words: v1 }],
    };
    const [listed] = draftListDocument({ items: [held], mediaOf: NO_MEDIA, people: [] }).items;
    expect(listed!.versions!.map((version) => version.text)).toEqual(["Actual voice words"]);
  });
});
