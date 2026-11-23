/**
 * Standing down: the planners' refusals, the thread-wide read every consumer asks, and the orchestrators' ORDER
 * — the message form's reaction goes on BEFORE the row, under the lock, and a failed or thrown reaction journals
 * nothing; the whole-thread form reacts on nothing at all.
 */
import { describe, expect, it } from "vitest";

import { err, ok, unwrap, unwrapErr } from "#lib/result.js";
import { WitnessJournalErrors } from "../../../../live/witness/errors.js";
import { foldWitnessJournal } from "../../../../live/witness/journal.js";
import {
  planThreadStandDown,
  planWitnessStandDown,
  standDownThread,
  standDownWhere,
  standDownWitness,
  threadStandDown,
  type WitnessStandDownDeps,
  type WitnessStandDownRequest,
  type WitnessThreadStandDownRequest,
} from "../../../../live/witness/standDown.js";
import {
  threadStandDownIdOf,
  type WitnessJournalEvent,
  type WitnessKey,
  type WitnessOutcome,
  type WitnessSettledEvent,
  type WitnessThreadStoodDownEvent,
  witnessIdOf,
} from "../../../../live/witness/types.js";

const ROOT = "1790662224.935389";
const NOW = "2026-10-13T22:10:00.000Z";
const KEY: WitnessKey = { channel: "C0SYN000002", messageTs: "1790728680.000100", threadTs: ROOT };
const ROOT_KEY: WitnessKey = { ...KEY, messageTs: ROOT };
const REQUEST: WitnessStandDownRequest = { key: KEY, why: "  told the bot it was in the way  " };
const THREAD_REQUEST: WitnessThreadStandDownRequest = {
  channel: KEY.channel,
  threadTs: ROOT,
  why: " owner: stop witnessing it ",
};
const THREAD_ID = threadStandDownIdOf({ channel: KEY.channel, threadTs: ROOT });
const THREAD_ROW: WitnessThreadStoodDownEvent = {
  channel: KEY.channel,
  kind: "thread-stood-down",
  schemaVersion: 1,
  standDownId: THREAD_ID,
  threadTs: ROOT,
  tsIso: NOW,
  why: "owner: stop witnessing it",
};

/** A terminal row for one message. */
function settled({ key, outcome }: { key: WitnessKey; outcome: WitnessOutcome }): WitnessSettledEvent {
  return { ...key, kind: "settled", outcome, schemaVersion: 1, tsIso: NOW, why: "w", witnessId: witnessIdOf({ key }) };
}

/** A live worker row for one message. */
function dispatched({ key }: { key: WitnessKey }): WitnessJournalEvent {
  return {
    ...key,
    host: "claude-code",
    kind: "dispatched",
    model: "sonnet",
    schemaVersion: 1,
    surfaceId: "s-1",
    surfaceRef: "surface:1",
    text: "resolved",
    tsIso: NOW,
    witnessId: witnessIdOf({ key }),
    workspaceId: "w-1",
    workspaceRef: "workspace:1",
  };
}

/** Plan over a journal. */
function plan({
  events = [],
  request = REQUEST,
}: {
  events?: readonly WitnessJournalEvent[];
  request?: WitnessStandDownRequest;
}): ReturnType<typeof planWitnessStandDown> {
  return planWitnessStandDown({ current: foldWitnessJournal({ events }), nowIso: NOW, request });
}

describe("planWitnessStandDown", () => {
  it("plans a stood-down row carrying the trimmed why", () => {
    expect(unwrap(plan({}))).toEqual({
      kind: "record",
      row: {
        ...KEY,
        kind: "settled",
        outcome: "stood-down",
        schemaVersion: 1,
        tsIso: NOW,
        why: "told the bot it was in the way",
        witnessId: witnessIdOf({ key: KEY }),
      },
    });
  });

  it("answers already on a message that is stood down", () => {
    expect(unwrap(plan({ events: [settled({ key: KEY, outcome: "stood-down" })] }))).toEqual({
      kind: "already",
      witnessId: witnessIdOf({ key: KEY }),
    });
  });

  it("refuses a message that already ended another way", () => {
    const error = unwrapErr(plan({ events: [settled({ key: KEY, outcome: "helped" })] }));

    expect(error.code).toBe("ALREADY_SETTLED");
    expect(error.message).toContain("helped");
  });

  it("refuses a message a witness worker is live on", () => {
    expect(unwrapErr(plan({ events: [dispatched({ key: KEY })] })).code).toBe("ALREADY_DISPATCHED");
  });

  it("refuses a blank why, which would write a row the journal's reader refuses", () => {
    const blank = plan({ request: { key: KEY, why: "  " } });

    expect(unwrapErr(blank).code).toBe("WHY_BLANK");
  });

  it("names the whole-thread form in the already-settled refusal, so the next session has a way through", () => {
    const error = unwrapErr(plan({ events: [settled({ key: KEY, outcome: "nothing-checkable" })] }));

    expect(error.message).toContain("without --message-ts");
  });
});

/** Plan a whole-thread stand-down over a journal. */
function planThread({
  events = [],
}: {
  events?: readonly WitnessJournalEvent[];
}): ReturnType<typeof planThreadStandDown> {
  return planThreadStandDown({ events, nowIso: NOW, request: THREAD_REQUEST });
}

describe("planThreadStandDown", () => {
  it("plans a thread-stood-down row tied to no message when every message that said stop already ended", () => {
    expect(unwrap(planThread({ events: [settled({ key: KEY, outcome: "nothing-checkable" })] }))).toEqual({
      kind: "record",
      row: THREAD_ROW,
    });
  });

  it.each([
    ["settled", settled({ key: ROOT_KEY, outcome: "nothing-checkable" })],
    ["live", dispatched({ key: ROOT_KEY })],
  ] as const)(
    "still plans the row when the thread's root witness is %s, which a root-keyed row would collide with",
    (_label, root) => {
      expect(unwrap(planThread({ events: [root] }))).toEqual({ kind: "record", row: THREAD_ROW });
    },
  );

  it("answers already with the standing row when another message stood the thread down", () => {
    const standing = settled({ key: KEY, outcome: "stood-down" });

    expect(unwrap(planThread({ events: [standing] }))).toEqual({ kind: "already", row: standing });
  });

  it("answers already on a re-run over its own row", () => {
    expect(unwrap(planThread({ events: [THREAD_ROW] }))).toEqual({ kind: "already", row: THREAD_ROW });
  });

  it("ignores a stand-down in another thread", () => {
    const events = [settled({ key: { ...KEY, threadTs: "1790000000.000100" }, outcome: "stood-down" })];

    expect(unwrap(planThread({ events })).kind).toBe("record");
  });

  it("refuses a blank why", () => {
    const blank = planThreadStandDown({ events: [], nowIso: NOW, request: { ...THREAD_REQUEST, why: " " } });

    expect(unwrapErr(blank).code).toBe("WHY_BLANK");
  });
});

describe("standDownWhere", () => {
  it("names the message a message-scope row reacted on", () => {
    expect(standDownWhere({ row: settled({ key: KEY, outcome: "stood-down" }) })).toBe("message 1790728680.000100");
  });

  it("names the whole thread and when, for a row tied to no message", () => {
    expect(standDownWhere({ row: THREAD_ROW })).toBe(`the whole thread at ${NOW}`);
  });
});

describe("threadStandDown", () => {
  const sibling: WitnessKey = { ...KEY, messageTs: "1790728600.000100" };
  const later: WitnessKey = { ...KEY, messageTs: "1790728700.000100" };
  const elsewhere: WitnessKey = { ...KEY, threadTs: "1790000000.000100" };

  it("names the thread's first stand-down, whichever message it landed on", () => {
    const events = [settled({ key: sibling, outcome: "stood-down" }), settled({ key: later, outcome: "stood-down" })];

    expect(threadStandDown({ channel: KEY.channel, events, threadTs: ROOT })).toEqual(events[0]);
  });

  it("finds a whole-thread row, and takes whichever form landed first", () => {
    const messageRow = settled({ key: sibling, outcome: "stood-down" });

    expect(threadStandDown({ channel: KEY.channel, events: [THREAD_ROW, messageRow], threadTs: ROOT })).toEqual(
      THREAD_ROW,
    );
  });

  it("is undefined for a whole-thread row in another thread", () => {
    const events = [{ ...THREAD_ROW, standDownId: "t-x", threadTs: "1790000000.000100" }];

    expect(threadStandDown({ channel: KEY.channel, events, threadTs: ROOT })).toBe(undefined);
  });

  it("is undefined for a thread with only other outcomes, or a stand-down in another thread", () => {
    const events = [settled({ key: sibling, outcome: "helped" }), settled({ key: elsewhere, outcome: "stood-down" })];

    expect(threadStandDown({ channel: KEY.channel, events, threadTs: ROOT })).toBe(undefined);
  });

  it("is undefined for the same thread ts in another channel", () => {
    const events = [settled({ key: { ...KEY, channel: "C0OTHER" }, outcome: "stood-down" })];

    expect(threadStandDown({ channel: KEY.channel, events, threadTs: ROOT })).toBe(undefined);
  });
});

/** In-memory seams recording every effect in order, over a journal that persists across calls. */
function harness({
  journal = [],
  lockHeld = false,
  react = "on",
  readFails = false,
}: {
  journal?: WitnessJournalEvent[];
  lockHeld?: boolean;
  react?: "on" | "declined" | "throws";
  readFails?: boolean;
}): { deps: WitnessStandDownDeps; effects: string[]; journal: WitnessJournalEvent[] } {
  const effects: string[] = [];
  const deps: WitnessStandDownDeps = {
    append: ({ event }) => {
      effects.push(`append ${event.kind === "settled" ? event.outcome : event.kind}`);
      journal.push(event);
      return ok(undefined);
    },
    emoji: "zipper_mouth_face",
    lock: () => {
      effects.push("lock");
      if (lockHeld) {
        return err("held by pid 4242");
      }
      return ok({ release: () => effects.push("release") });
    },
    nowIso: () => NOW,
    react: async ({ emoji, key }) => {
      effects.push(`react ${emoji} ${key.messageTs}`);
      await Promise.resolve();
      if (react === "throws") {
        throw new Error("invalid_name");
      }
      return react === "on";
    },
    readJournal: () => {
      effects.push("read");
      return readFails ? err(WitnessJournalErrors.unreadable({ cause: "EACCES", path: "/j" })) : ok([...journal]);
    },
  };
  return { deps, effects, journal };
}

describe("standDownWitness", () => {
  it("reacts BEFORE journalling, under the lock, and posts nothing", async () => {
    const run = harness({});
    const stood = unwrap(await standDownWitness({ deps: run.deps, request: REQUEST }));

    expect(run.effects).toEqual([
      "lock",
      "read",
      "react zipper_mouth_face 1790728680.000100",
      "append stood-down",
      "release",
    ]);
    expect(stood).toEqual({ already: false, emoji: "zipper_mouth_face", witnessId: witnessIdOf({ key: KEY }) });
  });

  it("does nothing on a re-run and says already", async () => {
    const run = harness({});
    unwrap(await standDownWitness({ deps: run.deps, request: REQUEST }));
    const again = unwrap(await standDownWitness({ deps: run.deps, request: REQUEST }));

    expect(again.already).toBe(true);
    expect(run.journal).toHaveLength(1);
    expect(run.effects.filter((effect) => effect.startsWith("react"))).toEqual([
      "react zipper_mouth_face 1790728680.000100",
    ]);
  });

  it.each([
    ["declines", "declined", "Slack declined the reaction"],
    ["throws", "throws", "invalid_name"],
  ] as const)("journals nothing when the reaction %s, and still releases", async (_label, react, why) => {
    const run = harness({ react });
    const error = unwrapErr(await standDownWitness({ deps: run.deps, request: REQUEST }));

    expect(error.code).toBe("REACTION_FAILED");
    expect(error.message).toContain(why);
    expect(error.message).toContain("slackBot.standDownReaction.emoji");
    expect(run.journal).toEqual([]);
    expect(run.effects.at(-1)).toBe("release");
  });

  it("reacts on nothing when the message already ended another way", async () => {
    const run = harness({ journal: [settled({ key: KEY, outcome: "posted" })] });
    const error = unwrapErr(await standDownWitness({ deps: run.deps, request: REQUEST }));

    expect(error.code).toBe("ALREADY_SETTLED");
    expect(run.effects).toEqual(["lock", "read", "release"]);
  });

  it("refuses STAND_DOWN_LOCKED without reading anything while the lock is held", async () => {
    const run = harness({ lockHeld: true });
    const error = unwrapErr(await standDownWitness({ deps: run.deps, request: REQUEST }));

    expect(error.code).toBe("STAND_DOWN_LOCKED");
    expect(error.message).toContain("held by pid 4242");
    expect(run.effects).toEqual(["lock"]);
  });

  it("refuses on an unreadable journal before reacting", async () => {
    const run = harness({ readFails: true });

    expect(unwrapErr(await standDownWitness({ deps: run.deps, request: REQUEST })).code).toBe("JOURNAL");
    expect(run.effects).toEqual(["lock", "read", "release"]);
  });
});

describe("standDownThread", () => {
  it("journals the whole-thread row under the lock, reacting on nothing, and the thread-wide read finds it", async () => {
    const run = harness({ journal: [settled({ key: KEY, outcome: "nothing-checkable" })], react: "throws" });
    const stood = unwrap(await standDownThread({ deps: run.deps, request: THREAD_REQUEST }));

    expect(run.effects).toEqual(["lock", "read", "append thread-stood-down", "release"]);
    expect(stood).toEqual({ already: false, id: THREAD_ID });
    expect(threadStandDown({ channel: KEY.channel, events: run.journal, threadTs: ROOT })).toEqual(THREAD_ROW);
  });

  it("does nothing on a re-run and says already, naming its own row", async () => {
    const run = harness({});
    unwrap(await standDownThread({ deps: run.deps, request: THREAD_REQUEST }));
    const again = unwrap(await standDownThread({ deps: run.deps, request: THREAD_REQUEST }));

    expect(again).toEqual({ already: true, id: THREAD_ID });
    expect(run.journal).toHaveLength(1);
  });

  it("says already with the message row's witness id when a message stood the thread down first", async () => {
    const run = harness({ journal: [settled({ key: KEY, outcome: "stood-down" })] });

    expect(unwrap(await standDownThread({ deps: run.deps, request: THREAD_REQUEST }))).toEqual({
      already: true,
      id: witnessIdOf({ key: KEY }),
    });
  });

  it("refuses STAND_DOWN_LOCKED without reading anything while the lock is held", async () => {
    const run = harness({ lockHeld: true });

    expect(unwrapErr(await standDownThread({ deps: run.deps, request: THREAD_REQUEST })).code).toBe(
      "STAND_DOWN_LOCKED",
    );
    expect(run.effects).toEqual(["lock"]);
  });

  it("refuses on an unreadable journal and still releases", async () => {
    const run = harness({ readFails: true });

    expect(unwrapErr(await standDownThread({ deps: run.deps, request: THREAD_REQUEST })).code).toBe("JOURNAL");
    expect(run.effects).toEqual(["lock", "read", "release"]);
  });
});
