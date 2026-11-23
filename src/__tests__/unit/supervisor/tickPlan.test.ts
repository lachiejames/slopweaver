/**
 * The pure half of a sweep: tick numbering, the landing reading's own acts pre-filled, the sweep-block edit
 * read off the reconciliation, and the close's resumable stages.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { parseTickInput, type TickInput } from "../../../supervisor/tickInput.js";
import {
  CLOSE_STAGES,
  landingActions,
  nextTickNumber,
  parseCloseState,
  sha256Hex,
  stagesOwed,
  sweepBlockInputOf,
  tickIdOf,
  withStageDone,
} from "../../../supervisor/tickPlan.js";
import { newTickSeat } from "../../../supervisor/tickSeat.js";

const SEAT = unwrap(
  newTickSeat({
    dir: "/s/handoff-9292",
    path: "p",
    seat: {
      handoff: "handoff-9292",
      landingRepos: [],
      loopSessionKey: "k",
      model: "fable",
      pinnedAtIso: "2026-09-23T14:36:00Z",
      workspace: "workspace:93",
    },
  }),
);

const INPUT: TickInput = unwrap(
  parseTickInput({
    recordedIso: "2026-09-27T01:00:00.000Z",
    value: {
      actions: [],
      foldSummary: "One merge landed.",
      folds: ["The rebase landed."],
      headline: { sentences: ["The queue is clear."] },
      judgements: [],
      lede: "Quiet hour.",
      openPagesReviewed: false,
      schemaVersion: 1,
      shift: null,
      sleeping: true,
    },
  }),
);

describe("nextTickNumber / tickIdOf", () => {
  it("counts only exact tick-<n> directories", () => {
    expect(nextTickNumber({ names: ["tick-3", "tick-10", "tick-11b", "tick-draft.log", "seat.json"] })).toBe(11);
  });

  it("starts at 1 in an empty seat", () => {
    expect(nextTickNumber({ names: ["seat.json"] })).toBe(1);
  });

  it("spells the id the chair always wrote", () => {
    expect(tickIdOf({ handoff: "handoff-9292", tick: 618 })).toBe("handoff-9292-tick-618");
  });
});

describe("landingActions", () => {
  const landing = {
    kind: "read",
    presses: [
      { detail: "enqueued", number: 1, outcome: "pressed", repoSlug: "o/r", url: "https://github.com/o/r/pull/1" },
      { detail: "dry", number: 2, outcome: "would-press", repoSlug: "o/r", url: "https://github.com/o/r/pull/2" },
      { detail: "503", number: 3, outcome: "failed", repoSlug: "o/r", url: "https://github.com/o/r/pull/3" },
    ],
    registrations: [
      {
        detail: "new row",
        number: 4,
        outcome: "registered",
        repoSlug: "o/s",
        slug: "land-o-s-4",
        url: "https://github.com/o/s/pull/4",
      },
      { detail: "known", number: 5, outcome: "skipped", repoSlug: "o/s", slug: "x", url: "u" },
    ],
  };

  it("pre-fills each press and registration that was an act, failures included", () => {
    const actions = landingActions({ landing, witnessPath: "/t/landing.json" });

    expect(actions.map((action) => [action.actionId, action.kind, action.outcome, action.subject.id])).toEqual([
      ["landing-press-o/r#1", "enqueued", "completed", "https://github.com/o/r/pull/1"],
      ["landing-press-o/r#3", "enqueued", "failed", "https://github.com/o/r/pull/3"],
      ["landing-register-o/s#4", "state-amended", "completed", "land-o-s-4"],
    ]);
    expect(actions[0]!.witness).toEqual({ kind: "artifact", ref: "/t/landing.json" });
  });

  it("skips an act whose pull request it cannot name", () => {
    const unnamed = { kind: "read", presses: [{ detail: "enqueued", outcome: "pressed", repoSlug: "o/r" }] };

    expect(landingActions({ landing: unnamed, witnessPath: "w" })).toEqual([]);
  });

  it("pre-fills nothing from a landing read that was not due", () => {
    expect(landingActions({ landing: { kind: "skipped", why: "not due" }, witnessPath: "w" })).toEqual([]);
  });
});

describe("parseCloseState", () => {
  it("refuses a file that is not a close state, naming it", () => {
    const refused = parseCloseState({ path: "/t/close-state.json", value: { done: "all" } });

    expect(unwrapErr(refused).code).toBe("CAPTURE_INVALID");
    expect(unwrapErr(refused).message).toContain("/t/close-state.json");
  });

  const digest = sha256Hex({ text: "the staged list" });
  const v2 = { done: ["form-committed"], inputSha256: digest, schemaVersion: 2, tickId: "handoff-9292-tick-1" };

  it("reads a state binding a staged list's digest, and one binding the seat's own list as null", () => {
    expect(unwrap(parseCloseState({ path: "p", value: { ...v2, listSha256: digest } })).listSha256).toBe(digest);
    expect(unwrap(parseCloseState({ path: "p", value: { ...v2, listSha256: null } })).listSha256).toBe(null);
  });

  it("refuses a state with no list digest, or one that is not a sha256", () => {
    const missing = unwrapErr(parseCloseState({ path: "/t/close-state.json", value: v2 }));
    const malformed = unwrapErr(parseCloseState({ path: "/t/close-state.json", value: { ...v2, listSha256: "abc" } }));

    expect([missing.code, malformed.code]).toEqual(["CAPTURE_INVALID", "CAPTURE_INVALID"]);
    expect(missing.message).toContain("listSha256");
    expect(malformed.message).toContain("listSha256");
  });

  it("refuses a version-1 state by name, since it never recorded which list its stages saw", () => {
    const v1 = { done: ["form-committed"], inputSha256: digest, schemaVersion: 1, tickId: "handoff-9292-tick-1" };

    expect(unwrapErr(parseCloseState({ path: "/t/close-state.json", value: v1 })).message).toBe(
      "/t/close-state.json: schemaVersion 1 predates the staged-list digest, so which list its stages saw is " +
        "unknown — remove this close-state to restart the close",
    );
  });
});

describe("sweepBlockInputOf", () => {
  it("reads the alignment words off the reconciliation, and the header off the seat", () => {
    const edit = unwrap(
      sweepBlockInputOf({
        input: INPUT,
        reconcile: { headline: "Aligned on the rewrite.", intakeClause: "" },
        reconcilePath: "r.json",
        seat: SEAT,
      }),
    );

    expect(edit.alignment.headline).toBe("Aligned on the rewrite.");
    expect(edit.alignment.intake).toBe(undefined);
    expect(edit.header).toEqual({
      handoff: "handoff-9292",
      lede: "Quiet hour.",
      model: "fable",
      pinnedAt: "2026-09-23T14:36:00Z",
      sleeping: true,
      workspace: "workspace:93",
    });
    expect(edit.recent.sentences).toEqual(["The queue is clear."]);
  });

  it("refuses a reconciliation with no headline rather than printing null on the page", () => {
    const edit = sweepBlockInputOf({
      input: INPUT,
      reconcile: { headline: null },
      reconcilePath: "r.json",
      seat: SEAT,
    });

    expect(edit._unsafeUnwrapErr().message).toContain("r.json");
    expect(edit._unsafeUnwrapErr().message).toContain("carries no `headline` string");
  });
});

describe("stagesOwed / withStageDone", () => {
  const hash = sha256Hex({ text: "{}" });
  const tickId = "handoff-9292-tick-1";

  it("owes every stage on a first close", () => {
    expect(unwrap(stagesOwed({ inputSha256: hash, state: undefined, tickId }))).toEqual(CLOSE_STAGES);
  });

  it("resumes after the last stage it recorded", () => {
    const base = { done: [], inputSha256: hash, listSha256: null, schemaVersion: 2 as const, tickId };
    const state = withStageDone({
      pageUrl: "file:///p",
      stage: "page-published",
      state: withStageDone({ stage: "form-committed", state: base }),
    });

    expect(unwrap(stagesOwed({ inputSha256: hash, state, tickId }))).toEqual(["snapshots-resolved", "tick-recorded"]);
    expect(state.pageUrl).toBe("file:///p");
  });

  it("refuses to resume under an edited tick file", () => {
    const state = {
      done: ["form-committed" as const],
      inputSha256: hash,
      listSha256: hash,
      schemaVersion: 2 as const,
      tickId,
    };

    const owed = stagesOwed({ inputSha256: sha256Hex({ text: "{ }" }), state, tickId });

    expect(owed._unsafeUnwrapErr().code).toBe("CLOSE_STATE_CONFLICT");
  });
});
