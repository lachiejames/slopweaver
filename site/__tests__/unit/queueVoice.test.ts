/*
 * What `read_page` returns on the Queue: the open card, flattened from the SAME row the panel draws, and a
 * bounded list of what else is drawn. Driven through the real board reader so the row is one the page
 * would actually hold.
 */

import { describe, expect, it } from "vitest";

import { type HandStep, readBoard } from "../../components/live/read";
import { type CardLandings, readCardLandings } from "../../components/live/readCardLandings";
import { type ParkedDraft, readParkedDrafts } from "../../components/live/readSlackDrafts";
import type { LiveState } from "../../components/live/useLive";
import { openCardReads } from "../../components/voice/voiceRecordWiring";
import { cardDraftLinkUrls, cardDraftTexts } from "../../lib/cardDraftBriefings";
import { cardLinksOf } from "../../lib/openCard";
import { openCardDraftForVoice } from "../../lib/openCardDraft";
import { layoutForVoice, QUEUE_SHOWN, standingRows } from "../../lib/queueLayout";
import { type QueueRow, rowsOf } from "../../lib/queueRows";
import { cardForVoice, cardRefusal, QUEUE_VOICE_ROWS } from "../../lib/queueVoice";
import { NO_STEERS } from "../../lib/steeredCards";
import type { WorkspacePlacement } from "../../lib/workspacePlacement";
import { findingLabel } from "../../lib/workspacePlacementContext";
import { ACME_PLACER } from "../organisationFixture";
import { briefingOf } from "./cardKind";
import { queueForVoice, queueLayout, spokenOf } from "./inItsOwnView";
import { askRow, LOADING, ready } from "./queueVoiceFixture";

/** A hand step whose sentence names a local page, as `hand list --json` records one. */
const STEP: HandStep = {
  checkIn: false,
  checklist: undefined,
  cites: [],
  context: undefined,
  decision: undefined,
  id: "read-the-plan",
  ifIgnored: undefined,
  integration: undefined,
  keptReason: undefined,
  literal: "slopweaver hand done read-the-plan",
  postedBy: "workspace:12",
  postedIso: "2026-09-27T02:00:00.000Z",
  row: undefined,
  opened: undefined,
  rowProblem: undefined,
  secrets: [],
  shot: undefined,
  unaddressed: undefined,
  unblocks: "the plan pick",
  url: undefined,
  what: "Read file:///Users/someone/.slopweaver/pages/plan/index.html",
  where: undefined,
  witness: undefined,
};

/** The one hand row a step yields — `STEP` unless a case names another. */
function handRow({ step = STEP }: { step?: HandStep } = {}): QueueRow {
  const rows = rowsOf({
    reviewers: LOADING,
    standing: LOADING,
    acts: LOADING,
    board: LOADING,
    drafts: LOADING,
    hands: ready({ value: [step] }),
    landing: LOADING,
    placer: ACME_PLACER,
    posts: LOADING,
    reviews: LOADING,
    imports: LOADING,
  });
  expect(rows.length).toBe(1);
  return rows[0];
}

/** One held post, its item fields laid over by `item`, as `slack draft list --json` records one. */
function postRow({ item = {} }: { item?: Record<string, unknown> } = {}): QueueRow {
  const plain = ({ text }: { text: string }) => ({ form: "plain", text, unfurl_links: false, unfurl_media: false });
  const parked = {
    items: [
      {
        draft: {
          advisory: [],
          channel: "C0ISO",
          composer: "claude-code",
          digest: "3f2a9c11d4e5b6a7",
          mentions: [],
          payload: plain({ text: "This is still open. The review is pending and the doc is unpublished." }),
          shape: "top-level",
          tsIso: "2026-10-13T03:12:00.000Z",
          why: "the onboarding doc follow-up",
        },
        id: "sd-30e3b8b1",
        release: {
          command: "slopweaver slack post --as me --draft sd-30e3b8b1 --approve 3f2a9c11d4e5b6a7",
          kind: "send",
        },
        state: "held",
        ...item,
      },
    ],
    people: [],
  };
  const rows = rowsOf({
    reviewers: LOADING,
    standing: LOADING,
    acts: LOADING,
    board: LOADING,
    drafts: LOADING,
    hands: LOADING,
    landing: LOADING,
    placer: ACME_PLACER,
    posts: ready({ value: readParkedDrafts(parked)! }),
    reviews: LOADING,
    imports: LOADING,
  });
  expect(rows.map((row) => row.key)).toEqual(["post:sd-30e3b8b1"]);
  return rows[0];
}

/** A held draft whose one rich-text line links `url` behind the label "the briefing". */
function linkedDraft({ url }: { url: string }): Record<string, unknown> {
  const link = { text: "the briefing", type: "link", url };
  return {
    advisory: [],
    channel: "C0ISO",
    composer: "claude-code",
    digest: "3f2a9c11d4e5b6a7",
    mentions: [],
    payload: {
      blocks: [
        {
          elements: [{ elements: [{ text: "Read ", type: "text" }, link], type: "rich_text_section" }],
          type: "rich_text",
        },
      ],
      text: "Read the briefing",
    },
    shape: "top-level",
    tsIso: "2026-10-13T03:12:00.000Z",
    why: "the onboarding doc follow-up",
  };
}

/** The held draft a post card carries. */
function parkedOf({ row }: { row: QueueRow }): ParkedDraft {
  expect(row.record.kind).toBe("post");
  return (row.record as Extract<QueueRow["record"], { kind: "post" }>).post;
}

/** A ready Codex comparison on the held post, so the owner's pick between A and B is owed. */
const COMPARISON = {
  atIso: "2026-10-13T03:13:00.000Z",
  candidate: {
    advisory: [],
    digest: "c0dec0dec0dec0de",
    form: "{}",
    mentions: [],
    payload: { form: "plain", text: "B words", unfurl_links: false, unfurl_media: false },
  },
  elapsedMs: 4200,
  requestedModel: "gpt-test",
  state: "ready",
};

// A question about the reply over a one-draft card, where the voice could only paraphrase it.
describe("cardForVoice on a post card", () => {
  it("carries the words a one-draft card would send, and no A/B pick", () => {
    const card = cardForVoice({ row: postRow() });
    expect(card.draft).toBe("This is still open. The review is pending and the doc is unpublished.");
    expect(card.drafts).toEqual([]);
  });

  it("carries A's words as the draft while a pick between A and B is owed", () => {
    const card = cardForVoice({ row: postRow({ item: { comparison: COMPARISON } }) });
    expect(card.draft).toBe("This is still open. The review is pending and the doc is unpublished.");
    expect(card.drafts.map((one) => [one.letter, one.by, one.text])).toEqual([
      ["A", "Claude", "This is still open. The review is pending and the doc is unpublished."],
      ["B", "Codex", "B words"],
    ]);
  });

  it("carries no draft on a card that is not a post", () => {
    expect(cardForVoice({ row: askRow() }).draft).toBe(undefined);
    expect(cardForVoice({ row: handRow() }).draft).toBe(undefined);
  });

  // A briefing only the draft linked was never read nor counted.
  it("reads a briefing only the card's held draft links", () => {
    const text = "Read file:///Users/someone/.slopweaver/pages/orb-notes/index.html first.";
    const draft = {
      advisory: [],
      channel: "C0ISO",
      composer: "claude-code",
      digest: "3f2a9c11d4e5b6a7",
      mentions: [],
      payload: { form: "plain", text, unfurl_links: false, unfurl_media: false },
      shape: "top-level",
      tsIso: "2026-10-13T03:12:00.000Z",
      why: "the onboarding doc follow-up",
    };
    const row = postRow({ item: { draft } });
    expect([cardDraftTexts({ row }), cardLinksOf({ row }).briefings]).toEqual([[text], ["orb-notes"]]);
  });

  // A link run draws only its label, so its address was never scanned.
  it("reads a briefing the held draft links only behind a label", () => {
    const url = "http://localhost:3000/api/page/orb-notes/index.html";
    const row = postRow({ item: { draft: linkedDraft({ url }) } });
    expect([cardDraftTexts({ row }), cardDraftLinkUrls({ row }), cardLinksOf({ row }).briefings]).toEqual([
      ["Read the briefing"],
      [url],
      ["orb-notes"],
    ]);
  });

  // An ask card naming two held drafts sent neither, so neither was searched.
  it("reads a briefing any of an ask card's several held drafts links", () => {
    const first = parkedOf({ row: postRow({ item: { draft: linkedDraft({ url: "https://acme.example/a" }) } }) });
    const url = "http://localhost:3000/api/page/plan/index.html";
    const second = parkedOf({ row: postRow({ item: { draft: linkedDraft({ url }) } }) });
    const ask = askRow();
    expect(ask.record.kind).toBe("ask");
    const record = ask.record as Extract<QueueRow["record"], { kind: "ask" }>;
    const drafts = [
      { draft: first, id: "sd-1", kind: "held" as const },
      { draft: second, id: "sd-2", kind: "held" as const },
    ];
    const row: QueueRow = { ...ask, record: { ...record, drafts } };
    expect([cardDraftLinkUrls({ row }), cardLinksOf({ row }).briefings]).toEqual([
      ["https://acme.example/a", url],
      ["plan"],
    ]);
  });

  // An ask card's example scenes are drawn, yet were never searched.
  it("reads a briefing only an ask card's example, why-you or copy block names", () => {
    const ask = askRow();
    expect(ask.card.kind).toBe("briefing");
    const card = ask.card as Extract<QueueRow["card"], { kind: "briefing" }>;
    const scene = "You open http://localhost:3000/api/page/plan/index.html and see the rollout date.";
    const row: QueueRow = {
      ...ask,
      card: {
        ...card,
        commands: ["open file:///Users/someone/.slopweaver/pages/dead-code/index.html"],
        examples: { kind: "scenes", scenes: [scene] },
        whyYou: "Only you can read http://127.0.0.1:3000/api/page/orb-notes/index.html first.",
      },
    };
    expect(cardLinksOf({ row }).briefings).toEqual(["plan", "dead-code", "orb-notes"]);
  });

  // An ask's offered Slack action was drawn, yet no field list named it. Every string the
  // row carries is searched now, so the next drawn field needs no name either.
  it("reads a briefing only an ask card's offered Slack action names, in its body or a follow-up", () => {
    const ask = askRow();
    expect(ask.record.kind).toBe("ask");
    const record = ask.record as Extract<QueueRow["record"], { kind: "ask" }>;
    const action = {
      actor: "me",
      body: "Please read http://localhost:3000/api/page/plan/index.html",
      destinations: [],
      followUps: ["then <file:///Users/someone/.slopweaver/pages/orb-notes/index.html|the notes>"],
      mentions: [],
    };
    const row: QueueRow = {
      ...ask,
      record: { ...record, row: { ...record.row, action: { action, kind: "action" } } },
    };
    expect([cardLinksOf({ row: ask }).briefings, cardLinksOf({ row }).briefings]).toEqual([[], ["plan", "orb-notes"]]);
  });

  // A held reply's own words and citations were never searched.
  it("reads a briefing a held reply names in its words or behind a citation", () => {
    const post = postRow();
    const draft = {
      askedBy: "U0123",
      channel: "C0SYN000001",
      citations: [{ label: "the plan", url: "http://localhost:3000/api/page/plan/index.html" }],
      id: "draft-7",
      lead: "Short answer: yes.",
      messageTs: "1760000000.000100",
      permalink: undefined,
      question: "Is the rollout planned?",
      reason: "the answer names a date no verb measured",
      state: "held",
      text: "Read file:///Users/someone/.slopweaver/pages/orb-notes/index.html, then the plan.",
      threadTs: "1760000000.000100",
      tsIso: "2026-10-13T03:12:00.000Z",
    };
    const row: QueueRow = { ...post, record: { draft, form: post.record.form, kind: "draft" } };
    expect([cardDraftTexts({ row }), cardDraftLinkUrls({ row }), cardLinksOf({ row }).briefings]).toEqual([
      [draft.lead, draft.text],
      [draft.citations[0].url],
      ["plan", "orb-notes"],
    ]);
  });
});

describe("openCardDraftForVoice", () => {
  it("hands a turn the one draft of the post card the owner's words began over", () => {
    expect(openCardDraftForVoice({ key: "post:sd-30e3b8b1", rows: [askRow(), postRow()] })).toEqual({
      draft: "This is still open. The review is pending and the doc is unpublished.",
      key: "post:sd-30e3b8b1",
      kind: "single",
    });
  });

  it("hands A and B, and no single draft, while the owner's pick between them is owed", () => {
    const row = postRow({ item: { comparison: COMPARISON } });
    expect(openCardDraftForVoice({ key: "post:sd-30e3b8b1", rows: [row] })).toEqual({
      drafts: [
        { by: "Claude", letter: "A", text: "This is still open. The review is pending and the doc is unpublished." },
        { by: "Codex", letter: "B", text: "B words" },
      ],
      key: "post:sd-30e3b8b1",
      kind: "comparison",
    });
  });

  it("hands nothing for no open card, a key on no row, or a card that is not a post", () => {
    const rows = [askRow(), handRow(), postRow()];
    const none = [undefined, "post:sd-gone", askRow().key, handRow().key].map((key) =>
      openCardDraftForVoice({ key, rows }),
    );
    expect(none).toEqual([undefined, undefined, undefined, undefined]);
  });

  it("on the page, hands the draft of a card the owner has open after it left the Queue, as read_card reads one", () => {
    const left = postRow();
    const removed = { atIso: "2026-10-13T03:20:09.000Z", why: "sent" };
    const reads = openCardReads({
      cards: () => ({ recentlyLeft: [{ removed, row: left }], rows: [askRow()] }),
      gateLog: { current: [] },
    });
    expect(reads.openCardDraft({ key: "post:sd-30e3b8b1" })).toEqual({
      draft: "This is still open. The review is pending and the doc is unpublished.",
      key: "post:sd-30e3b8b1",
      kind: "single",
    });
  });
});

describe("cardForVoice on a hand step", () => {
  it("reads the step's sentence exactly as recorded, and its own rows and paste", () => {
    const card = cardForVoice({ row: handRow() });
    expect(card.question).toBe(STEP.what);
    expect(card.what).toBe(STEP.what);
    expect(card.rows).toEqual([{ label: "unblocks", value: "the plan pick" }]);
    expect(card.pastes).toEqual(["slopweaver hand done read-the-plan"]);
    expect(card.refused).toBe(undefined);
    expect(cardRefusal({ row: handRow() })).toBe(undefined);
  });

  it("reads a refused card as its sentence and the refusal, with none of the card it refused", () => {
    const row = handRow();
    const why = 'This card would draw text its step did not record ("x"), so it is refused rather than drawn.';
    if (row.record.kind !== "hand") {
      throw new Error(`expected a hand row, got ${row.record.kind}`);
    }
    const refused: QueueRow = { ...row, record: { ...row.record, form: { kind: "refused", why } } };
    const card = cardForVoice({ row: refused });
    expect(cardRefusal({ row: refused })).toBe(why);
    expect(card.refused).toBe(why);
    expect(card.what).toBe(STEP.what);
    expect(card.question).toBe(STEP.what);
    expect(card.rows).toEqual([]);
    expect(card.pastes).toEqual([]);
    expect(card.options).toEqual([]);
  });

  it("reads the do-nothing line as the card's ifSilent, and none on a step that carries none", () => {
    const ifIgnored = "the plan pick waits, and the next seat runs on the old plan";
    expect(cardForVoice({ row: handRow({ step: { ...STEP, ifIgnored } }) }).ifSilent).toBe(ifIgnored);
    expect(cardForVoice({ row: handRow() }).ifSilent).toBe(undefined);
  });
});

describe("spokenOf on a hand step — the talk action items", () => {
  it("says the do-nothing line as ifSilent", () => {
    const ifIgnored = "the plan pick waits, and the next seat runs on the old plan";
    expect(spokenOf({ row: handRow({ step: { ...STEP, ifIgnored } }) }).ifSilent).toBe(ifIgnored);
  });

  it("says a drawn step's sentence and what it unblocks, and no refusal", () => {
    const item = spokenOf({ row: handRow() });
    expect(item.question).toBe(STEP.what);
    expect(item.unblocks).toBe("the plan pick");
    expect(item.refused).toBe(undefined);
  });

  it("carries the workspace mark the page draws on a finding, and none on a row placed plainly", () => {
    const row = handRow();
    const finding = spokenOf({ row: { ...row, placement: { kind: "unplaced", why: "no address" } } });
    expect(finding.workspaceMark).toBe(
      "placed by default: no workspace · placed in self by default: no field names a workspace: no address",
    );
    const placed = spokenOf({
      row: { ...row, placement: { by: [], kind: "placed", workspace: "team" } },
    });
    expect(placed.workspaceMark).toBe(undefined);
  });

  it("flags a refused card with its reason, and says none of what was refused", () => {
    const row = handRow();
    if (row.record.kind !== "hand") {
      throw new Error(`expected a hand row, got ${row.record.kind}`);
    }
    const why = 'This card would draw text its step did not record ("x"), so it is refused rather than drawn.';
    const item = spokenOf({ row: { ...row, record: { ...row.record, form: { kind: "refused", why } } } });
    expect(item.refused).toBe(why);
    expect(item.question).toBe(STEP.what);
    expect(item.unblocks).toBe(undefined);
    expect(item.problem).toBe(undefined);
    expect(item.lean).toBe(undefined);
  });
});

describe("cardForVoice", () => {
  it("carries the open card's workspace mark, so a row opened from a fold is never read out without it", () => {
    expect(cardForVoice({ row: askRow() }).mark!.label).toBe("placed by default: no workspace");
    const acme: WorkspacePlacement = {
      by: [{ source: "stated", value: "workspace: team", workspace: "team" }],
      kind: "placed",
      workspace: "team",
    };
    expect(cardForVoice({ row: { ...askRow(), placement: acme } }).mark).toBe(undefined);
  });

  // The ask card's why-you and if-silent were one sentence on every card and went unread
  // so the card draws neither — and the voice, reading the same row, carries neither either.
  it("carries no why-you and no if-silent on an ask, to the voice or the talk action items", () => {
    const row = askRow();
    const voice = cardForVoice({ row });
    const spoken = spokenOf({ row });
    expect([voice.whyYou, voice.ifSilent, spoken.whyYou, spoken.ifSilent]).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("names the board slug board_row takes on an ask", () => {
    expect(cardForVoice({ row: askRow() }).boardSlug).toBe("acme-ask-6-sep-turn-95-1-give");
  });

  it("carries the card's own question and asked instant", () => {
    const card = cardForVoice({ row: askRow() });
    expect(card.question).toBe("Which lands first, the schema or the card?");
    expect(card.askedIso).toBe("2026-09-06T09:00:00.000Z");
    expect(card.kind).toBe("ask");
  });

  it("reads the options the panel letters, in the panel's order", () => {
    const row = askRow();
    expect(cardForVoice({ row }).options).toEqual(
      briefingOf({ card: row.card }).options.map((option) => ({ letter: option.letter, sentence: option.sentence })),
    );
    expect(cardForVoice({ row }).options[0]).toEqual({
      letter: "A",
      sentence: briefingOf({ card: row.card }).options[0].sentence,
    });
  });

  it("reads no problem or lean on an ask that records neither, and its form is drawn", () => {
    const row = askRow();
    const card = cardForVoice({ row });
    expect([card.problem, card.lean, card.refused]).toEqual([undefined, undefined, undefined]);
    expect(row.record.form).toEqual({ kind: "drawn" });
  });

  it("reads a refused briefing card as its question and the refusal, with none of the card it refused", () => {
    const row = askRow();
    const why = 'This card would draw a lean its record does not hold ("x"), so it is refused rather than drawn.';
    if (row.record.kind !== "ask") {
      throw new Error(`expected an ask row, got ${row.record.kind}`);
    }
    const refused: QueueRow = { ...row, record: { ...row.record, form: { kind: "refused", why } } };
    const card = cardForVoice({ row: refused });
    const spoken = spokenOf({ row: refused });
    expect([card.refused, card.what, card.whyYou, card.ifSilent, card.options]).toEqual([
      why,
      undefined,
      undefined,
      undefined,
      [],
    ]);
    expect([spoken.refused, spoken.whyYou, spoken.ifSilent]).toEqual([why, undefined, undefined]);
    expect(card.question).toBe("Which lands first, the schema or the card?");
  });
});

describe("queueForVoice", () => {
  it("reads the open card whole and carries no count the page does not print", () => {
    const row = askRow();
    const reading = queueForVoice({
      folded: [],
      drawn: [row],
      open: row,
      unread: ["drafts"],
      withheld: 0,
    });
    expect(reading.open).toEqual(cardForVoice({ row }));
    expect(reading.unread).toEqual(["drafts"]);
    expect(Object.keys(reading).toSorted()).toEqual([
      "drawn",
      "drawnKeys",
      "drawnMarked",
      "drawnMore",
      "folded",
      "open",
      "openLeft",
      "tags",
      "unread",
      "view",
      "withheld",
    ]);
    expect(reading.drawn).toEqual([
      { key: row.key, mark: findingLabel({ placement: row.placement }), pill: row.pill, question: row.card.question },
    ]);
    expect(reading.drawn[0].mark!.label).toBe("placed by default: no workspace");
    expect(reading.drawnMore).toBe(false);
  });

  it("carries no card when nothing is open", () => {
    const reading = queueForVoice({
      folded: [],
      drawn: [askRow()],
      open: undefined,
      unread: [],
      withheld: 0,
    });
    expect(reading.open).toBe(undefined);
  });

  it("says how many cards the page holds off for failing their own checks", () => {
    const reading = queueForVoice({
      folded: [],
      drawn: [askRow()],
      open: undefined,
      unread: [],
      withheld: 2,
    });
    expect([reading.withheld, reading.drawn.length]).toEqual([2, 1]);
  });

  it("says the selector's own figure beside its words, a check-in counted though it waits on no word", () => {
    const view = { count: 1, label: "Check-ins" };
    const reading = queueForVoice({
      folded: [],
      drawn: [askRow()],
      open: undefined,
      unread: [],
      view,
      withheld: 0,
    });
    expect(reading.view).toEqual({ count: 1, label: "Check-ins" });
  });

  it("lists at most QUEUE_VOICE_ROWS drawn rows and says only that there are more", () => {
    const row = askRow();
    const drawn = Array.from({ length: QUEUE_VOICE_ROWS + 3 }, () => row);
    const reading = queueForVoice({ folded: [], drawn, open: undefined, unread: [], withheld: 0 });
    expect(reading.drawn).toHaveLength(QUEUE_VOICE_ROWS);
    expect(reading.drawnMore).toBe(true);
  });

  it("says nothing of more while a tag filter waits on the board", () => {
    const reading = queueForVoice({
      drawn: [],
      folded: [],
      open: undefined,
      tags: { hidden: undefined, ignored: [], selectors: ["workstream:iso"] },
      unread: ["recorded asks"],
      withheld: 0,
    });
    expect([reading.drawn, reading.drawnMore]).toEqual([[], undefined]);
    expect(reading.drawnMarked).toBe(undefined);
  });

  it("says whether a tag filter hides cards, never how many beside the selector's figure", () => {
    const tags = { hidden: true, ignored: [], selectors: ["team:x"] };
    const reading = queueForVoice({ drawn: [askRow()], folded: [], open: undefined, tags, unread: [], withheld: 0 });
    expect([reading.tags, reading.drawnMore]).toEqual([{ hidden: true, ignored: [], selectors: ["team:x"] }, false]);
  });

  it("says whether a row past the list carries a workspace mark, so a finding is never folded out of hearing", () => {
    const acme: WorkspacePlacement = {
      by: [{ source: "stated", value: "workspace: team", workspace: "team" }],
      kind: "placed",
      workspace: "team",
    };
    const placed = { ...askRow(), placement: acme };
    const drawn = [...Array.from({ length: QUEUE_VOICE_ROWS + 2 }, () => placed), askRow()];
    const reading = queueForVoice({ folded: [], drawn, open: undefined, unread: [], withheld: 0 });
    expect([reading.drawnMore, reading.drawnMarked]).toEqual([true, true]);
    expect(reading.drawn[0].mark).toBe(undefined);
  });

  it("passes every register fold through with its marked count, so a finding the page folded is never unheard", () => {
    const folded = [{ count: 1, marked: 1, register: "ask", tier: "blocking" }];
    const reading = queueForVoice({ drawn: [askRow()], folded, open: undefined, unread: [], withheld: 0 });
    expect([reading.folded, reading.drawnMore, reading.drawnMarked]).toEqual([folded, false, false]);
  });

  it("reads a finding the page folded as a marked fold, through the page's own layout", () => {
    const acme: WorkspacePlacement = {
      by: [{ source: "stated", value: "team", workspace: "team" }],
      kind: "placed",
      workspace: "team",
    };
    const placed = Array.from({ length: QUEUE_SHOWN }, (_, at) => ({
      ...askRow(),
      key: `ask:placed-${String(at)}`,
      placement: acme,
    }));
    const finding = askRow();
    const layout = queueLayout({ expanded: [], focuses: [], rows: [...placed, finding] });
    const reading = queueForVoice({
      ...layoutForVoice({ layout }),
      open: undefined,
      unread: [],
      withheld: 0,
    });
    expect(reading.drawn.map((row) => row.key)).toEqual(placed.map((row) => row.key));
    expect(reading.folded).toEqual([{ count: 1, marked: 1, register: "ask", tier: finding.tier }]);
    const opened = queueForVoice({
      ...layoutForVoice({ layout: queueLayout({ expanded: ["ask"], focuses: [], rows: [...placed, finding] }) }),
      open: undefined,
      unread: [],
      withheld: 0,
    });
    expect([opened.folded, opened.drawn.at(-1)!.mark!.label]).toEqual([[], "placed by default: no workspace"]);
  });

  it("never folds a card saying why the owner's yes is not sent, so the page and the voice both carry it", () => {
    const shown = Array.from({ length: QUEUE_SHOWN + 1 }, (_, at) => ({ ...askRow(), key: `ask:row-${String(at)}` }));
    const ninth = { ...shown[QUEUE_SHOWN], saysWhyNotSent: true as const };
    const tenth = { ...askRow(), key: "ask:row-tenth" };
    const rows = [...shown.slice(0, QUEUE_SHOWN), ninth, tenth];
    const reading = layoutForVoice({ layout: queueLayout({ expanded: [], focuses: [], rows }) });

    expect(reading.drawn.map((row) => row.key)).toEqual([...shown.slice(0, QUEUE_SHOWN), ninth].map((row) => row.key));
    expect(reading.folded).toEqual([{ count: 1, marked: 1, register: "ask", tier: tenth.tier }]);
  });

  it("never folds the owner's priorities, so the voice's card N is the page's, while a fold in a tier keeps the tier main named", () => {
    const acme: WorkspacePlacement = {
      by: [{ source: "stated", value: "team", workspace: "team" }],
      kind: "placed",
      workspace: "team",
    };
    const iso = Array.from({ length: QUEUE_SHOWN + 1 }, (_, at) => ({
      ...askRow(),
      key: `ask:iso-${String(at)}`,
      placement: acme,
      tags: [{ key: "workstream", value: "iso-certification" }],
      tagsRead: "whole" as const,
    }));
    const focus = {
      anchor: "talk-call:a0000024#turn_EXx",
      because: "the owner's ISO week",
      id: "iso",
      name: "ISO controls",
      queueWorkstream: "iso-certification",
    };
    const lifted = layoutForVoice({ layout: queueLayout({ expanded: [], focuses: [focus], rows: iso }) });
    const unlifted = layoutForVoice({ layout: queueLayout({ expanded: [], focuses: [], rows: iso }) });

    expect([lifted.folded, lifted.drawn.length]).toEqual([[], QUEUE_SHOWN + 1]);
    expect(unlifted.folded).toEqual([{ count: 1, marked: 0, register: "ask", tier: iso[0].tier }]);
  });

  describe("ranks across registers inside a tier", () => {
    const fresh = { ...askRow(), key: "ask:fresh", tier: "team-blocked" as const };
    const hands = Array.from({ length: QUEUE_SHOWN + 1 }, (_, at) => ({
      ...handRow(),
      key: `hand:stale-${String(at)}`,
      tier: "team-blocked" as const,
    }));

    it("draws a fresh ask ranked first above stale hand steps, the hands' fold straight after their eighth", () => {
      const layout = queueLayout({ expanded: [], focuses: [], rows: [fresh, ...hands] });

      expect(layout.map((entry) => ("key" in entry ? entry.key : `fold:${entry.more}:${String(entry.count)}`))).toEqual(
        ["ask:fresh", ...hands.slice(0, QUEUE_SHOWN).map((row) => row.key), "fold:hand:1"],
      );
    });

    it("keeps an interleaved rank as received, never regrouping hands first", () => {
      const layout = queueLayout({ expanded: [], focuses: [], rows: [hands[0], fresh, hands[1]] });

      expect(layoutForVoice({ layout }).drawn.map((row) => row.key)).toEqual([
        "hand:stale-0",
        "ask:fresh",
        "hand:stale-1",
      ]);
    });

    it("expands one register without moving another register's card", () => {
      const layout = queueLayout({ expanded: ["hand"], focuses: [], rows: [fresh, ...hands] });

      expect(layoutForVoice({ layout })).toEqual({
        drawn: [fresh, ...hands],
        folded: [],
      });
    });
  });

  it("reads an empty page as empty", () => {
    const reading = queueForVoice({ folded: [], drawn: [], open: undefined, unread: [], withheld: 0 });
    expect(reading.drawn).toEqual([]);
    expect(reading.drawnMore).toBe(false);
  });
});

describe("standingRows — what a figure over both workspaces counts", () => {
  const board = ready({ value: readBoard({ rows: [], unresolved: 0 })! });
  const spokenOn = ({ cardKey }: { cardKey: string }): LiveState<CardLandings> =>
    ready({
      value: readCardLandings({
        landings: [
          {
            anchor: "call:a0000041-0000-4000-8000-000000000044#s-1",
            cardKey,
            atIso: "2026-09-24T16:30:05.000Z",
            decidedIso: "2026-09-24T16:30:00.000Z",
            source: "transcript",
            words: "that one is done",
            workSlug: "talk-card-08327b595da4",
          },
        ],
        moves: [],
        movesUnreadable: [],
        movesUnreadableLines: [],
        triageUnreadable: 0,
        unreadable: [],
        unreadableLines: [],
      })!,
    });

  it("leaves out a card the owner's words landed on and one a press settled, since no view draws either", () => {
    const ask = askRow();
    const hand = handRow();
    expect(
      standingRows({
        board,
        every: [ask, hand],
        settled: [],
        spoken: spokenOn({ cardKey: ask.key }),
        steers: NO_STEERS,
      }),
    ).toEqual([hand]);
    expect(
      standingRows({
        board,
        every: [ask, hand],
        settled: [hand.key],
        spoken: spokenOn({ cardKey: "none" }),
        steers: NO_STEERS,
      }),
    ).toEqual([ask]);
  });

  // 21 held posts drawn past the owner's steer, because any hold drew a card past every landing.
  it("hides a held post the owner steered on past a hold that is not the owner's yes, and draws one whose blocking hold came after the owner's words", () => {
    const hold = ({ reason }: { reason: string }) => ({
      hold: { atIso: "2026-09-24T17:00:00.000Z", reason, why: "a session read the owner's word" },
    });
    const notYet = postRow({ item: hold({ reason: "not-owner-yes" }) });
    const blocked = postRow({ item: hold({ reason: "no-fleet-slot" }) });
    const spoken = spokenOn({ cardKey: notYet.key });
    expect([notYet.landingFloorIso, blocked.landingFloorIso]).toEqual([undefined, "2026-09-24T17:00:00.000Z"]);
    expect(standingRows({ board, every: [notYet], settled: [], spoken, steers: NO_STEERS })).toEqual([]);
    expect(standingRows({ board, every: [blocked], settled: [], spoken, steers: NO_STEERS })).toEqual([blocked]);
  });

  /** The `talk cards` reading with one landing on `cardKey` carrying the owner's triage ruling, decided at `decidedIso`. */
  const rulingOn = ({ cardKey, triage }: { cardKey: string; triage: unknown }): LiveState<CardLandings> =>
    ready({
      value: readCardLandings({
        landings: [
          {
            anchor: "talk:turn-1",
            atIso: "2026-09-24T16:30:05.000Z",
            cardKey,
            decidedIso: "2026-09-24T16:30:00.000Z",
            source: "relay",
            triage,
            words: "park it",
            workSlug: "talk-card-08327b595da4",
          },
        ],
        moves: [],
        movesUnreadable: [],
        movesUnreadableLines: [],
        triageUnreadable: 0,
        unreadable: [],
        unreadableLines: [],
      })!,
    });

  it("keeps a card the owner's triage ruling parked, put off since the owner decided and marked with the ruling", () => {
    const ask = askRow();
    const hand = handRow();
    const triage = { label: "waiting-on-them", verdict: "park-working-session" };
    const standing = standingRows({
      board,
      every: [ask, hand],
      settled: [],
      spoken: rulingOn({ cardKey: ask.key, triage }),
      steers: NO_STEERS,
    });
    expect(standing).toEqual([{ ...ask, deferredIso: "2026-09-24T16:30:00.000Z", triage }, hand]);
  });

  it("keeps a parked card's earlier deferral, and still leaves out a card a send-it ruling landed on", () => {
    const earlier = { ...askRow(), deferredIso: "2026-09-24T16:00:00.000Z" };
    const park = { verdict: "park-slow-triage" };
    const parked = standingRows({
      board,
      every: [earlier],
      settled: [],
      spoken: rulingOn({ cardKey: earlier.key, triage: park }),
      steers: NO_STEERS,
    });
    expect(parked).toEqual([{ ...earlier, triage: park }]);
    const sent = standingRows({
      board,
      every: [earlier],
      settled: [],
      spoken: rulingOn({ cardKey: earlier.key, triage: { verdict: "send-it" } }),
      steers: NO_STEERS,
    });
    expect(sent).toEqual([]);
  });

  it("keeps the owner's ruling on the recut a seat is making of a card the owner's words landed on", () => {
    const ask = askRow();
    const running = ready({
      value: readBoard({
        rows: [
          {
            kind: "work",
            ownerWait: "owner",
            reason: "recutting the card",
            run: "active",
            section: "IN FLIGHT",
            slug: "talk-card-08327b595da4",
            status: "in-flight",
          },
        ],
        unresolved: 0,
      })!,
    });
    const triage = { verdict: "rewrite" };
    const [recut] = standingRows({
      board: running,
      every: [ask],
      settled: [],
      spoken: rulingOn({ cardKey: ask.key, triage }),
      steers: NO_STEERS,
    });
    expect([recut.tier, recut.card.question, recut.triage]).toEqual([
      "check-in",
      "Recut in flight, talk-card-08327b595da4",
      triage,
    ]);
  });

  it("leaves out a hand step while the board it joins loads, and keeps it once the board is read", () => {
    const hand = handRow();
    const spoken = spokenOn({ cardKey: "none" });
    expect(standingRows({ board: LOADING, every: [hand], settled: [], spoken, steers: NO_STEERS })).toEqual([]);
    expect(standingRows({ board, every: [hand], settled: [], spoken, steers: NO_STEERS })).toEqual([hand]);
  });
});
