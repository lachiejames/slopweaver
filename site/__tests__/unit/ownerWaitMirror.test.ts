/*
 * Every console reader of the owner-wait kind and the pause subject reads a published board alike.
 *
 * The console copies sit beside the lists they govern — the owner-wait kind beside the closed list of verdicts in
 * `site/components/live/readBoardWaits.ts`, the pause subject beside the owner's role words in
 * `site/lib/workstreams.ts` — because `site/` never imports `src/`; `./ownerVocabularyMirror.test.ts` binds each to
 * its CLI constant.
 */
import { describe, expect, it } from "vitest";

import { readBoard } from "../../components/live/read";
import { OWNER_WAIT_KIND, ownerWaitOf, waitsOnOwner } from "../../components/live/readBoardWaits";
import { askWhenIso, ownerAsksOf } from "../../lib/ownerAsks";
import { isOnOwner, OWNER_PAUSE_SUBJECT } from "../../lib/workstreams";

/** One published board row, with what a case overrides. */
function published({ slug, over }: { slug: string; over: Record<string, unknown> }): Record<string, unknown> {
  return {
    kind: "ask",
    ownerWait: "not-waiting",
    reason: "waiting",
    section: "IN FLIGHT",
    slug,
    status: "ready",
    tags: [],
    ...over,
  };
}

describe("the console's board readers on the owner-wait kind and the pause subject", () => {
  it("reads the owner-wait kind and refuses an unknown one", () => {
    expect(OWNER_WAIT_KIND).toBe("owner");
    expect(["owner", "already-ruled", "nobody"].map((value) => ownerWaitOf({ value }))).toEqual([
      "owner",
      "already-ruled",
      undefined,
    ]);
    expect(["owner", "settled"].map((ownerWait) => waitsOnOwner({ ownerWait }))).toEqual([true, false]);
  });

  it("lists the asks waiting on the owner from a published board", () => {
    const asked = { question: "A or B?", questionAskedIso: "2026-09-24T10:00:00.000Z" };
    const board = readBoard({
      rows: [
        published({ over: { ...asked, ownerWait: "owner" }, slug: "owned" }),
        published({ over: { ...asked, ownerWait: "already-ruled" }, slug: "ruled" }),
      ],
      unresolved: 0,
    })!;
    expect(ownerAsksOf({ rows: board.rows }).map((row) => row.slug)).toEqual(["owned"]);
    expect(board.rows.map((row) => askWhenIso({ row }))).toEqual([asked.questionAskedIso, undefined]);
    expect(board.rows.map((row) => isOnOwner({ row }))).toEqual([true, false]);
  });

  it("reads a row paused on the owner's role word as the owner's", () => {
    const paused = (pausedOn: string) =>
      published({ over: { pausedOn, reason: "paused", section: "PAUSED", status: "paused" }, slug: pausedOn });
    const subjects = [OWNER_PAUSE_SUBJECT, "the owner", "Quinn"];
    const board = readBoard({ rows: subjects.map(paused), unresolved: 0 })!;
    expect(board.rows.map((row) => isOnOwner({ row }))).toEqual([true, true, false]);
  });
});
