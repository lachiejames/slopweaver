/*
 * `fleet-unhealthy`'s `failingRows`: each recipe named once with its state, count and last why — the ledger's own
 * prefix dropped, a dead-letter's reason named, a never-started firing said as one, and a verb row cut to its exit.
 */
import { describe, expect, it } from "vitest";

import { failingRows, type ProbedAttempt } from "../../../../monitor/fleetHealthAttempts.js";

import { DIED_BY_LEASE, FAILED, NOW, probed, SETTLED } from "../fleetHealthFixtures.js";
import { NEVER_STARTED } from "./harness.js";

describe("failingRows", () => {
  it("names each recipe once — whether its newest run still fails, how often, and when and why it last did", () => {
    const rows = failingRows({
      attempts: [
        probed({ outcome: FAILED, recipeId: "atlas-hex", startedAtIso: "2026-09-29T09:00:00.000Z" }),
        probed({ outcome: FAILED, recipeId: "atlas-hex", startedAtIso: "2026-09-29T11:00:00.000Z" }),
        probed({ ...DIED_BY_LEASE, recipeId: "resync-corpus-slack", startedAtIso: "2026-09-29T10:30:00.000Z" }),
        probed({ outcome: FAILED, recipeId: "atlas-linear", startedAtIso: "2026-09-29T08:00:00.000Z" }),
        probed({ recipeId: "atlas-linear", startedAtIso: "2026-09-29T14:00:00.000Z" }),
        probed({ recipeId: "atlas-github" }),
        probed({ outcome: FAILED, recipeId: "gone", startedAtIso: "2026-09-28T15:00:00.000Z" }),
      ],
      nowIso: NOW,
    });
    expect(rows).toEqual([
      { failures: 2, lastFailedIso: SETTLED, recipeId: "atlas-hex", state: "failing", why: "exit 1" },
      {
        failures: 1,
        lastFailedIso: "2026-09-29T10:30:00.000Z",
        recipeId: "resync-corpus-slack",
        state: "failing",
        why: "died mid-run, never settled before its lease ran out",
      },
      { failures: 1, lastFailedIso: SETTLED, recipeId: "atlas-linear", state: "recovered", why: "exit 1" },
    ]);
  });

  it("drops the ledger's own `recipe <id> · ` prefix and names a dead-letter's reason", () => {
    const rows = failingRows({
      attempts: [
        probed({
          outcome: { detail: "recipe x · signal 9", kind: "dead", reason: "KILLED_BY_SIGNAL", settledAtIso: SETTLED },
          recipeId: "x",
        }),
        probed({ holderAlive: false, holderPid: 4242, outcome: null, recipeId: "y" }),
      ],
      nowIso: NOW,
    });
    expect(rows.map((row) => row.why)).toEqual(["KILLED_BY_SIGNAL: signal 9", "died mid-run, its process 4242 gone"]);
  });

  it("says a claimed firing that never started was never started, rather than that it died mid-run", () => {
    const rows = failingRows({
      attempts: [probed({ ...NEVER_STARTED, recipeId: "resync-corpus-linear" })],
      nowIso: NOW,
    });
    expect(rows.map((row) => row.why)).toEqual(["claimed by a seat and never started before its lease ran out"]);
  });

  it("cuts a verb row's detail to its exit and the verb's own closing words, never the command line", () => {
    const failed = ({ detail, recipeId }: { detail: string; recipeId: string }): ProbedAttempt =>
      probed({ outcome: { ...FAILED, detail }, recipeId });
    const rows = failingRows({
      attempts: [
        failed({ detail: "recipe a · ran · slopweaver automation resync --atlas hex · exit 1", recipeId: "a" }),
        failed({
          detail: "recipe b · ran · slopweaver store rehearse · exit 1 · why: restore · refused: no backup",
          recipeId: "b",
        }),
      ],
      nowIso: NOW,
    });
    expect(rows.map((row) => row.why)).toEqual(["exit 1", "exit 1: restore · refused: no backup"]);
  });
});
