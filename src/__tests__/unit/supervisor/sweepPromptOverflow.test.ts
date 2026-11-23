/**
 * An over-budget shift state rendered within the cap — a head, then a pointer to the whole of it — instead of
 * refused. Every count is exact, because the property being bought is that the prompt is NEVER over 700 words and
 * the file ALWAYS holds every authored word the prompt dropped.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap } from "../../../lib/result.js";
import { supervisorCoreErrorLines } from "../../../supervisor/errors.js";
import { keepOverflowed, keepShiftOverflow } from "../../../supervisor/shiftOverflowStore.js";
import {
  MAX_RENDERED_PROMPT_WORDS,
  renderSweepPrompt,
  shiftStateBudgetWords,
  wordCount,
} from "../../../supervisor/sweepPrompt.js";
import { armSweepPrompt } from "../../../supervisor/sweepPromptArm.js";
import { fitShiftOverflow, overflowPointer, shiftOverflowPath } from "../../../supervisor/sweepPromptOverflow.js";

const CONTRACT = "/plugin/skills/supervisor/reference/sweep-contract.md";
const PATH = "/home/supervisor-scratch/handoff-9009/shift-overflow-abc.txt";
const POINTER_WORDS = wordCount({ text: overflowPointer({ omittedWords: 0, path: PATH }) });

/** `count` words, each `w`, as one sentence per `perSentence` words. */
function sentences({ count, perSentence }: { count: number; perSentence: number }): string {
  const words = Array.from({ length: count }, (_, at) => ((at + 1) % perSentence === 0 ? "w." : "w"));
  return words.join(" ");
}

describe("shiftOverflowPath", () => {
  it("names the file by the full digest of the exact bytes, under the scope's scratch", () => {
    expect(shiftOverflowPath({ home: "/h", scope: "handoff-9009", shiftState: "abc" })).toBe(
      "/h/supervisor-scratch/handoff-9009/shift-overflow-ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad.txt",
    );
  });

  it("gives two different states two different files", () => {
    const one = shiftOverflowPath({ home: "/h", scope: "sweep", shiftState: "a" });
    const two = shiftOverflowPath({ home: "/h", scope: "sweep", shiftState: "a " });
    expect(one === two).toBe(false);
  });
});

describe("fitShiftOverflow", () => {
  it("keeps the longest run of whole sentences that leaves room for the pointer", () => {
    const budget = 20 + POINTER_WORDS;
    // sentences of 6 words: three fit in 20, the fourth would make 24
    const fit = fitShiftOverflow({
      budgetWords: budget,
      overflowPath: PATH,
      shiftState: sentences({ count: 30, perSentence: 6 }),
    })!;
    expect(fit.overflowWords).toBe(12);
    expect(fit.shiftLine).toBe(
      `${sentences({ count: 18, perSentence: 6 })} ${overflowPointer({ omittedWords: 12, path: PATH })}`,
    );
  });

  it("falls back to whole words when even the first sentence is too long", () => {
    const fit = fitShiftOverflow({
      budgetWords: 5 + POINTER_WORDS,
      overflowPath: PATH,
      shiftState: "a b c d e f g h.",
    })!;
    expect(fit.shiftLine).toBe(`a b c d e ${overflowPointer({ omittedWords: 3, path: PATH })}`);
    expect(fit.overflowWords).toBe(3);
  });

  it("carries the pointer alone when the budget has room for nothing else", () => {
    const fit = fitShiftOverflow({ budgetWords: POINTER_WORDS, overflowPath: PATH, shiftState: "a b c." })!;
    expect(fit.shiftLine).toBe(overflowPointer({ omittedWords: 3, path: PATH }));
  });

  it("refuses a budget the pointer by itself does not fit", () => {
    expect(fitShiftOverflow({ budgetWords: POINTER_WORDS - 1, overflowPath: PATH, shiftState: "a" })).toBe(undefined);
  });
});

describe("renderSweepPrompt with an overflow path", () => {
  const budget = shiftStateBudgetWords({ contractPath: CONTRACT });

  it("renders an over-budget state under the cap and says how much only the file holds", () => {
    const shiftState = sentences({ count: budget + 83, perSentence: 10 });
    const rendered = unwrap(renderSweepPrompt({ contractPath: CONTRACT, overflowPath: PATH, shiftState }));
    expect(rendered.overflowed).toBe(true);
    expect(rendered.words <= MAX_RENDERED_PROMPT_WORDS).toBe(true);
    const kept = Math.floor((budget - POINTER_WORDS) / 10) * 10;
    expect(rendered.overflowWords).toBe(budget + 83 - kept);
    expect(rendered.prompt).toContain(overflowPointer({ omittedWords: budget + 83 - kept, path: PATH }));
  });

  it("leaves a state within its budget untouched", () => {
    const rendered = unwrap(
      renderSweepPrompt({ contractPath: CONTRACT, overflowPath: PATH, shiftState: "ws 971 landing #231" }),
    );
    expect(rendered.overflowed).toBe(false);
    expect(rendered.overflowWords).toBe(0);
    expect(rendered.prompt).toContain("SHIFT STATE (the only per-tick half): ws 971 landing #231 Re-arm");
  });

  it("still refuses standing procedure anywhere in the state, the overflow included, and drops the budget line", () => {
    const shiftState = `${sentences({ count: budget + 40, perSentence: 10 })} then run session watch`;
    const result = renderSweepPrompt({ contractPath: CONTRACT, overflowPath: PATH, shiftState });
    expect(result.isErr()).toBe(true);
    const lines = supervisorCoreErrorLines({ error: result._unsafeUnwrapErr() });
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("session watch");
  });

  it("refuses rather than print an over-cap prompt when the pointer cannot fit", () => {
    const huge = `/h/${Array.from({ length: budget + 1 }, () => "x").join(" ")}`;
    const result = renderSweepPrompt({
      contractPath: CONTRACT,
      overflowPath: huge,
      shiftState: sentences({ count: budget + 1, perSentence: 10 }),
    });
    expect(result.isErr()).toBe(true);
    expect(supervisorCoreErrorLines({ error: result._unsafeUnwrapErr() })[1]).toContain(
      "does not fit the budget by itself",
    );
  });
});

describe("armSweepPrompt", () => {
  const budget = shiftStateBudgetWords({ contractPath: CONTRACT });

  it("names the overflow under the scope's scratch and hands back the whole state to keep", () => {
    const shiftState = sentences({ count: budget + 30, perSentence: 10 });
    const armed = unwrap(armSweepPrompt({ contractPath: CONTRACT, home: "/h", scope: "handoff-9009", shiftState }));
    const path = shiftOverflowPath({ home: "/h", scope: "handoff-9009", shiftState });
    expect(armed.overflow).toEqual({ contents: shiftState, path, words: armed.rendered.overflowWords });
    expect(armed.rendered.prompt).toContain(path);
  });

  it("carries no overflow for a state within its budget", () => {
    const armed = unwrap(armSweepPrompt({ contractPath: CONTRACT, home: "/h", scope: "sweep", shiftState: "ws 971" }));
    expect(armed.overflow).toBe(undefined);
  });
});

describe("keepShiftOverflow", () => {
  const dirs: string[] = [];
  afterEach(() => {
    dirs.splice(0).forEach((dir) => {
      rmSync(dir, { force: true, recursive: true });
    });
  });

  it("writes the exact state, creating the scratch directory, and a rerun writes the same bytes", () => {
    const home = mkdtempSync(join(tmpdir(), "overflow-"));
    dirs.push(home);
    const shiftState = "  MERGE QUEUE: #231.\n\nIN FLIGHT: ws 971.  ";
    const path = shiftOverflowPath({ home, scope: "handoff-9009", shiftState });
    expect(unwrap(keepShiftOverflow({ contents: shiftState, path }))).toBe(path);
    expect(unwrap(keepShiftOverflow({ contents: shiftState, path }))).toBe(path);
    expect(readFileSync(path, "utf8")).toBe(shiftState);
  });

  it("names the path it could not write", () => {
    const home = mkdtempSync(join(tmpdir(), "overflow-"));
    dirs.push(home);
    const blocked = join(home, "file");
    unwrap(keepShiftOverflow({ contents: "x", path: blocked }));
    const result = keepShiftOverflow({ contents: "y", path: join(blocked, "under-a-file.txt") });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()[0]).toContain(
      `cannot keep the overflowed shift state at ${join(blocked, "under-a-file.txt")}`,
    );
  });
});

describe("keepOverflowed", () => {
  const dirs: string[] = [];
  afterEach(() => {
    dirs.splice(0).forEach((dir) => {
      rmSync(dir, { force: true, recursive: true });
    });
  });

  it("writes nothing and says nothing when the shift state fit", () => {
    expect(unwrap(keepOverflowed({ overflow: undefined }))).toEqual([]);
  });

  it("keeps the overflow and names where its words now live", () => {
    const home = mkdtempSync(join(tmpdir(), "overflow-"));
    dirs.push(home);
    const path = shiftOverflowPath({ home, scope: "handoff-9009", shiftState: "IN FLIGHT: ws 971." });
    const lines = unwrap(keepOverflowed({ overflow: { contents: "IN FLIGHT: ws 971.", path, words: 4 } }));
    expect(lines).toEqual([`shift state overflowed; 4 words are only in ${path}`]);
    expect(readFileSync(path, "utf8")).toBe("IN FLIGHT: ws 971.");
  });
});
