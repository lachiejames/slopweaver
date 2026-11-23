/**
 * The GENERATED alignment line, all the way through: what `slopweaver handover reconcile` emits, rendered by
 * the real renderer, read back by the real gate.
 *
 * Both other tests of this seam are half a proof. `../handover/reconcile.test.ts` measures the widest
 * headline against the cap's NUMBER; `alignment.test.ts` measures hand-written markup against the CHECK. The
 * defect that landed between them needed neither to be wrong: `handover reconcile` gained a second sentence,
 * the sweep contract said its headline goes into the form VERBATIM, and the render then refused it — 94 words
 * and 3 sentences against caps of 55 and 2. Both halves stayed green while the thing they describe was
 * unpublishable, and the sweep that met it resolved the contradiction by rewriting a generated line.
 *
 * So this file joins them: the generator's WIDEST output on both sides, through `renderBriefing`, into
 * `checkAlignment` and `checkPageBudget`. It fails if the reconciliation grows a clause the cap cannot hold,
 * and it fails if the intake sentence ever stops being folded.
 */
import { describe, expect, it } from "vitest";
import { checkAlignment } from "../../../briefing/alignment.js";
import { NO_OWNER_BELIEFS } from "../../../briefing/ownerBeliefs.js";
import { checkPageBudget } from "../../../briefing/pageBudget.js";
import type { BoardRow } from "../../../handover/rank.js";
import { reconcile } from "../../../handover/reconcile.js";
import { renderBriefing } from "../../../outbound/briefing/render.js";
import type { BriefingContent, BriefingForm } from "../../../outbound/briefing/types.js";
import { intakeClause } from "../../../supervisor/intake.js";

/** One text run, the shape every cell here is. */
function text({ value }: { value: string }): BriefingContent {
  return [{ kind: "text", text: value }];
}

/** One row, with `ready` DERIVED from its standing exactly as `rowOfDoc` derives it. */
const row = ({ standing = "ready", ...over }: Omit<Partial<BoardRow>, "ready"> & { id: string }): BoardRow => ({
  groomed: true,
  kind: "doc",
  label: over.id,
  openedIso: undefined,
  priority: "p2",
  ruled: false,
  waitingHours: 0,
  ...over,
  ready: standing === "ready",
  standing,
});

/**
 * The reconciliation's widest sentence — a gap with no session free to move, the longest of its mutually
 * exclusive branches (`../handover/reconcile.test.ts` enumerates them all and pins that one as the widest).
 */
const WIDEST_HEADLINE = reconcile({
  ranked: [row({ id: "top-0" }), row({ id: "top-1" })],
  worked: [{ rowId: "top-0", session: "ws:1" }],
}).headline;

/** One open peer message, so the widest intake line carries the inbound sentence too. */
const OPEN_INBOUND = {
  chairSessionId: "a0000052-0000-4000-8000-000000000055",
  message: {
    body: "report",
    delivery: "queued",
    lineNumber: 1,
    msgId: "m-1",
    senderName: "live-bot-loop-12sep-a-fb",
    timestamp: "2026-09-02T10:00:00.000Z",
    uuid: "u-1",
  },
  placement: "after-pin",
  pointer: "transcript:a0000052-0000-4000-8000-000000000055#u-1",
} as const;

/** The intake half's widest sentence — dismissals, a stated floor, open peer messages, and both coverage gaps disclosed. */
const WIDEST_INTAKE = intakeClause({
  report: {
    inbound: {
      answered: 0,
      carried: [OPEN_INBOUND],
      chainTraffic: 0,
      inGrace: 0,
      marked: 0,
      read: 2,
      unanswered: [{ ...OPEN_INBOUND, placement: "in-span" }],
    },
    finding: {
      coverage: {
        earliestIso: "2026-09-02T09:00:00.000Z",
        linksKnown: 79,
        reachesSince: false,
        unreadable: [
          {
            claudeSessionId: "a0000052-0000-4000-8000-000000000055",
            untilIso: undefined,
            why: "no transcript on disk",
          },
        ],
        walked: ["a0000052-0000-4000-8000-000000000055"],
      },
      inGrace: 0,
      legs: [{ fromIso: "2026-09-02T09:00:00.000Z", sessionId: "a0000052-0000-4000-8000-000000000055", turns: 3 }],
      markedNoAsk: 3,
      sinceIso: "2026-08-28T00:00:00.000Z",
      turns: [],
      unwitnessed: [],
      witnessed: 0,
    },
    kind: "read",
  },
});

/** A page carrying nothing but the widest generated alignment line the two verbs can produce. */
const FORM: BriefingForm = {
  ownerBeliefs: NO_OWNER_BELIEFS,
  alignment: { headline: text({ value: WIDEST_HEADLINE }), intake: text({ value: WIDEST_INTAKE }) },
  autonomy: { notShown: 0, rows: [] },
  handSteps: { notShown: 0, rows: [], unreadable: 0 },
  awaiting: [],
  header: {
    handoff: "handoff-9012",
    lede: text({ value: "Nothing needs your word." }),
    model: "opus",
    pinnedAt: "23:57",
    readyIso: "2026-09-06T01:40:00.000Z",
    refreshedIso: "2026-09-06T01:12:00.000Z",
    sleeping: false,
    workspace: "ws:598",
  },
  history: [],
  reactNow: { meFacing: [], openArtifacts: [], teamFacing: [] },
  recent: [],
};

describe("the generated alignment line, rendered and checked", () => {
  const html = renderBriefing({ form: FORM });

  it("passes the alignment check with the widest sentence both verbs can generate", () => {
    const result = checkAlignment({ html });

    expect(result.defects).toEqual([]);
    expect(result.aboveFoldWords).toBe(31);
  });

  it("counts the headline above the fold and the intake sentence not at all", () => {
    expect(html).toContain(`<p class="align">${WIDEST_HEADLINE} <details>`);
    expect(html).toContain(
      `<summary>owner intake — every turn the owner typed, and whether a row holds it</summary><div><p>${WIDEST_INTAKE}</p>`,
    );
  });

  it("leaves the whole-page budget clean, so the intake fold is neither a block nor a run-on paragraph", () => {
    const budget = checkPageBudget({ html });

    expect(budget.defects).toEqual([]);
    expect(budget.unfoldedBlocks).toBe(0);
  });
});
