/**
 * The held drafts on the owner's Queue as `talk find-card` searches them: asked a short, loose question about a
 * linear briefing draft, the voice must find the draft rather than name a card a stale key in a closed row pointed
 * at, while the Tobias Linear DM sits on the Queue as `post:sd-75646f68`. The drafts and rows are shaped on a past
 * incident's, with synthetic ids beside the two it named.
 */
import { describe, expect, it } from "vitest";

import type { DraftMediaOf } from "../../../outbound/slack/draftProof.js";
import {
  type ParkedSlackDraft,
  parkedDraftDigest,
  type SlackDraftItem,
} from "../../../outbound/slack/draftRegister.js";
import { type CardText, findCards } from "../../../talk/cardFind.js";
import { cardFindLines, DRAFTS_SHOWN } from "../../../talk/cardFindLines.js";
import { draftPath, draftsFound, onOwnerQueue, queueDraftsOf } from "../../../talk/queueDraftFind.js";
import { annotatedRecord } from "../../annotatedShotFixture.js";

/** One parked draft as the register stores it, a plain message as the owner unless told otherwise. */
function parked({
  actor,
  channel,
  channelName,
  id,
  kind = "message",
  mentions = [],
  row,
  text,
  why,
}: {
  actor?: "bot";
  channel: string;
  channelName?: string;
  id: string;
  kind?: "message" | "finding";
  mentions?: readonly string[];
  row?: string;
  text: string;
  why: string;
}): ParkedSlackDraft {
  const content = {
    authorId: "U0ME",
    channel,
    mentions: mentions.map((key) => ({ key, kind: "person" as const, target: `U${key.toUpperCase()}` })),
    payload: { form: "plain" as const, text, unfurl_links: false, unfurl_media: false },
  };
  return {
    ...content,
    ...(actor === undefined ? {} : { actor }),
    ...(channelName === undefined ? {} : { channelName }),
    ...(row === undefined ? {} : { row }),
    advisory: [],
    digest: parkedDraftDigest({ draft: content }),
    form: JSON.stringify({ sections: [{ kind: "prose", text }] }),
    id,
    kind,
    shape: "top-level",
    tsIso: "2026-10-20T02:41:50.437Z",
    why,
  };
}

/** A folded register row in `state`. */
const item = ({ draft, state }: { draft: ParkedSlackDraft; state: SlackDraftItem["state"] }): SlackDraftItem => ({
  draft,
  id: draft.id,
  state,
});

const RAISING_ROW =
  "the-tobias-draft-dm-becomes-three-sections-one-per-linear-project-asking-what-they-think-of-the-split";

const TOBIAS = parked({
  channel: "D0SYN000003",
  channelName: "D0SYN000003",
  id: "sd-75646f68",
  mentions: ["tobias"],
  row: RAISING_ROW,
  text: [
    "<@U0SYN000017> yep, here's the linear split i'm thinking, nothing created yet. what do you think?",
    "• The first project, which is the initiative",
    "  ◦ daily: where my time went on these three",
    "• The second project",
    "• The third project",
  ].join("\n"),
  why: "answers Tobias's ask for the Linear bullet points: the initiative and three projects as nested dot points",
});

/** The Tobias draft's message on one line, as a draft's line quotes it. */
const TOBIAS_SAYS =
  "<@U0SYN000017> yep, here's the linear split i'm thinking, nothing created yet. what do you think? • The first project, which is the initiative ◦ daily: where my time went on these three • The second project • The third project";

const DEVICE_CHECK = parked({
  channel: "C0SYN000001",
  channelName: "proj-launch-room",
  id: "sd-92e4dd66",
  text: "A stand-in claim about an unrelated device check; can its owners look at it this week? <https://fixture.example/tests/device-check|the test>",
  why: "card action: an unrelated device check",
});

const SHOT_SHA = "1".repeat(64);

/** Every row brings an annotated, unobstructed screenshot: what a first message in a channel owes besides its link. */
const CLEARED: DraftMediaOf = () => [
  { kind: "picture", records: [annotatedRecord({ digest: `sha256:${SHOT_SHA}` })], sha256: SHOT_SHA },
];

/** No row brings any attachment. */
const NO_MEDIA: DraftMediaOf = () => [];

/** The closed row that raised the Tobias draft, and relay rows carrying the owner's words about Linear and Tobias. */
const BOARD: readonly CardText[] = [
  {
    askedIso: "2026-10-20T02:30:00.000Z",
    path: `/board/${RAISING_ROW}.md`,
    slug: RAISING_ROW,
    texts: ["The Tobias draft DM becomes three sections, one per Linear project, asking what they think of the split"],
  },
  ...["talk-0c1cdda693f0", "talk-220c535008ec"].map((slug): CardText => ({
    askedIso: "2026-10-19T10:00:00.000Z",
    path: `/board/${slug}.md`,
    slug,
    texts: [`Words to the voice: the linear briefing for tobias, the draft card on the queue, ${slug}`],
  })),
  ...Array.from({ length: 20 }, (_, index): CardText => ({
    askedIso: undefined,
    path: `/board/other-${String(index)}.md`,
    slug: `other-${String(index)}`,
    texts: [`rotate the database credentials for cluster ${String(index)}`],
  })),
];

/** The owner's words on the call, exactly as the voice transcribed them. */
const HIS_WORDS = ["Where's that linear briefing? Or queue card draft"];

describe("onOwnerQueue", () => {
  it("holds a draft the Queue draws, and nothing it does not", () => {
    const finding = parked({ channel: "C1", channelName: "dev", id: "sd-f", kind: "finding", text: "x", why: "f" });
    const verdicts = [
      item({ draft: TOBIAS, state: "held" }),
      item({
        draft: {
          ...parked({ actor: "bot", channel: "C1", id: "sd-b", text: "a card", why: "bot" }),
          shape: "thread",
          threadTs: "1.2",
        },
        state: "held",
      }),
      item({ draft: TOBIAS, state: "released" }),
      item({ draft: TOBIAS, state: "dropped" }),
      item({ draft: finding, state: "held" }),
    ].map((one) => onOwnerQueue({ item: one, mediaOf: NO_MEDIA }));
    expect(verdicts).toEqual([true, true, false, false, false]);
  });

  it("holds a top-level channel draft off the Queue until it brings its screenshot, and the same one in a thread on it", () => {
    const top = item({ draft: DEVICE_CHECK, state: "held" });
    const thread = item({ draft: { ...DEVICE_CHECK, id: "sd-t", shape: "thread", threadTs: "1.2" }, state: "held" });
    expect(onOwnerQueue({ item: top, mediaOf: NO_MEDIA })).toBe(false);
    expect(onOwnerQueue({ item: thread, mediaOf: NO_MEDIA })).toBe(true);
    expect(onOwnerQueue({ item: top, mediaOf: CLEARED })).toBe(true);
  });

  it("names no no-proof top-level channel draft to the voice's card search", () => {
    const queued = queueDraftsOf({
      items: [item({ draft: DEVICE_CHECK, state: "held" })],
      mediaOf: NO_MEDIA,
      rowSummaries: new Map(),
    });
    expect(queued).toEqual([]);
  });
});

describe("queueDraftsOf", () => {
  it("searches a draft on its why, its words, who it tags, where it goes and the row that raised it, never a slug", () => {
    const [found] = queueDraftsOf({
      items: [item({ draft: TOBIAS, state: "held" })],
      mediaOf: NO_MEDIA,
      rowSummaries: new Map([[RAISING_ROW, ["first summary", "second summary"]]]),
    });
    expect(found!.draft).toEqual({
      as: "you",
      id: "sd-75646f68",
      key: "post:sd-75646f68",
      says: TOBIAS_SAYS,
      to: "a direct message",
      why: TOBIAS.why,
    });
    expect(found!.text.path).toBe(draftPath({ id: "sd-75646f68" }));
    expect(found!.text.texts.slice(-4)).toEqual(["tobias", "a direct message", "first summary", "second summary"]);
    expect(found!.text.texts.join(" ")).not.toContain(RAISING_ROW);
    expect(found!.text.texts[0]).toBe(TOBIAS.why);
  });

  it("says a channel draft goes to its channel, a thread reply in it, and a bot one as the bot", () => {
    const thread = { ...DEVICE_CHECK, id: "sd-t", shape: "thread" as const, threadTs: "1.2" };
    const bot = { ...DEVICE_CHECK, actor: "bot" as const, id: "sd-bot" };
    const named = queueDraftsOf({
      items: [DEVICE_CHECK, thread, bot].map((draft) => item({ draft, state: "held" })),
      mediaOf: CLEARED,
      rowSummaries: new Map(),
    }).map((one) => `${one.draft.to} as ${one.draft.as}`);
    expect(named).toEqual([
      "#proj-launch-room as you",
      "a thread reply in #proj-launch-room as you",
      "#proj-launch-room as the bot",
    ]);
  });
});

describe("find-card over the owner's exact words", () => {
  const queued = queueDraftsOf({
    items: [item({ draft: DEVICE_CHECK, state: "held" }), item({ draft: TOBIAS, state: "held" })],
    mediaOf: CLEARED,
    rowSummaries: new Map([[RAISING_ROW, [BOARD[0]!.texts[0]!]]]),
  });
  const search = findCards({ rows: [...BOARD, ...queued.map((one) => one.text)], words: HIS_WORDS });
  const drafts = draftsFound({ queued, rows: BOARD, words: HIS_WORDS });

  it("finds the Tobias draft, and never the device-check one", () => {
    expect(drafts.map((draft) => draft.key)).toEqual(["post:sd-75646f68"]);
  });

  // The words the voice itself passed find-card on that turn.
  it("finds it by the voice's own find-card words too, the one draft they match", () => {
    const voice = draftsFound({ queued, rows: BOARD, words: ["Tobias Linear briefing draft three projects DM"] });
    expect(voice.map((draft) => draft.key)).toEqual(["post:sd-75646f68"]);
  });

  it("finds no draft when none is held, whatever the words", () => {
    expect(draftsFound({ queued: [], rows: BOARD, words: HIS_WORDS })).toEqual([]);
  });

  it("names the draft first, by the Queue key that opens it, above the closed row that raised it", () => {
    const lines = cardFindLines({
      closeAtTop: search.closeAtTop,
      drafts,
      draftsSearched: queued.length,
      placed: [
        {
          matched: ["linear", "draft"],
          ownerWait: "not-waiting",
          section: "DONE",
          slug: RAISING_ROW,
          summary: BOARD[0]!.texts[0],
          unchecked: false,
        },
      ],
      rowsSearched: BOARD.length,
      said: HIS_WORDS,
      unsearchable: [],
    });
    expect(lines.slice(1, 3)).toEqual([
      "held drafts on your Queue (open_card the key to put one in front of the owner):",
      `  post:sd-75646f68 — on your Queue, a held draft waiting on your word, to a direct message as you — ${TOBIAS.why} — it says "<@U0SYN000017> yep, here's the linear split i'm thinking, nothing created yet. what do you think? • The first project, …" (matched ${drafts[0]!.matched.join(", ")})`,
    ]);
    expect(lines.slice(3)).toEqual([
      "board rows:",
      "  no LIVE row matches: every match below is closed",
      "closed:",
      `  ${RAISING_ROW} — done [DONE] — ${BOARD[0]!.texts[0]!} (matched linear, draft)`,
    ]);
    expect(lines.filter((line) => line.includes("post:sd-75646f68"))).toHaveLength(1);
  });
});

// A draft matched on its words, under a `why` a recut left stale, showed only that why,
// so the voice could judge the right draft as about something else and tell the owner it was not found.
describe("a held draft whose why went stale", () => {
  it("is found by its words, and its line quotes those words beside the stale why", () => {
    const recut = parked({
      channel: "D0SYN000003",
      id: "sd-recut00",
      text: "Here is the Linear briefing and three-project split for Tobias",
      why: "action: an unrelated device check",
    });
    const queued = queueDraftsOf({
      items: [item({ draft: recut, state: "held" })],
      mediaOf: NO_MEDIA,
      rowSummaries: new Map(),
    });
    const search = findCards({ rows: [...BOARD, ...queued.map((one) => one.text)], words: ["linear briefing tobias"] });
    const found = search.found.find((card) => card.path === draftPath({ id: "sd-recut00" }))!;
    const lines = cardFindLines({
      closeAtTop: 1,
      drafts: [{ ...queued[0]!.draft, matched: found.matched }],
      draftsSearched: 1,
      placed: [],
      rowsSearched: BOARD.length,
      said: ["linear briefing tobias"],
      unsearchable: [],
    });
    expect(lines[2]).toBe(
      `  post:sd-recut00 — on your Queue, a held draft waiting on your word, to a direct message as you — action: an unrelated device check — it says "Here is the Linear briefing and three-project split for Tobias" (matched ${found.matched.join(", ")})`,
    );
    expect(found.matched).toEqual(["linear", "briefing", "tobia"]);
  });

  // The words it matched sat past the opening the line quotes, so the line showed only
  // the stale why and an opening about the device check.
  it("quotes where its words match when that lies past the opening", () => {
    const opening =
      "A stand-in opening about an unrelated device check, written long enough on purpose that every word the search matches sits past it.";
    const tail = "Separately, here is the Linear briefing and three-project split for Tobias.";
    const recut = parked({
      channel: "D0SYN000003",
      id: "sd-recut01",
      text: `${opening} ${tail}`,
      why: "action: an unrelated device check",
    });
    const queued = queueDraftsOf({
      items: [item({ draft: recut, state: "held" })],
      mediaOf: NO_MEDIA,
      rowSummaries: new Map(),
    });
    const search = findCards({ rows: [...BOARD, ...queued.map((one) => one.text)], words: ["linear briefing tobias"] });
    const found = search.found.find((card) => card.path === draftPath({ id: "sd-recut01" }))!;
    const lines = cardFindLines({
      closeAtTop: 1,
      drafts: [{ ...queued[0]!.draft, matched: found.matched }],
      draftsSearched: 1,
      placed: [],
      rowsSearched: BOARD.length,
      said: ["linear briefing tobias"],
      unsearchable: [],
    });
    expect(opening.length).toBe(131);
    expect(lines[2]).toBe(
      `  post:sd-recut01 — on your Queue, a held draft waiting on your word, to a direct message as you — action: an unrelated device check — it says "${opening.slice(0, 119)}…" … and where it matches, "…${tail}" (matched linear, briefing, tobia)`,
    );
  });
});

describe("cardFindLines with held drafts", () => {
  it("caps the drafts it names and says how many more matched", () => {
    const drafts = Array.from({ length: DRAFTS_SHOWN + 2 }, (_, index) => ({
      as: "you" as const,
      id: `sd-${String(index)}`,
      key: `post:sd-${String(index)}` as const,
      matched: ["vanta"],
      says: "Vanta is at 71%",
      to: "#proj-launch-room",
      why: `card action ${String(index)}`,
    }));
    const lines = cardFindLines({
      closeAtTop: 1,
      drafts,
      draftsSearched: 40,
      placed: [],
      rowsSearched: 9,
      said: ["vanta"],
      unsearchable: [],
    });
    expect(lines[0]).toBe(
      `${String(DRAFTS_SHOWN + 2)} held draft(s) and 0 board row(s) matching "vanta", best first, drafts on the owner's Queue first, then live rows (searched 9 board rows' summaries, the owner's words and open questions, and 40 held drafts on the owner's Queue)`,
    );
    expect(lines.slice(-1)).toEqual(["  …2 more held draft(s) not shown — pass fewer, rarer words"]);
    expect(lines).toHaveLength(DRAFTS_SHOWN + 3);
  });
});
