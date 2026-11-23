/**
 * `sweep recheck` end to end over a throwaway home: the list a seat reads, a refused `--limit`, and a partial board
 * refusing rather than printing a list that may be missing the card that outranks it.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { RECHECK_USAGE } from "../../../../../cli/commands/sweep/core.js";
import { runSweepRecheck } from "../../../../../cli/commands/sweep/recheckRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { home, removeHomes, writeAsk, writeQueueAsk } from "../../../sweep/boardRunFixture.js";

afterEach(removeHomes);

/** Run the verb over `root`, on a fixed clock, capturing both channels. */
function run({ root, flags = [] }: { root: string; flags?: readonly string[] }): {
  code: number;
  out: string[];
  diagnostics: string[];
} {
  const out: string[] = [];
  const diagnostics: string[] = [];
  const code = runSweepRecheck({
    deps: {
      now: () => new Date("2026-11-09T07:15:00.000Z"),
      writeDiagnostic: (line) => {
        diagnostics.push(line);
      },
      writeOut: (line) => {
        out.push(line);
      },
    },
    rest: ["--home", root, ...flags],
  });
  return { code, diagnostics, out };
}

/** A home whose board holds one ask per slug. */
function boardOf({ slugs }: { slugs: readonly string[] }): string {
  const root = home();
  slugs.forEach((slug) => {
    writeQueueAsk({ handoverDir: join(root, "handovers"), question: `Is ${slug} still wanted?`, slug });
  });
  return root;
}

describe("runSweepRecheck", () => {
  it("leaves an ask with no shape, which never reached the owner's Queue", () => {
    const root = home();
    writeAsk({ handoverDir: join(root, "handovers"), question: "Unshaped?", slug: "ask-bare" });

    expect(run({ root }).out).toEqual(["sweep recheck: 0 of 0 unattended card(s) not verified today"]);
  });

  it("leaves a card whose run started, since that run owns the question", () => {
    const root = boardOf({ slugs: ["ask-a"] });
    writeFileSync(
      join(root, "runs", "ask-a.jsonl"),
      `${JSON.stringify({ atIso: "2026-11-08T07:00:00.000Z", branch: "b", docHash: "h", kind: "started" })}\n`,
      "utf8",
    );

    expect(run({ root }).out).toEqual(["sweep recheck: 0 of 0 unattended card(s) not verified today"]);
  });

  it("prints each due card with its band, its dates and its question", () => {
    const { code, out, diagnostics } = run({ root: boardOf({ slugs: ["ask-a"] }) });

    expect(code).toBe(EXIT_OK);
    expect(diagnostics).toEqual([]);
    expect(out).toEqual([
      "sweep recheck: 1 of 1 unattended card(s) not verified today",
      "  p1 ask-a · asked 2026-11-04 · checked never · Is ask-a still wanted?",
    ]);
  });

  it("honours --limit and still reports every card due", () => {
    const { out } = run({ flags: ["--limit", "1"], root: boardOf({ slugs: ["ask-a", "ask-b"] }) });

    expect(out).toEqual([
      "sweep recheck: 1 of 2 unattended card(s) not verified today",
      "  p1 ask-a · asked 2026-11-04 · checked never · Is ask-a still wanted?",
    ]);
  });

  it("prints one JSON object per card under --json", () => {
    const { out } = run({ flags: ["--json"], root: boardOf({ slugs: ["ask-a"] }) });

    expect(out.map((line) => (JSON.parse(line) as { slug: string; band: string }).band)).toEqual(["p1"]);
  });

  it("refuses a --limit that is not a positive whole number", () => {
    const { code, diagnostics } = run({ flags: ["--limit", "0"], root: boardOf({ slugs: [] }) });

    expect(code).toBe(EXIT_USAGE);
    expect(diagnostics).toEqual(["sweep recheck: --limit takes a positive whole number"]);
  });

  it("refuses a partial board, naming the file that did not read", () => {
    const root = boardOf({ slugs: ["ask-a"] });
    mkdirSync(join(root, "handovers", "broken.md"));

    const { code, out, diagnostics } = run({ root });

    expect(code).toBe(EXIT_ERROR);
    expect(out).toEqual([]);
    expect(diagnostics).toEqual([
      "sweep recheck: the board is partial, so the list would be too — 1 handover file(s) could not be read: broken.md",
    ]);
  });

  it("answers help on stdout", () => {
    const out: string[] = [];
    const code = runSweepRecheck({
      deps: {
        now: () => new Date("2026-11-09T07:15:00.000Z"),
        writeDiagnostic: () => undefined,
        writeOut: (line) => {
          out.push(line);
        },
      },
      rest: ["--help"],
    });

    expect(code).toBe(EXIT_OK);
    expect(out).toEqual([RECHECK_USAGE]);
  });
});
