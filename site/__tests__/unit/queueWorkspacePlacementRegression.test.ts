/*
 * The two Queue cards the owner saw in the wrong context, each driven
 * through the whole seam — the board reader, the Queue's row builder, the context filter, the provenance glyph
 * and the mark — so the class is held down rather than the two rows.
 *
 * - A card whose row STATES the team's workspace and carries no address was drawn as Slopweaver's: the
 *   provenance glyph read a different fact from the one the context filter read.
 * - A card whose row states nothing was drawn in BOTH contexts, so it read as the team's on the team view.
 *   The one rule now: a row no stated fact places is drawn in this installation's own workspace, marked as
 *   placed by default, and never in the other.
 */
import { describe, expect, it } from "vitest";

import { readBoard } from "../../components/live/read";
import { readHandSteps } from "../../components/live/readHandSteps";
import type { LiveState } from "../../components/live/useLive";
import { cardToolPlan, NO_ALIGNMENT_CARDS } from "../../lib/cardToolPlan";
import { queueCounts } from "../../lib/queueCardCounts";
import { rowsOf } from "../../lib/queueRows";
import { markedInView, markInView, shownOnQueue, stoppingElsewhere } from "../../lib/queueStopping";
import { QUEUE_VOICE_ROWS, queueForVoice } from "../../lib/queueVoice";
import { spokenOf } from "../../lib/talkActionItemsSpoken";
import { contextToOpen, findingLabel, shownInContext } from "../../lib/workspacePlacementContext";
import { ACME_PLACER } from "../organisationFixture";

/** Every register but the board, in the phase that contributes no rows. */
const QUIET = { phase: "loading" } as const;

/** A register that arrived, stamped the way the live route stamps one. */
const READY = {
  fixture: undefined,
  observedAtIso: "2026-11-03T08:10:00.000Z",
  phase: "ready",
  stampedByRoute: true,
} as const;

/**
 * The one Queue card a single parked board row projects into, the other registers silent.
 *
 * @param fields what the row carries beyond a parked question
 * @returns the card
 */
function cardOf({ fields }: { fields: Record<string, unknown> }): ReturnType<typeof rowsOf>[number] {
  const board: LiveState<NonNullable<ReturnType<typeof readBoard>>> = {
    ...READY,
    value: readBoard({
      rows: [
        {
          kind: "ask",
          options: [],
          ownerWait: "owner",
          prUrls: [],
          question: "which option?",
          questionAskedIso: "2026-11-03T08:00:00.000Z",
          reason: "declared ready",
          repo: "/Users/x/dev/personal/slopweaver",
          section: "WAITING ON OWNER",
          slug: "abc-1-card",
          status: "ready",
          ...fields,
        },
      ],
      unresolved: 0,
    })!,
  };
  const [card] = rowsOf({
    acts: QUIET,
    board,
    drafts: QUIET,
    hands: QUIET,
    imports: QUIET,
    landing: QUIET,
    placer: ACME_PLACER,
    posts: QUIET,
    reviewers: QUIET,
    reviews: QUIET,
    standing: QUIET,
  });
  return card;
}

describe("the misplacements — each card drawn once, in the workspace its own row decides", () => {
  it("draws a card stating the team's workspace, with no address, on the team view only and wearing the team's glyph", () => {
    const card = cardOf({ fields: { workspace: "team" } });
    expect(card.placement).toEqual({
      by: [{ source: "stated", value: "team", workspace: "team" }],
      kind: "placed",
      workspace: "team",
    });
    expect({
      slopweaver: shownInContext({ context: "slopweaver", placement: card.placement }),
      work: shownInContext({ context: "work", placement: card.placement }),
    }).toEqual({ slopweaver: false, work: true });
    expect(card.provenance).toBe("team");
    expect(findingLabel({ placement: card.placement })).toBeUndefined();
  });

  it("draws a card stating nothing on the Slopweaver view only, by the one default rule, marked as placed by default", () => {
    const card = cardOf({ fields: {} });
    expect(card.placement).toEqual({
      kind: "unplaced",
      why: "it states no workspace:, declares no context=, names no pull request and sends to no Slack destination",
    });
    expect({
      slopweaver: shownInContext({ context: "slopweaver", placement: card.placement }),
      work: shownInContext({ context: "work", placement: card.placement }),
    }).toEqual({ slopweaver: true, work: false });
    expect(card.provenance).toBe("self");
    expect(findingLabel({ placement: card.placement })).toEqual({
      label: "placed by default: no workspace",
      title:
        "placed in self by default: no field names a workspace: it states no workspace:, declares no context=, names no pull request and sends to no Slack destination",
    });
    expect(contextToOpen({ context: "work", placement: card.placement })).toBe("slopweaver");
  });

  it("draws a card whose own fields name both workspaces on the Slopweaver view only, its glyph agreeing", () => {
    const card = cardOf({
      fields: {
        tags: [{ key: "context", source: "declared", value: "work" }],
        tagsIncomplete: false,
        workspace: "self",
      },
    });
    expect(card.placement.kind).toBe("conflict");
    expect({
      slopweaver: shownInContext({ context: "slopweaver", placement: card.placement }),
      work: shownInContext({ context: "work", placement: card.placement }),
    }).toEqual({ slopweaver: true, work: false });
    expect(card.provenance).toBe("self");
  });
});

describe("a stopping card, the one row drawn outside its own workspace", () => {
  const shows =
    ({ context }: { context: "slopweaver" | "work" }) =>
    (row: { readonly placement: ReturnType<typeof rowsOf>[number]["placement"] }): boolean =>
      shownInContext({ context, placement: row.placement });

  it("names its own workspace on the view that draws it only because it stops your work, and nothing on its own", () => {
    const card = { ...cardOf({ fields: {} }), stopping: { reason: "marked" } as const };
    expect({
      slopweaver: shownOnQueue({ row: card, shows: shows({ context: "slopweaver" }) }),
      work: shownOnQueue({ row: card, shows: shows({ context: "work" }) }),
    }).toEqual({ slopweaver: true, work: true });
    expect({
      slopweaver: stoppingElsewhere({ row: card, shows: shows({ context: "slopweaver" }) }),
      work: stoppingElsewhere({ row: card, shows: shows({ context: "work" }) }),
    }).toEqual({ slopweaver: undefined, work: "self" });
    expect(card.provenance).toBe("self");
    expect(contextToOpen({ context: "work", placement: card.placement })).toBe("slopweaver");
  });

  it("names the team's workspace for a team card drawn on the Slopweaver view", () => {
    const card = {
      ...cardOf({ fields: { workspace: "team" } }),
      stopping: { priorityRank: 1, reason: "blocks" } as const,
    };
    expect(stoppingElsewhere({ row: card, shows: shows({ context: "slopweaver" }) })).toBe("team");
    expect(stoppingElsewhere({ row: card, shows: shows({ context: "work" }) })).toBeUndefined();
  });

  it("is spoken by the voice as the other workspace's card in the view it is not its own, and plainly in its own", () => {
    const card = { ...cardOf({ fields: { workspace: "team" } }), stopping: { reason: "marked" } as const };
    expect(spokenOf({ row: card, shows: shows({ context: "slopweaver" }) }).workspaceMark).toBe(
      "the team workspace's card · in this view only because it stops the owner's work",
    );
    expect(spokenOf({ row: card, shows: shows({ context: "work" }) }).workspaceMark).toBeUndefined();
  });

  it("is read on the page by the voice the same way, drawn and open, and leads an unplaced card's own mark", () => {
    const team = { ...cardOf({ fields: { workspace: "team" } }), stopping: { reason: "marked" } as const };
    const reading = queueForVoice({
      drawn: [team],
      folded: [],
      open: team,
      shows: shows({ context: "slopweaver" }),
      unread: [],
      withheld: 0,
    });
    const own = { label: "the team workspace's card", title: "in this view only because it stops the owner's work" };
    expect(reading.drawn.map((row) => row.mark)).toEqual([own]);
    expect(reading.open!.mark).toEqual(own);
    const unplaced = { ...cardOf({ fields: {} }), stopping: { reason: "marked" } as const };
    expect(markInView({ row: unplaced, shows: shows({ context: "work" }) })!.label).toBe(
      "the self workspace's card · placed by default: no workspace",
    );
  });

  it("is read by the voice's read_card and open_card as the other workspace's card off the view its address names", () => {
    const team = { ...cardOf({ fields: { workspace: "team" } }), stopping: { reason: "marked" } as const };
    const planOn = ({ fromPath }: { fromPath: string }): unknown =>
      cardToolPlan({ alignment: NO_ALIGNMENT_CARDS, fromPath, key: team.key, recentlyLeft: [], rows: [team] })!.card;
    expect((planOn({ fromPath: "/queue?context=slopweaver" }) as { mark: unknown }).mark).toEqual({
      label: "the team workspace's card",
      title: "in this view only because it stops the owner's work",
    });
    expect((planOn({ fromPath: "/queue?context=work" }) as { mark: unknown }).mark).toBeUndefined();
  });

  it("reads a plain team card the voice reaches by key from the Slopweaver view as the team's, never as two views", () => {
    const team = cardOf({ fields: { workspace: "team" } });
    const planOn = ({ fromPath }: { fromPath: string }): unknown =>
      cardToolPlan({ alignment: NO_ALIGNMENT_CARDS, fromPath, key: team.key, recentlyLeft: [], rows: [team] })!.card;
    expect((planOn({ fromPath: "/queue?context=slopweaver" }) as { mark: unknown }).mark).toEqual({
      label: "the team workspace's card",
      title: "drawn only in that workspace's view, not this one",
    });
    expect((planOn({ fromPath: "/queue?context=work" }) as { mark: unknown }).mark).toBeUndefined();
  });

  it("says marked rows sit past the voice's cap when the hidden ones are only stopping cards from the other workspace", () => {
    const team = { ...cardOf({ fields: { workspace: "team" } }), stopping: { reason: "marked" } as const };
    const drawn = Array.from({ length: QUEUE_VOICE_ROWS + 1 }, (_, index) => ({ ...team, key: `ask:abc-${index}` }));
    const reading = ({ context }: { context: "slopweaver" | "work" }): boolean | undefined =>
      queueForVoice({ drawn, folded: [], open: undefined, shows: shows({ context }), unread: [], withheld: 0 })
        .drawnMarked;
    expect({ slopweaver: reading({ context: "slopweaver" }), work: reading({ context: "work" }) }).toEqual({
      slopweaver: true,
      work: false,
    });
    expect(markedInView({ rows: drawn, shows: shows({ context: "slopweaver" }) })).toBe(QUEUE_VOICE_ROWS + 1);
  });

  it("names nothing for a card that does not stop the owner's work, which the other view never draws", () => {
    const card = cardOf({ fields: { workspace: "team" } });
    expect(shownOnQueue({ row: card, shows: shows({ context: "slopweaver" }) })).toBe(false);
    expect(stoppingElsewhere({ row: card, shows: shows({ context: "slopweaver" }) })).toBeUndefined();
  });
});

describe("a hand step its own context places in the team's workspace", () => {
  it("wears the team's glyph on the team view, never Slopweaver's", () => {
    const hands = readHandSteps([
      {
        context: "work",
        id: "sign-the-acme-release",
        postedBy: "workspace:12",
        postedIso: "2026-11-03T08:00:00.000Z",
        unblocks: "the acme release",
        what: "Sign the acme release",
        witness: 'slopweaver hand done sign-the-acme-release --did "signed"',
      },
    ])!;
    const [row] = rowsOf({
      acts: QUIET,
      board: { ...READY, value: readBoard({ rows: [], unresolved: 0 })! },
      drafts: QUIET,
      hands: { ...READY, value: hands },
      imports: QUIET,
      landing: QUIET,
      placer: ACME_PLACER,
      posts: QUIET,
      reviewers: QUIET,
      reviews: QUIET,
      standing: QUIET,
    });
    expect(row.placement.kind).toBe("placed");
    expect(shownInContext({ context: "work", placement: row.placement })).toBe(true);
    expect(row.provenance).toBe("team");
  });
});

describe("a check-in that names no workspace", () => {
  it("is drawn in self by the default rule under its mark and counted as a check-in, never on the badge's waiting figure", () => {
    const hands = readHandSteps([
      {
        checkIn: true,
        id: "read-the-plan",
        postedBy: "workspace:12",
        postedIso: "2026-11-03T08:00:00.000Z",
        unblocks: "the plan pick",
        what: "Read the plan",
        witness: 'slopweaver hand done read-the-plan --did "read it"',
      },
    ])!;
    const rows = rowsOf({
      acts: QUIET,
      board: { ...READY, value: readBoard({ rows: [], unresolved: 0 })! },
      drafts: QUIET,
      hands: { ...READY, value: hands },
      imports: QUIET,
      landing: QUIET,
      placer: ACME_PLACER,
      posts: QUIET,
      reviewers: QUIET,
      reviews: QUIET,
      standing: QUIET,
    });
    expect(rows.length).toBe(1);
    const [row] = rows;
    expect(row.tier).toBe("check-in");
    expect(row.placement.kind).toBe("unplaced");
    expect(findingLabel({ placement: row.placement })!.label).toBe("placed by default: no workspace");
    expect(shownInContext({ context: "work", placement: row.placement })).toBe(false);
    expect(shownInContext({ context: "slopweaver", placement: row.placement })).toBe(true);
    // The badge prints `waiting`, which leaves out every check-in whatever its placement; the Queue's check-ins
    // chip prints `toReview`, which counts this one.
    expect(queueCounts({ rows })).toEqual({ toReview: 1, waiting: 0 });
  });
});
