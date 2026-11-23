/**
 * `retiredSweepCards`: which of the board sweep's own daily cards a `--queue` pass takes off the owner's Queue. The
 * measured shape: two earlier days' cards stayed live a day after the sweep read SHIPPED 0 UNCARDED 0.
 */
import { describe, expect, it } from "vitest";

import { retiredSweepCards } from "../../../sweep/cardRetirement.js";
import type { SweepCandidate } from "../../../sweep/classify.js";
import { sweepQueuePlan } from "../../../sweep/dailyQueue.js";

const HOME = "/h/home";
const NOW = "2026-01-11T07:00:00.000Z";

function candidate({ slug, verdict = "KEEP" }: { slug: string; verdict?: SweepCandidate["verdict"] }): SweepCandidate {
  return { act: "none", path: `/h/${slug}.md`, slug, verdict, witness: "nothing condemns it" };
}

const UNCARDED: SweepCandidate = {
  act: "none",
  path: "/h/plan-usage-strategy.md",
  slug: "plan-usage-strategy",
  verdict: "UNCARDED",
  witness:
    "settled answered with witness page:acme-plan-page-17-nov; page:acme-plan-page-17-nov never reached the owner's Queue",
};

describe("retiredSweepCards", () => {
  it("retires every own card up to today, oldest first, on a pass with nothing left for the owner", () => {
    const candidates = [
      candidate({ slug: "sweep-board-2026-01-10" }),
      candidate({ slug: "unrelated-row" }),
      candidate({ slug: "sweep-board-2026-01-11" }),
      candidate({ slug: "sweep-board-2026-01-09" }),
      candidate({ slug: "shipped-row", verdict: "SHIPPED" }),
    ];
    const retired = retiredSweepCards({ candidates, nowIso: NOW, plan: undefined });
    expect(retired.map((entry) => entry.candidate.slug)).toEqual([
      "sweep-board-2026-01-09",
      "sweep-board-2026-01-10",
      "sweep-board-2026-01-11",
    ]);
    expect(retired[0]!.witness).toBe(
      "sweep board at 2026-01-11T07:00:00.000Z reads UNCARDED 0 and SHIPPED 1 — no page is left for the owner to card, and a shipped row is closed by --close-shipped rather than carded",
    );
  });

  it("retires only earlier days' cards when today's card is the live reading", () => {
    const plan = sweepQueuePlan({ candidates: [UNCARDED], home: HOME, nowIso: NOW })!;
    const candidates = [
      candidate({ slug: "sweep-board-2026-01-10" }),
      candidate({ slug: "sweep-board-2026-01-11" }),
      UNCARDED,
    ];
    const retired = retiredSweepCards({ candidates, nowIso: NOW, plan });
    expect(retired.map((entry) => [entry.candidate.slug, entry.witness])).toEqual([
      [
        "sweep-board-2026-01-10",
        "sweep-board-2026-01-11 is the live board-sweep card as of 2026-01-11T07:00:00.000Z, so this earlier day's card is no longer the reading",
      ],
    ]);
  });

  it("never retires a card dated after the pass, a look-alike slug, or a closed row", () => {
    const candidates = [
      candidate({ slug: "sweep-board-2026-01-12" }),
      candidate({ slug: "sweep-board-daily" }),
      candidate({ slug: "sweep-board-2026-01-09-retry" }),
      candidate({ slug: "sweep-board-2026-01-08", verdict: "UNCARDED" }),
    ];
    expect(retiredSweepCards({ candidates, nowIso: NOW, plan: undefined })).toEqual([]);
  });

  it("retires nothing on an empty board", () => {
    expect(retiredSweepCards({ candidates: [], nowIso: NOW, plan: undefined })).toEqual([]);
  });
});
