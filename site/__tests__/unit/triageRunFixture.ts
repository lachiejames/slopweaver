/*
 * The fake seams and the one-step Queue the triage tests share (`triageRun.test.ts`, `triageRunClock.test.ts`).
 */
import type { HandStep } from "../../components/live/read";
import type { LiveState } from "../../components/live/useLive";
import type { TriageSeams } from "../../components/voice/triageRun";
import type { BriefingRead } from "../../lib/briefingRead";
import { NO_ALIGNMENT_CARDS } from "../../lib/cardToolPlan";
import type { QueueFocus } from "../../lib/queueFocus";
import { type QueueRow, rowsOf } from "../../lib/queueRows";
import type { TriageFront, TriageVisit, TriageWalk } from "../../lib/triageWalkTypes";
import { ACME_PLACER } from "../organisationFixture";

/** A ruling whose answer the page never heard begin. */
export const UNSEEN = { seen: false } as const satisfies TriageFront;

const LOADING = { phase: "loading" } as const;
export const WALK_ID = "0b6c1f7e-2a4d-4e5b-9c3a-7d8e9f0a1b2c";
export const OTHER_WALK_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";

/**
 * The fixed clock note a triage answer carries for a card of this length.
 *
 * @param length the length in words, as the note spells it ("2 minutes", "1 minute")
 * @returns the note
 */
export function clockNoteOf({ length }: { length: string }): string {
  return (
    `${length} on this card, counting down beside the owner's menu bar item; on a call you are told when it is up. ` +
    "The owner can name another length for it; never pick one yourself"
  );
}

export const CLOCK_NOTE = clockNoteOf({ length: "2 minutes" });
export const PAUSED_NOTE = "the owner's clock is paused: no time-up line on any card until they say to start it again";
export const NO_CARD_NOTE = "the clock is on: the next card the owner is shown gets its own";
export const SWITCH_OFF_NOTE =
  "the owner's Open cards switch is off, so this card is not on their screen: read it to them, and say once in this pass that " +
  "'open cards' puts each card in front of them";

export const STEP: HandStep = {
  checkIn: false,
  checklist: undefined,
  cites: [],
  context: undefined,
  decision: undefined,
  id: "say-whether-the-orb-breathes",
  ifIgnored: undefined,
  integration: undefined,
  keptReason: undefined,
  literal: undefined,
  opened: undefined,
  postedBy: "workspace:12",
  postedIso: "2026-10-04T04:30:00.000Z",
  row: undefined,
  rowProblem: undefined,
  secrets: [],
  shot: undefined,
  unaddressed: undefined,
  unblocks: "the orb's next look",
  url: undefined,
  what: "Say whether the orb should breathe",
  where: undefined,
  witness: "the owner's reaction is on the board",
};

/**
 * The Queue rows one hand step projects to, every other register still loading.
 *
 * @param steps the hand register's steps
 * @returns the rows
 */
export function handRows({ steps }: { steps: readonly HandStep[] }): readonly QueueRow[] {
  const hands: LiveState<readonly HandStep[]> = {
    fixture: undefined,
    observedAtIso: "2026-10-04T09:00:00.000Z",
    phase: "ready",
    stampedByRoute: false,
    value: steps,
  };
  return rowsOf({
    acts: LOADING,
    board: LOADING,
    drafts: LOADING,
    hands,
    landing: LOADING,
    placer: ACME_PLACER,
    posts: LOADING,
    reviewers: LOADING,
    reviews: LOADING,
    imports: LOADING,
    standing: LOADING,
  });
}

export const ROWS = handRows({ steps: [STEP] });
export const KEY = "hand:say-whether-the-orb-breathes";

/**
 * A briefing read that came back whole and unmasked, off the page file under the console's pages directory.
 *
 * @param slug the briefing page's directory name under the pages directory
 * @param text the words the read returned
 * @returns the read
 */
export function wholeBriefing({ slug, text }: { slug: string; text: string }): BriefingRead {
  return {
    masked: false,
    nextFrom: null,
    ok: true,
    path: `/h/.slopweaver/pages/${slug}/index.html`,
    text,
    whole: true,
  };
}

/**
 * A pass already on the page, in the state a test names: another pass's id, nothing seen, a running clock, not stopped.
 *
 * @param over the fields that differ from that
 * @returns the pass
 */
export function heldWalk({ over = {} }: { over?: Partial<TriageWalk> } = {}): TriageWalk {
  return {
    current: undefined,
    focus: [],
    order: [KEY],
    out: [],
    paused: false,
    previous: undefined,
    rulings: [],
    settled: [],
    shown: [],
    stoppedMs: undefined,
    touchedMs: 4000,
    visits: 0,
    walkId: OTHER_WALK_ID,
    ...over,
  };
}

/**
 * The card in front of the owner on a held pass, its open gone through and no ruling on it.
 *
 * @param over the fields that differ from that
 * @returns the visit
 */
export function heldVisit({ over = {} }: { over?: Partial<TriageVisit> } = {}): TriageVisit {
  return {
    arrived: false,
    fingerprint: "words",
    key: KEY,
    opened: true,
    presentedMs: 4000,
    rewritten: false,
    ruled: false,
    visitId: `${OTHER_WALK_ID}-1`,
    ...over,
  };
}

/**
 * Seams over one Queue, the owner's openCards switch off unless a test turns it on so nothing is presented, recording every
 * clock started or stopped.
 *
 * @param walk the pass already on the page
 * @param rows the cards on the owner's Queue
 * @param focuses the owner's focus, none unless a case switches one on
 * @param openCards whether the "Open cards" switch is on
 * @param refuseConsole whether the console refuses to move when asked
 * @param asked whether the owner's own newest words asked to triage, as the page's word gate reads them
 * @returns the seams, what the clock and the kept pass did, how often the Queue was read, and the instant the seams
 *   read
 */
export function fakes({
  walk,
  rows = ROWS,
  focuses = [],
  openCards = false,
  refuseConsole = false,
  asked = true,
}: {
  walk: TriageWalk | undefined;
  rows?: readonly QueueRow[];
  focuses?: readonly QueueFocus[];
  openCards?: boolean;
  refuseConsole?: boolean;
  asked?: boolean;
}): {
  seams: TriageSeams;
  clocks: string[];
  started: TriageVisit[];
  shownAtStart: boolean[];
  lengthsAtStart: number[];
  lengths: Map<string, number>;
  kept: { walk: TriageWalk | undefined };
  now: { ms: number };
  writes: { count: number };
  cardReads: { count: number };
} {
  const clocks: string[] = [];
  const started: TriageVisit[] = [];
  const shownAtStart: boolean[] = [];
  const lengthsAtStart: number[] = [];
  const lengths = new Map<string, number>();
  const kept = { walk };
  const now = { ms: 5000 };
  const writes = { count: 0 };
  const cardReads = { count: 0 };
  return {
    cardReads,
    clocks,
    kept,
    lengths,
    lengthsAtStart,
    now,
    writes,
    seams: {
      cards: () => {
        cardReads.count += 1;
        return {
          alignment: NO_ALIGNMENT_CARDS,
          focuses,
          fromPath: "/queue?context=slopweaver",
          recentlyLeft: [],
          rows,
          unread: [],
        };
      },
      openCardsOn: () => openCards,
      actLookup: async () => {
        throw new Error("no act is looked up here");
      },
      presentConsole: async () =>
        refuseConsole ? { kind: "refused", why: "the console is closed" } : { kind: "opened" },
      readBriefing: async ({ slug }) => wholeBriefing({ slug, text: `the words of ${slug}` }),
      undrawnWhy: async () => undefined,
      triage: {
        frontOf: () => ({ seen: false }),
        keepLength: ({ visitId, lengthMs }) => {
          lengths.set(visitId, lengthMs);
        },
        lengthOf: ({ visitId }) => lengths.get(visitId),
        mintId: () => WALK_ID,
        nowMs: () => now.ms,
        read: () => kept.walk,
        startClock: ({ visit, shown, lengthMs }) => {
          clocks.push(`start ${visit.visitId}`);
          started.push(visit);
          shownAtStart.push(shown);
          lengthsAtStart.push(lengthMs);
          lengths.set(visit.visitId, lengthMs);
        },
        stopClock: () => {
          clocks.push("stop");
        },
        turnStarted: () => undefined,
        write: ({ walk: next }) => {
          writes.count += 1;
          kept.walk = next;
        },
      },
      triageAsked: () => asked,
      verb: async () => ({ answer: {}, detail: "read", refused: false }),
    },
    started,
    shownAtStart,
  };
}

export const NOT_ASKED = {
  answer: {
    refused:
      "The owner has not asked to triage, so no triage pass begins and no clock runs on any card. For the next card on their " +
      "Queue, take its key from action_items and open_card it. Call triage_next only once they ask to triage in so " +
      "many words.",
  },
  detail: "no triage pass: the owner has not asked to triage",
  partialFailures: [],
  readText: false,
  refused: true,
};
