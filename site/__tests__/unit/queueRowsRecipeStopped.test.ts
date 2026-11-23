/*
 * A recipe that stops firing lands at the VERY TOP of the console queue: when any recipe
 * stops firing, the row sits at the very top of the queue, structurally impossible to miss.
 *
 * "Structurally" is the point, so the step ranked here is the one the `recipe-stopped` monitor's own card
 * (`src/monitor/card.ts`) and the hand register build — pinned as `site/fixtures/hand-steps/recipe-stopped.json`, which
 * `src/__tests__/unit/monitor/recipeStoppedStepFixture.test.ts` rebuilds from the real modules byte for byte
 * (the site's build cannot compile those modules itself). It is read by the console's reader as
 * `hand list --json` prints it, and ranked by the real `rowsOf`. The monitor declares the `work` context,
 * which makes the step team-blocked; hand rows are projected before asks, and the ranking is stable within a
 * tier — so it sits above every ask, a colleague-facing one included.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { readBoard, readHandSteps } from "../../components/live/read";
import type { LiveState } from "../../components/live/useLive";
import type { StepCard } from "../../lib/queueCard";
import { type QueueRow, rowsOf } from "../../lib/queueRows";
import { ACME_PLACER } from "../organisationFixture";

const FIXTURE = fileURLToPath(new URL("../../fixtures/hand-steps/recipe-stopped.json", import.meta.url));
const LOADING = { phase: "loading" } as const;

function ready<T>({ value }: { value: T }): LiveState<T> {
  return {
    fixture: undefined,
    observedAtIso: "2026-09-26T10:00:00.000Z",
    phase: "ready",
    stampedByRoute: false,
    value,
  };
}

/** One ask waiting on the owner's word, as `handover list --json` publishes it. */
function ask({ slug, workspace, asked }: { slug: string; workspace: string; asked: string }): Record<string, unknown> {
  return {
    anchor: "transcript:a0000036#116b8349",
    kind: "ask",
    ownerWait: "owner",
    priority: "p1",
    question: `Which way on ${slug}?`,
    questionAskedIso: asked,
    reason: "waiting on the owner",
    repo: "/Users/someone/dev/personal/slopweaver",
    section: "runnable",
    slug,
    status: "waiting-on-owner",
    workspace,
  };
}

function rows(): readonly QueueRow[] {
  const board = readBoard({
    rows: [
      // Both asked long BEFORE the step, so neither age nor register order can be what puts the step first. A
      // colleague waits on an address they are on — a stated workspace alone names nobody (`askTeamFacing`).
      {
        ...ask({ asked: "2026-09-20T08:00:00.000Z", slug: "a-colleague-waits", workspace: "team" }),
        prUrls: ["https://github.com/acme/acme-admin/pull/16672"],
      },
      ask({ asked: "2026-09-20T07:00:00.000Z", slug: "the-fleet-waits", workspace: "self" }),
    ],
    unresolved: 0,
  });
  return rowsOf({
    reviewers: LOADING,
    standing: LOADING,
    acts: LOADING,
    board: ready({ value: board! }),
    drafts: LOADING,
    hands: ready({ value: readHandSteps([JSON.parse(readFileSync(FIXTURE, "utf8")) as unknown])! }),
    landing: LOADING,
    placer: ACME_PLACER,
    posts: LOADING,
    reviews: LOADING,
    imports: LOADING,
  });
}

describe("a recipe-stopped hand step on the console queue", () => {
  it("is the first row, above a colleague-facing ask and a fleet-facing one", () => {
    const keys = rows().map((row) => row.key);
    expect(keys[0].startsWith("hand:mon-recipe-vulnfix-digest-acme")).toBe(true);
    expect(keys.slice(1)).toEqual(["ask:a-colleague-waits", "ask:the-fleet-waits"]);
  });

  it("ranks team-blocked because the monitor DECLARED the work context, not because of its words", () => {
    const [top] = rows();
    expect(top.placement).toEqual({
      by: [{ source: "stated", value: "team", workspace: "team" }],
      kind: "placed",
      workspace: "team",
    });
    expect(top.tier).toBe("team-blocked");
  });
});

describe("the card a recipe-stopped step draws", () => {
  it("offers the owner no choice — a stopped job is a seat's to repair, never the owner's to decide", () => {
    const [top] = rows();
    expect(top.card.kind).toBe("step");
    const card = top.card as StepCard;

    const record = top.record as Extract<QueueRow["record"], { kind: "hand" }>;
    expect([card.decision, record.step.what]).toEqual([
      undefined,
      "Seat a repair for vulnfix-digest-acme-admin — it stopped firing and no seat has it",
    ]);
  });

  it("is drawn, because every line of it is text the step itself recorded", () => {
    const [top] = rows();
    expect(top.record.kind).toBe("hand");

    expect((top.record as Extract<QueueRow["record"], { kind: "hand" }>).form).toEqual({ kind: "drawn" });
  });

  it("answers to its own key alone and stays a floating hand note — no ask is absorbed, because there is none", () => {
    const [top] = rows();

    expect(top.aliases).toEqual([]);
    expect(top.kind).toBe("hand");
    expect(top.pill).toBe("integration=none");
  });
});

/** A decision a work step may carry on its own record — the shape a monitor's card could hold before ruling A. */
const CARRIED = {
  lean: "B — the cause is still unread.",
  options: [
    { letter: "A", option: "Do it now", tradeoff: "the output comes back first, and may stop again" },
    { letter: "B", option: "Fix the cause first", tradeoff: "the output stays absent while it is investigated" },
  ],
  problem: "The step is undecided and its record carries the choice.",
  stakes: {
    blastRadius: "one work row",
    risk: "It stays undecided.",
    stillReal: "This pass read it undecided.",
  },
};

/** The fixture step carrying {@link CARRIED}, at `url` when one is given. */
function carrying({ url }: { url?: string } = {}): Record<string, unknown> {
  const step = { ...(JSON.parse(readFileSync(FIXTURE, "utf8")) as Record<string, unknown>), decision: CARRIED };
  if (url === undefined) {
    return step;
  }
  return { ...step, url };
}

describe("a carried decision beside a link to another record", () => {
  it("is not drawn in place of an ask the board could not shape", () => {
    const step = carrying({ url: "http://localhost:3000/queue?open=ask%3Asame" });
    const board = readBoard({
      rows: [{ ...ask({ asked: "2026-09-20T08:00:00.000Z", slug: "same", workspace: "self" }) }],
      unresolved: 0,
    });
    const [top] = rowsOf({
      reviewers: LOADING,
      standing: LOADING,
      acts: LOADING,
      board: ready({ value: board! }),
      drafts: LOADING,
      hands: ready({ value: readHandSteps([step])! }),
      landing: LOADING,
      placer: ACME_PLACER,
      posts: LOADING,
      reviews: LOADING,
      imports: LOADING,
    });
    expect(top.key.startsWith("hand:")).toBe(true);
    expect(top.card.kind).toBe("step");

    expect((top.card as StepCard).decision).toBeUndefined();
  });

  it("is not drawn when its recorded problem is only blanks, so no empty PROBLEM row appears", () => {
    const recorded = carrying();
    const decision = { ...CARRIED, problem: "   " };
    const [top] = rowsOf({
      reviewers: LOADING,
      standing: LOADING,
      acts: LOADING,
      board: LOADING,
      drafts: LOADING,
      hands: ready({ value: readHandSteps([{ ...recorded, decision }])! }),
      landing: LOADING,
      placer: ACME_PLACER,
      posts: LOADING,
      reviews: LOADING,
      imports: LOADING,
    });
    expect(top.card.kind).toBe("step");
    expect((top.card as StepCard).decision).toBeUndefined();
  });
});

describe("a carried decision beside the step's own link minted on a configured console base", () => {
  it.each([
    "https://console.example.org/queue?open=hand%3Amon-recipe-vulnfix-digest-acme-a83c092f95d0bace&context=work",
    "https://host.example/console/queue?open=hand%3Amon-recipe-vulnfix-digest-acme-a83c092f95d0bace&context=work",
  ])("is drawn on the console for %s, as the posting gate admitted it", (url) => {
    const step = carrying({ url });
    const [top] = rowsOf({
      reviewers: LOADING,
      standing: LOADING,
      acts: LOADING,
      board: ready({ value: readBoard({ rows: [], unresolved: 0 })! }),
      drafts: LOADING,
      hands: ready({ value: readHandSteps([step])! }),
      landing: LOADING,
      placer: ACME_PLACER,
      posts: LOADING,
      reviews: LOADING,
      imports: LOADING,
    });

    expect((top.card as StepCard).decision!.problem).toBe(CARRIED.problem);
  });
});
