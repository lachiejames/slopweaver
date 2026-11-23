/** The one-index sections: the owner's list, the awaiting artifacts, the ranked open-pages index and the page budget. */
import { describe, expect, it } from "vitest";

import {
  AWAITING_MAX_ITEMS,
  OPEN_ARTIFACTS_MAX_ITEMS,
  YOUR_LIST_ABOVE_FOLD_MAX_WORDS,
  YOUR_LIST_MAX_ROWS,
  YOUR_LIST_WHO_MAX_CHARS,
} from "../../../../../briefing/caps.js";
import { projectYourList } from "../../../../../briefing/yourList.js";
import { unwrap } from "../../../../../lib/result.js";
import { pageAboveFoldRefusal, pageAboveFoldWords } from "../../../../../outbound/briefing/pageAboveFold.js";
import { briefingFormSchema } from "../../../../../outbound/briefing/schema.js";
import { boardItem } from "../../../../../sessionStart/boardLeg.js";
import { ACME_ORGANISATION } from "../../../../organisationFixture.js";
import { artifact, CARD, FORM, openArtifact, sentenceOfWords, text, withYourList, yourRow } from "./fixtures.js";
import { refusals } from "./harness.js";

describe("the one-index sections", () => {
  it("admits a page carrying the owner's list, an artifact and an anchor into a section that renders", () => {
    const form = {
      ...FORM,
      awaiting: [artifact({ over: { pending: true } })],
      history: [
        { id: "todays-rulings", notes: [{ headline: text({ value: "One view, two registers." }) }], summary: "today" },
      ],
      reactNow: {
        meFacing: [],
        teamFacing: [
          {
            ...CARD,
            whyYou: [
              { kind: "text" as const, text: "Only you can say. " },
              { kind: "anchor" as const, target: "todays-rulings", text: "today's rulings" },
            ],
          },
        ],
      },
      yourList: {
        notShown: 56,
        readIso: "2026-09-06T02:56:00.000Z",
        rows: [yourRow({ rank: 1 })],
        source: "slopweaver session-start --json, top 10",
      },
    };

    expect(refusals({ form })).toEqual([]);
  });

  it("refuses an anchor pointing at a section this page does not carry", () => {
    const form = {
      ...FORM,
      reactNow: {
        meFacing: [],
        teamFacing: [
          {
            ...CARD,
            whyYou: [
              { kind: "text" as const, text: "Only you can say. " },
              { kind: "anchor" as const, target: "todays-rulings", text: "today's rulings" },
            ],
          },
        ],
      },
    };

    expect(refusals({ form })).toEqual([
      "form: an anchor run points at a section this page does not carry, so it would render as a link that " +
        "scrolls nowhere. Give the section an `id`, or point the anchor at one that renders.",
    ]);
  });

  it("refuses an anchor into `your-list` when the page carries no list for the owner", () => {
    const form = {
      ...FORM,
      reactNow: {
        meFacing: [],
        teamFacing: [
          {
            ...CARD,
            whyYou: [
              { kind: "text" as const, text: "Only you can say. " },
              { kind: "anchor" as const, target: "your-list", text: "your list" },
            ],
          },
        ],
      },
    };

    expect(refusals({ form })).toEqual([
      "form: an anchor run points at a section this page does not carry, so it would render as a link that " +
        "scrolls nowhere. Give the section an `id`, or point the anchor at one that renders.",
    ]);
  });

  it("admits that same anchor once the list is on the page", () => {
    const form = {
      ...withYourList({ rows: [yourRow({ rank: 1 })] }),
      reactNow: {
        meFacing: [],
        teamFacing: [
          {
            ...CARD,
            whyYou: [
              { kind: "text" as const, text: "Only you can say. " },
              { kind: "anchor" as const, target: "your-list", text: "your list" },
            ],
          },
        ],
      },
    };

    expect(refusals({ form })).toEqual([]);
  });

  it("refuses a section id that collides with one the renderer already emits", () => {
    const form = { ...FORM, history: [{ id: "recent", notes: [{ headline: text({ value: "A." }) }], summary: "s" }] };

    expect(refusals({ form })).toEqual([
      "history.0.id: a section id may not be one the renderer already emits: your-list, react-now, " +
        "react-now-team, react-now-me, react-now-artifacts, react-now-waiting, alignment, autonomy-ledger, " +
        "waiting-on-you, " +
        "owner-beliefs, quiz, recent, freshness, nothing-stale.",
    ]);
  });

  it("refuses two collapsed sections carrying the same id", () => {
    const section = { id: "todays-rulings", notes: [{ headline: text({ value: "A." }) }], summary: "s" };
    const form = { ...FORM, history: [section, { ...section, summary: "t" }] };

    expect(refusals({ form })).toEqual([
      "form: two collapsed sections on this page carry the same `id`, so an anchor into either is ambiguous.",
    ]);
  });

  it("refuses more rows of the owner's list than the cap allows", () => {
    const rows = Array.from({ length: YOUR_LIST_MAX_ROWS + 1 }, (_, index) => yourRow({ rank: index + 1 }));

    expect(refusals({ form: withYourList({ rows }) })).toEqual([
      `yourList.rows: Too big: expected array to have <=${String(YOUR_LIST_MAX_ROWS)} items`,
    ]);
  });

  it("refuses rows that are not ranked from one with no gaps", () => {
    const rows = [yourRow({ rank: 1 }), yourRow({ rank: 3 })];

    expect(refusals({ form: withYourList({ rows }) })).toEqual([
      "yourList.rows: your list's rows must be ranked from 1 with no gaps — it is a projection of an ordered list.",
    ]);
  });

  it("refuses a headline over the per-row word cap", () => {
    const rows = [yourRow({ rank: 1, words: 31 })];

    expect(refusals({ form: withYourList({ rows }) })).toEqual([
      "yourList.rows.0.headline: a row on your list runs over the cap of 30 words above the fold. Cut it, or " +
        "move the rest into the card's `detail` fold.",
    ]);
  });

  it("refuses a `who` one character over the cap, naming the row — the form never truncates one", () => {
    const rows = [{ ...yourRow({ rank: 1 }), who: "w".repeat(YOUR_LIST_WHO_MAX_CHARS + 1) }];

    expect(refusals({ form: withYourList({ rows }) })).toEqual([
      `yourList.rows.0.who: Too big: expected string to have <=${String(YOUR_LIST_WHO_MAX_CHARS)} characters`,
    ]);
  });

  it("takes a `who` exactly at the cap, so the refusal above is a boundary rather than a blanket", () => {
    const rows = [{ ...yourRow({ rank: 1 }), who: "w".repeat(YOUR_LIST_WHO_MAX_CHARS) }];

    expect(refusals({ form: withYourList({ rows }) })).toEqual([]);
  });

  it("takes the real board leg's longest row, which is what the 120-character refusal fired on", () => {
    // MEASURED: this slug made `the <slug> session` 122 characters, two over the cap, and
    // `briefing render` refused the whole page at `yourList.rows.N.who`. The producer names the session's
    // role now, so the same run projects clean — and nothing here hand-trims the verb's own output.
    const slug =
      "acme-a-very-long-board-row-slug-that-names-every-step-of-the-plan-and-every-scope-it-asks-for-before-it-reruns";
    const item = boardItem({
      entry: {
        events: [
          { atIso: "2026-09-11T00:00:00.000Z", branch: "a-branch", docHash: "0123456789abcdef", kind: "started" },
          { atIso: "2026-09-12T22:00:00.000Z", kind: "question", question: "pick reading A or reading B" },
        ],
        holder: { kind: "live" },
        repo: undefined,
        slug,
        summary: "Book meetings, read the diary and track time against the exact OAuth scopes named.",
      },
    })!;
    const ranked = [{ item, score: 12, trace: { verdict: "show" }, why: "somebody is stopped waiting on you" }];
    const list = unwrap(
      projectYourList({
        document: { nowIso: "2026-09-13T01:45:00.000Z", ranking: { ranked } },
        invocation: "slopweaver session-start --json",
        organisation: ACME_ORGANISATION,
        top: 10,
      }),
    );

    expect(list.rows[0]!.who).toBe("the session holding it");
    expect(list.rows[0]!.where).toBe(`slopweaver handover resume ${slug}`);
    expect(list.rows[0]!.identity).toBe(`handover:${slug}`);
    expect(refusals({ form: withYourList({ rows: list.rows }) })).toEqual([]);
  });

  it("refuses a whole list inside every per-row cap that still exceeds the section budget", () => {
    const rows = Array.from({ length: YOUR_LIST_MAX_ROWS }, (_, index) => yourRow({ rank: index + 1, words: 30 }));
    const words = rows.length * 31;

    expect(words).toBeGreaterThan(YOUR_LIST_ABOVE_FOLD_MAX_WORDS);
    expect(refusals({ form: withYourList({ rows }) })).toEqual([
      `yourList: your list runs over the cap of ${String(YOUR_LIST_ABOVE_FOLD_MAX_WORDS)} words above the fold. ` +
        "Show fewer rows — the count it is not showing is stated either way.",
    ]);
  });

  it("refuses more artifacts than the cap allows", () => {
    const awaiting = Array.from({ length: AWAITING_MAX_ITEMS + 1 }, (_, index) =>
      artifact({ over: { url: `https://example.invalid/${String(index)}` } }),
    );

    expect(refusals({ form: { ...FORM, awaiting } })).toEqual([
      `awaiting: Too big: expected array to have <=${String(AWAITING_MAX_ITEMS)} items`,
    ]);
  });

  it("refuses an artifact whose `waitingOn` runs past one breath", () => {
    const awaiting = [artifact({ over: { waitingOn: text({ value: sentenceOfWords({ count: 31 }) }) } })];

    expect(refusals({ form: { ...FORM, awaiting } })).toEqual([
      "awaiting.0.waitingOn: an artifact's `waitingOn` runs over the cap of 30 words above the fold. Cut it, " +
        "or move the rest into the card's `detail` fold.",
    ]);
  });

  it("does not refuse a ranked index longer than the unranked band's cap of three", () => {
    const openArtifacts = Array.from({ length: AWAITING_MAX_ITEMS + 6 }, (_, index) =>
      openArtifact({ rank: index + 1 }),
    );

    expect(refusals({ form: { ...FORM, reactNow: { ...FORM.reactNow, openArtifacts } } })).toEqual([]);
  });

  it("refuses a ranked index over its own cap", () => {
    const openArtifacts = Array.from({ length: OPEN_ARTIFACTS_MAX_ITEMS + 1 }, (_, index) =>
      openArtifact({ rank: index + 1 }),
    );

    expect(refusals({ form: { ...FORM, reactNow: { ...FORM.reactNow, openArtifacts } } })).toEqual([
      `reactNow.openArtifacts: Too big: expected array to have <=${String(OPEN_ARTIFACTS_MAX_ITEMS)} items`,
    ]);
  });

  it("refuses a ranked index with a gap in its ranks", () => {
    const openArtifacts = [openArtifact({ rank: 1 }), openArtifact({ rank: 3 })];

    expect(refusals({ form: { ...FORM, reactNow: { ...FORM.reactNow, openArtifacts } } })).toEqual([
      "reactNow.openArtifacts: the open-artifact index must be ranked from 1 with no gaps — it is a " +
        "projection of an ordered list, and a page showing ranks 1, 2 and 4 is showing a list nobody ranked.",
    ]);
  });

  it("refuses a ranked index that sends the owner to the same page twice", () => {
    const openArtifacts = [
      openArtifact({ rank: 1 }),
      { ...openArtifact({ rank: 2 }), url: openArtifact({ rank: 1 }).url },
    ];

    expect(refusals({ form: { ...FORM, reactNow: { ...FORM.reactNow, openArtifacts } } })).toEqual([
      "reactNow.openArtifacts: two lines of the open-artifact index point at the same page, so its rank is " +
        "asking the owner to open one thing twice. Rank it once.",
    ]);
  });

  it("refuses an open artifact's ask that runs past one breath", () => {
    const openArtifacts = [{ ...openArtifact({ rank: 1 }), ask: text({ value: sentenceOfWords({ count: 31 }) }) }];

    expect(refusals({ form: { ...FORM, reactNow: { ...FORM.reactNow, openArtifacts } } })).toEqual([
      "reactNow.openArtifacts.0.ask: an open artifact's `ask` runs over the cap of 30 words above the fold. " +
        "Cut it, or move the rest into the card's `detail` fold.",
    ]);
  });

  it("refuses a `landedIso` no clock can parse", () => {
    const openArtifacts = [{ ...openArtifact({ rank: 1 }), landedIso: "this morning" }];

    expect(refusals({ form: { ...FORM, reactNow: { ...FORM.reactNow, openArtifacts } } })).toEqual([
      "reactNow.openArtifacts.0.landedIso: an eyebrow instant must be an ISO-8601 timestamp a clock can " +
        "parse, as in `2026-09-02T09:07:42Z`.",
    ]);
  });

  it("admits a form written before the index existed, defaulting it to empty rather than refusing the live page", () => {
    const { openArtifacts: _dropped, ...cards } = FORM.reactNow;
    const parsed = briefingFormSchema.safeParse({ ...FORM, reactNow: cards });

    expect(parsed.success).toBe(true);
    expect(parsed.data!.reactNow.openArtifacts).toEqual([]);
  });

  it("keeps the ranked index out of the page's above-fold budget, exactly as the cards are", () => {
    const bare = pageAboveFoldWords({ form: FORM });
    const withIndex = pageAboveFoldWords({
      form: { ...FORM, reactNow: { ...FORM.reactNow, openArtifacts: [openArtifact({ rank: 1 })] } },
    });

    expect(withIndex).toBe(bare);
  });

  it("charges the owner's list nothing against the page budget, because every row of it renders inside a fold", () => {
    const bare = pageAboveFoldWords({ form: FORM });
    const withList = pageAboveFoldWords({
      form: {
        ...FORM,
        yourList: { notShown: 0, readIso: FORM.header.readyIso, rows: [yourRow({ rank: 1, words: 4 })], source: "s" },
      },
    });

    expect(withList).toBe(bare);
  });

  it("charges the recent notes nothing, so a fourth headline sentence cannot tip a page the reader never sees", () => {
    // Pass 670: the newest note's fourth sentence took the form's count past the cap while the page it would
    // have rendered measured 297, because this section renders inside a fold the page half never counts.
    const three = text({ value: "One landed. Two landed. Three landed." });
    const four = text({ value: "One landed. Two landed. Three landed. Twenty-two seats read, eighteen working." });

    expect(pageAboveFoldWords({ form: { ...FORM, recent: [{ headline: four }] } })).toBe(
      pageAboveFoldWords({ form: { ...FORM, recent: [{ headline: three }] } }),
    );
    expect(pageAboveFoldWords({ form: { ...FORM, recent: [{ headline: four }] } })).toBe(
      pageAboveFoldWords({ form: FORM }),
    );
  });

  it("names the measured count and every region carrying words, largest first, when the page is over", () => {
    expect(
      pageAboveFoldRefusal({
        regions: [
          { region: "lede", words: 28 },
          { region: "quiz", words: 0 },
          { region: "autonomy ledger", words: 990 },
        ],
      }),
    ).toBe(
      "the page puts 1018 words above the fold outside the react-now cards, over the cap of 1000 (autonomy " +
        "ledger 990, lede 28). A page this long is one the owner scrolls past, so the parts the owner does read are the parts " +
        "you folded away.",
    );
  });

  it("charges nothing for `awaiting`, whose section no longer reaches the page at all", () => {
    const bare = pageAboveFoldWords({ form: FORM });
    const withAwaiting = pageAboveFoldWords({ form: { ...FORM, awaiting: [artifact({ over: {} })] } });

    expect(withAwaiting).toBe(bare);
  });
});
