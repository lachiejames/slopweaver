import { describe, expect, it } from "vitest";
import { type CommentHygieneDefect, scanCommentHygiene } from "../../../devLint/commentHygiene.js";

/** Scan an inline fixture as if it were a source file. */
function scan({ content }: { content: string }): readonly CommentHygieneDefect[] {
  return scanCommentHygiene({ content, path: "src/fixture.ts" });
}

describe("scanCommentHygiene — the legitimate file-header shape is never flagged", () => {
  it("accepts a header separated from the first statement by a blank line", () => {
    const content = `/**
 * A file overview, read once before any code.
 */

import { readFileSync } from "node:fs";

export function readIt(): string {
  return readFileSync("x", "utf8");
}
`;
    expect(scan({ content })).toEqual([]);
  });

  it("accepts a header stacked directly above the first statement's own doc block", () => {
    // Rarer than the blank-line form (most files have imports between header and first export), but the
    // same file-header exemption applies: this is not a case of one block shadowing another.
    const content = `/**
 * A file overview.
 */
/**
 * The first export.
 *
 * @returns a constant
 */
export function first(): number {
  return 1;
}
`;
    expect(scan({ content })).toEqual([]);
  });
});

describe("scanCommentHygiene — a stack of two blocks before the SAME declaration", () => {
  it("flags the earlier block as shadowed, the real (structures.ts) shape", () => {
    // The measured shape at src/corpus/linear/structures.ts:542-543 — the identical block typed twice. Not
    // the file's first statement (a leading `const seed` stands in for the file header exemption's scope).
    const content = `
const seed = 1;

/** The org-vocabulary structure rows, each lane best-effort. */
/** The org-vocabulary structure rows, each lane best-effort. */
async function fetchVocabulary(): Promise<number> {
  return seed;
}
`;
    const flagged = scan({ content });
    expect(flagged.map((defect) => defect.kind)).toEqual(["detached-block", "duplicate-block"]);
    expect(flagged[0]!.line).toBe(4);
    expect(flagged[1]!.line).toBe(5);
    expect(flagged[1]!.detail).toContain("identical to the JSDoc block at line 4");
  });

  it("flags the earlier block as shadowed when the two blocks differ, the real (lifecycleRun.ts) shape", () => {
    // The measured shape at src/cli/commands/handover/lifecycleRun.ts:64-65 — a stale block for a deleted
    // declaration, sitting directly above the real doc for the constant that follows.
    const content = `
const seed = 1;

/** The branch commits are counted against when nothing says otherwise. */
/** Flags shared by every lifecycle verb. */
const COMMON: readonly string[] = [String(seed)];
`;
    const flagged = scan({ content });
    expect(flagged.map((defect) => defect.kind)).toEqual(["detached-block"]);
    expect(flagged[0]!.line).toBe(4);
  });
});

describe("scanCommentHygiene — a block separated from its declaration by a blank line, mid-file", () => {
  it("flags it, since only a file-header at position zero is exempt", () => {
    const content = `
import { readFileSync } from "node:fs";

/**
 * Looks like it documents the export below, but the blank line breaks the attachment.
 */

export function readIt(): string {
  return readFileSync("x", "utf8");
}
`;
    const flagged = scan({ content });
    expect(flagged.map((defect) => defect.kind)).toEqual(["detached-block"]);
    expect(flagged[0]!.line).toBe(4);
  });
});

describe("scanCommentHygiene — identical text on two DIFFERENT declarations is never a defect", () => {
  it("accepts the same one-line description repeated across unrelated declarations", () => {
    // Measured against the real tree: comparing every block against every other in the FILE flagged 18 of 19
    // hits, and all 18 were this shape — the same field name in sibling interfaces, correctly carrying the
    // identical description on purpose (`hasMore`, `warnings`, a pagination cursor). Duplicate detection is
    // scoped to one declaration's own stack for exactly this reason.
    const content = `
/** Fetch one page of results. */
function fetchPage(): number {
  return 1;
}

/** Fetch one page of results. */
function fetchOtherPage(): number {
  return 2;
}
`;
    expect(scan({ content })).toEqual([]);
  });
});

describe("scanCommentHygiene — interface members carry their own leading trivia", () => {
  it("flags a block orphaned above one member while its neighbour's own doc is untouched", () => {
    // The measured shape at src/stateHome.ts:170 — a block meant for a later field, shadowed by the block
    // that actually documents the member directly below it.
    const content = `
interface Paths {
  /**
   * Meant for a field declared further down, but shadowed here.
   */
  /**
   * Documents \`second\` correctly.
   */
  readonly second: string;
  readonly third: string;
}
`;
    const flagged = scan({ content });
    expect(flagged.map((defect) => defect.kind)).toEqual(["detached-block"]);
    expect(flagged[0]!.line).toBe(3);
  });
});

describe("scanCommentHygiene — a clean file with no stray blocks", () => {
  it("reports nothing", () => {
    const content = `
/** Adds two numbers. */
export function add({ left, right }: { left: number; right: number }): number {
  return left + right;
}

/** Subtracts two numbers. */
export function subtract({ left, right }: { left: number; right: number }): number {
  return left - right;
}
`;
    expect(scan({ content })).toEqual([]);
  });
});
