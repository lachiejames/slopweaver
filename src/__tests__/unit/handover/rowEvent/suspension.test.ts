/**
 * `applyRowEvent` on a `park-wake-suspended` event: appended only while it names the standing park's position and the
 * question open now, over a journal it can read whole, and decoded back exactly as written. A genuine `mkdtempSync`
 * round trip, every directory removed after the case that minted it.
 */
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { RunEvent } from "../../../../handover/ledger.js";
import { applyRowEvent } from "../../../../handover/rowEvent.js";
import { readRunJournal } from "../../../../handover/runStore.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { LATER, runsDir, STARTED, seed, useRunsDirs } from "./harness.js";

useRunsDirs();

const QUESTION = "Which slide order?";
const ASKED_ISO = "2026-09-07T11:30:00.000Z";
const LAUNCHED: RunEvent = { atIso: LATER, kind: "launched", pid: 4242, sessionId: "session-a", worktree: "/wt" };
const ASKED: RunEvent = { atIso: ASKED_ISO, kind: "question", question: QUESTION };
const PARKED: RunEvent = {
  atIso: "2026-09-07T12:00:00.000Z",
  branch: "feat/x",
  kind: "parked",
  question: QUESTION,
  screenTail: "❯ ",
  sessionId: "session-a",
  wake: { kind: "checks", number: 7, repo: "acme/widgets" },
  workspaceRef: "workspace:9",
  worktree: "/wt",
};
/** The standing park sits at index 3. */
const JOURNAL: readonly RunEvent[] = [STARTED, LAUNCHED, ASKED, PARKED];

/** A suspension of the park at `parkIndex` on {@link QUESTION}. */
function suspension({ parkIndex = 3 } = {}): RunEvent {
  return {
    atIso: "2026-09-07T13:00:00.000Z",
    judgedLength: 4,
    kind: "park-wake-suspended",
    parkIndex,
    question: QUESTION,
    questionAskedIso: ASKED_ISO,
    why: "acme/widgets#7 (feat/x) merged",
  };
}

describe("applyRowEvent on a `park-wake-suspended` event", () => {
  it("appends one naming the standing park and the open question, and reads it back exactly", () => {
    const dir = runsDir();
    seed({ dir, events: JOURNAL, slug: "a-row" });

    unwrap(applyRowEvent({ event: suspension(), runsDir: dir, slug: "a-row" }));

    expect(unwrap(readRunJournal({ runsDir: dir, slug: "a-row" })).events.at(-1)).toEqual(suspension());
  });

  it("refuses one naming a position no park stands at", () => {
    const dir = runsDir();
    seed({ dir, events: JOURNAL, slug: "a-row" });

    const error = unwrapErr(applyRowEvent({ event: suspension({ parkIndex: 2 }), runsDir: dir, slug: "a-row" }));

    expect([error.code, error.message.includes("no park stands at position 2")]).toEqual([
      "FORBIDDEN_TRANSITION",
      true,
    ]);
  });

  it("refuses one once the question was answered", () => {
    const dir = runsDir();
    const answered: RunEvent = { answer: "first", atIso: "2026-09-07T12:30:00.000Z", kind: "answered" };
    seed({ dir, events: [...JOURNAL, answered], slug: "a-row" });

    const error = unwrapErr(applyRowEvent({ event: suspension(), runsDir: dir, slug: "a-row" }));

    expect(error.message).toContain("the answered line at 2026-09-07T12:30:00.000Z came after the park");
  });

  // The append's own read refuses a queued message, so one landing during the wake's head read is not masked.
  it("refuses one over a message queued for the seat since it parked, though the question still stands", () => {
    const dir = runsDir();
    const said: RunEvent = { atIso: "2026-09-07T12:30:00.000Z", kind: "said", message: "also rebase" };
    seed({ dir, events: [...JOURNAL, said], slug: "a-row" });

    const error = unwrapErr(applyRowEvent({ event: suspension(), runsDir: dir, slug: "a-row" }));

    expect([error.code, error.message.includes("the said line at 2026-09-07T12:30:00.000Z")]).toEqual([
      "FORBIDDEN_TRANSITION",
      true,
    ]);
  });

  it("refuses one over a journal with a line it cannot read", () => {
    const dir = runsDir();
    seed({ dir, events: JOURNAL, slug: "a-row" });
    appendFileSync(join(dir, "a-row.jsonl"), "{not json\n", "utf8");

    const error = unwrapErr(applyRowEvent({ event: suspension(), runsDir: dir, slug: "a-row" }));

    expect(error.message).toContain("suspend a park's wake on a journal with undecodable line(s)");
  });
});
