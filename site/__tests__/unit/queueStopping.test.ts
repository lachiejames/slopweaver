/*
 * Which Queue cards stop the owner's work, and how they lead: a
 * stopped automation, or any blocker on one of the owner's two priorities, is the first card on the Queue every day it stands,
 * its decision and options above the fold, never buried under the rest.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { readBoard, readHandSteps } from "../../components/live/read";
import type { LiveState } from "../../components/live/useLive";
import { deferredLast } from "../../lib/cardDeferrals";
import type { BriefingCard, QueueCard, StepCard } from "../../lib/queueCard";
import type { QueueFocus } from "../../lib/queueFocus";
import { type QueueRow, rowsOf } from "../../lib/queueRows";
import {
  type StoppingBoardFact,
  type StoppingCandidate,
  stoppingFold,
  stoppingKeys,
  withStopping,
} from "../../lib/queueStopping";
import { ACME_PLACER } from "../organisationFixture";
import { queueLayout } from "./inItsOwnView";

const FIXTURE = fileURLToPath(new URL("../../fixtures/hand-steps/recipe-stopped.json", import.meta.url));
const LOADING = { phase: "loading" } as const;

const ISO_FOCUS: QueueFocus = {
  anchor: "talk-call:a0000024#turn_EXx",
  because: "the owner's ISO week",
  id: "iso",
  name: "ISO controls",
  queueWorkstream: "iso-certification",
};

/**
 * A reading, arrived.
 *
 * @returns the ready state
 */
function ready<T>({ value }: { value: T }): LiveState<T> {
  return {
    fixture: undefined,
    observedAtIso: "2026-10-19T10:00:00.000Z",
    phase: "ready",
    stampedByRoute: false,
    value,
  };
}

/**
 * One board row as `handover list --json` publishes it, waiting on the owner unless said otherwise.
 *
 * @returns the published row
 */
function boardRow({
  slug,
  section = "WAITING ON OWNER",
  ownerWait = "owner",
  blockedBy,
  workstream,
}: {
  slug: string;
  section?: string;
  ownerWait?: string;
  blockedBy?: readonly string[];
  workstream?: string;
}): Record<string, unknown> {
  return {
    anchor: "transcript:a0000036#116b8349",
    kind: "ask",
    ownerWait,
    priority: "p1",
    question: `Which way on ${slug}?`,
    questionAskedIso: "2026-10-18T08:00:00.000Z",
    reason: "waiting on the owner",
    repo: "/Users/someone/dev/personal/slopweaver",
    section,
    slug,
    status: "waiting-on-owner",
    workspace: "team",
    ...(blockedBy === undefined ? {} : { blockedBy }),
    ...(workstream === undefined ? {} : { tags: [{ key: "workstream", source: "declared", value: workstream }] }),
  };
}

/**
 * The Queue's rows over a board of asks and, when asked for, the recipe-stopped monitor's own marked step.
 *
 * @returns the board reading and the rows built from it
 */
function queueOf({ rows, withStep = false }: { rows: readonly Record<string, unknown>[]; withStep?: boolean }): {
  board: LiveState<NonNullable<ReturnType<typeof readBoard>>>;
  every: readonly QueueRow[];
} {
  const board = ready({ value: readBoard({ rows, unresolved: 0 })! });
  const steps = withStep ? [JSON.parse(readFileSync(FIXTURE, "utf8")) as unknown] : [];
  const every = rowsOf({
    acts: LOADING,
    board,
    drafts: LOADING,
    hands: ready({ value: readHandSteps(steps)! }),
    landing: LOADING,
    placer: ACME_PLACER,
    posts: LOADING,
    reviewers: LOADING,
    reviews: LOADING,
    imports: LOADING,
    standing: LOADING,
  });
  return { board, every };
}

/**
 * The keys a list stamps stopping.
 *
 * @returns the stamped keys, in list order
 */
function stamped({ rows }: { rows: readonly QueueRow[] }): readonly string[] {
  return rows.filter((row) => row.stopping !== undefined).map((row) => row.key);
}

const fact = (over: Partial<StoppingBoardFact> & { slug: string }): StoppingBoardFact => ({
  blockedBy: [],
  open: true,
  tagsWhole: true,
  waitsOnOwner: true,
  workstreams: [],
  ...over,
});

const candidate = (over: Partial<StoppingCandidate> & { key: string }): StoppingCandidate => ({
  checkIn: false,
  kind: "ask",
  rowSlug: undefined,
  stopsWork: false,
  ...over,
});

describe("stoppingKeys", () => {
  const FOCUS = ["iso-certification"];
  const board = [
    fact({
      blockedBy: ["the-blocker", "a-closed-one", "not-on-owner"],
      slug: "iso-policy",
      workstreams: ["iso-certification"],
    }),
    fact({ slug: "the-blocker" }),
    fact({ open: false, slug: "a-closed-one" }),
    fact({ slug: "not-on-owner", waitsOnOwner: false }),
    fact({ blockedBy: ["blocks-other"], slug: "other-work", workstreams: ["previews"] }),
    fact({ slug: "blocks-other" }),
  ];

  it("stamps a marked hand step and an ask blocking a focus row, nothing else", () => {
    const keys = stoppingKeys({
      board,
      candidates: [
        candidate({ key: "hand:mon-held", kind: "hand", stopsWork: true }),
        candidate({ key: "ask:the-blocker", rowSlug: "the-blocker" }),
        candidate({ key: "hand:for-blocker", kind: "hand", rowSlug: "the-blocker" }),
        candidate({ key: "ask:a-closed-one", rowSlug: "a-closed-one" }),
        candidate({ key: "ask:not-on-owner", rowSlug: "not-on-owner" }),
        candidate({ key: "ask:blocks-other", rowSlug: "blocks-other" }),
        candidate({ key: "ask:iso-policy", rowSlug: "iso-policy" }),
        candidate({ key: "post:x", kind: "other", rowSlug: "the-blocker" }),
      ],
      focusWorkstreams: FOCUS,
    });
    expect([...keys]).toEqual([
      ["hand:mon-held", { reason: "marked" }],
      ["ask:the-blocker", { priorityRank: 0, reason: "blocks" }],
      ["hand:for-blocker", { priorityRank: 0, reason: "blocks" }],
    ]);
  });

  it("stamps a blocker with the highest of the owner's priorities it blocks (P0)", () => {
    const twoPriorities = [
      fact({ blockedBy: ["shared", "vanta-only"], slug: "vanta-card", workstreams: ["iso-certification"] }),
      fact({ blockedBy: ["shared"], slug: "nag-proposal", workstreams: ["onboarding-flow"] }),
      fact({ slug: "shared" }),
      fact({ slug: "vanta-only" }),
    ];
    const keys = stoppingKeys({
      board: twoPriorities,
      candidates: [
        candidate({ key: "ask:vanta-only", rowSlug: "vanta-only" }),
        candidate({ key: "ask:shared", rowSlug: "shared" }),
      ],
      focusWorkstreams: ["onboarding-flow", "iso-certification"],
    });
    expect([...keys]).toEqual([
      ["ask:vanta-only", { priorityRank: 1, reason: "blocks" }],
      ["ask:shared", { priorityRank: 0, reason: "blocks" }],
    ]);
  });

  it("never stamps a check-in, marked or blocking", () => {
    const keys = stoppingKeys({
      board,
      candidates: [
        candidate({ checkIn: true, key: "hand:mon-held", kind: "hand", stopsWork: true }),
        candidate({ checkIn: true, key: "ask:the-blocker", rowSlug: "the-blocker" }),
      ],
      focusWorkstreams: FOCUS,
    });
    expect([...keys]).toEqual([]);
  });

  it("follows no blocker of a closed focus row, a part-read one, or one with no focus at all", () => {
    const blocker = [candidate({ key: "ask:the-blocker", rowSlug: "the-blocker" })];
    const closed = [fact({ blockedBy: ["the-blocker"], open: false, slug: "iso", workstreams: ["iso-certification"] })];
    const partial = [
      fact({ blockedBy: ["the-blocker"], slug: "iso", tagsWhole: false, workstreams: ["iso-certification"] }),
    ];
    const own = fact({ slug: "the-blocker" });
    expect([
      stoppingKeys({ board: [...closed, own], candidates: blocker, focusWorkstreams: FOCUS }).size,
      stoppingKeys({ board: [...partial, own], candidates: blocker, focusWorkstreams: FOCUS }).size,
      stoppingKeys({ board, candidates: blocker, focusWorkstreams: [] }).size,
    ]).toEqual([0, 0, 0]);
  });

  it("is direct only: a blocker of a blocker is not followed", () => {
    const chain = [
      fact({ blockedBy: ["first"], slug: "iso", workstreams: ["iso-certification"] }),
      fact({ blockedBy: ["second"], slug: "first" }),
      fact({ slug: "second" }),
    ];
    const keys = stoppingKeys({
      board: chain,
      candidates: [
        candidate({ key: "ask:first", rowSlug: "first" }),
        candidate({ key: "ask:second", rowSlug: "second" }),
      ],
      focusWorkstreams: FOCUS,
    });
    expect([...keys.keys()]).toEqual(["ask:first"]);
  });

  it("stamps a blocker whose open row shares its slug with a later DONE one", () => {
    const keys = stoppingKeys({
      board: [...board, fact({ open: false, slug: "the-blocker" })],
      candidates: [candidate({ key: "ask:the-blocker", rowSlug: "the-blocker" })],
      focusWorkstreams: FOCUS,
    });
    expect([...keys.keys()]).toEqual(["ask:the-blocker"]);
  });
});

describe("withStopping over the Queue's real rows", () => {
  const BOARD = [
    boardRow({ blockedBy: ["iso-blocker"], slug: "iso-policy", workstream: "iso-certification" }),
    boardRow({ slug: "iso-blocker" }),
    boardRow({ slug: "a-colleague-waits" }),
  ];

  it("stamps the recipe-stopped monitor's marked step, read off the register as `hand list --json` prints it", () => {
    const { board, every } = queueOf({ rows: [], withStep: true });
    const keys = stamped({ rows: withStopping({ board, focuses: [], rows: every }) });
    expect(keys).toHaveLength(1);
    expect(keys[0].startsWith("hand:mon-recipe-vulnfix-digest-acme")).toBe(true);
  });

  it("stamps an ask a focus row names in its blockedBy, and only while that workstream is the owner's focus", () => {
    const { board, every } = queueOf({ rows: BOARD });
    expect(stamped({ rows: withStopping({ board, focuses: [ISO_FOCUS], rows: every }) })).toEqual(["ask:iso-blocker"]);
    expect(stamped({ rows: withStopping({ board, focuses: [], rows: every }) })).toEqual([]);
  });

  it("reads a LOOKS SHIPPED focus row as open, as the workstream band does, and a DONE one as closed", () => {
    const shipped = queueOf({
      rows: [
        boardRow({
          blockedBy: ["iso-blocker"],
          section: "LOOKS SHIPPED",
          slug: "iso-policy",
          workstream: "iso-certification",
        }),
        boardRow({ slug: "iso-blocker" }),
      ],
    });
    const done = queueOf({
      rows: [
        boardRow({ blockedBy: ["iso-blocker"], section: "DONE", slug: "iso-policy", workstream: "iso-certification" }),
        boardRow({ slug: "iso-blocker" }),
      ],
    });
    expect([
      stamped({ rows: withStopping({ board: shipped.board, focuses: [ISO_FOCUS], rows: shipped.every }) }),
      stamped({ rows: withStopping({ board: done.board, focuses: [ISO_FOCUS], rows: done.every }) }),
    ]).toEqual([["ask:iso-blocker"], []]);
  });

  it("stamps no blocker until the board reads, and hands the same list back when nothing stops", () => {
    const { every } = queueOf({ rows: BOARD });
    expect(withStopping({ board: LOADING, focuses: [ISO_FOCUS], rows: every })).toBe(every);
  });

  it("leads the page's layout with the blocker, a deferred one included, and draws a stopped automation after the owner's priorities", () => {
    const { board, every } = queueOf({ rows: BOARD, withStep: true });
    const deferred = every.map((row) =>
      row.key === "ask:iso-blocker" ? { ...row, deferredIso: "2026-10-19T09:00:00.000Z" } : row,
    );
    const rows = withStopping({ board, focuses: [ISO_FOCUS], rows: deferred });
    const drawn = queueLayout({ expanded: [], focuses: [ISO_FOCUS], rows }).flatMap((entry) =>
      "key" in entry ? [entry.key] : [],
    );
    expect(drawn.map((key) => key.split("-")[0])).toEqual(["ask:iso", "ask:iso", "hand:mon", "ask:a"]);
    expect([drawn[0], drawn[1], drawn[3]]).toEqual(["ask:iso-blocker", "ask:iso-policy", "ask:a-colleague-waits"]);
  });
});

describe("deferredLast and a stopping card", () => {
  it("keeps a stopping card the owner put off in front of the deferred ones", () => {
    const rows = [
      { deferredIso: "2026-10-18T00:00:00.000Z", key: "a" },
      { deferredIso: "2026-10-17T00:00:00.000Z", key: "b", stopping: { reason: "marked" as const } },
      { key: "c" },
    ];
    const { now, deferred } = deferredLast({ rows });
    expect([now.map((row) => row.key), deferred.map((row) => row.key)]).toEqual([["b", "c"], ["a"]]);
  });
});

describe("stoppingFold", () => {
  const OPTIONS = [
    { letter: "A", sentence: "Lift your hold and switch it back on", tradeoff: "It runs from its next slot" },
    { letter: "B", sentence: "Keep it stopped", tradeoff: "Nothing it does happens meanwhile" },
  ];

  it("draws a step's decision as its own problem, letters and sentences, and lean", () => {
    const card = {
      decision: {
        lean: "Keep it stopped.",
        options: OPTIONS,
        problem: "It has stopped.",
        stakes: undefined,
        summary: undefined,
      },
      kind: "step",
    } as unknown as StepCard;
    expect(stoppingFold({ card })).toEqual({
      lean: "Keep it stopped.",
      options: [
        { letter: "A", sentence: "Lift your hold and switch it back on" },
        { letter: "B", sentence: "Keep it stopped" },
      ],
      problem: "It has stopped.",
    });
  });

  it("draws an ask's problem and options, its lean absent when it records none", () => {
    const card = {
      kind: "briefing",
      lean: undefined,
      options: OPTIONS,
      problem: "ISO is blocked.",
    } as unknown as BriefingCard;
    expect(stoppingFold({ card })).toEqual({
      lean: undefined,
      options: [
        { letter: "A", sentence: "Lift your hold and switch it back on" },
        { letter: "B", sentence: "Keep it stopped" },
      ],
      problem: "ISO is blocked.",
    });
  });

  it("draws nothing on a card recording no problem or no option", () => {
    const cards: readonly QueueCard[] = [
      { decision: undefined, kind: "step" } as unknown as StepCard,
      { kind: "briefing", options: OPTIONS, problem: undefined } as unknown as BriefingCard,
      { kind: "briefing", options: [], problem: "ISO is blocked." } as unknown as BriefingCard,
    ];
    expect(cards.map((card) => stoppingFold({ card }))).toEqual([undefined, undefined, undefined]);
  });
});
