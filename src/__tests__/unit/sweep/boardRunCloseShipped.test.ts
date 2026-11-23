/**
 * `slopweaver sweep board --write --close-shipped` end to end over a throwaway home: a SHIPPED row is closed by the
 * register's own `handover close`, journalled on the sweep ledger, and never carded, because a card asking the owner to
 * close a row whose own witness already says shipped is a card with nothing to decide.
 * The close is the REAL one (`productionShippedCloseDeps`), so its lock, precondition and gates are what is tested.
 */
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runSweepBoard, type SweepBoardDeps } from "../../../cli/commands/sweep/boardRun.js";
import { productionShippedCloseDeps } from "../../../cli/commands/sweep/shippedClose.js";
import { EXIT_OK, EXIT_USAGE } from "../../../cli/exitCodes.js";
import { applyRowEvent } from "../../../handover/rowEvent.js";
import { stateHomePaths } from "../../../stateHome.js";
import { capture, home, removeHomes } from "./boardRunFixture.js";

const repos: string[] = [];

afterEach(() => {
  removeHomes();
  repos.splice(0).forEach((tree) => {
    rmSync(tree, { force: true, recursive: true });
  });
});

const SLUG = "acme-codex-host-gaps";

/** A scratch tree whose one file carries the symbol the row's probe looks for, so the probe passes. */
function repo(): string {
  const root = mkdtempSync(join(tmpdir(), "sweep-shipped-repo-"));
  repos.push(root);
  writeFileSync(join(root, "a.ts"), "export const shippedSymbol = 1;\n", "utf8");
  return root;
}

/** A live row whose one `present` probe passes against `tree`, which the board reads as LOOKS SHIPPED. */
function writeShippedRow({ handoverDir, tree }: { handoverDir: string; tree: string }): void {
  writeFileSync(
    join(handoverDir, `${SLUG}.md`),
    [
      "---",
      `slug: ${SLUG}`,
      "status: ready",
      `summary: "what ${SLUG} does"`,
      `repo: ${tree}`,
      "blockedBy: []",
      "doneWhen:",
      '  - present: "a.ts#shippedSymbol"',
      "---",
      "",
      `# ${SLUG}`,
      "",
    ].join("\n"),
    "utf8",
  );
}

/**
 * The real close and sweep ledger over the test's home, with the autonomy row recorded into `autonomy` — that ledger
 * lives in the store, a database no unit test opens.
 */
function realClose({ autonomy }: { autonomy: string[] }): SweepBoardDeps["shippedClose"] {
  return ({ home: at }) => ({
    ...productionShippedCloseDeps({ home: at }),
    recordAutonomy: ({ row }) => {
      autonomy.push(`${row.subject} ${row.kind} ${row.bySession}`);
      return Promise.resolve(undefined);
    },
  });
}

/** The run journal's raw lines for the row, or none when it was never written. */
function journalLines({ root }: { root: string }): readonly string[] {
  const path = join(stateHomePaths({ home: root }).runs, `${SLUG}.jsonl`);
  try {
    return readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => line.length > 0);
  } catch {
    return [];
  }
}

describe("runSweepBoard --close-shipped", () => {
  it("reads the row SHIPPED without the flag, and closes nothing", async () => {
    const root = home();
    writeShippedRow({ handoverDir: join(root, "handovers"), tree: repo() });
    const { deps, out } = capture();
    expect(await runSweepBoard({ deps, rest: ["--home", root] })).toBe(EXIT_OK);
    expect(out).toContain("  SHIPPED       1");
    expect(journalLines({ root })).toEqual([]);
  });

  it("closes the SHIPPED row through handover close, journals it, and publishes the board after the close", async () => {
    const root = home();
    writeShippedRow({ handoverDir: join(root, "handovers"), tree: repo() });
    const registered: (readonly string[])[] = [];
    const autonomy: string[] = [];
    const { deps, out } = capture({ registered, shippedClose: realClose({ autonomy }) });
    expect(await runSweepBoard({ deps, rest: ["--home", root, "--write", "--queue", "--close-shipped"] })).toBe(
      EXIT_OK,
    );
    expect(journalLines({ root }).map((line) => JSON.parse(line).kind)).toContain("closed");
    const ledger = readFileSync(join(root, "ledgers", "sweep.jsonl"), "utf8");
    expect(ledger).toContain(`"slug":"${SLUG}"`);
    expect(ledger).toContain('"verdict":"SHIPPED"');
    expect(ledger).toContain('"session":"sweep board --close-shipped"');
    expect(out).toContain("  SHIPPED       0");
    expect(registered).toEqual([]);
    expect(autonomy).toEqual([`${SLUG} close-shipped-board-row sweep board --close-shipped`]);
  });

  it("leaves a row whose run a seat is still on", async () => {
    const root = home();
    writeShippedRow({ handoverDir: join(root, "handovers"), tree: repo() });
    const runs = stateHomePaths({ home: root }).runs;
    mkdirSync(runs, { recursive: true });
    appendFileSync(
      join(runs, `${SLUG}.jsonl`),
      `${JSON.stringify({ atIso: "2026-11-03T06:00:00.000Z", kind: "started", sessionId: "seat-1", slug: SLUG })}\n`,
      "utf8",
    );
    const autonomy: string[] = [];
    const { deps } = capture({ shippedClose: realClose({ autonomy }) });
    expect(await runSweepBoard({ deps, rest: ["--home", root, "--write", "--close-shipped"] })).toBe(EXIT_OK);
    expect(autonomy).toEqual([]);
    expect(journalLines({ root }).map((line) => JSON.parse(line).kind)).toEqual(["started"]);
  });

  it("leaves a SHIPPED row a seat was dispatched to that has not started yet", async () => {
    const root = home();
    writeShippedRow({ handoverDir: join(root, "handovers"), tree: repo() });
    const runs = stateHomePaths({ home: root }).runs;
    mkdirSync(runs, { recursive: true });
    appendFileSync(
      join(runs, `${SLUG}.jsonl`),
      `${JSON.stringify({ atIso: "2026-11-03T06:00:00.000Z", by: "supervisor", kind: "dispatched", target: "workspace:7" })}\n`,
      "utf8",
    );
    const autonomy: string[] = [];
    const { deps, out } = capture({ shippedClose: realClose({ autonomy }) });
    expect(await runSweepBoard({ deps, rest: ["--home", root, "--write", "--close-shipped"] })).toBe(EXIT_OK);
    expect(out).toContain("  SHIPPED       1");
    expect(autonomy).toEqual([]);
    expect(journalLines({ root }).map((line) => JSON.parse(line).kind)).toEqual(["dispatched"]);
  });

  it("cannot close past the uncarded-page gate: a row whose page never reached the owner's Queue is left", async () => {
    const root = home();
    writeShippedRow({ handoverDir: join(root, "handovers"), tree: repo() });
    applyRowEvent({
      event: { atIso: "2026-11-03T06:00:00.000Z", kind: "artifact", url: "page:acme-plan-page-17-nov" },
      runsDir: stateHomePaths({ home: root }).runs,
      slug: SLUG,
    });
    const autonomy: string[] = [];
    const { deps } = capture({ shippedClose: realClose({ autonomy }) });
    expect(await runSweepBoard({ deps, rest: ["--home", root, "--write", "--close-shipped"] })).toBe(EXIT_OK);
    expect(journalLines({ root }).map((line) => JSON.parse(line).kind)).toEqual(["artifact"]);
    expect(autonomy).toEqual([]);
  });

  it("refuses --close-shipped without --write before reading the board", async () => {
    const root = home();
    const { deps, diagnostics } = capture();
    expect(await runSweepBoard({ deps, rest: ["--home", root, "--close-shipped"] })).toBe(EXIT_USAGE);
    expect(diagnostics[0]).toBe(
      "sweep board: --close-shipped needs --write — the pass publishes the board after its acts",
    );
  });
});
