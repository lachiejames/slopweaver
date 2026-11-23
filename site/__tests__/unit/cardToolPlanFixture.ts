/*
 * The Queue and Alignment fixtures the card tools' tests share (`cardToolPlan.test.ts`,
 * `cardToolPlanReadCard.test.ts`): one hand step, two fleet acts, and the rows they project to.
 */
import type { HandStep } from "../../components/live/read";
import { type AutonomyRow, readAutonomy } from "../../components/live/readAutonomy";
import type { LiveState } from "../../components/live/useLive";
import type { ReadBriefing } from "../../components/voice/cardBriefingRead";
import { type QueueRow, rowsOf } from "../../lib/queueRows";
import { ACME_PLACER } from "../organisationFixture";

const LOADING = { phase: "loading" } as const;

/** One reading, ready. */
function ready<T>({ value }: { value: T }): LiveState<T> {
  return {
    fixture: undefined,
    observedAtIso: "2026-11-02T08:00:00.000Z",
    phase: "ready",
    stampedByRoute: false,
    value,
  };
}

/** A hand step on the owner's Queue, linking nothing. */
const STEP: HandStep = {
  checkIn: false,
  checklist: undefined,
  cites: [],
  context: undefined,
  decision: undefined,
  id: "acme-step",
  ifIgnored: undefined,
  integration: undefined,
  keptReason: undefined,
  literal: undefined,
  opened: undefined,
  postedBy: "workspace:12",
  postedIso: "2026-11-02T07:00:00.000Z",
  row: undefined,
  rowProblem: undefined,
  secrets: [],
  shot: undefined,
  unaddressed: undefined,
  unblocks: "ABC-1",
  url: undefined,
  what: "Say whether ABC-1 ships",
  where: undefined,
  witness: "the owner's word is on the board",
};

/**
 * The rows two registers project to, every other one still loading.
 *
 * @returns the Queue rows those two registers draw
 */
export function rows({
  hands,
  acts,
}: {
  hands: readonly HandStep[];
  acts: readonly AutonomyRow[];
}): readonly QueueRow[] {
  return rowsOf({
    acts: ready({ value: acts }),
    board: LOADING,
    drafts: LOADING,
    hands: ready({ value: hands }),
    imports: LOADING,
    landing: LOADING,
    placer: ACME_PLACER,
    posts: LOADING,
    reviewers: LOADING,
    reviews: LOADING,
    standing: LOADING,
  });
}

/** One act the fleet took, as the ledger printed it. */
const ACTS = readAutonomy([
  {
    action: {
      actionId: "acme-act-1",
      doneIso: "2026-11-02T06:00:00.000Z",
      kind: "edit-pr-description",
      subject: "acme/acme-admin#17",
      why: "stale description",
    },
  },
  {
    action: {
      actionId: "acme-act-2",
      doneIso: "2026-11-02T05:00:00.000Z",
      kind: "edit-pr-description",
      subject: "octo-self/slopweaver#5",
      why: "stale description",
    },
  },
])!;

export const QUEUE = rows({ acts: [], hands: [STEP] });
export const ACT_ROWS = rows({ acts: ACTS, hands: [] });
export const ALIGNMENT = { acts: ACT_ROWS, settled: [] };
export const FROM = "/queue?context=work&view=board";

/**
 * The briefing read for a card that links no briefing: an Alignment act here links none.
 *
 * @returns a failed read naming the slug, so a briefing asked for unexpectedly shows in the answer
 */
export const NO_BRIEFING_EXPECTED: ReadBriefing = async ({ slug }) => ({
  ok: false,
  why: `no briefing expected, asked for ${slug}`,
});
