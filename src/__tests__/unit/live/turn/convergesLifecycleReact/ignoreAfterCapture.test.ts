/*
 * `turn ignore` over an ask already captured: what it plans, what it settles, and the on-disk fold that plan reads.
 * The two describes share the one measured ask.
 */
import { describe, expect, it } from "vitest";

import { ignoredAskIndicatorPlan } from "../../../../../cli/commands/turn/ignoreIndicators.js";
import { ok } from "../../../../../lib/result.js";
import type { AskLifecycle } from "../../../../../live/ask/lifecycle.js";
import { appendAskLifecycleEvent, capturedAskFor } from "../../../../../live/ask/store.js";
import { PENDING_ROUTE_STEPS, SUBAGENT_TURN_STEPS } from "../../../../../live/turn/answer.js";
import {
  finaliseIndicators,
  type IndicatorOutcome,
  type TerminalChecklist,
  type TerminalReaction,
} from "../../../../../live/turn/indicators.js";
import { liveIndicatorSeams } from "../../../../../live/turn/poster.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";
import { reactingTransport } from "../../../../reactingTransportFake.js";
import { CAPTURE, CHROME, PROVENANCE, STOPPED, tempHome, useTempHomes } from "./harness.js";

useTempHomes();

/** The exact ask the owner ignored after capture, from the measured DM. */
const IGNORED = { channel: "D_OWNER", messageTs: "1787544515.385579", threadTs: "1787544515.385579" };

describe("convergesLifecycleReact — ignore, after capture", () => {
  /**
   * Measured in the owner's own DM: `turn ignore` wrote its registry entry and stopped, so two
   * asks ignored after capture (`1787544515.385579`, `1787544578.512439`) kept the capture reaction and a
   * half-ticked checklist card standing over a decision that nothing would ever be worked on. Ignoring is a
   * terminal ending, so it now plans and settles its indicators like every other one.
   */
  function capturedEntry({ started }: { started: boolean }): AskLifecycle {
    return {
      capturedIso: "2026-08-24T14:20:00.000Z",
      channel: IGNORED.channel,
      lastEvent: { ...IGNORED, kind: "captured", surface: "dm", tsIso: "2026-08-24T14:20:00.000Z", userId: "U_OWNER" },
      messageTs: IGNORED.messageTs,
      state: "captured",
      surface: "channel",
      threadTs: IGNORED.threadTs,
      userId: "U_OWNER",
      ...(started ? { started: { turnId: "turn-9", workingTs: "1787544515.000900" } } : {}),
    };
  }

  it("plans nothing for an ask the listener never captured — it raised no indicator to correct", () => {
    const plan = ignoredAskIndicatorPlan({
      entry: undefined,
      messageTs: IGNORED.messageTs,
      reason: "answered offline",
    });

    expect(plan.kind).toBe("nothing-raised");
  });

  it("plans the standing card and the operator's reason for an ask ignored after capture", () => {
    const plan = ignoredAskIndicatorPlan({
      entry: capturedEntry({ started: true }),
      messageTs: IGNORED.messageTs,
      reason: "answered offline",
    });

    expect(plan).toEqual({
      kind: "settle",
      posted: { channel: "D_OWNER", ts: "1787544515.000900" },
      state: { kind: "ignored", readerReason: "answered offline", reason: "answered offline" },
      steps: PENDING_ROUTE_STEPS,
      turnId: "turn-9",
    });
  });

  it("falls back to a correlation id, and no card, for an ask whose checklist never posted", () => {
    const plan = ignoredAskIndicatorPlan({
      entry: capturedEntry({ started: false }),
      messageTs: IGNORED.messageTs,
      reason: "answered offline",
    });

    expect(plan).toEqual({
      kind: "settle",
      posted: undefined,
      state: { kind: "ignored", readerReason: "answered offline", reason: "answered offline" },
      steps: PENDING_ROUTE_STEPS,
      turnId: "ignore-1787544515.385579",
    });
  });

  it("settles a DISPATCHED ask against its own tier's steps, not the capture-time placeholder list", () => {
    const entry = capturedEntry({ started: true });
    const dispatched: AskLifecycle = {
      ...entry,
      lastEvent: {
        ...IGNORED,
        decision: {
          confidence: "high",
          needs: [],
          rationale: "a bounded investigation answers this",
          response: "respond",
          schemaVersion: 1,
          tier: "read-only-subagent",
          truthMode: "current",
        },
        kind: "dispatched",
        leaseExpiresAt: "2026-08-24T16:20:00.000Z",
        tier: "read-only-subagent",
        tsIso: "2026-08-24T14:21:00.000Z",
      },
      state: "dispatched",
      surface: "channel",
    };

    const plan = ignoredAskIndicatorPlan({
      entry: dispatched,
      messageTs: IGNORED.messageTs,
      reason: "answered offline",
    });

    expect(plan.kind === "settle" ? plan.steps : []).toEqual(SUBAGENT_TURN_STEPS);
  });

  it("stops the capture reaction and the half-ticked card, through the same seam every terminal uses", async () => {
    const applied: { checklist: TerminalChecklist | undefined; reaction: TerminalReaction | undefined } = {
      checklist: undefined,
      reaction: undefined,
    };

    const finalisation = await finaliseIndicators({
      seams: {
        endStatus: async (): Promise<IndicatorOutcome> => ok(undefined),
        settleChecklist: async ({ checklist }) => {
          applied.checklist = checklist;
          return true;
        },
        settleReaction: async ({ reaction }): Promise<IndicatorOutcome> => {
          applied.reaction = reaction;
          return ok(undefined);
        },
      },
      state: { kind: "ignored", readerReason: "answered offline", reason: "answered offline" },
    });

    expect(applied.reaction).toBe("stopped");
    expect(applied.checklist).toEqual({
      kind: "failed",
      reason: "this ask is being permanently ignored — answered offline",
    });
    expect(finalisation.checklistSettled).toBe(true);
    expect(finalisation.failures).toEqual([]);
  });

  it("converges the tagged message to the stopped reaction alone, over a standing capture reaction", async () => {
    const reactions = new Set<string>([CAPTURE]);
    const standing = new Map([[IGNORED.messageTs, reactions]]);
    const seams = liveIndicatorSeams({
      askIdentity: IGNORED,
      doorLedger: memoryDoorLedger().port,
      home: tempHome(),
      provenance: PROVENANCE,
      steps: PENDING_ROUTE_STEPS,
      task: "answering",
      transport: reactingTransport({ standing }),
      turnChrome: CHROME,
      turnId: "ignore-1787544515.385579",
    });

    await finaliseIndicators({
      seams,
      state: { kind: "ignored", readerReason: "answered offline", reason: "answered offline" },
    });

    expect([...reactions]).toEqual([STOPPED]);
  });
});

/** The fold the ignore plan reads is a real on-disk round trip, not a hand-built entry. */
describe("convergesLifecycleReact — the fold the ignore plan reads", () => {
  it("finds the captured ask a `turn ignore` is about", () => {
    const home = tempHome();
    appendAskLifecycleEvent({
      event: { ...IGNORED, kind: "captured", surface: "dm", tsIso: "2026-08-24T14:20:00.000Z", userId: "U_OWNER" },
      home,
    });

    const entry = capturedAskFor({ channel: IGNORED.channel, home, messageTs: IGNORED.messageTs });

    expect(entry?.state).toBe("captured");
  });

  it("finds nothing for an ask that was never captured", () => {
    expect(capturedAskFor({ channel: IGNORED.channel, home: tempHome(), messageTs: "1.1" })).toBeUndefined();
  });
});
