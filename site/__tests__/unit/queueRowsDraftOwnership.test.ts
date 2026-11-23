/*
 * One Queue card per held Slack draft. A post card asked "Claude's draft or Codex's?" and an ask asked "Send the
 * held reply under the teammate's message … (sd-111ad9d6)?", both drawing the same draft, so the second card duplicated the
 * one the owner had just approved. The fixtures are those two records, driven through the real readers and `rowsOf`.
 */

import { describe, expect, it } from "vitest";

import { readBoard } from "../../components/live/read";
import { readParkedDrafts } from "../../components/live/readSlackDrafts";
import type { LiveState } from "../../components/live/useLive";
import type { BriefingCard } from "../../lib/queueCard";
import { oneCardPerHeldSlackDraft } from "../../lib/queueDraftOwnership";
import { rowForOpen } from "../../lib/queueOpen";
import { type QueueRow, rowsOf } from "../../lib/queueRows";
import { cardForVoice } from "../../lib/queueVoice";
import { partitionQueueRows } from "../../lib/queueWithholding";
import { ACME_PLACER } from "../organisationFixture";

const LOADING = { phase: "loading" } as const;

function ready<T>({ value }: { value: T }): LiveState<T> {
  return {
    fixture: undefined,
    observedAtIso: "2026-10-25T09:12:00.000Z",
    phase: "ready",
    stampedByRoute: false,
    value,
  };
}

/** The ask as `handover list --json` would print it. */
const ASK = {
  blastRadius: "one record a teammate keeps; no account is switched off",
  kind: "ask",
  lean: "Send it: the teammate who keeps the record is the one who can correct it",
  options: [
    {
      letter: "A",
      option: "Send the held reply asking the teammate to correct the record (sd-111ad9d6)",
      tradeoff: "one line under the teammate's own message; the record stays wrong until they do it",
    },
    {
      letter: "B",
      option: "Leave it",
      tradeoff: "no ask of the teammate; the record stays wrong",
    },
  ],
  ownerWait: "owner",
  prUrls: [],
  problem: "two records of one person disagree",
  question: "Send the held reply under the teammate's message asking them to correct the record (sd-111ad9d6)?",
  reason: "waiting on the owner",
  risk: "Left alone, the record stays wrong",
  section: "WAITING ON YOU",
  slug: "record-correction-reply",
  status: "waiting",
  stillReal: "the record still reads the same",
};

/** Codex's ready draft beside the original, in the register's shape. */
const READY = {
  atIso: "2026-10-23T11:09:00.000Z",
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

/** One parked draft: held with Codex's draft beside it, sent, or dropped with a note. */
function parkedItem({
  id,
  state,
  outcome,
  why = "ask the teammate to correct the record",
  text = "A words",
  digest = "3f2a9c11d4e5b6a7",
}: {
  id: string;
  state: string;
  outcome?: string;
  why?: string;
  text?: string;
  digest?: string;
}): unknown {
  return {
    ...(state === "held" ? { comparison: READY } : {}),
    draft: {
      advisory: [],
      channel: "C0SYN000039",
      composer: "claude-code",
      digest,
      mentions: [],
      payload: { form: "plain", text, unfurl_links: false, unfurl_media: false },
      shape: "top-level",
      tsIso: "2026-10-23T11:08:00.000Z",
      why,
    },
    id,
    ...(outcome === undefined ? {} : { outcome }),
    ...(state === "held"
      ? { release: { command: `slopweaver slack post --as me --draft ${id} --approve 3f2a9c11`, kind: "send" } }
      : { resolvedIso: "2026-10-23T12:00:00.000Z" }),
    state,
  };
}

/** Every row `rowsOf` builds over these asks and parked drafts. */
function rowsFor({ asks, items }: { asks: readonly unknown[]; items: readonly unknown[] }): readonly QueueRow[] {
  return rowsOf({
    acts: LOADING,
    board: ready({ value: readBoard({ rows: asks, unresolved: 0 })! }),
    drafts: LOADING,
    hands: LOADING,
    landing: LOADING,
    placer: ACME_PLACER,
    posts: ready({ value: readParkedDrafts({ items, people: [] })! }),
    reviewers: LOADING,
    reviews: LOADING,
    imports: LOADING,
    standing: LOADING,
  });
}

/** The ask's own row, by its key — never by position, where the post it absorbed would stand in for it. */
function askRow({ rows }: { rows: readonly QueueRow[] }): QueueRow {
  return rows.find((row) => row.key === "ask:record-correction-reply")!;
}

/** The second ask of the gate's cases: a different question naming the same draft. */
const SECOND = { ...ASK, question: "Ready the follow-up note once sd-111ad9d6 goes?", slug: "note-after-the-reply" };

describe("an ask naming a held draft owns it, its post card absorbed", () => {
  const rows = rowsFor({ asks: [ASK], items: [parkedItem({ id: "sd-111ad9d6", state: "held" })] });

  it("draws ONE card for the two records, under the ask's key, answering to the post's", () => {
    expect(rows.map((row) => [row.key, row.aliases])).toEqual([["ask:record-correction-reply", ["post:sd-111ad9d6"]]]);
    expect(rowForOpen({ open: "post:sd-111ad9d6", rows })!.key).toBe("ask:record-correction-reply");
  });

  it("is team-facing, as the post it absorbed was", () => {
    expect(askRow({ rows }).tier).toBe("team-blocked");
  });

  it("opens its what on the variant choice, naming the original by writer since its letters are its options", () => {
    const card = askRow({ rows }).card as BriefingCard;
    expect(card.question).toBe(
      "Send the held reply under the teammate's message asking them to correct the record (sd-111ad9d6)?",
    );
    expect(card.options.map((option) => option.letter)).toEqual(["A", "B"]);
    expect(
      card.what!.whole.startsWith(
        "Codex drafted the same message blind to Claude's draft, on gpt-test; say which one goes before either can be sent.",
      ),
    ).toBe(true);
  });

  it("hands the voice both drafts, so it can read the owner the two it asks about", () => {
    const voice = cardForVoice({ row: askRow({ rows }) });
    expect([voice.draft, voice.drafts]).toEqual([
      "A words",
      [
        { by: "Claude", letter: "A", text: "A words" },
        { by: "Codex", letter: "B", text: "B words" },
      ],
    ]);
  });
});

describe("the gate: a second card naming a held draft another card owns is refused", () => {
  it("withholds the second ask, naming the draft and the card that owns it", () => {
    const rows = rowsFor({ asks: [ASK, SECOND], items: [parkedItem({ id: "sd-111ad9d6", state: "held" })] });
    const { rows: drawn, withheld } = partitionQueueRows({ rows });
    expect(drawn.map((row) => row.key)).toEqual(["ask:record-correction-reply"]);
    expect(withheld.map((row) => row.key)).toEqual(["ask:note-after-the-reply"]);
    expect(withheld[0].why).toContain(
      "This card would draw held Slack draft sd-111ad9d6 (already on ask:record-correction-reply)",
    );
  });

  it("refuses only the second of two board rows sharing a slug, so the first still owns the draft (r1, d19e3dc1)", () => {
    const again = { ...ASK, question: "Send the held reply under the teammate's message (sd-111ad9d6), asked again?" };
    const rows = rowsFor({ asks: [ASK, again], items: [parkedItem({ id: "sd-111ad9d6", state: "held" })] });
    const { rows: drawn, withheld } = partitionQueueRows({ rows });
    expect(drawn.map((row) => [row.key, row.aliases])).toEqual([["ask:record-correction-reply", ["post:sd-111ad9d6"]]]);
    expect(withheld.map((row) => row.key)).toEqual(["ask:record-correction-reply"]);
    expect(rowForOpen({ open: "post:sd-111ad9d6", rows: drawn })!.key).toBe("ask:record-correction-reply");
  });

  it("lets a refused card claim nothing, so a draft only it named keeps its own post card", () => {
    const second = { ...SECOND, question: "Ready the follow-up note once sd-111ad9d6 goes, then send sd-2222abcd?" };
    const rows = rowsFor({
      asks: [ASK, second],
      items: [parkedItem({ id: "sd-111ad9d6", state: "held" }), parkedItem({ id: "sd-2222abcd", state: "held" })],
    });
    expect(partitionQueueRows({ rows }).rows.map((row) => row.key)).toEqual([
      "ask:record-correction-reply",
      "post:sd-2222abcd",
    ]);
  });
});

describe("an ask naming two held drafts owns both for the gate, but absorbs neither (r2, da7d6851)", () => {
  const both = { ...ASK, question: "Send the held replies sd-111ad9d6 and sd-2222abcd?" };
  const items = [parkedItem({ id: "sd-111ad9d6", state: "held" }), parkedItem({ id: "sd-2222abcd", state: "held" })];

  it("keeps each draft's post card, so the voice still reads each A and B", () => {
    const rows = rowsFor({ asks: [both], items });
    expect(rows.map((row) => [row.key, row.aliases])).toEqual([
      ["post:sd-111ad9d6", undefined],
      ["post:sd-2222abcd", undefined],
      ["ask:record-correction-reply", undefined],
    ]);
    const voice = cardForVoice({ row: rows.find((row) => row.key === "post:sd-2222abcd")! });
    expect(voice.drafts.map((draft) => [draft.letter, draft.text])).toEqual([
      ["A", "A words"],
      ["B", "B words"],
    ]);
  });

  it("keeps a colliding card drawn when it is the only card left for a draft", () => {
    const refusedPost = parkedItem({
      id: "sd-2222abcd",
      state: "held",
      why: "as call a0000009-0000-4000-8000-000000000010 asked",
    });
    const rows = rowsFor({
      asks: [ASK, { ...both, slug: "both-replies" }],
      items: [parkedItem({ id: "sd-111ad9d6", state: "held" }), refusedPost],
    });
    const { rows: drawn, withheld } = partitionQueueRows({ rows });
    expect(drawn.map((row) => row.key)).toEqual(["ask:record-correction-reply", "ask:both-replies"]);
    expect(withheld.map((row) => row.key)).toEqual(["post:sd-2222abcd"]);
  });

  it("counts a draft drawn only by another register entry's card sharing its id as orphaned", () => {
    const refusedPost = parkedItem({
      id: "sd-2222abcd",
      state: "held",
      why: "as call a0000009-0000-4000-8000-000000000010 asked",
    });
    const sameId = parkedItem({ digest: "0b0b0b0b0b0b0b0b", id: "sd-2222abcd", state: "held", text: "second words" });
    const rows = rowsFor({
      asks: [ASK, { ...both, slug: "both-replies" }],
      items: [parkedItem({ id: "sd-111ad9d6", state: "held" }), refusedPost, sameId],
    });
    expect(partitionQueueRows({ rows }).rows.map((row) => row.key)).toEqual([
      "ask:record-correction-reply",
      "post:sd-2222abcd",
      "ask:both-replies",
    ]);
  });

  it("still refuses a second ask naming one of them", () => {
    const rows = rowsFor({ asks: [both, SECOND], items });
    expect(partitionQueueRows({ rows }).withheld.map((row) => row.key)).toEqual(["ask:note-after-the-reply"]);
  });
});

describe("a second register entry sharing a draft id (r3, 74c21a9a)", () => {
  it("keeps its own post card, since the owner absorbs only the draft it holds", () => {
    const rows = rowsFor({
      asks: [ASK],
      items: [
        parkedItem({ id: "sd-111ad9d6", state: "held" }),
        parkedItem({ digest: "0b0b0b0b0b0b0b0b", id: "sd-111ad9d6", state: "held", text: "second words" }),
      ],
    });
    expect(rows.map((row) => [row.key, cardForVoice({ row }).draft])).toEqual([
      ["ask:record-correction-reply", "A words"],
      ["post:sd-111ad9d6", "second words"],
    ]);
  });

  it("keeps its own post card even when its id, digest and words all match the owner's", () => {
    const rows = rowsFor({
      asks: [ASK],
      items: [parkedItem({ id: "sd-111ad9d6", state: "held" }), parkedItem({ id: "sd-111ad9d6", state: "held" })],
    });
    expect(rows.map((row) => row.key)).toEqual(["ask:record-correction-reply", "post:sd-111ad9d6"]);
  });

  it("is never claimed by a card holding the other entry, so an ask holding each stays drawn (r3, 7465c5f8)", () => {
    const first = askRow({ rows: rowsFor({ asks: [ASK], items: [parkedItem({ id: "sd-111ad9d6", state: "held" })] }) });
    const second = rowsFor({
      asks: [SECOND],
      items: [parkedItem({ id: "sd-111ad9d6", state: "held", text: "second words" })],
    }).find((row) => row.key === "ask:note-after-the-reply")!;
    const rows = oneCardPerHeldSlackDraft({ rows: [first, second] });
    expect(rows.map((row) => [row.key, row.record.form.kind])).toEqual([
      ["ask:record-correction-reply", "drawn"],
      ["ask:note-after-the-reply", "drawn"],
    ]);
  });

  it("counts two of them on one ask as two drafts, so neither post card is absorbed (r3, ed46737a)", () => {
    const posts = rowsFor({
      asks: [],
      items: [
        parkedItem({ id: "sd-111ad9d6", state: "held" }),
        parkedItem({ digest: "0b0b0b0b0b0b0b0b", id: "sd-111ad9d6", state: "held", text: "second words" }),
      ],
    });
    const entries = posts.flatMap((row) => (row.record.kind === "post" ? [row.record.post] : []));
    const ask = askRow({ rows: rowsFor({ asks: [ASK], items: [parkedItem({ id: "sd-111ad9d6", state: "held" })] }) });
    const record = [ask.record].flatMap((each) => (each.kind === "ask" ? [each] : [])).at(0)!;
    const drafts = entries.map((draft) => ({ draft, id: draft.id, kind: "held" as const }));
    const rows = oneCardPerHeldSlackDraft({ rows: [{ ...ask, record: { ...record, drafts } }, ...posts] });
    expect(rows.map((row) => [row.key, cardForVoice({ row }).draft])).toEqual([
      ["ask:record-correction-reply", undefined],
      ["post:sd-111ad9d6", "A words"],
      ["post:sd-111ad9d6", "second words"],
    ]);
  });

  it("counts one entry an ask names twice as one draft, so its voice still reads the post it absorbed (r3, 6318a0a5)", () => {
    const posts = rowsFor({ asks: [], items: [parkedItem({ id: "sd-111ad9d6", state: "held" })] });
    const entry = posts.flatMap((row) => (row.record.kind === "post" ? [row.record.post] : [])).at(0)!;
    const ask = askRow({ rows: rowsFor({ asks: [ASK], items: [parkedItem({ id: "sd-111ad9d6", state: "held" })] }) });
    const record = [ask.record].flatMap((each) => (each.kind === "ask" ? [each] : [])).at(0)!;
    const named = { draft: entry, id: entry.id, kind: "held" as const };
    const rows = oneCardPerHeldSlackDraft({
      rows: [{ ...ask, record: { ...record, drafts: [named, named] } }, ...posts],
    });
    expect(rows.map((row) => [row.key, cardForVoice({ row }).draft])).toEqual([
      ["ask:record-correction-reply", "A words"],
    ]);
  });
});

describe("only a held draft is owned", () => {
  it("leaves two cards naming a sent draft both drawn: a record, not a decision", () => {
    const rows = rowsFor({ asks: [ASK, SECOND], items: [parkedItem({ id: "sd-111ad9d6", state: "released" })] });
    expect(partitionQueueRows({ rows }).rows.map((row) => [row.key, row.tier])).toEqual([
      ["ask:record-correction-reply", "fleet-blocked"],
      ["ask:note-after-the-reply", "fleet-blocked"],
    ]);
  });

  it("follows a named dropped cut to its live held cut, taking every key the post answered to", () => {
    const rows = rowsFor({
      asks: [{ ...ASK, question: "Send the held reply (sd-0000beef)?" }],
      items: [
        parkedItem({ id: "sd-111ad9d6", state: "held" }),
        parkedItem({ id: "sd-0000beef", outcome: "re-cut as sd-111ad9d6", state: "dropped" }),
      ],
    });
    expect(rows.map((row) => [row.key, row.aliases])).toEqual([
      ["ask:record-correction-reply", ["post:sd-111ad9d6", "post:sd-0000beef"]],
    ]);
  });
});
