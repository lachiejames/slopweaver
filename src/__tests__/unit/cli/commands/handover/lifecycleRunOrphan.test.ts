/**
 * `handover abandon`'s orphan path: the pure verdict for a run whose doc left the board, and the runner's
 * refusals over a real temp home. Every runner case stops before the append, so no clock is read.
 */
import { rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import { orphanAbandonVerdict, runHandoverAbandon } from "../../../../../cli/commands/handover/lifecycleRunOrphan.js";
import type { RunPhase } from "../../../../../handover/ledger.js";
import {
  clearSessionEnv,
  lifecycleHome,
  restoreSessionEnv,
  STARTED,
  snapshotTree,
  verbArgv,
} from "./lifecycleRunFixture.js";

const SLUG = "orphan-run";
const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
  restoreSessionEnv();
});

/** A verdict over a readable board without the slug and a readable journal, varying one input at a time. */
function verdict({
  boardHasSlug = false,
  boardUnreadable = [],
  journalUnreadable = [],
  phase = "open",
}: {
  boardHasSlug?: boolean;
  boardUnreadable?: readonly string[];
  journalUnreadable?: readonly number[];
  phase?: RunPhase;
}): ReturnType<typeof orphanAbandonVerdict> {
  return orphanAbandonVerdict({ boardHasSlug, boardUnreadable, journalUnreadable, phase, slug: SLUG });
}

describe("orphanAbandonVerdict", () => {
  it("falls through whenever a readable doc carries the slug, even over unreadable docs and lines", () => {
    expect(verdict({ boardHasSlug: true, boardUnreadable: ["x.md"], journalUnreadable: [3] })).toEqual({
      kind: "fall-through",
    });
  });

  it("refuses over unreadable board docs before it looks at the journal", () => {
    expect(verdict({ boardUnreadable: ["a.md", "b.md"], journalUnreadable: [3] })).toEqual({
      kind: "refuse",
      why: '2 doc(s) on the board could not be read (a.md, b.md), so "orphan-run" cannot be shown to be orphaned — fix or remove them first',
    });
  });

  it("refuses over undecodable journal lines", () => {
    expect(verdict({ journalUnreadable: [3, 5] })).toEqual({
      kind: "refuse",
      why: "orphan-run's journal has 2 line(s) that could not be decoded (3, 5), so it cannot show whether the run is still open",
    });
  });

  it("abandons an open or waiting orphan and falls through for a closed one", () => {
    const phases: readonly RunPhase[] = ["open", "waiting-on-owner", "closed"];

    expect(phases.map((phase) => verdict({ phase }))).toEqual([
      { kind: "abandon" },
      { kind: "abandon" },
      { kind: "fall-through" },
    ]);
  });
});

describe("runHandoverAbandon on an orphaned run", () => {
  it("answers 2 when an open orphan is given no --why, writing nothing", async () => {
    clearSessionEnv();
    const { home } = lifecycleHome({ events: [STARTED], homes, slug: SLUG, withDoc: false });
    const before = snapshotTree({ root: home });

    const code = await runHandoverAbandon(verbArgv({ rest: [SLUG, "--home", home], verb: "abandon" }));

    expect(code).toBe(2);
    expect(snapshotTree({ root: home })).toEqual(before);
  });

  it("answers 1 for an orphan whose journal holds an undecodable line, writing nothing", async () => {
    clearSessionEnv();
    const { home } = lifecycleHome({ events: [STARTED], homes, rawLines: ["{torn"], slug: SLUG, withDoc: false });
    const before = snapshotTree({ root: home });

    const code = await runHandoverAbandon(
      verbArgv({ rest: [SLUG, "--home", home, "--why", "its doc was deleted"], verb: "abandon" }),
    );

    expect(code).toBe(1);
    expect(snapshotTree({ root: home })).toEqual(before);
  });
});
