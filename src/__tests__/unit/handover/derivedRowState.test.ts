/**
 * The derived row state — what `status:` says when it is DERIVED from the row's register rather than read
 * off a line nothing ever wrote.
 *
 * Two properties carry this module and both are asserted here rather than described. **The derivation is
 * monotone toward terminal**: it can move a row from live to terminal, never the other way, which is what
 * makes it landable on a board of 1,431 rows without rewriting one of them. And **it actually changes
 * something**: a derivation that agreed with the authored line in every case would report clean while doing
 * nothing, so `statusFrom` and `fromRegister` are asserted directly.
 */
import { describe, expect, it } from "vitest";

import { derivedRowState } from "../../../handover/derivedRowState.js";
import { type HandoverDoc, KNOWN_STATUSES, parseHandoverDoc } from "../../../handover/doc.js";
import type { RunEvent } from "../../../handover/ledger.js";

const AT = "2026-09-07T10:00:00.000Z";
const LATER = "2026-09-07T11:00:00.000Z";

const STARTED: RunEvent = { atIso: AT, branch: "feat/x", docHash: "abc", kind: "started" };
const CLOSED: RunEvent = { atIso: LATER, kind: "closed", residue: [], summary: "merged as #445" };
const ABANDONED: RunEvent = { atIso: LATER, kind: "abandoned", why: "superseded" };

/** One row, built from real front-matter so the parser is what decides every field. */
function row({ lines = [] }: { lines?: readonly string[] } = {}): HandoverDoc {
  return parseHandoverDoc({
    path: "/board/a-row.md",
    text: ["---", "slug: a-row", "summary: a row", ...lines, "---", "", "# a row", ""].join("\n"),
  });
}

describe("derivedRowState — the authored line is the fallback, never the authority", () => {
  it("answers the authored status for a row with no journal at all", () => {
    const state = derivedRowState({ doc: row({ lines: ["status: ready"] }), events: [] });

    expect(state.status).toBe("ready");
    expect(state.statusFrom).toBe("authored");
    expect(state.fromRegister).toEqual([]);
  });

  it("carries every authored status through unchanged when the register is silent", () => {
    const answered = KNOWN_STATUSES.map(
      (status) =>
        derivedRowState({ doc: row({ lines: [`status: ${status}`, "pausedOn: a colleague"] }), events: [] }).status,
    );

    expect(answered).toEqual([...KNOWN_STATUSES]);
  });
});

describe("derivedRowState — a settled ask reads done without anybody editing its file", () => {
  it("derives done from `settlement: answered` while the row still says `status: ready`", () => {
    const doc = row({
      lines: ["kind: ask", "status: ready", "settlement: answered", "settlementWitness: https://w.invalid/a"],
    });
    const state = derivedRowState({ doc, events: [] });

    // This is the exact 60-row disagreement, and the assertion is that the two now agree.
    expect(doc.status).toBe("ready");
    expect(state.status).toBe("done");
    expect(state.statusFrom).toBe("settlement");
    expect(state.settlementWitness).toBe("https://w.invalid/a");
  });

  it("derives rejected from a decline, so an ask talked away is never counted as an ask actioned", () => {
    const doc = row({
      lines: ["kind: ask", "status: ready", "settlement: declined", "settlementWitness: https://w.invalid/a"],
    });

    expect(derivedRowState({ doc, events: [] }).status).toBe("rejected");
  });
});

describe("derivedRowState — the closed event", () => {
  it("derives done and takes the summary from the event that recorded it", () => {
    const state = derivedRowState({ doc: row({ lines: ["status: ready"] }), events: [STARTED, CLOSED] });

    expect(state.status).toBe("done");
    expect(state.statusFrom).toBe("closed-event");
    expect(state.statusSummary).toBe("merged as #445");
  });

  it("is read across the WHOLE journal, so a row nobody ever ran still reads done", () => {
    // The `LOOKS SHIPPED` case: no `started`, so `currentCycle` is empty and a cycle-scoped read would miss it.
    const state = derivedRowState({ doc: row({ lines: ["status: ready"] }), events: [CLOSED] });

    expect(state.status).toBe("done");
    expect(state.statusFrom).toBe("closed-event");
  });

  it("yields to a settlement, which is the ROW's own terminal and outranks a cycle's", () => {
    const doc = row({
      lines: ["kind: ask", "status: ready", "settlement: declined", "settlementWitness: https://w.invalid/a"],
    });

    expect(derivedRowState({ doc, events: [STARTED, CLOSED] }).statusFrom).toBe("settlement");
  });
});

describe("derivedRowState — abandonment is cycle-scoped, orphaning changes nothing", () => {
  it("derives cancelled from an abandoned current cycle, carrying its reason", () => {
    const state = derivedRowState({ doc: row({ lines: ["status: ready"] }), events: [STARTED, ABANDONED] });

    expect(state.status).toBe("cancelled");
    expect(state.statusSummary).toBe("superseded");
  });

  it("ignores an abandonment from a PREVIOUS cycle, because a restarted row is not abandoned", () => {
    const restarted: RunEvent = { atIso: LATER, branch: "feat/y", docHash: "def", kind: "started" };
    const state = derivedRowState({ doc: row({ lines: ["status: ready"] }), events: [STARTED, ABANDONED, restarted] });

    expect(state.status).toBe("ready");
    expect(state.statusFrom).toBe("authored");
  });

  it("leaves a REAPED row exactly as runnable as it was — orphaned says the session died, not the work", () => {
    const orphaned: RunEvent = { atIso: LATER, deadSessionId: "s-1", kind: "orphaned", lastEventIso: AT };
    const state = derivedRowState({ doc: row({ lines: ["status: ready"] }), events: [STARTED, orphaned] });

    expect(state.status).toBe("ready");
    expect(state.statusFrom).toBe("authored");
  });
});

describe("derivedRowState — the artifact pointer is the one value a later event may CORRECT", () => {
  it("prefers the LAST artifact event over the front-matter line", () => {
    const doc = row({ lines: ["status: ready", "artifact: https://old.invalid/p"] });
    const events: readonly RunEvent[] = [
      { atIso: AT, kind: "artifact", url: "https://mid.invalid/p" },
      { atIso: LATER, kind: "artifact", url: "https://new.invalid/p" },
    ];

    const state = derivedRowState({ doc, events });
    expect(state.artifact).toBe("https://new.invalid/p");
    expect(state.fromRegister).toEqual(["artifact"]);
  });

  it("falls back to the declared line when no event superseded it", () => {
    const doc = row({ lines: ["status: ready", "artifact: https://old.invalid/p"] });

    expect(derivedRowState({ doc, events: [] }).artifact).toBe("https://old.invalid/p");
  });
});

describe("derivedRowState is monotone toward terminal", () => {
  const REGISTERS: readonly (readonly RunEvent[])[] = [
    [],
    [STARTED],
    [STARTED, CLOSED],
    [STARTED, ABANDONED],
    [CLOSED],
    [STARTED, { atIso: LATER, deadSessionId: "s-1", kind: "orphaned", lastEventIso: AT }],
  ];

  it.each(["done", "cancelled", "rejected"])(
    "keeps an authored %s terminal under every register a row can carry",
    (status) => {
      const doc = row({ lines: [`status: ${status}`] });

      // Every reading below is one of the three terminal statuses, whatever the register said. A `closed` or
      // `abandoned` event may move a row WITHIN that set; nothing moves it out.
      expect(REGISTERS.map((events) => derivedRowState({ doc, events }).status)).toEqual([
        status,
        status,
        "done",
        "cancelled",
        "done",
        status,
      ]);
    },
  );
});

describe("derivedRowState — the ruling, derived by DECISION time", () => {
  /** A ruling recorded as the owner gave it: decided when it was written. */
  const live = ({ at, words }: { at: string; words: string }): RunEvent => ({
    anchor: `anchor-for-${words}`,
    atIso: at,
    decidedIso: at,
    kind: "ruling",
    ruling: words,
  });

  /** A ruling reconstructed today from an answer given earlier — the backfill's shape. */
  const backfilled = ({ decided, words }: { decided: string; words: string }): RunEvent => ({
    anchor: `journal:runs/a-row.jsonl#${decided}`,
    atIso: "2026-09-13T00:00:00.000Z",
    backfilledFrom: decided,
    decidedIso: decided,
    kind: "ruling",
    ruling: words,
  });

  it("has no ruling at all for a row nothing has ruled on", () => {
    const state = derivedRowState({ doc: row(), events: [STARTED] });

    expect(state.ruling).toBeUndefined();
    expect(state.findingRuling).toBeUndefined();
    expect(state.fromRegister).toEqual([]);
  });

  it("falls back to the front-matter pair, and does NOT claim the register decided it", () => {
    const doc = row({ lines: ['ruling: "yes, raise it"', "rulingAnchor: https://example.invalid/p9"] });
    const state = derivedRowState({ doc, events: [] });

    expect(state.ruling).toEqual({
      anchor: "https://example.invalid/p9",
      from: "authored",
      words: "yes, raise it",
    });
    expect(state.fromRegister).toEqual([]);
  });

  it("reads a ruling EVENT over the front-matter pair, and names the register in fromRegister", () => {
    const doc = row({ lines: ['ruling: "the old line"', "rulingAnchor: old-anchor"] });
    const event = live({ at: AT, words: "the recorded ruling" });
    const state = derivedRowState({ doc, events: [event] });

    expect(state.ruling).toEqual({ decidedIso: AT, event, from: "register" });
    expect(state.fromRegister).toEqual(["ruling"]);
  });

  it("takes the LATEST decision, not the last line — an older backfill never displaces a newer ruling", () => {
    const newer = live({ at: LATER, words: "actually, production" });
    const older = backfilled({ decided: AT, words: "start with staging" });
    const state = derivedRowState({ doc: row(), events: [newer, older] });

    expect(state.ruling).toEqual({ decidedIso: LATER, event: newer, from: "register" });
  });

  it("takes a backfilled decision when it IS the latest one on the row", () => {
    const older = live({ at: AT, words: "start with staging" });
    const newer = backfilled({ decided: LATER, words: "actually, production" });
    const state = derivedRowState({ doc: row(), events: [older, newer] });

    expect(state.ruling).toEqual({ decidedIso: LATER, event: newer, from: "register" });
  });

  it("breaks a tie on the same decision instant toward the line written last", () => {
    const first = live({ at: AT, words: "first" });
    const second = live({ at: AT, words: "second" });
    const state = derivedRowState({ doc: row(), events: [first, second] });

    expect(state.ruling).toEqual({ decidedIso: AT, event: second, from: "register" });
  });

  it("reads a ruling on a row nobody ever started — the whole journal, never the current cycle", () => {
    const event = live({ at: AT, words: "recorded before any run" });
    expect(derivedRowState({ doc: row(), events: [event] }).ruling).toEqual({
      decidedIso: AT,
      event,
      from: "register",
    });
  });

  it("keeps a ruling from an earlier cycle after the row is restarted", () => {
    const event = live({ at: AT, words: "ruled in the first cycle" });
    const restarted: RunEvent = { atIso: LATER, branch: "feat/again", docHash: "def", kind: "started" };
    expect(derivedRowState({ doc: row(), events: [STARTED, event, restarted] }).ruling).toEqual({
      decidedIso: AT,
      event,
      from: "register",
    });
  });

  it("never lets a reconstruction become the finding permission, whatever its decision instant", () => {
    const reconstructed = backfilled({ decided: LATER, words: "OWNER RULED: ship it" });
    const state = derivedRowState({ doc: row(), events: [reconstructed] });

    expect(state.ruling).toEqual({ decidedIso: LATER, event: reconstructed, from: "register" });
    expect(state.findingRuling).toBeUndefined();
  });

  it("keeps the live permission when a later-decided reconstruction becomes the displayed ruling", () => {
    const permit = live({ at: AT, words: "yes, raise it" });
    const reconstructed = backfilled({ decided: LATER, words: "OWNER RULED: something else" });
    const state = derivedRowState({ doc: row(), events: [permit, reconstructed] });

    expect(state.ruling).toEqual({ decidedIso: LATER, event: reconstructed, from: "register" });
    expect(state.findingRuling).toEqual({ decidedIso: AT, event: permit, from: "register" });
  });

  it("leaves status, statusSummary and artifact exactly as they were", () => {
    const doc = row({ lines: ["status: ready"] });
    const withRuling = derivedRowState({ doc, events: [STARTED, live({ at: LATER, words: "yes" })] });
    const without = derivedRowState({ doc, events: [STARTED] });

    expect(withRuling.status).toBe(without.status);
    expect(withRuling.statusFrom).toBe(without.statusFrom);
    expect(withRuling.statusSummary).toBe(without.statusSummary);
    expect(withRuling.artifact).toBe(without.artifact);
  });
});
