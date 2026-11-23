/**
 * `applyRowEvent` on a `ruling` event: a live ruling is appended without touching the run's phase, even over a
 * damaged line or a word this build predates, and hands back the lines it skipped; a reconstruction is appended only
 * when its words equal the one answer it names, and refused over any line nothing can read. A genuine `mkdtempSync`
 * round trip, every directory removed after the case that minted it.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { parseLedger, type RunEvent } from "../../../../handover/ledger.js";
import { applyRowEvent } from "../../../../handover/rowEvent.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { AT, LATER, runsDir, STARTED, seed, useRunsDirs } from "./harness.js";

useRunsDirs();

describe("applyRowEvent on a `ruling` event", () => {
  const SOURCE: RunEvent = { answer: "OWNER RULED: ship it", atIso: AT, kind: "answered" };
  const LIVE: RunEvent = { anchor: "p9", atIso: LATER, decidedIso: LATER, kind: "ruling", ruling: "yes, raise it" };
  const RECONSTRUCTED: RunEvent = {
    anchor: `journal:runs/a-row.jsonl#${AT}`,
    atIso: "2026-09-13T02:00:00.000Z",
    backfilledFrom: AT,
    decidedIso: AT,
    kind: "ruling",
    ruling: "OWNER RULED: ship it",
  };

  it("appends a ruling to a row that was never started, and the file reads it back", () => {
    const dir = runsDir();
    const written = applyRowEvent({ event: LIVE, runsDir: dir, slug: "a-row" });

    expect(written.isOk()).toBe(true);
    expect(parseLedger({ text: readFileSync(unwrap(written).path, "utf8") })).toEqual({
      events: [LIVE],
      unknownKind: [],
      unreadable: [],
    });
  });

  it("leaves the run's phase alone — a ruling is not an answer", () => {
    const dir = runsDir();
    seed({ dir, events: [STARTED, { atIso: AT, kind: "question", question: "which base?" }], slug: "a-row" });
    const written = applyRowEvent({ event: LIVE, runsDir: dir, slug: "a-row" });

    expect(unwrap(written).state.phase).toBe("waiting-on-owner");
    expect(unwrap(written).state.openQuestion).toBe("which base?");
  });

  it("appends a reconstruction whose words equal the answer it names", () => {
    const dir = runsDir();
    seed({ dir, events: [SOURCE], slug: "a-row" });

    expect(applyRowEvent({ event: RECONSTRUCTED, runsDir: dir, slug: "a-row" }).isOk()).toBe(true);
  });

  it("refuses a reconstruction whose source answer is not on the journal, and writes nothing", () => {
    const dir = runsDir();
    seed({ dir, events: [STARTED], slug: "a-row" });
    const written = applyRowEvent({ event: RECONSTRUCTED, runsDir: dir, slug: "a-row" });

    expect(unwrapErr(written).code).toBe("RULING_INTEGRITY_FAILED");
    expect(parseLedger({ text: readFileSync(join(dir, "a-row.jsonl"), "utf8") }).events).toEqual([STARTED]);
  });

  it("refuses a reconstruction whose words are another row's, even at a matching instant", () => {
    const dir = runsDir();
    seed({ dir, events: [{ answer: "a completely different answer", atIso: AT, kind: "answered" }], slug: "a-row" });
    const written = applyRowEvent({ event: RECONSTRUCTED, runsDir: dir, slug: "a-row" });

    expect(unwrapErr(written).code).toBe("RULING_INTEGRITY_FAILED");
  });

  it("refuses a second reconstruction of the same source answer, so a re-run appends nothing", () => {
    const dir = runsDir();
    seed({ dir, events: [SOURCE, RECONSTRUCTED], slug: "a-row" });
    const written = applyRowEvent({ event: RECONSTRUCTED, runsDir: dir, slug: "a-row" });

    expect(unwrapErr(written).code).toBe("RULING_INTEGRITY_FAILED");
    expect(parseLedger({ text: readFileSync(join(dir, "a-row.jsonl"), "utf8") }).events.length).toBe(2);
  });

  // A `parked` line from an unmerged branch made `handover rule` refuse the owner's read of a briefing on
  // the row they were looking at. The owner's live word is appended and the skip handed back for the verb to state.
  it("appends a LIVE ruling over a damaged line and hands back the line it skipped", () => {
    const dir = runsDir();
    writeFileSync(join(dir, "a-row.jsonl"), `${JSON.stringify(SOURCE)}\n{"kind":"ruling","atIs\n`, "utf8");
    const written = unwrap(applyRowEvent({ event: LIVE, runsDir: dir, slug: "a-row" }));

    expect(written.skipped).toEqual({ unknownKind: [], unreadable: [2] });
    expect(parseLedger({ text: readFileSync(written.path, "utf8") }).events).toEqual([SOURCE, LIVE]);
  });

  it("appends a LIVE ruling over a word this build predates, and names that word", () => {
    const dir = runsDir();
    const future = JSON.stringify({ atIso: AT, kind: "some-future-kind" });
    writeFileSync(join(dir, "a-row.jsonl"), `${JSON.stringify(STARTED)}\n${future}\n`, "utf8");
    const written = unwrap(applyRowEvent({ event: LIVE, runsDir: dir, slug: "a-row" }));

    expect(written.skipped.unreadable).toEqual([2]);
    expect(written.skipped.unknownKind.map((entry) => entry.kind)).toEqual(["some-future-kind"]);
    expect(parseLedger({ text: readFileSync(written.path, "utf8") }).events).toEqual([STARTED, LIVE]);
  });

  it("hands back no skipped lines on a clean journal", () => {
    const dir = runsDir();
    seed({ dir, events: [SOURCE], slug: "a-row" });

    expect(unwrap(applyRowEvent({ event: LIVE, runsDir: dir, slug: "a-row" })).skipped).toEqual({
      unknownKind: [],
      unreadable: [],
    });
  });

  it("still refuses a RECONSTRUCTION over an undecodable line — its source may be that line", () => {
    const dir = runsDir();
    writeFileSync(join(dir, "a-row.jsonl"), `${JSON.stringify(SOURCE)}\n{"kind":"answered","atIs\n`, "utf8");
    const written = applyRowEvent({ event: RECONSTRUCTED, runsDir: dir, slug: "a-row" });

    expect(unwrapErr(written).code).toBe("JOURNAL_INCOMPLETE");
    expect(unwrapErr(written).message).toContain("reconstruct a ruling on a journal with undecodable line(s) 2");
    expect(parseLedger({ text: readFileSync(join(dir, "a-row.jsonl"), "utf8") }).events).toEqual([SOURCE]);
  });

  it("still refuses an exact duplicate of a readable ruling over an undecodable line", () => {
    const dir = runsDir();
    writeFileSync(join(dir, "a-row.jsonl"), `${JSON.stringify(LIVE)}\n{"kind":"ruling","atIs\n`, "utf8");
    const written = applyRowEvent({ event: LIVE, runsDir: dir, slug: "a-row" });

    expect(unwrapErr(written).code).toBe("RULING_INTEGRITY_FAILED");
  });

  // A gate keeps firing off the lines that DID decode, and `handover gate
  // release` is the only lift — so refusing this one shape left a permanent refusal nothing could lift.
  it("appends a RELEASE-only ruling over an undecodable line, because a gate must stay liftable", () => {
    const dir = runsDir();
    writeFileSync(join(dir, "a-row.jsonl"), `${JSON.stringify(SOURCE)}\n{"kind":"ruling","atIs\n`, "utf8");
    const release: RunEvent = {
      anchor: "p10",
      atIso: LATER,
      decidedIso: LATER,
      gateReleases: ["a-row#2026-09-07T10:30:00.000Z"],
      kind: "ruling",
      ruling: "ok, that one can go out now",
    };

    const written = applyRowEvent({ event: release, runsDir: dir, slug: "a-row" });

    expect(written.isOk()).toBe(true);
    expect(parseLedger({ text: readFileSync(unwrap(written).path, "utf8") }).events).toEqual([SOURCE, release]);
  });

  it("appends a ruling that PLACES a gate over an undecodable line — the owner's word bites even beside one", () => {
    const dir = runsDir();
    writeFileSync(join(dir, "a-row.jsonl"), `${JSON.stringify(SOURCE)}\n{"kind":"ruling","atIs\n`, "utf8");
    const placing: RunEvent = {
      anchor: "p11",
      atIso: LATER,
      decidedIso: LATER,
      gate: { subjects: [], verbs: [{ noun: "slack", verb: "post" }] },
      kind: "ruling",
      ruling: "stop posting that",
    };
    const written = unwrap(applyRowEvent({ event: placing, runsDir: dir, slug: "a-row" }));

    expect(parseLedger({ text: readFileSync(written.path, "utf8") }).events).toEqual([SOURCE, placing]);
  });

  it("still appends a NON-ruling event to a journal with an undecodable line, exactly as before", () => {
    const dir = runsDir();
    writeFileSync(join(dir, "a-row.jsonl"), `${JSON.stringify(STARTED)}\n{"kind":"probed","atIs\n`, "utf8");

    expect(
      applyRowEvent({
        event: { atIso: LATER, failed: 0, kind: "probed", passed: 3 },
        runsDir: dir,
        slug: "a-row",
      }).isOk(),
    ).toBe(true);
  });
});
