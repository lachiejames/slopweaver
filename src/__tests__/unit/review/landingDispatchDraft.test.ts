import { describe, expect, it } from "vitest";
import type { RunDisposition } from "../../../handover/boardTypes.js";
import type { ParkedEvent } from "../../../handover/parkedEvent.js";
import { pressable } from "../../../review/landing.js";
import { boardRowNeedsReseat, type LandingBoardRow, landingBoardPark } from "../../../review/landingBoard.js";
import { type DispatchDecision, dispatchDecision } from "../../../review/landingDispatch.js";
import { draftVerdict } from "../../../review/landingDispatchDraft.js";
import { landingRowFake } from "../../landingRowFake.js";
import { FINISH_OR_CARD, inputs, summary } from "./landingDispatchFixtures.js";

const draftWith = ({ boardRow }: { boardRow: LandingBoardRow }): DispatchDecision =>
  dispatchDecision({ inputs: inputs({ action: "draft", boardRow }) });

/** A row left orphaned: live, its run active, its seat closed at rest, and no wake. */
const ORPHANED: LandingBoardRow = {
  kind: "row",
  parked: "no-wake",
  run: "active",
  slug: "knowledge-redaction-flag",
  status: "ready",
};

describe("dispatchDecision — a draft whose row's seat closed at rest with no wake", () => {
  it("is the act again, naming the existing row's reseat and never a second row", () => {
    expect(draftWith({ boardRow: ORPHANED })).toStrictEqual({
      kind: "act",
      verdict: "finish-or-card-close",
      why:
        "it is a draft and knowledge-redaction-flag holds its branch, but its run is parked at rest with the " +
        "seat closed and no wake, so nothing reseats it — reseat that row with " +
        "`slopweaver cmux spawn knowledge-redaction-flag`, never a second row — " +
        FINISH_OR_CARD,
    });
  });

  it("still waits on a park that named a wake, because `handover wake` owns that reseat", () => {
    expect(summary({ decision: draftWith({ boardRow: { ...ORPHANED, parked: "wake" } }) })).toBe("waiting");
  });

  it("still waits on an open seat, an active run with no park at all", () => {
    const { parked: _parked, ...open } = ORPHANED;
    expect(summary({ decision: draftWith({ boardRow: open }) })).toBe("waiting");
  });

  it("still waits when the run was not read, never assuming nobody is on it", () => {
    const { run: _run, ...unread } = ORPHANED;
    expect(summary({ decision: draftWith({ boardRow: unread }) })).toBe("waiting");
  });

  it("never sends a session at a teammate's draft, even over an orphaned row", () => {
    const decision = dispatchDecision({
      inputs: inputs({ action: "draft", authoredByOwner: false, boardRow: ORPHANED }),
    });
    expect(summary({ decision })).toBe("outside-the-set");
  });

  it("is draftVerdict's own answer, which dispatchDecision hands a draft to unchanged", () => {
    const draft = inputs({ action: "draft", boardRow: ORPHANED });
    expect(draftVerdict({ inputs: draft })).toStrictEqual(dispatchDecision({ inputs: draft }));
    expect(summary({ decision: draftVerdict({ inputs: draft }) })).toBe("act:finish-or-card-close");
  });
});

describe("pressable — a draft row never presses, whichever landing read carried it", () => {
  it("selects the ready merge-now row and never the draft read beside it", () => {
    const ready = landingRowFake({ number: 1 });
    const drafted = landingRowFake({
      action: "draft",
      dispatch: { kind: "act", verdict: "finish-or-card-close", why: "an unheld draft" },
      number: 2,
      ready: false,
    });
    expect(pressable({ rows: [drafted, ready] }).map((row) => row.number)).toEqual([1]);
  });
});

describe("boardRowNeedsReseat", () => {
  it("is true only for a live row whose active run is parked with no wake", () => {
    expect(boardRowNeedsReseat({ boardRow: ORPHANED })).toBe(true);
  });

  it.each([
    ["a wake-armed park", { ...ORPHANED, parked: "wake" as const }],
    ["a run parked on the owner", { ...ORPHANED, run: "waiting-on-owner" as const }],
    ["a terminal row", { ...ORPHANED, status: "done" }],
  ])("is false for %s", (_label, boardRow) => {
    expect(boardRowNeedsReseat({ boardRow })).toBe(false);
  });

  it("is false when no row declares the branch", () => {
    expect(boardRowNeedsReseat({ boardRow: { kind: "none-declared", why: "no row" } })).toBe(false);
  });
});

/** A seat-closed checkpoint, with or without a wake. */
const parkedEvent = (over: Partial<ParkedEvent> = {}): ParkedEvent => ({
  atIso: "2026-10-30T14:19:11.814Z",
  branch: "feature/one",
  kind: "parked",
  screenTail: "",
  sessionId: "session-1",
  workspaceRef: "workspace:1",
  worktree: "/worktrees/feature-one",
  ...over,
});

describe("landingBoardPark", () => {
  it("reads no-wake off an active run parked with no wake", () => {
    const run: RunDisposition = { kind: "active", parked: parkedEvent() };
    expect(landingBoardPark({ run })).toBe("no-wake");
  });

  it.each([
    ["a clock", { atIso: "2026-11-03T08:00:00Z", kind: "at" as const }],
    ["a pull request's CI", { kind: "checks" as const, number: 2705, repo: "acme/widgets" }],
  ])("reads wake off an active run whose park waits on %s", (_label, wake) => {
    const run: RunDisposition = { kind: "active", parked: parkedEvent({ wake }) };
    expect(landingBoardPark({ run })).toBe("wake");
  });

  it("reads nothing off an open seat", () => {
    expect(landingBoardPark({ run: { kind: "active" } })).toBeUndefined();
  });

  it("reads nothing off a run that never started", () => {
    expect(landingBoardPark({ run: { kind: "never-started" } })).toBeUndefined();
  });
});
