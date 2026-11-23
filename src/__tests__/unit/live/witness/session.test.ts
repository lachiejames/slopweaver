import { describe, expect, it } from "vitest";
import type { VisibleSessionPlan } from "../../../../cmux/plan.js";
import type { PickupDelivery, SpawnFailureDetail } from "../../../../cmux/spawn.js";
import { err, ok, type Result, unwrap, unwrapErr } from "../../../../lib/result.js";
import type { VisibleSessionLaunchOutcome } from "../../../../live/turn/tier.js";
import { WitnessJournalErrors } from "../../../../live/witness/errors.js";
import { dispatchWitness, type WitnessDispatchDeps, witnessPickupCommand } from "../../../../live/witness/session.js";
import { settleWitness } from "../../../../live/witness/settle.js";
import {
  threadStandDownIdOf,
  type WitnessDispatchedEvent,
  type WitnessJournalEvent,
  type WitnessKey,
  witnessIdOf,
} from "../../../../live/witness/types.js";

const KEY: WitnessKey = { channel: "C0SYN000000001", messageTs: "1789000000.000200", threadTs: "1789000000.000100" };
const WITNESS_ID = witnessIdOf({ key: KEY });
const NOW = "2026-10-05T01:00:00.000Z";
const CLAUDE_ENV = { CLAUDE_CODE_SESSION_ID: "session-1" };

const SESSION = {
  cwd: "/repo",
  host: "claude-code",
  sessionName: "witness-C0SYN000000001-1789000000.000200",
  surfaceId: "surface-id-1",
  surfaceRef: "surface:1",
  workspaceId: "workspace-id-1",
  workspaceRef: "workspace:1",
} as const;

/** A fake world: an in-memory journal, and an ordered log of every effect the code under test asked for. */
function fakeWorld({
  initial = [],
  launch = { session: SESSION },
  deliver = ok<PickupDelivery, SpawnFailureDetail>({
    kind: "witnessed",
    witness: { by: "screen", confirmed: true },
  }),
  appendFailsAt,
  closeFailure,
  lockHeldBy,
  replyReserved = false,
}: {
  initial?: readonly WitnessJournalEvent[];
  launch?: VisibleSessionLaunchOutcome;
  deliver?: Result<PickupDelivery, SpawnFailureDetail>;
  appendFailsAt?: number;
  closeFailure?: string;
  /** Another dispatch's hold on the lock, as the refusal text the real lock would give. */
  lockHeldBy?: string;
  /** Whether the send ledger holds a witness reply reservation for the message. */
  replyReserved?: boolean;
} = {}): { deps: WitnessDispatchDeps; journal: WitnessJournalEvent[]; log: string[]; plans: VisibleSessionPlan[] } {
  const journal: WitnessJournalEvent[] = [...initial];
  const log: string[] = [];
  const plans: VisibleSessionPlan[] = [];
  let appends = 0;
  const deps: WitnessDispatchDeps = {
    append: ({ event }) => {
      appends += 1;
      if (appends === appendFailsAt) {
        log.push(`append-failed:${event.kind}`);
        return err(WitnessJournalErrors.writeFailed({ cause: new Error("disk full"), path: "/j" }));
      }
      log.push(`append:${event.kind}`);
      journal.push(event);
      return ok(undefined);
    },
    checkout: () => ({ branch: "main", repoRoot: "/repo" }),
    closeWorkspace: ({ workspaceId }) => {
      log.push(`close:${workspaceId}`);
      return Promise.resolve(closeFailure);
    },
    deliver: ({ plan }) => {
      log.push(`deliver:${plan.pickupCommand}`);
      return Promise.resolve(deliver);
    },
    launch: ({ plan }) => {
      log.push("launch");
      plans.push(plan);
      return Promise.resolve(launch);
    },
    lock: () => {
      if (lockHeldBy !== undefined) {
        log.push("lock-refused");
        return err(lockHeldBy);
      }
      log.push("lock");
      return ok({ release: () => log.push("release") });
    },
    nowIso: () => NOW,
    readJournal: () => {
      log.push("read");
      return ok([...journal]);
    },
    replyReserved: () => {
      log.push("reply-reserved?");
      return replyReserved;
    },
  };
  return { deps, journal, log, plans };
}

function dispatchedRow(): WitnessDispatchedEvent {
  return {
    ...KEY,
    cwd: "/repo",
    host: "claude-code",
    kind: "dispatched",
    model: "sonnet",
    schemaVersion: 1,
    sessionName: SESSION.sessionName,
    surfaceId: SESSION.surfaceId,
    surfaceRef: SESSION.surfaceRef,
    text: "the deploy finished cleanly",
    tsIso: NOW,
    witnessId: WITNESS_ID,
    workspaceId: SESSION.workspaceId,
    workspaceRef: SESSION.workspaceRef,
  };
}

function failedRow(): WitnessJournalEvent {
  return {
    ...KEY,
    kind: "settled",
    outcome: "failed",
    schemaVersion: 1,
    tsIso: NOW,
    why: "the pickup line could not be sent into workspace:1: surface gone",
    witnessId: WITNESS_ID,
  };
}

const REQUEST = { key: KEY, model: "sonnet", text: "the deploy finished cleanly" };

describe("dispatchWitness", () => {
  it("boots, THEN journals, THEN sends exactly the resume line", async () => {
    const world = fakeWorld();
    const outcome = unwrap(await dispatchWitness({ deps: world.deps, env: CLAUDE_ENV, request: REQUEST }));

    expect(world.log).toEqual([
      "lock",
      "read",
      "launch",
      "append:dispatched",
      `deliver:slopweaver witness resume ${WITNESS_ID}`,
      "release",
    ]);
    expect(outcome.record).toEqual(dispatchedRow());
    expect(outcome.delivery.kind).toBe("witnessed");
    expect(world.journal).toEqual([dispatchedRow()]);
  });

  it("plans a visible witness session with the witness role, the host, the model and the pickup", async () => {
    const world = fakeWorld();
    await dispatchWitness({ deps: world.deps, env: CLAUDE_ENV, request: { ...REQUEST, model: "opus" } });
    const plan = world.plans[0]!;

    expect(plan.host).toBe("claude-code");
    expect(plan.driver).toBe("claude");
    expect(plan.model).toBe("opus");
    expect(plan.effort).toBe("high");
    expect(plan.pickupCommand).toBe(witnessPickupCommand({ witnessId: WITNESS_ID }));
    expect(plan.workspaceName).toBe("witness-C0SYN000000001-1789000000.000200");
    expect(plan.sessionName).toBe("witness-C0SYN000000001-1789000000.000200");
    expect(plan.workspaceTitle).toBe("witness: the deploy finished cleanly");
    expect(plan.respondingToHandle).toBeUndefined();
    expect(plan.worktreeExists).toBe(true);
    expect(plan.cwd).toBe("/repo");
    expect(plan.template).toBe("bot");
  });

  it("boots a codex worker when the visible host is codex, with no effort pin", async () => {
    const world = fakeWorld();
    await dispatchWitness({ deps: world.deps, env: { CODEX_THREAD_ID: "thread-1" }, request: REQUEST });
    const plan = world.plans[0]!;

    expect(plan.host).toBe("codex");
    expect(plan.driver).toBe("codex");
    expect(plan.effort).toBeUndefined();
  });

  it("refuses a second worker before anything boots", async () => {
    const world = fakeWorld({ initial: [dispatchedRow()] });
    const error = unwrapErr(await dispatchWitness({ deps: world.deps, env: CLAUDE_ENV, request: REQUEST }));

    expect(error.code).toBe("ALREADY_DISPATCHED");
    expect(world.log).toEqual(["lock", "read", "release"]);
  });

  it("refuses a line from a thread the bot stood down in, booting nothing, so a line handed off just before the stand-down landed stays quiet", async () => {
    const standDown: WitnessJournalEvent = {
      ...KEY,
      kind: "settled",
      messageTs: "1789000000.000150",
      outcome: "stood-down",
      schemaVersion: 1,
      tsIso: NOW,
      why: "told it was in the way",
      witnessId: witnessIdOf({ key: { ...KEY, messageTs: "1789000000.000150" } }),
    };
    const world = fakeWorld({ initial: [standDown] });
    const error = unwrapErr(await dispatchWitness({ deps: world.deps, env: CLAUDE_ENV, request: REQUEST }));

    expect(error.code).toBe("THREAD_STOOD_DOWN");
    expect(error.message).toContain("C0SYN000000001/1789000000.000100 at message 1789000000.000150");
    expect(world.log).toEqual(["lock", "read", "release"]);
    expect(world.journal).toEqual([standDown]);
  });

  it("refuses a line from a thread stood down WHOLE, tied to no message, booting nothing", async () => {
    const standDown: WitnessJournalEvent = {
      channel: KEY.channel,
      kind: "thread-stood-down",
      schemaVersion: 1,
      standDownId: threadStandDownIdOf({ channel: KEY.channel, threadTs: KEY.threadTs }),
      threadTs: KEY.threadTs,
      tsIso: NOW,
      why: "owner: stop witnessing the thread",
    };
    const world = fakeWorld({ initial: [standDown] });
    const error = unwrapErr(await dispatchWitness({ deps: world.deps, env: CLAUDE_ENV, request: REQUEST }));

    expect(error.code).toBe("THREAD_STOOD_DOWN");
    expect(error.message).toContain(`C0SYN000000001/1789000000.000100 at the whole thread at ${NOW}`);
    expect(world.log).toEqual(["lock", "read", "release"]);
  });

  it("refuses while another dispatch holds the lock, reading and booting nothing", async () => {
    const world = fakeWorld({ lockHeldBy: "held by pid 4242" });
    const error = unwrapErr(await dispatchWitness({ deps: world.deps, env: CLAUDE_ENV, request: REQUEST }));

    expect(error.code).toBe("DISPATCH_LOCKED");
    expect(error.message).toContain("held by pid 4242");
    expect(world.log).toEqual(["lock-refused"]);
    expect(world.journal).toEqual([]);
  });

  it("refuses with no visible host, and never boots anything", async () => {
    const world = fakeWorld();
    const error = unwrapErr(await dispatchWitness({ deps: world.deps, env: {}, request: REQUEST }));

    expect(error.code).toBe("HOST_MISSING");
    expect(world.log).toEqual(["lock", "read", "release"]);
  });

  it("refuses an ambiguous host, and never boots anything", async () => {
    const world = fakeWorld();
    const env = { CLAUDE_CODE_SESSION_ID: "session-1", CODEX_THREAD_ID: "thread-1" };
    const error = unwrapErr(await dispatchWitness({ deps: world.deps, env, request: REQUEST }));

    expect(error.code).toBe("HOST_AMBIGUOUS");
    expect(world.log).toEqual(["lock", "read", "release"]);
  });

  it("writes nothing when the boot fails", async () => {
    const world = fakeWorld({ launch: { reason: "cmux is not running" } });
    const error = unwrapErr(await dispatchWitness({ deps: world.deps, env: CLAUDE_ENV, request: REQUEST }));

    expect(error.code).toBe("BOOT_FAILED");
    expect(error.message).toContain("cmux is not running");
    expect(world.journal).toEqual([]);
    expect(world.log).toEqual(["lock", "read", "launch", "release"]);
  });

  it("closes the booted workspace and sends nothing when the dispatch cannot be recorded", async () => {
    const world = fakeWorld({ appendFailsAt: 1 });
    const error = unwrapErr(await dispatchWitness({ deps: world.deps, env: CLAUDE_ENV, request: REQUEST }));

    expect(error.code).toBe("RECORD_FAILED");
    expect(world.log).toEqual([
      "lock",
      "read",
      "launch",
      "append-failed:dispatched",
      "close:workspace-id-1",
      "release",
    ]);
  });

  it("never sends the pickup when the record AND the close fail, and names the window left open", async () => {
    const world = fakeWorld({ appendFailsAt: 1, closeFailure: "socket refused" });
    const error = unwrapErr(await dispatchWitness({ deps: world.deps, env: CLAUDE_ENV, request: REQUEST }));

    expect(error.code).toBe("RECORD_FAILED");
    expect(error.message).toContain("workspace:1");
    expect(error.message).toContain("socket refused");
    expect(world.log.some((entry) => entry.startsWith("deliver:"))).toBe(false);
  });

  it("keeps an unwitnessed delivery live: no terminal, no close", async () => {
    const world = fakeWorld({ deliver: ok<PickupDelivery, SpawnFailureDetail>({ kind: "unwitnessed" }) });
    const outcome = unwrap(await dispatchWitness({ deps: world.deps, env: CLAUDE_ENV, request: REQUEST }));

    expect(outcome.delivery.kind).toBe("unwitnessed");
    expect(world.journal.map((event) => event.kind)).toEqual(["dispatched"]);
    expect(world.log.some((entry) => entry.startsWith("close:"))).toBe(false);
  });

  it("settles failed and closes the workspace when the pickup could not be sent", async () => {
    const world = fakeWorld({ deliver: err<PickupDelivery, SpawnFailureDetail>({ reason: "surface gone" }) });
    const error = unwrapErr(await dispatchWitness({ deps: world.deps, env: CLAUDE_ENV, request: REQUEST }));

    expect(error.code).toBe("PICKUP_UNSENT");
    expect(world.log).toEqual([
      "lock",
      "read",
      "launch",
      "append:dispatched",
      `deliver:slopweaver witness resume ${WITNESS_ID}`,
      "append:settled",
      "close:workspace-id-1",
      "release",
    ]);
    expect(world.journal[1]).toEqual({
      ...KEY,
      kind: "settled",
      outcome: "failed",
      schemaVersion: 1,
      tsIso: NOW,
      why: "the pickup line could not be sent into workspace:1: surface gone",
      witnessId: WITNESS_ID,
    });
  });

  it("keeps a pickup stranded in the composer LIVE with its workspace OPEN, naming cmux submit", async () => {
    const world = fakeWorld({
      deliver: err<PickupDelivery, SpawnFailureDetail>({
        reason: "the pickup is still TYPED, unsubmitted in workspace:1's composer",
        strandedInComposer: true,
      }),
    });
    const error = unwrapErr(await dispatchWitness({ deps: world.deps, env: CLAUDE_ENV, request: REQUEST }));

    expect(error.code).toBe("PICKUP_STRANDED");
    expect(error.message).toContain("`slopweaver cmux submit --workspace workspace:1`");
    expect(error.message).toContain(`slopweaver witness settle ${WITNESS_ID} --as failed`);
    expect(world.log).toEqual([
      "lock",
      "read",
      "launch",
      "append:dispatched",
      `deliver:slopweaver witness resume ${WITNESS_ID}`,
      "release",
    ]);
    expect(world.journal).toEqual([dispatchedRow()]);
  });

  // Seats idled at an empty prompt with nothing having seen the pickup go. A worker that may yet be
  // running it is never settled or closed under it — only a reader of the screen can say.
  it("keeps a pickup nothing saw submitted LIVE with its workspace OPEN, naming read-screen", async () => {
    const world = fakeWorld({
      deliver: err<PickupDelivery, SpawnFailureDetail>({
        pickupSubmissionUnproven: true,
        reason: "nothing saw the pickup submitted in workspace:1",
      }),
    });
    const error = unwrapErr(await dispatchWitness({ deps: world.deps, env: CLAUDE_ENV, request: REQUEST }));

    expect(error.code).toBe("PICKUP_UNPROVEN");
    expect(error.message).toContain("`slopweaver cmux read-screen --workspace workspace:1`");
    expect(error.message).toContain(`slopweaver witness settle ${WITNESS_ID} --as failed`);
    expect(world.log).toEqual([
      "lock",
      "read",
      "launch",
      "append:dispatched",
      `deliver:slopweaver witness resume ${WITNESS_ID}`,
      "release",
    ]);
    expect(world.journal).toEqual([dispatchedRow()]);
  });

  it("dispatches a failed witness again, closing the failed attempt's window BEFORE the new boot", async () => {
    const world = fakeWorld({ initial: [dispatchedRow(), failedRow()] });
    const outcome = unwrap(await dispatchWitness({ deps: world.deps, env: CLAUDE_ENV, request: REQUEST }));

    expect(outcome.witnessId).toBe(WITNESS_ID);
    expect(world.log).toEqual([
      "lock",
      "read",
      "reply-reserved?",
      "close:workspace-id-1",
      "launch",
      "append:dispatched",
      `deliver:slopweaver witness resume ${WITNESS_ID}`,
      "release",
    ]);
    expect(world.journal.map((event) => event.kind)).toEqual(["dispatched", "settled", "dispatched"]);
  });

  it("refuses a re-dispatch when a reply was ever reserved for the message, closing and booting nothing", async () => {
    const world = fakeWorld({ initial: [dispatchedRow(), failedRow()], replyReserved: true });
    const error = unwrapErr(await dispatchWitness({ deps: world.deps, env: CLAUDE_ENV, request: REQUEST }));

    expect(error.code).toBe("REPLY_ALREADY_RESERVED");
    expect(error.message).toContain("read the thread");
    expect(world.log).toEqual(["lock", "read", "reply-reserved?", "release"]);
    expect(world.journal.map((event) => event.kind)).toEqual(["dispatched", "settled"]);
  });

  it("refuses a re-dispatch when the failed attempt's window will not close, booting nothing", async () => {
    const world = fakeWorld({ closeFailure: "socket refused", initial: [dispatchedRow(), failedRow()] });
    const error = unwrapErr(await dispatchWitness({ deps: world.deps, env: CLAUDE_ENV, request: REQUEST }));

    expect(error.code).toBe("PREVIOUS_ATTEMPT_OPEN");
    expect(error.message).toContain("workspace:1 could not be closed (socket refused)");
    expect(world.log).toEqual(["lock", "read", "reply-reserved?", "close:workspace-id-1", "release"]);
  });

  it("never asks the send ledger on a first dispatch", async () => {
    const world = fakeWorld({ replyReserved: true });
    unwrap(await dispatchWitness({ deps: world.deps, env: CLAUDE_ENV, request: REQUEST }));

    expect(world.log.includes("reply-reserved?")).toBe(false);
  });

  it("refuses to dispatch a witness that settled with a verdict", async () => {
    const material: WitnessJournalEvent = {
      ...KEY,
      kind: "settled",
      outcome: "nothing-material",
      schemaVersion: 1,
      tsIso: NOW,
      why: "Datadog and CI agree",
      witnessId: WITNESS_ID,
    };
    const world = fakeWorld({ initial: [dispatchedRow(), material] });
    const error = unwrapErr(await dispatchWitness({ deps: world.deps, env: CLAUDE_ENV, request: REQUEST }));

    expect(error.code).toBe("ALREADY_SETTLED");
    expect(world.log).toEqual(["lock", "read", "release"]);
  });
});

describe("the stranded-pickup incident, end to end over one journal", () => {
  it("strands, is settled failed by the loop, then dispatches again into a fresh worker", async () => {
    const stranded = fakeWorld({
      deliver: err<PickupDelivery, SpawnFailureDetail>({ reason: "still TYPED", strandedInComposer: true }),
    });
    expect(unwrapErr(await dispatchWitness({ deps: stranded.deps, env: CLAUDE_ENV, request: REQUEST })).code).toBe(
      "PICKUP_STRANDED",
    );

    const settled = unwrap(
      await settleWitness({
        deps: stranded.deps,
        request: {
          outcome: "failed",
          postedTs: undefined,
          selector: { kind: "id", witnessId: WITNESS_ID },
          why: "cmux submit did not move the composer",
        },
      }),
    );
    expect(settled.closedWorkspaceRef).toBe("workspace:1");

    const retried = fakeWorld({ initial: stranded.journal });
    unwrap(await dispatchWitness({ deps: retried.deps, env: CLAUDE_ENV, request: REQUEST }));

    expect(retried.journal.map((event) => event.kind)).toEqual(["dispatched", "settled", "dispatched"]);
  });
});

describe("settleWitness", () => {
  it("appends the terminal BEFORE closing the dispatched workspace", async () => {
    const world = fakeWorld({ initial: [dispatchedRow()] });
    const settled = unwrap(
      await settleWitness({
        deps: world.deps,
        request: {
          outcome: "posted",
          postedTs: "1789000002.000300",
          selector: { kind: "id", witnessId: WITNESS_ID },
          why: undefined,
        },
      }),
    );

    expect(world.log).toEqual(["lock", "read", "append:settled", "release", "close:workspace-id-1"]);
    expect(settled.closedWorkspaceRef).toBe("workspace:1");
    expect(settled.event.postedTs).toBe("1789000002.000300");
  });

  it("closes nothing when no worker was ever dispatched", async () => {
    const world = fakeWorld();
    const settled = unwrap(
      await settleWitness({
        deps: world.deps,
        request: {
          outcome: "nothing-checkable",
          postedTs: undefined,
          selector: { key: KEY, kind: "key" },
          why: undefined,
        },
      }),
    );

    expect(world.log).toEqual(["lock", "read", "append:settled", "release"]);
    expect(settled.closedWorkspaceRef).toBeUndefined();
  });

  it("records nothing while a dispatch holds the lock, so no terminal lands mid-launch", async () => {
    const world = fakeWorld({ lockHeldBy: "held by pid 4242" });
    const error = unwrapErr(
      await settleWitness({
        deps: world.deps,
        request: {
          outcome: "nothing-checkable",
          postedTs: undefined,
          selector: { key: KEY, kind: "key" },
          why: undefined,
        },
      }),
    );

    expect(error.code).toBe("SETTLE_LOCKED");
    expect(error.message).toContain("held by pid 4242");
    expect(world.log).toEqual(["lock-refused"]);
    expect(world.journal).toEqual([]);
  });

  it("reports a failed close only after the terminal is durable", async () => {
    const world = fakeWorld({ closeFailure: "socket refused", initial: [dispatchedRow()] });
    const error = unwrapErr(
      await settleWitness({
        deps: world.deps,
        request: {
          outcome: "nothing-material",
          postedTs: undefined,
          selector: { kind: "id", witnessId: WITNESS_ID },
          why: "Datadog and CI agree",
        },
      }),
    );

    expect(error.code).toBe("CLEANUP_FAILED");
    expect(error.message).toContain("socket refused");
    expect(world.journal.map((event) => event.kind)).toEqual(["dispatched", "settled"]);
  });

  it("writes and closes nothing when the settle is refused", async () => {
    const world = fakeWorld({ initial: [dispatchedRow()] });
    const error = unwrapErr(
      await settleWitness({
        deps: world.deps,
        request: {
          outcome: "posted",
          postedTs: undefined,
          selector: { kind: "id", witnessId: WITNESS_ID },
          why: undefined,
        },
      }),
    );

    expect(error.code).toBe("POSTED_TS_REQUIRED");
    expect(world.log).toEqual(["lock", "read", "release"]);
  });
});
