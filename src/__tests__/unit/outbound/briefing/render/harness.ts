/*
 * What the briefing renderer's test files share: the fixed instant, the one-text-run builder, one well-shaped
 * card, one whole form and one row of the owner's list. The shape assertions across these files are exact strings
 * rather than fragments because three parts of the rendered document are load-bearing for the gate that reads
 * it back — the `<h2>react now</h2>` heading, the `div.need` / `div.q` / `dl.f` skeleton, and the `<details>`
 * element that IS the fold. Every helper builds a value; nothing here touches disk.
 */
import { NO_OWNER_BELIEFS } from "../../../../../briefing/ownerBeliefs.js";

import type {
  BriefingCard,
  BriefingContent,
  BriefingForm,
  BriefingYourRow,
} from "../../../../../outbound/briefing/types.js";

/** The generated owner-intake sentence, which every form carries in the alignment fold. */
const INTAKE_SENTENCE = "Owner turns: 4 read across 1 supervisor session(s), all witnessed.";

/** A fixed instant, so a card's rendered age is the same on every run of this suite. */
export const NOW_ISO = "2026-09-12T00:00:00Z";

/**
 * One text run, the shape most cells are.
 *
 * @returns the content holding that one text run
 */
export function text({ value }: { value: string }): BriefingContent {
  return [{ kind: "text", text: value }];
}

export const CARD: BriefingCard = {
  ifSilent: text({ value: "The draft stays unsent." }),
  lean: text({ value: "A." }),
  options: [
    { letter: "A", text: "Send it as written." },
    { letter: "B", text: "Send it with edits." },
  ],
  premise: { kind: "composed", readIso: "2026-09-11T21:18:59Z" },
  question: "Are you happy with the draft?",
  readiness: { state: "ready" },
  what: text({ value: "The draft adds a template and a doc. It also adds a check that only reports." }),
  whyYou: text({ value: "It is a post to the team under your name." }),
};

export const FORM: BriefingForm = {
  autonomy: { notShown: 0, rows: [] },
  handSteps: { notShown: 0, rows: [], unreadable: 0 },
  ownerBeliefs: NO_OWNER_BELIEFS,
  alignment: {
    headline: text({ value: "2 of 3 live sessions are on the board's top 5." }),
    intake: text({ value: INTAKE_SENTENCE }),
  },
  awaiting: [],
  earlierToday: { notes: [{ headline: text({ value: "A quiet sweep." }) }], summary: "earlier today, in order" },
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
  history: [{ notes: [{ headline: text({ value: "The gate landed." }) }], summary: "history: 29 Aug" }],
  reactNow: { meFacing: [], openArtifacts: [], teamFacing: [CARD] },
  recent: [{ headline: text({ value: "The render verb is built." }) }],
};

/**
 * One row of the owner's list, with whatever a test needs to vary.
 *
 * @returns the ranked row, its defaults overlaid with `over`
 */
export function yourRow({ over }: { over: Partial<BriefingYourRow> }): BriefingYourRow {
  return {
    closing: false,
    headline: text({ value: "Land the render verb yourself." }),
    identity: "handover:a-run",
    link: false,
    rank: 1,
    score: 12,
    whenIso: "2026-08-31T02:26:50.911Z",
    where: "slopweaver handover resume a-run",
    who: "the a-run session",
    why: "somebody is stopped waiting on you",
    ...over,
  };
}
