import { describe, expect, it } from "vitest";

import { err, ok } from "#lib/result.js";

import type { SlackWriteTransport } from "../../../../../corpus/slack/writeTransport.js";
import { liveTurnPoster, NO_MENTIONS } from "../../../../../live/turn/poster.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";
import {
  CARD_CHROME,
  CHROME,
  CLEAN_VERDICT,
  DM_MENTION,
  judge,
  minimalAnswer,
  NO_ROW,
  POSTED,
  PROVENANCE,
  READY,
  REPLY,
} from "./fixtures.js";
import { fakeTransport, home, type Recorded, usePosterHome } from "./harness.js";

usePosterHome();

describe("liveTurnPoster — settleReaction", () => {
  /**
   * The reaction moved OFF `postAnswer` and onto its own seam, and this pair of tests is the reason. It used
   * to fire only after a successful send, which left `:eyes:` — "seen, working on it" — standing over every
   * turn the door refused, every draft it held, and every session that died. Measured on a real
   * refused tag. `runTurn` now settles it on EVERY terminal path through `live/turn/indicators.ts`.
   */
  it("replaces the capture reaction with the completion one, on the ORIGINAL tagged message", async () => {
    const log: Recorded[] = [];
    const transport: SlackWriteTransport = {
      ...fakeTransport({ log }),
      addReaction: async ({ name, posted }) => {
        log.push({ detail: { name, posted }, method: "addReaction" });
        return true;
      },
      removeReaction: async ({ name, posted }) => {
        log.push({ detail: { name, posted }, method: "removeReaction" });
        return true;
      },
    };
    const poster = liveTurnPoster({
      doorLedger: memoryDoorLedger().port,
      identityRoster: NO_ROW,
      askIdentity: DM_MENTION,
      freshnessNote: undefined,
      verdict: CLEAN_VERDICT,
      chrome: CARD_CHROME,
      home,
      judge,
      mentions: NO_MENTIONS,
      provenance: PROVENANCE,
      readiness: READY,
      transport,
      turnChrome: CHROME,
      turnId: "turn-1",
    });

    const outcome = await poster.settleReaction({ reaction: "completion" });

    expect(outcome).toEqual(ok(undefined));
    expect(log.map((entry) => entry.method)).toEqual([
      "removeReaction",
      "removeReaction",
      "removeReaction",
      "removeReaction",
      "removeReaction",
      "addReaction",
    ]);
    const taggedMessage = { channel: DM_MENTION.channel, ts: DM_MENTION.messageTs };
    expect(log[0]!.detail).toEqual({ name: "hourglass_flowing_sand", posted: taggedMessage });
    expect(log[1]!.detail).toEqual({ name: "eyes", posted: taggedMessage });
    expect(log[2]!.detail).toEqual({ name: "warning", posted: taggedMessage });
    expect(log[3]!.detail).toEqual({ name: "ack", posted: taggedMessage });
    expect(log[4]!.detail).toEqual({ name: "for-a-human", posted: taggedMessage });
    expect(log[5]!.detail).toEqual({ name: "white_check_mark", posted: taggedMessage });
  });

  it("replaces it with the STOPPED reaction for a turn that ended without answering", async () => {
    const log: Recorded[] = [];
    const transport: SlackWriteTransport = {
      ...fakeTransport({ log }),
      addReaction: async ({ name, posted }) => {
        log.push({ detail: { name, posted }, method: "addReaction" });
        return true;
      },
      removeReaction: async ({ name, posted }) => {
        log.push({ detail: { name, posted }, method: "removeReaction" });
        return true;
      },
    };
    const poster = liveTurnPoster({
      doorLedger: memoryDoorLedger().port,
      identityRoster: NO_ROW,
      askIdentity: DM_MENTION,
      freshnessNote: undefined,
      verdict: CLEAN_VERDICT,
      chrome: CARD_CHROME,
      home,
      judge,
      mentions: NO_MENTIONS,
      provenance: PROVENANCE,
      readiness: READY,
      transport,
      turnChrome: CHROME,
      turnId: "turn-1",
    });

    const outcome = await poster.settleReaction({ reaction: "stopped" });

    expect(outcome).toEqual(ok(undefined));
    const taggedMessage = { channel: DM_MENTION.channel, ts: DM_MENTION.messageTs };
    expect(log.map((entry) => entry.method)).toEqual([
      "removeReaction",
      "removeReaction",
      "removeReaction",
      "removeReaction",
      "removeReaction",
      "addReaction",
    ]);
    expect(log[0]!.detail).toEqual({ name: "hourglass_flowing_sand", posted: taggedMessage });
    expect(log[1]!.detail).toEqual({ name: "eyes", posted: taggedMessage });
    expect(log[2]!.detail).toEqual({ name: "white_check_mark", posted: taggedMessage });
    expect(log[3]!.detail).toEqual({ name: "ack", posted: taggedMessage });
    expect(log[4]!.detail).toEqual({ name: "for-a-human", posted: taggedMessage });
    expect(log[5]!.detail).toEqual({ name: "warning", posted: taggedMessage });
  });

  /**
   * The catch block guards its read of
   * `error.message`/`String(error)` — a hostile rejection (a null-prototype object, where
   * `String(...)` itself throws `TypeError`) escaped the courtesy entirely and turned a successful send into
   * a rejected `postAnswer`. It now resolves with a REASON rather than throwing, which is what lets
   * finalisation report an unsettled reaction instead of restating a finished turn as a failure.
   */
  it("resolves with a reason rather than throwing on a HOSTILE, unstringifiable rejection", async () => {
    const log: Recorded[] = [];
    const transport: SlackWriteTransport = {
      ...fakeTransport({ log }),
      removeReaction: async () => {
        throw Object.create(null);
      },
    };
    const poster = liveTurnPoster({
      doorLedger: memoryDoorLedger().port,
      identityRoster: NO_ROW,
      askIdentity: DM_MENTION,
      freshnessNote: undefined,
      verdict: CLEAN_VERDICT,
      chrome: CARD_CHROME,
      home,
      judge,
      mentions: NO_MENTIONS,
      provenance: PROVENANCE,
      readiness: READY,
      transport,
      turnChrome: CHROME,
      turnId: "turn-1",
    });

    await expect(poster.settleReaction({ reaction: "stopped" })).resolves.toEqual(
      err("the reaction could not be settled"),
    );
  });

  it("is never touched by postAnswer itself — not on a send, not on a withhold", async () => {
    const log: Recorded[] = [];
    const transport: SlackWriteTransport = {
      ...fakeTransport({ log }),
      addReaction: async () => {
        throw new Error("postAnswer must not touch reactions");
      },
      postAssistantMessage: async () => POSTED,
      removeReaction: async () => {
        throw new Error("postAnswer must not touch reactions");
      },
    };
    const poster = liveTurnPoster({
      doorLedger: memoryDoorLedger().port,
      identityRoster: NO_ROW,
      askIdentity: DM_MENTION,
      freshnessNote: undefined,
      verdict: CLEAN_VERDICT,
      chrome: CARD_CHROME,
      home,
      judge,
      mentions: NO_MENTIONS,
      provenance: PROVENANCE,
      readiness: READY,
      transport,
      turnChrome: CHROME,
      turnId: "turn-1",
    });

    const outcome = await poster.postAnswer({
      answer: minimalAnswer(),
      askIdentity: DM_MENTION,
      documents: [],
      reply: REPLY,
      uploads: [],
    });

    expect(outcome).toEqual({ kind: "posted", missingMedia: [], ref: { channel: POSTED.channel, ts: POSTED.ts } });
  });
});
