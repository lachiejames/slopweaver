/**
 * `applyRowEvent`'s four acts on the ordinary events: validate, guard the transition, append, read back. A schema
 * refusal writes nothing, a second terminal or a second `closed` is refused, a question is reconfirmed, withdrawn or
 * answered only while it is the one open, an artifact supersedes by append, and an unreadable journal is a typed IO
 * failure. A genuine `mkdtempSync` round trip, every directory removed after the case that minted it.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { parseLedger } from "../../../../handover/ledger.js";
import { applyRowEvent } from "../../../../handover/rowEvent.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { AT, LATER, runsDir, STARTED, seed, useRunsDirs } from "./harness.js";

useRunsDirs();

describe("applyRowEvent", () => {
  it("appends a valid event and re-derives the state from the file", () => {
    const dir = runsDir();
    const written = applyRowEvent({ event: STARTED, runsDir: dir, slug: "a-row" });
    expect(written.isOk()).toBe(true);
    const value = unwrap(written);
    expect(value.path).toBe(join(dir, "a-row.jsonl"));
    expect(value.state.phase).toBe("open");
    expect(value.state.branch).toBe("feat/x");
    expect(readFileSync(value.path, "utf8")).toBe(`${JSON.stringify(STARTED)}\n`);
  });

  it("writes NOTHING when the event fails its schema", () => {
    const dir = runsDir();
    const written = applyRowEvent({
      event: { atIso: AT, kind: "closed", residue: [], summary: "" },
      runsDir: dir,
      slug: "a-row",
    });
    expect(written.isErr()).toBe(true);
    const error = unwrapErr(written);
    expect(error.code).toBe("INVALID_EVENT");
    expect(error.message).toContain("summary");
    // The refusal is only worth anything if the journal was genuinely left alone.
    const journal = applyRowEvent({ event: STARTED, runsDir: dir, slug: "a-row" });
    expect(readFileSync(unwrap(journal).path, "utf8")).toBe(`${JSON.stringify(STARTED)}\n`);
  });

  it("refuses a SECOND terminal on one cycle, naming the ending already recorded", () => {
    const dir = runsDir();
    seed({ dir, events: [STARTED, { atIso: AT, kind: "finished", residue: [] }], slug: "a-row" });
    const written = applyRowEvent({
      event: { atIso: LATER, kind: "abandoned", why: "changed my mind" },
      runsDir: dir,
      slug: "a-row",
    });
    expect(written.isErr()).toBe(true);
    const error = unwrapErr(written);
    expect(error.code).toBe("FORBIDDEN_TRANSITION");
    expect(error.message).toContain('already ended "finished"');
  });

  it("ALLOWS closed after finished — finish closes a run, close records that the work shipped", () => {
    const dir = runsDir();
    seed({ dir, events: [STARTED, { atIso: AT, kind: "finished", residue: [] }], slug: "a-row" });
    const written = applyRowEvent({
      event: { atIso: LATER, kind: "closed", residue: [], summary: "merged as #445" },
      runsDir: dir,
      slug: "a-row",
    });
    expect(written.isOk()).toBe(true);
    expect(unwrap(written).state.phase).toBe("closed");
  });

  it("allows closed on a row that never opened a run at all — the LOOKS SHIPPED case", () => {
    const dir = runsDir();
    const written = applyRowEvent({
      event: { atIso: AT, kind: "closed", residue: [], summary: "shipped elsewhere" },
      runsDir: dir,
      slug: "a-row",
    });
    expect(written.isOk()).toBe(true);
  });

  it("refuses a SECOND closed anywhere in the journal — work cannot ship twice", () => {
    const dir = runsDir();
    seed({ dir, events: [{ atIso: AT, kind: "closed", residue: [], summary: "shipped" }], slug: "a-row" });
    const written = applyRowEvent({
      event: { atIso: LATER, kind: "closed", residue: [], summary: "shipped again" },
      runsDir: dir,
      slug: "a-row",
    });
    expect(written.isErr()).toBe(true);
    expect(unwrapErr(written).code).toBe("FORBIDDEN_TRANSITION");
    expect(unwrapErr(written).message).toContain("already recorded that it shipped");
  });

  it("refuses an answer when no question is open", () => {
    const dir = runsDir();
    seed({ dir, events: [STARTED], slug: "a-row" });
    const written = applyRowEvent({
      event: { answer: "use main", atIso: LATER, kind: "answered" },
      runsDir: dir,
      slug: "a-row",
    });
    expect(written.isErr()).toBe(true);
    expect(unwrapErr(written).message).toContain("nothing this answers");
  });

  it("refuses a reconfirm naming a question that is not the one open", () => {
    const dir = runsDir();
    seed({ dir, events: [STARTED, { atIso: AT, kind: "question", question: "which base?" }], slug: "a-row" });
    const written = applyRowEvent({
      event: { atIso: LATER, kind: "question-reconfirmed", question: "which branch?", stillReal: "checked" },
      runsDir: dir,
      slug: "a-row",
    });
    expect(written.isErr()).toBe(true);
    expect(unwrapErr(written).message).toContain("nothing this re-confirms");
  });

  it("appends a reconfirm of the open question and leaves the run waiting", () => {
    const dir = runsDir();
    seed({ dir, events: [STARTED, { atIso: AT, kind: "question", question: "which base?" }], slug: "a-row" });
    const written = applyRowEvent({
      event: { atIso: LATER, kind: "question-reconfirmed", question: "which base?", stillReal: "still two bases" },
      runsDir: dir,
      slug: "a-row",
    });
    expect(written.isOk()).toBe(true);
    expect(unwrap(written).state.phase).toBe("waiting-on-owner");
  });

  it("refuses a withdrawal naming a question that is not the one open", () => {
    const dir = runsDir();
    seed({ dir, events: [STARTED, { atIso: AT, kind: "question", question: "which base?" }], slug: "a-row" });
    const written = applyRowEvent({
      event: { atIso: LATER, kind: "question-withdrawn", question: "which branch?", why: "resolved" },
      runsDir: dir,
      slug: "a-row",
    });
    expect(written.isErr()).toBe(true);
    expect(unwrapErr(written).message).toContain("nothing this withdraws");
  });

  it("refuses a withdrawal when no question is open", () => {
    const dir = runsDir();
    seed({ dir, events: [STARTED], slug: "a-row" });
    const written = applyRowEvent({
      event: { atIso: LATER, kind: "question-withdrawn", question: "which base?", why: "resolved" },
      runsDir: dir,
      slug: "a-row",
    });
    expect(written.isErr()).toBe(true);
    expect(unwrapErr(written).message).toContain("nothing this withdraws");
  });

  it("appends a withdrawal of the open question and reopens the run with no answer recorded", () => {
    const dir = runsDir();
    seed({ dir, events: [STARTED, { atIso: AT, kind: "question", question: "which base?" }], slug: "a-row" });
    const written = applyRowEvent({
      event: { atIso: LATER, kind: "question-withdrawn", question: "which base?", why: "the doc now names main" },
      runsDir: dir,
      slug: "a-row",
    });
    expect(written.isOk()).toBe(true);
    expect(unwrap(written).state.phase).toBe("open");
    expect(unwrap(written).state.openQuestion).toBe(undefined);
    const kinds = parseLedger({ text: readFileSync(join(dir, "a-row.jsonl"), "utf8") }).events.map((e) => e.kind);
    expect(kinds).toEqual(["started", "question", "question-withdrawn"]);
  });

  it("allows an answer once a question is open", () => {
    const dir = runsDir();
    seed({ dir, events: [STARTED, { atIso: AT, kind: "question", question: "which base?" }], slug: "a-row" });
    const written = applyRowEvent({
      event: { answer: "use main", atIso: LATER, kind: "answered" },
      runsDir: dir,
      slug: "a-row",
    });
    expect(written.isOk()).toBe(true);
    expect(unwrap(written).state.phase).toBe("open");
  });

  it("supersedes an artifact by APPEND, keeping the earlier pointer on the journal", () => {
    const dir = runsDir();
    const first = applyRowEvent({
      event: { atIso: AT, kind: "artifact", url: "https://old.invalid/p" },
      runsDir: dir,
      slug: "a-row",
    });
    expect(first.isOk()).toBe(true);
    const second = applyRowEvent({
      event: { atIso: LATER, kind: "artifact", url: "https://new.invalid/p" },
      runsDir: dir,
      slug: "a-row",
    });
    expect(second.isOk()).toBe(true);
    // Asserted on the DECODED events rather than on the file's raw text: superseding is an append, so the
    // claim is that both events are on the journal in order, which a substring search cannot tell from one
    // url happening to contain the other.
    const events = parseLedger({ text: readFileSync(join(dir, "a-row.jsonl"), "utf8") }).events;
    expect(events.map((event) => (event.kind === "artifact" ? event.url : event.kind))).toEqual([
      "https://old.invalid/p",
      "https://new.invalid/p",
    ]);
  });

  it("reports a journal it cannot read as a typed IO failure rather than an empty register", () => {
    const dir = runsDir();
    const written = applyRowEvent({ event: STARTED, runsDir: dir, slug: "../escape" });
    expect(written.isErr()).toBe(true);
    expect(unwrapErr(written).code).toBe("JOURNAL_IO");
  });

  it("appends onto a journal whose last line has no trailing newline without fusing two events", () => {
    const dir = runsDir();
    writeFileSync(join(dir, "a-row.jsonl"), JSON.stringify(STARTED), "utf8");
    const written = applyRowEvent({
      event: { atIso: LATER, kind: "finished", residue: [] },
      runsDir: dir,
      slug: "a-row",
    });
    expect(written.isOk()).toBe(true);
    expect(unwrap(written).state.entries).toBe(2);
  });
});
