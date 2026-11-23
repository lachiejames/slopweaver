import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { noteCardPosting, notePosting } from "../../../../../cli/commands/automation/cardPostingNote.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../cli/exitCodes.js";
import { unwrap } from "../../../../../lib/result.js";
import { readFiringPosting } from "../../../../../live/automation/postingLedger.js";
import { keyedDuplicateKey } from "../../../../../outbound/slack/fingerprint.js";
import { confirmSend } from "../../../../../outbound/slack/sendReservation.js";

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** A throwaway state home this test owns. */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "card-posting-note-"));
  homes.push(home);
  return home;
}

const NOW = "2026-10-03T06:00:00.000Z";
const SLOT = "2026-10-03T06:00:00.000Z";

/** Edges recording every diagnostic, on a fixed clock. */
function edges(): { now: () => string; writeDiagnostic: (line: string) => void; diag: string[] } {
  const diag: string[] = [];
  return { diag, now: () => NOW, writeDiagnostic: (line) => diag.push(line) };
}

/** Confirm a send on the ledger exactly as `slack post --as bot --idempotency-key` does. */
function confirmed({ home, sentTs }: { home: string; sentTs: string }): void {
  confirmSend({
    duplicateKey: keyedDuplicateKey({ actor: "bot", channel: "D0DM", idempotencyKey: "slot-key" }),
    home,
    nowIso: NOW,
    sentTs,
  });
}

describe("noteCardPosting", () => {
  it("records the ts the send ledger confirmed under the firing's keyed duplicate key", () => {
    const home = freshHome();
    confirmed({ home, sentTs: "1791.0003" });
    const deps = edges();

    noteCardPosting({
      channel: "D0DM",
      deps,
      dryRun: false,
      home,
      idempotencyKey: "slot-key",
      posted: EXIT_OK,
      recipeId: "knock",
      slotIso: SLOT,
    });

    expect(unwrap(readFiringPosting({ home, recipeId: "knock", slotIso: SLOT }))).toEqual({
      channel: "D0DM",
      postedAtIso: NOW,
      recipeId: "knock",
      slotIso: SLOT,
      ts: "1791.0003",
    });
    expect(deps.diag).toEqual([]);
  });

  it("records nothing for a post that failed, and says nothing", () => {
    const home = freshHome();
    confirmed({ home, sentTs: "1791.0003" });
    const deps = edges();

    noteCardPosting({
      channel: "D0DM",
      deps,
      dryRun: false,
      home,
      idempotencyKey: "slot-key",
      posted: EXIT_ERROR,
      recipeId: "knock",
      slotIso: SLOT,
    });

    expect(unwrap(readFiringPosting({ home, recipeId: "knock", slotIso: SLOT }))).toBeUndefined();
    expect(deps.diag).toEqual([]);
  });

  it("says a delivered card whose ledger row is under another channel's key, rather than borrowing its ts", () => {
    const home = freshHome();
    confirmed({ home, sentTs: "1791.0003" });
    const deps = edges();

    noteCardPosting({
      channel: "C0OTHER",
      deps,
      dryRun: false,
      home,
      idempotencyKey: "slot-key",
      posted: EXIT_OK,
      recipeId: "knock",
      slotIso: SLOT,
    });

    expect(unwrap(readFiringPosting({ home, recipeId: "knock", slotIso: SLOT }))).toBeUndefined();
    expect(deps.diag).toEqual([
      "recipe knock · the card posted but its send ledger carries no message ts — " +
        "the Automations page will not show where this firing posted",
    ]);
  });
});

describe("notePosting", () => {
  it("records the posting it is handed", () => {
    const home = freshHome();
    const deps = edges();

    notePosting({ channel: "D0DM", deps, home, recipeId: "ask", slotIso: SLOT, ts: "1792.0004" });

    expect(unwrap(readFiringPosting({ home, recipeId: "ask", slotIso: SLOT }))!.ts).toBe("1792.0004");
  });
});
