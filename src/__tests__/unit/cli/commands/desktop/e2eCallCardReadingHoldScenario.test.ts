import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readingHoldFromCalls } from "../../../../../cli/commands/desktop/e2eCallCardReadingHoldScenario.js";
import { READING_HOLD_WINDOW_MS } from "../../../../../desktop/e2eCallCardReadingHold.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { CallEntry } from "../../../../../talk/callRecord.js";
import { appendCallEntries } from "../../../../../talk/callStore.js";

/** A synthetic Queue ask's key, never this install's own. */
const CARD = "ask:fixture-card";
const HELD = "6c1d9e2f-3a4b-4d5e-8f60-1a2b3c4d5e01";
const MOVED = "6c1d9e2f-3a4b-4d5e-8f60-1a2b3c4d5e02";
const BARE = "6c1d9e2f-3a4b-4d5e-8f60-1a2b3c4d5e03";
const SAID_AT = "2026-11-01T10:00:05.000Z";
const PAST_WINDOW = Date.parse(SAID_AT) + READING_HOLD_WINDOW_MS;

const OPENED: CallEntry = {
  atIso: "2026-11-01T10:00:00.000Z",
  detail: `${CARD}, card opened, page none, thread opened`,
  kind: "tool",
  name: "open_card",
  refused: false,
};
const READING: CallEntry = {
  atIso: SAID_AT,
  final: true,
  id: "heard-1",
  kind: "segment",
  text: "I only just started reading it, let me just keep reading.",
  who: "owner",
};
const RESUMED: CallEntry = {
  atIso: "2026-11-01T10:00:10.000Z",
  detail: "the page resumed the answer",
  kind: "tool",
  name: "resume",
  refused: false,
};

describe("readingHoldFromCalls", () => {
  let home = "";

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "sw-reading-hold-"));
    unwrap(appendCallEntries({ callId: HELD, entries: [OPENED, READING], home }));
    unwrap(appendCallEntries({ callId: MOVED, entries: [OPENED, READING, RESUMED], home }));
    unwrap(appendCallEntries({ callId: BARE, entries: [OPENED], home }));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("sorts each call into held or moved, naming the call a move came from", () => {
    expect(unwrap(readingHoldFromCalls({ callIds: [HELD, MOVED], cardKey: CARD, home, nowMs: PAST_WINDOW }))).toEqual({
      heldCallIds: [HELD],
      moves: [`call ${MOVED}: resume at 2026-11-01T10:00:10.000Z: the page resumed the answer`],
      waiting: "no transcript call of this instance yet",
    });
  });

  it("says why the last call is still waiting when none decided", () => {
    expect(unwrap(readingHoldFromCalls({ callIds: [BARE], cardKey: CARD, home, nowMs: PAST_WINDOW }))).toEqual({
      heldCallIds: [],
      moves: [],
      waiting: 'the owner\'s last final line does not end on "let me just keep reading"',
    });
  });

  it("reports a call it cannot read, never reading it as held", () => {
    const refused = unwrapErr(readingHoldFromCalls({ callIds: ["not-a-call-id"], cardKey: CARD, home, nowMs: 0 }));
    expect([refused.code, refused.message]).toEqual([
      "EVIDENCE_UNREADABLE",
      expect.stringContaining("call not-a-call-id"),
    ]);
  });
});
