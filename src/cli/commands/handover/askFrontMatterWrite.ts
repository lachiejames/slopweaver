/**
 * One registered ask's front-matter edit, written inside the row's one lock (`./boardRowLock.ts`): the file is re-read
 * under the lock, the slug checked, the edit made and read back, and the result written atomically before the lock is
 * released — so a steer, priority or pause another verb wrote meanwhile is kept, never written over. Shared by
 * `handover example` (`./exampleRun.ts`) and `handover shot` (`./shotRun.ts`), whose writes differ only in the fields
 * they set and how they compare a row to what was asked for.
 */

import { readFileSync } from "node:fs";

import { writeFileAtomic } from "#lib/writeAtomic.js";

import { type HandoverDoc, parseHandoverDoc } from "../../../handover/doc.js";
import { editFrontMatterFields, frontMatterErrorLines } from "../../../handover/frontmatter.js";
import { type BoardRowLockOptions, withBoardRowLock } from "./boardRowLock.js";

/** What writing one ask's front matter did. */
export type AskFrontMatterWrite =
  | { readonly kind: "written"; readonly path: string }
  | { readonly kind: "unchanged" }
  | { readonly kind: "refused"; readonly problem: string };

/** The edit one verb makes, and how it tells a row that already says it. */
export interface AskFrontMatterEdit {
  /** Whether a parsed row already records what was asked for — asked before the edit and of its read-back. */
  readonly holds: (doc: HandoverDoc) => boolean;
  /** The front-matter lines to set. */
  readonly set: readonly { readonly key: string; readonly value: string }[];
  /** The front-matter keys to drop. */
  readonly remove: readonly string[];
}

/**
 * Re-read a registered ask's file, make one front-matter edit, read the edit back, and write it — all inside the row's
 * one lock, on the real file the lock hands over, so a board row that is a symlink stays a link.
 *
 * A row that already holds the edit answers `unchanged` before the lock is taken, exactly as these verbs always have:
 * nothing is written on that path, so it cannot lose another writer's edit, and a lock it never needed cannot refuse
 * it (a hard-linked row, a board it may read but not write). Every write is judged again under the lock.
 *
 * @param path the row's file as the board scanned it
 * @param slug the row the board composed, so a file another writer replaced is refused
 * @param edit the fields to change, and the test that the row already holds them
 * @param rowLock how the write waits when another writer holds the row
 * @returns what happened
 */
export function writeAskFrontMatter({
  path,
  slug,
  edit,
  rowLock,
}: {
  path: string;
  slug: string;
  edit: AskFrontMatterEdit;
  rowLock?: BoardRowLockOptions;
}): AskFrontMatterWrite {
  if (alreadyHolds({ edit, path, slug })) {
    return { kind: "unchanged" };
  }
  const locked = withBoardRowLock({ ...rowLock, path, write: ({ target }) => editAt({ edit, path, slug, target }) });
  if (locked.isErr()) {
    return { kind: "refused", problem: locked.error.message };
  }
  return locked.value;
}

/**
 * Whether the row, read without the lock, is still `slug` and already holds the edit — the no-write answer. A row that
 * cannot be read here is not answered here: the locked path reads it again and says what stopped it.
 *
 * @returns true only when the row is `slug` and `edit.holds` it
 */
function alreadyHolds({ path, slug, edit }: { path: string; slug: string; edit: AskFrontMatterEdit }): boolean {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return false;
  }
  const current = parseHandoverDoc({ path, text });
  return current.slug === slug && edit.holds(current);
}

/** {@link writeAskFrontMatter}'s read, judgement and write, run under the row's lock on the real file `target`. */
function editAt({
  path,
  slug,
  edit,
  target,
}: {
  path: string;
  slug: string;
  edit: AskFrontMatterEdit;
  target: string;
}): AskFrontMatterWrite {
  let text: string;
  try {
    text = readFileSync(target, "utf8");
  } catch (cause: unknown) {
    return { kind: "refused", problem: `cannot read ${path}: ${String(cause)}` };
  }
  const current = parseHandoverDoc({ path, text });
  if (current.slug !== slug) {
    return { kind: "refused", problem: `${path} now holds the row "${current.slug}" — nothing was written` };
  }
  if (edit.holds(current)) {
    return { kind: "unchanged" };
  }
  const edited = editFrontMatterFields({ path, remove: edit.remove, set: edit.set, text });
  if (edited.isErr()) {
    return { kind: "refused", problem: frontMatterErrorLines({ error: edited.error }).join("; ") };
  }
  if (!edit.holds(parseHandoverDoc({ path, text: edited.value }))) {
    return {
      kind: "refused",
      problem: "the edited front matter did not read back as what was passed — nothing written",
    };
  }
  try {
    writeFileAtomic({ contents: edited.value, path: target });
  } catch (cause: unknown) {
    return { kind: "refused", problem: `could not write ${path}: ${String(cause)}` };
  }
  return { kind: "written", path };
}
