/*
 * The card tools resolve a key on the Queue first, then on the Alignment page: measured, a key resolved only among
 * the Queue's rows left every Alignment act unread on both surfaces.
 */
import { describe, expect, it } from "vitest";

import {
  type AlignmentCards,
  actFromPath,
  type CardToolPlan,
  cardToolPlan,
  NO_ALIGNMENT_CARDS,
} from "../../lib/cardToolPlan";
import type { QueueRow } from "../../lib/queueRows";
import { cardForVoice } from "../../lib/queueVoice";
import { ACT_ROWS, ALIGNMENT, FROM, QUEUE } from "./cardToolPlanFixture";

describe("cardToolPlan", () => {
  it("resolves a Queue card on the Queue, exactly as before", () => {
    const plan = cardToolPlan({
      alignment: ALIGNMENT,
      fromPath: FROM,
      key: "hand:acme-step",
      recentlyLeft: [],
      rows: QUEUE,
    })!;
    expect([plan.key, plan.page, plan.path, plan.removed]).toEqual([
      "hand:acme-step",
      "queue",
      "/queue?open=hand%3Aacme-step&context=work&by=voice",
      undefined,
    ]);
    // Read off the work view, where the default rule's self card is not drawn, so the voice says whose it is.
    const own = cardForVoice({ row: QUEUE[0] });
    expect(plan.card).toEqual({
      ...own,
      mark: {
        label: `the self workspace's card · ${own.mark!.label}`,
        title: `drawn only in that workspace's view, not this one · ${own.mark!.title}`,
      },
    });
  });

  it("resolves an Alignment act as the console's card, opened on the Alignment page", () => {
    const plan = cardToolPlan({
      alignment: ALIGNMENT,
      fromPath: FROM,
      key: "act:acme-act-1",
      recentlyLeft: [],
      rows: QUEUE,
    })!;
    expect([plan.key, plan.page, plan.path, plan.removed, plan.firstPage]).toEqual([
      "act:acme-act-1",
      "alignment",
      "/alignment?open=act%3Aacme-act-1&context=work&by=voice",
      undefined,
      undefined,
    ]);
    expect(plan.card).toEqual(cardForVoice({ row: ACT_ROWS[0] }));
  });

  it("says whose an Alignment act is when the view the owner's address names does not draw it", () => {
    const team: QueueRow = { ...ACT_ROWS[0], placement: { by: [], kind: "placed", workspace: "team" } };
    const markOn = ({ fromPath }: { fromPath: string }): unknown =>
      (
        cardToolPlan({
          alignment: { ...ALIGNMENT, acts: [team] },
          fromPath,
          key: team.key,
          recentlyLeft: [],
          rows: [],
        })!.card as { mark: unknown }
      ).mark;
    expect(markOn({ fromPath: "/alignment?context=slopweaver" })).toEqual({
      label: "the team workspace's card",
      title: "drawn only in that workspace's view, not this one",
    });
    expect(markOn({ fromPath: "/alignment?context=work" })).toBeUndefined();
  });

  it("resolves no card for an old voice question's key: the page asks no voice question, only history names one", () => {
    expect(
      cardToolPlan({
        alignment: ALIGNMENT,
        fromPath: "/alignment",
        key: "align:voice-tagging",
        recentlyLeft: [],
        rows: QUEUE,
      }),
    ).toBe(undefined);
  });

  // A press here hides the act on the page at once, before the registers it was projected from re-read.
  it("resolves nothing for an act a press in this window just settled, and its sibling as before", () => {
    const settled = { ...ALIGNMENT, settled: ["act:acme-act-1"] };
    const plan = ({ key }: { key: string }): CardToolPlan | undefined =>
      cardToolPlan({ alignment: settled, fromPath: FROM, key, recentlyLeft: [], rows: QUEUE });
    expect(plan({ key: "act:acme-act-1" })).toBe(undefined);
    expect(plan({ key: "act:acme-act-2" })!.key).toBe("act:acme-act-2");
  });

  // An older act settled from a stale snapshot was still reached as an alias of the newer act.
  it("resolves nothing for a settled key that a newer, open act folds as an alias", () => {
    const acts = [{ ...ACT_ROWS[0], aliases: ["act:acme-old"] }];
    const plan = ({ settled }: { settled: readonly string[] }): CardToolPlan | undefined =>
      cardToolPlan({
        alignment: { ...ALIGNMENT, acts, settled },
        fromPath: FROM,
        key: "act:acme-old",
        recentlyLeft: [],
        rows: QUEUE,
      });
    expect(plan({ settled: [] })!.key).toBe("act:acme-act-1");
    expect(plan({ settled: ["act:acme-old"] })).toBe(undefined);
  });

  it("resolves nothing for a padded key, an unknown one, or an Alignment key with no Alignment cards given", () => {
    const plan = (input: { key: string; alignment: AlignmentCards }): unknown =>
      cardToolPlan({ ...input, fromPath: FROM, recentlyLeft: [], rows: QUEUE });
    expect([
      plan({ alignment: ALIGNMENT, key: " act:acme-act-1" }),
      plan({ alignment: ALIGNMENT, key: "act:acme-gone" }),
      plan({ alignment: NO_ALIGNMENT_CARDS, key: "act:acme-act-1" }),
    ]).toEqual([undefined, undefined, undefined]);
  });
});

// The Alignment page draws only the acts the owner's context shows, and draws nothing in a hidden one's place.
describe("actFromPath", () => {
  const act = ({ id }: { id: string }): QueueRow => ACT_ROWS.find((row) => row.key === `act:${id}`)!;

  it("keeps the owner's address when their context draws the act", () => {
    expect(actFromPath({ fromPath: FROM, row: act({ id: "acme-act-1" }) })).toBe(FROM);
  });

  it("switches to the context that draws an act the owner's own hides, every other choice kept", () => {
    expect([
      actFromPath({ fromPath: FROM, row: act({ id: "acme-act-2" }) }),
      actFromPath({ fromPath: "/queue?context=slopweaver&rail=icons", row: act({ id: "acme-act-1" }) }),
    ]).toEqual(["/queue?context=slopweaver&view=board", "/queue?context=work&rail=icons"]);
  });

  it("opens the hidden act on the Alignment page in the context that draws it", () => {
    const plan = cardToolPlan({
      alignment: ALIGNMENT,
      fromPath: FROM,
      key: "act:acme-act-2",
      recentlyLeft: [],
      rows: QUEUE,
    })!;
    expect(plan.path).toBe("/alignment?open=act%3Aacme-act-2&context=slopweaver&by=voice");
  });
});
