/*
 * Every register's card resolves its numbers against the addresses its row carries, not only an ask's. A hand card
 * for an acme-admin pull request that linked one number of the several it named is the failure this holds down: the
 * dialog handed a hand step's sentences no address at all.
 */

import { describe, expect, it } from "vitest";

import { type HandStep, readHandSteps } from "../../components/live/read";
import type { LiveState } from "../../components/live/useLive";
import { cardAddresses } from "../../lib/cardAddresses";
import { inlineSegments } from "../../lib/inlineCitations";
import { type QueueRow, rowsOf } from "../../lib/queueRows";
import { ACME_PLACER } from "../organisationFixture";
import { stepOf } from "./cardKind";

const LOADING = { phase: "loading" } as const;

const PR = "https://github.com/acme/acme-admin/pull/17564";

/** The hand step the owner was looking at, as `hand list --json` recorded it. */
const STEP: HandStep = {
  checkIn: false,
  checklist: undefined,
  cites: [],
  context: undefined,
  decision: undefined,
  id: "look-at-17564-above-fold",
  ifIgnored: undefined,
  integration: undefined,
  keptReason: undefined,
  literal: undefined,
  postedBy: "workspace:12",
  postedIso: "2026-09-25T04:30:00.000Z",
  row: undefined,
  opened: undefined,
  rowProblem: undefined,
  secrets: [],
  shot: undefined,
  unaddressed: undefined,
  unblocks: "your read on the shape before it becomes the pull request body rule",
  url: undefined,
  what: "Open acme-admin 17564: every screenshot now sits above the fold in the Proof cell, nothing collapsed",
  where: PR,
  witness: "slopweaver github read #17564 shows six images outside any details block",
};

function handRow({ step }: { step: HandStep }): QueueRow {
  const hands: LiveState<readonly HandStep[]> = {
    fixture: undefined,
    observedAtIso: "2026-09-25T09:00:00.000Z",
    phase: "ready",
    stampedByRoute: false,
    value: [step],
  };
  const rows = rowsOf({
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
  expect(rows.length).toBe(1);
  return rows[0];
}

describe("cardAddresses", () => {
  it("carries a hand step's own place, so its heading's `acme-admin 17564` is the chip", () => {
    const row = handRow({ step: STEP });
    expect(cardAddresses({ row })).toEqual([PR]);
    expect(inlineSegments({ known: cardAddresses({ row }), text: row.card.question })).toEqual([
      { kind: "text", text: "Open " },
      { kind: "cite", label: "acme-admin 17564", url: PR },
      {
        kind: "text",
        text: ": every screenshot now sits above the fold in the Proof cell, nothing collapsed",
      },
    ]);
  });

  it("draws the hand card's where row — the bare address — as its number", () => {
    const row = handRow({ step: STEP });
    const where = stepOf({ card: row.card }).rows.find((one) => one.label === "where")!.value;
    expect(inlineSegments({ known: cardAddresses({ row }), text: where })).toEqual([
      { kind: "cite", label: "#17564", url: PR },
    ]);
  });

  it("carries an address one sentence spells out, deduplicated, so another sentence's bare number resolves", () => {
    const issue = "https://linear.app/acme/issue/EEEE-840";
    const row = handRow({ step: { ...STEP, what: `Review EEEE-840 (${issue}), then ${PR}.`, where: undefined } });
    expect(cardAddresses({ row })).toEqual([issue, PR]);
  });

  it("carries nothing for a step whose place is not an address and whose prose names none", () => {
    const row = handRow({
      step: { ...STEP, what: "Sign in to Vanta", where: "the Vanta console", witness: undefined },
    });
    expect(cardAddresses({ row })).toEqual([]);
  });

  it("chips every number a step cites when its note opens a console page — a post that names two pull requests", () => {
    const pr16676 = "https://github.com/acme/acme-admin/pull/16676";
    const pr16672 = "https://github.com/acme/acme-admin/pull/16672";
    // Read through the console's own reader, exactly as `hand list --json` publishes a step posted with --cites.
    const [step] = readHandSteps([
      {
        cites: [pr16676, pr16672],
        id: "steer-16676-post",
        postedIso: "2026-09-25T10:41:02.458Z",
        unblocks: "the team hearing the opt-in PR description verb exists",
        url: "http://localhost:3000/queue?open=ask%3Aacme-post-16676-description-form",
        what: "Post the acme-admin #16676 announcement to #dev-team now, or hold it until #16672 lands",
        where: "the queue page",
      },
    ])!;
    const row = handRow({ step });
    expect(cardAddresses({ row })).toEqual([pr16676, pr16672]);
    expect(inlineSegments({ known: cardAddresses({ row }), text: row.card.question })).toEqual([
      { kind: "text", text: "Post the " },
      { kind: "cite", label: "acme-admin #16676", url: pr16676 },
      { kind: "text", text: " announcement to #dev-team now, or hold it until " },
      { kind: "cite", label: "#16672", url: pr16672 },
      { kind: "text", text: " lands" },
    ]);
  });

  it("carries a step's url when it is itself the pull request, ahead of the addresses it cites", () => {
    const issue = "https://linear.app/acme/issue/EEEE-840";
    const row = handRow({ step: { ...STEP, cites: [issue], url: PR, where: "the Proof cell" } });
    expect(cardAddresses({ row })).toEqual([PR, issue]);
  });

  it("draws the step as unreadable, naming cites, when its cites is present and not a list of strings", () => {
    expect(
      readHandSteps([{ cites: "https://github.com/o/r/pull/1", id: "x", postedIso: "t", what: "w" }])![0].unreadable,
    ).toBe("cites");
  });
});
