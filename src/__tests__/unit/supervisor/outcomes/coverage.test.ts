/**
 * Setting a board against the owner's kept outcomes: which workstreams are outcomes, what belongs to what, and which
 * finding a reader acts on.
 */
import { describe, expect, it } from "vitest";

import type { BoardRow } from "../../../../handover/rank.js";
import type { PlacedWork } from "../../../../handover/reconcile.js";
import { type CoverageOutcome, coverageOutcomes, outcomeCoverage } from "../../../../supervisor/outcomes/coverage.js";
import type { BoardMembership } from "../../../../workstreams/boardMembership.js";
import type { WorkstreamAggregate, WorkstreamEntry } from "../../../../workstreams/store/types.js";
import { SYNTHETIC_STATED } from "../../../statedCandidatesFixture.js";
import { acmeLinked, acmeLocal, acmeOutcome, OWN_DETAIL } from "../../../workstreamStoreFixtures.js";

import { keptStated, nothingKept } from "./keptStatedFixture.js";

/** One row, with everything the coverage read does not look at defaulted. */
const row = (over: Partial<BoardRow> & { id: string }): BoardRow => ({
  groomed: true,
  kind: "doc",
  label: over.id,
  openedIso: undefined,
  priority: "p2",
  ready: true,
  ruled: false,
  standing: "ready",
  waitingHours: 0,
  ...over,
});

/** One session on one row. */
const placed = ({ session, on, rank = 1 }: { session: string; on: BoardRow; rank?: number }): PlacedWork => ({
  rank,
  row: on,
  session,
});

/** An outcome whose rows are decided by whatever membership the caller names. */
const outcome = ({ id, membership }: { id: string; membership: BoardMembership | null }): CoverageOutcome => ({
  anchor: `transcript:s#${id}`,
  id,
  membership,
  title: id,
  words: `they said ${id}`,
});

/** A subject outcome matching whatever the caller names. */
const subject = ({ id, matchers }: { id: string; matchers: readonly string[] }): CoverageOutcome =>
  outcome({ id, membership: { kind: "subject", matchers: [...matchers] } });

/**
 * One dated entry, the rest of it defaulted.
 *
 * @returns the entry
 */
function entry(over: Partial<WorkstreamEntry> & { date: string; position: number }): WorkstreamEntry {
  return {
    done: false,
    href: null,
    id: `00000000-0000-4000-8000-${String(over.position).padStart(12, "0")}`,
    kind: "raised",
    milestoneId: null,
    text: "raised",
    ...over,
  };
}

/** An outcome anchored on a link, a standing one on a later link, and an outcome whose entries cite nothing. */
function fixtureWorkstreams(): readonly WorkstreamAggregate[] {
  return [
    acmeOutcome({
      entries: [
        entry({ date: "2026-09-02", href: "https://example.test/later", position: 0 }),
        entry({ date: "2026-09-01", href: "https://example.test/merge-gate", position: 1 }),
      ],
      id: "merge-gate",
      milestones: [{ after: [], anchor: "talk:fixture#1", id: "done", name: "Nothing merges red", position: 0 }],
      name: "Merge gate",
      outcome: "Nothing merges red",
    }),
    acmeOutcome({
      entries: [entry({ date: "2026-09-03", href: "/queue?row=x", position: 0 })],
      id: "deps",
      kind: "standing",
      milestones: [{ after: [], anchor: "talk:fixture#2", id: "done", name: "Current", position: 0 }],
      name: "Dependencies",
      outcome: "Dependencies stay current",
    }),
    acmeOutcome({
      entries: [entry({ date: "2026-09-04", position: 0, text: "raised in a call" })],
      id: "logs-scrub",
      milestones: [{ after: [], anchor: "talk:fixture#3", id: "done", name: "Scrubbed", position: 0 }],
      name: "Logs scrub",
      outcome: "No secret reaches a log",
    }),
    acmeLinked({ id: "iso-controls" }),
    acmeLocal({ id: "scratch" }),
  ];
}

describe("coverageOutcomes", () => {
  it("reads active outcome and standing workstreams, anchored on their earliest cited entry", () => {
    const projection = coverageOutcomes({ workstreams: fixtureWorkstreams() });

    expect(projection.outcomes).toEqual([
      {
        anchor: "https://example.test/merge-gate",
        id: "merge-gate",
        membership: null,
        title: "Merge gate",
        words: "Nothing merges red",
      },
      {
        anchor: "/queue?row=x",
        id: "deps",
        membership: null,
        title: "Dependencies",
        words: "Dependencies stay current",
      },
    ]);
    expect(projection.unanchored).toEqual(["logs-scrub"]);
  });

  it("takes a bracketed anchor closing an entry's text when no entry carries a link", () => {
    const workstreams = fixtureWorkstreams().map((one) =>
      one.id === "logs-scrub"
        ? { ...one, entries: [entry({ date: "2026-07-01", position: 0, text: "raised [talk-call:x#y]" })] }
        : one,
    );
    const projection = coverageOutcomes({ workstreams });

    expect(projection.outcomes.find((one) => one.id === "logs-scrub")!.anchor).toBe("talk-call:x#y");
    expect(projection.unanchored).toEqual([]);
  });

  it("supervises a linked workstream only once it names its rows, and drops one once it has ended", () => {
    const membership = { kind: "subject", matchers: ["iso"] } as const;
    const ending = { anchor: "talk-call:x#z", kind: "abandoned", on: "2026-10-01", reason: "we dropped it" };
    const workstreams = fixtureWorkstreams().map((one) => {
      if (one.id === "deps") {
        return { ...one, detail: { ...OWN_DETAIL, ending } };
      }
      if (one.id === "iso-controls") {
        return { ...one, detail: { ...one.detail, boardMembership: membership } };
      }
      return one;
    });
    const projection = coverageOutcomes({ workstreams });

    expect(projection.outcomes.map((one) => [one.id, one.membership])).toEqual([
      ["merge-gate", null],
      ["iso-controls", membership],
    ]);
  });

  it("reads a kept stated outcome back in the owner's own words, its anchor the turn they said it in and its rows theirs", () => {
    const kept = SYNTHETIC_STATED.find((one) => one.id === "acme-bot-dogfooded")!;
    const projection = coverageOutcomes({ workstreams: keptStated({ ids: [kept.id] }) });

    expect(projection.outcomes.map((one) => [one.title, one.words, one.membership])).toEqual([
      [kept.name, kept.outcome, kept.boardMembership],
    ]);
    expect(projection.outcomes[0]!.anchor).toBe(kept.evidence[0]!.anchor);
    expect(projection.unanchored).toEqual([]);
  });

  it("projects nothing off a register holding no outcome", () => {
    expect(coverageOutcomes({ workstreams: nothingKept() })).toEqual({ outcomes: [], unanchored: [] });
  });
});

describe("outcomeCoverage", () => {
  it("matches a subject in a slug and in a summary, through the hyphens and the punctuation alike", () => {
    const slug = row({ id: "notion-new-pages-ingested", label: "whatever" });
    const summary = row({ id: "x", label: "Read the Notion, then stop." });

    const report = outcomeCoverage({
      botHandles: [],
      outcomes: [subject({ id: "notion", matchers: ["notion"] })],
      placed: [],
      ranked: [slug, summary],
    });

    expect(report.outcomes[0]!.rows).toBe(2);
    expect(report.outcomes[0]!.unspawned.map((one) => one.id)).toEqual(["notion-new-pages-ingested", "x"]);
  });

  it("does not match a subject that only occurs INSIDE a word", () => {
    const report = outcomeCoverage({
      botHandles: [],
      outcomes: [subject({ id: "iso", matchers: ["iso"] })],
      placed: [],
      ranked: [row({ id: "a", label: "a decision about revision and precision" })],
    });

    expect(report.outcomes[0]!.rows).toBe(0);
    expect(report.uncovered).toEqual([]);
  });

  it("places a row naming the bot under the kept dogfood outcome, and leaves a row about some other bot alone", () => {
    const dogfood = coverageOutcomes({ workstreams: keptStated({ ids: ["acme-bot-dogfooded"] }) }).outcomes;
    const ours = row({ id: "the-bot-answers-in-its-dm", label: "whatever" });
    const vendor = row({ id: "retire-third-party-build-bot", label: "Remove the obsolete vendor bot from CI" });

    const report = outcomeCoverage({ botHandles: [], outcomes: dogfood, placed: [], ranked: [ours, vendor] });

    expect(dogfood.length).toBe(1);
    expect(report.outcomes[0]!.unspawned.map((one) => one.id)).toEqual(["the-bot-answers-in-its-dm"]);
  });

  it("places a row naming the bot by a handle the install declares, and only under the outcome that names the bot", () => {
    const dogfood = coverageOutcomes({ workstreams: keptStated({ ids: ["acme-bot-dogfooded"] }) }).outcomes;
    const byHandle = row({ id: "acme-bot-answer", label: "whatever" });
    const other = subject({ id: "notion", matchers: ["notion"] });

    const declared = outcomeCoverage({
      botHandles: ["Acme-Bot"],
      outcomes: [...dogfood, other],
      placed: [],
      ranked: [byHandle],
    });
    const undeclared = outcomeCoverage({ botHandles: [], outcomes: dogfood, placed: [], ranked: [byHandle] });

    expect(dogfood.length).toBe(1);
    expect(declared.outcomes[0]!.unspawned.map((one) => one.id)).toEqual(["acme-bot-answer"]);
    expect(declared.outcomes[1]!.rows).toBe(0);
    expect(undeclared.outcomes[0]!.rows).toBe(0);
  });

  it("calls an outcome covered the moment one live session is on a row under it", () => {
    const worked = row({ id: "supabase-reset", ready: false });
    const waiting = row({ id: "supabase-types" });

    const report = outcomeCoverage({
      botHandles: [],
      outcomes: [subject({ id: "supabase", matchers: ["supabase"] })],
      placed: [placed({ on: worked, session: "workspace:1" })],
      ranked: [worked, waiting],
    });

    expect(report.outcomes[0]!.live.map((item) => item.session)).toEqual(["workspace:1"]);
    expect(report.outcomes[0]!.unspawned.map((one) => one.id)).toEqual(["supabase-types"]);
    expect(report.uncovered).toEqual([]);
  });

  it("reports an outcome with ready rows and nobody on it as uncovered, and one with no rows at all as neither", () => {
    const report = outcomeCoverage({
      botHandles: [],
      outcomes: [subject({ id: "gcp", matchers: ["gcp"] }), subject({ id: "absent", matchers: ["nothing here"] })],
      placed: [],
      ranked: [row({ id: "gcp-backup-bucket" })],
    });

    expect(report.uncovered).toEqual(["gcp"]);
    expect(report.outcomes[1]!.rows).toBe(0);
    expect(report.outcomes[1]!.unspawned).toEqual([]);
  });

  it("lists an outcome that names no rows with none under it, never guessing rows from its name", () => {
    const report = outcomeCoverage({
      botHandles: [],
      outcomes: [outcome({ id: "gcp", membership: null })],
      placed: [],
      ranked: [row({ id: "gcp-backup-bucket" })],
    });

    expect([report.outcomes[0]!.rows, report.uncovered]).toEqual([0, []]);
  });

  it("leaves an unready row out of `unspawned`, because nobody can pick up work already in flight", () => {
    const report = outcomeCoverage({
      botHandles: [],
      outcomes: [subject({ id: "gcp", matchers: ["gcp"] })],
      placed: [],
      ranked: [row({ id: "gcp-in-flight", ready: false })],
    });

    expect(report.outcomes[0]!.rows).toBe(1);
    expect(report.outcomes[0]!.unspawned).toEqual([]);
    expect(report.uncovered).toEqual([]);
  });

  it("takes a rank-band outcome from the whole ranked board, so a session on an in-flight top row still covers it", () => {
    const top = row({ id: "top", ready: false });
    const second = row({ id: "second" });
    const band = outcome({ id: "band", membership: { band: 2, kind: "rank-band" } });

    const report = outcomeCoverage({
      botHandles: [],
      outcomes: [band],
      placed: [placed({ on: top, session: "workspace:9" })],
      ranked: [top, second, row({ id: "third" })],
    });

    expect(report.outcomes[0]!.rows).toBe(2);
    expect(report.outcomes[0]!.live.map((item) => item.session)).toEqual(["workspace:9"]);
    expect(report.outcomes[0]!.unspawned.map((one) => one.id)).toEqual(["second"]);
  });

  it("carries the workstream's own anchor, title and words through, so a reader never has to go and look them up", () => {
    const outcomes = coverageOutcomes({ workstreams: fixtureWorkstreams() }).outcomes;
    const report = outcomeCoverage({ botHandles: [], outcomes, placed: [], ranked: [] });

    expect(report.outcomes.map((one) => [one.id, one.anchor, one.title, one.words])).toEqual(
      outcomes.map((one) => [one.id, one.anchor, one.title, one.words]),
    );
    expect(report.outcomes.length).toBe(2);
  });
});
