/**
 * A call the owner hung up wakes the pinned chair ONCE, two minutes after their last word, and nothing after. A courier
 * running a build from before the quiet batch typed one wake per final stretch, and held the one for the closing
 * "Thanks" while the owner typed into the chair's box, then typed it the moment they sent. This pins the shape of
 * that call's end: the last stretch, the voice's goodbye after it, the `closed` line, a busy box. Over a throwaway
 * home; the typing is a plain fake passed in.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap } from "../../../lib/result.js";
import { chairBatchLine } from "../../../talk/chairBatchLine.js";
import { QUIET_BEFORE_DELIVERY_MS, REWAKE_AFTER_MS } from "../../../talk/chairWake.js";
import { wakeChair } from "../../../talk/chairWakeShell.js";
import { chairWakePath, readLastChairWake } from "../../../talk/chairWakeStore.js";
import type { Delivery } from "../../../talk/deliveryOutcome.js";
import { readUnreadCursor, writeUnreadCursor } from "../../../talk/unreadCursorStore.js";
import { readUnread } from "../../../talk/unreadRead.js";
import { advancedCursor, formatCallPointer } from "../../../talk/unreadWords.js";

const CALL = "a0000035-0000-4000-8000-000000000038";
/** When the chair last read the call, the owner's earlier stretch included. */
const READ_AT = "2026-10-01T15:39:00.000Z";
/** The owner's last word: "Thanks". */
const LAST_WORD = "2026-10-01T15:39:30.000Z";
/** The voice's goodbye after it. */
const GOODBYE = "2026-10-01T15:39:32.000Z";
/** The owner hung up. */
const HUNG_UP = "2026-10-01T15:39:36.000Z";
/** The first instant the two quiet minutes are up. */
const DUE = new Date(Date.parse(LAST_WORD) + QUIET_BEFORE_DELIVERY_MS).toISOString();
/** The waking process, running, so no `ps` is spawned to ask. */
const LOCK = { pid: 101, startOf: () => ({ running: true, start: "t101" }) };

/** An instant `ms` after another. */
const after = ({ iso, ms }: { iso: string; ms: number }): string => new Date(Date.parse(iso) + ms).toISOString();

const line = (entry: Record<string, unknown>): string => `${JSON.stringify(entry)}\n`;

/** The call as the console leaves it once the chair has read the earlier stretch. */
const EARLIER = [
  line({ atIso: "2026-10-01T15:30:00.000Z", kind: "open" }),
  line({ atIso: "2026-10-01T15:38:00.000Z", final: true, id: "s1", kind: "segment", text: "merge it", who: "owner" }),
].join("");

/** What the call file gains after that read: the owner's last word, the voice's goodbye, the hang-up. */
const END = [
  line({ atIso: LAST_WORD, final: true, id: "s2", kind: "segment", text: " Thanks", who: "owner" }),
  line({ atIso: GOODBYE, final: true, id: "v9", kind: "segment", text: " ’Bye.", who: "voice" }),
  line({ atIso: HUNG_UP, kind: "closed", why: null }),
].join("");

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "call-end-"));
  mkdirSync(join(home, "talk", "calls"), { recursive: true });
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

const callFile = (): string => join(home, "talk", "calls", `${CALL}.jsonl`);

/** Mark everything the chair can read at `nowIso` — `talk unread --mark` over one batch that holds it all. */
const markAll = ({ nowIso }: { nowIso: string }): void => {
  const read = unwrap(readUnread({ home, name: "supervisor", nowIso }));
  unwrap(writeUnreadCursor({ cursor: advancedCursor({ read, recordedAtIso: nowIso }), home, name: "supervisor" }));
};

/** The call as it stood at hang-up, the chair's cursor at the earlier stretch. */
const hangUp = (): void => {
  writeFileSync(callFile(), EARLIER);
  markAll({ nowIso: READ_AT });
  writeFileSync(callFile(), `${EARLIER}${END}`);
};

/** A chair whose box refuses the first `busy` pastes as unsent words, then takes each; every line it was asked to type. */
const chair = ({ busy = 0 }: { busy?: number } = {}) => {
  const asked: string[] = [];
  const deliver = async ({ line: pasted }: { line: string }): Promise<Delivery> => {
    asked.push(pasted);
    if (asked.length <= busy) {
      return {
        atIso: DUE,
        detail: "not typed: the owner has unsent words in the box",
        kind: "skipped",
        refusal: "composer-busy",
        via: "direct",
      };
    }
    return { atIso: DUE, detail: "typed into the fake chair", kind: "typed", via: "direct" };
  };
  return { asked, deliver };
};

/** One courier pass at `nowIso`: what it decided. */
const pass = async ({
  deliver,
  nowIso,
}: {
  deliver: (options: { line: string }) => Promise<Delivery>;
  nowIso: string;
}): Promise<string> =>
  unwrap(await wakeChair({ deliver, dryRun: false, home, lock: LOCK, nowIso: () => nowIso })).outcome.kind;

/** The one batch the last stretch reaches the chair as. */
const END_BATCH = chairBatchLine({
  anchors: [{ kind: "stretch", pointer: formatCallPointer({ callId: CALL, segmentId: "s2" }) }],
});

/** The whole call file after hang-up: the frontier a wake for it names, and the one a full mark leaves. */
const WHOLE_FILE = Buffer.byteLength(`${EARLIER}${END}`);

/** The last wake as the store keeps it, in the fields that say what it was for and what became of it. */
const lastWake = () => {
  const { callId, delivery, notified, relayTurnIds } = readLastChairWake({ path: chairWakePath({ home }) }).record!;
  return { callId, delivery, notified, relayTurnIds };
};

describe("a call the owner hung up", () => {
  it("holds its last stretch through the two quiet minutes from the last word, never from the voice's or the hang-up", async () => {
    hangUp();
    const { asked, deliver } = chair();
    const soon = unwrap(
      await wakeChair({ deliver, dryRun: false, home, lock: LOCK, nowIso: () => after({ iso: HUNG_UP, ms: 1_000 }) }),
    ).outcome;

    expect(soon).toEqual({ kind: "holding", lastWordIso: LAST_WORD, untilIso: DUE });
    expect(await pass({ deliver, nowIso: after({ iso: DUE, ms: -1 }) })).toBe("holding");
    expect(asked).toEqual([]);
  });

  it("wakes the chair once with the one stretch of theirs it has not read, and nothing after it reads it", async () => {
    hangUp();
    const { asked, deliver } = chair();
    const woke = await pass({ deliver, nowIso: DUE });
    const stored = lastWake();
    markAll({ nowIso: after({ iso: DUE, ms: 60_000 }) });
    const marked = unwrap(readUnreadCursor({ home, name: "supervisor" }))!;

    expect(woke).toBe("woke");
    expect(stored).toEqual({ callId: CALL, delivery: "typed", notified: { [CALL]: WHOLE_FILE }, relayTurnIds: [] });
    expect(marked.calls[CALL]!.offset).toBe(WHOLE_FILE);
    expect([
      await pass({ deliver, nowIso: after({ iso: DUE, ms: 61_000 }) }),
      await pass({ deliver, nowIso: after({ iso: DUE, ms: REWAKE_AFTER_MS + 1 }) }),
      await pass({ deliver, nowIso: after({ iso: DUE, ms: 60 * 60_000 }) }),
    ]).toEqual(["nothing-unread", "nothing-unread", "nothing-unread"]);
    expect(asked).toEqual([END_BATCH]);
  });

  it("types the end batch once the box is free, never both the skipped paste and a second line", async () => {
    hangUp();
    const { asked, deliver } = chair({ busy: 1 });
    const busy = await pass({ deliver, nowIso: DUE });
    const skipped = lastWake().delivery;
    const free = await pass({ deliver, nowIso: after({ iso: DUE, ms: 5_000 }) });
    const typed = lastWake().delivery;
    const next = await pass({ deliver, nowIso: after({ iso: DUE, ms: 10_000 }) });

    expect([busy, free, next]).toEqual(["woke", "woke", "coalesced"]);
    expect([skipped, typed]).toEqual(["skipped", "typed"]);
    expect(asked).toEqual([END_BATCH, END_BATCH]);
  });

  it("does not type it twice while the chair has not read it yet, until the rewake ceiling for words still unread", async () => {
    hangUp();
    const { asked, deliver } = chair();
    await pass({ deliver, nowIso: DUE });

    expect([
      await pass({ deliver, nowIso: after({ iso: DUE, ms: 60_000 }) }),
      await pass({ deliver, nowIso: after({ iso: DUE, ms: REWAKE_AFTER_MS - 1 }) }),
    ]).toEqual(["coalesced", "coalesced"]);
    expect(asked).toEqual([END_BATCH]);
  });
});
