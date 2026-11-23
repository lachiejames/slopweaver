/*
 * session-start's reconcile step: a whole list diffs against the last run and becomes the next one's baseline; a
 * list cut short at its --deadline does neither, so a leg it skipped never reads as every row gone.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CUT_SHORT_UNRECONCILED, reconcileUnlessCut } from "../../../cli/commands/sessionStart/reconcileStep.js";
import { unwrap } from "../../../lib/result.js";
import { parseSnapshots, readRunStore, recordRun } from "../../../sessionStart/runStore.js";

const homes: string[] = [];

/** A throwaway state home holding one recorded baseline with one row, removed after the test. */
function homeWithBaseline(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-reconcile-step-"));
  homes.push(home);
  unwrap(
    recordRun({
      home,
      snapshot: {
        atIso: "2026-11-05T00:00:00.000Z",
        items: [{ closing: false, identity: "linear:ABC-1", state: "open", whenIso: "2026-11-01T00:00:00.000Z" }],
      },
    }),
  );
  return home;
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

const EMPTY_RANKING = { dropped: [], ranked: [] };
const NOW = "2026-11-06T00:00:00.000Z";

describe("reconcileUnlessCut", () => {
  it("reports no movement and records nothing for a list cut short, saying why", () => {
    const home = homeWithBaseline();
    const before = readRunStore({ home });

    const reconciled = reconcileUnlessCut({
      cut: ["your mail"],
      home,
      nowIso: NOW,
      ranking: EMPTY_RANKING,
      record: true,
    });

    expect(reconciled).toEqual({ couldNotSee: [CUT_SHORT_UNRECONCILED], movements: [], sinceIso: undefined });
    expect(readRunStore({ home })).toBe(before);
  });

  it("diffs a whole list against the last run and records it as the next baseline", () => {
    const home = homeWithBaseline();

    const reconciled = reconcileUnlessCut({ cut: [], home, nowIso: NOW, ranking: EMPTY_RANKING, record: true });

    expect(reconciled.sinceIso).toBe("2026-11-05T00:00:00.000Z");
    expect(reconciled.couldNotSee).toEqual([]);
    expect(reconciled.movements.map((one) => [one.identity, one.label])).toEqual([["linear:ABC-1", "gone"]]);
    expect(parseSnapshots({ text: readRunStore({ home }) }).map((one) => one.atIso)).toEqual([
      "2026-11-05T00:00:00.000Z",
      NOW,
    ]);
  });
});
