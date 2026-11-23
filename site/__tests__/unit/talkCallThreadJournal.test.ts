/*
 * A call's thread journal over a plain fake port: what it keeps and drops, one batch in flight with the rest queued
 * behind it, a failed batch posted again with the same writeIds after a back-off, a refused one stopping the journal
 * loudly, and a drain that says how much was left.
 */
import { describe, expect, it } from "vitest";

import { CallThreadJournal, unwrittenCallThreadLines } from "../../lib/talkCallThreadJournal";
import { wireCapture } from "../../lib/talkCallThreadWire";

const CALL = "a0000041-0000-4000-8000-000000000044";

type Outcome = { readonly why: string; readonly exitCode: number | undefined } | undefined;

/** A port whose appends wait for the test to settle each one, in order. */
function fakePort(): {
  port: ConstructorParameters<typeof CallThreadJournal>[0]["port"];
  batches: { readonly writeIds: readonly string[]; readonly kinds: readonly string[] }[];
  settleNext: (outcome: Outcome) => Promise<void>;
  waits: number[];
  reports: string[];
} {
  const batches: { writeIds: string[]; kinds: string[] }[] = [];
  const pending: ((outcome: Outcome) => void)[] = [];
  const waits: number[] = [];
  const reports: string[] = [];
  let ids = 0;
  return {
    batches,
    port: {
      append: ({ jsonl }) => {
        const entries = jsonl
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line) as { writeId: string; capture: { kind: string } });
        batches.push({ kinds: entries.map((e) => e.capture.kind), writeIds: entries.map((e) => e.writeId) });
        return new Promise<Outcome>((resolve) => {
          pending.push(resolve);
        });
      },
      newWriteId: () => {
        ids += 1;
        return `w${String(ids)}`;
      },
      nowIso: () => "2026-11-02T05:00:00.000Z",
      report: ({ line }) => {
        reports.push(line);
      },
      wait: async ({ ms }) => {
        waits.push(ms);
      },
    },
    reports,
    settleNext: async (outcome) => {
      pending.shift()!(outcome);
      for (let i = 0; i < 10; i += 1) {
        await Promise.resolve();
      }
    },
    waits,
  };
}

const notice = ({ method, threadId }: { method: string; threadId: string }) => ({
  method,
  params: { item: { type: "agentMessage" }, threadId, turnId: "t-1" },
});

describe("CallThreadJournal", () => {
  it("keeps this thread's turn frames and completed items, a held one in its arrival order, and nothing else", async () => {
    const f = fakePort();
    const journal = new CallThreadJournal({ callId: CALL, port: f.port });
    journal.threadStarting({ params: { ephemeral: true }, surface: "voice" });
    journal.observe(notice({ method: "turn/started", threadId: "thr-1" }));
    journal.observe(notice({ method: "turn/started", threadId: "thr-other" }));
    journal.threadStarted({ threadId: "thr-1" });
    journal.observe(notice({ method: "item/agentMessage/delta", threadId: "thr-1" }));
    journal.observe(notice({ method: "thread/realtime/transcript/done", threadId: "thr-1" }));
    journal.observe(notice({ method: "item/completed", threadId: "thr-other" }));
    journal.observe(notice({ method: "item/completed", threadId: "thr-1" }));
    await f.settleNext(undefined);
    expect(f.batches.map((batch) => batch.kinds)).toEqual([
      ["thread-start-requested"],
      ["notification", "thread-started", "notification"],
    ]);
  });

  it("holds what arrives while a batch is out and sends it next, in order, as one batch", async () => {
    const f = fakePort();
    const journal = new CallThreadJournal({ callId: CALL, port: f.port });
    journal.threadStarted({ threadId: "thr-1" });
    journal.observe(notice({ method: "turn/started", threadId: "thr-1" }));
    journal.observe(notice({ method: "turn/completed", threadId: "thr-1" }));
    expect(journal.pendingCount).toBe(3);
    await f.settleNext(undefined);
    await f.settleNext(undefined);
    expect([f.batches.map((batch) => batch.writeIds), journal.pendingCount]).toEqual([[["w1"], ["w2", "w3"]], 0]);
  });

  it("posts a failed batch again with the same writeIds, backing off, and says so", async () => {
    const f = fakePort();
    const journal = new CallThreadJournal({ callId: CALL, port: f.port });
    journal.threadStarted({ threadId: "thr-1" });
    await f.settleNext({ exitCode: 1, why: "the home is locked" });
    await f.settleNext({ exitCode: undefined, why: "timed out" });
    await f.settleNext(undefined);
    expect(f.batches.map((batch) => batch.writeIds)).toEqual([["w1"], ["w1"], ["w1"]]);
    expect(f.waits).toEqual([1000, 2000]);
    expect(f.reports[0]).toBe(
      `talk call-thread (call ${CALL}): a batch of 1 was not written, retrying in 1s: the home is locked`,
    );
    expect(journal.pendingCount).toBe(0);
  });

  it("stops for good on a refused batch, saying so loudly, and says at close what arrived after it", async () => {
    const f = fakePort();
    const journal = new CallThreadJournal({ callId: CALL, port: f.port });
    journal.threadStarted({ threadId: "thr-1" });
    journal.observe(notice({ method: "turn/started", threadId: "thr-1" }));
    await f.settleNext({ exitCode: 2, why: "a secret survived" });
    journal.observe(notice({ method: "turn/completed", threadId: "thr-1" }));
    expect(f.batches.length).toBe(1);
    expect(journal.stopped).toBe(true);
    expect(journal.pendingCount).toBe(2);
    expect(await journal.drained({ timeoutMs: 10 })).toBe(2);
    journal.close();
    journal.close();
    journal.observe(notice({ method: "item/completed", threadId: "thr-1" }));
    expect(f.reports).toEqual([
      `talk call-thread (call ${CALL}): the journal verb REFUSED a batch, so this call's thread journal stops here with 2 entr(ies) unwritten: a secret survived`,
      `talk call-thread (call ${CALL}): 1 more entr(ies) arrived after the refused batch and are not in the journal`,
      `talk call-thread (call ${CALL}): a notification entry arrived after the refused batch and the call's close, so it is not in the journal`,
    ]);
    expect(journal.unwrittenCount).toBe(4);
  });

  it("records a tool answer with its call's ids, an absent turn as null", async () => {
    const f = fakePort();
    const journal = new CallThreadJournal({ callId: CALL, port: f.port });
    const call = { arguments: "{}", callId: "c1", threadId: "thr-1", tool: "search", turnId: undefined };
    journal.toolAnswered({ call, contentItems: [{ text: "hit", type: "inputText" }], success: true });
    await f.settleNext(undefined);
    expect(f.batches[0].kinds).toEqual(["tool-answer"]);
  });

  it("still journals the bound thread's late output once closed, writing all of it", async () => {
    const f = fakePort();
    const journal = new CallThreadJournal({ callId: CALL, port: f.port });
    journal.threadStarted({ threadId: "thr-1" });
    journal.close();
    journal.observe(notice({ method: "turn/completed", threadId: "thr-1" }));
    await f.settleNext(undefined);
    await f.settleNext(undefined);
    expect([f.batches.map((batch) => batch.kinds), journal.unwrittenCount, f.reports]).toEqual([
      [["thread-started"], ["notification"]],
      0,
      [],
    ]);
  });

  it("names a refused journal at exit with what it held and what came after, though the call never closed", async () => {
    const callId = "a0000079-0000-4000-8000-000000000086";
    const mine = () => unwrittenCallThreadLines({ when: "at exit" }).filter((line) => line.includes(callId));
    const f = fakePort();
    const journal = new CallThreadJournal({ callId, port: f.port });
    journal.threadStarted({ threadId: "thr-1" });
    await f.settleNext({ exitCode: 2, why: "a secret survived" });
    journal.observe(notice({ method: "turn/started", threadId: "thr-1" }));
    expect(mine()).toEqual([`talk call-thread (call ${callId}): 2 journal entr(ies) unwritten at exit`]);
  });

  it("says how many notifications were held for a thread that never started, and each one after", async () => {
    const f = fakePort();
    const journal = new CallThreadJournal({ callId: CALL, port: f.port });
    journal.threadStarting({ params: { ephemeral: true }, surface: "voice" });
    await f.settleNext(undefined);
    journal.observe(notice({ method: "turn/started", threadId: "thr-1" }));
    journal.observe(notice({ method: "item/completed", threadId: "thr-1" }));
    journal.close();
    const atClose = [...f.reports];
    journal.threadNeverStarted();
    journal.observe(notice({ method: "turn/completed", threadId: "thr-1" }));
    journal.threadNeverStarted();
    expect([atClose, f.batches.map((batch) => batch.kinds), journal.pendingCount, f.reports]).toEqual([
      [],
      [["thread-start-requested"]],
      0,
      [
        `talk call-thread (call ${CALL}): 2 notification(s) arrived before a thread that never started, so they are not in the journal`,
        `talk call-thread (call ${CALL}): a turn/completed notification arrived for a thread that never started, so it is not in the journal`,
      ],
    ]);
  });

  it("journals what was held when the thread binds only after the call closed — one stdout chunk carrying both", async () => {
    const f = fakePort();
    const journal = new CallThreadJournal({ callId: CALL, port: f.port });
    journal.observe(notice({ method: "turn/started", threadId: "thr-1" }));
    journal.close();
    journal.observe(notice({ method: "item/completed", threadId: "thr-1" }));
    journal.threadStarted({ threadId: "thr-1" });
    await f.settleNext(undefined);
    await f.settleNext(undefined);
    expect([f.batches.map((batch) => batch.kinds), journal.pendingCount, f.reports]).toEqual([
      [["notification"], ["notification", "thread-started"]],
      0,
      [],
    ]);
  });

  it("keeps the journals awaiting a write in one process-global set, which a reloaded module's drain still reads", async () => {
    const f = fakePort();
    const journal = new CallThreadJournal({ callId: CALL, port: f.port });
    journal.threadStarted({ threadId: "thr-1" });
    const held = (globalThis as Record<symbol, unknown>)[
      Symbol.for("slopweaver.talk.callThreadJournals")
    ] as Set<unknown>;
    const whileOut = held.has(journal);
    await f.settleNext(undefined);
    expect([whileOut, held.has(journal)]).toEqual([true, false]);
  });

  it("names each call still holding unwritten entries, synchronously, for the drain or exit hook to say", async () => {
    const callId = "a0000072-0000-4000-8000-000000000078";
    const mine = () => unwrittenCallThreadLines({ when: "at exit" }).filter((line) => line.includes(callId));
    const f = fakePort();
    const journal = new CallThreadJournal({ callId, port: f.port });
    journal.threadStarted({ threadId: "thr-1" });
    journal.observe(notice({ method: "turn/started", threadId: "thr-1" }));
    const whileOut = mine();
    await f.settleNext(undefined);
    await f.settleNext(undefined);
    expect([whileOut, mine()]).toEqual([
      [`talk call-thread (call ${callId}): 2 journal entr(ies) unwritten at exit`],
      [],
    ]);
  });
});

describe("wireCapture", () => {
  it("sends absent params as null, which the verb's strict envelope requires", () => {
    expect(wireCapture({ capture: { kind: "notification", method: "turn/started", params: undefined } })).toEqual({
      kind: "notification",
      method: "turn/started",
      params: null,
    });
  });

  it("refuses an id the verb would refuse its whole batch for", () => {
    const answer = {
      arguments: "{}",
      contentItems: [],
      kind: "tool-answer",
      success: true,
      threadId: "thr-1",
      tool: "t".repeat(201),
      toolCallId: "c1",
      turnId: null,
    } as const;
    expect(wireCapture({ capture: answer })).toBe(undefined);
    expect(wireCapture({ capture: { kind: "thread-started", threadId: "" } })).toBe(undefined);
    expect(wireCapture({ capture: { ...answer, tool: "search" } })).toEqual({ ...answer, tool: "search" });
  });
});
