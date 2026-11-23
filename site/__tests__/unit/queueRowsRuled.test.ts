/*
 * Two of the Queue's trust defects (row `the-queue-top-card-reads-stale-and-live-at-once`), from the documents the
 * queue reads to the rows it draws.
 *
 * A hand step whose ask already carries the owner's ruling is not led with as unanswered. And an ask a stated
 * workspace places in `self` wears the Slopweaver mark, not the team's: the Slopweaver view shows Slopweaver things.
 */

import { describe, expect, it } from "vitest";

import { readBoard, readHandSteps } from "../../components/live/read";
import type { LiveState } from "../../components/live/useLive";
import { type QueueRow, rowsOf } from "../../lib/queueRows";
import { ACME_PLACER } from "../organisationFixture";

const LOADING = { phase: "loading" } as const;
const RULED = "2026-10-02T06:10:00.000Z";
const SLUG = "the-vanta-evidence-docs-before-and-after-on-screen-before-anyone-is-asked";

function ready<T>({ value }: { value: T }): LiveState<T> {
  return {
    fixture: undefined,
    observedAtIso: "2026-10-05T02:00:00.000Z",
    phase: "ready",
    stampedByRoute: false,
    value,
  };
}

/** The step the Queue led with, as `hand list --json` printed it, trimmed. */
const STEP = {
  context: "work",
  id: "open-vanta-evidence-docs-before-after",
  opened: undefined,
  postedBy: "workspace:12",
  postedIso: "2026-10-02T06:05:42.000Z",
  unaddressed: undefined,
  unblocks: "the Vanta evidence docs going to the team",
  url: `http://localhost:3000/queue?open=ask%3A${SLUG}`,
  what: "Open the Vanta evidence docs before and after",
  where: "the queue page",
  witness: "slopweaver hand done open-vanta-evidence-docs-before-after --did 'looked'",
};

/** The ask it opens, carrying the owner's ruling. */
const ASK = {
  anchor: "transcript:a#b",
  kind: "ask",
  ownerWait: "already-ruled",
  question: "Do the before and after docs read right?",
  reason: "declared ready",
  repo: "/Users/someone/dev/slopweaver",
  ruledSinceQuestionIso: RULED,
  section: "RUN NOW",
  slug: SLUG,
  status: "ready",
  summary: "the Vanta evidence docs, before and after",
};

function rowsFor({
  steps = [STEP],
  asks,
}: {
  steps?: readonly unknown[];
  asks: readonly unknown[];
}): readonly QueueRow[] {
  return rowsOf({
    acts: LOADING,
    board: ready({ value: readBoard({ rows: asks, unresolved: 0 })! }),
    drafts: LOADING,
    hands: ready({ value: readHandSteps(steps)! }),
    landing: LOADING,
    placer: ACME_PLACER,
    posts: LOADING,
    reviewers: LOADING,
    standing: LOADING,
    reviews: LOADING,
    imports: LOADING,
  });
}

const handOf = ({ rows }: { rows: readonly QueueRow[] }): QueueRow =>
  rows.find((row) => row.key === "hand:open-vanta-evidence-docs-before-after")!;

describe("a hand step opening an ask the owner already ruled on", () => {
  it("carries the ruling's instant, so the card says the owner ruled rather than its posted age", () => {
    expect(handOf({ rows: rowsFor({ asks: [ASK] }) }).ruledIso).toBe(RULED);
  });

  it("carries the latest ruling when every row under the slug is ruled", () => {
    const later = { ...ASK, anchor: "transcript:c#d", ruledSinceQuestionIso: "2026-10-03T00:00:00.000Z" };
    expect(handOf({ rows: rowsFor({ asks: [ASK, later] }) }).ruledIso).toBe("2026-10-03T00:00:00.000Z");
  });

  it("stays the owner's while any row under the slug still waits on the owner", () => {
    const waiting = { ...ASK, anchor: "transcript:c#d", ownerWait: "owner", ruledSinceQuestionIso: undefined };
    expect(handOf({ rows: rowsFor({ asks: [ASK, waiting] }) }).ruledIso).toBe(undefined);
  });

  it("carries nothing when the step opens no ask, or the board holds none", () => {
    const plain = { ...STEP, url: undefined };
    expect(handOf({ rows: rowsFor({ asks: [ASK], steps: [plain] }) }).ruledIso).toBe(undefined);
    expect(handOf({ rows: rowsFor({ asks: [] }) }).ruledIso).toBe(undefined);
  });
});

describe("an ask's mark and tier follow its placement", () => {
  const waiting = { ...ASK, ownerWait: "owner", ruledSinceQuestionIso: undefined };
  const askOf = ({ ask }: { ask: Record<string, unknown> }): QueueRow =>
    rowsFor({ asks: [ask], steps: [] }).find((row) => row.key === `ask:${SLUG}`)!;

  it("wears the Slopweaver logo when it states self", () => {
    const row = askOf({ ask: { ...waiting, workspace: "self" } });
    expect([row.provenance, row.tier]).toEqual(["self", "fleet-blocked"]);
  });

  it("wears the team mark when it states team, but blocks no colleague on a stated workspace alone", () => {
    const row = askOf({ ask: { ...waiting, workspace: "team" } });
    expect([row.provenance, row.tier]).toEqual(["team", "fleet-blocked"]);
  });

  it("blocks a colleague when a team pull request places it", () => {
    const row = askOf({ ask: { ...waiting, prUrls: ["https://github.com/acme/acme-admin/pull/16672"] } });
    expect([row.placement.kind, row.provenance, row.tier]).toEqual(["placed", "team", "team-blocked"]);
  });

  it("wears the default rule's Slopweaver logo while it is unplaced, never the team's", () => {
    const row = askOf({ ask: waiting });
    expect([row.placement.kind, row.provenance, row.tier]).toEqual(["unplaced", "self", "fleet-blocked"]);
  });
});
