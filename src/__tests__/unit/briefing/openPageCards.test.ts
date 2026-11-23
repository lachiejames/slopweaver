/**
 * One card per open page: the order it follows, the fields it refuses without, and the link it carries.
 *
 * The order assertions matter more than they look. The owner asked for the cards AND the ranked band
 * together, so a card whose position disagreed with the band beside it would be the page contradicting itself
 * about which page is freshest — which is the one thing the ranked band exists to answer.
 */
import { describe, expect, it } from "vitest";

import { briefingErrorLines } from "../../../briefing/errors.js";
import {
  openPageUrls,
  PAGE_MARKS_REQUIRED_FROM_ISO,
  projectOpenPageCards,
  typedPageLines,
} from "../../../briefing/openPageCards.js";
import { PublishedPageReadErrors, type ReadPublishedPage } from "../../../briefing/publishedPageRead.js";
import { err, ok, unwrap } from "../../../lib/result.js";
import type { BriefingOpenArtifact } from "../../../outbound/briefing/types.js";
import { PublishedPagesReadErrors } from "../../../store/publishedPages/readErrors.js";

/** A page reader answering every page with bytes that mark nothing. */
const UNMARKED: ReadPublishedPage = () => ok('<p class="lean">A, the page says so.</p>');

/** A page reader answering every page with bytes that mark the given question and lean. */
function marking({ question, lean }: { question: string; lean: string }): ReadPublishedPage {
  return () => ok(`<h1>A page</h1><p data-card="question">${question}</p><p data-card="lean">${lean}</p>`);
}

/** One document entry carrying every field a card needs. */
function entry({ url, over = {} }: { url: string; over?: Record<string, unknown> }): Record<string, unknown> {
  return {
    ask: "Your word on the slice.",
    ifSilent: "The page stands and re-ranks each tick.",
    label: `the page at ${url}`,
    landedIso: "2026-09-06T10:00:00Z",
    lean: "A, since the fold already carries the order.",
    options: [
      { letter: "A", text: "Tell the supervisor pages top, and the session takes them in order." },
      { letter: "B", text: "Tell the supervisor pages steer, and only your own steer stays above the fold." },
    ],
    question: "Which of these do you want to react to first?",
    url,
    what: "Fifteen pages still want a word. The fold ranks every one with its link.",
    whyYou: "Only you can say which of your own reactions is worth the next hour.",
    ...over,
  };
}

/** One ranked entry, as `openArtifacts.ts` would have produced it. */
function ranked({ url, label, rank = 1 }: { url: string; label: string; rank?: number }): BriefingOpenArtifact {
  return {
    ask: [{ kind: "text", text: "Your word on the slice." }],
    label,
    landedIso: "2026-09-06T10:00:00Z",
    rank,
    url,
    validity: { mark: "valid" },
  };
}

/** The pages directory of the home these cards render under. */
const PAGES = "/Users/owner/.slopweaver/pages";
const FIRST = `file://${PAGES}/first/index.html`;
const SECOND = `file://${PAGES}/second/index.html`;

describe("projectOpenPageCards", () => {
  it("emits one card per ranked page, in the rank's own order rather than the document's", () => {
    const { cards } = unwrap(
      projectOpenPageCards({
        pagesDirectory: PAGES,
        readPage: UNMARKED,
        document: [entry({ url: FIRST }), entry({ url: SECOND })],
        ranked: [ranked({ label: "the second one", url: SECOND }), ranked({ label: "the first one", url: FIRST })],
      }),
    );

    expect(cards.length).toBe(2);
    expect(cards[0]!.subject!.url).toBe(SECOND);
    expect(cards[1]!.subject!.url).toBe(FIRST);
  });

  it("carries the page's own link as the card's subject, so its title is clickable", () => {
    const { cards } = unwrap(
      projectOpenPageCards({
        pagesDirectory: PAGES,
        readPage: UNMARKED,
        document: [entry({ url: FIRST })],
        ranked: [ranked({ label: "the probeless rows", url: FIRST })],
      }),
    );

    expect(cards[0]!.subject).toEqual({ text: "the probeless rows", url: FIRST });
  });

  it("fills all six fields from the entry rather than deriving any of them", () => {
    const { cards } = unwrap(
      projectOpenPageCards({
        pagesDirectory: PAGES,
        readPage: UNMARKED,
        document: [entry({ url: FIRST })],
        ranked: [ranked({ label: "a page", url: FIRST })],
      }),
    );
    const card = cards[0]!;

    expect(card.question).toBe("Which of these do you want to react to first?");
    expect(card.what).toEqual([
      { kind: "text", text: "Fifteen pages still want a word. The fold ranks every one with its link." },
    ]);
    expect(card.whyYou).toEqual([
      { kind: "text", text: "Only you can say which of your own reactions is worth the next hour." },
    ]);
    expect(card.lean).toEqual([{ kind: "text", text: "A, since the fold already carries the order." }]);
    expect(card.ifSilent).toEqual([{ kind: "text", text: "The page stands and re-ranks each tick." }]);
    expect(card.options.length).toBe(2);
    expect(card.options[0]!.letter).toBe("A");
  });

  it("refuses a page missing a card field, naming the page and every key it lacks", () => {
    const bare = { ask: "a", label: "the unwritten page", landedIso: "2026-09-06T10:00:00Z", url: FIRST };
    const result = projectOpenPageCards({
      pagesDirectory: PAGES,
      readPage: UNMARKED,
      document: [bare],
      ranked: [ranked({ label: "the unwritten page", url: FIRST })],
    });

    expect(result.isErr()).toBe(true);
    expect(briefingErrorLines({ error: result._unsafeUnwrapErr() })[0]).toContain(
      'open page "the unwritten page" cannot become a card',
    );
    expect(briefingErrorLines({ error: result._unsafeUnwrapErr() })[0]).toContain(
      "question, what, whyYou, lean, ifSilent",
    );
  });

  it("refuses a page whose options are missing entirely", () => {
    const withoutOptions = entry({ over: { options: undefined }, url: FIRST });
    const result = projectOpenPageCards({
      pagesDirectory: PAGES,
      readPage: UNMARKED,
      document: [withoutOptions],
      ranked: [ranked({ label: "the page", url: FIRST })],
    });

    expect(result.isErr()).toBe(true);
    expect(briefingErrorLines({ error: result._unsafeUnwrapErr() })[0]).toContain("needs an `options` array");
  });

  it("refuses one option that carries no letter, and one that is not an object at all", () => {
    const noLetter = entry({ over: { options: [{ text: "Tell the supervisor yes." }] }, url: FIRST });
    const notObject = entry({ over: { options: ["Tell the supervisor yes."] }, url: FIRST });
    const rank = [ranked({ label: "the page", url: FIRST })];

    const missing = projectOpenPageCards({
      pagesDirectory: PAGES,
      readPage: UNMARKED,
      document: [noLetter],
      ranked: rank,
    });
    const wrongKind = projectOpenPageCards({
      pagesDirectory: PAGES,
      readPage: UNMARKED,
      document: [notObject],
      ranked: rank,
    });

    expect(missing.isErr()).toBe(true);
    expect(briefingErrorLines({ error: missing._unsafeUnwrapErr() })[0]).toContain(
      "is not `{ letter, text }` with both non-empty",
    );
    expect(wrongKind.isErr()).toBe(true);
    expect(briefingErrorLines({ error: wrongKind._unsafeUnwrapErr() })[0]).toContain(
      "is not `{ letter, text }` with both non-empty",
    );
  });

  it("reports every unwritten page at once rather than stopping at the first", () => {
    const bare = { ask: "a", label: "one", landedIso: "2026-09-06T10:00:00Z", url: FIRST };
    const alsoBare = { ask: "a", label: "two", landedIso: "2026-09-06T10:00:00Z", url: SECOND };
    const result = projectOpenPageCards({
      pagesDirectory: PAGES,
      readPage: UNMARKED,
      document: [bare, alsoBare],
      ranked: [ranked({ label: "one", url: FIRST }), ranked({ label: "two", url: SECOND })],
    });

    expect(result.isErr()).toBe(true);
    expect(briefingErrorLines({ error: result._unsafeUnwrapErr() }).length).toBe(2);
  });

  // THE FOLD. this projection read six fields and dropped a seventh, so a
  // page could carry depth, pass `briefing check`, and render a card that showed none of it.
  it("carries an entry's detail through as the card's own fold", () => {
    const withDetail = entry({
      over: {
        detail: {
          blocks: [{ content: [{ kind: "code", text: "claude setup-token" }], kind: "para" }],
          summary: "the two commands",
        },
      },
      url: FIRST,
    });
    const { cards } = unwrap(
      projectOpenPageCards({
        pagesDirectory: PAGES,
        readPage: UNMARKED,
        document: [withDetail],
        ranked: [ranked({ label: "the page", url: FIRST })],
      }),
    );

    expect(cards[0]!.detail!.summary).toBe("the two commands");
    expect(cards[0]!.detail!.blocks.length).toBe(1);
  });

  it("leaves a card with no `detail` key at all when the entry wrote none", () => {
    const { cards } = unwrap(
      projectOpenPageCards({
        pagesDirectory: PAGES,
        readPage: UNMARKED,
        document: [entry({ url: FIRST })],
        ranked: [ranked({ label: "the page", url: FIRST })],
      }),
    );

    expect(Object.hasOwn(cards[0]!, "detail")).toBe(false);
  });

  // The real incident's own value: a numbered list flattened into one string with runs of spaces for layout.
  it("refuses a detail that is a plain string rather than silently dropping it", () => {
    const flattened = entry({
      over: {
        detail:
          "1. claude setup-token   (a browser tab opens; the command prints the token)\n" +
          "2. pbpaste | slopweaver claude token --plan plan-four --stdin",
      },
      url: FIRST,
    });
    const result = projectOpenPageCards({
      pagesDirectory: PAGES,
      readPage: UNMARKED,
      document: [flattened],
      ranked: [ranked({ label: "the page", url: FIRST })],
    });

    expect(result.isErr()).toBe(true);
    expect(briefingErrorLines({ error: result._unsafeUnwrapErr() })[0]).toContain("is not a fold");
    expect(briefingErrorLines({ error: result._unsafeUnwrapErr() })[0]).toContain('"blocks"');
  });

  it("refuses a detail whose fold has a summary and no blocks", () => {
    const empty = entry({ over: { detail: { blocks: [], summary: "nothing behind this" } }, url: FIRST });
    const result = projectOpenPageCards({
      pagesDirectory: PAGES,
      readPage: UNMARKED,
      document: [empty],
      ranked: [ranked({ label: "the page", url: FIRST })],
    });

    expect(result.isErr()).toBe(true);
    expect(briefingErrorLines({ error: result._unsafeUnwrapErr() })[0]).toContain("is not a fold");
  });

  it("emits nothing at all for an empty rank, rather than refusing", () => {
    expect(
      unwrap(projectOpenPageCards({ pagesDirectory: PAGES, readPage: UNMARKED, document: [], ranked: [] })),
    ).toEqual({ cards: [], typed: [] });
  });

  it("refuses a document that is not an array", () => {
    const result = projectOpenPageCards({
      pagesDirectory: PAGES,
      readPage: UNMARKED,
      document: { pages: [] },
      ranked: [],
    });

    expect(result.isErr()).toBe(true);
    expect(briefingErrorLines({ error: result._unsafeUnwrapErr() })[0]).toContain("JSON array of open pages");
  });
});

// THE PAGE'S OWN QUESTION AND LEAN. Fleet finding `a-react-now-card-is-authored-from-a`: a card typed lean B
// while its page's lean was A, and a lock-in was stamped with the card's.
describe("projectOpenPageCards reads a local page's question and lean from the page", () => {
  const PAGE_QUESTION = "Which queue should the console open on?";
  const PAGE_LEAN = "A, because it is the one they already read.";
  const AFTER = "2026-10-02T09:00:00Z";

  /** An entry that types every field but the two the page supplies. */
  function untyped({ url, landedIso }: { url: string; landedIso: string }): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(entry({ over: { landedIso }, url })).filter(([key]) => key !== "question" && key !== "lean"),
    );
  }

  it("carries the page's marked sentences as the card's question and lean", () => {
    const { cards, typed } = unwrap(
      projectOpenPageCards({
        document: [untyped({ landedIso: AFTER, url: FIRST })],
        pagesDirectory: PAGES,
        ranked: [ranked({ label: "the queue", url: FIRST })],
        readPage: marking({ lean: PAGE_LEAN, question: PAGE_QUESTION }),
      }),
    );

    expect(cards[0]!.question).toBe(PAGE_QUESTION);
    expect(cards[0]!.lean).toEqual([{ kind: "text", text: PAGE_LEAN }]);
    expect(typed).toEqual([]);
  });

  it("refuses an entry that types a lean beside the page's own, which is the drift itself", () => {
    const drifted = { ...untyped({ landedIso: AFTER, url: FIRST }), lean: "B, the card remembers it that way." };
    const result = projectOpenPageCards({
      document: [drifted],
      pagesDirectory: PAGES,
      ranked: [ranked({ label: "the queue", url: FIRST })],
      readPage: marking({ lean: PAGE_LEAN, question: PAGE_QUESTION }),
    });

    expect(briefingErrorLines({ error: result._unsafeUnwrapErr() })).toEqual([
      `open page "the page at ${FIRST}" types \`lean\` on its entry while the page marks its own: the card reads those from ` +
        "the page, so a typed copy can only drift from it. Delete that key from the entry.",
    ]);
  });

  it("refuses an entry typing both, even when they match the page, since one source is the rule", () => {
    const copied = { ...untyped({ landedIso: AFTER, url: FIRST }), lean: PAGE_LEAN, question: PAGE_QUESTION };
    const result = projectOpenPageCards({
      document: [copied],
      pagesDirectory: PAGES,
      ranked: [ranked({ label: "the queue", url: FIRST })],
      readPage: marking({ lean: PAGE_LEAN, question: PAGE_QUESTION }),
    });

    expect(result._unsafeUnwrapErr().code).toBe("OPEN_PAGE_CARDS_REFUSED");
    expect(briefingErrorLines({ error: result._unsafeUnwrapErr() })[0]).toContain(
      "types `question` and `lean` on its entry",
    );
  });

  it("refuses an unmarked page that landed on or after the cutoff, naming the marks and the publish verb", () => {
    const result = projectOpenPageCards({
      document: [entry({ over: { landedIso: PAGE_MARKS_REQUIRED_FROM_ISO }, url: FIRST })],
      pagesDirectory: PAGES,
      ranked: [{ ...ranked({ label: "the queue", url: FIRST }), landedIso: PAGE_MARKS_REQUIRED_FROM_ISO }],
      readPage: UNMARKED,
    });

    expect(briefingErrorLines({ error: result._unsafeUnwrapErr() })).toEqual([
      'open page "the queue" cannot become a card: the page marks no question and no lean. A card reads its ' +
        'question and lean from the page (one element `data-card="question"`, one `data-card="lean"`) rather than ' +
        "from the entry, so mark them on the page and republish it with " +
        `\`slopweaver page publish <slug> --page <fragment>.html --review <id>\`. (${FIRST})`,
    ]);
  });

  it("refuses a page whose bytes cannot be read once marks are required, carrying the reader's own line", () => {
    const result = projectOpenPageCards({
      document: [untyped({ landedIso: AFTER, url: FIRST })],
      pagesDirectory: PAGES,
      ranked: [{ ...ranked({ label: "the queue", url: FIRST }), landedIso: AFTER }],
      readPage: () => err(PublishedPagesReadErrors.neverFrozen({ pageKey: "first" })),
    });

    expect(briefingErrorLines({ error: result._unsafeUnwrapErr() })[0]).toContain(
      `cannot become a card: its published bytes could not be read (${PublishedPagesReadErrors.neverFrozen({ pageKey: "first" }).message})`,
    );
  });

  it("refuses a page landed before the cutoff whose bytes the store could not give, rather than typing it", () => {
    const missed = PublishedPageReadErrors.notPrefetched({ url: FIRST });
    const result = projectOpenPageCards({
      document: [entry({ url: FIRST })],
      pagesDirectory: PAGES,
      ranked: [ranked({ label: "the old page", url: FIRST })],
      readPage: () => err(missed),
    });

    expect(briefingErrorLines({ error: result._unsafeUnwrapErr() })[0]).toContain(
      `open page "the old page" cannot become a card: its published bytes could not be read (${missed.message})`,
    );
  });

  it("types a page landed before the cutoff that the store holds no freeze of, as the folders did", () => {
    const { typed } = unwrap(
      projectOpenPageCards({
        document: [entry({ url: FIRST })],
        pagesDirectory: PAGES,
        ranked: [ranked({ label: "the old page", url: FIRST })],
        readPage: () => err(PublishedPagesReadErrors.neverFrozen({ pageKey: "first" })),
      }),
    );

    expect(typed.map((page) => page.url)).toEqual([FIRST]);
  });

  it("types an unmarked page that landed before the cutoff, and names it so it can be retired", () => {
    const { cards, typed } = unwrap(
      projectOpenPageCards({
        document: [entry({ url: FIRST })],
        pagesDirectory: PAGES,
        ranked: [ranked({ label: "the old page", url: FIRST })],
        readPage: UNMARKED,
      }),
    );

    expect(cards[0]!.lean).toEqual([{ kind: "text", text: "A, since the fold already carries the order." }]);
    expect(typed).toEqual([{ label: "the old page", url: FIRST, why: "the page marks no question and no lean" }]);
    expect(typedPageLines({ typed })).toEqual([
      `--open-page-cards typed the question and lean of 1 page(s) that landed before ${PAGE_MARKS_REQUIRED_FROM_ISO}; ` +
        "republish each with data-card marks so its card reads them from the page:",
      `  the old page: the page marks no question and no lean (${FIRST})`,
    ]);
  });

  it("reads an old page that has since been republished with marks, rather than its typed pair", () => {
    const { cards, typed } = unwrap(
      projectOpenPageCards({
        document: [untyped({ landedIso: "2026-09-06T10:00:00Z", url: FIRST })],
        pagesDirectory: PAGES,
        ranked: [ranked({ label: "the old page", url: FIRST })],
        readPage: marking({ lean: PAGE_LEAN, question: PAGE_QUESTION }),
      }),
    );

    expect(cards[0]!.question).toBe(PAGE_QUESTION);
    expect(typed).toEqual([]);
  });

  it("refuses malformed marks whenever the page landed, since a page that tried to mark is never legacy", () => {
    const result = projectOpenPageCards({
      document: [entry({ url: FIRST })],
      pagesDirectory: PAGES,
      ranked: [ranked({ label: "the old page", url: FIRST })],
      readPage: () => ok('<p data-card="question">Which?</p>'),
    });

    expect(briefingErrorLines({ error: result._unsafeUnwrapErr() })[0]).toContain(
      'the page marks no data-card="lean", and a card needs both sentences from it',
    );
  });

  it("never reads a page for a GitHub subject, which has none", () => {
    const pr = "https://github.com/acme/acme-admin/pull/17433";
    const { cards, typed } = unwrap(
      projectOpenPageCards({
        document: [entry({ over: { landedIso: AFTER }, url: pr })],
        pagesDirectory: PAGES,
        ranked: [{ ...ranked({ label: "the PR", url: pr }), landedIso: AFTER }],
        readPage: () => err(PublishedPageReadErrors.notPrefetched({ url: pr })),
      }),
    );

    expect(cards[0]!.question).toBe("Which of these do you want to react to first?");
    expect(typed).toEqual([]);
  });
});

// THE LOCAL COPY. Owner ask `every-published-page-keeps-its-rendered-html-under`: a page the owner is asked to act on
// lives under this home's `pages/`. MEASURED on one chair's open-pages.json: 8 of 38 entries were claude.ai
// artifacts with no copy on disk.
describe("projectOpenPageCards refuses a page that does not name its local copy", () => {
  const ARTIFACT = "https://claude.ai/code/artifact/9d4848a3-3b8c-4d54-80cf-429f9082f991";
  const TMP_PAGE = "file:///tmp/fleet-briefing.html";

  it("refuses a claude.ai artifact, naming the page, its url and the publish verb", () => {
    const result = projectOpenPageCards({
      document: [entry({ url: ARTIFACT })],
      pagesDirectory: PAGES,
      readPage: UNMARKED,
      ranked: [ranked({ label: "the gallery page", url: ARTIFACT })],
    });

    expect(briefingErrorLines({ error: result._unsafeUnwrapErr() })).toEqual([
      `open page "the gallery page" cannot become a card: ${ARTIFACT} is not its local copy. A page lives at ` +
        `${PAGES}/<slug>/index.html, never on claude.ai or in a temp directory. ` +
        "Republish it from the copy you hold with `slopweaver page publish <slug> --page <fragment>.html --review <id>` " +
        "(the review from `slopweaver page review-prepare`) and " +
        "point the entry's `url` at the address that prints, or drop the entry until the page exists.",
    ]);
  });

  it("names every offender in one pass and still refuses the unwritten local page beside them", () => {
    const bare = { ask: "a", label: "unwritten", landedIso: "2026-09-06T10:00:00Z", url: FIRST };
    const result = projectOpenPageCards({
      document: [entry({ url: ARTIFACT }), entry({ url: TMP_PAGE }), bare],
      pagesDirectory: PAGES,
      readPage: UNMARKED,
      ranked: [
        ranked({ label: "gallery", url: ARTIFACT }),
        ranked({ label: "tmp", url: TMP_PAGE }),
        ranked({ label: "unwritten", url: FIRST }),
      ],
    });

    expect(briefingErrorLines({ error: result._unsafeUnwrapErr() }).map((line) => line.split(":")[0])).toEqual([
      'open page "gallery" cannot become a card',
      'open page "tmp" cannot become a card',
      'open page "unwritten" cannot become a card',
    ]);
  });

  it("gives no card and no refusal to an artifact page the owner's ruling already settled", () => {
    const settled: BriefingOpenArtifact = {
      ...ranked({ label: "settled", url: ARTIFACT }),
      validity: { by: "the local copy", mark: "superseded" },
    };

    expect(
      unwrap(
        projectOpenPageCards({
          document: [entry({ url: ARTIFACT })],
          pagesDirectory: PAGES,
          readPage: UNMARKED,
          ranked: [settled],
        }),
      ).cards,
    ).toEqual([]);
  });

  it("cards a GitHub pull request subject, which is not a page", () => {
    const pr = "https://github.com/acme/acme-admin/pull/17433";
    const { cards } = unwrap(
      projectOpenPageCards({
        document: [entry({ url: pr })],
        pagesDirectory: PAGES,
        readPage: UNMARKED,
        ranked: [ranked({ label: "the PR", url: pr })],
      }),
    );

    expect(cards.map((card) => card.subject!.url)).toEqual([pr]);
  });
});

describe("openPageUrls", () => {
  it("answers the local pages a projection will read, in rank order, and skips a subject with no page", () => {
    const pr = "https://github.com/acme/acme-admin/pull/17433";

    expect(
      openPageUrls({
        ranked: [
          ranked({ label: "second", rank: 1, url: SECOND }),
          ranked({ label: "a pull request", rank: 2, url: pr }),
          ranked({ label: "first", rank: 3, url: FIRST }),
        ],
      }),
    ).toEqual([SECOND, FIRST]);
  });
});
