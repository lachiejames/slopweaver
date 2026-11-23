/*
 * The orb card the open-card tests share (`openCard.test.ts`, `openCardReadCard.test.ts`): a hand step linking two
 * pages, a thread and a pull request, the rows it projects to, and seams that record every opening.
 */
import type { HandStep } from "../../components/live/read";
import type { LiveState } from "../../components/live/useLive";
import type { ConsolePresentation, OpenCardSeams } from "../../components/voice/openCardRun";
import type { runVerbTool } from "../../components/voice/talkToolCalls";
import { NO_ALIGNMENT_CARDS } from "../../lib/cardToolPlan";
import { type QueueRow, rowsOf } from "../../lib/queueRows";
import type { CardRemoval, RecentlyLeftCard } from "../../lib/recentQueueDepartures";
import { ACME_PLACER } from "../organisationFixture";

const LOADING = { phase: "loading" } as const;

export const PAGE_ONE = "file:///Users/someone/.slopweaver/pages/orb-mockup/index.html";
export const PAGE_TWO = "file:///Users/someone/.slopweaver/pages/orb-notes/index.html";
export const THREAD = "https://acme.slack.com/archives/C0SYN123ABCD/p1759550000123456";
export const PR = "https://github.com/acme/acme-admin/pull/17564";

/** A hand step naming two published pages, a Slack thread and a pull request. */
export const STEP: HandStep = {
  checkIn: false,
  checklist: undefined,
  cites: [PR],
  context: undefined,
  decision: undefined,
  id: "react-to-the-orb-mockup",
  ifIgnored: undefined,
  integration: undefined,
  keptReason: undefined,
  literal: undefined,
  postedBy: "workspace:12",
  postedIso: "2026-10-04T04:30:00.000Z",
  row: undefined,
  opened: undefined,
  rowProblem: undefined,
  secrets: [],
  shot: undefined,
  unaddressed: undefined,
  unblocks: "the orb's next look",
  url: undefined,
  what: `React to the orb mockup at ${PAGE_ONE} and its notes at ${PAGE_TWO}, raised in ${THREAD}`,
  where: undefined,
  witness: "the owner's reaction is on the board",
};

/** The same step with nothing linked at all. */
export const BARE: HandStep = { ...STEP, cites: [], id: "a-bare-step", what: "Say whether the orb should breathe" };

/**
 * The Queue rows a set of hand steps project to, every other register still loading.
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
    standing: LOADING,
    reviews: LOADING,
    imports: LOADING,
  });
}

export const ROWS = handRows({ steps: [STEP, BARE] });

/** The Queue once the bare step has left it: only the orb step is still on. */
export const LIVE = ROWS.filter((row) => row.id !== BARE.id);

/** When and why the bare step left. */
export const REMOVAL: CardRemoval = { atIso: "2026-10-07T03:18:26.968Z", why: 'ada landed on it ("yes, go")' };

/** The bare step, recently off the Queue. */
export const LEFT: readonly RecentlyLeftCard[] = [{ removed: REMOVAL, row: ROWS.find((row) => row.id === BARE.id)! }];

/** One `browser_open` call the runner made, in order. */
export interface Presented {
  readonly name: string;
  readonly args: Record<string, unknown>;
}

/**
 * Seams that record every opening and answer each as given.
 *
 * @param on the owner's openCards switch
 * @param moved what moving the console comes to
 * @param refuse the `browser_open` argument values whose call is refused
 * @param unread the sources still unread
 * @param rows the cards on the owner's Queue
 * @param recentlyLeft the cards recently off it
 * @param unreadable the briefing slugs whose read fails
 * @param undrawn the keys the screen has not drawn, each with why the console is not moved to it
 * @returns the seams, the console moves, the presents they were asked for and the briefings read
 */
export function recording({
  on,
  moved,
  refuse = [],
  unread = [],
  rows = ROWS,
  recentlyLeft = [],
  unreadable = [],
  undrawn = {},
}: {
  on: boolean;
  moved: ConsolePresentation;
  refuse?: readonly string[];
  unread?: ReturnType<OpenCardSeams["cards"]>["unread"];
  rows?: readonly QueueRow[];
  recentlyLeft?: readonly RecentlyLeftCard[];
  unreadable?: readonly string[];
  undrawn?: Readonly<Record<string, string>>;
}): { seams: OpenCardSeams; moves: string[]; presents: Presented[]; reads: string[] } {
  const moves: string[] = [];
  const presents: Presented[] = [];
  const reads: string[] = [];
  const verb: typeof runVerbTool = async ({ name, args }) => {
    presents.push({ args, name });
    const value = String(Object.values(args)[0]);
    if (refuse.includes(value)) {
      return { answer: { refused: `refused ${value}` }, detail: `refused ${value}`, refused: true };
    }
    return { answer: { opened: value }, detail: "read", refused: false };
  };
  return {
    moves,
    presents,
    reads,
    seams: {
      actLookup: async () => {
        throw new Error("no act is looked up here");
      },
      cards: () => ({
        alignment: NO_ALIGNMENT_CARDS,
        focuses: [],
        fromPath: "/queue?context=slopweaver",
        recentlyLeft,
        rows,
        unread,
      }),
      openCardsOn: () => on,
      presentConsole: async ({ path }) => {
        moves.push(path);
        return moved;
      },
      readBriefing: async ({ slug }) => {
        reads.push(slug);
        if (unreadable.includes(slug)) {
          return { ok: false, why: `ENOENT ${slug}` };
        }
        const path = `/h/.slopweaver/pages/${slug}/index.html`;
        return { masked: false, nextFrom: null, ok: true, path, text: `the words of ${slug}`, whole: true };
      },
      undrawnWhy: async ({ key }) => undrawn[key],
      verb,
    },
  };
}

/** The two briefings the orb card links, each read whole by the recording seam. */
export const ORB_BRIEFINGS = [
  { read: true, slug: "orb-mockup", text: "the words of orb-mockup" },
  { read: true, slug: "orb-notes", text: "the words of orb-notes" },
];
