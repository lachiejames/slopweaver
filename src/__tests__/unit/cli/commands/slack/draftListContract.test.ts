/**
 * The PRODUCER half of the `slack draft list --json` contract: what the verb prints, pinned to a golden file the
 * console's reader is tested against.
 *
 * The console (`site/components/live/readSlackDrafts.ts`) refuses the WHOLE register over one element it cannot
 * draw. Once every queue card naming a draft read NOT MEASURED because the quote renderer
 * (`src/outbound/slack/blockquote.ts`) had begun recording `rich_text_quote` and the reader had never heard of
 * one. The two halves live in separate Yarn projects and neither may import the other's graph, so they meet in
 * ONE file, `src/__tests__/fixtures/contract/slack-draft-list.json`:
 *
 * - this test builds a draft for every element `@slack/types` admits — the tables are keyed off its unions, so an
 *   upgrade adding one fails the root typecheck here — plus the shipped as-me renderer over a written quoted form,
 *   and asserts `draftListDocument` of them IS the golden. Every id, name and line in it is synthetic;
 * - `site/__tests__/unit/slackDraftListContract.test.ts` reads that golden and asserts the reader draws every row.
 *
 * A change to what the verb prints fails here until the golden is re-cut (`yarn vitest run --config
 * config/vitest/unit.ts <this file> --update`), and the re-cut golden fails the site half until the reader draws it.
 */
import type { RichTextBlock, RichTextBlockElement, RichTextElement } from "@slack/types";
import { describe, expect, it } from "vitest";

import { draftListDocument } from "../../../../../cli/commands/slack/draftListDocument.js";
import { oneCardArtifactSchema, oneListArtifactSchema } from "../../../../../outbound/artifact/asMeSchema.js";
import { foldSlackDrafts } from "../../../../../outbound/slack/draftFold.js";
import type { DraftMediaOf } from "../../../../../outbound/slack/draftProof.js";
import {
  type ParkedDraftPayload,
  parkedDraftDigest,
  type SlackDraftItem,
} from "../../../../../outbound/slack/draftRegister.js";
import { renderDrip } from "../../../../../outbound/slack/dripRender.js";
import { renderFullChromeWrapper } from "../../../../../outbound/slack/render.js";
import type { SlackCardPayload, SlackDripMessagePayload } from "../../../../../outbound/slack/types.js";
import { annotatedRecord } from "../../../../annotatedShotFixture.js";

/** Where both halves read the contract; relative to this file, as `toMatchFileSnapshot` resolves it. */
const GOLDEN = "../../../../fixtures/contract/slack-draft-list.json";

/** The bytes of the one screenshot every fixture row but the bare one brings. */
const SHA = "1".repeat(64);

/** The annotated screenshot every row but `first-message-bare` carries, as its stored entry. */
const SHOT = { bytes: 68, name: "control.png", sha256: SHA };

/** A plain text element, the content every block fixture wraps. */
const TEXT: RichTextElement = { text: "quoted words", type: "text" };

/** One inline element of every type Slack admits — a missing or extra key fails the typecheck. */
const INLINE = {
  broadcast: { range: "here", type: "broadcast" },
  channel: { channel_id: "C0SYN000001", type: "channel" },
  color: { type: "color", value: "#1d9bd1" },
  date: { fallback: "Sun 27 Sep", format: "{date_short}", timestamp: 1_790_431_200, type: "date" },
  emoji: { name: "pray", type: "emoji" },
  link: { text: "ACME-101", type: "link", url: "https://linear.app/acme/issue/ACME-101" },
  team: { team_id: "T0SYN000001", type: "team" },
  text: TEXT,
  user: { type: "user", user_id: "U0SYN000001" },
  usergroup: { type: "usergroup", usergroup_id: "S0SYN000001" },
} satisfies Record<RichTextElement["type"], RichTextElement>;

/** One block-level element of every type Slack admits — a missing or extra key fails the typecheck. */
const BLOCK = {
  rich_text_list: {
    elements: [{ elements: [TEXT], type: "rich_text_section" }],
    style: "bullet",
    type: "rich_text_list",
  },
  rich_text_preformatted: { elements: [TEXT], type: "rich_text_preformatted" },
  rich_text_quote: { elements: [TEXT], type: "rich_text_quote" },
  rich_text_section: { elements: [TEXT], type: "rich_text_section" },
} satisfies Record<RichTextBlockElement["type"], RichTextBlockElement>;

/** A written one-card form in the shape of the four that blanked the cards: a quoted line, then a reply. */
const QUOTED_FORM = {
  kind: "one-card",
  lines: [
    { runs: [{ text: "> can you check the changelog too", type: "text" }] },
    { runs: [{ text: "checked the changelog side, thanks for sorting it 🙏", type: "text" }] },
  ],
};

/** A rich payload holding one block of exactly `elements`. */
function richPayload({ elements }: { elements: RichTextBlockElement[] }): SlackDripMessagePayload {
  const block: RichTextBlock = { elements, type: "rich_text" };
  return { blocks: [block], form: "rich", text: "fallback", unfurl_links: false, unfurl_media: false };
}

/** One held register row carrying exactly `payload`, the rest as the verb records one unless `over` says. */
function item({
  id,
  over = {},
  payload,
}: {
  id: string;
  over?: Partial<SlackDraftItem["draft"]>;
  payload: ParkedDraftPayload;
}): SlackDraftItem {
  return {
    draft: {
      advisory: [],
      channel: "C0SYN000001",
      digest: "6e1175e94259c84bd39a9c9156a1d554",
      form: "{}",
      id,
      kind: "message",
      media: [SHOT],
      mentions: [],
      payload,
      shape: "top-level",
      tsIso: "2026-09-28T06:13:44.268Z",
      why: "a contract fixture",
      ...over,
    },
    id,
    state: "held",
  };
}

/** The owner's yes, as `slack draft approve` binds it. */
const APPROVAL = {
  anchor: "talk-call:c0000001#12",
  atIso: "2026-10-08T00:16:54.000Z",
  heard: "Go ahead and send it",
};

/** A section of plain text, for the rows whose point is where they go rather than what they draw. */
const PLAIN = richPayload({ elements: [BLOCK.rich_text_section] });

/** The shipped as-me render of {@link QUOTED_FORM}. */
function renderedQuote(): SlackDripMessagePayload {
  const artifact = oneCardArtifactSchema({ cardVisibleMax: 2000, maxLines: 20 }).parse(QUOTED_FORM);
  return renderDrip({ artifact, mentions: { groups: new Map(), people: new Map() } })[0]!;
}

/** The shipped as-me render of a one-list whose second dot point nests under its first. */
function renderedNestedList(): SlackDripMessagePayload {
  const artifact = oneListArtifactSchema({ cardVisibleMax: 2000, maxBullets: 10, maxTrailing: 8 }).parse({
    bullets: [[{ text: "headline", type: "text" }], [{ text: "sub-point", type: "text" }]],
    depths: [0, 1],
    kind: "one-list",
    lead: [{ text: "lead", type: "text" }],
    trailing: [],
  });
  return renderDrip({ artifact, mentions: { groups: new Map(), people: new Map() } })[0]!;
}

/**
 * A bot card as `slack draft record --as bot` parks one (a finding shared top-level in a channel
 * posts as the bot): the shipped chrome wrapper around one content block, the card's own `text` empty.
 */
function botCard(): SlackCardPayload {
  const chrome = {
    authorEmoji: ":robot_face:",
    authorLabel: "acme-bot",
    bannerColor: "#7c3aed",
    detailLabel: "*Details*",
    metadataEventType: "slopweaver_card",
  };
  const wrapper = renderFullChromeWrapper({
    chrome,
    content: { elements: [BLOCK.rich_text_section], type: "rich_text" },
    details: [],
    fallback: "quoted words",
  });
  return {
    attachments: [wrapper],
    metadata: {
      event_payload: {
        artifactFingerprint: "0".repeat(16),
        artifactKind: "update",
        renderer: "slack-card-v1",
        schemaVersion: 1,
      },
      event_type: chrome.metadataEventType,
    },
    text: "",
    unfurl_links: false,
    unfurl_media: false,
  };
}

/** An approved row folded through `first`, which sets the owner's yes down, then a blocking `no-fleet-slot` hold over it. */
function setDownThenBlocked({
  first,
  id,
}: {
  first: "meaning-changed" | "not-owner-yes";
  id: string;
}): readonly SlackDraftItem[] {
  const { draft } = item({ id, over: { approval: APPROVAL }, payload: PLAIN });
  return foldSlackDrafts({
    events: [
      { draft, id, kind: "parked", tsIso: draft.tsIso },
      { id, kind: "held", reason: first, tsIso: "2026-10-08T02:02:00.000Z", why: "the requested date changed" },
      { id, kind: "held", reason: "no-fleet-slot", tsIso: "2026-10-08T02:03:00.000Z", why: "every seat is busy" },
    ],
  });
}

/** A written fold of the shape where A links to its receipt and Codex's ready B links nowhere. */
function codexDroppingTheLink({ id }: { id: string }): readonly SlackDraftItem[] {
  const linked = richPayload({ elements: [{ elements: [INLINE.link], type: "rich_text_section" }] });
  const { draft } = item({
    id,
    over: { comparison: { state: "pending" }, receipts: { kind: "attached", links: [INLINE.link.url], media: 0 } },
    payload: linked,
  });
  const digest = parkedDraftDigest({ draft: { channel: draft.channel, mentions: [], payload: PLAIN } });
  const candidate = { advisory: [], digest, form: "{}", mentions: [], payload: PLAIN };
  return foldSlackDrafts({
    events: [
      { draft, id, kind: "parked", tsIso: draft.tsIso },
      {
        id,
        kind: "compared",
        outcome: { candidate, elapsedMs: 4200, requestedModel: "gpt-test", state: "ready" },
        tsIso: "2026-09-28T06:14:00.000Z",
      },
    ],
  });
}

describe("slack draft list --json, the contract the console reads", () => {
  it("records a quoted line as rich_text_quote — the element that blanked every card", () => {
    expect(JSON.stringify(renderedQuote())).toContain('"type":"rich_text_quote"');
  });

  it("prints exactly the golden the console's reader is tested against", async () => {
    const items = [
      item({
        id: "inline-every-element",
        payload: richPayload({ elements: [{ elements: Object.values(INLINE), type: "rich_text_section" }] }),
      }),
      ...Object.entries(BLOCK).map(([type, element]) =>
        item({ id: `block-${type}`, payload: richPayload({ elements: [element] }) }),
      ),
      item({ id: "sd-00000001", payload: renderedQuote() }),
      item({ id: "nested-list", payload: renderedNestedList() }),
      // The two placements: a reply parked into its thread, and one parked top-level by mistake.
      item({
        id: "thread-reply",
        over: {
          shape: "thread",
          threadParent: {
            permalink: "https://acme.slack.com/archives/C0SYN000001/p1789407961767649",
            text: "build cache is cold",
            userId: "U0SYN000001",
          },
          threadTs: "1789407961.767649",
        },
        payload: PLAIN,
      }),
      item({ id: "thread-why-top-level", over: { why: "THREAD REPLY, not top-level" }, payload: PLAIN }),
      item({ id: "bot-finding", over: { actor: "bot", kind: "finding" }, payload: botCard() }),
      // Judged rows: the owner's yes kept but the send blocked, and their yes set down by a change of meaning.
      {
        ...item({ id: "held-approved-blocked", over: { approval: APPROVAL }, payload: PLAIN }),
        hold: { atIso: "2026-10-08T02:00:00.000Z", reason: "no-fleet-slot" as const, why: "every slot is busy" },
        judgedIso: "2026-10-08T02:00:00.000Z",
      },
      {
        ...item({ id: "held-meaning-changed", over: { meaningChanged: "the thread moved on" }, payload: PLAIN }),
        hold: { atIso: "2026-10-08T02:01:00.000Z", reason: "meaning-changed" as const, why: "the thread moved on" },
        judgedIso: "2026-10-08T02:01:00.000Z",
      },
      // A blocking hold folded over one that set the owner's yes down.
      ...setDownThenBlocked({ first: "not-owner-yes", id: "held-set-down-blocked" }),
      ...setDownThenBlocked({ first: "meaning-changed", id: "held-changed-blocked" }),
      // Its receipts, in each of the three shapes a recording parks with.
      item({
        id: "receipts-attached",
        over: { receipts: { kind: "attached", links: [INLINE.link.url], media: 0 } },
        payload: richPayload({ elements: [{ elements: [INLINE.link], type: "rich_text_section" }] }),
      }),
      item({
        id: "receipts-self-evident",
        over: { receipts: { kind: "self-evident", why: "the message is the question itself" } },
        payload: PLAIN,
      }),
      item({
        id: "receipts-tried",
        over: { receipts: { kind: "tried", tried: "the dashboard share link 403s outside the org" } },
        payload: PLAIN,
      }),
      ...codexDroppingTheLink({ id: "receipts-codex-drops" }),
      // A first message in a channel with no screenshot and no link: it lists every piece it owes.
      item({ id: "first-message-bare", over: { media: undefined }, payload: PLAIN }),
    ];
    const people = [
      {
        avatarUrl: undefined,
        bot: false,
        deactivated: false,
        firstNameUnique: true,
        handle: "person.one",
        name: "Person One",
        nameUnique: true,
        nativeId: "U0SYN000001",
        org: {
          department: "Imaginary Systems",
          orgUnit: "/Staff",
          title: { source: "google-admin" as const, value: "Imaginary Systems Specialist" },
          vantaGroups: ["Synthetic group", "Everyone"],
          vantaStatus: "CURRENT",
        },
        title: "Software Engineer",
      },
    ];

    // Every row but `first-message-bare` brings an annotated screenshot, so the first-message proof
    // leaves it only a link to owe; the bare row brings nothing and lists all three pieces. Read off each row's own
    // media, as `heldMediaOf` does, so a receipt names bytes the row carries.
    const mediaOf: DraftMediaOf = ({ item: one }) => {
      const { media } = one.draft;
      if (media === undefined) {
        return [];
      }
      return media.map((entry) => ({
        kind: "picture" as const,
        records: [annotatedRecord({ digest: `sha256:${entry.sha256}` })],
        sha256: entry.sha256,
      }));
    };
    await expect(`${JSON.stringify(draftListDocument({ items, mediaOf, people }), null, 2)}\n`).toMatchFileSnapshot(
      GOLDEN,
    );
  });
});
