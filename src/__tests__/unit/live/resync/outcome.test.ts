import { describe, expect, it } from "vitest";

import { judgeResyncAttempt, nextResyncState, type ResyncAttempt } from "../../../../live/resync/outcome.js";

const attempt = ({
  outcome,
  finishedAtIso = "2026-09-12T04:00:00.000Z",
}: {
  outcome: "succeeded" | "failed";
  finishedAtIso?: string;
}): ResyncAttempt => ({
  afterClock: null,
  beforeClock: null,
  exitCode: outcome === "succeeded" ? 0 : 1,
  finishedAtIso,
  outcome,
  problems: [],
  recipeId: "resync-atlas-airtable",
  startedAtIso: "2026-09-12T03:59:00.000Z",
});

describe("judgeResyncAttempt", () => {
  it("passes a corpus source whose refresh exited 3 — a quiet window with nothing new — when the store holds it", () => {
    const judged = judgeResyncAttempt({
      afterClock: "2021-09-16T20:42:47.000Z",
      beforeClock: "2021-09-16T20:42:47.000Z",
      exitCode: 3,
      recipeId: "resync-corpus-fathom",
      target: { kind: "corpus", source: "fathom" },
      walkStops: [],
    });
    expect(judged.isOk()).toBe(true);
  });

  it("still fails a corpus source that exited 3 and has no store row to read", () => {
    const judged = judgeResyncAttempt({
      afterClock: null,
      beforeClock: null,
      exitCode: 3,
      recipeId: "resync-corpus-calendar",
      target: { kind: "corpus", source: "calendar" },
      walkStops: [],
    });
    expect(judged.isErr()).toBe(true);
    expect(judged._unsafeUnwrapErr().message).toContain("holds no calendar row at all");
  });

  it("still fails an atlas that exited 3, because only its clock can vouch for it", () => {
    const judged = judgeResyncAttempt({
      afterClock: "2026-09-12T04:00:00.000Z",
      beforeClock: "2026-09-11T04:00:00.000Z",
      exitCode: 3,
      recipeId: "resync-atlas-trelica",
      target: { kind: "atlas", platform: "trelica" },
      walkStops: [],
    });
    expect(judged.isErr()).toBe(true);
    expect(judged._unsafeUnwrapErr().message).toBe("exited 3");
  });

  it("fails an atlas whose steps exited non-zero, whatever its clock did", () => {
    const judged = judgeResyncAttempt({
      afterClock: "2026-09-12T04:00:00.000Z",
      beforeClock: "2026-09-11T04:00:00.000Z",
      exitCode: 1,
      recipeId: "resync-atlas-vanta",
      target: { kind: "atlas", platform: "vanta" },
      walkStops: [],
    });
    expect(judged.isErr()).toBe(true);
    expect(judged._unsafeUnwrapErr().message).toBe("exited 1");
  });

  it("fails an atlas that exited 0 and left its generation clock exactly where it was", () => {
    const judged = judgeResyncAttempt({
      afterClock: "2026-09-06T10:04:27.618Z",
      beforeClock: "2026-09-06T10:04:27.618Z",
      exitCode: 0,
      recipeId: "resync-atlas-github",
      target: { kind: "atlas", platform: "github" },
      walkStops: [],
    });
    expect(judged.isErr()).toBe(true);
    expect(judged._unsafeUnwrapErr().code).toBe("POSTCONDITION_FAILED");
  });

  it("fails an atlas that exited 0 and moved its clock while a browser walk stopped part way — the hex pass", () => {
    const judged = judgeResyncAttempt({
      afterClock: "2026-09-16T16:48:07.433Z",
      beforeClock: "2026-09-16T10:50:37.114Z",
      exitCode: 0,
      recipeId: "resync-atlas-hex",
      target: { kind: "atlas", platform: "hex" },
      walkStops: ["the browser session driving this walk is no longer usable: Target page has been closed"],
    });
    expect(judged.isErr()).toBe(true);
    expect(judged._unsafeUnwrapErr().code).toBe("POSTCONDITION_FAILED");
    expect(judged._unsafeUnwrapErr().message).toBe(
      "exited 0 with its browser walk stopped part way, so every page after the stop went unread whatever " +
        "the clock says — a partial walk is not a resync, and the slot stays due",
    );
  });

  it("fails a corpus source whose step stopped a browser walk, so the rule is not an atlas-only one", () => {
    const judged = judgeResyncAttempt({
      afterClock: "2026-09-16T16:48:07.433Z",
      beforeClock: "2026-09-16T10:50:37.114Z",
      exitCode: 0,
      recipeId: "resync-corpus-slack",
      target: { kind: "corpus", source: "slack" },
      walkStops: ["no browser transport is attached: another walk holds the relay lease"],
    });
    expect(judged.isErr()).toBe(true);
    expect(judged._unsafeUnwrapErr().recipeId).toBe("resync-corpus-slack");
  });

  it("fails an atlas that exited 0 and published no generation at all", () => {
    const judged = judgeResyncAttempt({
      afterClock: null,
      beforeClock: null,
      exitCode: 0,
      recipeId: "resync-atlas-airtable",
      target: { kind: "atlas", platform: "airtable" },
      walkStops: [],
    });
    expect(judged.isErr()).toBe(true);
    expect(judged._unsafeUnwrapErr().message).toContain("published no generation at all");
  });

  it("passes an atlas whose clock moved forward", () => {
    const judged = judgeResyncAttempt({
      afterClock: "2026-09-12T03:11:40.978Z",
      beforeClock: "2026-09-11T00:20:32.259Z",
      exitCode: 0,
      recipeId: "resync-atlas-vanta",
      target: { kind: "atlas", platform: "vanta" },
      walkStops: [],
    });
    expect(judged.isOk()).toBe(true);
  });

  it("passes an atlas whose first ever generation appeared", () => {
    const judged = judgeResyncAttempt({
      afterClock: "2026-09-12T03:11:40.978Z",
      beforeClock: null,
      exitCode: 0,
      recipeId: "resync-atlas-canva",
      target: { kind: "atlas", platform: "canva" },
      walkStops: [],
    });
    expect(judged.isOk()).toBe(true);
  });

  it("passes a quiet corpus source that exited 0 without moving the store's newest row", () => {
    const judged = judgeResyncAttempt({
      afterClock: "2021-09-16T20:42:47.000Z",
      beforeClock: "2021-09-16T20:42:47.000Z",
      exitCode: 0,
      recipeId: "resync-corpus-fathom",
      target: { kind: "corpus", source: "fathom" },
      walkStops: [],
    });
    expect(judged.isOk()).toBe(true);
  });

  it("fails a corpus source that exited 0 while the store holds no row for it — bronze moved, the store did not", () => {
    const judged = judgeResyncAttempt({
      afterClock: null,
      beforeClock: null,
      exitCode: 0,
      recipeId: "resync-corpus-linear",
      target: { kind: "corpus", source: "linear" },
      walkStops: [],
    });
    expect(judged.isErr()).toBe(true);
    expect(judged._unsafeUnwrapErr().code).toBe("POSTCONDITION_FAILED");
    expect(judged._unsafeUnwrapErr().message).toBe(
      "exited 0 and the store holds no linear row at all, so whatever the refresh wrote reached bronze and " +
        "never the store — or the store could not be opened to check",
    );
  });

  it("still fails a corpus source whose refresh exited non-zero", () => {
    const judged = judgeResyncAttempt({
      afterClock: null,
      beforeClock: null,
      exitCode: 2,
      recipeId: "resync-corpus-slack",
      target: { kind: "corpus", source: "slack" },
      walkStops: [],
    });
    expect(judged.isErr()).toBe(true);
    expect(judged._unsafeUnwrapErr().message).toBe("exited 2");
  });
});

describe("nextResyncState", () => {
  it("records the success instant and clears any standing blocker", () => {
    const state = nextResyncState({
      attempt: attempt({ outcome: "succeeded" }),
      blocker: null,
      previous: {
        blocker: { findingSlug: "trelica-signed-out", key: "session-gone", reason: "signed out", steps: ["sign in"] },
        lastAttempt: null,
        lastSuccessAtIso: "2026-09-01T00:00:00.000Z",
        recipeId: "resync-atlas-airtable",
      },
    });
    expect(state.lastSuccessAtIso).toBe("2026-09-12T04:00:00.000Z");
    expect(state.blocker).toBe(null);
  });

  it("records a success at the instant its target certified, when that is earlier than the attempt finished", () => {
    const certified = { ...attempt({ outcome: "succeeded" }), asOfIso: "2026-09-11T05:00:00.000Z" };
    const state = nextResyncState({ attempt: certified, blocker: null, previous: null });
    expect(state.lastSuccessAtIso).toBe("2026-09-11T05:00:00.000Z");
  });

  it("never records a success later than the attempt finished, whatever its target certified", () => {
    const certified = { ...attempt({ outcome: "succeeded" }), asOfIso: "2026-09-13T00:00:00.000Z" };
    const state = nextResyncState({ attempt: certified, blocker: null, previous: null });
    expect(state.lastSuccessAtIso).toBe("2026-09-12T04:00:00.000Z");
  });

  it("keeps the last success across a failure, because how long it has been broken is the number", () => {
    const state = nextResyncState({
      attempt: attempt({ outcome: "failed" }),
      blocker: null,
      previous: {
        blocker: null,
        lastAttempt: null,
        lastSuccessAtIso: "2026-09-01T00:00:00.000Z",
        recipeId: "resync-atlas-airtable",
      },
    });
    expect(state.lastSuccessAtIso).toBe("2026-09-01T00:00:00.000Z");
    expect(state.lastAttempt!.outcome).toBe("failed");
  });

  it("keeps a standing blocker when this failure found none of its own", () => {
    const standing = { findingSlug: null, key: "session-gone", reason: "signed out", steps: ["sign in"] };
    const state = nextResyncState({
      attempt: attempt({ outcome: "failed" }),
      blocker: null,
      previous: { blocker: standing, lastAttempt: null, lastSuccessAtIso: null, recipeId: "resync-atlas-trelica" },
    });
    expect(state.blocker).toEqual(standing);
  });

  it("replaces a standing blocker with the one this failure found", () => {
    const found = { findingSlug: "x", key: "token-expired", reason: "401", steps: ["mint a token"] };
    const state = nextResyncState({
      attempt: attempt({ outcome: "failed" }),
      blocker: found,
      previous: {
        blocker: { findingSlug: null, key: "session-gone", reason: "signed out", steps: ["sign in"] },
        lastAttempt: null,
        lastSuccessAtIso: null,
        recipeId: "resync-atlas-trelica",
      },
    });
    expect(state.blocker).toEqual(found);
  });

  it("records a first ever attempt against no previous state", () => {
    const state = nextResyncState({ attempt: attempt({ outcome: "failed" }), blocker: null, previous: null });
    expect(state.lastSuccessAtIso).toBe(null);
    expect(state.recipeId).toBe("resync-atlas-airtable");
  });
});
