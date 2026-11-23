/*
 * A Queue card whose board row has an artifact carries that artifact as its first citation chip — a card whose
 * page only the voice could see must put the link, when there is one the owner can open in a browser, on the card.
 *
 * The ask half is driven through `readBoard` and `rowsOf` rather than a hand-built card, so a reader or builder that
 * stops carrying the artifact fails here.
 */
import { describe, expect, it } from "vitest";

import { type Board, type HandStep, readBoard } from "../../components/live/read";
import type { LiveState } from "../../components/live/useLive";
import { artifactCitedForm, artifactPage, withArtifactPage } from "../../lib/cardPages";
import { type HandDecisionRecord, handCard } from "../../lib/handCard";
import { NO_CARD_REFERENCES, resolveInline } from "../../lib/inlineCitations";
import { openCardPlan } from "../../lib/openCard";
import { type QueueRow, rowsOf } from "../../lib/queueRows";
import { ACME_PLACER } from "../organisationFixture";

const LOADING = { phase: "loading" } as const;

/** The refusal for an artifact no chip can open — the text itself never quoted, so nothing in it can link. */
const UNOPENABLE =
  "This card's row records its answer at no web or file address a chip can open, so it is refused rather than " +
  "drawn with the voice reading a place the owner cannot follow.";

const SWIRLS = "file:///Users/someone/.slopweaver/pages/slopweaver-icon-thirteen-evolved/index.html";
const NOTES = "file:///Users/someone/.slopweaver/pages/swirl-notes/index.html";
const PR = "https://github.com/lachiejames/slopweaver/pull/1975";

/**
 * The Queue rows one published ask projects to, every other register still loading.
 *
 * @param over fields laid over the published ask row
 * @returns the rows
 */
function askRows({ over }: { over: Record<string, unknown> }): readonly QueueRow[] {
  const read = readBoard({
    rows: [
      {
        kind: "ask",
        ownerWait: "owner",
        priority: "p1",
        question: "Which one or two of these twenty swirls should the next round build on?",
        questionAskedIso: "2026-10-06T11:59:47.399Z",
        reason: "waiting on the owner",
        section: "runnable",
        slug: "pick-from-twenty-swirl-variants",
        status: "waiting-on-owner",
        ...over,
      },
    ],
    unresolved: 0,
  });
  if (read === undefined) {
    throw new Error("the fixture board did not read");
  }
  const board: LiveState<Board> = {
    fixture: undefined,
    observedAtIso: "2026-10-08T05:00:00.000Z",
    phase: "ready",
    stampedByRoute: false,
    value: read,
  };
  return rowsOf({
    acts: LOADING,
    board,
    drafts: LOADING,
    hands: LOADING,
    landing: LOADING,
    placer: ACME_PLACER,
    posts: LOADING,
    reviewers: LOADING,
    standing: LOADING,
    reviews: LOADING,
    imports: LOADING,
  });
}

/** A hand step deciding the swirls ask, naming one more page in its own words. */
const STEP: HandStep = {
  checkIn: false,
  checklist: undefined,
  cites: [],
  context: undefined,
  decision: undefined,
  id: "pick-a-swirl",
  ifIgnored: undefined,
  integration: undefined,
  keptReason: undefined,
  literal: undefined,
  opened: undefined,
  postedBy: "workspace:12",
  postedIso: "2026-10-08T04:00:00.000Z",
  row: undefined,
  rowProblem: undefined,
  secrets: [],
  shot: undefined,
  unaddressed: undefined,
  unblocks: "the next round of swirls",
  url: undefined,
  what: `Pick one or two swirls; the notes are at ${NOTES}`,
  where: undefined,
  witness: "the owner's pick is on the board",
};

/** The swirls ask as the hand card it joins reads it. */
const DECISION: HandDecisionRecord = {
  blastRadius: undefined,
  lean: "2, orb to the edge",
  options: [
    { letter: "A", option: "point at one or two numbers", tradeoff: "the next round builds on those" },
    { letter: "B", option: "none of these feel right", tradeoff: "the next round starts from what's off" },
  ],
  problem: "The icon is parked until you pick a direction",
  risk: undefined,
  slug: "pick-from-twenty-swirl-variants",
  stillReal: undefined,
  stillRealIso: undefined,
  summary: undefined,
};

describe("artifactPage", () => {
  it("names a published page by its slug", () => {
    expect(artifactPage({ artifact: SWIRLS })).toEqual({ slug: "slopweaver-icon-thirteen-evolved", url: SWIRLS });
  });

  it("names a pull-request artifact by its number", () => {
    expect(artifactPage({ artifact: PR })).toEqual({ slug: "lachiejames/slopweaver#1975", url: PR });
  });

  it("keeps a page address's trailing punctuation that prose scanning would trim", () => {
    const address = "file:///p/pages/demo/index.html?view=full)";
    expect(artifactPage({ artifact: address })).toEqual({ slug: "demo", url: address });
  });

  it("names no chip for an absent or blank artifact", () => {
    expect([artifactPage({ artifact: undefined }), artifactPage({ artifact: "  " })]).toEqual([undefined, undefined]);
  });

  it("names no chip for an artifact that is no web or file address", () => {
    const unlinkable = [
      "javascript:alert(1)",
      "data:text/html,<p>hi</p>",
      "/Users/someone/.slopweaver/notes.md",
      "codex://thread/019ffc8f",
      "//evil.example/x",
    ];
    expect(unlinkable.map((artifact) => artifactPage({ artifact }))).toEqual(unlinkable.map(() => undefined));
  });

  it("names no chip for a file address the console cannot route — anything but a published page", () => {
    const unrouted = ["file:///tmp/report.html", "file://remote-host/p/pages/demo/index.html", "file:///%"];
    expect(unrouted.map((artifact) => artifactPage({ artifact }))).toEqual(unrouted.map(() => undefined));
  });

  it("names no chip for a web address the URL parser refuses, though its scheme is allowed", () => {
    const malformed = ["https://%", "https://[::1", "http://?x"];
    expect(malformed.map((artifact) => artifactPage({ artifact }))).toEqual(malformed.map(() => undefined));
  });

  it("refuses a malformed or address-carrying artifact in words the sentence linker draws no link from", () => {
    const unopenable = ["https://%", "see https://example.com/a", "file:///tmp/https://example.com/a.html", "   ", ""];
    const forms = unopenable.map((artifact) => artifactCitedForm({ artifact, pages: [] }));
    expect(forms).toEqual(unopenable.map(() => ({ kind: "refused", why: UNOPENABLE })));
    expect(resolveInline({ known: [], references: NO_CARD_REFERENCES, text: UNOPENABLE })).toEqual({
      segments: [{ kind: "text", text: UNOPENABLE }],
      unlinked: [],
    });
  });
});

describe("withArtifactPage", () => {
  it("cites the artifact first, ahead of the pages the prose named, each once", () => {
    const card = {
      pages: [
        { slug: "swirl-notes", url: NOTES },
        { slug: "slopweaver-icon-thirteen-evolved", url: SWIRLS },
      ],
    };
    expect(withArtifactPage({ artifact: SWIRLS, card }).pages).toEqual([
      { slug: "slopweaver-icon-thirteen-evolved", url: SWIRLS },
      { slug: "swirl-notes", url: NOTES },
    ]);
  });

  it("leaves a card whose row has no artifact as it was", () => {
    const card = { pages: [{ slug: "swirl-notes", url: NOTES }] };
    expect(withArtifactPage({ artifact: undefined, card })).toBe(card);
  });
});

describe("an ask card over the board", () => {
  it("carries the row's published artifact as a citation chip though its question names no address", () => {
    const rows = askRows({ over: { artifact: SWIRLS } });
    expect(rows.map((row) => row.key)).toEqual(["ask:pick-from-twenty-swirl-variants"]);
    expect(rows.map((row) => row.card.pages)).toEqual([[{ slug: "slopweaver-icon-thirteen-evolved", url: SWIRLS }]]);
  });

  it("carries no chip on a row that published no artifact", () => {
    const rows = askRows({ over: {} });
    expect(rows.map((row) => row.card.pages)).toEqual([[]]);
  });
});

describe("a hand card that decides an ask", () => {
  it("cites the ask's artifact first and is drawn", () => {
    const built = handCard({ artifact: SWIRLS, decision: DECISION, step: STEP });
    expect(built.card.pages).toEqual([
      { slug: "slopweaver-icon-thirteen-evolved", url: SWIRLS },
      { slug: "swirl-notes", url: NOTES },
    ]);
    expect(built.form).toEqual({ kind: "drawn" });
  });

  it("cites only its own pages when the ask published no artifact", () => {
    const built = handCard({ artifact: undefined, decision: DECISION, step: STEP });
    expect(built.card.pages).toEqual([{ slug: "swirl-notes", url: NOTES }]);
  });
});

describe("artifactCitedForm", () => {
  it("draws a card that cites its row's artifact", () => {
    expect(artifactCitedForm({ artifact: SWIRLS, pages: [artifactPage({ artifact: SWIRLS })!] })).toEqual({
      kind: "drawn",
    });
  });

  it("draws a card whose row has no artifact", () => {
    expect(artifactCitedForm({ artifact: undefined, pages: [] })).toEqual({ kind: "drawn" });
  });

  it("refuses a card whose row's artifact is no address a chip can open", () => {
    expect(artifactCitedForm({ artifact: " codex://thread/019ffc8f ", pages: [] })).toEqual({
      kind: "refused",
      why: UNOPENABLE,
    });
  });

  it("refuses a card citing only the trimmed form of an address ending in punctuation", () => {
    const address = "file:///p/pages/demo/index.html?view=full)";
    const trimmed = { slug: "demo", url: "file:///p/pages/demo/index.html?view=full" };
    expect(artifactCitedForm({ artifact: address, pages: [trimmed] }).kind).toBe("refused");
  });

  it("refuses a card whose row has an artifact it does not cite", () => {
    expect(artifactCitedForm({ artifact: SWIRLS, pages: [{ slug: "swirl-notes", url: NOTES }] })).toEqual({
      kind: "refused",
      why:
        `This card's row publishes its answer at ${SWIRLS}, and the card does not cite it first; the voice could ` +
        "read a page the owner could not find, so it is refused rather than drawn without its link leading.",
    });
  });

  it("refuses a card that cites its row's artifact behind another chip", () => {
    const pages = [{ slug: "swirl-notes", url: NOTES }, artifactPage({ artifact: SWIRLS })!];
    expect(artifactCitedForm({ artifact: SWIRLS, pages }).kind).toBe("refused");
  });
});

describe("openCardPlan over an artifact", () => {
  it("opens the published page, never a pull-request artifact the page verb cannot open", () => {
    const rows = askRows({ over: { artifact: PR, question: `Which swirl should the next round build on? ${NOTES}` } });
    const plan = openCardPlan({
      fromPath: "/queue",
      key: "ask:pick-from-twenty-swirl-variants",
      recentlyLeft: [],
      rows,
    })!;
    expect(plan.links.pages.map((page) => page.url)).toEqual([PR, NOTES]);
    expect(plan.firstPage!.slug).toBe("swirl-notes");
  });

  it("opens the artifact itself when it is the published page", () => {
    const rows = askRows({ over: { artifact: SWIRLS } });
    const plan = openCardPlan({
      fromPath: "/queue",
      key: "ask:pick-from-twenty-swirl-variants",
      recentlyLeft: [],
      rows,
    })!;
    expect(plan.firstPage!.slug).toBe("slopweaver-icon-thirteen-evolved");
  });
});
