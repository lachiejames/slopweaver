/**
 * A composed react-now card is held to the question and lean its page marks — whether or not any document
 * lists the page, which is the case fallback once broke.
 */
import { describe, expect, it } from "vitest";

import {
  composedCardDrift,
  composedPageAddresses,
  type PagesOpened,
  pinPagesOpened,
} from "../../../briefing/composedCardDrift.js";
import { PublishedPageReadErrors, type ReadPublishedPage } from "../../../briefing/publishedPageRead.js";
import { err, ok } from "../../../lib/result.js";
import type { BriefingCard } from "../../../outbound/briefing/types.js";
import { PublishedPagesReadErrors } from "../../../store/publishedPages/readErrors.js";

const PAGES = "/Users/owner/.slopweaver/pages";
const QUEUE = `file://${PAGES}/queue/index.html`;
const QUESTION = "Which queue should the console open on?";
const LEAN = "A, because it is the one they already read.";
const MARKED = `<p data-card="question">${QUESTION}</p><p data-card="lean">${LEAN}</p>`;

/** A file matcher for a disk holding none of these files, so every address is read as spelled. */
const SPELLED: PagesOpened = () => [];

/** A page reader answering the given bytes for every address, as a freeze store holding one page would. */
function pageReading({ html }: { html: string }): ReadPublishedPage {
  return () => ok(html);
}

/** One composed card on a subject, carrying the question and lean the chair typed. */
function composed({ url, question, lean }: { url: string; question: string; lean: string }): BriefingCard {
  return {
    ifSilent: [{ kind: "text", text: "The console keeps opening on Acme." }],
    lean: [{ kind: "text", text: lean }],
    options: [
      { letter: "A", text: "Open on Acme." },
      { letter: "B", text: "Open on Slopweaver." },
    ],
    premise: { kind: "artifact", landedIso: "2026-09-30T06:00:00Z" },
    question,
    readiness: { state: "ready" },
    subject: { text: "The queue decision", url },
    what: [{ kind: "text", text: "The console opens on one queue by default." }],
    whyYou: [{ kind: "text", text: "Only you know which queue you read first." }],
  };
}

describe("composedCardDrift", () => {
  it("refuses a composed card typing lean B over a page marking A, though no document lists the page", () => {
    const card = composed({ lean: "B, it can wait.", question: QUESTION, url: QUEUE });

    expect(
      composedCardDrift({
        block: { meFacing: [card], teamFacing: [] },
        pagesDirectory: PAGES,
        pagesOpened: SPELLED,
        readPage: pageReading({ html: MARKED }),
      }),
    ).toEqual([
      `the react-now card for "The queue decision" types a lean its page does not say; the page marks question ` +
        `"${QUESTION}" and lean "${LEAN}". Make the card say what the page marks, or drop it and card the page ` +
        `with an open-pages entry, which reads both from the page. (${QUEUE})`,
    ]);
  });

  it("names both fields when both drift, team-facing cards included", () => {
    const card = composed({ lean: "B, it can wait.", question: "Which one first?", url: QUEUE });
    const lines = composedCardDrift({
      block: { meFacing: [], teamFacing: [card] },
      pagesDirectory: PAGES,
      pagesOpened: SPELLED,
      readPage: pageReading({ html: MARKED }),
    });

    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("types a question and lean its page does not say");
  });

  it("passes a composed card saying exactly what the page marks", () => {
    const card = composed({ lean: LEAN, question: QUESTION, url: QUEUE });

    expect(
      composedCardDrift({
        block: { meFacing: [card], teamFacing: [] },
        pagesDirectory: PAGES,
        pagesOpened: SPELLED,
        readPage: pageReading({ html: MARKED }),
      }),
    ).toEqual([]);
  });

  it("holds a card to its page however the address spells the path: a doubled slash, a dot, a fragment", () => {
    const drifted = { lean: "B, it can wait.", question: QUESTION };
    const asked: string[] = [];
    const readPage: ReadPublishedPage = ({ url }) => {
      asked.push(url);
      return ok(MARKED);
    };
    const spellings = [`file://${PAGES}//queue/index.html`, `file://${PAGES}/./queue/index.html`, `${QUEUE}#lean`];
    const lines = composedCardDrift({
      block: { meFacing: spellings.map((url) => composed({ ...drifted, url })), teamFacing: [] },
      pagesDirectory: PAGES,
      pagesOpened: SPELLED,
      readPage,
    });

    expect(lines.length).toBe(3);
    // Read once: the three spellings are one published page, and a page is read once per render.
    expect(asked).toEqual([QUEUE]);
  });

  it("holds a card to the page file a case, symlink or firmlink spelling opens", () => {
    const drifted = { lean: "B, it can wait.", question: QUESTION };
    const aliases = [
      `${PAGES}/queue/INDEX.HTML`,
      "/tmp/alias/queue/index.html",
      `/System/Volumes/Data${PAGES}/queue/index.html`,
    ];
    const asked: string[] = [];
    const lines = composedCardDrift({
      block: { meFacing: aliases.map((path) => composed({ ...drifted, url: `file://${path}` })), teamFacing: [] },
      pagesDirectory: PAGES,
      pagesOpened: ({ path }) => (aliases.includes(path) ? ["queue"] : []),
      readPage: ({ url }) => {
        asked.push(url);
        return ok(MARKED);
      },
    });

    expect(lines.length).toBe(3);
    expect(asked).toEqual([QUEUE]);
  });

  it("holds a card spelled through a symlink inside pages/ to the page it opens, not only the link's name", () => {
    const alias = `file://${PAGES}/alias/index.html`;
    const asked: string[] = [];
    const lines = composedCardDrift({
      block: { meFacing: [composed({ lean: "B, it can wait.", question: QUESTION, url: alias })], teamFacing: [] },
      pagesDirectory: PAGES,
      pagesOpened: ({ path }) => (path === `${PAGES}/alias/index.html` ? ["alias", "queue"] : []),
      readPage: ({ url }) => {
        asked.push(url);
        return url === QUEUE ? ok(MARKED) : err(PublishedPagesReadErrors.neverFrozen({ pageKey: "alias" }));
      },
    });

    expect(lines.length).toBe(1);
    expect(asked).toEqual([alias, QUEUE]);
  });

  it("holds a card to the page its address spells when the file is a symlink to an unpublished draft", () => {
    const draft = `file://${PAGES}/draft/index.html`;
    const asked: string[] = [];
    const lines = composedCardDrift({
      block: { meFacing: [composed({ lean: "B, it can wait.", question: QUESTION, url: QUEUE })], teamFacing: [] },
      pagesDirectory: PAGES,
      readPage: ({ url }) => {
        asked.push(url);
        return url === QUEUE ? ok(MARKED) : err(PublishedPagesReadErrors.neverFrozen({ pageKey: "draft" }));
      },
      pagesOpened: () => ["draft", "queue"],
    });

    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("types a lean its page does not say");
    expect(asked).toEqual([draft, QUEUE]);
  });

  it("holds a card whose file address carries a host to the page its path names", () => {
    const asked: string[] = [];
    const lines = composedCardDrift({
      block: {
        meFacing: [
          composed({ lean: "B, it can wait.", question: QUESTION, url: `file://127.0.0.1${PAGES}/queue/index.html` }),
        ],
        teamFacing: [],
      },
      pagesDirectory: PAGES,
      readPage: ({ url }) => {
        asked.push(url);
        return ok(MARKED);
      },
      pagesOpened: SPELLED,
    });

    expect(lines.length).toBe(1);
    expect(asked).toEqual([QUEUE]);
  });

  it("refuses a card on a page whose marks do not read, rather than letting it stand as typed", () => {
    const styled = `<p data-card="question">${QUESTION}</p><p data-card="lean"><span style="font-weight: bold">A</span>, now.</p>`;
    const card = composed({ lean: "B, it can wait.", question: QUESTION, url: QUEUE });

    expect(
      composedCardDrift({
        block: { meFacing: [card], teamFacing: [] },
        pagesDirectory: PAGES,
        pagesOpened: SPELLED,
        readPage: pageReading({ html: styled }),
      }),
    ).toEqual([
      'the react-now card for "The queue decision" names a page whose card marks do not read, so its question and ' +
        'lean cannot be checked: data-card="lean" holds an inline style, which can hide words from a reader that ' +
        'the card would still read; mark plain text; the page marks no data-card="lean", and a card needs both ' +
        `sentences from it. Fix the marks and republish the page. (${QUEUE})`,
    ]);
  });

  it("refuses a card on a page the store could not give, rather than letting it stand as typed", () => {
    const damaged = PublishedPageReadErrors.notPrefetched({ url: QUEUE });
    const card = composed({ lean: "B, it can wait.", question: QUESTION, url: QUEUE });

    expect(
      composedCardDrift({
        block: { meFacing: [card], teamFacing: [] },
        pagesDirectory: PAGES,
        pagesOpened: SPELLED,
        readPage: () => err(damaged),
      }),
    ).toEqual([
      'the react-now card for "The queue decision" names a page whose published bytes cannot be read, so its ' +
        `question and lean cannot be checked: ${damaged.message} (${QUEUE})`,
    ]);
  });

  it("holds nothing to a page with no marks, no frozen bytes, or an address outside this home's pages", () => {
    const drifted = { lean: "B, it can wait.", question: QUESTION };
    const unmarked = composedCardDrift({
      block: { meFacing: [composed({ ...drifted, url: QUEUE })], teamFacing: [] },
      pagesDirectory: PAGES,
      pagesOpened: SPELLED,
      readPage: pageReading({ html: "<p>A, the page says so.</p>" }),
    });
    const unread = composedCardDrift({
      block: { meFacing: [composed({ ...drifted, url: QUEUE })], teamFacing: [] },
      pagesDirectory: PAGES,
      pagesOpened: SPELLED,
      readPage: () => err(PublishedPagesReadErrors.neverFrozen({ pageKey: "queue" })),
    });
    const elsewhere = composedCardDrift({
      block: {
        meFacing: [
          composed({ ...drifted, url: "file:///tmp/x/pages/queue/index.html" }),
          composed({ ...drifted, url: "https://github.com/lachiejames/slopweaver/pull/1" }),
        ],
        teamFacing: [],
      },
      pagesDirectory: PAGES,
      pagesOpened: SPELLED,
      readPage: pageReading({ html: MARKED }),
    });

    expect([unmarked, unread, elsewhere]).toEqual([[], [], []]);
  });
});

describe("pinPagesOpened", () => {
  it("answers a path from its first answer, so a symlink retargeted mid-run cannot name an unfetched page", () => {
    const targets = ["first", "second"];
    const asked: string[] = [];
    const live: PagesOpened = ({ path }) => {
      asked.push(path);
      return [targets[asked.length - 1]!];
    };
    const pinned = pinPagesOpened({ pagesOpened: live });
    const alias = `${PAGES}/alias/index.html`;

    const answers = [pinned({ pagesDirectory: PAGES, path: alias }), pinned({ pagesDirectory: PAGES, path: alias })];

    expect(answers).toEqual([["first"], ["first"]]);
    expect(asked).toEqual([alias]);
  });

  it("asks the live seam afresh for a path or directory it has not answered", () => {
    const live: PagesOpened = ({ path, pagesDirectory }) => [`${pagesDirectory}:${path}`];
    const pinned = pinPagesOpened({ pagesOpened: live });

    expect([pinned({ pagesDirectory: "/a", path: "x" }), pinned({ pagesDirectory: "/b", path: "x" })]).toEqual([
      ["/a:x"],
      ["/b:x"],
    ]);
  });
});

describe("composedPageAddresses", () => {
  it("answers each page a card would be held to once, every spelling folded, and nothing for a subject with no page", () => {
    const alias = `file://${PAGES}/alias/index.html`;
    const card = composed({ lean: LEAN, question: QUESTION, url: QUEUE });
    const pr = composed({ lean: LEAN, question: QUESTION, url: "https://github.com/acme/acme-admin/pull/1" });

    expect(
      composedPageAddresses({
        block: { meFacing: [card, pr], teamFacing: [card] },
        pagesDirectory: PAGES,
        pagesOpened: () => ["alias", "queue"],
      }),
    ).toEqual([alias, QUEUE]);
  });
});
