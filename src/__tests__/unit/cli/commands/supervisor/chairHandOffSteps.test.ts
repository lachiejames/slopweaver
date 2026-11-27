/**
 * The pure halves of `supervisor hand-off`'s steps: the watch's gate, the successor's plan and vendor, the note
 * deadline, and the reasons the successor doc carries. The transaction around them is proven end to end in
 * `./chairHandOffRun.test.ts`.
 */
import { describe, expect, it } from "vitest";

import type { ChairHandOffOptions } from "../../../../../cli/commands/supervisor/chairHandOffArgs.js";
import { successorPlan, watchRefusal } from "../../../../../cli/commands/supervisor/chairHandOffBegin.js";
import { noteDeadlineIso } from "../../../../../cli/commands/supervisor/chairHandOffNoteSteps.js";
import { successorDocReasons } from "../../../../../cli/commands/supervisor/chairHandOffSeat.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { ChairHandOffStarted } from "../../../../../supervisor/chairHandOff.js";
import { APP_CHAIR, OLD_SLUG, type WatchScript, watchReport } from "./chairHandOffFixtures.js";

const AT = "2026-11-27T08:00:00.000Z";

const HAND_OFF: WatchScript = { chair: APP_CHAIR, reasons: ["plan-one Fable week 97%"], status: "hand-off" };

const OPTIONS: ChairHandOffOptions = {
  home: "/h",
  namedHome: undefined,
  noteWaitSeconds: 600,
  now: undefined,
  plan: undefined,
  reason: undefined,
};

const STARTED: ChairHandOffStarted = {
  alias: "plan-two",
  atIso: AT,
  basis: { kind: "auto" },
  episodeId: "chair-hand-off:old",
  kind: "started",
  noteWaitSeconds: 600,
  predecessor: "old",
  predecessorSlug: OLD_SLUG,
  reasons: ["plan-one Fable week 97%"],
  vendor: "claude",
};

describe("watchRefusal", () => {
  it("lets a hand-off verdict on the pinned app chair through", () => {
    expect(
      watchRefusal({ now: undefined, pinned: "chair-old-1", report: watchReport({ nowIso: AT, script: HAND_OFF }) }),
    ).toBe(undefined);
  });

  it("defers while the watch and the pin name different chairs, even with --now", () => {
    expect(
      watchRefusal({ now: "tonight", pinned: "other", report: watchReport({ nowIso: AT, script: HAND_OFF }) }),
    ).toEqual({
      exit: 4,
      line: "not yet: the watch read chair app:chair-old-1 while the pin names app:other; re-run once they agree",
    });
  });

  it("refuses an unresolved chair with no override, its reason scrubbed of addresses", () => {
    const script: WatchScript = {
      chair: { kind: "unresolved", why: "no pin for seat-1@example.test" },
      reasons: [],
      status: "unmeasured",
    };
    expect(
      watchRefusal({ now: "tonight", pinned: "chair-old-1", report: watchReport({ nowIso: AT, script }) }),
    ).toEqual({
      exit: 1,
      line: "refused: the watch could not resolve the chair (no pin for <account>); no override hands off a chair nobody can name — fix what it names, then re-run `slopweaver supervisor chair-watch`",
    });
  });

  it("reads a held verdict with no recorded hold as unreasoned, and --now past a stay", () => {
    const held = watchRefusal({
      now: undefined,
      pinned: "chair-old-1",
      report: watchReport({ nowIso: AT, script: { ...HAND_OFF, status: "held" } }),
    });
    expect(held!.line).toBe(
      'refused: automatic hand-off is HELD (no reason recorded); lift it with `slopweaver supervisor hand-off release --reason "<why>"`, or hand off anyway with --now --reason "<why>"',
    );
    const stay = watchReport({ nowIso: AT, script: { ...HAND_OFF, status: "stay" } });
    expect(watchRefusal({ now: "tonight", pinned: "chair-old-1", report: stay })).toBe(undefined);
  });
});

describe("successorPlan", () => {
  it("takes the watch's plan and target vendor when no --plan is named", () => {
    expect(unwrap(successorPlan({ options: OPTIONS, report: watchReport({ nowIso: AT, script: HAND_OFF }) }))).toEqual({
      alias: "plan-two",
      override: undefined,
      vendor: "claude",
    });
  });

  it("carries --now's reason as the plan override's when --reason is absent", () => {
    const plan = successorPlan({
      options: { ...OPTIONS, now: "switching tonight", plan: "plan-four" },
      report: watchReport({ nowIso: AT, script: HAND_OFF }),
    });
    expect(unwrap(plan)).toEqual({
      alias: "plan-four",
      override: { alias: "plan-four", reason: "switching tonight", watchAlias: "plan-two" },
      vendor: "codex",
    });
  });

  it("refuses a --plan the watch never read, since its vendor is unknown", () => {
    const plan = successorPlan({
      options: { ...OPTIONS, plan: "plan-nine" },
      report: watchReport({ nowIso: AT, script: HAND_OFF }),
    });
    expect(unwrapErr(plan)).toEqual({
      exit: 1,
      line: "refused: plan plan-nine is not one the watch read, so its vendor is unknown; name a registered plan with --plan <alias>",
    });
  });
});

describe("noteDeadlineIso", () => {
  it("adds the wait to the instant the note was asked", () => {
    expect(noteDeadlineIso({ atIso: AT, waitSeconds: 600 })).toBe("2026-11-27T08:10:00.000Z");
    expect(noteDeadlineIso({ atIso: AT, waitSeconds: 0 })).toBe(AT);
  });
});

describe("successorDocReasons", () => {
  it("carries the watch's reasons alone on an automatic hand-off", () => {
    expect(successorDocReasons({ started: STARTED })).toEqual(["plan-one Fable week 97%"]);
  });

  it("names the owner's --now and --plan after the watch's reasons", () => {
    const started: ChairHandOffStarted = {
      ...STARTED,
      basis: { kind: "now", reason: "switching tonight" },
      planOverride: { alias: "plan-four", reason: "more room", watchAlias: "plan-two" },
    };
    expect(successorDocReasons({ started })).toEqual([
      "plan-one Fable week 97%",
      "the owner's --now: switching tonight",
      "successor plan plan-four by --plan: more room",
    ]);
  });
});
