/*
 * The standing ask a Queue card quotes when no particular steer of the owner's is behind it. Every card quotes the owner's own words — the steer that led to it, or the
 * standing ask it rests on, saying no other particular steer is behind it. Driven from `profile standing --json`'s
 * wire through the real reader and `rowsOf`, so every row is one the page would actually hold.
 */

import { describe, expect, it } from "vitest";

import { type Board, readBoard } from "../../components/live/read";
import { readAutonomy } from "../../components/live/readAutonomy";
import { readStandingAsks, type StandingAskReading } from "../../components/live/readStandingAsks";
import type { LiveState } from "../../components/live/useLive";
import { carriesMachineId } from "../../lib/machineIds";
import { type QueueRow, rowsOf } from "../../lib/queueRows";
import { sourceBlockCopy } from "../../lib/sourceBlock";
import { standingAskSource } from "../../lib/standingAskSource";
import { ACME_PLACER } from "../organisationFixture";

const LOADING = { phase: "loading" } as const;
const ORG_INTEL = {
  anchor: "talk:a0000062-0000-4000-8000-000000000068",
  atIso: "2026-10-04T00:55:00.000Z",
  cut: "none",
  where: "console-voice",
  words: "if you ever find something that's worth a look, chuck it on the board and investigate it",
} as const;
const AUTO_MERGE = {
  anchor: "transcript:a0000036-0000-4000-8000-000000000039#a838760b-0a3d-4e11-8e8e-f8806501bf81",
  atIso: "2026-09-21T03:00:00.000Z",
  cut: "none",
  where: "session",
  words: "i asked for us to auto-merge all of our dependency bump PRs, as well as pretty much any slopweaver PR",
} as const;
const FINDING_LINE = "it came from a fleet finding a session observed.";

function ready<T>({ value }: { value: T }): LiveState<T> {
  return {
    fixture: undefined,
    observedAtIso: "2026-10-09T12:00:00.000Z",
    phase: "ready",
    stampedByRoute: false,
    value,
  };
}

/** One ask as `profile standing --json` publishes it. */
function wireAsk({ id, covers, quote }: { id: string; covers: readonly string[]; quote: object }): object {
  return { covers, id, quote, recordedAtIso: "2026-10-09T12:00:00.000Z" };
}

/** The register as read off the wire. */
function standingOf({ active }: { active: readonly object[] }): LiveState<StandingAskReading> {
  return ready({ value: readStandingAsks({ active, kind: "read" })! });
}

/** One board row waiting on the owner, with the fields a test sets. */
function ask({ slug = "the-row", ...fields }: { slug?: string } & Record<string, unknown>): Record<string, unknown> {
  return {
    kind: "ask",
    ownerWait: "owner",
    question: "Worth a look?",
    questionAskedIso: "2026-10-09T11:00:00.000Z",
    reason: "waiting on the owner",
    section: "runnable",
    slug,
    status: "waiting-on-owner",
    ...fields,
  };
}

function boardOf({ rows }: { rows: readonly unknown[] }): Board {
  return readBoard({ rows, unresolved: 0 })!;
}

/** The one row a board row and a standing reading build. */
function rowOf({
  fields,
  standing,
}: {
  fields: Record<string, unknown>;
  standing: LiveState<StandingAskReading>;
}): QueueRow {
  const rows = rowsOf({
    acts: LOADING,
    board: ready({ value: boardOf({ rows: [ask(fields)] }) }),
    drafts: LOADING,
    hands: LOADING,
    landing: LOADING,
    placer: ACME_PLACER,
    posts: LOADING,
    reviewers: LOADING,
    reviews: LOADING,
    imports: LOADING,
    standing,
  });
  expect(rows.length).toBe(1);
  return rows[0];
}

const FINDING = { observedBy: "a787443c", origin: "finding" };

describe("readStandingAsks", () => {
  it("reads the active asks, the owner's words as the register holds them", () => {
    const reading = readStandingAsks({
      active: [wireAsk({ covers: ["findings"], id: "org-intel", quote: ORG_INTEL })],
      kind: "read",
    });
    expect(reading).toEqual({
      active: [{ covers: ["findings"], id: "org-intel", quote: ORG_INTEL }],
      kind: "read",
    });
  });

  it("reads the verb's defect as a reading of its own", () => {
    expect(readStandingAsks({ kind: "defect", why: "standing-ask journal line 2 does not read: not JSON" })).toEqual({
      kind: "defect",
      why: "standing-ask journal line 2 does not read: not JSON",
    });
  });

  it("refuses the whole reading over one ask that will not read, or two over one coverage", () => {
    const bad = [
      { active: [wireAsk({ covers: ["findings"], id: "a", quote: { ...ORG_INTEL, where: "somewhere" } })] },
      { active: [wireAsk({ covers: [], id: "a", quote: ORG_INTEL })] },
      {
        active: [
          wireAsk({ covers: ["findings"], id: "a", quote: ORG_INTEL }),
          wireAsk({ covers: ["bot-replies", "findings"], id: "b", quote: ORG_INTEL }),
        ],
      },
      { active: "none" },
    ];
    expect(bad.map((one) => readStandingAsks({ ...one, kind: "read" }))).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });
});

describe("a card no particular steer of the owner's is behind", () => {
  it("quotes the standing ask covering it, and says no other particular steer is behind it", () => {
    const row = rowOf({
      fields: FINDING,
      standing: standingOf({ active: [wireAsk({ covers: ["findings"], id: "org-intel", quote: ORG_INTEL })] }),
    });
    expect(row.source).toEqual({
      askId: "org-intel",
      immediate: { hover: "session a787443c", kind: "none", origin: "a fleet finding a session observed" },
      kind: "standing",
      quote: ORG_INTEL,
      steers: [],
      subject: "Worth a look? the row",
    });
    expect(row.record.form).toEqual({ kind: "drawn" });
    const copy = sourceBlockCopy({ source: row.source });
    expect([copy.label, copy.tone, copy.words, copy.line, copy.hover]).toEqual([
      "your standing ask",
      "owner",
      { cut: "none", text: ORG_INTEL.words },
      "You said this to the console voice; the voice transcript relayed it at 2026-10-04 00:55Z. No particular steer " +
        `of yours is behind this card beyond it; ${FINDING_LINE}`,
      "session a787443c",
    ]);
  });

  it("quotes the ask covering a row a session registered, naming the run it held", () => {
    const row = rowOf({
      fields: { registeredBy: "a0000019", registeredRun: "organisation-hunt" },
      standing: standingOf({ active: [wireAsk({ covers: ["registered-rows"], id: "org-intel", quote: ORG_INTEL })] }),
    });
    const copy = sourceBlockCopy({ source: row.source });
    expect([row.source.kind, copy.line, copy.hover]).toEqual([
      "standing",
      "You said this to the console voice; the voice transcript relayed it at 2026-10-04 00:55Z. No particular steer " +
        "of yours is behind this card beyond it; a Claude session put it on your queue while it ran organisation hunt.",
      "session a0000019, run organisation-hunt",
    ]);
  });

  it("waits on the standing asks' read with a spinner or a staleness mark beside where it came from, never a sentence", () => {
    const loading = sourceBlockCopy({ source: rowOf({ fields: FINDING, standing: LOADING }).source });
    const failed = sourceBlockCopy({
      source: rowOf({ fields: FINDING, standing: { phase: "not-measured", why: "standing-asks exited 1" } }).source,
    });
    const subject = "your standing asks, one of which this card may rest on";
    expect([loading.pending, failed.pending, failed.line.includes("standing asks")]).toEqual([
      { read: { phase: "loading" }, subject },
      { read: { phase: "not-measured", why: "standing-asks exited 1" }, subject },
      false,
    ]);
  });

  it("says no standing ask covers it, and how one is recorded, when none does", () => {
    const row = rowOf({
      fields: FINDING,
      standing: standingOf({ active: [wireAsk({ covers: ["bot-replies"], id: "replies", quote: ORG_INTEL })] }),
    });
    expect(row.source.kind).toBe("standing-missing");
    const copy = sourceBlockCopy({ source: row.source });
    expect([copy.label, copy.tone, copy.words, copy.line]).toEqual([
      "not your words",
      "not-owner",
      undefined,
      "No words of yours behind this; it came from a fleet finding a session observed. No standing ask of yours is " +
        "recorded over cards like this one. If one of your standing asks covers it, a session finds your turn with " +
        "`slopweaver profile words` and records it with `slopweaver profile standing add <id> --anchor <anchor> " +
        "--covers findings`.",
    ]);
    // The same line as the block draws it: the recording command folded apart, marked so by the producer.
    expect(copy.sessionSteps).toStrictEqual({
      lead:
        "No words of yours behind this; it came from a fleet finding a session observed. No standing ask of yours is " +
        "recorded over cards like this one.",
      steps: [
        "If one of your standing asks covers it, a session finds your turn with `slopweaver profile words` and " +
          "records it with `slopweaver profile standing add <id> --anchor <anchor> --covers findings`.",
      ],
    });
  });

  it("says a recorded register does not read, and leaves an unread one to its mark, never that none covers it", () => {
    const unread = rowOf({ fields: FINDING, standing: LOADING });
    const broken = rowOf({
      fields: FINDING,
      standing: ready({ value: { kind: "defect", why: "standing-ask journal line 2 does not read: not JSON" } }),
    });
    const notMeasured = rowOf({ fields: FINDING, standing: { phase: "not-measured", why: "the verb timed out" } });
    const copies = [unread, broken, notMeasured].map((row) => sourceBlockCopy({ source: row.source }));
    expect(copies.map((copy) => [copy.line, copy.quoted])).toEqual([
      ["No words of yours behind this; it came from a fleet finding a session observed.", []],
      [
        "No words of yours behind this; it came from a fleet finding a session observed.",
        [
          {
            lead: "Your standing asks are recorded but do not read, so the one this card rests on cannot be quoted",
            why: "standing-ask journal line 2 does not read: not JSON",
          },
        ],
      ],
      ["No words of yours behind this; it came from a fleet finding a session observed.", []],
    ]);
  });

  it("keeps the register's own reason, machine id and all, for the fold rather than rewriting it (steer 7)", () => {
    const why = "journal written by session a0000019-0000-4000-8000-000000000022 does not read";
    const broken = rowOf({ fields: FINDING, standing: ready({ value: { kind: "defect", why } }) });
    expect(broken.source).toMatchObject({
      kind: "standing-missing",
      why: [
        {
          lead: "Your standing asks are recorded but do not read, so the one this card rests on cannot be quoted",
          why,
        },
      ],
    });
  });

  it("keeps the owner's words on the card's pull request from other rows through every overlay", () => {
    const prSteers = [{ identity: "acme/acme-admin#7", quote: ORG_INTEL, rowSlug: "proof-row" }];
    const covered = standingOf({ active: [wireAsk({ covers: ["findings"], id: "org-intel", quote: ORG_INTEL })] });
    const uncovered = standingOf({ active: [] });
    const sources = [covered, uncovered, LOADING].map(
      (standing) => rowOf({ fields: { ...FINDING, prSteers }, standing }).source,
    );
    expect(sources.map((source) => [source.kind, sourceBlockCopy({ source }).prSteers!.placed.length])).toEqual([
      ["standing", 1],
      ["standing-missing", 1],
      ["standing-pending", 1],
    ]);
  });

  it("leaves a card the owner's own words are behind exactly as it was", () => {
    const quote = { ...ORG_INTEL, anchor: "talk:a0000015-0000-4000-8000-000000000016" };
    const row = rowOf({
      fields: { anchor: quote.anchor, ownerWords: quote },
      standing: standingOf({ active: [wireAsk({ covers: ["findings"], id: "org-intel", quote: ORG_INTEL })] }),
    });
    expect(row.source).toEqual({ kind: "words", quote, steers: [], subject: "Worth a look? the row" });
  });
});

describe("an act's card", () => {
  const MERGE = {
    actionId: "merge.1",
    doneIso: "2026-10-09T10:00:00.000Z",
    kind: "github.merge",
    subject: "https://github.com/lachiejames/slopweaver/pull/2000",
    why: "green and gold-anchored",
  };

  /** The act row one act and a standing reading build, over an empty board. */
  function actRow({ action, standing }: { action: typeof MERGE; standing: LiveState<StandingAskReading> }): QueueRow {
    const rows = rowsOf({
      acts: ready({ value: readAutonomy([{ action }])! }),
      board: ready({ value: boardOf({ rows: [] }) }),
      drafts: LOADING,
      hands: LOADING,
      landing: LOADING,
      placer: ACME_PLACER,
      posts: LOADING,
      reviewers: LOADING,
      reviews: LOADING,
      imports: LOADING,
      standing,
    });
    return rows.find((one) => one.kind === "act")!;
  }

  it("quotes the standing ask covering its exact kind", () => {
    const row = actRow({
      action: MERGE,
      standing: standingOf({
        active: [
          wireAsk({ covers: ["unlinked-cards"], id: "other", quote: ORG_INTEL }),
          wireAsk({ covers: ["act:github.merge"], id: "auto-merge", quote: AUTO_MERGE }),
        ],
      }),
    });
    expect([row.source.kind, sourceBlockCopy({ source: row.source }).words]).toEqual([
      "standing",
      { cut: "none", text: AUTO_MERGE.words },
    ]);
  });

  it("names its own kind as the coverage to record when no ask covers it", () => {
    const row = actRow({ action: MERGE, standing: standingOf({ active: [] }) });
    expect(sourceBlockCopy({ source: row.source }).line).toContain("--covers act:github.merge`.");
  });

  it("names no act coverage for a kind `--covers` would refuse, falling back to where the act came from", () => {
    const action = { ...MERGE, kind: "https://x/turn_ABCDEFGH" };
    const line = sourceBlockCopy({ source: actRow({ action, standing: standingOf({ active: [] }) }).source }).line;
    expect(line).toContain("--covers unlinked-cards`.");
    expect(line).not.toContain("--covers act:");
  });

  it("hides a kind shaped like a machine id, so the overlay never changes the card's form", () => {
    const action = { ...MERGE, kind: "deadbeef-dead-beef-dead-deadbeef1234" };
    const unread = actRow({ action, standing: LOADING });
    expect(actRow({ action, standing: standingOf({ active: [] }) }).record.form).toEqual(unread.record.form);
    // Read before the machine-id gate, which hides ids only on a card it refuses: the row as the overlay meets it.
    if (unread.source.kind !== "standing-pending") {
      throw new Error("the unread register did not leave the act standing-pending");
    }
    const before: QueueRow = { ...unread, source: { ...unread.source.immediate, steers: unread.source.steers } };
    const source = standingAskSource({ row: before, standing: standingOf({ active: [] }) });
    expect(carriesMachineId({ text: sourceBlockCopy({ source }).line })).toBe(false);
    expect(sourceBlockCopy({ source }).line).toContain("--covers act:[id hidden]`.");
  });
});
