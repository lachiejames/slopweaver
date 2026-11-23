/**
 * `settleEndedRows` over plain fake seams: which rows it acts on, the per-pass cap, and that it STOPS at the first
 * failure rather than meeting the same fault on every row after it.
 */
import { describe, expect, it } from "vitest";

import { ENDED_SETTLE_CAP, type EndedSettleDeps, settleEndedRows } from "../../../cli/commands/sweep/endedSettle.js";
import { err, ok } from "../../../lib/result.js";
import type { SweepCandidate } from "../../../sweep/classify.js";
import type { SweepJournalRow } from "../../../sweep/journalRow.js";

/** One candidate at a verdict. */
function candidate({
  slug,
  verdict = "PR_ENDED",
}: {
  slug: string;
  verdict?: SweepCandidate["verdict"];
}): SweepCandidate {
  return {
    act: verdict === "PR_ENDED" ? "settle" : "none",
    path: `/h/${slug}.md`,
    question: "Close https://github.com/acme/app/pull/1?",
    slug,
    verdict,
    witness: `every pull request its question names has ended: https://github.com/acme/app/pull/1 closed unmerged at x`,
  };
}

/** Fake writes recording each act; `failSettleOn` and `failLedgerOn` name the slug whose write fails. */
function fakes({ failSettleOn, failLedgerOn }: { failSettleOn?: string; failLedgerOn?: string } = {}): {
  deps: EndedSettleDeps;
  settled: string[];
  ledger: SweepJournalRow[];
  autonomy: string[];
  diagnostics: string[];
} {
  const settled: string[] = [];
  const ledger: SweepJournalRow[] = [];
  const autonomy: string[] = [];
  const diagnostics: string[] = [];
  return {
    autonomy,
    deps: {
      appendLedger: ({ row }) => {
        if (row.slug === failLedgerOn) {
          return err({ message: "the ledger would not write" });
        }
        ledger.push(row);
        return ok(undefined);
      },
      nowIso: () => "2026-11-08T07:00:00.000Z",
      recordAutonomy: ({ row }) => {
        autonomy.push(row.subject);
        return Promise.resolve(undefined);
      },
      settleRow: ({ argv }) => {
        const slug = argv[4]!;
        if (slug === failSettleOn) {
          return Promise.resolve(1);
        }
        settled.push(slug);
        return Promise.resolve(0);
      },
      writeDiagnostic: (line) => {
        diagnostics.push(line);
      },
    },
    diagnostics,
    ledger,
    settled,
  };
}

describe("settleEndedRows", () => {
  it("settles only PR_ENDED rows, as answered, journalling each on both ledgers", async () => {
    const { deps, settled, ledger, autonomy } = fakes();

    const done = await settleEndedRows({
      candidates: [
        candidate({ slug: "a" }),
        candidate({ slug: "b", verdict: "UNWITNESSED" }),
        candidate({ slug: "c" }),
      ],
      deps,
      home: "/state",
    });

    expect(done).toEqual({ attempted: 2, settled: ["a", "c"] });
    expect(settled).toEqual(["a", "c"]);
    expect(ledger.map((row) => [row.slug, row.verdict, row.act, row.session])).toEqual([
      ["a", "PR_ENDED", "settle", "sweep board --settle-ended"],
      ["c", "PR_ENDED", "settle", "sweep board --settle-ended"],
    ]);
    expect(autonomy).toEqual(["a", "c"]);
  });

  it(`settles at most ${String(ENDED_SETTLE_CAP)} a pass and names the next pass's rows`, async () => {
    const { deps, settled, diagnostics } = fakes();
    const many = Array.from({ length: ENDED_SETTLE_CAP + 2 }, (_, index) =>
      candidate({ slug: `row-${String(index)}` }),
    );

    await settleEndedRows({ candidates: many, deps, home: "/state" });

    expect(settled.length).toBe(ENDED_SETTLE_CAP);
    expect(diagnostics.filter((line) => line.includes("is the next pass's"))).toEqual([
      `sweep board: --settle-ended reached its cap of ${String(ENDED_SETTLE_CAP)} — row-25 is the next pass's`,
      `sweep board: --settle-ended reached its cap of ${String(ENDED_SETTLE_CAP)} — row-26 is the next pass's`,
    ]);
  });

  it("stops at a refused settle, writing nothing for it and acting on no row after it", async () => {
    const { deps, settled, ledger, diagnostics } = fakes({ failSettleOn: "b" });

    const done = await settleEndedRows({
      candidates: [candidate({ slug: "a" }), candidate({ slug: "b" }), candidate({ slug: "c" })],
      deps,
      home: "/state",
    });

    // `b` counts as attempted: a settle exiting non-zero may still have written its row, so the board is re-read.
    expect(done).toEqual({ attempted: 2, settled: ["a"] });
    expect(settled).toEqual(["a"]);
    expect(ledger.map((row) => row.slug)).toEqual(["a"]);
    expect(diagnostics).toContain("sweep board: --settle-ended stopped at the first failure — the next pass resumes");
  });

  it("stops at an unwritten ledger row, printing the act it could not record", async () => {
    const { deps, settled, autonomy, diagnostics } = fakes({ failLedgerOn: "a" });

    const done = await settleEndedRows({
      candidates: [candidate({ slug: "a" }), candidate({ slug: "b" })],
      deps,
      home: "/state",
    });

    expect(done).toEqual({ attempted: 1, settled: ["a"] });
    expect(settled).toEqual(["a"]);
    expect(autonomy).toEqual([]);
    expect(diagnostics[0]).toBe("sweep board: settled a, but the ledger would not write — the act was:");
  });

  it("leaves a PR_ENDED row carrying no judged question, settling nothing", async () => {
    const { deps, settled, diagnostics } = fakes();
    const { question: _dropped, ...unjudged } = candidate({ slug: "a" });

    const done = await settleEndedRows({ candidates: [unjudged], deps, home: "/state" });

    expect(done).toEqual({ attempted: 1, settled: [] });
    expect(settled).toEqual([]);
    expect(diagnostics[0]).toBe("sweep board: --settle-ended left a: its verdict carries no judged question");
  });
});
