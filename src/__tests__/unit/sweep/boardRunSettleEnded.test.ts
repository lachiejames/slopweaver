/**
 * `sweep board --write --settle-ended` end to end over a throwaway home: the REAL settle, sweep ledger and autonomy
 * ledger writes, with only GitHub replaced by a table. What it pins is that a card whose every
 * pull request already ended leaves the owner's Queue by itself, on GitHub's record, findable afterwards — and the rails
 * around it: an open pull request keeps the row, the flag needs `--write`, and what is published is the board AFTER
 * the acts.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { AutonomyActionRow } from "../../../autonomy/types.js";
import { runSweepBoard } from "../../../cli/commands/sweep/boardRun.js";
import { type EndedSettleDeps, productionEndedSettleDeps } from "../../../cli/commands/sweep/endedSettle.js";
import { EXIT_OK, EXIT_USAGE } from "../../../cli/exitCodes.js";
import { stateHomePaths } from "../../../stateHome.js";
import { sweepLedgerPath } from "../../../sweep/journalStore.js";
import { closed, merged, open } from "../cli/commands/sweep/sweepReadFixture.js";

import { capture, home, removeHomes, writeAsk } from "./boardRunFixture.js";

afterEach(() => {
  removeHomes();
});

const QUESTION = "Close draft https://github.com/acme/app/pull/2 as superseded by https://github.com/acme/app/pull/3?";

/** A home holding one ask about two pull requests. */
function homeWithAsk(): string {
  const root = home();
  writeAsk({ handoverDir: join(root, "handovers"), question: QUESTION, slug: "close-draft-2" });
  return root;
}

/**
 * The real settle and sweep ledger over the test's home, with the autonomy ledger — which lives in the store, absent
 * here — and the diagnostic channel captured.
 */
function realSettle({ autonomy, diagnostics }: { autonomy: AutonomyActionRow[]; diagnostics: string[] }): {
  (args: { home: string }): EndedSettleDeps;
} {
  return ({ home: root }) => ({
    ...productionEndedSettleDeps({ home: root }),
    recordAutonomy: ({ row }) => {
      autonomy.push(row);
      return Promise.resolve(undefined);
    },
    writeDiagnostic: (line) => {
      diagnostics.push(line);
    },
  });
}

describe("sweep board --settle-ended", () => {
  it("settles an ask whose every pull request ended, journals it twice, and publishes the board after", async () => {
    const root = homeWithAsk();
    const autonomy: AutonomyActionRow[] = [];
    const diagnostics: string[] = [];
    const { deps } = capture({
      closures: new Map([
        ["acme/app#2", closed({ number: 2 })],
        ["acme/app#3", merged({ number: 3 })],
      ]),
      endedSettle: realSettle({ autonomy, diagnostics }),
    });

    expect(await runSweepBoard({ deps, rest: ["--home", root, "--write", "--settle-ended"] })).toBe(EXIT_OK);

    expect(autonomy.map((row) => [row.subject, row.kind, row.bySession])).toEqual([
      ["close-draft-2", "settle-ended-pull-request-ask", "sweep board --settle-ended"],
    ]);
    const ledger = readFileSync(sweepLedgerPath({ home: root }), "utf8")
      .trim()
      .split("\n");
    expect(ledger.length).toBe(1);
    const row = JSON.parse(ledger[0]!) as Record<string, unknown>;
    expect(row["slug"]).toBe("close-draft-2");
    expect(row["verdict"]).toBe("PR_ENDED");
    expect(row["act"]).toBe("settle");
    expect(row["session"]).toBe("sweep board --settle-ended");
    const census = JSON.parse(readFileSync(stateHomePaths({ home: root }).live.hygiene.sweepBoardCensus, "utf8")) as {
      census: Record<string, number>;
      swept: number;
    };
    expect(census.census["PR_ENDED"]).toBe(0);
    expect(census.swept).toBe(0);
    expect(diagnostics).toContain(
      "sweep board: --settle-ended settled 1 of 1 PR_ENDED row(s) — slopweaver sweep list names each",
    );
  });

  it("leaves an ask while one pull request it names is still open, and writes no ledger row", async () => {
    const root = homeWithAsk();
    const autonomy: AutonomyActionRow[] = [];
    const diagnostics: string[] = [];
    const { deps } = capture({
      closures: new Map([
        ["acme/app#2", open({ number: 2 })],
        ["acme/app#3", merged({ number: 3 })],
      ]),
      endedSettle: realSettle({ autonomy, diagnostics }),
    });

    expect(await runSweepBoard({ deps, rest: ["--home", root, "--write", "--settle-ended"] })).toBe(EXIT_OK);

    expect(diagnostics).toContain(
      "sweep board: --settle-ended settled 0 of 0 PR_ENDED row(s) — slopweaver sweep list names each",
    );
    expect(() => readFileSync(sweepLedgerPath({ home: root }), "utf8")).toThrow(/ENOENT/u);
    expect(autonomy).toEqual([]);
  });

  it("leaves an ask whose question was edited after the board read it, naming a pull request GitHub was never asked about", async () => {
    const root = homeWithAsk();
    const autonomy: AutonomyActionRow[] = [];
    const diagnostics: string[] = [];
    const real = realSettle({ autonomy, diagnostics });
    const { deps } = capture({
      closures: new Map([
        ["acme/app#2", closed({ number: 2 })],
        ["acme/app#3", merged({ number: 3 })],
      ]),
      endedSettle: ({ home: at }) => {
        const settle = real({ home: at });
        return {
          ...settle,
          settleRow: (args) => {
            // The edit lands between the board read and the settle's write.
            writeAsk({
              handoverDir: join(at, "handovers"),
              // Still a request to end pull requests, so only the unread #4 can hold it.
              question: QUESTION.replace("?", " and https://github.com/acme/app/pull/4?"),
              slug: "close-draft-2",
            });
            return settle.settleRow(args);
          },
        };
      },
    });

    expect(await runSweepBoard({ deps, rest: ["--home", root, "--write", "--settle-ended"] })).toBe(EXIT_OK);

    expect(readFileSync(join(root, "handovers", "close-draft-2.md"), "utf8")).not.toContain("settlement:");
    expect(diagnostics.some((line) => line.startsWith("sweep board: --settle-ended left close-draft-2"))).toBe(true);
    expect(() => readFileSync(sweepLedgerPath({ home: root }), "utf8")).toThrow(/ENOENT/u);
    expect(autonomy).toEqual([]);
  });

  it("publishes the board after a settle that wrote its row and then exited non-zero", async () => {
    const root = homeWithAsk();
    const autonomy: AutonomyActionRow[] = [];
    const diagnostics: string[] = [];
    const real = realSettle({ autonomy, diagnostics });
    const { deps } = capture({
      closures: new Map([
        ["acme/app#2", closed({ number: 2 })],
        ["acme/app#3", merged({ number: 3 })],
      ]),
      endedSettle: ({ home: at }) => {
        const settle = real({ home: at });
        // A mirror failing after the write: the row is settled, the exit says otherwise.
        return { ...settle, settleRow: async (args) => ((await settle.settleRow(args)) === 0 ? 1 : 2) };
      },
    });

    expect(await runSweepBoard({ deps, rest: ["--home", root, "--write", "--settle-ended"] })).toBe(EXIT_OK);

    expect(readFileSync(join(root, "handovers", "close-draft-2.md"), "utf8")).toContain("settlement: answered");
    const census = JSON.parse(readFileSync(stateHomePaths({ home: root }).live.hygiene.sweepBoardCensus, "utf8")) as {
      census: Record<string, number>;
      swept: number;
    };
    expect(census.census["PR_ENDED"]).toBe(0);
    expect(census.swept).toBe(0);
  });

  it("refuses --settle-ended without --write, before reading the board", async () => {
    const root = homeWithAsk();
    const { deps, diagnostics } = capture();

    expect(await runSweepBoard({ deps, rest: ["--home", root, "--settle-ended"] })).toBe(EXIT_USAGE);

    expect(diagnostics[0]).toBe(
      "sweep board: --settle-ended needs --write — the pass publishes the board after its acts",
    );
  });

  it("prints PR_ENDED without acting when the flag is absent", async () => {
    const root = homeWithAsk();
    const { deps, out } = capture({
      closures: new Map([
        ["acme/app#2", closed({ number: 2 })],
        ["acme/app#3", merged({ number: 3 })],
      ]),
    });

    expect(await runSweepBoard({ deps, rest: ["--home", root] })).toBe(EXIT_OK);

    expect(out).toContain("PR_ENDED — 1:");
    expect(out).toContain("  close-draft-2  [settle]");
  });
});
