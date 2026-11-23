/**
 * A page a run delivered reached the owner only when a Queue card, a ruling or a hand step carried it. The measured
 * failure: a dispatch ask with no question, settled `answered` with a `page:` witness, left no card anywhere; this
 * file builds it as `acme-plan-usage-to-17-nov`.
 */
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import type { HandoverDoc } from "../../../handover/doc.js";
import type { RunEvent } from "../../../handover/ledger.js";
import {
  artifactPageSlug,
  cardTextOf,
  handPageStepsOf,
  type PageReachFacts,
  pageReachEvidence,
  uncardedPageSlugs,
} from "../../../handover/pageDelivery.js";
import { pageSlugFromReference, pageSlugsNamedIn } from "../../../handover/pageReference.js";
import { pagePath } from "../../../pages/publish.js";

const HOME = "/h/home";
const PAGE = "acme-plan-page-17-nov";
const STARTED: RunEvent = { atIso: "2026-11-02T09:00:00.000Z", branch: "plan-usage", docHash: "h", kind: "started" };

/** The measured row: a dispatch ask, registered with no shape. */
function dispatchAsk(over: Partial<HandoverDoc> = {}): HandoverDoc {
  return {
    anchor: undefined,
    artifact: undefined,
    askedIso: "2026-11-02T08:00:00.000Z",
    baseBranch: undefined,
    blastRadius: undefined,
    blockedBy: [],
    branch: undefined,
    doneWhen: [],
    evidence: [],
    exampleGap: undefined,
    examples: [],
    hisWords: { kind: "absent" },
    hisWordsSteers: [],
    kind: "ask",
    lean: undefined,
    notDoneReason: undefined,
    observedBy: undefined,
    options: [],
    origin: undefined,
    outputs: [],
    path: "/h/acme-plan-usage-to-17-nov.md",
    pausedOn: undefined,
    pausedSince: undefined,
    priority: "p0",
    probeWaiver: undefined,
    problem: undefined,
    problems: [],
    registeredBy: undefined,
    registeredRun: undefined,
    repo: undefined,
    risk: undefined,
    role: undefined,
    ruling: undefined,
    rulingAnchor: undefined,
    settlement: undefined,
    settlementReason: undefined,
    settlementWitness: undefined,
    slug: "acme-plan-usage-to-17-nov",
    status: "ready",
    statusSummary: undefined,
    stillReal: undefined,
    stillRealIso: undefined,
    summary: "Work out the plan-usage strategy to 3 Mar",
    supervisorState: undefined,
    ...over,
  };
}

function facts(over: Partial<PageReachFacts> = {}): PageReachFacts {
  return { doc: dispatchAsk(), events: [STARTED], handPageSteps: new Map(), ruledIdentities: new Set(), ...over };
}

const FILE_URL = pathToFileURL(pagePath({ home: HOME, slug: PAGE })).href;

describe("pageSlugFromReference", () => {
  it("reads the three exact spellings", () => {
    expect(pageSlugFromReference({ home: HOME, reference: `page:${PAGE}` })).toBe(PAGE);
    expect(pageSlugFromReference({ home: HOME, reference: FILE_URL })).toBe(PAGE);
    expect(pageSlugFromReference({ home: HOME, reference: `/api/page/${PAGE}/index.html` })).toBe(PAGE);
    expect(pageSlugFromReference({ home: HOME, reference: `http://localhost:3000/api/page/${PAGE}/index.html` })).toBe(
      PAGE,
    );
  });

  it("reads the page out of the in-app viewer's and the desktop deep link's query", () => {
    // a viewer URL as a settle witness named no page, so the closing gate never ran.
    const viewer = `http://localhost:3000/view?src=%2Fapi%2Fpage%2F${PAGE}%2Findex.html&back=%2Fqueue`;
    expect(pageSlugFromReference({ home: HOME, reference: viewer })).toBe(PAGE);
    const deepLink = `slopweaver://open?path=%2Fapi%2Fpage%2F${PAGE}%2Findex.html`;
    expect(pageSlugFromReference({ home: HOME, reference: deepLink })).toBe(PAGE);
    const nested = `slopweaver://open?path=${encodeURIComponent(`/view?src=%2Fapi%2Fpage%2F${PAGE}%2Findex.html`)}`;
    expect(pageSlugFromReference({ home: HOME, reference: nested })).toBe(PAGE);
    const twoPages = "http://localhost:3000/view?src=%2Fapi%2Fpage%2Fa%2F&also=%2Fapi%2Fpage%2Fb%2F";
    expect(pageSlugFromReference({ home: HOME, reference: twoPages })).toBe("a");
    expect(pageSlugFromReference({ home: HOME, reference: "http://localhost:3000/view?src=%2Fqueue" })).toBe(undefined);
  });

  it("reads no page out of any other address's query", () => {
    const pr = `https://github.com/acme/repo/pull/1?return_to=%2Fapi%2Fpage%2F${PAGE}%2Findex.html`;
    expect(pageSlugFromReference({ home: HOME, reference: pr })).toBe(undefined);
    const otherLink = `slopweaver://settings?path=%2Fapi%2Fpage%2F${PAGE}%2F`;
    expect(pageSlugFromReference({ home: HOME, reference: otherLink })).toBe(undefined);
  });

  it("refuses a page under another home, a bad slug, and an unrelated address", () => {
    const elsewhere = pathToFileURL(pagePath({ home: "/other", slug: PAGE })).href;
    expect(pageSlugFromReference({ home: HOME, reference: elsewhere })).toBe(undefined);
    expect(pageSlugFromReference({ home: HOME, reference: "page:../x" })).toBe(undefined);
    expect(pageSlugFromReference({ home: HOME, reference: "https://github.com/acme/repo/pull/1" })).toBe(undefined);
    expect(pageSlugFromReference({ home: HOME, reference: "ftp://x/api/page/a/index.html" })).toBe(undefined);
  });
});

describe("pageSlugsNamedIn", () => {
  it("finds every spelling once, trimming a sentence's full stop", () => {
    const text = `Read page:${PAGE}. Also ${FILE_URL} and /view?src=%2Fapi%2Fpage%2Fother-page%2Findex.html and page:${PAGE}`;
    expect(pageSlugsNamedIn({ home: HOME, text })).toEqual([PAGE, "other-page"]);
  });

  it("does not read a page identity running on into a longer token", () => {
    expect(pageSlugsNamedIn({ home: HOME, text: `Review page:${PAGE}/bar and page:x:y` })).toEqual([]);
    expect(pageSlugsNamedIn({ home: HOME, text: `page:p%2Fother page:q?x page:r#y page:s\\t` })).toEqual([]);
  });

  it("reads a console route's slug whole, a trailing dot included, since its own slash ends it", () => {
    const text = "see /api/page/p./index.html and /view?src=%2Fapi%2Fpage%2Fq.%2F.";
    expect(pageSlugsNamedIn({ home: HOME, text })).toEqual(["p.", "q."]);
  });

  it("reads no page inside another address's path or query", () => {
    const text = [
      `Review https://github.com/acme/repo/pull/1?return_to=%2Fapi%2Fpage%2F${PAGE}%2Findex.html`,
      `and https://github.com/acme/repo/blob/main/api/page/${PAGE}/index.ts`,
      `and https://example.test/?next=/api/page/${PAGE}/ and a bare %2Fapi%2Fpage%2F${PAGE}%2F`,
    ].join(" ");
    expect(pageSlugsNamedIn({ home: HOME, text })).toEqual([]);
  });

  it("reads a page out of a whole console, viewer or deep-link address in text", () => {
    const text = [
      `(http://localhost:3000/api/page/a/index.html)`,
      `http://localhost:3000/view?src=%2Fapi%2Fpage%2Fb%2Findex.html&back=%2Fqueue,`,
      `slopweaver://open?path=%2Fapi%2Fpage%2Fc%2F.`,
    ].join(" ");
    expect(pageSlugsNamedIn({ home: HOME, text })).toEqual(["a", "b", "c"]);
  });

  it("reads a page identity closed by whitespace, the end or closing punctuation", () => {
    const text = `(page:a) "page:b", page:c; page:d\npage:e? page:f?`;
    expect(pageSlugsNamedIn({ home: HOME, text })).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  it("does not read a bare slug in prose as a reference", () => {
    expect(pageSlugsNamedIn({ home: HOME, text: `the ${PAGE} briefing` })).toEqual([]);
  });
});

describe("cardTextOf", () => {
  it("shows a question's text and a correction's question, never a correction's why, a withdrawal or an annotation", () => {
    const at = STARTED.atIso;
    const events = [
      { atIso: at, kind: "question", question: "Q?" },
      { atIso: at, kind: "question-corrected", question: "Q2?", why: "W" },
      { atIso: at, kind: "question-withdrawn", question: "Q?", why: "W" },
      { atIso: at, kind: "question-posted", question: "Q?" },
      { atIso: at, kind: "question-offered", question: "Q?" },
    ] as RunEvent[];
    expect(events.map((event) => cardTextOf({ event }))).toEqual([["Q?"], ["Q2?"], [], [], []]);
  });

  it("shows a question's shape, stakes and examples, never its drafted message, which folds", () => {
    const event = {
      action: {
        actor: "me",
        form: {
          bcc: [],
          body: `line\nline\nline\nline\nline\nline\nline\nline\nReview page:${PAGE}`,
          cc: [],
          subject: "S",
          to: ["someone@acme.example"],
        },
        from: "owner@acme.example",
        kind: "mail",
        version: 2,
      },
      atIso: STARTED.atIso,
      examples: ["E"],
      kind: "question",
      lean: "L",
      options: [{ letter: "A", option: "O", tradeoff: "T" }],
      problem: "P",
      question: "Q?",
      stakes: { blastRadius: "B", risk: "R", stillReal: "S" },
    } as RunEvent;
    expect(cardTextOf({ event })).toEqual(["Q?", "P", "O", "T", "L", "R", "B", "S", "E"]);
  });
});

describe("pageReachEvidence", () => {
  it("finds nothing for the measured dispatch ask with no question", () => {
    expect(pageReachEvidence({ facts: facts(), home: HOME, slug: PAGE })).toBe(undefined);
    expect(uncardedPageSlugs({ facts: facts(), home: HOME, slugs: [PAGE, PAGE] })).toEqual([PAGE]);
  });

  it("accepts a current-cycle question naming the page", () => {
    const asked = {
      atIso: "2026-11-02T10:00:00.000Z",
      kind: "question",
      question: `React to page:${PAGE}?`,
    } as RunEvent;
    expect(pageReachEvidence({ facts: facts({ events: [STARTED, asked] }), home: HOME, slug: PAGE })).toEqual({
      atIso: "2026-11-02T10:00:00.000Z",
      kind: "queue-question",
    });
  });

  it("refuses a question naming another page, and one asked in an earlier cycle", () => {
    const other = { atIso: "2026-11-02T10:00:00.000Z", kind: "question", question: "React to page:other?" } as RunEvent;
    expect(pageReachEvidence({ facts: facts({ events: [STARTED, other] }), home: HOME, slug: PAGE })).toBe(undefined);
    const old = { atIso: "2026-11-01T10:00:00.000Z", kind: "question", question: `page:${PAGE}?` } as RunEvent;
    expect(pageReachEvidence({ facts: facts({ events: [old, STARTED] }), home: HOME, slug: PAGE })).toBe(undefined);
  });

  it("accepts any current-cycle question when the effective artifact is the page", () => {
    const published = { atIso: "2026-11-02T09:30:00.000Z", kind: "artifact", url: FILE_URL } as RunEvent;
    const asked = { atIso: "2026-11-02T10:00:00.000Z", kind: "question", question: "Which plan first?" } as RunEvent;
    const events = [STARTED, published, asked];
    expect(artifactPageSlug({ doc: dispatchAsk(), events, home: HOME })).toBe(PAGE);
    expect(pageReachEvidence({ facts: facts({ events }), home: HOME, slug: PAGE })).toEqual({
      atIso: "2026-11-02T10:00:00.000Z",
      kind: "queue-question",
    });
  });

  it("refuses a question asked BEFORE the page became the artifact, since the card it drew never showed it", () => {
    // the card renders the current artifact, so a publish after the question was never in front of the owner.
    const asked = { atIso: "2026-11-02T09:15:00.000Z", kind: "question", question: "Which plan first?" } as RunEvent;
    const published = { atIso: "2026-11-02T09:30:00.000Z", kind: "artifact", url: FILE_URL } as RunEvent;
    expect(pageReachEvidence({ facts: facts({ events: [STARTED, asked, published] }), home: HOME, slug: PAGE })).toBe(
      undefined,
    );
  });

  it("refuses a question naming the page written before it became the artifact, since the link led nowhere yet", () => {
    // naming the page does not lift the journal-order rule once the page is the artifact.
    const at = "2026-11-02T10:00:00.000Z";
    const asked = { atIso: at, kind: "question", question: `React to page:${PAGE}?` } as RunEvent;
    const published = { atIso: at, kind: "artifact", url: FILE_URL } as RunEvent;
    expect(pageReachEvidence({ facts: facts({ events: [STARTED, asked, published] }), home: HOME, slug: PAGE })).toBe(
      undefined,
    );
  });

  it("orders by journal position, so a question sharing the artifact's millisecond but written first is refused", () => {
    // question, answer and publish all at 10:00.000, in that order — the card never showed the page.
    const at = "2026-11-02T10:00:00.000Z";
    const asked = { atIso: at, kind: "question", question: "Which plan first?" } as RunEvent;
    const answered = { answer: "A", atIso: at, kind: "answered" } as RunEvent;
    const published = { atIso: at, kind: "artifact", url: FILE_URL } as RunEvent;
    const before = facts({ events: [STARTED, asked, answered, published] });
    expect(pageReachEvidence({ facts: before, home: HOME, slug: PAGE })).toBe(undefined);
    const after = facts({ events: [STARTED, published, asked] });
    expect(pageReachEvidence({ facts: after, home: HOME, slug: PAGE })).toEqual({ atIso: at, kind: "queue-question" });
  });

  it("refuses a withdrawal after the publish, and a correction with no question waiting, since neither draws a card", () => {
    // question, publish, then withdraw — the withdrawal removed the only card, which predated the page.
    const asked = { atIso: "2026-11-02T09:15:00.000Z", kind: "question", question: "Which plan?" } as RunEvent;
    const published = { atIso: "2026-11-02T09:30:00.000Z", kind: "artifact", url: FILE_URL } as RunEvent;
    const withdrawn = {
      atIso: "2026-11-02T09:45:00.000Z",
      kind: "question-withdrawn",
      question: "Which plan?",
      why: "moot",
    } as RunEvent;
    const corrected = {
      atIso: "2026-11-02T10:00:00.000Z",
      kind: "question-corrected",
      question: "Which plan now?",
      why: "typo",
    } as RunEvent;
    const events = [STARTED, asked, published, withdrawn, corrected];
    expect(pageReachEvidence({ facts: facts({ events }), home: HOME, slug: PAGE })).toBe(undefined);
  });

  it("refuses a page named only in a correction's why, which no card renders, and accepts one in its question", () => {
    // `why` is journal metadata; the card shows the corrected question alone.
    const asked = { atIso: "2026-11-02T09:15:00.000Z", kind: "question", question: "Choose A or B?" } as RunEvent;
    const hidden = {
      atIso: "2026-11-02T09:30:00.000Z",
      kind: "question-corrected",
      question: "Choose A or B today?",
      why: `old wording; see page:${PAGE}`,
    } as RunEvent;
    expect(pageReachEvidence({ facts: facts({ events: [STARTED, asked, hidden] }), home: HOME, slug: PAGE })).toBe(
      undefined,
    );
    const shown = { ...hidden, question: `Choose A or B — page:${PAGE}?`, why: "named the page" } as RunEvent;
    expect(pageReachEvidence({ facts: facts({ events: [STARTED, asked, shown] }), home: HOME, slug: PAGE })).toEqual({
      atIso: "2026-11-02T09:30:00.000Z",
      kind: "queue-question",
    });
  });

  it("accepts a correction after the publish while the question is still waiting, since it redraws the card", () => {
    const asked = { atIso: "2026-11-02T09:15:00.000Z", kind: "question", question: "Which plan?" } as RunEvent;
    const published = { atIso: "2026-11-02T09:30:00.000Z", kind: "artifact", url: FILE_URL } as RunEvent;
    const corrected = {
      atIso: "2026-11-02T10:00:00.000Z",
      kind: "question-corrected",
      question: "Which plan now?",
      why: "typo",
    } as RunEvent;
    const events = [STARTED, asked, published, corrected];
    expect(pageReachEvidence({ facts: facts({ events }), home: HOME, slug: PAGE })).toEqual({
      atIso: "2026-11-02T10:00:00.000Z",
      kind: "queue-question",
    });
  });

  it("refuses a wholly shaped registered ask whose only link to the page is a later artifact", () => {
    const shape = {
      lean: "A",
      options: [{ letter: "A", option: "go", tradeoff: "spends a plan-week" }],
      problem: "which plan to run first",
    };
    const published = { atIso: "2026-11-02T09:30:00.000Z", kind: "artifact", url: FILE_URL } as RunEvent;
    const reach = facts({ doc: dispatchAsk(shape), events: [STARTED, published] });
    expect(pageReachEvidence({ facts: reach, home: HOME, slug: PAGE })).toBe(undefined);
  });

  it("refuses a wholly shaped registered ask even when its own text names the page, since no journal orders it", () => {
    // the reference can be edited into front matter after the registration card has gone.
    const shape = {
      lean: "A",
      options: [{ letter: "A", option: "go", tradeoff: "spends a plan-week" }],
      problem: `the plan is at page:${PAGE}`,
      summary: `Review page:${PAGE}`,
    };
    expect(pageReachEvidence({ facts: facts({ doc: dispatchAsk(shape) }), home: HOME, slug: PAGE })).toBe(undefined);
  });

  it("accepts a row ruling, a page ruling and a hand step, each for this page only", () => {
    const ruled = dispatchAsk({ ruling: "go with A", rulingAnchor: "transcript:abc" });
    expect(pageReachEvidence({ facts: facts({ doc: ruled }), home: HOME, slug: PAGE })).toEqual({ kind: "row-ruling" });
    const lockIn = facts({ ruledIdentities: new Set([`page:${PAGE}`]) });
    expect(pageReachEvidence({ facts: lockIn, home: HOME, slug: PAGE })).toEqual({
      identity: `page:${PAGE}`,
      kind: "page-ruling",
    });
    expect(pageReachEvidence({ facts: lockIn, home: HOME, slug: "other" })).toBe(undefined);
    const steps = handPageStepsOf({ home: HOME, steps: [{ id: "read-plan", url: `/api/page/${PAGE}/index.html` }] });
    expect(pageReachEvidence({ facts: facts({ handPageSteps: steps }), home: HOME, slug: PAGE })).toEqual({
      kind: "hand-step",
      stepId: "read-plan",
    });
    expect(pageReachEvidence({ facts: facts({ handPageSteps: steps }), home: HOME, slug: "other" })).toBe(undefined);
  });

  it("reads a hand step's drawn text only, never its free-text provenance", () => {
    const provenance = { id: "deploy", postedBy: `page:${PAGE}`, postedIso: "2026-11-04T00:00:00Z", what: "Approve" };
    expect([...handPageStepsOf({ home: HOME, steps: [provenance] })]).toEqual([]);
    const drawn = { id: "read", what: "Read it", checklist: [{ action: "Open", url: `page:${PAGE}` }] };
    expect([...handPageStepsOf({ home: HOME, steps: [drawn] })]).toEqual([[PAGE, "read"]]);
    const cited = { cites: [`http://localhost:3000/api/page/${PAGE}/index.html`], id: "cite", what: "See it" };
    expect([...handPageStepsOf({ home: HOME, steps: [cited] })]).toEqual([[PAGE, "cite"]]);
    const boxed = { id: "boxed", shot: { boxes: [{ label: `page:${PAGE}` }] }, what: "Look here" };
    expect([...handPageStepsOf({ home: HOME, steps: [boxed] })]).toEqual([[PAGE, "boxed"]]);
  });
});
