/*
 * The CONSUMER half of the `slopweaver handover steers --json` contract: the reader fed the golden the verb's own test
 * writes (`src/__tests__/unit/cli/commands/handover/steersContract.test.ts`), so a field renamed on either side fails
 * one half or the other. Every state and origin reads back as the page draws it, and one steer that does not read
 * takes the whole report down rather than vanishing from the page.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { readSteers } from "../../components/live/readSteers";

/** The golden the verb's own test writes. */
const GOLDEN = fileURLToPath(new URL("../../../src/__tests__/fixtures/contract/handover-steers.json", import.meta.url));

const CALL = "talk-call:a0000055-0000-4000-8000-000000000061#turn_000000000000000000005";

const LANDING = {
  branch: "a-console-page",
  mergedIso: "2026-10-05T15:00:00+00:00",
  number: 1880,
  title: "A console page shows each steer",
  url: "https://github.com/lachiejames/slopweaver/pull/1880",
};

const WORDS = {
  anchor: CALL,
  atIso: "2026-10-05T11:42:00.000Z",
  cut: "none",
  where: "call",
  words: "are you still there?",
};

/** A fresh parse of the golden, as the console receives it and as plain JSON a test can break. */
function wire(): { steers: { state: unknown; words: unknown }[] } {
  const document: unknown = JSON.parse(readFileSync(GOLDEN, "utf8"));
  if (typeof document !== "object" || document === null || !("steers" in document) || !Array.isArray(document.steers)) {
    throw new Error("the golden is not a steers report");
  }
  return document as { steers: { state: unknown; words: unknown }[] };
}

describe("readSteers", () => {
  it("reads every state and origin the verb writes, absent fields as undefined", () => {
    const view = readSteers(wire())!;
    expect(view.observedAtIso).toBe("2026-10-06T02:00:00.000Z");
    expect(view.unreadableJournals).toEqual(["broken-journal"]);
    expect(view.repos).toEqual([
      {
        dir: "/repos/slopweaver",
        kind: "read",
        ledgerUnread: 2,
        ref: "origin/main",
        refSha: "da5921b065",
        repo: "lachiejames/slopweaver",
        unjoined: 4,
      },
      { dir: "/repos/gone", kind: "unread", why: "no origin/main" },
    ]);
    expect(view.steers.map((steer) => steer.slug)).toEqual([
      "applied",
      "settled",
      "on-a-pr",
      "moving",
      "unledgered",
      "unknown",
    ]);
    const [applied, settled, onAPr, moving, unledgered, unknown] = view.steers;
    expect(unledgered.state).toEqual({ kind: "applied", landing: { ...LANDING, branch: undefined }, via: "witness" });
    expect(applied).toEqual({
      againIsos: ["2026-10-05T11:50:00.000Z", undefined],
      askedIso: "2026-10-05T11:42:00.000Z",
      origin: { anchor: CALL, kind: "cut" },
      repo: "/repos/slopweaver",
      slug: "applied",
      state: { kind: "applied", landing: LANDING, via: "branch" },
      timesGiven: 3,
      title: "A console page shows each steer",
      words: WORDS,
    });
    expect(settled.state).toEqual({ kind: "settled", settlement: "filed", witness: undefined, witnessPr: undefined });
    expect(settled.origin).toEqual({ kind: "named-in-text", turn: "turn_000000000000000000009" });
    expect(settled.askedIso).toBe(undefined);
    expect(onAPr.state).toEqual({
      kind: "settled",
      settlement: "filed",
      witness: "https://github.com/other/repo/pull/7",
      witnessPr: { number: 7, repo: "other/repo" },
    });
    expect(moving.state).toEqual({ branch: undefined, kind: "in-flight" });
    expect(unknown.state).toEqual({ kind: "landing-unknown", why: "no repository" });
  });

  it("refuses the whole report when one steer's state does not read", () => {
    const payload = wire();
    payload.steers[1].state = { kind: "half-applied" };
    expect(readSteers(payload)).toBe(undefined);
  });

  it("refuses the whole report when one steer's state has no kind", () => {
    const payload = wire();
    payload.steers[1].state = { settlement: "filed" };
    expect(readSteers(payload)).toBe(undefined);
  });

  it("refuses the whole report when one steer's words lose a field", () => {
    const payload = wire();
    payload.steers[0].words = { ...WORDS, where: "somewhere-new" };
    expect(readSteers(payload)).toBe(undefined);
  });

  it("reads a steer given once as said again never", () => {
    expect(readSteers(wire())!.steers[1].againIsos).toEqual([]);
  });

  it.each([
    ["missing", undefined],
    ["not a list", "2026-10-05T11:50:00.000Z"],
    ["holding a number", [1, null]],
    ["one short of said 3 times", ["2026-10-05T11:50:00.000Z"]],
    ["one past said 3 times", ["2026-10-05T11:50:00.000Z", null, null]],
  ])("refuses the whole report when one steer's said-again instants are %s", (_case, againIsos) => {
    const payload = wire();
    const steer = payload.steers[0] as { againIsos?: unknown };
    steer.againIsos = againIsos;
    expect(readSteers(payload)).toBe(undefined);
  });

  it("refuses the whole report when one steer's count is not a whole number of times", () => {
    const payload = wire();
    (payload.steers[1] as { timesGiven?: unknown }).timesGiven = 0;
    expect(readSteers(payload)).toBe(undefined);
    (payload.steers[1] as { timesGiven?: unknown }).timesGiven = 1.5;
    expect(readSteers(payload)).toBe(undefined);
  });

  it("refuses a payload that is not a report", () => {
    expect(readSteers({ steers: [] })).toBe(undefined);
    expect(readSteers("[]")).toBe(undefined);
  });
});
