/**
 * The owner's condition, as a test: the owner's words must survive derivation, byte for byte.
 *
 * Deriving the briefing's narrative sections must not lose critical context about what the owner said,
 * and must re-derive that context without making the owner explain it again.
 *
 * So this file asserts the property POSITIVELY — the exact string comes out the other end of the whole
 * path, reconciliation document → owner-turn snapshot → finalised row → ledger line → parsed row — and then
 * proves the assertion can FAIL by changing one character and watching it. A test that can only pass is
 * worse than no test, so the negative control is not optional here.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { finaliseSupervisorTick, parseSupervisorTickDraft } from "../../../cli/commands/supervisor/tickRecordCore.js";
import { unwrap } from "../../../lib/result.js";
import { ownerTurnSnapshotOf } from "../../../supervisor/tickOwnerTurns.js";
import {
  appendSupervisorTick,
  parseSupervisorTickLine,
  supervisorTickLedgerPath,
} from "../../../supervisor/tickStore.js";
import { TICK_SOURCE_KINDS } from "../../../supervisor/tickTypes.js";

/**
 * A turn carrying everything a naive projection would mangle: a newline, an em dash, a bare issue reference the
 * composed voice rules would want to rewrite into a linked key, HTML metacharacters, and a right single
 * quote. Modelled on the owner's real turns, which are voice-to-text and routinely run several sentences.
 */
const OWNER_TEXT =
  ">4. Do the 39 lint gates print the four-line message?\n" +
  "lets go with your lean — i don't want a <second> gate for #16324 & the same class again, " +
  "it's the sort of thing that just ends up in bullshit like this";

/** The instant every fixture in this file is anchored to, so nothing here reads a clock. */
const TICK_ISO = "2026-09-10T12:20:00.000Z";

/**
 * One reconciliation document carrying one owner turn — the slice `ownerTurnSnapshotOf` reads.
 *
 * @param text the turn's own words
 * @returns the document, as `slopweaver handover reconcile --json` shapes it
 */
function reconciliationWith({ text }: { text: string }): unknown {
  return {
    headline: "4 of 25 live session(s) are on the board's top 5.",
    intake: {
      finding: {
        coverage: {
          earliestIso: "2026-08-10T00:41:38.416Z",
          linksKnown: 228,
          reachesSince: true,
          unreadable: [],
          walked: ["a1"],
        },
        inGrace: 1,
        legs: [{ fromIso: "2026-09-09T12:00:00.000Z", sessionId: "a1", turns: 1 }],
        markedNoAsk: 0,
        sinceIso: "2026-09-09T12:00:00.000Z",
        turns: [
          {
            inGrace: true,
            turn: {
              lineNumber: 1654,
              pointer: "transcript:a0000045-0000-4000-8000-000000000048#a2579072-452d-43f0-b261-5818d9361acb",
              sessionId: "a0000045-0000-4000-8000-000000000048",
              source: "typed",
              text,
              timestamp: "2026-09-10T11:55:56.547Z",
              turnUuid: "a2579072-452d-43f0-b261-5818d9361acb",
            },
            witness: { kind: "row", witness: "derive-the-briefing-narrative-sections-from-the-ledgers" },
          },
        ],
        unwitnessed: [],
        witnessed: 1,
      },
      kind: "read",
    },
    intakeClause: "Owner turns: 19 read across 16 supervisor session(s), all witnessed.",
  };
}

/**
 * The same document, with the turn's own timestamp replaced.
 *
 * @param timestamp what the reconciliation carried for the turn's instant
 * @returns the document
 */
function reconciliationWithTimestamp({ timestamp }: { timestamp: string }): unknown {
  const document = reconciliationWith({ text: OWNER_TEXT }) as {
    intake: { finding: { turns: { turn: { timestamp: string } }[] } };
  };
  document.intake.finding.turns[0]!.turn.timestamp = timestamp;
  return document;
}

/**
 * A draft whose twelve sources are all `unavailable` — the honest shape of a tick that read nothing, and
 * the smallest one the schema accepts.
 *
 * @returns the draft document
 */
function minimalDraft(): unknown {
  const sources: Record<string, unknown> = {};
  for (const kind of TICK_SOURCE_KINDS) {
    sources[kind] = {
      diagnostic: "not read by this fixture",
      observedAtIso: "2026-09-10T12:10:00.000Z",
      status: "unavailable",
      witness: { command: `slopweaver ${kind}`, exitCode: null },
    };
  }
  return {
    actions: [],
    handoff: "handoff-9226",
    judgements: [],
    sources,
    startedIso: "2026-09-10T12:00:00.000Z",
    tickId: "tick-226-2",
    workspace: "workspace:61",
  };
}

describe("the owner's words survive the whole derivation path", () => {
  const homes: string[] = [];

  afterEach(() => {
    for (const home of homes.splice(0)) {
      rmSync(home, { force: true, recursive: true });
    }
  });

  it("carries the exact turn text from a reconciliation into a ledger line and back", () => {
    const home = mkdtempSync(join(tmpdir(), "sw-tick-"));
    homes.push(home);
    const snapshot = unwrap(ownerTurnSnapshotOf({ document: reconciliationWith({ text: OWNER_TEXT }) }));
    const draft = unwrap(parseSupervisorTickDraft({ document: minimalDraft() }));
    const row = unwrap(finaliseSupervisorTick({ draft, finalisedIso: TICK_ISO, ownerTurns: snapshot }));
    const path = unwrap(appendSupervisorTick({ home, row }));

    expect(path).toBe(supervisorTickLedgerPath({ home }));
    const line = readFileSync(path, "utf8").trimEnd();
    const readBack = unwrap(parseSupervisorTickLine({ line }));

    expect(readBack.ownerTurns.turns.length).toBe(1);
    expect(readBack.ownerTurns.turns[0]!.text).toBe(OWNER_TEXT);
    expect(readBack.ownerTurns.turns[0]!.pointer).toBe(
      "transcript:a0000045-0000-4000-8000-000000000048#a2579072-452d-43f0-b261-5818d9361acb",
    );
    expect(readBack.ownerTurns.turns[0]!.instantIso).toBe("2026-09-10T11:55:56.547Z");
    expect(readBack.ownerTurns.turns[0]!.witness!.kind).toBe("row");
    expect(readBack.ownerTurns.status).toBe("read");
  });

  it("fails when one character of the owner's words changes — the assertion's own negative control", () => {
    const mutated = `${OWNER_TEXT.slice(0, 60)}X${OWNER_TEXT.slice(61)}`;
    const snapshot = unwrap(ownerTurnSnapshotOf({ document: reconciliationWith({ text: mutated }) }));

    expect(snapshot.turns.length).toBe(1);
    expect(snapshot.turns[0]!.text).not.toBe(OWNER_TEXT);
    expect(snapshot.turns[0]!.text).toBe(mutated);
  });

  it("maps the absent-instant sentinel onto null, losslessly in both directions", () => {
    // `src/transcripts/record.ts` decodes a line with no timestamp as `""`, so the two spellings are the
    // same state. A Codex review pass called the normalisation a mutation; this pins that it is total over
    // exactly two states and touches nothing else.
    const absent = unwrap(ownerTurnSnapshotOf({ document: reconciliationWithTimestamp({ timestamp: "" }) }));
    const present = unwrap(
      ownerTurnSnapshotOf({ document: reconciliationWithTimestamp({ timestamp: "2026-09-10T11:55:56.547Z" }) }),
    );

    expect(absent.turns[0]!.instantIso).toBe(null);
    expect(present.turns[0]!.instantIso).toBe("2026-09-10T11:55:56.547Z");
    // Every other field of the two turns is identical, so the mapping touched only the instant.
    expect({ ...absent.turns[0]!, instantIso: null }).toEqual({ ...present.turns[0]!, instantIso: null });
  });

  it("records a turn whose clock field will not parse, rather than losing the whole tick", () => {
    // MEASURED by a Codex review pass: with the instant held to a strict ISO shape, one unreadable
    // timestamp made the recorder append ZERO lines — discarding every other turn in that tick with it.
    const home = mkdtempSync(join(tmpdir(), "sw-tick-"));
    homes.push(home);
    const snapshot = unwrap(
      ownerTurnSnapshotOf({ document: reconciliationWithTimestamp({ timestamp: "not-an-instant" }) }),
    );
    const draft = unwrap(parseSupervisorTickDraft({ document: minimalDraft() }));
    const row = unwrap(finaliseSupervisorTick({ draft, finalisedIso: TICK_ISO, ownerTurns: snapshot }));
    const path = unwrap(appendSupervisorTick({ home, row }));
    const readBack = unwrap(parseSupervisorTickLine({ line: readFileSync(path, "utf8").trimEnd() }));

    expect(readBack.ownerTurns.turns.length).toBe(1);
    expect(readBack.ownerTurns.turns[0]!.instantIso).toBe("not-an-instant");
    expect(readBack.ownerTurns.turns[0]!.text).toBe(OWNER_TEXT);
  });

  it("records two turns that share a pointer, rather than losing both and the tick", () => {
    // MEASURED by a Codex review pass: a repeated pointer is upstream data, not our defect, and refusing it
    // dropped BOTH turns and every other turn in that tick.
    const document = reconciliationWith({ text: OWNER_TEXT }) as {
      intake: { finding: { turns: unknown[] } };
    };
    const first = document.intake.finding.turns[0]!;
    document.intake.finding.turns.push(JSON.parse(JSON.stringify(first)));
    const second = document.intake.finding.turns[1] as { turn: { text: string; lineNumber: number } };
    second.turn.text = "second distinct owner line";
    second.turn.lineNumber = 1655;
    const snapshot = unwrap(ownerTurnSnapshotOf({ document }));
    const draft = unwrap(parseSupervisorTickDraft({ document: minimalDraft() }));
    const row = unwrap(finaliseSupervisorTick({ draft, finalisedIso: TICK_ISO, ownerTurns: snapshot }));

    expect(row.ownerTurns.turns.length).toBe(2);
    expect(row.ownerTurns.turns[0]!.text).toBe(OWNER_TEXT);
    expect(row.ownerTurns.turns[1]!.text).toBe("second distinct owner line");
  });

  it('records a turn\'s source label as carried, rather than mapping an unknown one onto "unknown"', () => {
    const document = reconciliationWith({ text: OWNER_TEXT }) as {
      intake: { finding: { turns: { turn: { source: string } }[] } };
    };
    document.intake.finding.turns[0]!.turn.source = "some-future-input-mode";
    const snapshot = unwrap(ownerTurnSnapshotOf({ document }));

    expect(snapshot.turns.length).toBe(1);
    expect(snapshot.turns[0]!.source).toBe("some-future-input-mode");
    expect(snapshot.turns[0]!.text).toBe(OWNER_TEXT);
  });

  it("records an unwitnessed turn and a whole-chain read as null, and carries each when present", () => {
    const present = unwrap(ownerTurnSnapshotOf({ document: reconciliationWith({ text: OWNER_TEXT }) }));
    const document = reconciliationWith({ text: OWNER_TEXT }) as {
      intake: { finding: { sinceIso?: string; turns: { witness?: unknown }[] } };
    };
    delete document.intake.finding.sinceIso;
    delete document.intake.finding.turns[0]!.witness;
    const absent = unwrap(ownerTurnSnapshotOf({ document }));

    expect(present.turns[0]!.witness).toEqual({
      kind: "row",
      witness: "derive-the-briefing-narrative-sections-from-the-ledgers",
    });
    expect(present.sinceIso).toBe("2026-09-09T12:00:00.000Z");
    expect(absent.turns[0]!.witness).toBe(null);
    expect(absent.sinceIso).toBe(null);
  });

  it("records a turn that said nothing rather than dropping it", () => {
    const snapshot = unwrap(ownerTurnSnapshotOf({ document: reconciliationWith({ text: "" }) }));

    expect(snapshot.turns.length).toBe(1);
    expect(snapshot.turns[0]!.text).toBe("");
  });

  it("reports an unavailable intake as unavailable rather than as no turns", () => {
    const snapshot = unwrap(
      ownerTurnSnapshotOf({
        document: { intake: { kind: "unavailable", why: "no supervisor pin on this machine" } },
      }),
    );

    expect(snapshot.status).toBe("unavailable");
    expect(snapshot.turns.length).toBe(0);
    expect(snapshot.status === "unavailable" ? snapshot.diagnostic : "").toBe("no supervisor pin on this machine");
  });

  it("states a reason when an unavailable intake gave none, rather than dropping the tick", () => {
    const snapshot = unwrap(ownerTurnSnapshotOf({ document: { intake: { kind: "unavailable", why: "" } } }));

    expect(snapshot.status).toBe("unavailable");
    expect(snapshot.status === "unavailable" ? snapshot.diagnostic : "").toBe(
      "the reconciliation reported the owner-turn intake unavailable and gave no reason",
    );
  });

  it("reports a chain that would not walk as partial, naming both halves of the gap", () => {
    const document = reconciliationWith({ text: OWNER_TEXT }) as {
      intake: { finding: { coverage: { reachesSince: boolean; unreadable: unknown[] } } };
    };
    document.intake.finding.coverage.unreadable = [{ claudeSessionId: "b2", why: "transcript deleted" }];
    document.intake.finding.coverage.reachesSince = false;
    const snapshot = unwrap(ownerTurnSnapshotOf({ document }));

    expect(snapshot.status).toBe("partial");
    expect(snapshot.status === "partial" ? snapshot.diagnostic : "").toBe(
      "1 supervisor transcript(s) would not walk — each one's own reason is in this row's " +
        "`ownerTurns.coverage.unreadable` — the chain does not reach the floor asked for, so turns before " +
        "it were never read",
    );
    // The reason itself is retained ONCE, in the coverage, rather than repeated into the diagnostic.
    expect(snapshot.status === "partial" ? snapshot.coverage.unreadable[0]!.why : "").toBe("transcript deleted");
  });
});
