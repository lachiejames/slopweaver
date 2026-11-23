/**
 * `host-week-runs-out`'s hold: a lapsed card holds nothing, and the looser holding bar keeps what an open card names
 * without ever adding a model host to it.
 */
import { describe, expect, it } from "vitest";

import type { HostDrySpell, HostWeekProjection } from "../../../capacity/weekRisk.js";
import { drySpellKeyRevision } from "../../../monitor/fleetRunsDry.js";
import { type PlanWeekProjections, planWeekKey } from "../../../monitor/hostWeekRunsOut.js";
import { heldPlanWeek, planWeekHeldRevisions } from "../../../monitor/hostWeekRunsOutHold.js";

const STEP_PREFIX = "mon-planweek-";

/** A spell for one model host over one plan, ending at a fixed instant. */
function spellOf({ host }: { host: "claude" | "codex" }): HostDrySpell {
  return {
    basis: `${host} basis`,
    endIso: "2026-11-09T18:00:00.000Z",
    endedById: `${host}:one`,
    host,
    hours: 6,
    identity: [`${host}:one@99`],
    planLines: [`${host} one`],
    startIso: "2026-11-09T12:00:00.000Z",
  };
}

const CLEAR: HostWeekProjection = { kind: "clear", why: "no spell" };
const CODEX_AT_RISK: HostWeekProjection = { kind: "at-risk", spell: spellOf({ host: "codex" }) };
const CLAUDE_AT_RISK: HostWeekProjection = { kind: "at-risk", spell: spellOf({ host: "claude" }) };

/** The revision a card over these spells carries. */
function revisionOf({ spells }: { spells: readonly HostDrySpell[] }): string {
  return drySpellKeyRevision({ key: planWeekKey({ spells }) })!;
}

describe("planWeekHeldRevisions", () => {
  it("returns an open card's revision until its key lapses, ignoring other monitors' steps", () => {
    const key = planWeekKey({ spells: [spellOf({ host: "codex" })] });
    const card = `${STEP_PREFIX}${key}`;
    const revision = revisionOf({ spells: [spellOf({ host: "codex" })] });
    expect([
      planWeekHeldRevisions({
        nowIso: "2026-11-09T17:59:00.000Z",
        openIds: [card, "mon-other-x"],
        stepPrefix: STEP_PREFIX,
      }),
      planWeekHeldRevisions({ nowIso: "2026-11-09T18:00:00.000Z", openIds: [card], stepPrefix: STEP_PREFIX }),
      planWeekHeldRevisions({ nowIso: "2026-11-09T17:59:00.000Z", openIds: [`${card}.2`], stepPrefix: STEP_PREFIX }),
      planWeekHeldRevisions({ nowIso: "2026-11-09T17:59:00.000Z", openIds: ["mon-other-x"], stepPrefix: STEP_PREFIX }),
    ]).toEqual([[revision], [], [revision], []]);
  });
});

describe("heldPlanWeek", () => {
  const codexCard = [revisionOf({ spells: [spellOf({ host: "codex" })] })];

  it("holds a card whose host is now at risk only at the holding bar", () => {
    const opening: PlanWeekProjections = { claude: CLEAR, codex: CLEAR };
    const holding: PlanWeekProjections = { claude: CLEAR, codex: CODEX_AT_RISK };
    expect(heldPlanWeek({ heldRevisions: codexCard, holding, opening })).toEqual(holding);
  });

  it("never adds a model host the opening bar left out, so the held card is not re-cut", () => {
    const opening: PlanWeekProjections = { claude: CLEAR, codex: CODEX_AT_RISK };
    const holding: PlanWeekProjections = { claude: CLAUDE_AT_RISK, codex: CODEX_AT_RISK };
    expect(heldPlanWeek({ heldRevisions: codexCard, holding, opening })).toEqual(opening);
  });

  it("holds a card naming both hosts whole when one has slipped to the holding bar", () => {
    const both = [revisionOf({ spells: [spellOf({ host: "claude" }), spellOf({ host: "codex" })] })];
    const opening: PlanWeekProjections = { claude: CLEAR, codex: CODEX_AT_RISK };
    const holding: PlanWeekProjections = { claude: CLAUDE_AT_RISK, codex: CODEX_AT_RISK };
    expect(heldPlanWeek({ heldRevisions: both, holding, opening })).toEqual(holding);
  });

  it("falls back to the opening bar when no held card matches", () => {
    const opening: PlanWeekProjections = { claude: CLEAR, codex: CLEAR };
    const holding: PlanWeekProjections = { claude: CLAUDE_AT_RISK, codex: CLEAR };
    expect(heldPlanWeek({ heldRevisions: codexCard, holding, opening })).toEqual(opening);
  });
});
