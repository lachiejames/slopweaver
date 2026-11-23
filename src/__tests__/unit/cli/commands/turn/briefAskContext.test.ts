/**
 * `turn brief`'s reads of the ask's other state, over a throwaway home: a fresh home has no other asks and
 * reads as a tag, a `helped` row naming this message reads as unprompted while one naming a sibling does not, and a
 * `stood-down` row anywhere in the thread reads as stood down while one in another thread does not.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";
import { otherActiveAsksFor, witnessAskContextFor } from "../../../../../cli/commands/turn/briefAskContext.js";
import type { BriefTarget } from "../../../../../cli/commands/turn/briefTarget.js";
import { appendWitnessEvent } from "../../../../../live/witness/journalStore.js";
import { type WitnessKey, witnessIdOf } from "../../../../../live/witness/types.js";

const TARGET: BriefTarget = {
  channel: "C0SYN000002",
  messageTs: "1790728680.000100",
  surface: "channel",
  text: "anything I can do to assist?",
  threadTs: "1790662224.935389",
  userId: "U0SYNTEAMMATE",
};

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "brief-ask-context-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** Journal a terminal row for one message of the target's thread (or of another thread). */
function journal({
  messageTs,
  outcome,
  threadTs = TARGET.threadTs,
}: {
  messageTs: string;
  outcome: "helped" | "stood-down";
  threadTs?: string;
}): void {
  const key: WitnessKey = { channel: TARGET.channel, messageTs, threadTs };
  unwrap(
    appendWitnessEvent({
      event: {
        ...key,
        kind: "settled",
        outcome,
        ...(outcome === "stood-down" ? { why: "told it was in the way" } : {}),
        schemaVersion: 1,
        tsIso: "2026-09-30T00:39:00.000Z",
        witnessId: witnessIdOf({ key }),
      },
      home,
    }),
  );
}

describe("otherActiveAsksFor", () => {
  it("is empty on a fresh home", () => {
    expect(otherActiveAsksFor({ home, target: TARGET })).toEqual([]);
  });
});

describe("witnessAskContextFor", () => {
  it("reads as a tag in a thread that never stood down on a fresh home", () => {
    expect(witnessAskContextFor({ home, target: TARGET })).toEqual({ stoodDown: false, unprompted: false });
  });

  it("reads as unprompted when a helped row names this message", () => {
    journal({ messageTs: TARGET.messageTs, outcome: "helped" });
    expect(witnessAskContextFor({ home, target: TARGET })).toEqual({ stoodDown: false, unprompted: true });
  });

  it("reads as a tag when the helped row names a sibling message", () => {
    journal({ messageTs: "1790728699.000100", outcome: "helped" });
    expect(witnessAskContextFor({ home, target: TARGET }).unprompted).toBe(false);
  });

  it("reads as stood down when any message of this thread stood the bot down", () => {
    journal({ messageTs: "1790728600.000100", outcome: "stood-down" });
    expect(witnessAskContextFor({ home, target: TARGET })).toEqual({ stoodDown: true, unprompted: false });
  });

  it("does not read a stand-down in another thread", () => {
    journal({ messageTs: "1790728600.000100", outcome: "stood-down", threadTs: "1790000000.000100" });
    expect(witnessAskContextFor({ home, target: TARGET }).stoodDown).toBe(false);
  });
});
