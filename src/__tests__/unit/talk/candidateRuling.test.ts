import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";
import { applyCandidateRuling, CandidateRulingErrors, planCandidateRuling } from "../../../talk/candidateRuling.js";
import { readReactionRows, writeCandidates } from "../../../workstreams/candidateStore.js";
import { parseCandidatesFile, type ReactionRow } from "../../../workstreams/candidates.js";
import { underLedgerLock } from "../../../workstreams/ledgerLock.js";
import { latestReactions } from "../../../workstreams/reactionFold.js";
import type { WorkstreamStore } from "../../../workstreams/store/port.js";
import { validCandidates } from "../workstreams/candidatesFixture.js";
import { countingMintId, failingStore, seededStore } from "../workstreams/storeRegisterFixture.js";

const file = unwrap(parseCandidatesFile({ value: validCandidates() }));
const TURN = "a0000088-0000-4000-8000-000000000095";
const NOW = "2026-10-03T05:10:00.000Z";
const ANCHOR = `talk:${TURN}`;

const cleanups: (() => void)[] = [];

afterEach(() => {
  cleanups.splice(0).forEach((clean) => {
    clean();
  });
});

/** A home holding the fixture candidates — never the ambient home — beside a store holding the fixture register. */
async function seeded(): Promise<{ home: string; store: WorkstreamStore; mintId: () => string }> {
  const home = mkdtempSync(join(tmpdir(), "sw-cand-ruling-"));
  cleanups.push(() => {
    rmSync(home, { force: true, recursive: true });
  });
  unwrap(writeCandidates({ home, value: validCandidates() }));
  return { home, mintId: countingMintId(), store: await seededStore() };
}

/** A row this turn already wrote. */
function turnRow({ candidate, reaction }: { candidate: string; reaction: ReactionRow["reaction"] }): ReactionRow {
  const name = file.candidates.find((one) => one.id === candidate)!.name;
  return {
    anchor: ANCHOR,
    bySession: `talk:${TURN}`,
    candidate,
    coveredBy: null,
    heard: "not a workstream",
    iso: NOW,
    milestoneOf: null,
    name,
    outcomeOf: null,
    owner: null,
    promotedAs: null,
    reaction,
    reason: null,
    sameAs: null,
    steer: null,
    supersededBy: null,
    via: "word",
  };
}

describe("planCandidateRuling", () => {
  it("writes a ruling no row of this turn holds yet", () => {
    const planned = unwrap(
      planCandidateRuling({ catalog: file, rows: [], turnId: TURN, verdict: { candidate: "c-001", reaction: "no" } }),
    );
    expect(planned.write).toBe(true);
  });

  it("writes nothing on a replay that finds this turn's row for the same candidate and word", () => {
    const planned = unwrap(
      planCandidateRuling({
        catalog: file,
        rows: [turnRow({ candidate: "c-001", reaction: "no" })],
        turnId: TURN,
        verdict: { candidate: "c-001", reaction: "no" },
      }),
    );
    expect(planned.write).toBe(false);
  });

  // A re-mine landing between the write and a replay drops the candidate from the file,
  // and the row this turn wrote is still the owner's ruling.
  it("answers a replay as already written when a re-mine has since dropped the candidate", () => {
    const remined = { ...file, candidates: file.candidates.filter((one) => one.id !== "c-001") };
    const planned = unwrap(
      planCandidateRuling({
        catalog: remined,
        rows: [turnRow({ candidate: "c-001", reaction: "no" })],
        turnId: TURN,
        verdict: { candidate: "c-001", reaction: "no" },
      }),
    );
    expect(planned.write).toBe(false);
  });

  it("answers a replay as already written when another row carries the same session too", () => {
    const planned = unwrap(
      planCandidateRuling({
        catalog: file,
        rows: [turnRow({ candidate: "c-001", reaction: "no" }), turnRow({ candidate: "c-002", reaction: "yes" })],
        turnId: TURN,
        verdict: { candidate: "c-001", reaction: "no" },
      }),
    );
    expect(planned.write).toBe(false);
  });

  it("refuses a candidate no row carries, and a turn that already ruled otherwise", () => {
    const unknown = unwrapErr(
      planCandidateRuling({ catalog: file, rows: [], turnId: TURN, verdict: { candidate: "c-999", reaction: "no" } }),
    );
    expect(unknown).toEqual(CandidateRulingErrors.unknown({ candidate: "c-999" }));
    const held = turnRow({ candidate: "c-001", reaction: "no" });
    const otherwise = unwrapErr(
      planCandidateRuling({
        catalog: file,
        rows: [held],
        turnId: TURN,
        verdict: { candidate: "c-001", reaction: "yes" },
      }),
    );
    expect(otherwise).toEqual(CandidateRulingErrors.turnRuledOtherwise({ held, turnId: TURN }));
  });
});

describe("applyCandidateRuling", () => {
  it("writes the owner's ruling onto the candidate with their words, once across a replay", async () => {
    const seat = await seeded();
    const { home } = seat;
    const verdict = { candidate: "c-002", reaction: "no" } as const;
    const heard = "  that's not a workstream, it got superseded by the bug-reporting one ";
    const asked = { ...seat, anchor: ANCHOR, heard, nowIso: NOW, turnId: TURN, verdict };
    const first = unwrap(await applyCandidateRuling(asked));
    const replay = unwrap(await applyCandidateRuling(asked));
    expect([first.written, replay.written]).toEqual([true, false]);
    const rows = unwrap(readReactionRows({ home }));
    expect(rows.map((row) => [row.candidate, row.reaction, row.heard, row.via, row.bySession, row.anchor])).toEqual([
      [
        "c-002",
        "no",
        "that's not a workstream, it got superseded by the bug-reporting one",
        "word",
        `talk:${TURN}`,
        ANCHOR,
      ],
    ]);
    expect(latestReactions({ rows }).get("c-002")!.reaction).toBe("no");
  });

  it("keeps the owner's words as the reason for an abandoned word, and refuses one with no words heard", async () => {
    const seat = await seeded();
    const { home } = seat;
    const verdict = { candidate: "c-001", reaction: "abandoned" } as const;
    const asked = { ...seat, anchor: ANCHOR, nowIso: NOW, turnId: TURN, verdict };
    const silent = unwrapErr(await applyCandidateRuling({ ...asked, heard: " " }));
    expect(silent.code).toBe("REACTION_REFUSED");
    expect(unwrap(readReactionRows({ home }))).toEqual([]);
    unwrap(await applyCandidateRuling({ ...asked, heard: "we dropped it" }));
    expect(unwrap(readReactionRows({ home }))[0]!.reason).toBe("we dropped it");
  });

  // The row is appended before the register write, so a failed workstream write is a
  // ruling recorded with a promotion owed, never a candidate still open.
  it("reports a yes whose register write failed as recorded, naming the promotion owed", async () => {
    const seat = await seeded();
    const { home } = seat;
    const verdict = { candidate: "c-002", reaction: "yes" } as const;
    const applied = await applyCandidateRuling({
      ...seat,
      anchor: ANCHOR,
      heard: "yes, that one",
      nowIso: NOW,
      store: failingStore({ fail: "write", store: seat.store }),
      turnId: TURN,
      verdict,
    });
    const ruling = unwrap(applied);
    expect([ruling.candidate, ruling.reaction, ruling.written]).toEqual(["c-002", "yes", true]);
    expect(ruling.promotionOwed).toContain("c-002 owe a promotion");
    expect(unwrap(readReactionRows({ home })).map((row) => [row.candidate, row.reaction])).toEqual([["c-002", "yes"]]);
  });

  // The once-per-turn check and the append share the ledgers' lock, so a relay that
  // cannot take it decides nothing and writes nothing.
  it("checks and writes under the ledgers' lock, refusing while another writer holds it", async () => {
    const seat = await seeded();
    const { home } = seat;
    const verdict = { candidate: "c-001", reaction: "no" } as const;
    const busy = unwrapErr(
      await underLedgerLock({
        home,
        nowIso: NOW,
        run: () =>
          applyCandidateRuling({ ...seat, anchor: ANCHOR, heard: "not mine", nowIso: NOW, turnId: TURN, verdict }),
      }),
    );
    expect(busy.code).toBe("REGISTER_BUSY");
    expect(unwrap(readReactionRows({ home }))).toEqual([]);
  });

  it("answers a replay that finds its own row as already carried, even while another writer holds the lock", async () => {
    const seat = await seeded();
    const { home } = seat;
    const verdict = { candidate: "c-001", reaction: "no" } as const;
    const apply = (): ReturnType<typeof applyCandidateRuling> =>
      applyCandidateRuling({ ...seat, anchor: ANCHOR, heard: "not mine", nowIso: NOW, turnId: TURN, verdict });
    expect(unwrap(await apply()).written).toBe(true);
    const replay = unwrap(await underLedgerLock({ home, nowIso: NOW, run: () => apply() }));
    expect([replay.candidate, replay.reaction, replay.written]).toEqual(["c-001", "no", false]);
    expect(unwrap(readReactionRows({ home }))).toHaveLength(1);
  });

  // A lone surrogate prints as U+FFFD, so a row carrying one could never be read back
  // as held — the writer refuses it, as the reader would.
  it("refuses words that are not well-formed Unicode, writing nothing", async () => {
    const seat = await seeded();
    const { home } = seat;
    const verdict = { candidate: "c-001", reaction: "no" } as const;
    const refused = unwrapErr(
      await applyCandidateRuling({
        ...seat,
        anchor: ANCHOR,
        heard: "not \ud800 mine",
        nowIso: NOW,
        turnId: TURN,
        verdict,
      }),
    );
    expect(refused.code).toBe("REACTION_REFUSED");
    expect(refused.message).toContain("well-formed Unicode");
    expect(unwrap(readReactionRows({ home }))).toEqual([]);
  });

  it("answers a replay from the ledger alone, even when the candidates file no longer reads", async () => {
    const seat = await seeded();
    const { home } = seat;
    const verdict = { candidate: "c-001", reaction: "no" } as const;
    const apply = (): ReturnType<typeof applyCandidateRuling> =>
      applyCandidateRuling({ ...seat, anchor: ANCHOR, heard: "not mine", nowIso: NOW, turnId: TURN, verdict });
    expect(unwrap(await apply()).written).toBe(true);
    writeFileSync(join(home, "workstreams", "candidates.json"), "not json", { mode: 0o600 });
    const replay = unwrap(await apply());
    expect([replay.candidate, replay.reaction, replay.written]).toEqual(["c-001", "no", false]);
  });

  it("writes nothing for a candidate the file does not carry", async () => {
    const seat = await seeded();
    const { home } = seat;
    const verdict = { candidate: "c-999", reaction: "yes" } as const;
    const refused = unwrapErr(
      await applyCandidateRuling({ ...seat, anchor: ANCHOR, heard: "yes", nowIso: NOW, turnId: TURN, verdict }),
    );
    expect(refused.code).toBe("CANDIDATE_UNKNOWN");
    expect(unwrap(readReactionRows({ home }))).toEqual([]);
  });
});
