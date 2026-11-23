import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { cardNextFromCalls } from "../../../../../cli/commands/desktop/e2eCallCardNextScenario.js";
import { CARD_NEXT_WINDOW_MS } from "../../../../../desktop/e2eCallCardNext.js";
import { OWNER_SPEAKER } from "../../../../../desktop/e2eCallCardReadingHold.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { CallEntry } from "../../../../../talk/callRecord.js";
import { appendCallEntries } from "../../../../../talk/callStore.js";

/** Synthetic Queue asks' keys, never this install's own. */
const CARD = "ask:fixture-card";
const OTHER = "ask:acme-other-card";
const MOVED = "7d2e0f3a-4b5c-4e6f-9a71-2b3c4d5e6f01";
const STUCK = "7d2e0f3a-4b5c-4e6f-9a71-2b3c4d5e6f02";
const BARE = "7d2e0f3a-4b5c-4e6f-9a71-2b3c4d5e6f03";
const ASKED_AT = "2026-11-01T10:00:20.000Z";
const PAST_WINDOW = Date.parse(ASKED_AT) + CARD_NEXT_WINDOW_MS;

const OPENED: CallEntry = {
  atIso: "2026-11-01T10:00:00.000Z",
  detail: `${CARD}, card opened, page none, thread opened`,
  kind: "tool",
  name: "open_card",
  refused: false,
};
const ASK: CallEntry = {
  atIso: ASKED_AT,
  final: true,
  id: "owner-1",
  kind: "segment",
  text: "All right, next card please.",
  who: OWNER_SPEAKER,
};
const NEXT_OPENED: CallEntry = {
  atIso: "2026-11-01T10:00:30.000Z",
  detail: `${OTHER}, card opened, page none, thread none`,
  kind: "tool",
  name: "open_card",
  refused: false,
};

describe("cardNextFromCalls", () => {
  let home = "";

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "sw-card-next-"));
    unwrap(appendCallEntries({ callId: MOVED, entries: [OPENED, ASK, NEXT_OPENED], home }));
    unwrap(appendCallEntries({ callId: STUCK, entries: [OPENED, ASK], home }));
    unwrap(appendCallEntries({ callId: BARE, entries: [OPENED], home }));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("sorts each call into moved or stuck, naming the call", () => {
    expect(unwrap(cardNextFromCalls({ callIds: [MOVED, STUCK], cardKey: CARD, home, nowMs: PAST_WINDOW }))).toEqual({
      moves: [
        `call ${MOVED}: open_card at 2026-11-01T10:00:30.000Z: ${OTHER}, card opened, page none, thread none, 10.0s ` +
          "after their ask, by the voice's own hand-off",
      ],
      stuck: [`call ${STUCK}: ${CARD} still up 25s after their ask at ${ASKED_AT}`],
      waiting: "no transcript call of this instance yet",
    });
  });

  it("says why the last call is still waiting when none decided", () => {
    expect(unwrap(cardNextFromCalls({ callIds: [BARE], cardKey: CARD, home, nowMs: PAST_WINDOW }))).toEqual({
      moves: [],
      stuck: [],
      waiting: 'no final line of theirs after the card ends on "next card please"',
    });
  });

  it("reports a call it cannot read, never reading it as moved", () => {
    const refused = unwrapErr(cardNextFromCalls({ callIds: ["not-a-call-id"], cardKey: CARD, home, nowMs: 0 }));
    expect([refused.code, refused.message]).toEqual([
      "EVIDENCE_UNREADABLE",
      expect.stringContaining("call not-a-call-id"),
    ]);
  });
});
