// The legacy steer-id case went out with the fold that read it.
import { describe, expect, it } from "vitest";

import type { SilentRow } from "../../../live/automation/silentRows.js";
import { evaluateRecipeStopped } from "../../../monitor/evaluateStopped.js";
import type { MonitorReading } from "../../../monitor/types.js";
import {
  episodeRowsOf,
  judgeStoppedRecipes,
  repairAsk,
  repairSlugBaseOf,
  repairSlugOf,
  stoppedSetOf,
} from "../../../supervisor/stoppedRecipeSeat.js";

const NONE: ReadonlyMap<string, string> = new Map();

function silentRow(over: Partial<SilentRow> = {}): SilentRow {
  return {
    cadence: "30 9 * * *",
    currentSlotHold: null,
    detail: "2 slot(s) went by unrun",
    lastRunAtIso: "2026-09-16T03:46:41.000Z",
    missedSlots: 2,
    reason: "MISSED",
    recipeId: "vulnfix-digest-acme-admin",
    ...over,
  };
}

/** The `monitor check --only recipe-stopped --json` document one reading prints as, round-tripped through JSON. */
function documentOf({ reading }: { reading: MonitorReading }): unknown {
  return JSON.parse(JSON.stringify({ actions: [], readings: [reading] }));
}

const PAIR = [silentRow({ recipeId: "z-recipe" }), silentRow({ recipeId: "a-recipe" })];
const OPEN = documentOf({ reading: evaluateRecipeStopped({ rows: PAIR, taken: NONE }) });
const OPEN_SET = stoppedSetOf({ document: OPEN });

/** The open set's episode key, thrown on when the fixture stopped being open. */
function openEpisode(): string {
  if (OPEN_SET.kind !== "open") {
    throw new Error(`the fixture set is ${OPEN_SET.kind}, not open`);
  }
  return OPEN_SET.repair.episodeKey;
}

const EPISODE = openEpisode();
const ROW = repairSlugOf({ episodeKey: EPISODE, tickId: "handoff-9009-tick-4" });

function reconciliation({
  aligned = [],
  fleet = "observed",
  held = [],
  ready = [],
}: { fleet?: string; ready?: readonly string[]; held?: readonly string[]; aligned?: readonly string[] } = {}): unknown {
  return {
    aligned: aligned.map((id) => ({ row: { id } })),
    fleet,
    held: held.map((id) => ({ id, standing: "held" })),
    misaligned: [],
    ready: ready.map((id) => ({ id, standing: "ready" })),
    unprioritised: [],
  };
}

function holdOn({ kind, id }: { kind: string; id: string }): unknown {
  return {
    claim: "held",
    judgementId: `hold-${id}`,
    kind: "hold-rationale",
    subject: { id, kind, label: id },
    whyNotDerived: "the owner's word",
    witness: "talk:1",
  };
}

function action({ kind, id, outcome = "completed" }: { kind: string; id: string; outcome?: string }): unknown {
  return { kind, outcome, subject: { id, kind: "handover", label: id } };
}

describe("stoppedSetOf", () => {
  it("reads the firing set's raw ids, sorted, and its episode key off the real evaluator's printed document", () => {
    expect(OPEN_SET.kind).toBe("open");
    expect(OPEN_SET).toEqual({ kind: "open", repair: { episodeKey: EPISODE, recipeIds: ["a-recipe", "z-recipe"] } });
    expect(EPISODE.length).toBeGreaterThan(0);
  });

  it("is clear when no recipe has stopped", () => {
    expect(
      stoppedSetOf({ document: documentOf({ reading: evaluateRecipeStopped({ rows: [], taken: NONE }) }) }),
    ).toEqual({
      kind: "clear",
    });
  });

  it("is clear when every stop is taken by a seat — the steer is not the owner's close", () => {
    const taken = new Map([
      ["a-recipe", "fix-a"],
      ["z-recipe", "fix-z"],
    ]);
    const reading = evaluateRecipeStopped({ rows: PAIR, taken });
    expect(reading.state).toBe("steered");
    expect(stoppedSetOf({ document: documentOf({ reading }) })).toEqual({ kind: "clear" });
  });

  it("is still open when the owner closed the card themselves: their Done holds the card, never the repair", () => {
    const stopped = evaluateRecipeStopped({ rows: [silentRow()], taken: NONE });
    if (stopped.state !== "firing") {
      throw new Error(`the fixture stop reads ${stopped.state}, not firing`);
    }
    const key = stopped.subjects[0]!.key;
    const reading = evaluateRecipeStopped({
      closed: new Map([[key, "2026-09-16T03:47:41.000Z"]]),
      rows: [silentRow()],
      taken: NONE,
    });
    expect(reading.state).toBe("steered");
    const set = stoppedSetOf({ document: documentOf({ reading }) });
    expect(set.kind).toBe("open");
    expect(set).toEqual({
      kind: "open",
      repair: { episodeKey: expect.any(String) as string, recipeIds: ["vulnfix-digest-acme-admin"] },
    });
  });

  it("reads a set closed by the owner as open, and a steer id outside the closed set as clear", () => {
    const closedSteer = ({ steerId }: { steerId: string }): unknown => ({
      actions: [],
      readings: [
        {
          monitorId: "recipe-stopped",
          state: "steered",
          steers: [
            { count: 1, instead: "closed", repair: { episodeKey: "episode-123", recipeIds: ["recipe-a"] }, steerId },
          ],
        },
      ],
    });
    const open = { kind: "open", repair: { episodeKey: "episode-123", recipeIds: ["recipe-a"] } };
    expect(stoppedSetOf({ document: closedSteer({ steerId: "closed-by-owner" }) })).toEqual(open);
    expect(stoppedSetOf({ document: closedSteer({ steerId: "closed-by-someone" }) })).toEqual({ kind: "clear" });
  });

  it("is unreadable, never clear, when the monitor could not read every recipe", () => {
    const reading = { ...evaluateRecipeStopped({ rows: PAIR, taken: NONE }), blindSpot: "a ledger would not parse" };
    expect(stoppedSetOf({ document: documentOf({ reading }) })).toEqual({
      kind: "unreadable",
      why: "the monitor could not read every recipe (a ledger would not parse), so the set is not whole",
    });
  });

  it("is unreadable, never open, when the owner's closed set's reading carries a blind spot too", () => {
    const steered = {
      blindSpot: "a recipe definition did not parse",
      monitorId: "recipe-stopped",
      state: "steered",
      steers: [
        {
          count: 1,
          instead: "closed",
          repair: { episodeKey: "episode-123", recipeIds: ["recipe-a"] },
          steerId: "closed-by-owner",
        },
      ],
    };
    expect(stoppedSetOf({ document: { actions: [], readings: [steered] } })).toEqual({
      kind: "unreadable",
      why: "the monitor could not read every recipe (a recipe definition did not parse), so the set is not whole",
    });
  });

  it("is unreadable when the monitor was unmeasurable", () => {
    const reading: MonitorReading = { because: "no ledger", monitorId: "recipe-stopped", state: "unmeasurable" };
    expect(stoppedSetOf({ document: documentOf({ reading }) })).toEqual({
      kind: "unreadable",
      why: "the monitor was unmeasurable: no ledger",
    });
  });

  it("is unreadable when a firing subject carries no repair set — a document from an older build", () => {
    const document = {
      actions: [],
      readings: [{ monitorId: "recipe-stopped", state: "firing", subjects: [{ id: "x", key: "k" }] }],
    };
    expect(stoppedSetOf({ document })).toEqual({
      kind: "unreadable",
      why: "the firing recipe-stopped subject carries no `repair` set — re-run it with this checkout",
    });
  });

  it("is unreadable when the repair ids are unsorted, so a hand-edited set cannot pass as the monitor's", () => {
    const document = {
      readings: [
        {
          monitorId: "recipe-stopped",
          state: "firing",
          subjects: [{ repair: { episodeKey: "e", recipeIds: ["z", "a"] } }],
        },
      ],
    };
    expect(stoppedSetOf({ document })).toEqual({
      kind: "unreadable",
      why: "the firing recipe-stopped subject's recipe ids are empty, unsorted or repeated",
    });
  });

  it("is unreadable when the document carries no recipe-stopped reading", () => {
    expect(stoppedSetOf({ document: { actions: [], readings: [] } })).toEqual({
      kind: "unreadable",
      why: "the document carries 0 recipe-stopped readings, not one",
    });
  });
});

describe("repair slugs and the brief", () => {
  it("extends the episode's base with the registering tick", () => {
    expect(repairSlugBaseOf({ episodeKey: "abc-123" })).toBe("repair-stopped-recipes-abc-123");
    expect(repairSlugOf({ episodeKey: "abc-123", tickId: "handoff-9009-tick-4" })).toBe(
      "repair-stopped-recipes-abc-123-handoff-9009-tick-4",
    );
  });

  it("names each recipe JSON-quoted in its own take line, under the row it was registered as", () => {
    expect(repairAsk({ recipeIds: ["a b", "z"], slug: "repair-stopped-recipes-e-t" }).split("\n")).toEqual([
      "Repair the stopped 2 recipes the supervisor sweep read at tick open, which no seat had and no hold explained.",
      "First `slopweaver handover start repair-stopped-recipes-e-t`, then take each stop, so the owner's floating note becomes the repairing notice:",
      '  slopweaver automation repair "a b" --row repair-stopped-recipes-e-t',
      '  slopweaver automation repair "z" --row repair-stopped-recipes-e-t',
      "Then find why each stopped (`slopweaver automation due --json`, its definition, its slot ledger) and restore it.",
      "Do not finish until each has run since you took it (`slopweaver automation run-due --recipe <id>` runs one now),",
      "or a question for the owner is on their Queue saying exactly what only they can decide. Never a card asking the owner to seat this.",
    ]);
  });
});

describe("episodeRowsOf", () => {
  it("reads a placed row as seated only when the fleet was observed", () => {
    expect(episodeRowsOf({ episodeKey: EPISODE, reconciliation: reconciliation({ aligned: [ROW] }) })).toEqual({
      kind: "read",
      value: { fleetObserved: true, seated: [ROW], unseated: [] },
    });
    expect(
      episodeRowsOf({ episodeKey: EPISODE, reconciliation: reconciliation({ aligned: [ROW], fleet: "unavailable" }) }),
    ).toEqual({ kind: "read", value: { fleetObserved: false, seated: [], unseated: [ROW] } });
  });

  it("reads ready and held rows of the episode as unseated, and ignores every other row", () => {
    const other = repairSlugOf({ episodeKey: "other", tickId: "t" });
    expect(
      episodeRowsOf({
        episodeKey: EPISODE,
        reconciliation: reconciliation({ held: [`${ROW}-2`], ready: [ROW, other, "fix-a-thing"] }),
      }),
    ).toEqual({ kind: "read", value: { fleetObserved: true, seated: [], unseated: [ROW, `${ROW}-2`] } });
  });

  it("is unreadable when the fleet is not stated", () => {
    expect(episodeRowsOf({ episodeKey: EPISODE, reconciliation: reconciliation({ fleet: "maybe" }) })).toEqual({
      kind: "unreadable",
      why: "the reconciliation does not say whether its fleet was observed",
    });
  });
});

describe("judgeStoppedRecipes", () => {
  const judge = ({
    actions = [],
    judgements = [],
    board = reconciliation(),
  }: { actions?: unknown; judgements?: unknown; board?: unknown } = {}) =>
    judgeStoppedRecipes({ actions, document: OPEN, judgements, reconciliation: board });

  it("refuses an open set nothing answered, naming the episode", () => {
    expect(judge()).toEqual({
      kind: "refused",
      repair: { episodeKey: EPISODE, recipeIds: ["a-recipe", "z-recipe"] },
      rows: [],
    });
  });

  it("refuses with the rows a spawn could seat: the board's, and the one this tick's open registered", () => {
    const registered = repairSlugOf({ episodeKey: EPISODE, tickId: "handoff-9009-tick-5" });
    expect(
      judge({
        actions: [action({ id: registered, kind: "state-amended" })],
        board: reconciliation({ ready: [ROW] }),
      }),
    ).toEqual({
      kind: "refused",
      repair: { episodeKey: EPISODE, recipeIds: ["a-recipe", "z-recipe"] },
      rows: [ROW, registered],
    });
  });

  it("is clean when a completed spawn seated a row of the episode", () => {
    expect(judge({ actions: [action({ id: ROW, kind: "spawned" })] })).toEqual({ kind: "clean" });
  });

  it("refuses when the spawn failed — a failed spawn seated nobody", () => {
    expect(judge({ actions: [action({ id: ROW, kind: "spawned", outcome: "failed" })] }).kind).toBe("refused");
  });

  it("refuses when the spawn seated a row of another episode", () => {
    const other = repairSlugOf({ episodeKey: "other", tickId: "t" });
    expect(judge({ actions: [action({ id: other, kind: "spawned" })] }).kind).toBe("refused");
  });

  it("is clean when a live seat already holds a row of the episode", () => {
    expect(judge({ board: reconciliation({ aligned: [ROW] }) })).toEqual({ kind: "clean" });
  });

  it("is clean when a hold-rationale names a row of the episode", () => {
    expect(judge({ judgements: [holdOn({ id: ROW, kind: "handover" })] })).toEqual({ kind: "clean" });
  });

  it("is clean when a hold-rationale names every recipe in the set", () => {
    expect(
      judge({
        judgements: [holdOn({ id: "a-recipe", kind: "recipe" }), holdOn({ id: "z-recipe", kind: "recipe" })],
      }),
    ).toEqual({ kind: "clean" });
  });

  it("refuses when only part of the set is held", () => {
    expect(judge({ judgements: [holdOn({ id: "a-recipe", kind: "recipe" })] }).kind).toBe("refused");
  });

  it("is clean on a clear set whatever the board says", () => {
    expect(
      judgeStoppedRecipes({
        actions: [],
        document: documentOf({ reading: evaluateRecipeStopped({ rows: [], taken: NONE }) }),
        judgements: [],
        reconciliation: undefined,
      }),
    ).toEqual({ kind: "clean" });
  });

  it("is unreadable when the board would not read under an open set", () => {
    expect(judge({ board: { fleet: "observed" } })).toEqual({
      kind: "unreadable",
      why: "the reconciliation carries no `aligned` placement, so which ready rows already have a seat cannot be read",
    });
  });
});
