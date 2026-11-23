/*
 * The voice's Queue answer over a card it must not read out and a card stopping the owner's work. Split from
 * `./talkActionItems.test.ts` by describe block.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { type Board, type HandStep, readBoard, readHandSteps } from "../../components/live/read";
import { actionItemProjection, actionItemsAnswer } from "../../lib/talkActionItems";
import { ACME_PLACER } from "../organisationFixture";

import { ready } from "./actionItemReadingsFixture";
import { allReady, NOW, ownerAsk, ownerPlate } from "./ownerPlateFixture";

describe("actionItemsAnswer — a card that failed its own checks", () => {
  /** The owner's plate with one more ask, whose question names the call it came from by id. */
  function withRefusedAsk(): Parameters<typeof actionItemsAnswer>[0] {
    const board = readBoard({
      rows: [
        ownerAsk({ slug: "chair-respawn", workspace: "self" }),
        { ...ownerAsk({ slug: "payments-credit", workspace: "team" }), question: "Send the recut off call efe7b241?" },
      ],
      unresolved: 0,
    });
    if (board === undefined) {
      throw new Error("the fixture board did not read");
    }
    return { ...ownerPlate(), board: ready<Board>({ at: "2026-09-24T17:00:00.000Z", value: board }) };
  }

  it("never reads it out or lists it as an item, and says how many are held off", () => {
    const answer = actionItemsAnswer(withRefusedAsk());
    expect(answer.items.map((item) => item.key)).toEqual(["ask:chair-respawn", "hand:try-now-page"]);
    expect(answer.withheld).toBe(1);
  });

  it("holds it in the projection's withheld list, never its live rows or its departures", () => {
    const { live, recentlyLeft, withheld } = actionItemProjection({
      nowIso: NOW,
      placer: ACME_PLACER,
      readings: withRefusedAsk(),
    });
    expect(withheld.map((row) => row.key)).toEqual(["ask:payments-credit"]);
    expect(live.some((row) => row.key === "ask:payments-credit")).toBe(false);
    expect(recentlyLeft).toEqual([]);
  });

  it("counts it only in the context that would have drawn it", () => {
    const answer = actionItemsAnswer({ ...withRefusedAsk(), shows: (row) => row.placement.kind !== "placed" });
    expect(answer.withheld).toBe(0);
  });
});

describe("actionItemsAnswer — a card stopping the owner's work", () => {
  it("names it in a context that does not place it, as the page and voice triage show it", () => {
    const fixture = fileURLToPath(new URL("../../fixtures/hand-steps/recipe-stopped.json", import.meta.url));
    const steps = readHandSteps([JSON.parse(readFileSync(fixture, "utf8")) as unknown])!;
    const answer = actionItemsAnswer({
      ...allReady(),
      hands: ready<readonly HandStep[]>({ at: "2026-09-23T01:00:00.000Z", value: steps }),
      shows: (row) => row.placement.kind !== "placed",
    });
    expect([steps.length, answer.items.map((item) => item.key)]).toEqual([1, [`hand:${steps[0].id}`]]);
  });
});
