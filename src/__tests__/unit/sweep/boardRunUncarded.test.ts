/**
 * `slopweaver sweep board` end to end over a closed ask whose page never reached the owner — the `UNCARDED` verdict and
 * the `--queue` daily card. The measured shape: a dispatch ask of the owner's settled `answered` with
 * `page:<slug>` as its witness and no question ever asked, so no card reached the owner's Queue.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runSweepBoard } from "../../../cli/commands/sweep/boardRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../cli/exitCodes.js";
import { err, ok } from "../../../lib/result.js";
import { stateHomePaths } from "../../../stateHome.js";
import { capture, home, removeHomes, writeRow } from "./boardRunFixture.js";

afterEach(() => {
  removeHomes();
});

const ASK = "plan-usage-strategy";
const PAGE = "acme-plan-page-17-nov";

function writeSettledPageAsk({ handoverDir }: { handoverDir: string }): void {
  writeFileSync(
    join(handoverDir, `${ASK}.md`),
    [
      "---",
      `slug: ${ASK}`,
      "kind: ask",
      'summary: "Work out the plan-usage strategy"',
      "status: ready",
      "askedIso: 2026-11-02T08:00:00.000Z",
      "blockedBy: []",
      "artifact: null",
      "doneWhen: []",
      "settlement: answered",
      `settlementWitness: page:${PAGE}`,
      "---",
      "",
    ].join("\n"),
    "utf8",
  );
}

describe("runSweepBoard on a closed ask whose page never reached the owner", () => {
  it("reports it UNCARDED, counted apart from the live rows, and says why", async () => {
    const root = home();
    writeSettledPageAsk({ handoverDir: join(root, "handovers") });
    const { deps, out } = capture();
    expect(await runSweepBoard({ deps, rest: ["--home", root] })).toBe(EXIT_OK);
    expect(out[0]).toBe("sweep board: 1 doc(s) scanned, 0 live row(s) swept, 1 closed row(s) uncarded");
    expect(out).toContain("  UNCARDED      1");
    expect(out).toContain(
      `      settled answered with witness page:${PAGE}; page:${PAGE} never reached the owner's Queue — no question naming it, no ruling, no hand step, no other row's card`,
    );
  });

  it("finds nothing once the owner has ruled on the page", async () => {
    const root = home();
    writeSettledPageAsk({ handoverDir: join(root, "handovers") });
    const { deps, out } = capture({
      pageReach: { handSteps: () => ok([]), ruledIdentities: () => ok(new Set([`page:${PAGE}`])) },
    });
    expect(await runSweepBoard({ deps, rest: ["--home", root] })).toBe(EXIT_OK);
    expect(out).toContain("  UNCARDED      0");
  });

  it("registers one Queue card for the day under --write --queue, citing the page by its console address", async () => {
    const root = home();
    writeSettledPageAsk({ handoverDir: join(root, "handovers") });
    const registered: (readonly string[])[] = [];
    const { deps, diagnostics } = capture({ registered });
    expect(await runSweepBoard({ deps, rest: ["--home", root, "--write", "--queue"] })).toBe(EXIT_OK);
    expect(registered).toHaveLength(1);
    const argv = registered[0]!;
    expect(argv.slice(0, 4)).toEqual(["node", "slopweaver", "handover", "register"]);
    expect(argv[argv.indexOf("--slug") + 1]).toBe("sweep-board-2026-11-03");
    expect(argv[argv.indexOf("--home") + 1]).toBe(root);
    expect(argv[argv.indexOf("--example") + 1]).toContain(`http://localhost:3000/api/page/${PAGE}/index.html`);
    expect(diagnostics.at(-1)).toBe("sweep board: --queue registered sweep-board-2026-11-03 — 1 uncarded page(s)");
  });

  it("registers nothing when today's card is already on the board, and nothing on a clean pass", async () => {
    const root = home();
    const handoverDir = join(root, "handovers");
    writeSettledPageAsk({ handoverDir });
    writeRow({ handoverDir, slug: "sweep-board-2026-11-03", status: "ready" });
    const registered: (readonly string[])[] = [];
    expect(
      await runSweepBoard({ deps: capture({ registered }).deps, rest: ["--home", root, "--write", "--queue"] }),
    ).toBe(EXIT_OK);
    const clean = home();
    writeRow({ handoverDir: join(clean, "handovers"), slug: "no-probe-row", status: "ready" });
    expect(
      await runSweepBoard({ deps: capture({ registered }).deps, rest: ["--home", clean, "--write", "--queue"] }),
    ).toBe(EXIT_OK);
    expect(registered).toEqual([]);
  });

  it("fails the run when the card does not register, with both documents already written", async () => {
    const root = home();
    writeSettledPageAsk({ handoverDir: join(root, "handovers") });
    const { deps, diagnostics } = capture({ registerExit: EXIT_USAGE });
    expect(await runSweepBoard({ deps, rest: ["--home", root, "--write", "--queue"] })).toBe(EXIT_ERROR);
    expect(diagnostics.at(-1)).toBe(
      "sweep board: --queue could not register sweep-board-2026-11-03 (exit 2) — both documents are written; re-run with --write --queue",
    );
    expect(readFileSync(stateHomePaths({ home: root }).live.hygiene.sweepBoard, "utf8")).toContain(
      '"verdict":"UNCARDED"',
    );
  });

  it("refuses --queue without --write before reading the board", async () => {
    const root = home();
    const { deps, diagnostics } = capture();
    expect(await runSweepBoard({ deps, rest: ["--home", root, "--queue"] })).toBe(EXIT_USAGE);
    expect(diagnostics[0]).toBe(
      "sweep board: --queue needs --write — the card is registered only once both documents are",
    );
  });

  it("publishes nothing when a page-reach register will not read, rather than reading every page as uncarded", async () => {
    const root = home();
    writeSettledPageAsk({ handoverDir: join(root, "handovers") });
    const registered: (readonly string[])[] = [];
    const { deps, diagnostics } = capture({
      pageReach: { handSteps: () => ok([]), ruledIdentities: () => err(["the lock-in ledger is torn"]) },
      registered,
    });
    expect(await runSweepBoard({ deps, rest: ["--home", root, "--write", "--queue"] })).toBe(EXIT_ERROR);
    expect(diagnostics).toContain("sweep board: UNCARDED was not judged — the lock-in ledger is torn");
    expect(diagnostics).toContain(
      "sweep board: --write left the previous document standing because the page-reach registers would not read, so UNCARDED went unjudged: the lock-in ledger is torn",
    );
    expect(registered).toEqual([]);
  });
});
