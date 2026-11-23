import { describe, expect, it } from "vitest";

import { packForStorage, renderContextPack, type TalkContextPack } from "../../../talk/contextPack.js";
import { packAsksOf, skippedDocsUnread } from "../../../talk/packAsks.js";
import { checkInLines } from "../../../talk/packCheckIns.js";
import { landingsOfGitLog } from "../../../talk/packLandings.js";
import { packRecentlyLeftOf } from "../../../talk/packRecentlyLeft.js";
import { fitSection, withinLookback } from "../../../talk/packText.js";
import {
  PACK_MAX_AGE_MINUTES,
  PACK_MAX_BYTES,
  packForMint,
  packPastBound,
  packRefreshDue,
} from "../../../talk/storedPack.js";
import { BARE_ASK, checkIn, EMPTY, NO_PR } from "./contextPackFixture.js";

const NOW = "2026-09-24T14:00:00.000Z";

describe("checkInLines", () => {
  it("reads each rule as what was done, the reason, the evidence and its row, with how many cards share it", () => {
    expect(checkInLines({ budget: 12 * 1024, checkIns: [checkIn()], skip: 0 })).toEqual([
      "## Check-ins — done already, the owner's word is a review: 1 rule(s) covering 3 card(s), the rule clearing the most first",
      [
        "- act:ev-2 — push-back-on-coderabbit in acme/acme-admin, done 2026-09-24T12:00:00.000Z; 2 more card(s) share its rule (4 act(s) in all)",
        "  what the fleet did: Pushed back on CodeRabbit's rename on the logger PR",
        "  the reason it gave: the rename would break the public import path",
        "  evidence: github reply printed 201",
        "  origin: row the-logger-run (tags repo:acme-admin, area:logging)",
      ].join("\n"),
    ]);
  });

  it("says when a rule is one card, has no plain words, names no row, or its tags were not read", () => {
    const [, lone, unread, bare] = checkInLines({
      budget: 12 * 1024,
      checkIns: [
        checkIn({ acts: 1, cards: 1, did: undefined, origin: undefined }),
        checkIn({ key: "act:sw-1", tags: undefined }),
        checkIn({ key: "act:sw-2", tags: [] }),
      ],
      skip: 0,
    });
    expect(lone).toContain("; the only card of its rule (1 act(s) in all)");
    expect(lone).not.toContain("what the fleet did");
    expect(lone).toContain("  origin: no board row named");
    expect(unread).toContain("  origin: row the-logger-run (its tags not read — board_row has them)");
    expect(bare).toContain("  origin: row the-logger-run (no tags)");
  });

  it("starts past the rules already read, and says when none are left", () => {
    const rules = [checkIn(), checkIn({ key: "act:ev-9" })];
    const page = checkInLines({ budget: 12 * 1024, checkIns: rules, skip: 1 });
    expect(page[0]).toBe(
      "## Check-ins — done already, the owner's word is a review: 2 rule(s) covering 6 card(s), the rule clearing the most first, from rule 2",
    );
    expect(page[1]!.startsWith("- act:ev-9 — ")).toBe(true);
    expect(checkInLines({ budget: 12 * 1024, checkIns: rules, skip: 2 }).slice(1)).toEqual(["(none left from here)"]);
  });
});

describe("withinLookback", () => {
  it("keeps an instant a day old and drops one a minute older", () => {
    expect(withinLookback({ atIso: "2026-09-23T14:00:00.000Z", nowIso: NOW })).toBe(true);
    expect(withinLookback({ atIso: "2026-09-23T13:59:00.000Z", nowIso: NOW })).toBe(false);
  });

  it("drops a future instant and an unparseable one", () => {
    expect(withinLookback({ atIso: "2026-09-24T14:01:00.000Z", nowIso: NOW })).toBe(false);
    expect(withinLookback({ atIso: "yesterday", nowIso: NOW })).toBe(false);
  });
});

describe("packAsksOf", () => {
  const row = {
    lean: "option A",
    ownerWait: "owner",
    path: "/h/a.md",
    prNamed: [],
    prSteers: undefined,
    priority: "p1",
    question: "A or B?",
    questionAskedIso: "2026-09-24T10:00:00.000Z",
    slug: "a",
  };
  const NO_READING = { kind: "unread", why: "no reading" } as const;

  it("keeps only rows the board says are the owner's and that carry a question, their words beside each", () => {
    const asks = packAsksOf({
      ownerWordsOf: ({ slug }) => [`words for ${slug}`],
      proofs: NO_READING,
      rows: [row, { ...row, ownerWait: "fleet", slug: "b" }, { ...row, question: undefined, slug: "c" }],
    });
    expect(asks).toEqual([
      {
        askedIso: "2026-09-24T10:00:00.000Z",
        ownerWords: ["words for a"],
        lean: "option A",
        prWords: undefined,
        priority: "p1",
        proofs: undefined,
        question: "A or B?",
        slug: "a",
      },
    ]);
  });

  it("carries the owner's words on the row's pull request from another row, and the verdict naming this row", () => {
    const steer = {
      identity: "acme/acme-admin#17564",
      quote: { atIso: "2026-09-25T02:41:26.704Z", words: "please attach screenshots of the new page" },
      rowSlug: "proof-row",
    };
    const [ask] = packAsksOf({
      ownerWordsOf: () => [],
      proofs: {
        checkedIso: "2026-10-14T08:00:00.000Z",
        kind: "read",
        pullRequests: [
          {
            identity: "acme/acme-admin#17564",
            proof: { gap: "You asked for proof.", kind: "requested-and-unmet" },
            rowSlugs: ["proof-row", "a"],
          },
          { identity: "o/r#1", proof: { kind: "requested-and-met" }, rowSlugs: ["elsewhere"] },
        ],
      },
      rows: [{ ...row, prNamed: ["acme/acme-admin#17564"], prSteers: [steer] }],
    });
    expect(ask!.prWords).toEqual([
      {
        atIso: "2026-09-25T02:41:26.704Z",
        identity: "acme/acme-admin#17564",
        rowSlug: "proof-row",
        words: "please attach screenshots of the new page",
      },
    ]);
    expect(ask!.proofs).toEqual([
      {
        checkedIso: "2026-10-14T08:00:00.000Z",
        gap: "You asked for proof.",
        identity: "acme/acme-admin#17564",
        verdict: "unmet",
      },
    ]);
  });
});

describe("renderContextPack's pull-request asks", () => {
  const ask = {
    askedIso: undefined,
    ownerWords: [],
    lean: undefined,
    priority: "p0",
    question: "Approve or redirect?",
    slug: "owner-steer",
  };
  const words = ({ count }: { count: number }) =>
    Array.from({ length: count }, (_, index) => ({
      atIso: "2026-09-25T02:41:26.704Z",
      identity: "acme/acme-admin#17564",
      rowSlug: `row-${String(index)}`,
      words: `quote ${String(index)}`,
    }));

  it("leads with an unmet proof ask before the question, and quotes the owner's words from the other row", () => {
    const block = renderContextPack({
      nowIso: NOW,
      pack: {
        ...EMPTY,
        asks: [
          {
            ...ask,
            prWords: words({ count: 1 }),
            proofs: [
              { checkedIso: "2026-10-14T08:00:00.000Z", gap: "You asked for proof.", identity: "x", verdict: "unmet" },
            ],
          },
        ],
      },
    });
    expect(block).toContain(
      [
        "- ask:owner-steer [p0, asked at an unrecorded time]",
        "  SAY THIS FIRST, before the question — You asked for proof. (body read 2026-10-14T08:00:00.000Z)",
        "  question: Approve or redirect?",
        '  the owner\'s words on acme/acme-admin#17564, 2026-09-25T02:41:26.704Z on ask:row-0: "quote 0"',
      ].join("\n"),
    );
    expect(block).not.toContain("none recorded on the row");
  });

  it("says an unread body was not checked, never missing, and leads with nothing", () => {
    const block = renderContextPack({
      nowIso: NOW,
      pack: {
        ...EMPTY,
        asks: [
          {
            ...ask,
            prWords: [],
            proofs: [
              { checkedIso: "2026-10-14T08:00:00.000Z", identity: "o/r#1", verdict: "unread", why: "rate limited" },
            ],
          },
        ],
      },
    });
    expect(block).toContain(
      "  question: Approve or redirect?\n  the owner's words behind it: none recorded on the row — board_row may say more\n" +
        "  proof on o/r#1: the owner asked for it; the body was not checked (rate limited) — say not checked, never missing",
    );
    expect(block).not.toContain("SAY THIS FIRST");
  });

  it("counts the owner's words past the cap with the rows holding them", () => {
    const block = renderContextPack({
      nowIso: NOW,
      pack: { ...EMPTY, asks: [{ ...ask, prWords: words({ count: 4 }), proofs: [] }] },
    });
    expect(block).toContain(
      "  2 more of the owner's words on its pull request(s) not shown — board_row on ask:row-2, ask:row-3",
    );
  });
});

describe("skippedDocsUnread", () => {
  it("marks the asks unread, naming each doc the scan could not read", () => {
    expect(skippedDocsUnread({ names: ["a.md", "b.md"] })).toEqual({
      section: "asks",
      why: "2 handover doc(s) could not be read (a.md, b.md), so an ask may be missing",
    });
  });

  it("marks nothing when every doc was read", () => {
    expect(skippedDocsUnread({ names: [] })).toBeUndefined();
  });
});

describe("landingsOfGitLog", () => {
  it("reads sha, instant and subject, keeping a tab inside the subject and skipping a malformed line", () => {
    const text = [
      "17cd11c2e78d2850fff80972d01ff706a1035809\t2026-09-24T13:03:42Z\tThe voice relays (#1189)",
      "not a commit line",
      "dd3b8a2f2aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\t2026-09-24T12:00:00Z\ta\tb",
      "",
    ].join("\n");
    expect(landingsOfGitLog({ text })).toEqual([
      { atIso: "2026-09-24T13:03:42Z", sha: "17cd11c2e", subject: "The voice relays (#1189)" },
      { atIso: "2026-09-24T12:00:00Z", sha: "dd3b8a2f2", subject: "a\tb" },
    ]);
  });
});

describe("fitSection", () => {
  it("keeps entries in order under the budget and says how many were left out", () => {
    expect(fitSection({ budget: 8, entries: ["abc", "def", "ghi"] })).toEqual([
      "abc",
      "def",
      "(1 more not shown — this list is NOT complete; use the tools for the rest)",
    ]);
  });

  it("adds no cut line when everything fits", () => {
    expect(fitSection({ budget: 100, entries: ["abc"] })).toEqual(["abc"]);
  });
});

describe("renderContextPack", () => {
  it("states its age, opens on the read-first line and names an unread section instead of a total", () => {
    const block = renderContextPack({
      nowIso: NOW,
      pack: { ...EMPTY, unread: [{ section: "seats", why: "cmux is not running" }] },
    });
    expect(block.split("\n")[0]).toBe(
      "# Context pack — built 2026-09-24T13:58:00.000Z, 2 minute(s) before this call started",
    );
    expect(block).toContain("Answer from this pack FIRST");
    expect(block).toContain(
      "## Not read — never state a total for these\n- seats: could not be read — cmux is not running",
    );
    expect(block).toContain("## Live seats — NOT wholly read, no total (0 cmux workspace(s) read)\n");
    expect(block).not.toContain("0 cmux workspace(s)\n");
    expect(block.split("\n").at(-1)).toBe("## Landed on the base branch in the last day — 0 commit(s)");
  });

  it("quotes the owner's words under an ask, and says so when a row carries none", () => {
    const ask = { ...BARE_ASK, slug: "s" };
    const block = renderContextPack({
      nowIso: NOW,
      pack: {
        ...EMPTY,
        asks: [
          { ...ask, ownerWords: ["do the thing"] },
          { ...ask, ownerWords: [], slug: "t" },
        ],
      },
    });
    expect(block).toContain(
      '- ask:s [p2, asked at an unrecorded time]\n  question: Q?\n  the owner\'s words: "do the thing"',
    );
    expect(block).toContain(
      "- ask:t [p2, asked at an unrecorded time]\n  question: Q?\n  the owner's words behind it: none recorded",
    );
  });

  it("says a row's words could not be read rather than that the owner gave none", () => {
    const block = renderContextPack({
      nowIso: NOW,
      pack: { ...EMPTY, asks: [{ ...BARE_ASK, ownerWords: undefined, priority: "p1", slug: "u" }] },
    });
    expect(block).toContain(
      "  the owner's words behind it: the row's doc could not be read — call board_row, never say none were given",
    );
    expect(block).not.toContain("none recorded");
    expect(block).toContain(
      "## Not read — never state a total for these\n- the owner's words: the doc behind each of these could not be read — ask:u",
    );
  });

  it("names an unreadable row's doc even when its ask is past the section's byte budget", () => {
    const filler = { ...BARE_ASK, ownerWords: ["w"], question: "q".repeat(600) };
    const asks = Array.from({ length: 30 }, (_, index) => ({ ...filler, slug: `f${String(index)}` }));
    const block = renderContextPack({
      nowIso: NOW,
      pack: { ...EMPTY, asks: [...asks, { ...filler, ownerWords: undefined, slug: "last" }] },
    });
    expect(block).not.toContain("- ask:last ");
    expect(block).toContain("- the owner's words: the doc behind each of these could not be read — ask:last");
  });

  it("marks the owner's turns partial when the transcript read stopped short of the day before the build", () => {
    const partial = renderContextPack({ nowIso: NOW, pack: { ...EMPTY, turnsSinceIso: "2026-09-24T09:00:00.000Z" } });
    expect(partial).toContain(
      "## What the owner said to the supervisor — newest first, since 2026-09-24T09:00:00.000Z (the read stopped there — earlier turns that day are NOT shown; call read_supervisor for them)",
    );
    const whole = renderContextPack({ nowIso: NOW, pack: { ...EMPTY, turnsSinceIso: "2026-09-23T13:58:00.000Z" } });
    expect(whole).toContain(
      "## What the owner said to the supervisor — newest first, the whole day before this pack\n",
    );
  });

  it("marks the owner's turns unknown when the read decoded no exchange at all", () => {
    const block = renderContextPack({ nowIso: NOW, pack: { ...EMPTY, turnsSinceIso: undefined } });
    expect(block).toContain(
      "## What the owner said to the supervisor — newest first (the read decoded no exchange, so how far back it reached is unknown — earlier turns may be missing; call read_supervisor for them)",
    );
  });

  it("carries the owner's check-ins after the asks, and says a pack written before them holds none to speak of", () => {
    const block = renderContextPack({ nowIso: NOW, pack: { ...EMPTY, checkIns: [checkIn()] } });
    expect(block).toContain("## Check-ins — done already, the owner's word is a review: 1 rule(s) covering 3 card(s)");
    expect(block.indexOf("## Check-ins")).toBeGreaterThan(block.indexOf("## Board asks waiting on the owner's word"));
    expect(renderContextPack({ nowIso: NOW, pack: { ...EMPTY, checkIns: undefined } })).toContain(
      "## Check-ins — this pack was written before it carried them; call verb talk check-ins for the list",
    );
    const unread = renderContextPack({
      nowIso: NOW,
      pack: { ...EMPTY, unread: [{ section: "checkIns", why: "the autonomy register did not parse" }] },
    });
    expect(unread).toContain("## Check-ins — NOT read, no total; call verb talk check-ins for the list");
    expect(unread).toContain("- checkIns: could not be read — the autonomy register did not parse");
  });

  it("carries a glossary section only when there are terms", () => {
    expect(renderContextPack({ nowIso: NOW, pack: EMPTY })).not.toContain("## Glossary");
    expect(
      renderContextPack({ nowIso: NOW, pack: { ...EMPTY, glossary: [{ means: "the pinned chat", term: "chair" }] } }),
    ).toContain("## Glossary — the fleet's words\n- chair: the pinned chat");
  });
});

describe("renderContextPack's unreadable rows", () => {
  it("names unreadable rows up to the cap and counts the rest, never dropping one silently", () => {
    const ask = {
      ...NO_PR,
      askedIso: undefined,
      ownerWords: undefined,
      lean: undefined,
      priority: "p1",
      question: "Q?",
    };
    const asks = Array.from({ length: 100 }, (_, index) => ({ ...ask, slug: `row-${String(index).padStart(3, "0")}` }));
    const line = renderContextPack({ nowIso: NOW, pack: { ...EMPTY, asks } })
      .split("\n")
      .find((text) => text.startsWith("- the owner's words:"))!;
    expect(
      line.startsWith("- the owner's words: the doc behind each of these could not be read — ask:row-000, ask:row-001"),
    ).toBe(true);
    expect(line).toMatch(/, \(\d+ more not shown — this list is NOT complete; use the tools for the rest\)$/u);
    const shown = line.match(/ask:row-\d{3}/gu)!.length;
    const more = Number(line.match(/\((\d+) more not shown/u)![1]);
    expect(shown + more).toBe(100);
  });
});

describe("packForStorage", () => {
  it("cuts every passage where the render cuts it and keeps two quotes, so the render is unchanged", () => {
    const long = "x".repeat(5_000);
    const pack: TalkContextPack = {
      ...EMPTY,
      asks: [
        {
          askedIso: undefined,
          ownerWords: [long, long, long],
          lean: long,
          prWords: [{ atIso: "2026-09-25T00:00:00Z", identity: "o/r#1", rowSlug: "b", words: long }],
          priority: "p1",
          proofs: undefined,
          question: long,
          slug: "a",
        },
      ],
      landings: [{ atIso: "2026-09-24T13:00:00Z", sha: "abc123456", subject: long }],
      seats: [
        { directory: "/d", lastAtIso: undefined, lastMessage: long, pinned: false, ref: "workspace:1", title: "t" },
      ],
      turns: [{ atIso: "2026-09-24T13:00:00Z", text: long, viaVoice: false }],
      unread: [{ section: "landings", why: long }],
      checkIns: [checkIn({ did: long, evidence: long, reason: long })],
    };
    const stored = packForStorage({ pack });
    expect([stored.checkIns![0]!.did!.length, stored.checkIns![0]!.reason.length]).toEqual([401, 401]);
    expect(stored.checkIns![0]!.evidence.length).toBe(201);
    expect(stored.asks[0]!.ownerWords).toEqual([`${"x".repeat(600)}…`, `${"x".repeat(600)}…`]);
    expect(stored.asks[0]!.question.length).toBe(601);
    expect(stored.asks[0]!.prWords![0]!.words.length).toBe(601);
    expect(stored.turns[0]!.text.length).toBe(601);
    expect(stored.landings[0]!.subject.length).toBe(201);
    expect(stored.seats[0]!.lastMessage!.length).toBe(161);
    expect(stored.unread[0]!.why.length).toBe(301);
    expect(renderContextPack({ nowIso: NOW, pack: stored })).toBe(renderContextPack({ nowIso: NOW, pack }));
  });

  it("keeps an unreadable row's words unreadable", () => {
    const ask = {
      ...NO_PR,
      askedIso: undefined,
      ownerWords: undefined,
      lean: undefined,
      priority: "p1",
      question: "Q?",
      slug: "u",
    };
    expect(packForStorage({ pack: { ...EMPTY, asks: [ask] } }).asks[0]!.ownerWords).toBeUndefined();
  });
});

// A card that is on the Queue but removed stays visible to the voice.
describe("packRecentlyLeftOf", () => {
  /** One board row as `handover list --json` publishes it, the fields the half reads. */
  const row = (over: Partial<Parameters<typeof packRecentlyLeftOf>[0]["rows"][number]> = {}) => ({
    kind: "ask",
    ownerWait: "not-waiting",
    problem: "the review ask has sat a week",
    question: undefined,
    ruledBeforeSettleIso: undefined,
    ruledBeforeSettleWords: undefined,
    ruledSinceQuestionIso: undefined,
    settledIso: "2026-09-24T13:30:00.000Z",
    settlement: "answered",
    settlementWitness: "the owner said send it",
    slug: "jasper-review-bump",
    summary: "Bump Jasper for review on acme-admin#18247?",
    ...over,
  });

  // A ruled ask is off the owner's Queue from the ruling, hours before a session settles it.
  it("dates a settled ask the owner ruled on first by the ruling, naming their words and then the settle", () => {
    const ruled = row({ ruledBeforeSettleIso: "2026-09-24T10:00:00.000Z", ruledBeforeSettleWords: "send it" });
    expect(packRecentlyLeftOf({ moves: [], landings: [], nowIso: NOW, rows: [ruled] })).toEqual([
      {
        about: "Bump Jasper for review on acme-admin#18247?",
        key: "ask:jasper-review-bump",
        removedIso: "2026-09-24T10:00:00.000Z",
        why: 'the owner ruled on it ("send it"), then it settled answered: the owner said send it',
      },
    ]);
  });

  // A card the gate refused was held off the owner's Queue, so it never left it.
  it("never lists a settled ask whose card was refused for naming a machine id, nor a landing on it", () => {
    const refused = row({ question: "Send the recut from call efe7b241?", summary: undefined });
    const onRefused = {
      atIso: "2026-09-24T13:10:00.000Z",
      cardKey: "ask:jasper-review-bump",
      source: "transcript" as const,
      words: "send it",
      workSlug: "talk-card-92ebe555f311",
    };
    expect(packRecentlyLeftOf({ moves: [], landings: [onRefused], nowIso: NOW, rows: [refused] })).toEqual([]);
    expect(
      packRecentlyLeftOf({ moves: [], landings: [], nowIso: NOW, rows: [row({ problem: "from session 61445570" })] }),
    ).toEqual([]);
    const inOption = row({ options: [{ option: "Send it", tradeoff: "re-opens run a0000019" }] });
    const inLean = row({ lean: "send it, as call efe7b241 agreed" });
    const inExample = row({ examples: ["You open talk:f0d25d3a and see the recut"] });
    expect(packRecentlyLeftOf({ moves: [], landings: [], nowIso: NOW, rows: [inOption, inLean, inExample] })).toEqual(
      [],
    );
    // The same row with the id behind a link, or named by what it was doing, is drawn and so is listed.
    const linked = row({ question: "Send the recut from https://example.test/call/efe7b241?", summary: undefined });
    const named = row({ question: "Send the recut from the call this morning?", summary: undefined });
    expect(
      packRecentlyLeftOf({ moves: [], landings: [], nowIso: NOW, rows: [linked, { ...named, slug: "named" }] }).map(
        (l) => l.key,
      ),
    ).toEqual(["ask:jasper-review-bump", "ask:named"]);
  });

  // A ruled ask leaves the owner's Queue at the ruling, before any session settles it.
  it("dates an ask the owner ruled on and nobody has settled by the ruling", () => {
    const ruled = row({
      ownerWait: "already-ruled",
      problem: undefined,
      question: "Bump Jasper?",
      ruledSinceQuestionIso: "2026-09-24T13:05:00.000Z",
      settledIso: undefined,
      settlement: undefined,
      settlementWitness: undefined,
    });
    expect(packRecentlyLeftOf({ moves: [], landings: [], nowIso: NOW, rows: [ruled] })).toEqual([
      {
        about: "Bump Jasper for review on acme-admin#18247?",
        key: "ask:jasper-review-bump",
        removedIso: "2026-09-24T13:05:00.000Z",
        why: "the owner ruled on it; it waits on a session to execute that",
      },
    ]);
    // A doc run's question the Queue drew as the owner's ask leaves it at the ruling the same way.
    const doc = packRecentlyLeftOf({ moves: [], landings: [], nowIso: NOW, rows: [{ ...ruled, kind: "doc" }] });
    expect(doc.map((left) => [left.key, left.removedIso])).toEqual([
      ["ask:jasper-review-bump", "2026-09-24T13:05:00.000Z"],
    ]);
    // A doc run that ended still carrying its question is named by the words that landed on it.
    const ended = { ...ruled, kind: "doc", ownerWait: "settled", ruledSinceQuestionIso: undefined };
    const onEnded = {
      atIso: "2026-09-24T13:10:00.000Z",
      cardKey: "ask:jasper-review-bump",
      source: "transcript" as const,
      words: "approve it",
      workSlug: "talk-card-92ebe555f311",
    };
    const endedLeft = packRecentlyLeftOf({ moves: [], landings: [onEnded], nowIso: NOW, rows: [ended] });
    expect(endedLeft.map((left) => [left.key, left.removedIso])).toEqual([
      ["ask:jasper-review-bump", "2026-09-24T13:10:00.000Z"],
    ]);
    // And one a session settled is dated by that settle, with no landing at all.
    const settledDoc = row({ kind: "doc", ownerWait: "settled", question: "Approve this?", slug: "doc-question" });
    expect(
      packRecentlyLeftOf({ moves: [], landings: [], nowIso: NOW, rows: [settledDoc] }).map((left) => [
        left.key,
        left.removedIso,
      ]),
    ).toEqual([["ask:doc-question", "2026-09-24T13:30:00.000Z"]]);
  });

  // A settled ask with no summary is still listed, about the question it asked, as the console lists it.
  it("lists a settled ask with no summary, about the question it asked", () => {
    const bare = row({ question: "Approve X?", summary: undefined });
    expect(
      packRecentlyLeftOf({ moves: [], landings: [], nowIso: NOW, rows: [bare] }).map((left) => left.about),
    ).toEqual(["Approve X?"]);
  });

  // An instant that does not parse never displaces one that does, in either order.
  it("keeps the parseable instant when a landing or a settle on the same card does not parse", () => {
    const at = ({ atIso }: { atIso: string }) => ({
      atIso,
      cardKey: "ask:jasper-review-bump",
      source: "transcript" as const,
      words: "send it",
      workSlug: "talk-card-92ebe555f311",
    });
    const badSettle = packRecentlyLeftOf({
      moves: [],
      landings: [at({ atIso: "2026-09-24T13:10:00.000Z" })],
      nowIso: NOW,
      rows: [row({ settledIso: "not-a-date" })],
    });
    expect(badSettle.map((left) => left.removedIso)).toEqual(["2026-09-24T13:10:00.000Z"]);
    const badLanding = packRecentlyLeftOf({
      moves: [],
      landings: [at({ atIso: "not-a-date" })],
      nowIso: NOW,
      rows: [row()],
    });
    expect(badLanding.map((left) => left.removedIso)).toEqual(["2026-09-24T13:30:00.000Z"]);
    // Nor does a ruling instant that does not parse displace the settle's.
    const badRuling = row({ ruledBeforeSettleIso: "not-a-date", ruledBeforeSettleWords: "send it" });
    expect(
      packRecentlyLeftOf({ moves: [], landings: [], nowIso: NOW, rows: [badRuling] }).map((left) => left.why),
    ).toEqual(["settled answered: the owner said send it"]);
    // A landing at the settle's own instant did not come before it, so the settle names the removal.
    const tie = packRecentlyLeftOf({
      moves: [],
      landings: [at({ atIso: "2026-09-24T13:30:00.000Z" })],
      nowIso: NOW,
      rows: [row()],
    });
    expect(tie.map((left) => left.why)).toEqual(["settled answered: the owner said send it"]);
  });

  // A voice relay row was never a card, so words landing on its key left nothing on the owner's Queue.
  it("lists no landing on a settled relay row that was never the owner's card", () => {
    const relay = row({ problem: undefined, slug: "talk-7541725c4b3b", summary: undefined });
    const onRelay = {
      atIso: "2026-09-24T13:00:00.000Z",
      cardKey: "ask:talk-7541725c4b3b",
      source: "relay" as const,
      words: "yes",
      workSlug: "talk-7541725c4b3b",
    };
    expect(packRecentlyLeftOf({ moves: [], landings: [onRelay], nowIso: NOW, rows: [relay] })).toEqual([]);
    // The same relay row still open.
    const open = { ...relay, settledIso: undefined, settlement: undefined, settlementWitness: undefined };
    expect(packRecentlyLeftOf({ moves: [], landings: [onRelay], nowIso: NOW, rows: [open] })).toEqual([]);
    // Nor is an ask the board carries no row for, while the same landing on the owner's ask is listed.
    expect(packRecentlyLeftOf({ moves: [], landings: [onRelay], nowIso: NOW, rows: [] })).toEqual([]);
    const owned = { ...open, problem: "the review ask has sat a week" };
    expect(
      packRecentlyLeftOf({ moves: [], landings: [onRelay], nowIso: NOW, rows: [owned] }).map((left) => left.key),
    ).toEqual(["ask:talk-7541725c4b3b"]);
    // A doc run waiting on the owner with a question is drawn as their ask card too, so its landing is listed.
    const doc = { ...open, kind: "doc", ownerWait: "owner", question: "Approve it?" };
    expect(
      packRecentlyLeftOf({ moves: [], landings: [onRelay], nowIso: NOW, rows: [doc] }).map((left) => left.key),
    ).toEqual(["ask:talk-7541725c4b3b"]);
  });

  /** One landing still holding a card off the owner's Queue. */
  const landing = ({ cardKey, atIso }: { cardKey: string; atIso: string }) => ({
    atIso,
    cardKey,
    source: "transcript" as const,
    words: `words at ${atIso}`,
    workSlug: "talk-card-92ebe555f311",
  });

  it("names a card the owner's words took off by the EARLIEST landing, and a settled ask by its settle, newest first", () => {
    const left = packRecentlyLeftOf({
      moves: [],
      landings: [
        landing({ atIso: "2026-09-24T13:50:00.000Z", cardKey: "post:sd-be5c2110" }),
        landing({ atIso: "2026-09-24T13:40:00.000Z", cardKey: "post:sd-be5c2110" }),
      ],
      nowIso: NOW,
      rows: [row()],
    });
    expect(left).toEqual([
      {
        about: undefined,
        key: "post:sd-be5c2110",
        removedIso: "2026-09-24T13:40:00.000Z",
        why: 'the owner\'s words, heard by the voice with this card open, landed on it ("words at 2026-09-24T13:40:00.000Z"); handed to talk-card-92ebe555f311',
      },
      {
        about: "Bump Jasper for review on acme-admin#18247?",
        key: "ask:jasper-review-bump",
        removedIso: "2026-09-24T13:30:00.000Z",
        why: "settled answered: the owner said send it",
      },
    ]);
  });

  it("names an ask landed on and then settled once, by the words that took it off, with what it was about", () => {
    const left = packRecentlyLeftOf({
      moves: [],
      landings: [landing({ atIso: "2026-09-24T13:20:00.000Z", cardKey: "ask:jasper-review-bump" })],
      nowIso: NOW,
      rows: [row()],
    });
    expect(left.map((one) => [one.key, one.removedIso, one.about])).toEqual([
      ["ask:jasper-review-bump", "2026-09-24T13:20:00.000Z", "Bump Jasper for review on acme-admin#18247?"],
    ]);
  });

  // A landing written after the settle did not take the card off; the settle did, earlier.
  it("names a card several registers evidence by the EARLIEST, so a landing after the settle never replaces it", () => {
    const left = packRecentlyLeftOf({
      moves: [],
      landings: [landing({ atIso: "2026-09-24T13:45:00.000Z", cardKey: "ask:jasper-review-bump" })],
      nowIso: NOW,
      rows: [row()],
    });
    expect(left.map((one) => [one.removedIso, one.why])).toEqual([
      ["2026-09-24T13:30:00.000Z", "settled answered: the owner said send it"],
    ]);
  });

  it("never names a settled voice relay row, which carries no decision shape and was never a card", () => {
    const relay = row({ problem: undefined, slug: "talk-7541725c4b3b" });
    expect(packRecentlyLeftOf({ moves: [], landings: [], nowIso: NOW, rows: [relay] })).toEqual([]);
  });

  it("names a settled ask whose run still has its question open, and never an open or undated one", () => {
    const rows = [
      row({ ownerWait: "settled", problem: undefined, slug: "question-open" }),
      row({ settledIso: undefined, slug: "settled-before-it-was-dated" }),
      row({ settlement: undefined, settlementWitness: undefined, settledIso: undefined, slug: "still-open" }),
      row({ kind: "finding", slug: "a-finding" }),
    ];
    expect(packRecentlyLeftOf({ moves: [], landings: [], nowIso: NOW, rows }).map((one) => one.key)).toEqual([
      "ask:question-open",
    ]);
  });

  it("names nothing removed more than a day before the build, nor after it", () => {
    const rows = [
      row({ settledIso: "2026-09-23T14:00:00.000Z", slug: "at-the-edge" }),
      row({ settledIso: "2026-09-23T13:59:59.999Z", slug: "a-day-and-a-moment" }),
      row({ settledIso: "2026-09-24T14:00:00.001Z", slug: "after-the-build" }),
    ];
    expect(packRecentlyLeftOf({ moves: [], landings: [], nowIso: NOW, rows }).map((one) => one.key)).toEqual([
      "ask:at-the-edge",
    ]);
  });

  it("says the instant Date.parse measured, never a date no calendar has", () => {
    const rows = [row({ settledIso: "2026-02-30T12:00:00.000Z" })];
    const left = packRecentlyLeftOf({ moves: [], landings: [], nowIso: "2026-03-03T11:00:00.000Z", rows });
    expect(left.map((one) => one.removedIso)).toEqual(["2026-03-02T12:00:00.000Z"]);
  });

  // Moving on from a card takes it off the owner's Queue, so the pack still finds it.
  it("names a card the Queue walk moved on from, with the owner's words when they said any, the earliest departure winning", () => {
    const moved = packRecentlyLeftOf({
      landings: [landing({ atIso: "2026-09-24T13:50:00.000Z", cardKey: "post:sd-be5c2110" })],
      moves: [
        { atIso: "2026-09-24T13:40:00.000Z", cardKey: "post:sd-be5c2110", toCardKey: "draft:dr-1", words: "hmm ok" },
        { atIso: "2026-09-24T13:35:00.000Z", cardKey: "review:rv-1", toCardKey: "post:sd-be5c2110" },
      ],
      nowIso: NOW,
      rows: [],
    });
    expect(moved.map((one) => [one.key, one.removedIso, one.why])).toEqual([
      [
        "post:sd-be5c2110",
        "2026-09-24T13:40:00.000Z",
        'moved on to draft:dr-1 during the Queue walk after saying "hmm ok"',
      ],
      ["review:rv-1", "2026-09-24T13:35:00.000Z", "moved on to post:sd-be5c2110 during the Queue walk"],
    ]);
    // A move on an ask the board carries no row for was never the owner's card, as a landing on one is not.
    const orphan = { atIso: "2026-09-24T13:40:00.000Z", cardKey: "ask:no-row", toCardKey: "draft:dr-1" };
    expect(packRecentlyLeftOf({ landings: [], moves: [orphan], nowIso: NOW, rows: [] })).toEqual([]);
  });
});

describe("renderContextPack's recently-left section", () => {
  const left = {
    about: "Bump Jasper for review on acme-admin#18247?",
    key: "post:sd-be5c2110",
    removedIso: "2026-09-24T03:18:26.968Z",
    why: 'the owner\'s words, heard by the voice with this card open, landed on it ("Yes, taking ages")',
  };

  // A steer the page saw come back draws the card again, and only that page knows, so the section is a
  // build-time snapshot that sends the voice to read_card — which resolves a card back on the Queue as live.
  it("marks every card REMOVED as of the build, with when and why, and sends the voice to read_card first", () => {
    const block = renderContextPack({ nowIso: NOW, pack: { ...EMPTY, recentlyLeft: [left] } });
    expect(block).toContain(
      "## Left the owner's Queue in the last day — 1 card(s), newest first, as the ledgers stood at build. REMOVED, never waiting on the owner; read_card one before saying it is gone, since a card back on the owner's Queue reads without `removed`. A card a console steer collapsed before any words landed on it is only in action_items' recentlyLeft\n" +
        `- post:sd-be5c2110 — removed 2026-09-24T03:18:26.968Z: ${left.why}\n` +
        "  about: Bump Jasper for review on acme-admin#18247?",
    );
    expect(block).toMatch(/^## Board asks waiting on the owner's word, not the owner's Queue — 0 ask\(s\), board/mu);
  });

  // Built 23h31m before the call, rendered at the call when the pack is 24h30m old: the call's clock decides.
  it("re-judges the day at the call's own instant, since a stored pack rides in up to an hour old", () => {
    const aged = { ...left, key: "ask:aged-out", removedIso: "2026-09-23T13:30:00.000Z" };
    const block = renderContextPack({ nowIso: NOW, pack: { ...EMPTY, recentlyLeft: [left, aged] } });
    expect(block).toContain("## Left the owner's Queue in the last day — 1 card(s)");
    expect(block).toContain("- post:sd-be5c2110 — removed 2026-09-24T03:18:26.968Z");
    expect(block).not.toContain("ask:aged-out");
  });

  // A stored pack is a file, so a date no calendar has rides in as text and `Date.parse` rolls it on.
  it("says a stored entry's instant as measured, never the impossible date its file carried", () => {
    const rolled = { ...left, removedIso: "2026-09-31T12:00:00.000Z" };
    const block = renderContextPack({ nowIso: "2026-10-02T11:00:00.000Z", pack: { ...EMPTY, recentlyLeft: [rolled] } });
    expect(block).toContain("- post:sd-be5c2110 — removed 2026-10-01T12:00:00.000Z");
    expect(block).not.toContain("2026-09-31");
  });

  it("states no total when a register behind it did not read", () => {
    const pack: TalkContextPack = {
      ...EMPTY,
      recentlyLeft: [left],
      unread: [{ section: "recentlyLeft", why: "2 card-landing line(s) did not read" }],
    };
    expect(renderContextPack({ nowIso: NOW, pack })).toContain(
      "## Left the owner's Queue in the last day — NOT wholly read, no total (1 card(s) read)",
    );
  });

  it("rides back in from storage exactly as rendered, and a pack written before it says so", () => {
    const pack = { ...EMPTY, recentlyLeft: [{ ...left, about: undefined }] };
    const minted = packForMint({ nowIso: NOW, text: JSON.stringify(packForStorage({ pack })) });
    expect((minted as Extract<typeof minted, { kind: "embedded" }>).block).toBe(
      renderContextPack({ nowIso: NOW, pack }),
    );
    const { recentlyLeft: _left, ...before } = EMPTY;
    const old = packForMint({ nowIso: NOW, text: JSON.stringify(before) });
    expect((old as Extract<typeof old, { kind: "embedded" }>).block).toContain(
      "## Left the owner's Queue recently — this pack was written before it carried them",
    );
  });
});

describe("packForMint", () => {
  it("rides a fresh stored pack in, with its age and size", () => {
    const minted = packForMint({ nowIso: NOW, text: JSON.stringify(EMPTY) });
    expect(minted.kind).toBe("embedded");
    const embedded = minted as Extract<typeof minted, { kind: "embedded" }>;
    expect(embedded.ageMinutes).toBe(2);
    expect(embedded.builtIso).toBe(EMPTY.builtIso);
    expect(embedded.bytes).toBe(Buffer.byteLength(embedded.block, "utf8"));
    expect(embedded.block).toBe(renderContextPack({ nowIso: NOW, pack: EMPTY }));
  });

  it("reads back a pack whose optional fields JSON dropped", () => {
    const { boardObservedIso: _board, turnsSinceIso: _since, ...stored } = EMPTY;
    const minted = packForMint({ nowIso: NOW, text: JSON.stringify(stored) });
    expect(minted.kind).toBe("embedded");
  });

  it("reads an ask's words stored under the pronoun spelling as the owner's words", () => {
    const pack = { ...EMPTY, asks: [{ ...BARE_ASK, ownerWords: ["do the thing"], slug: "a" }] };
    const { ownerWords, ...rest } = pack.asks[0]!;
    const legacy = { ...pack, asks: [{ ...rest, hisWords: ownerWords }] };
    const minted = packForMint({ nowIso: NOW, text: JSON.stringify(legacy) });
    expect(minted.kind).toBe("embedded");
    expect((minted as Extract<typeof minted, { kind: "embedded" }>).block).toBe(
      renderContextPack({ nowIso: NOW, pack }),
    );
    expect((minted as Extract<typeof minted, { kind: "embedded" }>).block).toContain("do the thing");
  });

  it("leaves out a pack whose ask stores the owner's words under both spellings", () => {
    const both = { ...EMPTY, asks: [{ ...BARE_ASK, hisWords: ["a"], ownerWords: ["b"], slug: "a" }] };
    expect(packForMint({ nowIso: NOW, text: JSON.stringify(both) })).toEqual({
      kind: "left-out",
      why: "the stored pack is not a pack: an ask stores the owner's words under both ownerWords and hisWords",
    });
  });

  it("rides the owner's check-ins back in exactly as rendered, and a pack written before them says so", () => {
    const pack = { ...EMPTY, checkIns: [checkIn({ did: undefined, origin: undefined, tags: undefined })] };
    const minted = packForMint({ nowIso: NOW, text: JSON.stringify(pack) });
    expect((minted as Extract<typeof minted, { kind: "embedded" }>).block).toBe(
      renderContextPack({ nowIso: NOW, pack }),
    );
    const { checkIns: _checkIns, ...before } = EMPTY;
    const old = packForMint({ nowIso: NOW, text: JSON.stringify(before) });
    expect((old as Extract<typeof old, { kind: "embedded" }>).block).toContain(
      "this pack was written before it carried them",
    );
  });

  it("rides a pack's stored lessons and their unread entry back in, intact", () => {
    const lessons = {
      builtIso: EMPTY.builtIso,
      knowledge: [
        { claim: "c", domain: "process", id: "l1", recordedAtIso: "2026-09-24T10:00:00.000Z", verdict: "confirmed" },
      ],
      unread: [{ section: "knowledge" as const, why: "store down" }],
    };
    const minted = packForMint({ nowIso: NOW, text: JSON.stringify({ ...EMPTY, lessons }) });
    expect(minted.kind).toBe("embedded");
    expect((minted as Extract<typeof minted, { kind: "embedded" }>).lessons).toEqual(lessons);
  });

  it("rides a pack written with the whole continuity in, its lessons read as absent", () => {
    const continuity = {
      builtIso: EMPTY.builtIso,
      knowledge: [],
      rulings: [],
      sinceIso: EMPTY.builtIso,
      steers: [],
      unread: [],
    };
    const { lessons: _lessons, ...before } = EMPTY;
    const minted = packForMint({ nowIso: NOW, text: JSON.stringify({ ...before, continuity }) });
    expect(minted.kind).toBe("embedded");
    expect((minted as Extract<typeof minted, { kind: "embedded" }>).lessons).toBe(undefined);
  });

  it("keeps a pack exactly at the bound and leaves out one a second past it", () => {
    const atBound = { ...EMPTY, builtIso: "2026-09-24T13:00:00.000Z" };
    const past = { ...EMPTY, builtIso: "2026-09-24T12:59:59.000Z" };
    expect(packForMint({ nowIso: NOW, text: JSON.stringify(atBound) }).kind).toBe("embedded");
    expect(packForMint({ nowIso: NOW, text: JSON.stringify(past) })).toEqual({
      kind: "left-out",
      why: `the stored pack is 60 minutes old, past the ${String(PACK_MAX_AGE_MINUTES)}-minute bound`,
    });
  });

  it("leaves out a pack built after the call started", () => {
    const future = { ...EMPTY, builtIso: "2026-09-24T14:00:01.000Z" };
    expect(packForMint({ nowIso: NOW, text: JSON.stringify(future) })).toEqual({
      kind: "left-out",
      why: "the stored pack's builtIso 2026-09-24T14:00:01.000Z is after this call started",
    });
  });

  it("leaves out a missing, malformed, misshapen or stale pack, saying which", () => {
    const stale = { ...EMPTY, builtIso: "2026-09-24T12:59:00.000Z" };
    expect(packForMint({ nowIso: NOW, text: undefined })).toEqual({
      kind: "left-out",
      why: "no pack has been written — `slopweaver talk pack --write`",
    });
    expect(packForMint({ nowIso: NOW, text: "{" })).toMatchObject({ kind: "left-out" });
    expect((packForMint({ nowIso: NOW, text: "{" }) as { why: string }).why).toContain("is not JSON");
    expect((packForMint({ nowIso: NOW, text: "{}" }) as { why: string }).why).toContain("is not a pack");
    expect(packForMint({ nowIso: NOW, text: JSON.stringify(stale) })).toEqual({
      kind: "left-out",
      why: `the stored pack is 61 minutes old, past the ${String(PACK_MAX_AGE_MINUTES)}-minute bound`,
    });
  });
});

describe("packRefreshDue", () => {
  it("keeps a pack exactly at the refresh bound and rebuilds one a second past it", () => {
    const atBound = { ...EMPTY, builtIso: "2026-09-24T13:30:00.000Z" };
    const past = { ...EMPTY, builtIso: "2026-09-24T13:29:59.000Z" };
    expect(packRefreshDue({ nowIso: NOW, olderThanMinutes: 30, text: JSON.stringify(atBound) })).toEqual({
      ageMinutes: 30,
      due: false,
    });
    expect(packRefreshDue({ nowIso: NOW, olderThanMinutes: 30, text: JSON.stringify(past) })).toEqual({
      due: true,
      why: "the stored pack is 30 minutes old, past 30",
    });
  });

  it("rebuilds a missing, malformed, misshapen or future-dated pack, saying which", () => {
    const future = { ...EMPTY, builtIso: "2026-09-24T14:00:01.000Z" };
    expect(packRefreshDue({ nowIso: NOW, olderThanMinutes: 30, text: undefined })).toEqual({
      due: true,
      why: "no pack has been written",
    });
    expect((packRefreshDue({ nowIso: NOW, olderThanMinutes: 30, text: "{" }) as { why: string }).why).toContain(
      "is not JSON",
    );
    expect((packRefreshDue({ nowIso: NOW, olderThanMinutes: 30, text: "{}" }) as { why: string }).why).toContain(
      "is not a pack",
    );
    expect(packRefreshDue({ nowIso: NOW, olderThanMinutes: 30, text: JSON.stringify(future) })).toEqual({
      due: true,
      why: "the stored pack's builtIso 2026-09-24T14:00:01.000Z is not a past instant",
    });
  });

  it("keeps a pack two minutes old, the case the keeper meets on almost every tick", () => {
    expect(packRefreshDue({ nowIso: NOW, olderThanMinutes: 30, text: JSON.stringify(EMPTY) })).toEqual({
      ageMinutes: 2,
      due: false,
    });
  });
});

describe("packPastBound", () => {
  it("passes a pack exactly at the bound and names one a byte past it", () => {
    expect(packPastBound({ bytes: PACK_MAX_BYTES, path: "/h/talk/pack.json" })).toBe(undefined);
    expect(packPastBound({ bytes: PACK_MAX_BYTES + 1, path: "/h/talk/pack.json" })).toBe(
      "/h/talk/pack.json is 1048577 bytes, past the 1048576-byte bound",
    );
  });
});
