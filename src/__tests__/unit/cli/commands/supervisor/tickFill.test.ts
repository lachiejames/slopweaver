/**
 * `supervisor tick fill` over a real temp scratch directory: the argv parsed as the router hands it, the files it
 * names read, `tick.json` rewritten in place — and every refusal leaving the file byte for byte as it was. The one
 * seam is the output lanes, captured as lines.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseSupervisorTickArgs } from "../../../../../cli/commands/supervisor/tickCore.js";
import type { TickFillArgs } from "../../../../../cli/commands/supervisor/tickFillArgs.js";
import { runFill } from "../../../../../cli/commands/supervisor/tickFillRun.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../cli/exitCodes.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

/** A form close would take. */
const FORM = {
  actions: [],
  foldSummary: "What the sweep read.",
  folds: ["The merge queue drained."],
  headline: { sentences: ["The merge queue is clear."] },
  judgements: [],
  openPagesReviewed: true,
  schemaVersion: 1,
  shift: null,
  sleeping: false,
};

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tick-fill-"));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

/**
 * Write one tick's form.
 *
 * @param tick the tick number
 * @param form the form to write
 * @returns the form file's path
 */
function writeTick({ tick, form }: { tick: number; form: Readonly<Record<string, unknown>> }): string {
  mkdirSync(join(dir, `tick-${String(tick)}`), { recursive: true });
  const path = join(dir, `tick-${String(tick)}`, "tick.json");
  writeFileSync(path, `${JSON.stringify(form, null, 2)}\n`);
  return path;
}

/**
 * Parse a fill invocation the way the router would.
 *
 * @param argv the flags after `supervisor tick fill`
 * @returns the parsed fill
 */
function fillArgs({ argv }: { argv: readonly string[] }): TickFillArgs {
  const parsed = unwrap(parseSupervisorTickArgs({ rest: ["fill", "--dir", dir, ...argv] }));
  expect(parsed.subaction).toBe("fill");
  if (parsed.subaction !== "fill") {
    throw new Error(`parsed ${parsed.subaction}`);
  }
  return parsed;
}

/**
 * Run one fill, capturing both lanes.
 *
 * @param argv the flags after `--dir <dir>`
 * @returns the exit code and every line written
 */
function fill({ argv }: { argv: readonly string[] }): { code: number; out: string[]; diagnostics: string[] } {
  const out: string[] = [];
  const diagnostics: string[] = [];
  const code = runFill({
    args: fillArgs({ argv }),
    deps: { scratch: { writeDiagnostic: (line) => diagnostics.push(line), writeOut: (line) => out.push(line) } },
  });
  return { code, diagnostics, out };
}

describe("supervisor tick fill", () => {
  it("writes the highest tick's form in place, carrying the last tick and naming what changed", () => {
    writeTick({ form: { ...FORM, folds: ["carried fold"], foldSummary: "carried summary" }, tick: 1 });
    const path = writeTick({ form: { ...FORM, folds: [], headline: { sentences: [] } }, tick: 2 });
    const foldFile = join(dir, "fold.txt");
    writeFileSync(foldFile, "a fold from a file\n\n");

    const result = fill({
      argv: [
        "--carry-from",
        "1",
        "--headline-sentence",
        "The queue is clear.",
        "--fold-file",
        foldFile,
        "--fold-at",
        "1",
      ],
    });

    expect(result.code).toBe(EXIT_OK);
    const written: unknown = JSON.parse(readFileSync(path, "utf8"));
    expect(written).toEqual({
      ...FORM,
      foldSummary: "carried summary",
      folds: ["carried fold", "a fold from a file"],
      headline: { sentences: ["The queue is clear."] },
    });
    expect(result.out[0]).toBe(
      `supervisor tick fill: wrote ${path} — folds, foldSummary, judgements, sleeping, headline`,
    );
    expect(result.out[1]).toBe(`  close will take it: slopweaver supervisor tick close --dir ${dir}`);
  });

  it("lists what close would still refuse after a partial fill, and exits 0", () => {
    writeTick({ form: { ...FORM, headline: { sentences: [] } }, tick: 1 });

    const result = fill({ argv: ["--lede", "A lede."] });

    expect(result.code).toBe(EXIT_OK);
    expect(result.out.slice(1)).toEqual([
      "  close would still refuse 1 issue(s):",
      "    headline.sentences: has 0 sentences; the headline needs at least 1",
    ]);
  });

  it("writes a fold carrying a fleet word, then names it with the rewrite before close can refuse it", () => {
    const path = writeTick({ form: FORM, tick: 1 });

    const result = fill({ argv: ["--fold", "This tick landed two merges.", "--fold-at", "0"] });

    expect(result.code).toBe(EXIT_OK);
    expect(result.out).toEqual([
      `supervisor tick fill: wrote ${path} — folds`,
      "  close would still refuse 1 issue(s) (a folds: line can be stricter than close):",
      '    folds: "done since you last looked" uses the fleet word "This tick" and never says what it means — ' +
        '"tick" here is one pass of the supervisor\'s loop. Say what it means in the same breath, above the fold, ' +
        "or write the card without the word.",
      "      in plain words: --fold-at 0 --fold 'This pass landed two merges.'",
    ]);
  });

  it("refuses a bad actions file and leaves the form byte for byte", () => {
    const path = writeTick({ form: FORM, tick: 1 });
    const before = readFileSync(path, "utf8");
    const actions = join(dir, "actions.json");
    writeFileSync(actions, JSON.stringify({ actionId: "a1" }));

    const result = fill({ argv: ["--actions", actions, "--lede", "A lede."] });

    expect(result.code).toBe(EXIT_ERROR);
    expect(readFileSync(path, "utf8")).toBe(before);
    expect(result.diagnostics.join("\n")).toContain("is not a JSON array of rows");
  });

  it("refuses a tick whose close already began", () => {
    const path = writeTick({ form: FORM, tick: 1 });
    writeFileSync(join(dir, "tick-1", "close-state.json"), "{}");
    const before = readFileSync(path, "utf8");

    const result = fill({ argv: ["--lede", "A lede."] });

    expect(result.code).toBe(EXIT_ERROR);
    expect(readFileSync(path, "utf8")).toBe(before);
    expect(result.diagnostics.join("\n")).toContain("already began a close from its form");
  });

  it("refuses carrying from the tick being filled", () => {
    writeTick({ form: FORM, tick: 1 });

    const result = fill({ argv: ["--carry-from", "1"] });

    expect(result.code).toBe(EXIT_ERROR);
    expect(result.diagnostics.join("\n")).toContain("--carry-from 1 is the tick being filled");
  });
});

describe("parseSupervisorTickArgs fill", () => {
  it("refuses a fill naming no edit", () => {
    expect(unwrapErr(parseSupervisorTickArgs({ rest: ["fill", "--dir", "/x"] })).message).toContain(
      "name at least one edit",
    );
  });

  it("reads repeated flags in the order written, and --quiet-shift as the null shift", () => {
    const parsed = unwrap(
      parseSupervisorTickArgs({
        rest: ["fill", "--dir", "/x", "--headline-sentence", "One.", "--headline-sentence", "Two.", "--quiet-shift"],
      }),
    );

    expect(parsed).toMatchObject({ headline: ["One.", "Two."], shift: null, subaction: "fill" });
  });

  it("refuses --fold with --fold-file, and --fold-at with no fold", () => {
    expect(
      unwrapErr(parseSupervisorTickArgs({ rest: ["fill", "--dir", "/x", "--fold", "a", "--fold-file", "b"] })).message,
    ).toBe("tick fill: --fold and --fold-file are one choice per call");
    expect(unwrapErr(parseSupervisorTickArgs({ rest: ["fill", "--dir", "/x", "--fold-at", "0"] })).message).toBe(
      "tick fill: --fold-at names where ONE --fold or --fold-file goes",
    );
  });
});
