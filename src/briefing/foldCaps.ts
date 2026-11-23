/**
 * The pure core of `slopweaver briefing fold-caps`: bring every composed fold in a form's narrative sections
 * back under {@link FOLD_MAX_BLOCKS} WITHOUT changing a word or the order anything is read in.
 *
 * Anything done with Python is done in TypeScript inside Slopweaver and exposed through the CLI, so this
 * replaces the supervisor chair's old Python fold script.
 *
 * ## What it deliberately does NOT port
 *
 * That script enforced three per-cell caps — a paragraph over sixty words or four sentences, a list item over
 * one sentence — and split prose to satisfy them. Those caps are gone: a fold is a fold, blocks still counted,
 * prose left alone, and `./caps.ts` records why. So this core never splits a paragraph, never splits a list item and never rewrites a
 * character. The one rule it serves is the one that still stands: at most {@link FOLD_MAX_BLOCKS} blocks in a
 * composed fold, at every level of nesting.
 *
 * ## The remedy, and where it stops
 *
 * Within a fold over the cap, each maximal run of CONSECUTIVE `para` and unordered `list` blocks becomes one
 * unordered list: a paragraph contributes one item holding its runs unchanged, a list contributes its items
 * in order. Everything else — an ordered list, whose numbering is part of what it says, a nested fold, an
 * image, a draft, a paste — keeps its own place, so the reading order is the order it was. A fold still over
 * the cap after that cannot be reshaped without changing what it means, and is reported rather than forced.
 *
 * It works on RAW JSON, exactly as `./archive.ts` does and for the same reason: the form that needs this is
 * the one the schema refuses, so validating first would refuse the remedy. Pure — no I/O.
 */
import { isRecord } from "#lib/parsers.js";

import { FOLD_MAX_BLOCKS } from "./caps.js";

/**
 * One fold the pass looked at: where it is, and how many blocks it carried before and after.
 *
 * @internal — {@link FoldCapsResult}'s own row; `../cli/commands/briefing/foldCapsRun.ts` names it to print
 *   one, and nothing else does.
 */
export interface FoldReshape {
  /** The fold's JSON path, dot-separated — `recent.0.detail`, `recent.0.detail.blocks.2.fold`. */
  readonly path: string;
  readonly before: number;
  readonly after: number;
}

/** What one pass did to a form. */
export interface FoldCapsResult {
  /** The reshaped form, every untouched field carried over as it was. */
  readonly form: unknown;
  /** Every fold that was over the cap and now is not. */
  readonly reshaped: readonly FoldReshape[];
  /** Every fold still over the cap, which the pass could not reshape without changing its meaning. */
  readonly unshapeable: readonly FoldReshape[];
}

/** The only keys a mergeable paragraph may carry — anything else would be lost when it becomes a list item. */
const PARA_KEYS: ReadonlySet<string> = new Set(["content", "kind"]);

/** The only keys a mergeable list may carry. */
const LIST_KEYS: ReadonlySet<string> = new Set(["items", "kind", "ordered"]);

/**
 * Whether every key of `block` is one the given set allows.
 *
 * @param block the block to check
 * @param allowed the keys that block kind may carry
 * @returns true when the block carries nothing else
 */
function onlyKeys({ block, allowed }: { block: Record<string, unknown>; allowed: ReadonlySet<string> }): boolean {
  return Object.keys(block).every((key) => allowed.has(key));
}

/**
 * A block this pass may fold into a neighbour: a paragraph, or an UNORDERED list, carrying nothing but its own
 * keys. A candidate with any other key stays where it is as a barrier, because rebuilding it as part of a list
 * would silently drop that key.
 *
 * @returns true when the block can be joined into a neighbouring list without losing anything
 */
function isMergeable(block: unknown): block is Record<string, unknown> {
  if (!isRecord(block)) {
    return false;
  }
  if (block["kind"] === "para") {
    return Array.isArray(block["content"]) && onlyKeys({ allowed: PARA_KEYS, block });
  }
  return (
    block["kind"] === "list" &&
    block["ordered"] === false &&
    Array.isArray(block["items"]) &&
    onlyKeys({ allowed: LIST_KEYS, block })
  );
}

/**
 * The list items one mergeable block contributes: a paragraph's runs as one item, or a list's own items.
 *
 * @param block a block {@link isMergeable} accepted
 * @returns the items it contributes to the joined list, in order
 */
function itemsOf({ block }: { block: Record<string, unknown> }): readonly unknown[] {
  if (block["kind"] === "para") {
    return [block["content"]];
  }
  const items = block["items"];
  return Array.isArray(items) ? items : [];
}

/**
 * The blocks with every maximal run of two or more consecutive mergeable blocks joined into one list.
 *
 * @param blocks one fold's blocks, in order
 * @returns the blocks with each such run replaced by a single unordered list, everything else where it was
 */
function mergeRuns({ blocks }: { blocks: readonly unknown[] }): readonly unknown[] {
  const merged: unknown[] = [];
  let run: Record<string, unknown>[] = [];
  const flush = (): void => {
    if (run.length === 1) {
      merged.push(run[0]);
    }
    if (run.length > 1) {
      merged.push({ items: run.flatMap((block) => itemsOf({ block })), kind: "list", ordered: false });
    }
    run = [];
  };
  for (const block of blocks) {
    if (isMergeable(block)) {
      run.push(block);
      continue;
    }
    flush();
    merged.push(block);
  }
  flush();
  return merged;
}

/**
 * One fold, its nested folds first, then its own level.
 *
 * @param fold the fold as raw JSON
 * @param path its JSON path, for the report
 * @param report where every reshaped and unshapeable fold is recorded
 * @returns the fold, reshaped where it was over the cap
 */
function reshapeFold({
  fold,
  path,
  report,
}: {
  fold: unknown;
  path: string;
  report: { reshaped: FoldReshape[]; unshapeable: FoldReshape[] };
}): unknown {
  if (!isRecord(fold) || !Array.isArray(fold["blocks"])) {
    return fold;
  }
  const blocks: readonly unknown[] = fold["blocks"];
  const nested = blocks.map((block, index) => {
    if (!isRecord(block) || block["kind"] !== "fold") {
      return block;
    }
    return {
      ...block,
      fold: reshapeFold({ fold: block["fold"], path: `${path}.blocks.${String(index)}.fold`, report }),
    };
  });
  if (nested.length <= FOLD_MAX_BLOCKS) {
    return { ...fold, blocks: nested };
  }
  const merged = mergeRuns({ blocks: nested });
  const entry = { after: merged.length, before: nested.length, path };
  if (merged.length > FOLD_MAX_BLOCKS) {
    report.unshapeable.push(entry);
    return { ...fold, blocks: nested };
  }
  report.reshaped.push(entry);
  return { ...fold, blocks: merged };
}

/**
 * Every note in one array with its `detail` fold reshaped.
 *
 * @param notes the notes as raw JSON
 * @param path the array's JSON path
 * @param report where every reshaped and unshapeable fold is recorded
 * @returns the notes, or the value unchanged when it is not an array
 */
function reshapeNotes({
  notes,
  path,
  report,
}: {
  notes: unknown;
  path: string;
  report: { reshaped: FoldReshape[]; unshapeable: FoldReshape[] };
}): unknown {
  if (!Array.isArray(notes)) {
    return notes;
  }
  return notes.map((note: unknown, index) => {
    if (!isRecord(note) || note["detail"] === undefined) {
      return note;
    }
    return { ...note, detail: reshapeFold({ fold: note["detail"], path: `${path}.${String(index)}.detail`, report }) };
  });
}

/**
 * Reshape every composed fold under `recent`, `earlierToday`, `history` and `alignment.detail`.
 *
 * Cards and the owner's list are left alone: a card's fold is authored and checked card by card, and that list is a
 * projection nobody here composes.
 *
 * @param form the form as parsed JSON, whatever shape it is in
 * @returns the reshaped form, what was reshaped, and what could not be
 */
export function reshapeFormFolds({ form }: { form: unknown }): FoldCapsResult {
  const report: { reshaped: FoldReshape[]; unshapeable: FoldReshape[] } = { reshaped: [], unshapeable: [] };
  if (!isRecord(form)) {
    return { form, reshaped: [], unshapeable: [] };
  }
  const next: Record<string, unknown> = { ...form };
  if (Array.isArray(form["recent"])) {
    next["recent"] = reshapeNotes({ notes: form["recent"], path: "recent", report });
  }
  const earlier = form["earlierToday"];
  if (isRecord(earlier)) {
    next["earlierToday"] = {
      ...earlier,
      notes: reshapeNotes({ notes: earlier["notes"], path: "earlierToday.notes", report }),
    };
  }
  const history = form["history"];
  if (Array.isArray(history)) {
    next["history"] = history.map((section: unknown, index) =>
      isRecord(section)
        ? {
            ...section,
            notes: reshapeNotes({ notes: section["notes"], path: `history.${String(index)}.notes`, report }),
          }
        : section,
    );
  }
  const alignment = form["alignment"];
  if (isRecord(alignment) && alignment["detail"] !== undefined) {
    next["alignment"] = {
      ...alignment,
      detail: reshapeFold({ fold: alignment["detail"], path: "alignment.detail", report }),
    };
  }
  return { form: next, reshaped: report.reshaped, unshapeable: report.unshapeable };
}
