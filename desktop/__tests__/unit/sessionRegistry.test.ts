/*
 * The control plane's delivery rules, as the pure reducer decides them: what an idle, starting and running session
 * does with a message on each delivery, and what a turn's end and a worker's report release.
 */
import { describe, expect, it } from "vitest";

import { APP_SESSION_SUBMITTED_TEXT_MAX_CHARS } from "../../src/sessionControlProtocol";
import { AGENT_TEXT_TAIL } from "../../src/sessionEcho";
import { reduceRegistry } from "../../src/sessionRegistry";
import {
  appHandleOf,
  EMPTY_REGISTRY,
  entryForHandle,
  type RegistryEvent,
  type SessionRegistry,
} from "../../src/sessionRegistryShape";

const AT = "2026-11-09T01:00:00.000Z";
const ID = "0b5e";

function apply({ registry, events }: { registry: SessionRegistry; events: readonly RegistryEvent[] }): SessionRegistry {
  return events.reduce((held, event) => reduceRegistry({ event, registry: held }).registry, registry);
}

const PREPARED: RegistryEvent = {
  atIso: AT,
  kind: "prepared",
  launchToken: "token-1",
  sessionId: ID,
  spec: {
    codexHome: "/home/codex",
    directory: "/work/acme",
    judgedInstanceId: "instance-a",
    ledgerKey: "abc-1",
    title: "abc-1",
    vendor: "codex",
  },
};

const READY: RegistryEvent = {
  atIso: AT,
  kind: "worker",
  report: { kind: "ready", sessionId: ID, vendorSessionId: "thread-1" },
};
const TURN_ENDED: RegistryEvent = {
  atIso: AT,
  kind: "worker",
  report: { kind: "turn-ended", sessionId: ID, stopReason: "end_turn" },
};

const starting = apply({ events: [PREPARED], registry: EMPTY_REGISTRY });
const idle = apply({ events: [READY], registry: starting });
const running = reduceRegistry({
  event: { atIso: AT, delivery: "later", kind: "message", sessionId: ID, text: "first" },
  registry: idle,
}).registry;

function message({ registry, delivery }: { registry: SessionRegistry; delivery: "now" | "turn" | "later" }) {
  return reduceRegistry({ event: { atIso: AT, delivery, kind: "message", sessionId: ID, text: "second" }, registry });
}

describe("reduceRegistry", () => {
  it("records a prepared session as starting, addressed by its app handle", () => {
    const entry = starting.get(ID)!;
    expect(entry.snapshot.state).toBe("starting");
    expect(entry.snapshot.handle).toBe("app:0b5e");
    expect(entry.launchToken).toBe("token-1");
  });

  it("holds a message sent while the session starts, and sends it when the worker reports ready", () => {
    const held = message({ delivery: "turn", registry: starting });
    expect(held.sends).toEqual([]);
    expect(held.queued).toBe(true);
    const released = reduceRegistry({ event: READY, registry: held.registry });
    expect(released.sends).toEqual([{ instruction: { kind: "prompt", text: "second" }, sessionId: ID }]);
    expect(released.registry.get(ID)!.snapshot.state).toBe("running");
  });

  it("sends any delivery into an idle session at once", () => {
    for (const delivery of ["now", "turn", "later"] as const) {
      const step = message({ delivery, registry: idle });
      expect(step.sends).toEqual([{ instruction: { kind: "prompt", text: "second" }, sessionId: ID }]);
      expect(step.queued).toBe(false);
      expect(step.registry.get(ID)!.snapshot.lastSubmittedText).toBe("second");
    }
  });

  it("holds a later message for a running turn's end, without cancelling it", () => {
    const step = message({ delivery: "later", registry: running });
    expect(step.sends).toEqual([]);
    expect(step.interrupted).toBe(false);
    expect(step.queued).toBe(true);
    expect(step.registry.get(ID)!.pending).toEqual(["second"]);
  });

  it("cancels a running turn for a now message and delivers it when the cancelled turn ends", () => {
    const step = message({ delivery: "now", registry: running });
    expect(step.sends).toEqual([{ instruction: { kind: "cancel" }, sessionId: ID }]);
    expect(step.interrupted).toBe(true);
    expect(step.queued).toBe(false);
    const ended = reduceRegistry({ event: TURN_ENDED, registry: step.registry });
    expect(ended.sends).toEqual([{ instruction: { kind: "prompt", text: "second" }, sessionId: ID }]);
    expect(ended.registry.get(ID)!.pending).toEqual([]);
  });

  it("never releases a now message on a repeated ready while the cancelled turn still runs", () => {
    const step = message({ delivery: "now", registry: running });
    const repeated = reduceRegistry({ event: READY, registry: step.registry });
    expect(repeated.sends).toEqual([]);
    expect(repeated.registry.get(ID)!.pending).toEqual(["second"]);
    expect(repeated.registry.get(ID)!.snapshot.state).toBe("running");
  });

  it("never releases what a starting session holds on a turn-ended report, only on ready", () => {
    const held = message({ delivery: "later", registry: starting });
    const early = reduceRegistry({ event: TURN_ENDED, registry: held.registry });
    expect(early.sends).toEqual([]);
    expect(early.registry.get(ID)!.pending).toEqual(["second"]);
    expect(early.registry.get(ID)!.snapshot.state).toBe("starting");
  });

  it("lands a now message ahead of a later one already held, as the installed app showed it must", () => {
    const later = message({ delivery: "later", registry: running }).registry;
    const now = reduceRegistry({
      event: { atIso: AT, delivery: "now", kind: "message", sessionId: ID, text: "interrupt" },
      registry: later,
    });
    expect(now.registry.get(ID)!.pending).toEqual(["interrupt", "second"]);
    const ended = reduceRegistry({ event: TURN_ENDED, registry: now.registry });
    expect(ended.sends).toEqual([{ instruction: { kind: "prompt", text: "interrupt" }, sessionId: ID }]);
    expect(ended.registry.get(ID)!.pending).toEqual(["second"]);
    expect(ended.registry.get(ID)!.urgent).toBe(0);
  });

  it("keeps two now messages in the order they arrived, both ahead of a later one", () => {
    const held = apply({
      events: [
        { atIso: AT, delivery: "later", kind: "message", sessionId: ID, text: "later" },
        { atIso: AT, delivery: "now", kind: "message", sessionId: ID, text: "now-1" },
        { atIso: AT, delivery: "now", kind: "message", sessionId: ID, text: "now-2" },
      ],
      registry: running,
    });
    expect(held.get(ID)!.pending).toEqual(["now-1", "now-2", "later"]);
  });

  it("reports a second now message as queued, since the first one's turn runs before it", () => {
    const first = message({ delivery: "now", registry: running });
    const second = reduceRegistry({
      event: { atIso: AT, delivery: "now", kind: "message", sessionId: ID, text: "now-2" },
      registry: first.registry,
    });
    expect(second.interrupted).toBe(true);
    expect(second.queued).toBe(true);
  });

  it("shows only the current turn's words once a new message is sent", () => {
    const said = apply({
      events: [
        { atIso: AT, kind: "worker", report: { kind: "agent-text", sessionId: ID, text: "LATER-OK" } },
        TURN_ENDED,
      ],
      registry: running,
    });
    const next = message({ delivery: "later", registry: said }).registry;
    expect(next.get(ID)!.snapshot.lastAgentText).toBe(undefined);
    const answered = reduceRegistry({
      event: { atIso: AT, kind: "worker", report: { kind: "agent-text", sessionId: ID, text: "NOW-OK" } },
      registry: next,
    }).registry;
    expect(answered.get(ID)!.snapshot.lastAgentText).toBe("NOW-OK");
  });

  it("refuses a turn message to a running session rather than degrading it", () => {
    const step = message({ delivery: "turn", registry: running });
    expect(step.refusal!.code).toBe("DELIVERY_UNSUPPORTED");
    expect(step.sends).toEqual([]);
  });

  it("refuses a message to a session that is stopping, and to one it never held", () => {
    const stopping = reduceRegistry({ event: { kind: "stopping", sessionId: ID }, registry: running }).registry;
    expect(message({ delivery: "later", registry: stopping }).refusal!.code).toBe("SESSION_NOT_FOUND");
    expect(message({ delivery: "later", registry: EMPTY_REGISTRY }).refusal!.code).toBe("SESSION_NOT_FOUND");
  });

  it("returns a session to idle when a turn ends with nothing held", () => {
    const ended = reduceRegistry({ event: TURN_ENDED, registry: running });
    expect(ended.sends).toEqual([]);
    expect(ended.registry.get(ID)!.snapshot.state).toBe("idle");
  });

  it("keeps only the tail of the agent's words", () => {
    const long = "x".repeat(AGENT_TEXT_TAIL);
    const said = apply({
      events: [
        { atIso: AT, kind: "worker", report: { kind: "agent-text", sessionId: ID, text: long } },
        { atIso: AT, kind: "worker", report: { kind: "agent-text", sessionId: ID, text: "END" } },
      ],
      registry: running,
    });
    const text = said.get(ID)!.snapshot.lastAgentText!;
    expect(text.length).toBe(AGENT_TEXT_TAIL);
    expect(text.endsWith("xEND")).toBe(true);
  });

  it("echoes a message exactly at the submitted-text bound whole, and sends it whole", () => {
    const text = "x".repeat(APP_SESSION_SUBMITTED_TEXT_MAX_CHARS);
    const step = reduceRegistry({
      event: { atIso: AT, delivery: "now", kind: "message", sessionId: ID, text },
      registry: idle,
    });
    expect(step.registry.get(ID)!.snapshot.lastSubmittedText).toBe(text);
    expect(step.sends).toEqual([{ instruction: { kind: "prompt", text }, sessionId: ID }]);
  });

  it("echoes only the head of a message one past the bound, ending in the marker, and still sends it whole", () => {
    const text = "x".repeat(APP_SESSION_SUBMITTED_TEXT_MAX_CHARS + 1);
    const step = reduceRegistry({
      event: { atIso: AT, delivery: "now", kind: "message", sessionId: ID, text },
      registry: idle,
    });
    const echoed = step.registry.get(ID)!.snapshot.lastSubmittedText!;
    expect(echoed).toBe(`${"x".repeat(1_999)}…`);
    expect(echoed.length).toBe(2_000);
    expect(step.sends).toEqual([{ instruction: { kind: "prompt", text }, sessionId: ID }]);
  });

  it("never splits a surrogate pair at the cut: unit 1,999 opening a pair drops the pair", () => {
    const text = `${"x".repeat(1_998)}😀z`;
    expect(text.length).toBe(2_001);
    const step = reduceRegistry({
      event: { atIso: AT, delivery: "now", kind: "message", sessionId: ID, text },
      registry: idle,
    });
    const echoed = step.registry.get(ID)!.snapshot.lastSubmittedText!;
    expect(echoed).toBe(`${"x".repeat(1_998)}…`);
    expect(echoed.length).toBe(1_999);
    expect(step.sends).toEqual([{ instruction: { kind: "prompt", text }, sessionId: ID }]);
  });

  it("cancels only a running turn on an interrupt", () => {
    expect(reduceRegistry({ event: { kind: "interrupt", sessionId: ID }, registry: running }).sends).toEqual([
      { instruction: { kind: "cancel" }, sessionId: ID },
    ]);
    expect(reduceRegistry({ event: { kind: "interrupt", sessionId: ID }, registry: idle }).sends).toEqual([]);
  });

  it("marks a gone session failed or closed, and a stopping one drops what it held", () => {
    const held = message({ delivery: "later", registry: running }).registry;
    const stopping = reduceRegistry({ event: { kind: "stopping", sessionId: ID }, registry: held }).registry;
    expect(stopping.get(ID)!.pending).toEqual([]);
    expect(
      reduceRegistry({
        event: { failed: true, kind: "gone", sessionId: ID, atIso: "t9" },
        registry: stopping,
      }).registry.get(ID)!.snapshot.state,
    ).toBe("failed");
    expect(
      reduceRegistry({
        event: { failed: false, kind: "gone", sessionId: ID, atIso: "t9" },
        registry: stopping,
      }).registry.get(ID)!.snapshot.state,
    ).toBe("closed");
  });

  it("clears the launch token once the launch is settled", () => {
    const settled = reduceRegistry({ event: { kind: "launch-settled", sessionId: ID }, registry: idle }).registry;
    expect(settled.get(ID)!.launchToken).toBe(undefined);
  });

  it("spends the launch token of a prepare that failed, so no deliver or abort can reach the session through it", () => {
    expect(starting.get(ID)!.launchToken).toBe("token-1");
    const failed = reduceRegistry({
      event: { failed: true, kind: "gone", sessionId: ID, atIso: "t9" },
      registry: starting,
    });
    expect(failed.registry.get(ID)!.snapshot.state).toBe("failed");
    expect(failed.registry.get(ID)!.launchToken).toBe(undefined);
  });
});

describe("reduceRegistry usage", () => {
  const COUNT = {
    cacheWriteInputTokens: 0,
    cachedInputTokens: 60,
    outputTokens: 10,
    reasoningOutputTokens: 5,
    totalTokens: 100,
    uncachedInputTokens: 25,
    vendor: "codex" as const,
  };
  const TURN_USAGE: RegistryEvent = {
    atIso: AT,
    kind: "worker",
    report: {
      kind: "turn-usage",
      sessionId: ID,
      usage: { chargedModels: ["gpt-5.6-sol"], kind: "reported", scope: "comprehensive", tokens: COUNT },
    },
  };

  it("opens the rate's window at ready and counts a turn reported before its end once", () => {
    const ended = apply({ events: [TURN_USAGE, TURN_ENDED], registry: running });
    const { usage } = ended.get(ID)!;
    expect(usage.readySinceIso).toBe(AT);
    expect(usage.reportedTurns).toBe(1);
    expect(usage.missingTurns).toBe(0);
    expect(usage.total).toEqual(COUNT);
    expect(usage.turnOpen).toBe(false);
  });

  it("counts a turn that ended with no report as missing", () => {
    const { usage } = apply({ events: [TURN_ENDED], registry: running }).get(ID)!;
    expect(usage.missingTurns).toBe(1);
    expect(usage.lastTurn).toEqual({ atIso: AT, usage: { kind: "not-reported" } });
  });

  it("counts the open turn missing when the worker fails, closes, or the session goes", () => {
    const failed: RegistryEvent = {
      atIso: AT,
      kind: "worker",
      report: { kind: "failed", message: "x", sessionId: ID },
    };
    const closed: RegistryEvent = { atIso: AT, kind: "worker", report: { kind: "closed", sessionId: ID } };
    const gone: RegistryEvent = { atIso: AT, failed: true, kind: "gone", sessionId: ID };
    for (const event of [failed, closed, gone]) {
      expect(apply({ events: [event], registry: running }).get(ID)!.usage.missingTurns).toBe(1);
    }
  });

  it("still counts a report that lands while the session is stopping, and not again when it goes", () => {
    const stopped = apply({
      events: [
        { kind: "stopping", sessionId: ID },
        TURN_USAGE,
        { atIso: AT, failed: false, kind: "gone", sessionId: ID },
      ],
      registry: running,
    });
    const { usage } = stopped.get(ID)!;
    expect(usage.reportedTurns).toBe(1);
    expect(usage.missingTurns).toBe(0);
    expect(usage.total!.totalTokens).toBe(100);
  });

  it("counts a turn once when its report lands after the session already went", () => {
    const gone = apply({
      events: [{ atIso: AT, failed: false, kind: "gone", sessionId: ID }, TURN_USAGE],
      registry: running,
    });
    const { usage } = gone.get(ID)!;
    expect(usage.missingTurns).toBe(0);
    expect(usage.reportedTurns).toBe(1);
    expect(usage.total!.totalTokens).toBe(100);
  });

  it("keeps the model and the context occupancy beside spend, never in it", () => {
    const observed = apply({
      events: [
        { atIso: AT, kind: "worker", report: { kind: "model-resolved", model: "gpt-5.6-sol", sessionId: ID } },
        {
          atIso: AT,
          kind: "worker",
          report: { kind: "context-occupancy", sessionId: ID, sizeTokens: 272_000, usedTokens: 41_000 },
        },
      ],
      registry: running,
    });
    const { usage, snapshot } = observed.get(ID)!;
    expect(usage.resolvedModel).toBe("gpt-5.6-sol");
    expect(usage.context).toEqual({ atIso: AT, sizeTokens: 272_000, usedTokens: 41_000 });
    expect(usage.total).toBe(undefined);
    expect(snapshot.state).toBe("running");
  });
});

describe("entryForHandle", () => {
  it("finds a session by its app handle or its bare id, and nothing for another", () => {
    expect(appHandleOf({ sessionId: ID })).toBe("app:0b5e");
    expect(entryForHandle({ handle: "app:0b5e", registry: idle })!.snapshot.sessionId).toBe(ID);
    expect(entryForHandle({ handle: "0b5e", registry: idle })!.snapshot.sessionId).toBe(ID);
    expect(entryForHandle({ handle: "app:nope", registry: idle })).toBe(undefined);
  });
});
