/**
 * What `store import --apply` prints: an applied batch with and without append-only differences, a batch already
 * applied, a strict apply's refusal row by row, a damaged batch as damage, every other refusal as its own message,
 * and the home the apply used named in every acknowledging command. Pure.
 */
import { describe, expect, it } from "vitest";

import {
  importApplyLines,
  importApplyRefusalLines,
  withStoreOrigin,
} from "../../../../../cli/commands/store/importApplyLines.js";
import { type AppendOnlyDifference, StoreImportApplyErrors } from "../../../../../store/transfer/importApplyErrors.js";

const BATCH = "0f1e2d3c-4b5a-4968-8776-655443322110";
const PLAN = `sha256:${"c".repeat(64)}`;

/** One append-only difference, acknowledged or not. */
function difference({ resolved }: { resolved: boolean }): AppendOnlyDifference {
  return {
    current: "lesson: retry the push [content 0123456789ab]",
    imported: "lesson: retry the push twice [content ba9876543210]",
    key: "bbbbbbbb-0000-4000-8000-000000000001",
    part: "memories",
    questionId: resolved ? "import-q-00000000000000aa" : "import-q-00000000000000bb",
    resolved,
  };
}

describe("importApplyLines", () => {
  it("prints the rows written and says no difference was met", () => {
    const lines = importApplyLines({
      home: "/tmp/acme-home",
      outcome: {
        appendOnlyDifferences: [],
        batchId: BATCH,
        items: 7,
        openAlignmentQuestionIds: [],
        outcome: "applied",
        planDigest: PLAN,
        writes: 8,
      },
    });
    expect(lines).toEqual([
      `store import: applied batch ${BATCH} under plan ${PLAN}: 8 row(s) of the batch written, its receipt included, from 7 staged`,
      "  no append-only difference: every staged row the plan writes was written",
    ]);
  });

  it("reports each difference with both sides, and the acknowledging command only where none was given", () => {
    const lines = importApplyLines({
      home: "/tmp/acme-home",
      outcome: {
        appendOnlyDifferences: [difference({ resolved: true }), difference({ resolved: false })],
        batchId: BATCH,
        items: 7,
        openAlignmentQuestionIds: ["import-q-00000000000000bb"],
        outcome: "applied",
        planDigest: PLAN,
        writes: 6,
      },
    });
    expect(lines).toEqual([
      `store import: applied batch ${BATCH} under plan ${PLAN}: 6 row(s) of the batch written, its receipt included, from 7 staged`,
      "  2 append-only difference(s): the current row stands, and the imported one stays staged, unapplied:",
      "    memories bbbbbbbb-0000-4000-8000-000000000001 (import-q-00000000000000aa, acknowledged)",
      "      current:  lesson: retry the push [content 0123456789ab]",
      "      imported: lesson: retry the push twice [content ba9876543210]",
      "    memories bbbbbbbb-0000-4000-8000-000000000001 (import-q-00000000000000bb, not acknowledged)",
      "      current:  lesson: retry the push [content 0123456789ab]",
      "      imported: lesson: retry the push twice [content ba9876543210]",
      "      acknowledge: slopweaver store import-resolve --question import-q-00000000000000bb --action keep-current --home /tmp/acme-home",
      "  --stop-on-conflict refuses the whole apply on any of these instead",
    ]);
  });

  it("carries an explicit --home into the acknowledging command, quoted where a shell needs it", () => {
    const lines = importApplyLines({
      home: "/tmp/acme home",
      outcome: {
        appendOnlyDifferences: [difference({ resolved: false })],
        batchId: BATCH,
        items: 7,
        openAlignmentQuestionIds: ["import-q-00000000000000bb"],
        outcome: "applied",
        planDigest: PLAN,
        writes: 7,
      },
    });
    expect(lines.at(-2)).toBe(
      "      acknowledge: slopweaver store import-resolve --question import-q-00000000000000bb --action keep-current --home '/tmp/acme home'",
    );
  });

  it("says a batch already applied wrote none of its rows now, and what its own apply committed", () => {
    const lines = importApplyLines({
      home: "/tmp/acme-home",
      outcome: { batchId: BATCH, receiptWrites: 8, outcome: "already-applied", planDigest: PLAN, writes: 0 },
    });
    expect(lines).toEqual([
      `store import: batch ${BATCH} was already applied under plan ${PLAN}; none of its rows written now, and its receipt records 8 written`,
    ]);
  });
});

describe("withStoreOrigin", () => {
  const printed = [`  run again: slopweaver store import --apply ${BATCH} --home /tmp/acme-home`];

  it("notes under a printed command that the store came from SLOPWEAVER_STORE_URL (Codex r31, 5-5)", () => {
    expect(withStoreOrigin({ lines: printed, origin: "environment" })).toEqual([
      ...printed,
      "  this run's store came from SLOPWEAVER_STORE_URL, which wins over --home: paste a command above with that same variable set",
    ]);
  });

  it("adds nothing when the home chose the store", () => {
    expect(withStoreOrigin({ lines: printed, origin: "secret" })).toEqual(printed);
  });

  it("reads a row's own content naming the verb as no command (Codex r33, 5-5)", () => {
    const lines = importApplyLines({
      home: "/tmp/acme-home",
      outcome: {
        appendOnlyDifferences: [
          { ...difference({ resolved: true }), current: "lesson: run slopweaver store import --apply first" },
        ],
        batchId: BATCH,
        items: 3,
        openAlignmentQuestionIds: [],
        outcome: "applied",
        planDigest: "sha256:plan",
        writes: 2,
      },
    });
    expect(withStoreOrigin({ lines, origin: "environment" })).toEqual(lines);
  });

  it("adds nothing when no command was printed to paste", () => {
    const lines = [`store import: batch ${BATCH} applied`];
    expect(withStoreOrigin({ lines, origin: "environment" })).toEqual(lines);
  });
});

describe("importApplyRefusalLines", () => {
  it("lists every difference a strict apply stopped on, and the alternative", () => {
    const refusal = StoreImportApplyErrors.appendOnlyConflict({
      batchId: BATCH,
      differences: [difference({ resolved: false })],
    });
    expect(importApplyRefusalLines({ home: "/tmp/acme-home", refusal, stopOnConflict: true })).toEqual([
      `store import: batch ${BATCH} was not applied, and none of its rows was written: --stop-on-conflict stops on any append-only difference, and it met 1:`,
      "    memories bbbbbbbb-0000-4000-8000-000000000001 (import-q-00000000000000bb, not acknowledged)",
      "      current:  lesson: retry the push [content 0123456789ab]",
      "      imported: lesson: retry the push twice [content ba9876543210]",
      "      acknowledge: slopweaver store import-resolve --question import-q-00000000000000bb --action keep-current --home /tmp/acme-home",
      "  without --stop-on-conflict, a difference like these does not stop the apply: it keeps the current row and leaves the imported one staged",
    ]);
  });

  it("names a batch staging left incomplete as damage, never as a question to answer", () => {
    const refusal = StoreImportApplyErrors.batchIncomplete({ batchId: BATCH, why: "an answer names no question" });
    expect(importApplyRefusalLines({ home: "/tmp/acme-home", refusal, stopOnConflict: false })).toEqual([
      `store import: ${refusal.message}`,
      "  this is damage to what staging wrote, not a question to answer: none of its rows was applied, and the batch is left as it is; no verb repairs it",
    ]);
  });

  it("follows a commit of unknown outcome with the one re-run, naming the same home, quoted (Codex r25, 5-5)", () => {
    const refusal = StoreImportApplyErrors.commitUnconfirmed({ batchId: BATCH, why: "write CONNECTION_CLOSED" });
    expect(importApplyRefusalLines({ home: "/tmp/acme home", refusal, stopOnConflict: false })).toEqual([
      `store import: ${refusal.message}`,
      `  run again: slopweaver store import --apply ${BATCH} --home '/tmp/acme home'`,
    ]);
  });

  it("retries a strict apply of unknown outcome strict (Codex r30, 5-5)", () => {
    const refusal = StoreImportApplyErrors.commitUnconfirmed({ batchId: BATCH, why: "write CONNECTION_CLOSED" });
    expect(importApplyRefusalLines({ home: "/tmp/acme-home", refusal, stopOnConflict: true })).toEqual([
      `store import: ${refusal.message}`,
      `  run again: slopweaver store import --apply ${BATCH} --stop-on-conflict --home /tmp/acme-home`,
    ]);
  });

  it("prints any other refusal as its own message", () => {
    const refusal = StoreImportApplyErrors.batchNotStaged({ batchId: BATCH });
    expect(importApplyRefusalLines({ home: "/tmp/acme-home", refusal, stopOnConflict: false })).toEqual([
      `store import: no batch ${BATCH} is staged; store import --from <dir> --approve <digest> stages one`,
    ]);
  });
});
