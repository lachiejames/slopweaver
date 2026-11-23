/**
 * `handover wake` on a park whose OWN pull request merged while the run waits on the owner's open question: its wake
 * is suspended, no seat boots and no finish is asked — over every such park, past the finish pass's cap — and the
 * suspension lifts on the next line that touches what the run waits on, so the next run reseats.
 * MEASURED: a merged park with its question open was reseated, booted, and closed again.
 */
import { chmodSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";

import { WAKE_FINISH_ASKS } from "../../../../../../cli/commands/handover/wakeFinish.js";
import {
  QUESTION_READ_CONCURRENCY,
  WAKE_QUESTION_DEADLINE_MS,
} from "../../../../../../cli/commands/handover/wakeQuestionPass.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import type { RunEvent } from "../../../../../../handover/ledger.js";
import { activeParkedCheckpoint } from "../../../../../../handover/parked.js";
import type { ParkedDraft } from "../../../../../../handover/parkedEvent.js";
import { appendRunEvent, readRunJournal, runJournalPath } from "../../../../../../handover/runStore.js";
import { claimWakePark } from "../../../../../../handover/wakeJournalStore.js";
import { removeFixtureDirs } from "../../turn/dispatch/harness.js";
import { green, record } from "./fixtures.js";
import { fakes, mintWakeHome, parkedRow, stillParked, wakeJson } from "./harness.js";

const QUESTION = "Keep the backup key wrapped by the master password?";
const ASKED_ISO = "2026-10-15T01:30:00.000Z";
const MERGED = { 7: { prState: "MERGED" } } as const;
/** The run's own branch is its slug (`parkedRow` records it at `start` and on the park). */
const OWN_HEAD = { 7: "asked" } as const;
const WHY = "o/r#7 (asked) merged while the run waits on the owner's question, so a reseat could only close again";

describe("runHandoverWake on a merged pull request's park waiting on the owner's open question", () => {
  let home: string;
  let runsDir: string;

  beforeEach(() => {
    ({ home, runsDir } = mintWakeHome());
  });

  afterEach(() => {
    removeFixtureDirs();
  });

  /** Append journal lines to one row. */
  function append({ events, slug }: { events: readonly RunEvent[]; slug: string }): void {
    for (const event of events) {
      unwrap(appendRunEvent({ event, runsDir, slug }));
    }
  }

  /** A row parked on PR `number` whose run then asked {@link QUESTION}, as a chair records one on a closed seat. */
  function askedAndParked({
    drafts,
    number = 7,
    slug,
  }: {
    drafts?: readonly ParkedDraft[];
    number?: number;
    slug: string;
  }): void {
    parkedRow({
      ...(drafts === undefined ? {} : { drafts }),
      question: QUESTION,
      slug,
      wake: { kind: "checks", number, repo: "o/r" },
    });
    append({ events: [{ atIso: ASKED_ISO, kind: "question", question: QUESTION }], slug });
  }

  /** Every `park-wake-suspended` line the row's journal holds. */
  function suspensions({ slug }: { slug: string }): readonly RunEvent[] {
    return unwrap(readRunJournal({ runsDir, slug })).events.filter((event) => event.kind === "park-wake-suspended");
  }

  it("suspends the wake of a merged own-branch park, booting nothing, asking no finish, and keeping the park", async () => {
    askedAndParked({ slug: "asked" });
    const recorded = record();
    const deps = fakes({ checks: MERGED, finishes: { asked: 0 }, heads: OWN_HEAD, recorded });
    const { code, report } = await wakeJson({ deps, recorded });
    const [row] = report.rows;
    expect([code, recorded.spawned, recorded.finished, recorded.headReads]).toEqual([EXIT_OK, [], [], ["o/r#7"]]);
    expect([report.suspended, report.attempted, report.cleared, row!.action]).toEqual([1, 0, 0, "wake-suspended"]);
    expect(row!.detail).toBe(`wake suspended until the owner's question is answered: ${WHY}`);
    expect(suspensions({ slug: "asked" })).toEqual([
      {
        atIso: "2026-10-15T03:13:00.000Z",
        judgedLength: 4,
        kind: "park-wake-suspended",
        parkIndex: 2,
        question: QUESTION,
        questionAskedIso: ASKED_ISO,
        why: WHY,
      },
    ]);
    expect(stillParked({ slug: "asked" })).toBe(true);
  });

  it("never judges the park again while the question stands", async () => {
    askedAndParked({ slug: "asked" });
    const first = record();
    await wakeJson({ deps: fakes({ checks: MERGED, heads: OWN_HEAD, recorded: first }), recorded: first });
    const second = record();
    const { code, report } = await wakeJson({
      deps: fakes({ checks: MERGED, heads: OWN_HEAD, recorded: second }),
      recorded: second,
    });
    expect([code, report.rows.length, second.spawned, second.headReads]).toEqual([EXIT_EXPECTED_EMPTY, 0, [], []]);
  });

  it("says would-suspend on a dry run and writes nothing", async () => {
    askedAndParked({ slug: "asked" });
    const recorded = record();
    const deps = fakes({ checks: MERGED, heads: OWN_HEAD, recorded });
    const { code, report } = await wakeJson({ deps, extra: ["--dry-run"], recorded });
    expect([code, report.suspended, report.rows[0]!.action, recorded.finished]).toEqual([
      EXIT_OK,
      1,
      "would-suspend",
      [],
    ]);
    expect(suspensions({ slug: "asked" })).toEqual([]);
  });

  // A closed pull request can reopen, and a suspended wake is never read again until the owner answers.
  it("never suspends a park whose pull request closed unmerged", async () => {
    askedAndParked({ slug: "asked" });
    const recorded = record();
    const deps = fakes({ checks: { 7: { prState: "CLOSED" } }, heads: OWN_HEAD, recorded });
    const { report } = await wakeJson({ deps, recorded });
    expect([report.suspended, recorded.spawned]).toEqual([0, ["asked"]]);
  });

  // The proof the merged pull request is the run's own whole work: `questionOwnership.test.ts`.
  it("reseats a park whose head did not read, since nothing then proves the question is all that is left", async () => {
    askedAndParked({ slug: "asked" });
    const recorded = record();
    const { report } = await wakeJson({ deps: fakes({ checks: MERGED, recorded }), recorded });
    expect([report.suspended, recorded.spawned]).toEqual([0, ["asked"]]);
  });

  // A held Slack draft is the chair's to send once the owner says yes, never the seat's.
  it("suspends a park holding a Slack draft, since the chair sends it and never the seat", async () => {
    askedAndParked({ drafts: [{ id: "sd-11111111", kind: "slack-draft", text: "hi" }], slug: "asked" });
    const recorded = record();
    const { report } = await wakeJson({ deps: fakes({ checks: MERGED, heads: OWN_HEAD, recorded }), recorded });
    expect([report.suspended, recorded.spawned]).toEqual([1, []]);
  });

  it("suspends a park whose only draft is the question's own drafted message", async () => {
    askedAndParked({ drafts: [{ kind: "ask-action", text: "Posting the wrap." }], slug: "asked" });
    const recorded = record();
    const { report } = await wakeJson({ deps: fakes({ checks: MERGED, heads: OWN_HEAD, recorded }), recorded });
    expect([report.suspended, recorded.spawned]).toEqual([1, []]);
  });

  // A cap of `WAKE_FINISH_ASKS` let the seventh question park through to a boot. Past the read
  // batch too, so a second batch of head reads is what suspends the last of them.
  const many = Math.max(WAKE_FINISH_ASKS, QUESTION_READ_CONCURRENCY) + 2;
  it(`suspends every merged question park past the finish cap of ${String(WAKE_FINISH_ASKS)}`, async () => {
    const slugs = Array.from({ length: many }, (_, index) => `q${String(index)}`);
    const checks: Record<number, { prState: "MERGED" }> = {};
    const heads: Record<number, string> = {};
    slugs.forEach((slug, index) => {
      askedAndParked({ number: index + 1, slug });
      checks[index + 1] = { prState: "MERGED" };
      heads[index + 1] = slug;
    });
    const recorded = record();
    const { code, report } = await wakeJson({ deps: fakes({ checks, heads, recorded }), recorded });
    expect([code, report.suspended, recorded.spawned, recorded.finished]).toEqual([EXIT_OK, many, [], []]);
  });

  // A fixed outer timeout must never kill the pass before it writes. No batch starts past the
  // window, and the batch read before it is already on the journal.
  it("writes each batch before the next, and starts none once the question window closes", async () => {
    const slugs = Array.from({ length: QUESTION_READ_CONCURRENCY + 2 }, (_, index) => `q${String(index)}`);
    const checks: Record<number, { prState: "MERGED" }> = {};
    const heads: Record<number, string> = {};
    slugs.forEach((slug, index) => {
      askedAndParked({ number: index + 1, slug });
      checks[index + 1] = { prState: "MERGED" };
      heads[index + 1] = slug;
    });
    const recorded = record();
    const base = fakes({ checks, heads, recorded });
    const past = () => recorded.headReads.length >= QUESTION_READ_CONCURRENCY;
    const deps = {
      ...base,
      now: () => new Date(base.now().getTime() + (past() ? WAKE_QUESTION_DEADLINE_MS : 0)),
    };
    const { report } = await wakeJson({ deps, recorded });
    const written = slugs.filter((slug) => suspensions({ slug }).length === 1);
    expect([report.suspended, written]).toEqual([QUESTION_READ_CONCURRENCY, slugs.slice(0, QUESTION_READ_CONCURRENCY)]);
    expect(recorded.diagnostics.filter((line) => line.includes("window closed with 2 merged park(s)")).length).toBe(1);
  });

  // The window covers the journal reads too, so a slow preparation cannot push it past the budget.
  // And the batch already prepared still settles, so a slow prefix makes progress every tick.
  it("reads no journal once the question window closes, and settles the batch it had prepared", async () => {
    askedAndParked({ number: 1, slug: "q0" });
    askedAndParked({ number: 2, slug: "q1" });
    const recorded = record();
    const base = fakes({
      checks: { 1: { prState: "MERGED" }, 2: { prState: "MERGED" } },
      heads: { 1: "q0", 2: "q1" },
      recorded,
    });
    // Clock reads, in order: the run's instant, the judging window's start, one per judged park, the question window's
    // start, then one before each journal read. From the second journal read on, the window has closed: the first
    // journal read outlasted it.
    let reads = 0;
    const deps = {
      ...base,
      now: () => {
        reads += 1;
        return new Date(base.now().getTime() + (reads >= 7 ? WAKE_QUESTION_DEADLINE_MS : 0));
      },
    };
    const { report } = await wakeJson({ deps, recorded });
    // q0's journal was read inside the window, so its batch settles; q1's never is, and it reseats as on main.
    expect([
      report.suspended,
      recorded.spawned,
      suspensions({ slug: "q0" }).length,
      suspensions({ slug: "q1" }),
    ]).toEqual([1, ["q1"], 1, []]);
    expect(recorded.diagnostics.filter((line) => line.includes("window closed with 1 merged park(s)")).length).toBe(1);
  });

  // Every journal and origin read once ran before any head read, so a slow enough prefix spent the
  // whole window and suspended nothing, tick after tick. Pipelined, each tick settles what it prepared.
  it("suspends a slow prefix's first batch on one tick and the rest on the next", async () => {
    const slugs = Array.from({ length: QUESTION_READ_CONCURRENCY + 2 }, (_, index) => `q${String(index)}`);
    const checks: Record<number, { prState: "MERGED" }> = {};
    const heads: Record<number, string> = {};
    slugs.forEach((slug, index) => {
      askedAndParked({ number: index + 1, slug });
      checks[index + 1] = { prState: "MERGED" };
      heads[index + 1] = slug;
    });
    const recorded = record();
    // The unjudged rows' reseats journal nothing, so their parks still stand for the next tick.
    const base = fakes({ checks, heads, journals: [], recorded });
    let origins = 0;
    // Each origin read is slow: by the sixth, the window has closed.
    const slow = {
      ...base,
      now: () =>
        new Date(base.now().getTime() + (origins >= QUESTION_READ_CONCURRENCY ? WAKE_QUESTION_DEADLINE_MS : 0)),
      readOrigin: (args: Parameters<typeof base.readOrigin>[0]) => {
        origins += 1;
        return base.readOrigin(args);
      },
    };
    const first = await wakeJson({ deps: slow, recorded });
    const second = record();
    const next = await wakeJson({ deps: fakes({ checks, heads, recorded: second }), recorded: second });
    expect([first.report.suspended, next.report.suspended]).toEqual([QUESTION_READ_CONCURRENCY, 2]);
    expect(slugs.filter((slug) => suspensions({ slug }).length === 1)).toEqual(slugs);
  });

  // The park's own `question` field outlives the owner's answer; the run's CURRENT question decides.
  it("reseats a park whose question was answered after it parked, though the park still carries it", async () => {
    askedAndParked({ slug: "asked" });
    append({ events: [{ answer: "yes", atIso: "2026-10-15T02:30:00.000Z", kind: "answered" }], slug: "asked" });
    const recorded = record();
    const { report } = await wakeJson({ deps: fakes({ checks: MERGED, heads: OWN_HEAD, recorded }), recorded });
    expect([report.suspended, recorded.spawned]).toEqual([0, ["asked"]]);
    expect(suspensions({ slug: "asked" })).toEqual([]);
  });

  it("reseats a park whose question was withdrawn", async () => {
    askedAndParked({ slug: "asked" });
    const withdrawn: RunEvent = {
      atIso: "2026-10-15T02:30:00.000Z",
      kind: "question-withdrawn",
      question: QUESTION,
      why: "moot",
    };
    append({ events: [withdrawn], slug: "asked" });
    const recorded = record();
    const { report } = await wakeJson({ deps: fakes({ checks: MERGED, heads: OWN_HEAD, recorded }), recorded });
    expect([report.suspended, recorded.spawned]).toEqual([0, ["asked"]]);
  });

  it("lifts the suspension once the owner answers, so the next run finishes or reseats the seat", async () => {
    askedAndParked({ slug: "asked" });
    const first = record();
    await wakeJson({ deps: fakes({ checks: MERGED, heads: OWN_HEAD, recorded: first }), recorded: first });
    append({ events: [{ answer: "yes", atIso: "2026-10-15T03:13:30.000Z", kind: "answered" }], slug: "asked" });
    const second = record();
    const { report } = await wakeJson({
      deps: fakes({ checks: MERGED, heads: OWN_HEAD, recorded: second }),
      recorded: second,
    });
    expect([report.rows[0]!.judgement.kind, second.finished, second.spawned]).toEqual(["due", ["asked"], ["asked"]]);
  });

  it("lifts the suspension on a message queued for the seat, which only a seat delivers", async () => {
    askedAndParked({ slug: "asked" });
    const first = record();
    await wakeJson({ deps: fakes({ checks: MERGED, heads: OWN_HEAD, recorded: first }), recorded: first });
    append({ events: [{ atIso: "2026-10-15T03:13:30.000Z", kind: "said", message: "also rebase" }], slug: "asked" });
    const second = record();
    const { report } = await wakeJson({
      deps: fakes({ checks: MERGED, heads: OWN_HEAD, recorded: second }),
      recorded: second,
    });
    // The question still stands, but the message is work only a reseat delivers, so the seat boots.
    expect([report.suspended, second.spawned, suspensions({ slug: "asked" }).length]).toEqual([0, ["asked"], 1]);
  });

  it("never suspends a park the owner has ruled on since it parked, though the question still stands", async () => {
    askedAndParked({ slug: "asked" });
    const ruling: RunEvent = {
      anchor: "talk:abc",
      atIso: "2026-10-15T02:40:00.000Z",
      kind: "ruling",
      ruling: "go with the wrapped key",
    };
    append({ events: [ruling], slug: "asked" });
    const recorded = record();
    const { report } = await wakeJson({ deps: fakes({ checks: MERGED, heads: OWN_HEAD, recorded }), recorded });
    expect([report.suspended, recorded.spawned, recorded.headReads]).toEqual([0, ["asked"], ["o/r#7"]]);
  });

  // A line landing during the head read was masked by the suspension appended after it.
  it("never suspends when a lifting line lands while the head is being read", async () => {
    askedAndParked({ slug: "asked" });
    const recorded = record();
    const base = fakes({ checks: MERGED, heads: OWN_HEAD, recorded });
    const reconfirmed: RunEvent = {
      atIso: "2026-10-15T03:12:30.000Z",
      kind: "question-reconfirmed",
      question: QUESTION,
      stillReal: "the key is still unwrapped",
    };
    const deps = {
      ...base,
      readPrHead: (args: Parameters<typeof base.readPrHead>[0]) => {
        append({ events: [reconfirmed], slug: "asked" });
        return base.readPrHead(args);
      },
    };
    const { report } = await wakeJson({ deps, recorded });
    expect([report.suspended, recorded.spawned, suspensions({ slug: "asked" })]).toEqual([0, ["asked"], []]);
    expect(recorded.diagnostics.filter((line) => line.includes("landed while the wake judged")).length).toBe(1);
  });

  // Text plus asked instant can match again after A -> B -> A; the suspension is bound by position.
  it("never re-arms an old suspension when a corrected question is corrected back", async () => {
    askedAndParked({ slug: "asked" });
    const first = record();
    await wakeJson({ deps: fakes({ checks: MERGED, heads: OWN_HEAD, recorded: first }), recorded: first });
    const corrections: readonly RunEvent[] = [
      { atIso: "2026-10-15T03:13:20.000Z", kind: "question-corrected", question: "Wrap it?", why: "w" },
      { atIso: "2026-10-15T03:13:40.000Z", kind: "question-corrected", question: QUESTION, why: "back" },
    ];
    append({ events: corrections, slug: "asked" });
    const second = record();
    const { report } = await wakeJson({
      deps: fakes({ checks: MERGED, heads: OWN_HEAD, recorded: second }),
      recorded: second,
    });
    // Judged again (one head read on this run), and suspended afresh on the park as it stands now.
    expect([report.rows[0]!.action, second.headReads, suspensions({ slug: "asked" }).length]).toEqual([
      "wake-suspended",
      ["o/r#7"],
      2,
    ]);
  });

  it("never suspends an OPEN pull request's park: finished CI is still work the seat owns", async () => {
    askedAndParked({ slug: "asked" });
    const recorded = record();
    const { report } = await wakeJson({ deps: fakes({ checks: { 7: green() }, recorded }), recorded });
    expect([report.suspended, recorded.spawned]).toEqual([0, ["asked"]]);
  });

  // Two wakes at once. This one's append answers with an error after the other's suspension
  // landed; the read-back finds a suspension of that park standing, so the row leaves the due set and never reseats.
  it("counts a park a second wake suspended as suspended when this run's own append fails", async () => {
    askedAndParked({ slug: "asked" });
    const recorded = record();
    const base = fakes({ checks: MERGED, heads: OWN_HEAD, recorded });
    const theirs: RunEvent = {
      atIso: "2026-10-15T03:12:59.000Z",
      judgedLength: 4,
      kind: "park-wake-suspended",
      parkIndex: 2,
      question: QUESTION,
      questionAskedIso: ASKED_ISO,
      why: WHY,
    };
    const deps = {
      ...base,
      readPrHead: (args: Parameters<typeof base.readPrHead>[0]) => {
        append({ events: [theirs], slug: "asked" });
        chmodSync(journal, 0o444);
        return base.readPrHead(args);
      },
    };
    const journal = runJournalPath({ runsDir, slug: "asked" });
    const { report } = await wakeJson({ deps, recorded });
    chmodSync(journal, 0o644);
    expect([report.suspended, recorded.spawned, recorded.finished]).toEqual([1, [], []]);
    // Only theirs: this run's own append failed, and the read-back found the other wake's standing.
    expect(suspensions({ slug: "asked" })).toEqual([theirs]);
  });

  // A reseat holds the park's claim from its last park read through `cmux spawn`, so a suspension
  // appended while another wake holds it could land after that read and the seat boot anyway.
  it("writes no suspension while another wake holds the park's claim, leaving the row to that reseat", async () => {
    askedAndParked({ slug: "asked" });
    const parkedAtIso = activeParkedCheckpoint({
      events: unwrap(readRunJournal({ runsDir, slug: "asked" })).events,
    })!.atIso;
    const held = unwrap(
      claimWakePark({ home, nowIso: "2026-10-15T03:12:00.000Z", parkIndex: 2, parkedAtIso, slug: "asked" }),
    );
    const recorded = record();
    const { report } = await wakeJson({ deps: fakes({ checks: MERGED, heads: OWN_HEAD, recorded }), recorded });
    expect(held.kind).toBe("claimed");
    if (held.kind === "claimed") {
      held.release();
    }
    expect([report.suspended, report.rows[0]!.action, recorded.spawned]).toEqual([0, "reseat-in-flight", []]);
    expect(suspensions({ slug: "asked" })).toEqual([]);
    expect(recorded.diagnostics.filter((line) => line.includes("another wake is reseating it now")).length).toBe(1);
  });

  // A row is settled only when the line was written; a failed write keeps it due.
  it("keeps the row due, and says so, when the suspension does not write", async () => {
    askedAndParked({ slug: "asked" });
    const journal = runJournalPath({ runsDir, slug: "asked" });
    chmodSync(journal, 0o444);
    const recorded = record();
    const deps = fakes({ checks: MERGED, heads: OWN_HEAD, journals: [], recorded });
    const { code, report } = await wakeJson({ deps, recorded });
    chmodSync(journal, 0o644);
    expect([code, report.suspended, recorded.spawned]).toEqual([EXIT_ERROR, 0, ["asked"]]);
    expect(recorded.diagnostics.filter((line) => line.includes("was not suspended")).length).toBe(1);
  });
});
