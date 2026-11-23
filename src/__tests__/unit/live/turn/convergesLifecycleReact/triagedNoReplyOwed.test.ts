/*
 * An ask triaged with no reply owed: the plan, the `:ack:` ending neither the tick nor the warning could say
 * truthfully, the two measured reproductions, and retiring `:ack:` when the ask is later answered for real.
 */
import { describe, expect, it } from "vitest";

import {
  settleTriagedAskIndicators,
  triagedAskIndicatorPlan,
} from "../../../../../cli/commands/turn/triagedIndicators.js";
import { ok } from "../../../../../lib/result.js";
import type { AskLifecycle } from "../../../../../live/ask/lifecycle.js";
import { appendAskLifecycleEvent } from "../../../../../live/ask/store.js";
import { PENDING_ROUTE_STEPS, SUBAGENT_TURN_STEPS } from "../../../../../live/turn/answer.js";
import {
  finaliseIndicators,
  type IndicatorOutcome,
  type TerminalReaction,
} from "../../../../../live/turn/indicators.js";
import { liveIndicatorSeams } from "../../../../../live/turn/poster.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";
import { reactingTransport } from "../../../../reactingTransportFake.js";
import { ACKNOWLEDGED, CAPTURE, CHROME, COMPLETION, PROVENANCE, tempHome, useTempHomes } from "./harness.js";

useTempHomes();

/** The two measured asks a `no-response` terminal left wearing `:eyes:`, in two different sessions. */
const TRIAGED_OWN = { channel: "C_TEAM", messageTs: "1787622624.365599", threadTs: "1787622624.365599" };
const TRIAGED_CROSS = { channel: "D_OWNER", messageTs: "1787659730.419849", threadTs: "1787659730.419849" };

describe("convergesLifecycleReact — triaged, no reply owed", () => {
  /**
   * The fourth instance of this class, and the one that needed a new EMOJI rather than a new caller.
   * `handleNoResponse` recorded its judgement and deleted the capture checklist, then stopped — so the
   * capture reaction stood over an ask that had been handled correctly. Measured twice:
   * once on an ask of the owner's own that the owner spotted unprompted (`1787622624.365599`), and once
   * cross-session on a different ask in the owner's DM (`1787659730.419849`), where the composing session believed
   * in good faith it had retired its indicators.
   *
   * Both hand-settles had to choose an ending that was untrue, because the vocabulary held only two: the
   * tick OVERSTATES (nothing was answered) and the warning understates (it reads as an error to act on).
   */
  function capturedEntry({ ask }: { ask: typeof TRIAGED_OWN }): AskLifecycle {
    return {
      capturedIso: "2026-08-25T12:30:24.000Z",
      channel: ask.channel,
      lastEvent: { ...ask, kind: "captured", surface: "dm", tsIso: "2026-08-25T12:30:24.000Z", userId: "U_ASKER" },
      messageTs: ask.messageTs,
      state: "captured",
      surface: "channel",
      threadTs: ask.threadTs,
      userId: "U_ASKER",
    };
  }

  it("plans nothing for an ask the listener never captured — it raised no indicator to correct", () => {
    const plan = triagedAskIndicatorPlan({
      ending: "triaged",
      entry: undefined,
      messageTs: TRIAGED_OWN.messageTs,
      reason: "no reply",
    });

    expect(plan.kind).toBe("nothing-raised");
  });

  it("plans the triaged ending and the turn's own rationale for a captured ask", () => {
    const plan = triagedAskIndicatorPlan({
      ending: "triaged",
      entry: capturedEntry({ ask: TRIAGED_OWN }),
      messageTs: TRIAGED_OWN.messageTs,
      reason: "already fulfilled in the thread",
    });

    expect(plan).toEqual({
      kind: "settle",
      state: {
        kind: "triaged",
        readerReason: "already fulfilled in the thread",
        reason: "already fulfilled in the thread",
      },
      steps: PENDING_ROUTE_STEPS,
      turnId: "triaged-1787622624.365599",
    });
  });

  it("settles a DISPATCHED ask against its own tier's steps, not the capture-time placeholder list", () => {
    const entry = capturedEntry({ ask: TRIAGED_CROSS });
    const dispatched: AskLifecycle = {
      ...entry,
      lastEvent: {
        ...TRIAGED_CROSS,
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
        leaseExpiresAt: "2026-08-25T14:30:00.000Z",
        tier: "read-only-subagent",
        tsIso: "2026-08-25T12:31:00.000Z",
      },
      state: "dispatched",
      surface: "channel",
    };

    const plan = triagedAskIndicatorPlan({
      ending: "triaged",
      entry: dispatched,
      messageTs: TRIAGED_CROSS.messageTs,
      reason: "no reply",
    });

    expect(plan.kind === "settle" ? plan.steps : []).toEqual(SUBAGENT_TURN_STEPS);
  });

  it("earns the ACKNOWLEDGED ending, which neither of the other two could express truthfully", async () => {
    const applied: { reaction: TerminalReaction | undefined } = { reaction: undefined };

    await finaliseIndicators({
      seams: {
        endStatus: async (): Promise<IndicatorOutcome> => ok(undefined),
        settleChecklist: async () => true,
        settleReaction: async ({ reaction }): Promise<IndicatorOutcome> => {
          applied.reaction = reaction;
          return ok(undefined);
        },
      },
      state: {
        kind: "triaged",
        readerReason: "already fulfilled in the thread",
        reason: "already fulfilled in the thread",
      },
    });

    expect(applied.reaction).toBe("acknowledged");
  });

  it("converges the owner's own fulfilled ask from the standing :eyes: to :ack: alone", async () => {
    const reactions = new Set<string>([CAPTURE]);
    const standing = new Map([[TRIAGED_OWN.messageTs, reactions]]);
    const seams = liveIndicatorSeams({
      askIdentity: TRIAGED_OWN,
      doorLedger: memoryDoorLedger().port,
      home: tempHome(),
      provenance: PROVENANCE,
      steps: PENDING_ROUTE_STEPS,
      task: "answering",
      transport: reactingTransport({ standing }),
      turnChrome: CHROME,
      turnId: "triaged-1787622624.365599",
    });

    await finaliseIndicators({
      seams,
      state: {
        kind: "triaged",
        readerReason: "already fulfilled in the thread",
        reason: "already fulfilled in the thread",
      },
    });

    expect([...reactions]).toEqual([ACKNOWLEDGED]);
  });

  it("converges the cross-session reproduction the same way, from the same standing capture reaction", async () => {
    const reactions = new Set<string>([CAPTURE]);
    const standing = new Map([[TRIAGED_CROSS.messageTs, reactions]]);
    const seams = liveIndicatorSeams({
      askIdentity: TRIAGED_CROSS,
      doorLedger: memoryDoorLedger().port,
      home: tempHome(),
      provenance: PROVENANCE,
      steps: PENDING_ROUTE_STEPS,
      task: "answering",
      transport: reactingTransport({ standing }),
      turnChrome: CHROME,
      turnId: "triaged-1787659730.419849",
    });

    await finaliseIndicators({
      seams,
      state: { kind: "triaged", readerReason: "nothing owed", reason: "nothing owed" },
    });

    expect([...reactions]).toEqual([ACKNOWLEDGED]);
  });

  it("is retired in turn when a triaged ask is later answered for real, rather than wearing both", async () => {
    const reactions = new Set<string>([CAPTURE]);
    const standing = new Map([[TRIAGED_OWN.messageTs, reactions]]);
    const seams = liveIndicatorSeams({
      askIdentity: TRIAGED_OWN,
      doorLedger: memoryDoorLedger().port,
      home: tempHome(),
      provenance: PROVENANCE,
      steps: PENDING_ROUTE_STEPS,
      task: "answering",
      transport: reactingTransport({ standing }),
      turnChrome: CHROME,
      turnId: "triaged-1787622624.365599",
    });

    await seams.settleReaction({ reaction: "acknowledged" });
    await seams.settleReaction({ reaction: "completion" });

    expect([...reactions]).toEqual([COMPLETION]);
  });

  it("reports the unsettled reaction, rather than throwing, when the home has no bot token", async () => {
    const home = tempHome();
    appendAskLifecycleEvent({
      event: {
        ...TRIAGED_OWN,
        kind: "captured",
        surface: "dm",
        tsIso: "2026-08-25T12:30:24.000Z",
        userId: "U_ASKER",
      },
      home,
    });
    const reported: string[] = [];

    await settleTriagedAskIndicators({
      channel: TRIAGED_OWN.channel,
      ending: "triaged",
      home,
      messageTs: TRIAGED_OWN.messageTs,
      reason: "already fulfilled in the thread",
      report: ({ failure }) => reported.push(failure),
      env: {},
    });

    expect(reported).toEqual(["could not settle its indicators — no Slack bot token is configured"]);
  });

  it("reports nothing at all for an ask the listener never captured — there is no signal to correct", async () => {
    const reported: string[] = [];

    await settleTriagedAskIndicators({
      channel: TRIAGED_OWN.channel,
      ending: "triaged",
      home: tempHome(),
      messageTs: TRIAGED_OWN.messageTs,
      reason: "already fulfilled in the thread",
      report: ({ failure }) => reported.push(failure),
    });

    expect(reported).toEqual([]);
  });

  it("leaves a HUMAN's own reaction alone while converging to :ack:", async () => {
    const reactions = new Set<string>([CAPTURE, "tada"]);
    const standing = new Map([[TRIAGED_OWN.messageTs, reactions]]);
    const seams = liveIndicatorSeams({
      askIdentity: TRIAGED_OWN,
      doorLedger: memoryDoorLedger().port,
      home: tempHome(),
      provenance: PROVENANCE,
      steps: PENDING_ROUTE_STEPS,
      task: "answering",
      transport: reactingTransport({ standing }),
      turnChrome: CHROME,
      turnId: "triaged-1787622624.365599",
    });

    await seams.settleReaction({ reaction: "acknowledged" });

    expect([...reactions]).toEqual(["tada", ACKNOWLEDGED]);
  });
});
