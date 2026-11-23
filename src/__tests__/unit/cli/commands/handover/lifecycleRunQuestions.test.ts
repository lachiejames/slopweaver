/**
 * `handover ask` and `handover answer` over a real temp board: each refusal paired with the near miss that
 * gets past it, so the exit code is shown to come from the flag under test. Every case stops before the
 * append, so no clock, stdin or cmux is reached, and the whole home is compared byte for byte.
 */
import { rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import { runHandoverAnswer, runHandoverAsk } from "../../../../../cli/commands/handover/lifecycleRunQuestions.js";
import type { RunEvent } from "../../../../../handover/ledger.js";
import {
  clearSessionEnv,
  lifecycleHome,
  restoreSessionEnv,
  STARTED,
  snapshotTree,
  verbArgv,
} from "./lifecycleRunFixture.js";

const SLUG = "questions-run";
const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
  restoreSessionEnv();
});

const ABANDONED: RunEvent = { atIso: "2026-10-01T09:10:00.000Z", kind: "abandoned", why: "gave up" };

/** The one concrete scene an ask leads with — the prose `askReshape.test.ts` already records. */
const SCENE = "You open the run's PR and it sits on the release branch. Should it be on main?";

describe("runHandoverAsk", () => {
  it("answers 2 without --question, and 1 with one on a run that is not open, writing nothing", async () => {
    clearSessionEnv();
    const { home } = lifecycleHome({ events: [STARTED, ABANDONED], homes, slug: SLUG });
    const before = snapshotTree({ root: home });
    const base = [SLUG, "--home", home, "--example", SCENE];

    const missing = await runHandoverAsk(verbArgv({ rest: base, verb: "ask" }));
    const closed = await runHandoverAsk(verbArgv({ rest: [...base, "--question", "Which base?"], verb: "ask" }));

    expect([missing, closed]).toEqual([2, 1]);
    expect(snapshotTree({ root: home })).toEqual(before);
  });
});

describe("runHandoverAnswer", () => {
  it("answers 2 without --answer, and 1 with one on a run holding no question, writing nothing", async () => {
    clearSessionEnv();
    const { home } = lifecycleHome({ events: [STARTED], homes, slug: SLUG });
    const before = snapshotTree({ root: home });

    const missing = await runHandoverAnswer(verbArgv({ rest: [SLUG, "--home", home], verb: "answer" }));
    const unasked = await runHandoverAnswer(
      verbArgv({ rest: [SLUG, "--home", home, "--answer", "main"], verb: "answer" }),
    );

    expect([missing, unasked]).toEqual([2, 1]);
    expect(snapshotTree({ root: home })).toEqual(before);
  });
});
