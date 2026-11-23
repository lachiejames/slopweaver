/**
 * Unprompted help: every refusal in its order, the per-thread UTC-day budget, and the orchestrator's ORDER —
 * the `helped` row lands before any capture effect, under the lock, and nothing posts on a refusal.
 */
import { describe, expect, it } from "vitest";

import { err, ok, unwrap, unwrapErr } from "#lib/result.js";
import type { EmittedMention } from "../../../../live/listen/handoff.js";
import type { Mention } from "../../../../live/listen/mention.js";
import { WitnessJournalErrors } from "../../../../live/witness/errors.js";
import {
  helpWitness,
  planWitnessHelp,
  UNPROMPTED_HELP_DAILY_CAP,
  unpromptedHelpFor,
  type WitnessHelpDeps,
  type WitnessHelpFacts,
  type WitnessHelpRequest,
} from "../../../../live/witness/help.js";
import { WitnessHelpErrors } from "../../../../live/witness/helpErrors.js";
import {
  type WitnessJournalEvent,
  type WitnessKey,
  type WitnessOutcome,
  type WitnessSettledEvent,
  witnessIdOf,
} from "../../../../live/witness/types.js";

const ROOT = "1790662224.935389";
const NOW = "2026-09-30T00:39:00.000Z";
const KEY: WitnessKey = { channel: "C0SYN000002", messageTs: "1790728680.000100", threadTs: ROOT };
const REQUEST: WitnessHelpRequest = { key: KEY, text: "anything I can do to assist?", userId: "U0SYNTEAMMATE" };

/** Facts under which a help goes ahead. */
const WELCOME: WitnessHelpFacts = {
  alreadyAnAsk: false,
  ignored: undefined,
  ownThread: true,
  responder: { admitted: true },
  threadActiveAsk: undefined,
};

/** A message in the same thread at a later ts. */
function sibling({ messageTs }: { messageTs: string }): WitnessKey {
  return { ...KEY, messageTs };
}

/** A terminal row for one message. */
function settled({
  key,
  outcome,
  tsIso,
}: {
  key: WitnessKey;
  outcome: WitnessOutcome;
  tsIso: string;
}): WitnessSettledEvent {
  return { ...key, kind: "settled", outcome, schemaVersion: 1, tsIso, witnessId: witnessIdOf({ key }) };
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

/** Plan over a journal and facts. */
function plan({
  events = [],
  facts = WELCOME,
}: {
  events?: readonly WitnessJournalEvent[];
  facts?: WitnessHelpFacts;
}): ReturnType<typeof planWitnessHelp> {
  return planWitnessHelp({ events, facts, nowIso: NOW, request: REQUEST });
}

describe("planWitnessHelp", () => {
  it("plans the helped row for a welcome help", () => {
    expect(unwrap(plan({}))).toEqual({
      ...KEY,
      kind: "settled",
      outcome: "helped",
      schemaVersion: 1,
      tsIso: NOW,
      witnessId: witnessIdOf({ key: KEY }),
    });
  });

  it("refuses a message already helped", () => {
    const error = unwrapErr(plan({ events: [settled({ key: KEY, outcome: "helped", tsIso: NOW })] }));

    expect(error.code).toBe("ALREADY_SETTLED");
    expect(error.message).toContain("(helped)");
  });

  it("refuses a message a witness worker is already checking", () => {
    expect(unwrapErr(plan({ events: [dispatched({ key: KEY })] })).code).toBe("ALREADY_DISPATCHED");
  });

  it.each([
    ["a thread the bot was never tagged in", { ownThread: false }, "NOT_OWN_THREAD"],
    ["an asker off the whitelist", { responder: { admitted: false, why: "not listed" } }, "RESPONDER_REFUSED"],
    ["an ignored conversation", { ignored: "conversation" }, "IGNORED"],
    ["a message that is already an ask", { alreadyAnAsk: true }, "ALREADY_AN_ASK"],
    ["a thread with a live ask", { threadActiveAsk: "1790728600.000100" }, "THREAD_ASK_ACTIVE"],
  ] as const)("refuses %s", (_label, over, code) => {
    expect(unwrapErr(plan({ facts: { ...WELCOME, ...over } })).code).toBe(code);
  });

  it("names the first failing check when several fail", () => {
    expect(unwrapErr(plan({ facts: { ...WELCOME, alreadyAnAsk: true, ownThread: false } })).code).toBe(
      "NOT_OWN_THREAD",
    );
  });

  it("refuses a thread somebody stood the bot down in, before any fact is weighed", () => {
    const stoodDown: WitnessJournalEvent = {
      ...settled({ key: sibling({ messageTs: "1790728600.000100" }), outcome: "stood-down", tsIso: NOW }),
      why: "told it was in the way",
    };
    const error = unwrapErr(plan({ events: [stoodDown], facts: { ...WELCOME, ownThread: false } }));

    expect(error.code).toBe("THREAD_STOOD_DOWN");
    expect(error.message).toContain("1790728600.000100");
  });

  it("refuses on a stand-down written after another terminal on the same message, which the fold drops", () => {
    const earlier = sibling({ messageTs: "1790728600.000100" });
    const events: WitnessJournalEvent[] = [
      settled({ key: earlier, outcome: "nothing-checkable", tsIso: NOW }),
      { ...settled({ key: earlier, outcome: "stood-down", tsIso: NOW }), why: "told it was in the way" },
    ];

    expect(unwrapErr(plan({ events })).code).toBe("THREAD_STOOD_DOWN");
  });

  it("does not refuse on a stand-down in another thread", () => {
    const elsewhere: WitnessJournalEvent = {
      ...settled({
        key: { ...KEY, messageTs: "1790728600.000100", threadTs: "1790000000.000100" },
        outcome: "stood-down",
        tsIso: NOW,
      }),
      why: "told it was in the way",
    };

    expect(unwrap(plan({ events: [elsewhere] })).outcome).toBe("helped");
  });

  it("refuses once the thread spent today's helps", () => {
    const events = Array.from({ length: UNPROMPTED_HELP_DAILY_CAP }, (_unused, index) =>
      settled({ key: sibling({ messageTs: `179072860${String(index)}.000100` }), outcome: "helped", tsIso: NOW }),
    );
    const error = unwrapErr(plan({ events }));

    expect(error.code).toBe("HELP_BUDGET_SPENT");
    expect(error.message).toContain("already had 2 unprompted helps on 2026-09-30 (UTC)");
  });

  it("charges only helps in the same thread on the same UTC day", () => {
    const events = [
      settled({
        key: sibling({ messageTs: "1790728601.000100" }),
        outcome: "helped",
        tsIso: "2026-09-29T23:59:00.000Z",
      }),
      settled({
        key: { ...KEY, messageTs: "1790728602.000100", threadTs: "1790000000.000100" },
        outcome: "helped",
        tsIso: NOW,
      }),
      settled({ key: sibling({ messageTs: "1790728603.000100" }), outcome: "nothing-checkable", tsIso: NOW }),
      settled({ key: sibling({ messageTs: "1790728604.000100" }), outcome: "helped", tsIso: NOW }),
    ];

    expect(unwrap(plan({ events })).outcome).toBe("helped");
  });
});

describe("unpromptedHelpFor", () => {
  it("is true for a message with a helped row", () => {
    const events = [settled({ key: KEY, outcome: "helped", tsIso: NOW })];

    expect(unpromptedHelpFor({ channel: KEY.channel, events, messageTs: KEY.messageTs })).toBe(true);
  });

  it("is false for a message settled any other way, or never journalled", () => {
    const events = [settled({ key: KEY, outcome: "nothing-checkable", tsIso: NOW })];

    expect(unpromptedHelpFor({ channel: KEY.channel, events, messageTs: KEY.messageTs })).toBe(false);
    expect(unpromptedHelpFor({ channel: KEY.channel, events: [], messageTs: KEY.messageTs })).toBe(false);
  });
});

/** In-memory seams recording every effect in order, over a journal that persists across calls. */
function harness({
  captured = true,
  facts = WELCOME,
  journal = [],
  lockHeld = false,
  readFails = false,
  threadRefuses = false,
}: {
  captured?: boolean;
  facts?: WitnessHelpFacts;
  journal?: WitnessJournalEvent[];
  lockHeld?: boolean;
  readFails?: boolean;
  threadRefuses?: boolean;
}): { deps: WitnessHelpDeps; effects: string[]; journal: WitnessJournalEvent[]; mentions: Mention[] } {
  const effects: string[] = [];
  const mentions: Mention[] = [];
  const deps: WitnessHelpDeps = {
    append: ({ event }) => {
      effects.push(`append ${event.kind === "settled" ? event.outcome : event.kind}`);
      journal.push(event);
      return ok(undefined);
    },
    capture: async ({ mention }) => {
      effects.push("capture");
      mentions.push(mention);
      if (!captured) {
        return undefined;
      }
      const emitted: EmittedMention = {
        ...KEY,
        replyTarget: { channel: KEY.channel, threadTs: KEY.threadTs },
        started: { turnId: "t-1", workingTs: "1790728690.000100" },
        surface: "channel",
        text: mention.text,
        userId: mention.userId,
      };
      return emitted;
    },
    facts: () => {
      effects.push("facts");
      return ok(facts);
    },
    lock: () => {
      effects.push("lock");
      if (lockHeld) {
        return err("held by pid 4242");
      }
      return ok({ release: () => effects.push("release") });
    },
    nowIso: () => NOW,
    readJournal: () => {
      effects.push("read");
      return readFails ? err(WitnessJournalErrors.unreadable({ cause: "EACCES", path: "/j" })) : ok([...journal]);
    },
    thread: async () => {
      effects.push("thread");
      await Promise.resolve();
      return threadRefuses ? err(WitnessHelpErrors.noResponderTag({ key: KEY })) : ok(true);
    },
  };
  return { deps, effects, journal, mentions };
}

describe("helpWitness", () => {
  it("journals helped BEFORE the capture, under the lock, and emits the ask", async () => {
    const run = harness({});
    const helped = unwrap(await helpWitness({ deps: run.deps, request: REQUEST }));

    expect(run.effects).toEqual(["lock", "read", "facts", "thread", "append helped", "capture", "release"]);
    expect(helped.witnessId).toBe(witnessIdOf({ key: KEY }));
    expect(helped.emitted.started).toEqual({ turnId: "t-1", workingTs: "1790728690.000100" });
    expect(run.mentions).toEqual([
      { ...KEY, surface: "channel", text: "anything I can do to assist?", userId: "U0SYNTEAMMATE" },
    ]);
  });

  it("refuses a second help on the same message without touching Slack", async () => {
    const run = harness({});
    unwrap(await helpWitness({ deps: run.deps, request: REQUEST }));
    const again = unwrapErr(await helpWitness({ deps: run.deps, request: REQUEST }));

    expect(again.code).toBe("ALREADY_SETTLED");
    expect(run.effects.filter((effect) => effect === "capture")).toEqual(["capture"]);
  });

  it("writes nothing and captures nothing on a refusal, and still releases", async () => {
    const run = harness({ facts: { ...WELCOME, ownThread: false } });
    const error = unwrapErr(await helpWitness({ deps: run.deps, request: REQUEST }));

    expect(error.code).toBe("NOT_OWN_THREAD");
    expect(run.effects).toEqual(["lock", "read", "facts", "release"]);
  });

  it("journals and captures nothing when Slack's read of the thread refuses the help", async () => {
    const run = harness({ threadRefuses: true });
    const error = unwrapErr(await helpWitness({ deps: run.deps, request: REQUEST }));

    expect(error.code).toBe("NO_RESPONDER_TAG");
    expect(run.journal).toEqual([]);
    expect(run.effects).toEqual(["lock", "read", "facts", "thread", "release"]);
  });

  it("refuses HELP_LOCKED without reading anything while the lock is held", async () => {
    const run = harness({ lockHeld: true });
    const error = unwrapErr(await helpWitness({ deps: run.deps, request: REQUEST }));

    expect(error.code).toBe("HELP_LOCKED");
    expect(error.message).toContain("held by pid 4242");
    expect(run.effects).toEqual(["lock"]);
  });

  it("refuses on an unreadable journal before reading any other fact", async () => {
    const run = harness({ readFails: true });
    const error = unwrapErr(await helpWitness({ deps: run.deps, request: REQUEST }));

    expect(error.code).toBe("JOURNAL");
    expect(run.effects).toEqual(["lock", "read", "release"]);
  });

  it("reports a dropped capture with the helped row kept, so it is never retried", async () => {
    const run = harness({ captured: false });
    const error = unwrapErr(await helpWitness({ deps: run.deps, request: REQUEST }));

    expect(error.code).toBe("CAPTURE_DROPPED");
    expect(run.journal.map((event) => event.kind)).toEqual(["settled"]);
    expect(run.effects).toEqual(["lock", "read", "facts", "thread", "append helped", "capture", "release"]);
  });
});
