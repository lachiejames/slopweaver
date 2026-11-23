/**
 * A quiet stretch of the owner's reaches the pinned chair as ONE turn, two minutes after their last word: the line
 * names every unread stretch and held relay in the order they said them and carries none of their
 * words, one unread batch costs one wake judged by bytes, and the shell records what became of it on the wake and on
 * every relay it carried. Over a throwaway home; the typing is a plain fake passed in.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { wakeChairLine } from "../../../cli/commands/talk/wakeChairRun.js";
import { unwrap } from "../../../lib/result.js";
import { type BatchAnchor, chairBatchLine, chairBatchMembers } from "../../../talk/chairBatchLine.js";
import {
  chairWakeCallId,
  chairWakeLine,
  decideChairWake,
  type HeldRelay,
  QUIET_BEFORE_DELIVERY_MS,
  REWAKE_AFTER_MS,
} from "../../../talk/chairWake.js";
import { wakeChair } from "../../../talk/chairWakeShell.js";
import { chairWakePath, readLastChairWake } from "../../../talk/chairWakeStore.js";
import type { Delivery } from "../../../talk/deliveryOutcome.js";
import { settleHeldRelay } from "../../../talk/relayCourier.js";
import { courierTurns, enqueueCourier } from "../../../talk/relayCourierStore.js";
import { formRelayDraft } from "../../../talk/relayDraft.js";
import type { StartOf } from "../../../talk/relayLease.js";
import { claimTurn, markDelivered, markRegistered, readTurn } from "../../../talk/relayStore.js";
import { writeUnreadCursor } from "../../../talk/unreadCursorStore.js";
import { readUnread } from "../../../talk/unreadRead.js";
import { advancedCursor, formatCallPointer } from "../../../talk/unreadWords.js";

import { wakeOf, woken } from "./chairWakeNarrowing.js";

const CALL = "a0000035-0000-4000-8000-000000000038";
const OTHER = "2b7f6c1e-3d4a-4e5f-8a9b-0c1d2e3f4a5b";
const TURN = "951b9e45-6fc9-45fd-8e25-d04ded7164c9";
/** When the fixtures' stretches were spoken. */
const SPOKEN = "2026-10-01T15:39:00.000Z";
/** Exactly the owner's two quiet minutes after {@link SPOKEN}. */
const NOW = "2026-10-01T15:41:00.000Z";
/** The waking process, running, so no `ps` is spawned to ask. */
const LOCK = { pid: 101, startOf: () => ({ running: true, start: "t101" }) };
/**
 * A waking process `ps` stamps, for which every OTHER pid answers a signal with no start `ps` could read — the
 * writer itself must be stamped, since a lock that never ages refuses an unstamped one (`talk/callLock.ts`).
 */
const stampsOnly202: StartOf = (pid) => ({ running: true, start: pid === 202 ? "t202" : undefined });
const UNKNOWN_OTHERS = { pid: 202, startOf: stampsOnly202 };

/** An instant `ms` after another. */
const after = ({ iso, ms }: { iso: string; ms: number }): string => new Date(Date.parse(iso) + ms).toISOString();

const segment = ({
  id,
  text,
  final = true,
  atIso = SPOKEN,
}: {
  id: string;
  text: string;
  final?: boolean;
  atIso?: string;
}): string => `${JSON.stringify({ atIso, final, id, kind: "segment", text, who: "owner" })}\n`;

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "chair-wake-"));
  mkdirSync(join(home, "talk", "calls"), { recursive: true });
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

const callFile = ({ callId }: { callId: string }): string => join(home, "talk", "calls", `${callId}.jsonl`);

const stretch = ({ callId = CALL, segmentId }: { callId?: string; segmentId: string }): BatchAnchor => ({
  kind: "stretch",
  pointer: formatCallPointer({ callId, segmentId }),
});

/** Every line `wake` was asked to type, and the delivery it answers with. */
const typer = ({ kind = "typed" }: { kind?: Delivery["kind"] } = {}) => {
  const typed: string[] = [];
  const deliver = async ({ line }: { line: string }): Promise<Delivery> => {
    typed.push(line);
    const detail = `${kind} into the fake chair`;
    if (kind === "failed" || kind === "skipped") {
      return { atIso: NOW, detail, kind, refusal: "composer-busy", via: "direct" };
    }
    return { atIso: NOW, detail, kind, via: "direct" };
  };
  return { deliver, typed };
};

const report = async ({
  deliver,
  nowIso = NOW,
  dryRun = false,
  lock = LOCK,
}: {
  deliver: (options: { line: string }) => Promise<Delivery>;
  nowIso?: string;
  dryRun?: boolean;
  lock?: { pid: number; startOf: StartOf };
}) => unwrap(await wakeChair({ deliver, dryRun, home, lock, nowIso: () => nowIso }));

const wake = async (options: Parameters<typeof report>[0]) => (await report(options)).outcome;

/** Mark everything the chair can read now — `talk unread --mark` over one batch that holds it all. */
const markAll = (): void => {
  const read = unwrap(readUnread({ home, name: "supervisor", nowIso: NOW }));
  unwrap(writeUnreadCursor({ cursor: advancedCursor({ read, recordedAtIso: NOW }), home, name: "supervisor" }));
};

/** A relay the voice registered and held for the chair's batch at `heldAtIso`, its request queued; its slug. */
const holdRelay = ({ heldAtIso }: { heldAtIso: string }): string => {
  const draft = unwrap(
    formRelayDraft({
      about: "",
      heard: "merge the stack",
      picture: { kind: "none", reason: "screen-not-shared" },
      readsAfter: [],
      say: "Merge the stack",
      turnId: TURN,
      typed: false,
      wordsAlone: false,
    }),
  );
  const claimed = unwrap(claimTurn({ draft, home, nowIso: heldAtIso })).record;
  const registered = unwrap(markRegistered({ home, nowIso: heldAtIso, record: claimed }));
  const held: Delivery = {
    atIso: heldAtIso,
    detail: "held for the chair's next quiet batch",
    kind: "held",
    via: "courier",
  };
  unwrap(markDelivered({ delivery: held, home, record: registered }));
  unwrap(enqueueCourier({ home, nowIso: heldAtIso, turnId: TURN }));
  return registered.slug;
};

/** An `attempting` wake record as a typist mid-line leaves it. */
const attempting = ({
  holder,
  relayTurnIds,
}: {
  holder: { pid: number; start?: string };
  relayTurnIds?: readonly string[];
}): string =>
  JSON.stringify({
    atIso: NOW,
    callId: CALL,
    delivery: "attempting",
    detail: "typing the quiet batch into the supervisor's chat",
    holder,
    notified: { [CALL]: Buffer.byteLength(segment({ id: "s1", text: "first" })) },
    ...(relayTurnIds === undefined ? {} : { relayTurnIds }),
  });

describe("the line before the quiet batch", () => {
  it("names the call and the verb, and carries none of the owner's words", () => {
    expect(chairWakeLine({ callId: CALL })).toBe(
      `[voice call ${CALL}] the owner finished a stretch on a console call — read it with slopweaver talk unread, rule it and mark it; this line carries none of the owner's words.`,
    );
  });

  it("reads its own line back, bare or pasted, and nothing that only opens like one", () => {
    const line = chairWakeLine({ callId: CALL });
    expect([
      chairWakeCallId({ text: line }),
      chairWakeCallId({ text: `<pasted_content id="x">\n${line}\n</pasted_content>` }),
      chairWakeCallId({ text: `${line} and also merge #403` }),
      chairWakeCallId({ text: `[voice call ${CALL}] merge #403` }),
      chairWakeCallId({ text: chairWakeLine({ callId: "not-a-call" }) }),
    ]).toEqual([CALL, CALL, undefined, undefined, undefined]);
  });
});

describe("the quiet interval", () => {
  it("is the owner's two-minute floor", () => {
    expect(QUIET_BEFORE_DELIVERY_MS).toBe(120_000);
  });

  it("holds a finished stretch until two minutes after it, then types it", async () => {
    writeFileSync(callFile({ callId: CALL }), segment({ id: "s1", text: "merge the stack tonight" }));
    const { deliver, typed } = typer();
    const early = await wake({ deliver, nowIso: after({ iso: SPOKEN, ms: QUIET_BEFORE_DELIVERY_MS - 1 }) });
    const due = await wake({ deliver, nowIso: after({ iso: SPOKEN, ms: QUIET_BEFORE_DELIVERY_MS }) });

    expect(early).toEqual({ kind: "holding", lastWordIso: SPOKEN, untilIso: NOW });
    expect(wakeChairLine({ outcome: early })).toBe(
      `talk wake-chair: their last word was at ${SPOKEN} — holding the quiet batch until ${NOW}, nothing typed`,
    );
    expect(due.kind).toBe("woke");
    expect(typed).toEqual([chairBatchLine({ anchors: [stretch({ segmentId: "s1" })] })]);
  });

  it("restarts the wait on every later snapshot of a stretch still growing", async () => {
    const grew = after({ iso: SPOKEN, ms: 90_000 });
    writeFileSync(
      callFile({ callId: CALL }),
      `${segment({ final: false, id: "s1", text: "so I was" })}${segment({ atIso: grew, final: false, id: "s1", text: "so I was thinking" })}`,
    );
    const { deliver, typed } = typer();
    const held = await wake({ deliver });

    expect(held).toEqual({ kind: "holding", lastWordIso: grew, untilIso: after({ iso: grew, ms: 120_000 }) });
    expect(typed).toEqual([]);
  });

  it("says a stretch whose snapshots stopped two minutes ago, whether or not the transcriber closed it", async () => {
    writeFileSync(callFile({ callId: CALL }), segment({ final: false, id: "s1", text: "so I was" }));
    const { deliver, typed } = typer();

    expect((await wake({ deliver })).kind).toBe("woke");
    expect(typed).toEqual([chairBatchLine({ anchors: [stretch({ segmentId: "s1" })] })]);
  });

  it("holds every stretch, the oldest too, while the owner is still talking on another call", async () => {
    writeFileSync(callFile({ callId: CALL }), segment({ id: "s1", text: "old" }));
    writeFileSync(callFile({ callId: OTHER }), segment({ atIso: after({ iso: NOW, ms: -1 }), id: "s9", text: "new" }));
    const { deliver, typed } = typer();

    expect((await wake({ deliver })).kind).toBe("holding");
    expect(typed).toEqual([]);
  });
});

describe("one turn per quiet stretch", () => {
  it("types three stretches as one line naming each, in the order they said them", async () => {
    writeFileSync(
      callFile({ callId: CALL }),
      [
        segment({ atIso: "2026-10-01T15:37:00.000Z", id: "s1", text: "merge the stack" }),
        segment({ atIso: "2026-10-01T15:38:00.000Z", id: "s2", text: "no wait, after the bump" }),
        segment({ atIso: SPOKEN, id: "s3", text: "and tell the chair" }),
      ].join(""),
    );
    const { deliver, typed } = typer();
    const woke = await wake({ deliver });

    expect(woke.kind).toBe("woke");
    expect(typed).toEqual([
      chairBatchLine({
        anchors: [stretch({ segmentId: "s1" }), stretch({ segmentId: "s2" }), stretch({ segmentId: "s3" })],
      }),
    ]);
  });

  it("orders stretches across calls by when they said them, and names the newest one's call", async () => {
    // The second call sorts FIRST by id, so only its later instant can make it the newest.
    writeFileSync(callFile({ callId: CALL }), segment({ id: "s1", text: "on the first call" }));
    writeFileSync(
      callFile({ callId: OTHER }),
      segment({ atIso: "2026-10-01T15:39:30.000Z", id: "s9", text: "on the second" }),
    );
    const { deliver, typed } = typer();
    await wake({ deliver, nowIso: "2026-10-01T15:41:30.000Z" });
    const stored = readLastChairWake({ path: chairWakePath({ home }) }).record!;

    expect(typed).toEqual([
      chairBatchLine({ anchors: [stretch({ segmentId: "s1" }), stretch({ callId: OTHER, segmentId: "s9" })] }),
    ]);
    expect(stored.callId).toBe(OTHER);
    expect(Object.keys(stored.notified).toSorted()).toEqual([OTHER, CALL].toSorted());
  });

  it("records a typed batch, and coalesces the next stretch into it while the chair has not read past it", async () => {
    writeFileSync(callFile({ callId: CALL }), segment({ id: "s1", text: "merge the stack tonight" }));
    const { deliver, typed } = typer();
    const first = await wake({ deliver });
    const later = after({ iso: NOW, ms: 60_000 });
    writeFileSync(
      callFile({ callId: CALL }),
      `${segment({ id: "s1", text: "merge the stack tonight" })}${segment({ atIso: later, id: "s2", text: "and the bump" })}`,
    );
    const second = await wake({ deliver, nowIso: after({ iso: later, ms: QUIET_BEFORE_DELIVERY_MS }) });

    expect([first.kind, second.kind]).toEqual(["woke", "coalesced"]);
    expect(typed.length).toBe(1);
    const stored = readLastChairWake({ path: chairWakePath({ home }) }).record!;
    expect([stored.callId, stored.delivery, stored.detail, stored.relayTurnIds, stored.notified[CALL]]).toEqual([
      CALL,
      "typed",
      "typed into the fake chair",
      [],
      Buffer.byteLength(segment({ id: "s1", text: "merge the stack tonight" })),
    ]);
  });

  it("wakes again once the chair has read past the last wake and the owner finishes another stretch", async () => {
    writeFileSync(callFile({ callId: CALL }), segment({ id: "s1", text: "first" }));
    const { deliver, typed } = typer();
    await wake({ deliver });
    markAll();
    const between = await wake({ deliver });
    const later = after({ iso: NOW, ms: 60_000 });
    writeFileSync(
      callFile({ callId: CALL }),
      `${segment({ id: "s1", text: "first" })}${segment({ atIso: later, id: "s2", text: "second" })}`,
    );
    const next = await wake({ deliver, nowIso: after({ iso: later, ms: QUIET_BEFORE_DELIVERY_MS }) });

    expect([between.kind, next.kind]).toEqual(["nothing-unread", "woke"]);
    expect(typed).toEqual([
      chairBatchLine({ anchors: [stretch({ segmentId: "s1" })] }),
      chairBatchLine({ anchors: [stretch({ segmentId: "s2" })] }),
    ]);
  });

  it("wakes again past the ceiling when the chair never read the last one", async () => {
    writeFileSync(callFile({ callId: CALL }), segment({ id: "s1", text: "first" }));
    const { deliver, typed } = typer();
    await wake({ deliver });
    const late = after({ iso: NOW, ms: REWAKE_AFTER_MS });
    const held = await wake({ deliver, nowIso: after({ iso: late, ms: -1 }) });
    const again = await wake({ deliver, nowIso: late });

    expect([held.kind, again.kind, typed.length]).toEqual(["coalesced", "woke", 2]);
  });

  it.each(["skipped", "failed", "stranded"] as const)("never lets a %s wake hold the next one back", async (kind) => {
    writeFileSync(callFile({ callId: CALL }), segment({ id: "s1", text: "first" }));
    const missed = typer({ kind });
    await wake({ deliver: missed.deliver });
    const { deliver, typed } = typer();
    expect((await wake({ deliver })).kind).toBe("woke");
    expect(typed).toEqual([chairBatchLine({ anchors: [stretch({ segmentId: "s1" })] })]);
  });

  it("lets a wake left attempting by a process no longer running hold nothing, and one still typing coalesce", async () => {
    writeFileSync(callFile({ callId: CALL }), segment({ id: "s1", text: "first" }));
    const { deliver, typed } = typer();
    writeFileSync(chairWakePath({ home }), attempting({ holder: { pid: 101, start: "t101" } }));
    const live = await wake({ deliver });
    // Pid 101 now started at another instant: the process that wrote the record was killed and its pid reused.
    writeFileSync(chairWakePath({ home }), attempting({ holder: { pid: 101, start: "an earlier start" } }));
    const dead = await wake({ deliver });
    // No start stamp was read when it was written, so a reused pid could not be told apart.
    writeFileSync(chairWakePath({ home }), attempting({ holder: { pid: 101 } }));
    const unstamped = await wake({ deliver });
    // Pid 101 answers a signal but `ps` cannot say when it started, so it may be the pid's next owner.
    writeFileSync(chairWakePath({ home }), attempting({ holder: { pid: 101, start: "t101" } }));
    const unreadable = await wake({
      deliver,
      lock: UNKNOWN_OTHERS,
    });

    expect([live.kind, dead.kind, unstamped.kind, unreadable.kind]).toEqual(["coalesced", "woke", "woke", "woke"]);
    expect(typed.length).toBe(3);
    expect(readLastChairWake({ path: chairWakePath({ home }) }).record!.holder).toBe(undefined);
  });

  it("decides on a dry run but types and records nothing", async () => {
    writeFileSync(callFile({ callId: CALL }), segment({ id: "s1", text: "first" }));
    const { deliver, typed } = typer();
    const outcome = await wake({ deliver, dryRun: true });

    expect(wakeChairLine({ outcome })).toBe(
      `talk wake-chair: would type: ${chairBatchLine({ anchors: [stretch({ segmentId: "s1" })] })}`,
    );
    expect(typed).toEqual([]);
    expect(readLastChairWake({ path: chairWakePath({ home }) })).toEqual({ record: undefined, unreadable: undefined });
  });

  it("wakes over a record it cannot read rather than trust it, and says why", async () => {
    writeFileSync(callFile({ callId: CALL }), segment({ id: "s1", text: "first" }));
    writeFileSync(chairWakePath({ home }), '{"atIso":"never"}');
    const { deliver, typed } = typer();
    const woke = await report({ deliver });

    expect(woke.outcome.kind).toBe("woke");
    expect(woke.unreadable).toContain(`${chairWakePath({ home })} is not a wake record:`);
    expect(typed.length).toBe(1);
    expect(JSON.parse(readFileSync(chairWakePath({ home }), "utf8")).delivery).toBe("typed");
  });

  it("says a record that is not JSON, and says nothing of one that is not there", async () => {
    writeFileSync(callFile({ callId: CALL }), segment({ id: "s1", text: "first" }));
    const { deliver } = typer();
    const absent = await report({ deliver, dryRun: true });
    writeFileSync(chairWakePath({ home }), "{");
    const broken = await report({ deliver, dryRun: true });

    expect(absent.unreadable).toBe(undefined);
    expect(broken.unreadable).toContain(`${chairWakePath({ home })} is not JSON:`);
  });

  it("removes no dropped request when the wake cannot be staged, so its drop is reported next pass", async () => {
    writeFileSync(callFile({ callId: CALL }), segment({ id: "s1", text: "first" }));
    unwrap(enqueueCourier({ home, nowIso: NOW, turnId: OTHER }));
    mkdirSync(chairWakePath({ home }), { recursive: true });
    const { deliver, typed } = typer();
    const refused = await wakeChair({ deliver, dryRun: false, home, lock: LOCK, nowIso: () => NOW });

    expect(refused._unsafeUnwrapErr().code).toBe("CHAIR_WAKE_STORE_FAILED");
    expect(typed).toEqual([]);
    expect(unwrap(courierTurns({ home, stage: "pending" }))).toEqual([OTHER]);
  });

  it("refuses when the chair's cursor cannot be read, rather than wake or stay silent on a guess", async () => {
    writeFileSync(callFile({ callId: CALL }), segment({ id: "s1", text: "first" }));
    mkdirSync(join(home, "talk", "unread-cursors"), { recursive: true });
    writeFileSync(join(home, "talk", "unread-cursors", "supervisor.json"), "{}");
    const { deliver, typed } = typer();
    const refused = await wakeChair({ deliver, dryRun: false, home, lock: LOCK, nowIso: () => NOW });

    expect(refused._unsafeUnwrapErr().code).toBe("CHAIR_WAKE_UNREAD_FAILED");
    expect(typed).toEqual([]);
  });
});

describe("a held relay rides the batch", () => {
  it("is named beside the stretches in the order they said them, and is settled by the line that carried it", async () => {
    writeFileSync(
      callFile({ callId: CALL }),
      `${segment({ atIso: "2026-10-01T15:38:00.000Z", id: "s1", text: "merge the stack" })}${segment({ id: "s2", text: "after the bump" })}`,
    );
    const slug = holdRelay({ heldAtIso: "2026-10-01T15:38:30.000Z" });
    const { deliver, typed } = typer();
    const woke = await report({ deliver });

    expect(typed).toEqual([
      chairBatchLine({
        anchors: [stretch({ segmentId: "s1" }), { kind: "relay", slug }, stretch({ segmentId: "s2" })],
      }),
    ]);
    expect(woken({ outcome: woke.outcome }).carried.map((carried) => carried.turnId)).toEqual([TURN]);
    expect(unwrap(readTurn({ home, turnId: TURN })).delivery).toEqual<Delivery>({
      atIso: NOW,
      detail: `on the quiet batch of ${NOW}: typed into the fake chair`,
      kind: "typed",
      via: "direct",
    });
    expect(unwrap(courierTurns({ home, stage: "pending" }))).toEqual([]);
    expect(readLastChairWake({ path: chairWakePath({ home }) }).record!.relayTurnIds).toEqual([TURN]);
  });

  it("is the owner's last word: a relay held a minute ago holds a batch of older stretches", async () => {
    writeFileSync(callFile({ callId: CALL }), segment({ id: "s1", text: "merge the stack" }));
    holdRelay({ heldAtIso: after({ iso: NOW, ms: -60_000 }) });
    const { deliver, typed } = typer();

    expect(await wake({ deliver })).toEqual({
      kind: "holding",
      lastWordIso: after({ iso: NOW, ms: -60_000 }),
      untilIso: after({ iso: NOW, ms: 60_000 }),
    });
    expect(typed).toEqual([]);
  });

  it("carries only the relays its line names; one the bound counts stays held for the next batch", () => {
    const relays: HeldRelay[] = Array.from({ length: 40 }, (_, index) => ({
      heard: "take the set",
      heardEdges: { end: "kept", start: "kept" },
      heldAtIso: after({ iso: SPOKEN, ms: index - 1_000 }),
      slug: `talk-${index.toString(16).padStart(12, "0")}`,
      turnId: `turn-${String(index)}`,
    }));
    const decision = decideChairWake({
      holderState: () => "gone",
      last: undefined,
      nowIso: NOW,
      read: { bootstrapFloorIso: undefined, cursor: undefined, quarantined: [], tails: [] },
      relays,
      words: [],
    });
    const carried = wakeOf({ decision }).relays;
    const members = chairBatchMembers({ text: wakeOf({ decision }).line })!;

    expect(carried.length).toBeGreaterThan(0);
    expect(carried.length).toBeLessThan(relays.length);
    expect(carried).toEqual(relays.slice(0, carried.length));
    expect(members).toEqual({
      listed: carried.map((relay): BatchAnchor => ({ kind: "relay", slug: relay.slug })),
      relays: carried.length,
      stretches: 0,
    });
  });

  it("types a relay alone, with no stretch unread", async () => {
    const slug = holdRelay({ heldAtIso: SPOKEN });
    const { deliver, typed } = typer();
    const woke = await wake({ deliver });

    expect(woken({ outcome: woke }).callId).toBe(undefined);
    expect(typed).toEqual([chairBatchLine({ anchors: [{ kind: "relay", slug }] })]);
  });

  it("is never coalesced into a wake still pending, which never showed it to the chair", async () => {
    writeFileSync(callFile({ callId: CALL }), segment({ id: "s1", text: "first" }));
    const { deliver, typed } = typer();
    await wake({ deliver });
    const slug = holdRelay({ heldAtIso: after({ iso: NOW, ms: 30_000 }) });
    const next = await wake({ deliver, nowIso: after({ iso: NOW, ms: 30_000 + QUIET_BEFORE_DELIVERY_MS }) });

    expect(next.kind).toBe("woke");
    expect(typed.at(-1)).toBe(chairBatchLine({ anchors: [stretch({ segmentId: "s1" }), { kind: "relay", slug }] }));
  });

  it("stays held for the next batch when the line did not reach the chat", async () => {
    const slug = holdRelay({ heldAtIso: SPOKEN });
    const refused = typer({ kind: "skipped" });
    await wake({ deliver: refused.deliver });

    expect(unwrap(readTurn({ home, turnId: TURN })).delivery!.kind).toBe("held");
    expect(unwrap(courierTurns({ home, stage: "pending" }))).toEqual([TURN]);
    const { deliver, typed } = typer();
    expect((await wake({ deliver })).kind).toBe("woke");
    expect(typed).toEqual([chairBatchLine({ anchors: [{ kind: "relay", slug }] })]);
  });

  it("belongs to a line a live process is still typing, and to no other batch", async () => {
    holdRelay({ heldAtIso: SPOKEN });
    const { deliver, typed } = typer();
    writeFileSync(chairWakePath({ home }), attempting({ holder: { pid: 101, start: "t101" }, relayTurnIds: [TURN] }));
    const live = await wake({ deliver });
    writeFileSync(
      chairWakePath({ home }),
      attempting({ holder: { pid: 101, start: "an earlier start" }, relayTurnIds: [TURN] }),
    );
    const dead = await wake({ deliver });

    expect([live.kind, dead.kind]).toEqual(["coalesced", "woke"]);
    expect(typed.length).toBe(1);
  });

  it("stays a typist's whose liveness cannot be told, until the rewake interval frees it", async () => {
    holdRelay({ heldAtIso: SPOKEN });
    const { deliver, typed } = typer();
    writeFileSync(chairWakePath({ home }), attempting({ holder: { pid: 101, start: "t101" }, relayTurnIds: [TURN] }));
    const unreadable = await wake({ deliver, lock: UNKNOWN_OTHERS });
    writeFileSync(chairWakePath({ home }), attempting({ holder: { pid: 101 }, relayTurnIds: [TURN] }));
    const unstamped = await wake({ deliver });
    const stale = await wake({ deliver, lock: UNKNOWN_OTHERS, nowIso: after({ iso: NOW, ms: REWAKE_AFTER_MS }) });

    expect([unreadable.kind, unstamped.kind, stale.kind]).toEqual(["coalesced", "coalesced", "woke"]);
    expect(typed.length).toBe(1);
  });

  it("keeps that typist's record, so no batch staged over it frees the relay for a third pass", async () => {
    writeFileSync(callFile({ callId: CALL }), segment({ id: "s1", text: "first" }));
    const slug = holdRelay({ heldAtIso: SPOKEN });
    const reserving = attempting({ holder: { pid: 101, start: "t101" }, relayTurnIds: [TURN] });
    writeFileSync(chairWakePath({ home }), reserving);
    const { deliver, typed } = typer();
    const meanwhile = await wake({ deliver, lock: UNKNOWN_OTHERS });
    const kept = readLastChairWake({ path: chairWakePath({ home }) }).record!;
    const freed = await wake({ deliver, nowIso: after({ iso: NOW, ms: REWAKE_AFTER_MS }) });

    expect(meanwhile.kind).toBe("coalesced");
    expect([kept.holder, kept.relayTurnIds]).toEqual([{ pid: 101, start: "t101" }, [TURN]]);
    expect(freed.kind).toBe("woke");
    expect(typed).toEqual([chairBatchLine({ anchors: [stretch({ segmentId: "s1" }), { kind: "relay", slug }] })]);
  });

  it("counts toward the owner's quiet while a line is typing it, so a stretch beside it still waits", async () => {
    writeFileSync(callFile({ callId: CALL }), segment({ id: "s1", text: "first" }));
    holdRelay({ heldAtIso: after({ iso: NOW, ms: -30_000 }) });
    writeFileSync(chairWakePath({ home }), attempting({ holder: { pid: 101, start: "t101" }, relayTurnIds: [TURN] }));
    const { deliver, typed } = typer();

    expect(await wake({ deliver })).toEqual({
      kind: "holding",
      lastWordIso: after({ iso: NOW, ms: -30_000 }),
      untilIso: after({ iso: NOW, ms: 90_000 }),
    });
    expect(typed).toEqual([]);
  });

  it("is left as it stood when a second line settles it after the first already did", () => {
    holdRelay({ heldAtIso: SPOKEN });
    const first: Delivery = { atIso: NOW, detail: "typed into the fake chair", kind: "typed", via: "direct" };
    const settled = unwrap(settleHeldRelay({ batchAtIso: NOW, delivery: first, home, turnId: TURN }));
    unwrap(enqueueCourier({ home, nowIso: NOW, turnId: TURN }));
    const later = after({ iso: NOW, ms: 5_000 });
    const again = unwrap(
      settleHeldRelay({ batchAtIso: later, delivery: { ...first, atIso: later }, home, turnId: TURN }),
    );

    expect([settled!.kind, again!.kind]).toEqual(["typed", "skipped"]);
    expect(unwrap(readTurn({ home, turnId: TURN })).delivery!.detail).toBe(
      `on the quiet batch of ${NOW}: typed into the fake chair`,
    );
    expect(unwrap(courierTurns({ home, stage: "pending" }))).toEqual([]);
  });
});
