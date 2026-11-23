import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { approvalUnbackedFinding } from "../../../../admit/approval.js";
import { doorRefusalLines } from "../../../../admit/doorRefusal.js";
import type { DoorDecision, DoorRequest } from "../../../../admit/types.js";
import type { ReplyContext } from "../../../../admit/withhold.js";
import type { PostedMessage } from "../../../../corpus/slack/writeTransport.js";
import { JUDGEMENT_NOTE } from "../../../../hatch/render.js";
import type { AskIdentity } from "../../../../live/ask/identity.js";
import { asRef, refusalDetail, routed, turnDoorRequest } from "../../../../live/turn/posterDoor.js";
import { DoorRecordingRefusedError, DoorRefusedError } from "../../../../live/turn/run.js";
import { type MemoryDoorLedger, memoryDoorLedger, unreachableDoorLedger } from "../../../doorLedgerFixture.js";

const ASK: AskIdentity = { channel: "C0123ABC", messageTs: "1790000000.000100", threadTs: "1790000000.000100" };

describe("turnDoorRequest", () => {
  it("builds the minimal request with no acknowledgement, target, media or reply field", () => {
    expect(turnDoorRequest({ askIdentity: ASK, home: "/fixture/home", turnId: "turn-1", verb: "ack" })).toEqual({
      action: { kind: "verb", noun: "turn", verb: "ack" },
      artifact: { actor: "bot", askIdentity: ASK, channel: "C0123ABC", turnId: "turn-1" },
      meta: { createsWorkItem: false, effect: "external-write", home: "/fixture/home", requiresApproval: false },
    });
  });

  it("treats explicitly undefined optional fields exactly like absent ones", () => {
    const request = turnDoorRequest({
      askIdentity: ASK,
      home: "/fixture/home",
      mediaCount: undefined,
      noPictureBecause: undefined,
      reply: undefined,
      targetTs: undefined,
      turnId: "turn-1",
      verb: "ack",
    });
    expect(Object.keys(request)).toEqual(["action", "artifact", "meta"]);
    expect(Object.keys(request.artifact)).toEqual(["actor", "askIdentity", "channel", "turnId"]);
  });

  it("builds the fully populated request, carrying the reply under the reply field and the unshown-items acknowledgement", () => {
    const reply: ReplyContext = {
      askedBy: "U0OWNER",
      channel: "C0123ABC",
      draftTldr: "The pool exhausted at 09:14.",
      question: "why did staging fall over?",
      surface: "channel",
    };
    expect(
      turnDoorRequest({
        askIdentity: ASK,
        home: "/fixture/home",
        mediaCount: 0,
        noPictureBecause: "the answer is a single number",
        reply,
        targetTs: "1790000001.000200",
        turnId: "turn-2",
        verb: "answer",
      }),
    ).toEqual({
      acknowledgements: [{ reason: "the answer is a single number", subject: "unshown-items" }],
      action: { kind: "verb", noun: "turn", verb: "answer" },
      artifact: {
        actor: "bot",
        askIdentity: ASK,
        channel: "C0123ABC",
        mediaCount: 0,
        reply,
        targetTs: "1790000001.000200",
        turnId: "turn-2",
      },
      meta: { createsWorkItem: false, effect: "external-write", home: "/fixture/home", requiresApproval: false },
    });
  });
});

describe("refusalDetail", () => {
  it("says the door's own verdict line when the decision carries no findings", () => {
    const decision: DoorDecision = { findings: [], overridden: [], status: "warn" };
    expect(refusalDetail({ decision })).toBe("the door did not admit this (warn). Nothing was changed.");
  });

  it("renders every finding through the canonical door refusal renderer, one line per entry", () => {
    const decision: DoorDecision = {
      findings: [
        { code: "demo.hold", correction: "do the other thing", severity: "hold", summary: "the demo refused" },
      ],
      overridden: [],
      status: "hold",
    };
    const expected = [
      "the door did not admit this (hold). Nothing was changed.",
      "posting this turn's answer blocked because the demo refused [demo.hold].",
      "There is no escape hatch for this one: a hold is the irreversible-harm arm of the door and no per-action token waives it.",
      "The way through is to satisfy it: do the other thing",
      JUDGEMENT_NOTE,
    ].join("\n");
    expect(refusalDetail({ decision })).toBe(expected);
    expect(refusalDetail({ decision })).toBe(
      doorRefusalLines({ command: "posting this turn's answer", decision }).join("\n"),
    );
  });
});

describe("asRef", () => {
  it("keeps the channel and ts and drops every other posted-message field", () => {
    const posted: PostedMessage = {
      channel: "C0123ABC",
      placement: {
        journalFailure: "journal was read-only",
        outcome: { kind: "verified", posted: { channel: "C0123ABC", ts: "1790000002.000300" } },
      },
      ts: "1790000002.000300",
    };
    expect(asRef({ posted })).toEqual({ channel: "C0123ABC", ts: "1790000002.000300" });
    expect(Object.keys(asRef({ posted }))).toEqual(["channel", "ts"]);
  });
});

describe("routed", () => {
  /** The session-id variables the door's profile gate reads off the environment `routed` hands it. */
  const SESSION_ENV_NAMES = ["CLAUDE_CODE_SESSION_ID", "CODEX_THREAD_ID"] as const;
  const savedEnv = new Map<string, string | undefined>();
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "poster-door-"));
    for (const name of SESSION_ENV_NAMES) {
      savedEnv.set(name, process.env[name]);
      delete process.env[name];
    }
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
    for (const name of SESSION_ENV_NAMES) {
      const value = savedEnv.get(name);
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  });

  /** Every status the door ledger recorded, in order. */
  function ledgerStatuses({ door }: { door: MemoryDoorLedger }): readonly unknown[] {
    return door.records().map((record) => record["status"]);
  }

  it("performs an admitted effect exactly once, returns its result, and records the decision in the ledger", async () => {
    const calls: string[] = [];
    const door = memoryDoorLedger();
    const perform = async (): Promise<string> => {
      calls.push("perform");
      return "posted";
    };
    const result = await routed({
      home,
      ledger: door.port,
      perform,
      request: turnDoorRequest({ askIdentity: ASK, home, turnId: "turn-3", verb: "ack" }),
      what: "acknowledge the ask",
    });

    expect(result).toBe("posted");
    expect(calls).toEqual(["perform"]);
    expect(ledgerStatuses({ door })).toEqual(["pass"]);
  });

  it("throws a DoorRecordingRefusedError, never a DoorRefusedError, and performs nothing when the decision cannot be recorded", async () => {
    const calls: string[] = [];
    const perform = async (): Promise<string> => {
      calls.push("perform");
      return "posted";
    };

    const thrown = await routed({
      home,
      ledger: unreachableDoorLedger(),
      perform,
      request: turnDoorRequest({ askIdentity: ASK, home, turnId: "turn-5", verb: "ack" }),
      what: "acknowledge the ask",
    }).then(
      () => new Error("expected a refusal"),
      (error: unknown) => error,
    );

    expect(thrown).toBeInstanceOf(DoorRecordingRefusedError);
    expect(thrown).not.toBeInstanceOf(DoorRefusedError);
    expect((thrown as DoorRecordingRefusedError).message).toContain(
      "the door's decision to acknowledge the ask could not be recorded, so nothing was sent — ",
    );
    expect(calls).toEqual([]);
  });

  it("throws a DoorRefusedError naming the effect and the door's findings, and never performs the effect", async () => {
    const calls: string[] = [];
    const perform = async (): Promise<string> => {
      calls.push("perform");
      return "posted";
    };
    const base = turnDoorRequest({ askIdentity: ASK, home, turnId: "turn-4", verb: "answer" });
    // Declaring approval with no approval gate in the list is the door's own unconditional hold.
    const request: DoorRequest = { ...base, meta: { ...base.meta, requiresApproval: true } };
    const decision: DoorDecision = {
      findings: [approvalUnbackedFinding({ request })],
      overridden: [],
      status: "hold",
    };

    const door = memoryDoorLedger();

    const thrown = await routed({ home, ledger: door.port, perform, request, what: "post the answer" }).then(
      () => new Error("expected a refusal"),
      (error: unknown) => error,
    );

    expect(thrown).toBeInstanceOf(DoorRefusedError);
    expect((thrown as DoorRefusedError).message).toBe(
      `the admit door refused to post the answer — ${refusalDetail({ decision })}`,
    );
    expect((thrown as DoorRefusedError).message).toContain(
      "the admit door refused to post the answer — the door did not admit this (hold). Nothing was changed.",
    );
    expect(calls).toEqual([]);
    expect(ledgerStatuses({ door })).toEqual(["hold"]);
  });
});
