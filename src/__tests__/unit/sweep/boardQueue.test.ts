/**
 * `queueDailyCard`: the `--queue` half of `sweep board` registers one card a day, only when the pass found an
 * `UNCARDED` page, and then settles the sweep's own cards the pass contradicts. The registrar and the settle are
 * plain functions passed in that record their calls, not mocks.
 */
import { describe, expect, it } from "vitest";

import type { AutomaticActDeps } from "../../../cli/commands/sweep/automaticActs.js";
import { queueDailyCard } from "../../../cli/commands/sweep/boardQueue.js";
import { EXIT_ERROR, EXIT_OK } from "../../../cli/exitCodes.js";
import { err, ok } from "../../../lib/result.js";
import type { SweepCandidate } from "../../../sweep/classify.js";
import type { SweepJournalRow } from "../../../sweep/journalRow.js";

import { ask, PAGE } from "./askDocFixture.js";

const HOME = "/h/home";
const NOW = new Date("2026-11-04T09:00:00.000Z");

const UNCARDED: SweepCandidate = {
  act: "none",
  path: "/h/home/handovers/plan-usage-strategy.md",
  slug: "plan-usage-strategy",
  verdict: "UNCARDED",
  witness: `settled answered with witness page:${PAGE}; page:${PAGE} never reached the owner's Queue`,
};

const KEEP: SweepCandidate = { ...UNCARDED, slug: "live-row", verdict: "KEEP", witness: "nothing condemns it" };

/** One of the sweep's own live cards, as the pass classified it. */
function card({ slug }: { slug: string }): SweepCandidate {
  return { ...KEEP, path: `/h/home/handovers/${slug}.md`, slug };
}

/** One pass's registrar calls, settles, ledger rows and diagnostics; `settleExit` and `ledgerFails` shape the writes. */
function seat({
  exit,
  settleExit = EXIT_OK,
  ledgerFails = false,
}: {
  exit: number;
  settleExit?: number;
  ledgerFails?: boolean;
}): {
  deps: Parameters<typeof queueDailyCard>[0]["deps"];
  lines: string[];
  registered: (readonly string[])[];
  settled: (readonly string[])[];
  ledger: SweepJournalRow[];
} {
  const lines: string[] = [];
  const registered: (readonly string[])[] = [];
  const settled: (readonly string[])[] = [];
  const ledger: SweepJournalRow[] = [];
  const writeDiagnostic: Parameters<typeof queueDailyCard>[0]["deps"]["writeDiagnostic"] = (line) => {
    lines.push(line);
  };
  const retire: AutomaticActDeps = {
    appendLedger: ({ row }) => {
      if (ledgerFails) {
        return err({ message: "the ledger would not write" });
      }
      ledger.push(row);
      return ok(undefined);
    },
    nowIso: () => NOW.toISOString(),
    observe: () => ok("unchanged"),
    recordAutonomy: () => Promise.resolve(undefined),
    runVerb: ({ act }) => {
      settled.push(act.call.argv);
      return Promise.resolve(settleExit);
    },
    writeDiagnostic,
  };
  return {
    deps: {
      now: () => NOW,
      registerQueueRow: ({ argv }) => {
        registered.push(argv);
        return Promise.resolve(exit);
      },
      retire,
      writeDiagnostic,
    },
    ledger,
    lines,
    registered,
    settled,
  };
}

describe("queueDailyCard", () => {
  it("registers today's card for an uncarded page", async () => {
    const { deps, lines, registered, settled } = seat({ exit: EXIT_OK });
    expect(await queueDailyCard({ candidates: [UNCARDED, KEEP], deps, docs: [], home: HOME })).toBe(EXIT_OK);
    expect(registered.map((argv) => argv[argv.indexOf("--slug") + 1])).toEqual(["sweep-board-2026-11-04"]);
    expect(settled).toEqual([]);
    expect(lines).toEqual(["sweep board: --queue registered sweep-board-2026-11-04 — 1 uncarded page(s)"]);
  });

  it("registers nothing for SHIPPED rows alone — they are closed, never carded", async () => {
    const { deps, lines, registered } = seat({ exit: EXIT_OK });
    const shipped: SweepCandidate = { ...KEEP, act: "close", slug: "acme-codex-host-gaps", verdict: "SHIPPED" };
    expect(await queueDailyCard({ candidates: [shipped, KEEP], deps, docs: [], home: HOME })).toBe(EXIT_OK);
    expect(registered).toEqual([]);
    expect(lines).toEqual(["sweep board: --queue registered nothing — no UNCARDED page"]);
  });

  // MEASURED: two earlier days' cards stayed live a day after the sweep read SHIPPED 0 UNCARDED 0.
  it("settles every own card up to today, answered and journalled, on a pass with nothing left for the owner", async () => {
    const { deps, lines, settled, ledger } = seat({ exit: EXIT_OK });
    const candidates = [card({ slug: "sweep-board-2026-11-03" }), card({ slug: "sweep-board-2026-11-02" }), KEEP];
    expect(await queueDailyCard({ candidates, deps, docs: [], home: HOME })).toBe(EXIT_OK);
    expect(settled.map((argv) => argv.slice(2, 7))).toEqual([
      ["handover", "settle", "sweep-board-2026-11-02", "--as", "answered"],
      ["handover", "settle", "sweep-board-2026-11-03", "--as", "answered"],
    ]);
    expect(settled.map((argv) => argv[argv.indexOf("--home") + 1])).toEqual([HOME, HOME]);
    expect(ledger.map((row) => [row.slug, row.verdict, row.act, row.session])).toEqual([
      ["sweep-board-2026-11-02", "SWEEP_CARD_RETIRED", "settle", "sweep board --queue"],
      ["sweep-board-2026-11-03", "SWEEP_CARD_RETIRED", "settle", "sweep board --queue"],
    ]);
    expect(lines).toEqual([
      "sweep board: --queue registered nothing — no UNCARDED page",
      "sweep board: --queue acted on 2 of 2 row(s) — slopweaver sweep list names each",
    ]);
  });

  it("settles an earlier day's card only after today's registers, and leaves today's", async () => {
    const { deps, registered, settled } = seat({ exit: EXIT_OK });
    const candidates = [UNCARDED, card({ slug: "sweep-board-2026-11-03" })];
    expect(await queueDailyCard({ candidates, deps, docs: [], home: HOME })).toBe(EXIT_OK);
    expect(registered).toHaveLength(1);
    expect(settled.map((argv) => argv[4])).toEqual(["sweep-board-2026-11-03"]);
    const witness = settled[0]![settled[0]!.indexOf("--witness") + 1];
    expect(witness).toBe(
      "sweep-board-2026-11-04 is the live board-sweep card as of 2026-11-04T09:00:00.000Z, so this earlier day's card is no longer the reading",
    );
  });

  it("leaves today's card alone when the board already holds it, and still retires an earlier one", async () => {
    const { deps, lines, registered, settled } = seat({ exit: EXIT_OK });
    const docs = [ask({ slug: "sweep-board-2026-11-04" })];
    const candidates = [UNCARDED, card({ slug: "sweep-board-2026-11-04" }), card({ slug: "sweep-board-2026-11-03" })];
    expect(await queueDailyCard({ candidates, deps, docs, home: HOME })).toBe(EXIT_OK);
    expect(registered).toEqual([]);
    expect(settled.map((argv) => argv[4])).toEqual(["sweep-board-2026-11-03"]);
    expect(lines[0]).toBe(
      "sweep board: --queue left sweep-board-2026-11-04 as it is — today's card is already on the board",
    );
  });

  it("fails and retires nothing when the registrar refuses the card, so an earlier card is still the owner's", async () => {
    const { deps, lines, settled } = seat({ exit: EXIT_ERROR });
    const candidates = [UNCARDED, card({ slug: "sweep-board-2026-11-03" })];
    expect(await queueDailyCard({ candidates, deps, docs: [], home: HOME })).toBe(EXIT_ERROR);
    expect(settled).toEqual([]);
    expect(lines).toEqual([
      "sweep board: --queue could not register sweep-board-2026-11-04 (exit 1) — both documents are written; re-run with --write --queue",
    ]);
  });

  it("stays clean when a settle is refused — a card a seat holds is left", async () => {
    const { deps, lines } = seat({ exit: EXIT_OK, settleExit: EXIT_ERROR });
    expect(
      await queueDailyCard({ candidates: [card({ slug: "sweep-board-2026-11-03" })], deps, docs: [], home: HOME }),
    ).toBe(EXIT_OK);
    expect(lines).toContain(
      "sweep board: --queue left sweep-board-2026-11-03: `handover settle` exited 1, its own lines above name why",
    );
  });

  it("fails when a retirement lands that the ledger would not record", async () => {
    const { deps } = seat({ exit: EXIT_OK, ledgerFails: true });
    expect(
      await queueDailyCard({ candidates: [card({ slug: "sweep-board-2026-11-03" })], deps, docs: [], home: HOME }),
    ).toBe(EXIT_ERROR);
  });
});
