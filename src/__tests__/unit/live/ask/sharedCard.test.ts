/**
 * One progress card, two asks — `live/ask/sharedCard.ts`.
 *
 * The shape under test is a thread in `#proj-acme-review`: the owner's tag (the PARENT,
 * the newer message) and the earlier question it asked the bot to answer (the CHILD, dispatched from inside
 * the parent's turn). Ids are the incident's own; the channel is synthetic.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { AskLifecycleEvent } from "../../../../live/ask/lifecycle.js";
import { askLifecycleEventLine, askLifecycleKey } from "../../../../live/ask/lifecycle.js";
import {
  cardStaysForAnotherAsk,
  cardWriter,
  mayWriteCardOnDisk,
  otherOpenCardHolders,
  parentCardFor,
  releasedCardKeys,
} from "../../../../live/ask/sharedCard.js";
import { askLifecyclePath } from "../../../../live/ask/store.js";

const THREAD = "1790137657.683209";
const PARENT = { channel: "C1", messageTs: "1790146101.489459", threadTs: THREAD };
const CHILD = { channel: "C1", messageTs: "1790141967.816599", threadTs: THREAD };
const CARD = { turnId: "turn-1790146109374", workingTs: "1790146110.096759" };
const AT = "2026-09-23T00:00:00.000Z";

function captured({ ask }: { ask: typeof PARENT }): AskLifecycleEvent {
  return { ...ask, kind: "captured", surface: "channel", tsIso: AT, userId: "U0OWNER" };
}

function attached({ ask, card = CARD }: { ask: typeof PARENT; card?: typeof CARD }): AskLifecycleEvent {
  return { ...ask, kind: "checklist-posted", tsIso: AT, ...card };
}

function answered({ ask }: { ask: typeof PARENT }): AskLifecycleEvent {
  return { ...ask, answerTs: "1790146300.000100", kind: "answered", tsIso: AT };
}

/** The ride as the log holds it: both captured, the parent's card posted, the child attached to it second. */
const RIDDEN: readonly AskLifecycleEvent[] = [
  captured({ ask: CHILD }),
  captured({ ask: PARENT }),
  attached({ ask: PARENT }),
  attached({ ask: CHILD }),
];

describe("otherOpenCardHolders", () => {
  it("names the other open ask on the card, never the settling ask itself", () => {
    expect(otherOpenCardHolders({ askIdentity: PARENT, events: RIDDEN, workingTs: CARD.workingTs })).toEqual([CHILD]);
    expect(otherOpenCardHolders({ askIdentity: CHILD, events: RIDDEN, workingTs: CARD.workingTs })).toEqual([PARENT]);
  });

  it("drops a holder that has ended, so the last one out is the one that deletes", () => {
    const events = [...RIDDEN, answered({ ask: CHILD })];
    expect(otherOpenCardHolders({ askIdentity: PARENT, events, workingTs: CARD.workingTs })).toEqual([]);
  });

  it("keeps a holder ended ONCE even when a redelivered captured follows its answer", () => {
    const events = [...RIDDEN, answered({ ask: CHILD }), captured({ ask: CHILD })];
    expect(otherOpenCardHolders({ askIdentity: PARENT, events, workingTs: CARD.workingTs })).toEqual([]);
  });

  it("does not count an ask in another channel, or one holding a different card", () => {
    const elsewhere = { ...CHILD, channel: "C2" };
    const events = [
      captured({ ask: PARENT }),
      attached({ ask: PARENT }),
      captured({ ask: elsewhere }),
      attached({ ask: elsewhere }),
      captured({ ask: CHILD }),
      attached({ ask: CHILD, card: { turnId: "turn-other", workingTs: "1790146216.256649" } }),
    ];
    expect(otherOpenCardHolders({ askIdentity: PARENT, events, workingTs: CARD.workingTs })).toEqual([]);
  });
});

describe("cardWriter", () => {
  it("hands the pen to the ask that attached LAST, which is the child even though its message is older", () => {
    expect(cardWriter({ channel: "C1", events: RIDDEN, workingTs: CARD.workingTs })).toBe(
      askLifecycleKey({ askIdentity: CHILD }),
    );
  });

  it("hands it back to the parent once the child has ended", () => {
    const events = [...RIDDEN, answered({ ask: CHILD })];
    expect(cardWriter({ channel: "C1", events, workingTs: CARD.workingTs })).toBe(
      askLifecycleKey({ askIdentity: PARENT }),
    );
  });

  it("answers undefined when no open ask records the card", () => {
    const events = [...RIDDEN, answered({ ask: CHILD }), answered({ ask: PARENT })];
    expect(cardWriter({ channel: "C1", events, workingTs: CARD.workingTs })).toBeUndefined();
    expect(cardWriter({ channel: "C2", events: RIDDEN, workingTs: CARD.workingTs })).toBeUndefined();
  });
});

/** A child attempt that failed — the worker never started, or died — with the ask still recoverable. */
function failed({ ask }: { ask: typeof PARENT }): AskLifecycleEvent {
  return { ...ask, kind: "failed", reason: "no Slack bot token configured", tsIso: AT };
}

describe("a failed attempt releases the card", () => {
  it("hands the pen and the cleanup back to the parent while the child's latest event is a failure", () => {
    const events = [...RIDDEN, failed({ ask: CHILD })];
    expect(releasedCardKeys({ events })).toEqual(new Set([askLifecycleKey({ askIdentity: CHILD })]));
    expect(cardWriter({ channel: "C1", events, workingTs: CARD.workingTs })).toBe(
      askLifecycleKey({ askIdentity: PARENT }),
    );
    expect(otherOpenCardHolders({ askIdentity: PARENT, events, workingTs: CARD.workingTs })).toEqual([]);
  });

  it("takes the card back when the child is dispatched again", () => {
    const redispatched: AskLifecycleEvent = {
      ...CHILD,
      kind: "redispatched",
      reason: "stranded",
      strandedAs: "failed",
      tsIso: AT,
    };
    const events = [...RIDDEN, failed({ ask: CHILD }), redispatched];
    expect(releasedCardKeys({ events })).toEqual(new Set());
    expect(cardWriter({ channel: "C1", events, workingTs: CARD.workingTs })).toBe(
      askLifecycleKey({ askIdentity: CHILD }),
    );
  });
});

describe("cardWriter after a holder moves to a card of its own", () => {
  it("hands the old card's pen back to the parent the moment the child attaches elsewhere", () => {
    const moved = attached({ ask: CHILD, card: { turnId: "turn-other", workingTs: "1790146216.256649" } });
    const events = [...RIDDEN, moved];
    expect(cardWriter({ channel: "C1", events, workingTs: CARD.workingTs })).toBe(
      askLifecycleKey({ askIdentity: PARENT }),
    );
    expect(cardWriter({ channel: "C1", events, workingTs: "1790146216.256649" })).toBe(
      askLifecycleKey({ askIdentity: CHILD }),
    );
  });
});

describe("parentCardFor", () => {
  const before = [captured({ ask: CHILD }), captured({ ask: PARENT }), attached({ ask: PARENT })];

  it("rides the open parent's standing card, although the parent is the NEWER message", () => {
    expect(parentCardFor({ askIdentity: CHILD, events: before, parentMessageTs: PARENT.messageTs })).toEqual({
      kind: "ride",
      started: CARD,
    });
  });

  it("posts, and says so, when the brief names its own ask", () => {
    expect(parentCardFor({ askIdentity: CHILD, events: before, parentMessageTs: CHILD.messageTs })).toEqual({
      kind: "post",
      reason: "the brief names its own ask C1/1790141967.816599 as the one it rides",
    });
  });

  it("posts when the parent was never captured", () => {
    expect(parentCardFor({ askIdentity: CHILD, events: before, parentMessageTs: "1790146999.000100" })).toEqual({
      kind: "post",
      reason: "the ask it rides, C1/1790146999.000100, was never captured",
    });
  });

  it("posts when the parent sits in a different thread", () => {
    const events = [captured({ ask: { ...PARENT, threadTs: "1790000000.000100" } }), attached({ ask: PARENT })];
    expect(parentCardFor({ askIdentity: CHILD, events, parentMessageTs: PARENT.messageTs })).toEqual({
      kind: "post",
      reason: "the ask it rides, C1/1790146101.489459, is in a different thread",
    });
  });

  it("posts when the parent has no card", () => {
    const events = [captured({ ask: CHILD }), captured({ ask: PARENT })];
    expect(parentCardFor({ askIdentity: CHILD, events, parentMessageTs: PARENT.messageTs })).toEqual({
      kind: "post",
      reason: "the ask it rides, C1/1790146101.489459, has no progress card",
    });
  });

  it("rides the answered parent's card while another sub-ask still holds it standing", () => {
    const third = { channel: "C1", messageTs: "1790141999.000100", threadTs: THREAD };
    const events = [...RIDDEN, answered({ ask: PARENT }), captured({ ask: third })];
    expect(parentCardFor({ askIdentity: third, events, parentMessageTs: PARENT.messageTs })).toEqual({
      kind: "ride",
      started: CARD,
    });
  });

  it("rides whatever state the parent's ask is in — failed, answered — and leaves the card's fate to Slack", () => {
    const afterFailure = [...before, failed({ ask: PARENT })];
    const afterAnswer = [...before, answered({ ask: PARENT })];
    const ride = { kind: "ride", started: CARD };
    expect(parentCardFor({ askIdentity: CHILD, events: afterFailure, parentMessageTs: PARENT.messageTs })).toEqual(
      ride,
    );
    expect(parentCardFor({ askIdentity: CHILD, events: afterAnswer, parentMessageTs: PARENT.messageTs })).toEqual(ride);
  });
});

describe("mayWriteCardOnDisk fails closed on a log it cannot read", () => {
  const homes: string[] = [];
  afterEach(() => {
    for (const home of homes.splice(0)) {
      rmSync(home, { force: true, recursive: true });
    }
  });
  const freshHome = (): string => {
    const home = mkdtempSync(join(tmpdir(), "shared-card-"));
    homes.push(home);
    mkdirSync(dirname(askLifecyclePath({ home })), { recursive: true });
    return home;
  };

  it("lets the last-attached holder write and refuses the older one over a readable log", () => {
    const home = freshHome();
    writeFileSync(askLifecyclePath({ home }), RIDDEN.map((event) => askLifecycleEventLine({ event })).join("\n"));
    expect(mayWriteCardOnDisk({ askIdentity: CHILD, home, workingTs: CARD.workingTs })).toBe(true);
    expect(mayWriteCardOnDisk({ askIdentity: PARENT, home, workingTs: CARD.workingTs })).toBe(false);
  });

  it("lets any ask write when there is no log at all", () => {
    expect(mayWriteCardOnDisk({ askIdentity: PARENT, home: freshHome(), workingTs: CARD.workingTs })).toBe(true);
  });

  it("refuses the write when the log exists but cannot be read", () => {
    const home = freshHome();
    mkdirSync(askLifecyclePath({ home }));
    expect(mayWriteCardOnDisk({ askIdentity: PARENT, home, workingTs: CARD.workingTs })).toBe(false);
  });

  it("leaves the card standing for a settle when the log exists but cannot be read", () => {
    const home = freshHome();
    mkdirSync(askLifecyclePath({ home }));
    expect(cardStaysForAnotherAsk({ askIdentity: PARENT, home, what: "finalize", workingTs: CARD.workingTs })).toBe(
      true,
    );
  });

  it("lets the sole holder settle its card when there is no log at all", () => {
    expect(
      cardStaysForAnotherAsk({ askIdentity: PARENT, home: freshHome(), what: "finalize", workingTs: CARD.workingTs }),
    ).toBe(false);
  });
});
