/**
 * The pure decision behind the memory write gate: given one `PreToolUse` payload's tool name, target path
 * and text, decide whether this write would put a memory into the corpus that nothing can address, and
 * render the refusal if it would.
 *
 * The rules are `../memory/writeGate.ts`'s; this module is the payload seam and the refusal text, so the
 * checker and the gate can never hold two opinions about what a malformed name is.
 *
 * ## The path predicate is the shipped one
 *
 * `../memory/hookPayload.ts#autoMemoryDirFromWritePath` already encodes the trusted
 * `~/.claude/projects/<project>/memory/<leaf>.md` envelope, lexically and without resolving symlinks, and
 * `classifyMemoryFile` already answers whether a basename is a leaf rather than an index. Both are reused
 * rather than re-derived: `../memory/corpus.ts` records that three separate opinions about what counts as
 * an index would be a real defect, and a fourth one living in a hook would be worse — it would be the copy
 * nobody runs the corpus tests against.
 *
 * ## Why this costs nothing on the calls it does not judge
 *
 * It is wired to `Edit|Write`, which is close to the highest-frequency matcher there is, and the
 * `session-subagent` register row records what a slow `PreToolUse` hook did to this machine:
 * nineteen sub-agents stuck 43 minutes on hooks, load 146 against a hold of 22. So every write that is not
 * a memory leaf is decided by a lexical path test and nothing else — no filesystem access, no corpus read,
 * no parse. `memory-write-guard-allows-an-ordinary-source-write` in the unit tests is the witness.
 */
import { basename, dirname } from "node:path";

import { ESCAPE_HATCHES } from "../hatch/registry.js";
import { hatchRefusal } from "../hatch/render.js";
import type { EscapeHatch } from "../hatch/types.js";
import { classifyMemoryFile } from "../memory/corpus.js";
import { autoMemoryDirFromWritePath } from "../memory/hookPayload.js";
import { type MemoryWriteKind, type OverlapContext, writeIntroducedDefects } from "../memory/writeGate.js";

/** This gate's own register row — the refusal text is the register's, never this module's. */
const HATCH: EscapeHatch = ESCAPE_HATCHES.find((hatch) => hatch.id === "memory-write")!; // registry-owned

/** The directory name every auto-memory corpus sits under, whichever repository it really lives in. */
const MEMORY_DIR_NAME = "memory";

/** Which payload field carries the text each tool is about to put on disk, and what that text IS. */
const WRITE_KINDS: ReadonlyMap<string, { readonly field: string; readonly kind: MemoryWriteKind }> = new Map([
  ["Write", { field: "content", kind: "whole-file" as const }],
  // An `Edit` is a patch, so the fragment is this write's INTENT — but it is not the whole question, and
  // treating it as one let a rename through (`../memory/writeGate.ts#writeIntroducedDefects`). The result is
  // reconstructed and judged whole, with the defects the file already had subtracted, so the false positive
  // `../memory/hookPayload.ts` documents avoiding is still avoided.
  ["Edit", { field: "new_string", kind: "fragment" as const }],
]);

/**
 * The basename of the auto-memory LEAF this write targets, or `null` when it targets anything else.
 *
 * An index (`MEMORY.md`, `INDEX-*.md`) returns `null` — nothing about an index is decidable from the index
 * alone, which is the same reason the `PostToolUse` path skips one.
 *
 * ## Two envelopes, and why the second one costs a `stat`
 *
 * {@link autoMemoryDirFromWritePath} answers the `~/.claude/projects/<project>/memory/<leaf>.md` shape
 * lexically, and that is the shape Claude Code's own memory writes use. It is not the only path to a corpus:
 * MEASURED on this machine, `a glob of `~/.claude/projects` paired with `ls -ld`` shows one of the three live
 * corpora is a SYMLINK into a different repository, so every leaf in it has a second, equally real spelling
 * that the lexical test rejects. A gate whose answer depends on which spelling a caller typed is not a gate.
 *
 * Resolving the write path does not close that, because the link points the other way. What identifies a
 * corpus wherever it sits is the thing `store.ts#discoverMemoryCorpora` already uses — a `MEMORY.md` beside
 * the leaf. So a path the lexical test rejects gets ONE question asked of the filesystem, and only after two
 * free ones have passed: the file is a `.md` leaf, and its parent directory is named `memory`. An ordinary
 * source write fails the first and reaches no `stat` at all, which is the property the header's § Why this
 * costs nothing records.
 *
 * @param filePath the payload's target path
 * @param userHome the current user's home directory
 * @param holdsRootIndex answers "does this directory hold a `MEMORY.md`" — the one filesystem question,
 *   injected so the decision stays testable without a mock
 * @returns the leaf's basename, or `null`
 */
export function memoryLeafTargetedByWrite({
  filePath,
  userHome,
  holdsRootIndex,
}: {
  filePath: string;
  userHome: string;
  holdsRootIndex: (args: { dir: string }) => boolean;
}): string | null {
  const leaf = basename(filePath);
  if (!leaf.endsWith(".md") || classifyMemoryFile({ file: leaf }) !== "leaf") {
    return null;
  }
  if (autoMemoryDirFromWritePath({ filePath, userHome }) !== null) {
    return leaf;
  }
  const dir = dirname(filePath);
  if (basename(dir) !== MEMORY_DIR_NAME) {
    return null;
  }
  return holdsRootIndex({ dir }) ? leaf : null;
}

/**
 * Decide one `PreToolUse` payload.
 *
 * @param toolName the payload's `tool_name`
 * @param filePath the payload's target path
 * @param text the payload's `content` (a `Write`) or `new_string` (an `Edit`)
 * @param userHome the current user's home directory
 * @param hatchOpen whether the operator already opened this gate's escape hatch for this call
 * @param holdsRootIndex answers "does this directory hold a `MEMORY.md`", asked at most once per call
 * @param priorText the leaf's current content, or `null` when there is none to read
 * @param replacedText an `Edit`'s `old_string`, or `null` for a whole-file write
 * @param replaceAll whether an `Edit` replaces every occurrence rather than the first
 * @param overlapContext reads the rest of the corpus and the canon beside it — asked only once the path is known
 *   to be a memory leaf, so an ordinary source write still pays for nothing
 * @returns the refusal message, or `undefined` to allow
 */
export function memoryWriteRefusal({
  toolName,
  filePath,
  text,
  userHome,
  hatchOpen,
  holdsRootIndex,
  priorText,
  replacedText,
  replaceAll,
  overlapContext,
}: {
  toolName: string;
  filePath: string;
  text: string;
  userHome: string;
  hatchOpen: boolean;
  holdsRootIndex: (args: { dir: string }) => boolean;
  priorText: string | null;
  replacedText: string | null;
  replaceAll: boolean;
  overlapContext: (args: { dir: string }) => OverlapContext;
}): string | undefined {
  const writeKind = WRITE_KINDS.get(toolName);
  if (hatchOpen || writeKind === undefined) {
    return undefined;
  }
  const leaf = memoryLeafTargetedByWrite({ filePath, holdsRootIndex, userHome });
  if (leaf === null) {
    return undefined;
  }
  const defects = writeIntroducedDefects({
    file: leaf,
    kind: writeKind.kind,
    overlap: overlapContext({ dir: dirname(filePath) }),
    priorText,
    replaceAll,
    replacedText,
    text,
  });
  if (defects.length === 0) {
    return undefined;
  }
  return hatchRefusal({ detail: `${leaf} — ${defects.join("; ")}`, hatch: HATCH });
}

/**
 * Which payload field a tool's text comes from, so the runner reads the right one without a second copy of
 * the mapping.
 *
 * @param toolName the payload's `tool_name`
 * @returns the `tool_input` key carrying the written text, or `undefined` for a tool this gate ignores
 */
export function memoryWriteTextField({ toolName }: { toolName: string }): string | undefined {
  return WRITE_KINDS.get(toolName)?.field;
}
