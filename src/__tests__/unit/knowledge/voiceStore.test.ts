import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { pinnedUnit, readBatch, writeBatch } from "../../../knowledge/voice/batch.js";
import { scanVoice, voiceRoots } from "../../../knowledge/voice/scan.js";
import { appendProposal, proposalsPath, readProposals } from "../../../knowledge/voice/store.js";
import type { BeliefProposal, VoiceUnit, VoiceWatermark } from "../../../knowledge/voice/types.js";
import { countWords, voiceUnitId } from "../../../knowledge/voice/unit.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const cleanups: (() => void)[] = [];

afterEach(() => {
  cleanups.splice(0).forEach((clean) => {
    clean();
  });
});

/** A throwaway state home this test may write into — never the ambient one. */
function home(): string {
  const root = mkdtempSync(join(tmpdir(), "sw-voice-"));
  cleanups.push(() => {
    rmSync(root, { force: true, recursive: true });
  });
  return root;
}

/** The id a fixture was given, or the one its own text derives — an `if`, because both lint gates refuse an operator here. */
function unitIdFor({ id, text }: { id: string | undefined; text: string }): string {
  if (id === undefined) {
    return voiceUnitId({ text });
  }
  return id;
}

/**
 * One unit, with the id and word count its own text really produces.
 *
 * Derived rather than typed in, because `pinnedUnit` re-derives both to prove the batch was not edited, so a
 * hand-written id would make every fixture read as tampered — and a test that had to hard-code the digest
 * would be pinning the hash function rather than the behaviour.
 */
function unit({ text, id, wrapped = true }: { text: string; id?: string; wrapped?: boolean }): VoiceUnit {
  return {
    id: unitIdFor({ id, text }),
    locator: "/tmp/x.txt",
    occurrences: 1,
    source: "archive-turn",
    text,
    words: countWords({ text }),
    wrapped,
  };
}

const WATERMARK: VoiceWatermark = {
  kinds: ["tick-ledger"],
  recordings: 4,
  reviewed: 1,
  scannedAtIso: "2026-09-12T01:00:00.000Z",
  units: 2,
  unreadable: [],
};

describe("the proposal queue", () => {
  it("reads a home that has never written one as empty, not as an error", () => {
    expect(unwrap(readProposals({ home: home() }))).toEqual([]);
  });

  it("round-trips a proposed row", () => {
    const root = home();
    const row: BeliefProposal = {
      claim: "gold is being built up",
      domain: "slopweaver-corpus",
      held: "stated-uncertain",
      kind: "proposed",
      proposalId: "p-1",
      quote: "do we ever build up that gold",
      reviewedAtIso: "2026-09-12T01:00:00.000Z",
      run: "r",
      unitId: "u-1",
    };
    unwrap(appendProposal({ home: root, row }));
    expect(unwrap(readProposals({ home: root }))).toEqual([row]);
  });

  it("REFUSES a corrupt line rather than reporting the queue empty", () => {
    const root = home();
    mkdirSync(join(root, "knowledge"), { recursive: true });
    writeFileSync(proposalsPath({ home: root }), "{not json\n");
    const error = unwrapErr(readProposals({ home: root }));
    expect(error.code).toBe("PROPOSAL_CORRUPT");
    expect(error.message).toContain("line 1");
  });

  it("keeps both rows when one unit was answered and another was passed over", () => {
    const root = home();
    unwrap(
      appendProposal({
        home: root,
        row: { kind: "none", reviewedAtIso: "2026-09-12T01:00:00.000Z", run: "r", unitId: "u-1", why: "nothing in it" },
      }),
    );
    unwrap(
      appendProposal({
        home: root,
        row: {
          claim: "a claim",
          domain: "datadog",
          held: "stated-confident",
          kind: "proposed",
          proposalId: "p-2",
          quote: "the owner's words",
          reviewedAtIso: "2026-09-12T01:00:00.000Z",
          run: "r",
          unitId: "u-2",
        },
      }),
    );
    expect(unwrap(readProposals({ home: root })).map((row) => row.kind)).toEqual(["none", "proposed"]);
  });
});

describe("the batch file", () => {
  it("round-trips its watermark and its units", () => {
    const root = home();
    const path = join(root, "batch.jsonl");
    const units = [unit({ id: "u-1", text: "the first thing" }), unit({ id: "u-2", text: "the second thing" })];
    unwrap(writeBatch({ batch: { units, watermark: WATERMARK }, path }));
    const back = unwrap(readBatch({ path }));
    expect(back.watermark).toEqual(WATERMARK);
    expect(back.units).toEqual(units);
  });

  it("refuses a file that carries no watermark line", () => {
    const root = home();
    const path = join(root, "not-a-batch.jsonl");
    writeFileSync(path, `${JSON.stringify({ kind: "unit", ...unit({ text: "x" }) })}\n`);
    expect(unwrapErr(readBatch({ path })).code).toBe("BATCH_UNREADABLE");
  });

  it("refuses a file that is not there", () => {
    expect(unwrapErr(readBatch({ path: join(home(), "absent.jsonl") })).code).toBe("BATCH_UNREADABLE");
  });
});

describe("pinnedUnit", () => {
  it("finds the unit a proposal names", () => {
    const pinned = unit({ text: "the owner's words here" });
    const found = unwrap(pinnedUnit({ batch: { units: [pinned], watermark: WATERMARK }, unitId: pinned.id }));
    expect(found.text).toBe("the owner's words here");
  });

  it("says the unit is not in the batch, which means a different thing from a tampered one", () => {
    const error = unwrapErr(pinnedUnit({ batch: { units: [], watermark: WATERMARK }, unitId: "u-nope" }));
    expect(error.code).toBe("UNIT_NOT_IN_BATCH");
  });

  it("refuses a unit whose text was edited after the scan wrote it", () => {
    const error = unwrapErr(
      pinnedUnit({
        batch: { units: [unit({ id: "u-notthedigest", text: "edited words" })], watermark: WATERMARK },
        unitId: "u-notthedigest",
      }),
    );
    expect(error.code).toBe("UNIT_TAMPERED");
  });
});

describe("scanVoice", () => {
  it("reads a home with no sources at all as empty, without reporting a failure", () => {
    const scan = scanVoice({ home: home() });
    expect(scan.units).toEqual([]);
    expect(scan.unreadable).toEqual([]);
  });

  it("reads owner-turn files out of the archive, and nothing else in the directory", () => {
    const root = home();
    const archive = voiceRoots({ home: root })["archive-turn"];
    mkdirSync(archive, { recursive: true });
    writeFileSync(join(archive, "owner-turn-one.txt"), "the first thing the owner said");
    writeFileSync(join(archive, "supervisor-state-21aug.md"), "a supervisor's own document");
    const scan = scanVoice({ home: root });
    expect(scan.units.map((entry) => entry.text)).toEqual(["the first thing the owner said"]);
  });

  it("collapses the same words copied into every scratch handoff directory", () => {
    const root = home();
    const scratch = voiceRoots({ home: root })["scratch-turn"];
    ["handoff-9001", "handoff-9002", "handoff-9003"].forEach((handoff) => {
      mkdirSync(join(scratch, handoff), { recursive: true });
      writeFileSync(join(scratch, handoff, "owner-turn-240-9.txt"), "let's go on A for all four");
    });
    const scan = scanVoice({ home: root });
    expect(scan.recordings).toBe(3);
    expect(scan.units.length).toBe(1);
    expect(scan.units[0]!.occurrences).toBe(3);
  });

  it("reads only the family it was asked for", () => {
    const root = home();
    const roots = voiceRoots({ home: root });
    mkdirSync(roots["archive-turn"], { recursive: true });
    writeFileSync(join(roots["archive-turn"], "owner-turn-one.txt"), "an archived thing");
    mkdirSync(join(roots["scratch-turn"], "handoff-9001"), { recursive: true });
    writeFileSync(join(roots["scratch-turn"], "handoff-9001", "owner-turn-two.txt"), "a scratch thing");
    expect(scanVoice({ home: root, kinds: ["archive-turn"] }).units.map((e) => e.text)).toEqual(["an archived thing"]);
  });

  it("reads the tick ledger's owner turns and marks them unwrapped", () => {
    const root = home();
    const ledger = voiceRoots({ home: root })["tick-ledger"];
    mkdirSync(join(ledger, ".."), { recursive: true });
    writeFileSync(
      ledger,
      `${JSON.stringify({
        ownerTurns: {
          turns: [{ instantIso: "2026-09-12T01:00:00.000Z", text: "the owner's stripped turn", turnUuid: "turn-1" }],
        },
        tickId: "tick-1",
      })}\n`,
    );
    const scan = scanVoice({ home: root, kinds: ["tick-ledger"] });
    expect(scan.units.map((entry) => entry.text)).toEqual(["the owner's stripped turn"]);
    expect(scan.units[0]!.wrapped).toBe(false);
    expect(scan.units[0]!.locator).toBe("tick-1#turn-1");
  });

  it("reports a tick line it could not decode and keeps the turns around it", () => {
    const root = home();
    const ledger = voiceRoots({ home: root })["tick-ledger"];
    mkdirSync(join(ledger, ".."), { recursive: true });
    writeFileSync(
      ledger,
      `{not json\n${JSON.stringify({ ownerTurns: { turns: [{ text: "a good turn", turnUuid: "t" }] }, tickId: "tick-2" })}\n`,
    );
    const scan = scanVoice({ home: root, kinds: ["tick-ledger"] });
    expect(scan.units.map((entry) => entry.text)).toEqual(["a good turn"]);
    expect(scan.unreadable.length).toBe(1);
    expect(scan.unreadable[0]!.locator).toContain(":1");
  });
});
