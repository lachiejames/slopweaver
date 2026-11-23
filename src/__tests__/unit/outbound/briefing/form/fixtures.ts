/**
 * The one well-shaped card and page every briefing-form case starts from, and the small builders that break
 * exactly one thing in them, so a failing test names the cap that moved rather than "the form is wrong".
 */
import { NO_OWNER_BELIEFS } from "../../../../../briefing/ownerBeliefs.js";
import type {
  BriefingArtifactLink,
  BriefingCard,
  BriefingContent,
  BriefingForm,
  BriefingOpenArtifact,
  BriefingYourRow,
} from "../../../../../outbound/briefing/types.js";

/** The generated owner-intake sentence, which every form carries in the alignment fold. */
const INTAKE_SENTENCE = "Owner turns: 4 read across 1 supervisor session(s), all witnessed.";

/**
 * A `data:image/png;base64,…` URI that decodes to exactly `bytes` raw bytes.
 *
 * @returns the URI, sized to the byte
 */
export function dataUriOfBytes({ bytes }: { bytes: number }): string {
  return `data:image/png;base64,${Buffer.alloc(bytes).toString("base64")}`;
}

/**
 * `count` plain words as one sentence, so a fixture sits a chosen distance from a word cap.
 *
 * @returns one sentence of exactly that many words
 */
export function sentenceOfWords({ count }: { count: number }): string {
  return `${Array.from({ length: count }, () => "alpha").join(" ")}.`;
}

/**
 * One text run, the shape most cells are.
 *
 * @returns the content, one run long
 */
export function text({ value }: { value: string }): BriefingContent {
  return [{ kind: "text", text: value }];
}

/** The one well-shaped card every case breaks exactly one thing in. */
export const CARD: BriefingCard = {
  ifSilent: text({ value: "The draft stays unsent." }),
  lean: text({ value: "A." }),
  premise: { kind: "composed", readIso: "2026-09-11T21:18:59Z" },
  options: [
    { letter: "A", text: "Send it as written." },
    { letter: "B", text: "Send it with edits." },
  ],
  question: "Are you happy with the draft?",
  readiness: { state: "ready" },
  // A `detail` fold, because a card must offer somewhere to go for what decides it. A `subject` link would
  // satisfy the same rule, and this takes the fold on purpose: `cardAboveFoldWords` counts a subject line
  // and does NOT count a fold, so the fold leaves every budget figure these tests assert on untouched.
  detail: {
    blocks: [{ content: [{ kind: "text", text: "The whole draft, as it stands." }], kind: "para" }],
    summary: "The draft in full",
  },
  what: text({ value: "The draft adds a template and a doc. It also adds a check that only reports." }),
  whyYou: text({ value: "It is a post to the team under your name." }),
};

/** The one well-shaped page, carrying `CARD` as its only team-facing card. */
export const FORM: BriefingForm = {
  autonomy: { notShown: 0, rows: [] },
  handSteps: { notShown: 0, rows: [], unreadable: 0 },
  ownerBeliefs: NO_OWNER_BELIEFS,
  alignment: {
    headline: text({ value: "2 of 3 live sessions are on the board's top 5." }),
    intake: text({ value: INTAKE_SENTENCE }),
  },
  awaiting: [],
  header: {
    handoff: "handoff-9012",
    readyIso: "2026-09-02T01:40:00.000Z",
    refreshedIso: "2026-09-02T01:12:00.000Z",
    lede: text({ value: "One thing needs your word." }),
    model: "opus",
    pinnedAt: "23:57",
    sleeping: false,
    workspace: "ws:598",
  },
  history: [],
  reactNow: { meFacing: [], openArtifacts: [], teamFacing: [CARD] },
  recent: [],
};

/**
 * The form with one card field replaced.
 *
 * @returns the form, with that one card in the team-facing grouping
 */
export function withCard({ over }: { over: Partial<BriefingCard> }): unknown {
  return { ...FORM, reactNow: { meFacing: [], openArtifacts: [], teamFacing: [{ ...CARD, ...over }] } };
}

/**
 * The form with one card field replaced, in the me-facing grouping rather than the team-facing one.
 *
 * @returns the form, with that one card in the me-facing grouping
 */
export function withMineCard({ over }: { over: Partial<BriefingCard> }): unknown {
  return { ...FORM, reactNow: { meFacing: [{ ...CARD, ...over }], openArtifacts: [], teamFacing: [] } };
}

/**
 * One artifact entry, the shape the awaiting block is a list of.
 *
 * @returns the entry, with the overridden fields applied
 */
export function artifact({ over }: { over: Partial<BriefingArtifactLink> }): BriefingArtifactLink {
  return {
    label: "Daily Friction Review",
    pending: false,
    url: "https://example.invalid/review",
    waitingOn: text({ value: "Three findings want a keep or drop." }),
    ...over,
  };
}

/**
 * One line of the ranked open-artifact index at `rank`.
 *
 * @returns the index line, its label and url numbered by rank
 */
export function openArtifact({ rank }: { rank: number }): BriefingOpenArtifact {
  return {
    ask: text({ value: "Pick A or B on the scope split." }),
    label: `Open page ${String(rank)}`,
    landedIso: "2026-09-06T04:00:00Z",
    rank,
    url: `https://example.invalid/page-${String(rank)}`,
    validity: { mark: "valid" },
  };
}

/**
 * One row of the owner's list at `rank`, with a headline of `words` words.
 *
 * @returns the row, its identity numbered by rank
 */
export function yourRow({ rank, words = 4 }: { rank: number; words?: number }): BriefingYourRow {
  return {
    closing: false,
    headline: text({ value: sentenceOfWords({ count: words }) }),
    identity: `handover:row-${String(rank)}`,
    link: false,
    rank,
    score: 3,
    whenIso: "2026-09-01T00:00:00.000Z",
    where: "slopweaver handover resume row",
    who: "the row session",
    why: "somebody is stopped waiting on you",
  };
}

/**
 * The form with the owner's list attached.
 *
 * @returns the form, carrying those rows as the owner's list
 */
export function withYourList({
  rows,
  notShown = 0,
}: {
  rows: readonly BriefingYourRow[];
  notShown?: number;
}): BriefingForm {
  return {
    ...FORM,
    yourList: { notShown, readIso: FORM.header.readyIso, rows, source: "slopweaver session-start --json, top 10" },
  };
}
