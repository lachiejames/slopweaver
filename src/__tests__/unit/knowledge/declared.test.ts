import { describe, expect, it } from "vitest";

import type { RunEvent } from "../../../handover/ledger.js";
import {
  ALLOW_NO_LESSONS,
  LESSONS_NONE,
  lessonsDeclaration,
  lessonsRefusalLines,
} from "../../../knowledge/declared.js";
import { noInstallDomains } from "../../../knowledge/domainVocabulary.js";
import { buildLessonRow } from "../../../knowledge/row.js";
import type { LessonLearner, LessonRow } from "../../../knowledge/types.js";
import { unwrap } from "../../../lib/result.js";

const SLUG = "some-run";
const CYCLE_ONE = "2026-09-07T00:00:00.000Z";
const CYCLE_TWO = "2026-09-08T00:00:00.000Z";

/** One row on a given run at a given instant. */
function row({
  at,
  run = SLUG,
  claim = "a claim",
  learner = "fleet",
}: {
  at: string;
  run?: string;
  claim?: string;
  learner?: LessonLearner;
}): LessonRow {
  return unwrap(
    buildLessonRow({
      caveat: undefined,
      claim,
      domain: "datadog",
      evidence: "measured",
      installDomains: noInstallDomains({ home: "/tmp/sw-home" }),
      learner,
      recordedAtIso: at,
      repro: undefined,
      run,
      surface: "api",
      tier: 2,
      verdict: "confirmed",
    }),
  );
}

/** A `lessons: none` event at a given instant. */
function noneAt({ at }: { at: string }): RunEvent {
  return { atIso: at, forced: false, kind: "lessons", lessons: LESSONS_NONE };
}

describe("lessonsDeclaration", () => {
  it("is undeclared when the run has recorded nothing and said nothing", () => {
    const found = lessonsDeclaration({ events: [], rows: [], slug: SLUG, startedAtIso: CYCLE_ONE });
    expect(found.declared).toBe(false);
    expect(found.recorded).toBe(0);
    expect(found.explicitNone).toBe(false);
  });

  it("is declared by a row this run recorded", () => {
    const found = lessonsDeclaration({
      events: [],
      rows: [row({ at: CYCLE_ONE })],
      slug: SLUG,
      startedAtIso: CYCLE_ONE,
    });
    expect(found.declared).toBe(true);
    expect(found.recorded).toBe(1);
    expect(found.explicitNone).toBe(false);
  });

  it("is declared by an explicit none, which is a first-class answer rather than a bypass", () => {
    const found = lessonsDeclaration({
      events: [noneAt({ at: CYCLE_ONE })],
      rows: [],
      slug: SLUG,
      startedAtIso: CYCLE_ONE,
    });
    expect(found.declared).toBe(true);
    expect(found.explicitNone).toBe(true);
    expect(found.recorded).toBe(0);
  });

  it("ignores a row another run recorded", () => {
    const found = lessonsDeclaration({
      events: [],
      rows: [row({ at: CYCLE_ONE, run: "a-different-run" })],
      slug: SLUG,
      startedAtIso: CYCLE_ONE,
    });
    expect(found.declared).toBe(false);
    expect(found.recorded).toBe(0);
  });

  it("ignores a row from a PREVIOUS cycle, so a second run answers for itself", () => {
    const found = lessonsDeclaration({
      events: [],
      rows: [row({ at: CYCLE_ONE })],
      slug: SLUG,
      startedAtIso: CYCLE_TWO,
    });
    expect(found.declared).toBe(false);
    expect(found.recorded).toBe(0);
  });

  it("ignores a none from a PREVIOUS cycle for the same reason", () => {
    const found = lessonsDeclaration({
      events: [noneAt({ at: CYCLE_ONE })],
      rows: [],
      slug: SLUG,
      startedAtIso: CYCLE_TWO,
    });
    expect(found.declared).toBe(false);
    expect(found.explicitNone).toBe(false);
  });

  it("counts every row this cycle recorded, not just the first", () => {
    const found = lessonsDeclaration({
      events: [],
      rows: [row({ at: CYCLE_TWO, claim: "one" }), row({ at: CYCLE_TWO, claim: "two" })],
      slug: SLUG,
      startedAtIso: CYCLE_TWO,
    });
    expect(found.recorded).toBe(2);
  });

  it("counts a row stamped exactly at the cycle's start, so a fast run is not excluded by a tie", () => {
    const found = lessonsDeclaration({
      events: [],
      rows: [row({ at: CYCLE_ONE })],
      slug: SLUG,
      startedAtIso: CYCLE_ONE,
    });
    expect(found.recorded).toBe(1);
  });
});

describe("lessonsRefusalLines", () => {
  it("names both ways to answer and the break-glass, so the reader's next keystroke is on screen", () => {
    const lines = lessonsRefusalLines({ slug: SLUG, verb: "finish" }).join("\n");
    expect(lines).toContain(`slopweaver knowledge record --run ${SLUG}`);
    expect(lines).toContain(`slopweaver handover finish ${SLUG} --lessons none`);
    expect(lines).toContain(ALLOW_NO_LESSONS);
  });

  it("names the verb it was called for, so a settle refusal does not suggest finish", () => {
    const lines = lessonsRefusalLines({ slug: SLUG, verb: "settle" }).join("\n");
    expect(lines).toContain("handover settle: some-run has not said whether this run learned anything");
    expect(lines).toContain(`slopweaver handover settle ${SLUG} --lessons none`);
  });
});

describe("only the fleet's rows answer the lesson question", () => {
  it("is undeclared when the only row this run recorded is a belief of the owner's", () => {
    const found = lessonsDeclaration({
      events: [],
      rows: [row({ at: CYCLE_ONE, learner: "owner" })],
      slug: SLUG,
      startedAtIso: CYCLE_ONE,
    });
    expect(found.declared).toBe(false);
    expect(found.recorded).toBe(0);
  });

  it("counts only the fleet's row when this run recorded one of each", () => {
    const found = lessonsDeclaration({
      events: [],
      rows: [
        row({ at: CYCLE_ONE, claim: "a fleet lesson" }),
        row({ at: CYCLE_ONE, claim: "a belief of the owner's", learner: "owner" }),
      ],
      slug: SLUG,
      startedAtIso: CYCLE_ONE,
    });
    expect(found.declared).toBe(true);
    expect(found.recorded).toBe(1);
  });
});
