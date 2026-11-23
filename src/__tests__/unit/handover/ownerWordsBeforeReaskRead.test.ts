/**
 * `rowOwnerWordsBeforeReaskRefusal` over a real throwaway home: it re-reads the row's run journal at the moment it is
 * asked, so a run waiting on the owner refuses over unread words on its card, and a run whose question has since been
 * answered — or that holds no journal at all — never does. The second is the stale-journal false refusal a `handover
 * park` once had, when it judged the phase from the journal it read before its seat checks.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ledgerLine, type RunEvent } from "../../../handover/ledger.js";
import { rowOwnerWordsBeforeReaskRefusal } from "../../../handover/ownerWordsBeforeReaskRead.js";
import { callsDir } from "../../../talk/callStore.js";
import { CLOSED, said } from "../talk/cardUtteranceFixture.js";

const ROW = "backup-master-password-wraps-the-backup-key";
const CALL = "9b2f1c3e-4d5a-4b6c-8d7e-0f1a2b3c4d5e";
const ANCHOR = `call:${CALL}#s-1`;
const COMMAND = "slopweaver handover park";

const STARTED: RunEvent = { atIso: "2026-09-25T15:00:00.000Z", branch: "feat/x", docHash: "abc123", kind: "started" };
const ASKED: RunEvent = {
  atIso: "2026-09-25T15:30:00.000Z",
  kind: "question",
  question: "Have you saved the new password?",
};

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "owner-words-read-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** The row's run journal, holding exactly these events. */
function journal({ events }: { events: readonly RunEvent[] }): void {
  mkdirSync(join(home, "runs"), { recursive: true });
  writeFileSync(join(home, "runs", `${ROW}.jsonl`), events.map((event) => ledgerLine({ event })).join(""));
}

/** A call in which the owner answered over the row's card, after the question was asked. */
function callOverCard(): void {
  const dir = callsDir({ home });
  mkdirSync(dir, { mode: 0o700, recursive: true });
  const lines = [
    { ...said({ at: "55:41", id: "s-1", open: `ask:${ROW}`, text: "Uh, I have saved it" }), openBy: "voice" },
    CLOSED,
  ];
  writeFileSync(join(dir, `${CALL}.jsonl`), lines.map((line) => `${JSON.stringify(line)}\n`).join(""), {
    mode: 0o600,
  });
}

/** The refusal for the row, naming these anchors as read. */
function refusalFor({ acknowledged }: { acknowledged: readonly string[] }): readonly string[] | undefined {
  return rowOwnerWordsBeforeReaskRefusal({
    acknowledged,
    command: COMMAND,
    home,
    runsDir: join(home, "runs"),
    slug: ROW,
  });
}

describe("rowOwnerWordsBeforeReaskRefusal — the journal read at the moment of asking", () => {
  it("refuses a run waiting on the owner over words on its card, naming the anchor and the refused verb", () => {
    journal({ events: [STARTED, ASKED] });
    callOverCard();
    const text = refusalFor({ acknowledged: [] })!.join("\n");
    expect(text).toContain(`${COMMAND} blocked because`);
    expect(text).toContain(`--read-owner-words ${ANCHOR}`);
  });

  it("lets the same run through once the anchor is named as read", () => {
    journal({ events: [STARTED, ASKED] });
    callOverCard();
    expect(refusalFor({ acknowledged: [ANCHOR] })).toBeUndefined();
  });

  it("never refuses once the question has been answered, however much was said over its card", () => {
    journal({ events: [STARTED, ASKED, { answer: "done", atIso: "2026-09-25T16:01:00.000Z", kind: "answered" }] });
    callOverCard();
    expect(refusalFor({ acknowledged: [] })).toBeUndefined();
  });

  it("never refuses a row with no journal, which holds no question", () => {
    callOverCard();
    expect(refusalFor({ acknowledged: [] })).toBeUndefined();
  });
});
