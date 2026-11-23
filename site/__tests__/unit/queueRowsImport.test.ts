/*
 * A staged import question on the queue: one card per question `store import-questions --json` publishes, placed on
 * this installation's own workspace, every option a `store import-resolve` command and none a button — the console
 * records nothing.
 */

import { describe, expect, it } from "vitest";

import type { CardLandings } from "../../components/live/readCardLandings";
import { type ImportQuestionReading, readImportQuestions } from "../../components/live/readImportQuestions";
import type { LiveState } from "../../components/live/useLive";
import { unlandedRows } from "../../lib/cardLandings";
import { importQuestionRows } from "../../lib/importQuestionRows";
import { type QueueRow, rowsOf } from "../../lib/queueRows";
import { NO_STEERS } from "../../lib/steeredCards";
import { ACME_PLACER } from "../organisationFixture";

const LOADING = { phase: "loading" } as const;
const AT = "2026-11-01T08:00:00.000Z";

/** The register holding a staged activation and a staged conflict, read through the real reader. */
const READING: ImportQuestionReading = readImportQuestions({
  observedAtIso: AT,
  questions: [
    {
      actions: ["activate", "leave-inactive"],
      batchId: "00000000-0000-4000-8000-0000000000a1",
      current: null,
      imported: "acme-directive-1: always open a draft pull request for the acme-admin repo",
      key: "acme-directive-1",
      kind: "activation",
      part: "owner-directives",
      questionId: "import-q-00000000000000a1",
      stagedAtIso: "2026-10-30T09:00:00.000Z",
    },
    {
      actions: ["keep-current", "take-imported"],
      batchId: "00000000-0000-4000-8000-0000000000b2",
      current: "acme-ask-7: review ABC-1 before Friday",
      imported: "acme-ask-7: review ABC-1 before Thursday",
      key: "acme-ask-7",
      kind: "conflict",
      part: "standing-asks",
      questionId: "import-q-00000000000000b2",
      stagedAtIso: "2026-10-31T10:30:00.000Z",
    },
  ],
})!;

/** The register, arrived at `AT`. */
const READY: LiveState<ImportQuestionReading> = {
  fixture: undefined,
  observedAtIso: AT,
  phase: "ready",
  stampedByRoute: false,
  value: READING,
};

/** The options one row's card offers, as letter, sentence and command. */
function optionsOf({ index }: { index: number }): readonly (readonly [string, string, string])[] {
  const card = importQuestionRows({ imports: READY })[index].card;
  if (card.kind !== "briefing") {
    throw new Error("an import question is a briefing card");
  }
  return card.options.map((option) => {
    if (option.how.kind !== "elsewhere" || option.how.command === undefined) {
      throw new Error("an import answer is a command, never a press");
    }
    return [option.letter, option.sentence, option.how.command] as const;
  });
}

/** The whole `what` a row's briefing card draws. */
function whatOf({ row }: { row: Pick<QueueRow, "card"> }): string {
  if (row.card.kind !== "briefing" || row.card.what === undefined) {
    throw new Error("an import question is a briefing card that states what it restores");
  }
  return row.card.what.whole;
}

describe("importQuestionRows", () => {
  it("draws one row per question, in the register's order, keyed by question id", () => {
    expect(importQuestionRows({ imports: READY }).map((row) => [row.key, row.id, row.kind, row.record.kind])).toEqual([
      ["import:import-q-00000000000000a1", "import-q-00000000000000a1", "import", "import"],
      ["import:import-q-00000000000000b2", "import-q-00000000000000b2", "import", "import"],
    ]);
  });

  it("offers an activation's two answers as commands, activate first", () => {
    expect(optionsOf({ index: 0 })).toEqual([
      [
        "A",
        "Activate it: the restored instruction steers once the import is applied.",
        "slopweaver store import-resolve --question import-q-00000000000000a1 --action activate",
      ],
      [
        "B",
        "Leave it inactive: it is restored as a record and steers nothing.",
        "slopweaver store import-resolve --question import-q-00000000000000a1 --action leave-inactive",
      ],
    ]);
  });

  it("offers a conflict's two answers as commands, keeping the current row first", () => {
    expect(optionsOf({ index: 1 })).toEqual([
      [
        "A",
        "Keep the current one: the live row stands and the imported one is not applied.",
        "slopweaver store import-resolve --question import-q-00000000000000b2 --action keep-current",
      ],
      [
        "B",
        "Take the imported one: it replaces the live row once the import is applied.",
        "slopweaver store import-resolve --question import-q-00000000000000b2 --action take-imported",
      ],
    ]);
  });

  it("asks each kind its own question, and a conflict states both sides", () => {
    const [activation, conflict] = importQuestionRows({ imports: READY });
    expect([activation.card.question, activation.pill, conflict.card.question, conflict.pill]).toEqual([
      "Should the restored owner-directives row acme-directive-1 take effect?",
      "restored instruction",
      "Keep your current standing-asks row acme-ask-7, or take the imported one?",
      "import conflict",
    ]);
    expect(whatOf({ row: conflict })).toBe(
      "Current: acme-ask-7: review ABC-1 before Friday Imported: acme-ask-7: review ABC-1 before Thursday",
    );
  });

  it("asks an alignment to be acknowledged, its one answer keeping the current row, and silence applying nothing to it", () => {
    const alignment = readImportQuestions({
      observedAtIso: AT,
      questions: [
        {
          actions: ["keep-current"],
          batchId: "00000000-0000-4000-8000-0000000000b2",
          current: "lesson: acme's widget queue drains in order",
          imported: "lesson: acme's widget queue drains out of order",
          key: "l-0000000000000001",
          kind: "alignment",
          part: "memories",
          questionId: "import-q-00000000000000c3",
          stagedAtIso: "2026-10-31T10:30:00.000Z",
        },
      ],
    })!;
    const [row] = importQuestionRows({ imports: { ...READY, value: alignment } });
    if (row.card.kind !== "briefing") {
      throw new Error("an import question is a briefing card");
    }
    expect([row.pill, row.card.question, row.card.ifSilent]).toEqual([
      "import difference",
      "The imported memories row l-0000000000000001 differs from your current one, which stays. Acknowledge it?",
      "The question stays open, and the current row stands either way.",
    ]);
    expect(row.card.options.map((option) => [option.letter, option.sentence])).toEqual([
      ["A", "Acknowledge it: the current row stands, and the imported one stays staged, unapplied."],
    ]);
    expect(whatOf({ row })).toBe(
      "Current: lesson: acme's widget queue drains in order Imported: lesson: acme's widget queue drains out of order",
    );
  });

  it("places every question on this installation's own workspace, blocking the fleet, never a colleague", () => {
    const [row] = importQuestionRows({ imports: READY });
    expect([row.placement, row.provenance, row.tier]).toEqual([
      {
        by: [{ source: "installation-state", value: "state:", workspace: "self" }],
        kind: "placed",
        workspace: "self",
      },
      "self",
      "fleet-blocked",
    ]);
  });

  it("dates a row by its staging and verifies it by the register's own reading", () => {
    expect(
      importQuestionRows({ imports: READY }).map((row) => [row.whenIso, row.currencyFloorIso, row.verifiedIso]),
    ).toEqual([
      ["2026-10-30T09:00:00.000Z", "2026-10-30T09:00:00.000Z", AT],
      ["2026-10-31T10:30:00.000Z", "2026-10-31T10:30:00.000Z", AT],
    ]);
  });

  it("keeps every question on the owner's list under a spoken landing on its card: only import-resolve answers one", () => {
    const rows = importQuestionRows({ imports: READY });
    const spoken: LiveState<CardLandings> = {
      fixture: undefined,
      observedAtIso: AT,
      phase: "ready",
      stampedByRoute: false,
      value: {
        landings: [
          {
            anchor: "talk:acme-call#turn-1",
            atIso: AT,
            cardKey: "import:import-q-00000000000000a1",
            decidedIso: AT,
            source: "transcript",
            words: "activate it",
            workSlug: "acme-import-follow-up",
          },
        ],
        moves: [],
        triageUnreadable: 0,
        unreadable: 0,
        unreadableLines: [],
      },
    };
    expect(unlandedRows({ rows, spoken, steers: NO_STEERS }).map((row) => row.key)).toEqual([
      "import:import-q-00000000000000a1",
      "import:import-q-00000000000000b2",
    ]);
  });

  it("draws nothing while the register loads or when it could not be read", () => {
    expect(importQuestionRows({ imports: LOADING })).toEqual([]);
    expect(importQuestionRows({ imports: { phase: "not-measured", why: "store import-questions exited 1" } })).toEqual(
      [],
    );
  });
});

describe("rowsOf with the import-question register", () => {
  it("projects every question into the queue's rows, whole-tagged and in order", () => {
    const rows = rowsOf({
      acts: LOADING,
      board: LOADING,
      drafts: LOADING,
      hands: LOADING,
      imports: READY,
      landing: LOADING,
      placer: ACME_PLACER,
      posts: LOADING,
      reviewers: LOADING,
      reviews: LOADING,
      standing: LOADING,
    });
    expect(rows.map((row) => [row.key, row.tagsRead])).toEqual([
      ["import:import-q-00000000000000a1", "whole"],
      ["import:import-q-00000000000000b2", "whole"],
    ]);
  });

  it("draws a question whose staged line names a talk by its id, the id hidden, never withholds it", () => {
    const imported = "acme-ask-7: as agreed on talk 0a1b2c3d";
    const carrying = readImportQuestions({
      observedAtIso: AT,
      questions: [
        {
          actions: ["keep-current", "take-imported"],
          batchId: "00000000-0000-4000-8000-0000000000b2",
          current: "acme-ask-7: review ABC-1 before Friday",
          imported,
          key: "acme-ask-7",
          kind: "conflict",
          part: "standing-asks",
          questionId: "import-q-00000000000000b2",
          stagedAtIso: "2026-10-31T10:30:00.000Z",
        },
      ],
    })!;
    expect(carrying.questions.map((question) => question.imported)).toEqual([imported]);
    const [row, ...rest] = rowsOf({
      acts: LOADING,
      board: LOADING,
      drafts: LOADING,
      hands: LOADING,
      imports: { ...READY, value: carrying },
      landing: LOADING,
      placer: ACME_PLACER,
      posts: LOADING,
      reviewers: LOADING,
      reviews: LOADING,
      standing: LOADING,
    });
    expect(rest).toEqual([]);
    expect([row.key, row.record.form.kind, whatOf({ row })]).toEqual([
      "import:import-q-00000000000000b2",
      "drawn",
      "Current: acme-ask-7: review ABC-1 before Friday Imported: acme-ask-7: as agreed on [id hidden]",
    ]);
  });
});
