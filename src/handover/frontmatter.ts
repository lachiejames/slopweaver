/**
 * The handover WRITE path's own safety net: default a missing `artifact:` before a doc ever reaches
 * `register-hygiene`, and refuse to touch a doc whose front-matter cannot be trusted.
 *
 * ## Why `artifact: null`, not an omission
 *
 * `register-hygiene` treats a missing `artifact:` key as a finding (see {@link ../devLint/registerHygiene.js}),
 * and a doc without one blocks every push that shares the register until someone notices — measured twice, the
 * second time on a supervisor-written doc five minutes old. `artifact: null` is the documented
 * escape: a real, non-empty scalar the flat front-matter reader accepts as "declared", so a doc that genuinely
 * has no artifact yet can say so explicitly rather than by omission. This module is what applies that default
 * mechanically, at write time, instead of leaving it to a peer to hand-patch after the fact.
 *
 * ## Why a genuinely unparseable doc is refused, never guessed at
 *
 * Splicing a line into front-matter that is already broken — a duplicate key, an unterminated fence — risks
 * writing garbage into a file whose author has not finished it, which is a worse failure than leaving the
 * missing `artifact:` unfixed. {@link parseHandoverDoc}'s `problems` list already says exactly what is wrong;
 * this module trusts it rather than re-deriving the same judgement.
 *
 * Pure: takes the doc's raw text and returns new text (or a refusal), no filesystem.
 */

import { err, ok, type Result } from "#lib/result.js";
import { frontMatterFence, frontMatterLines, parseHandoverDoc } from "./doc.js";
import { isFrontMatterComment } from "./docFlat.js";
import { isTopLevelKey, NESTED_KEYS } from "./docNested.js";
import { announcesBlock } from "./flatScalarCodec.js";
import { collateralDamage, declaredKey } from "./frontmatterDamage.js";
import { type FrontMatterError, FrontMatterErrors } from "./frontmatterErrors.js";

/** The result of defaulting a doc's `artifact:` field. */
export interface ArtifactDefaultApplied {
  readonly text: string;
  /** `false` when the doc already declared `artifact:` and nothing was touched. */
  readonly changed: boolean;
}

/**
 * Default `artifact: null` into a doc's front-matter when the key is absent, refusing rather than guessing
 * when the front-matter cannot be read cleanly.
 *
 * @param text the doc's raw text
 * @param path the doc's path, used only to build the same problems `parseHandoverDoc` would report
 * @returns the (possibly unchanged) text, or the reasons it refused to touch the doc
 */
export function ensureArtifactDefault({
  text,
  path,
}: {
  text: string;
  path: string;
}): Result<ArtifactDefaultApplied, FrontMatterError> {
  const doc = parseHandoverDoc({ path, text });
  if (doc.problems.length > 0) {
    return err(FrontMatterErrors.docMalformed({ problems: doc.problems }));
  }
  if (doc.artifact !== undefined) {
    return ok({ changed: false, text });
  }
  const fence = frontMatterFence({ text });
  if (fence === undefined) {
    return err(FrontMatterErrors.unclosed({ purpose: "add `artifact:` to" }));
  }
  const { normalised, closeIndex } = fence;
  return ok({
    changed: true,
    text: `${normalised.slice(0, closeIndex)}\nartifact: null${normalised.slice(closeIndex)}`,
  });
}

/**
 * Add front-matter keys to a doc that does not already declare them, refusing when any of them is already
 * there.
 *
 * Add-only, and the refusal is the point rather than a limitation. The flat reader in {@link ./doc.ts}
 * reports a repeated key as a PROBLEM and resolves nothing, so a splice that appended a second
 * `settlement:` would not overwrite the first — it would make the doc malformed and take the row off the
 * board entirely. That is the silent-drop class this whole register exists to end, so a caller wanting to
 * change a declared value has to say so out loud rather than discovering it later.
 *
 * @param text the doc's raw text
 * @param path the doc's path, used only to build the same problems `parseHandoverDoc` would report
 * @param fields the keys and values to add, in the order they should be written
 * @returns the new text, or the reasons it refused
 */
export function addFrontMatterFields({
  text,
  path,
  fields,
}: {
  text: string;
  path: string;
  fields: readonly { readonly key: string; readonly value: string }[];
}): Result<string, FrontMatterError> {
  const doc = parseHandoverDoc({ path, text });
  if (doc.problems.length > 0) {
    return err(FrontMatterErrors.docMalformed({ problems: doc.problems }));
  }
  const fence = frontMatterFence({ text });
  if (fence === undefined) {
    return err(FrontMatterErrors.unclosed({ purpose: "add to" }));
  }
  // Front-matter is read line by line, so a value holding a line break writes a key nobody passed — a
  // `--witness` of `w\nrepo: /x` recorded a repo no judge saw, and parsed clean. Refused.
  const broken = fields.filter((field) => /[\r\n]/u.test(field.value));
  if (broken.length > 0) {
    return err(FrontMatterErrors.lineBreak({ keys: broken.map((field) => field.key) }));
  }
  const { normalised, closeIndex } = fence;
  const declared = normalised.slice(4, closeIndex).split("\n");
  // Matched as the reader matches a key, trimmed before its colon: `repo :` IS `repo` to the reader.
  const already = fields.filter((field) => declared.some((line) => declaredKey({ line }) === field.key));
  if (already.length > 0) {
    return err(FrontMatterErrors.alreadyDeclared({ keys: already.map((field) => field.key) }));
  }
  const added = fields.map((field) => `\n${field.key}: ${field.value}`).join("");
  const next = `${normalised.slice(0, closeIndex)}${added}${normalised.slice(closeIndex)}`;
  // Read back before anyone writes it: a splice the reader would call malformed is refused, never reported done.
  const reread = parseHandoverDoc({ path, text: next });
  if (reread.problems.length > 0) {
    return err(FrontMatterErrors.docMalformed({ problems: reread.problems }));
  }
  return ok(next);
}

/**
 * Change front-matter keys in place, and drop others, refusing when the doc cannot be read cleanly.
 *
 * The sibling of {@link addFrontMatterFields} rather than a replacement for it, and the split is deliberate.
 * `addFrontMatterFields` is add-only because the fields it writes — a settlement, a ruling — are recorded
 * ONCE and a second one would be a fact quietly overwritten. `status:` is the opposite kind of field: it is
 * the one scalar on a doc whose whole job is to change, and a caller that has to hand-edit it to record a
 * pause is a caller who will get `pausedOn:` wrong, which is precisely the malformed row `./paused.ts`
 * refuses.
 *
 * Only TOP-LEVEL keys are matched — a line with no leading whitespace — so a nested `doneWhen:` entry can
 * never be mistaken for the scalar being edited. A key named in `set` that the doc does not declare is
 * appended; one named in `remove` that it does not declare is left alone, so unpausing a row that recorded
 * no `pausedSince:` is not an error.
 *
 * **A key's WRAPPED lines go with it.** `statusSummary:` is the field `handover pause` rewrites, and
 * nineteen live docs write theirs as a block scalar whose text is entirely in the indented lines below the
 * key. Replacing only the key's own line left those lines orphaned under the new value — harmless while
 * {@link ../handover/doc.ts}'s flat reader ignored them, and a silent splice of the old text onto the new
 * one the moment that reader started folding them. So a replaced or removed key takes its continuation
 * lines with it, and the value written is exactly the one the caller passed.
 *
 * **A comment never goes with a key.** A `#` line the reader calls a comment ({@link ./docFlat.ts}'s
 * `isFrontMatterComment`) is no part of any value, so it stays where it was — before this, a provenance note under
 * a replaced `status:` was deleted by `handover withdraw` and the read-back, comparing parsed fields only, passed
 * it. That read-back is `./frontmatterDamage.ts`, and it now counts comments. A blank line goes with a key only when more of its value follows.
 *
 * @param text the doc's raw text
 * @param path the doc's path, used only to build the same problems `parseHandoverDoc` would report
 * @param set the keys to write, replacing an existing line or appending a new one
 * @param remove the keys to delete, in whatever order they appear
 * @param repairing problems the doc carries that this edit exists to clear — a still-real line past its cap, which
 * `handover reconfirm` replaces — excused once each; the CALLER reads the edited doc back and refuses one still
 * malformed, since this writer cannot know what the new value was meant to fix
 * @returns the new text, or the reasons it refused
 */
export function editFrontMatterFields({
  text,
  path,
  set,
  remove,
  repairing,
}: {
  text: string;
  path: string;
  set: readonly { readonly key: string; readonly value: string }[];
  remove: readonly string[];
  repairing?: readonly string[];
}): Result<string, FrontMatterError> {
  const doc = parseHandoverDoc({ path, text });
  const unrepaired = repairing === undefined ? doc.problems : problemsLeft({ problems: doc.problems, repairing });
  if (unrepaired.length > 0) {
    return err(FrontMatterErrors.docMalformed({ problems: unrepaired }));
  }
  const fence = frontMatterFence({ text });
  if (fence === undefined) {
    return err(FrontMatterErrors.unclosed({ purpose: "edit" }));
  }
  const unreadable = editRefusal({ remove, set });
  if (unreadable !== undefined) {
    return err(unreadable);
  }
  const { normalised, closeIndex } = fence;
  const before = normalised.slice(4, closeIndex).split("\n");
  const kept = rewrittenLines({ lines: before, remove, set });
  const appended = set
    .filter((field) => !kept.some((line) => declares({ key: field.key, line })))
    .map((field) => `${field.key}: ${field.value}`);
  const edited = `---\n${[...kept, ...appended].join("\n")}${normalised.slice(closeIndex)}`;
  const damage = collateralDamage({
    after: frontMatterLines({ text: edited }),
    before,
    remove,
    set,
    slug: doc.slug,
  });
  return damage.length > 0 ? err(FrontMatterErrors.editWouldDamage({ damage })) : ok(edited);
}

/**
 * A doc's problems with each repaired one consumed once — a multiset difference, so a problem the doc reports twice
 * is excused only as often as it is named, and an exact string match, so nothing it was not told about goes.
 *
 * @param problems the doc's problems as `parseHandoverDoc` reports them
 * @param repairing the problems an edit exists to clear
 * @returns the problems the edit does not clear, in their original order
 */
export function problemsLeft({
  problems,
  repairing,
}: {
  problems: readonly string[];
  repairing: readonly string[];
}): readonly string[] {
  const remaining = [...problems];
  for (const repaired of repairing) {
    const at = remaining.indexOf(repaired);
    if (at !== -1) {
      remaining.splice(at, 1);
    }
  }
  return remaining;
}

/**
 * Why the edit asked for cannot be read back as exactly what was asked, or `undefined` when it can.
 *
 * The read-back never judges an ASKED key, so an ask the reader would read differently is refused here instead. A
 * key that is no bare name — `status ` — is matched as a pattern and rewrote a line spelled `status   :`.
 * A key named both to write and to delete has no one meaning, and would be removed and then appended again.
 * A key named twice to write would have its first value written and its second dropped. A line break in a flat value writes a line nobody passed — `new\n---` closes the front matter early and reads back
 * as `new` — and a lone `>`/`|` announces lines this write never writes, so a comment kept below it
 * would become the value. A nested key's value is many lines by design, and `./docNested.ts`'s reader owns it
 * — but each line past its first must be indented, because one at column 0 is a key or a fence of its own, and
 * `\n---` or `\nstatus: hijacked` would hide or overwrite a flat key written beside it.
 *
 * @param set the keys the edit was asked to write
 * @param remove the keys the edit was asked to delete
 * @returns the refusal, or `undefined`
 */
function editRefusal({
  set,
  remove,
}: {
  set: readonly { readonly key: string; readonly value: string }[];
  remove: readonly string[];
}): FrontMatterError | undefined {
  const unnamed = [...set.map((field) => field.key), ...remove].filter((key) => !/^[A-Za-z_][\w-]*$/u.test(key));
  if (unnamed.length > 0) {
    return FrontMatterErrors.keyNotAName({ keys: unnamed });
  }
  const both = set.filter((field) => remove.includes(field.key));
  if (both.length > 0) {
    return FrontMatterErrors.setAndRemove({ keys: both.map((field) => field.key) });
  }
  const twice = set.filter((field, index) => set.findIndex((other) => other.key === field.key) !== index);
  if (twice.length > 0) {
    return FrontMatterErrors.setTwice({ keys: [...new Set(twice.map((field) => field.key))] });
  }
  const flat = set.filter((field) => !NESTED_KEYS.some((nested) => nested === field.key));
  const broken = flat.filter((field) => /[\r\n]/u.test(field.value));
  if (broken.length > 0) {
    return FrontMatterErrors.lineBreak({ keys: broken.map((field) => field.key) });
  }
  const announcing = flat.filter((field) => announcesBlock({ own: field.value.trim() }));
  if (announcing.length > 0) {
    return FrontMatterErrors.blockIndicator({ keys: announcing.map((field) => field.key) });
  }
  const leaving = set.filter((field) => !flat.includes(field) && leavesItsKey({ value: field.value }));
  if (leaving.length > 0) {
    return FrontMatterErrors.nestedLineUnindented({ keys: leaving.map((field) => field.key) });
  }
  return undefined;
}

/**
 * Whether a nested value carries a line, past its first, that the reader would read as no longer part of it — any
 * line at column 0, which is a key, a comment or a closing fence rather than more of this value.
 */
function leavesItsKey({ value }: { value: string }): boolean {
  return value
    .split(/\r?\n/u)
    .slice(1)
    .some((line) => line.trim().length > 0 && !/^\s/u.test(line));
}

/**
 * Whether a front-matter line declares the given top-level key — whitespace before the colon included, the same
 * spelling the doc parser accepts, so a caller auditing an edit agrees with the writer about which line it replaced.
 *
 * @returns true when the line is that key's declaration
 */
export function declares({ line, key }: { line: string; key: string }): boolean {
  return new RegExp(`^${key}\\s*:`).test(line);
}

/**
 * The front-matter lines that belong to none of the keys — each key's declaration, and every value line under it,
 * dropped by the same grouping the writer edits by, so an audit of an edit never disagrees with the writer about
 * which lines a key owned (a spaced key, a folded value's continuation, a blank line inside it).
 *
 * @param lines the front-matter's lines, between the fences
 * @param keys the top-level keys whose declarations and values are left out
 * @returns the remaining lines, in their original order
 */
export function linesOwnedByNoKey({
  keys,
  lines,
}: {
  keys: readonly string[];
  lines: readonly string[];
}): readonly string[] {
  return rewrittenLines({ lines, remove: keys, set: [] });
}

/**
 * The front-matter's own lines with the replacements applied and the removals gone, continuations included.
 *
 * A key's VALUE lines are part of it, so they follow it: kept when the key was kept, rewritten away when the key
 * was replaced, deleted when it was removed. A key is never both: `editRefusal` refuses that before this runs.
 *
 * A comment is no key's value, by the reader's own rule ({@link isFrontMatterComment}), so it is always kept, and
 * the key above stays open across it exactly as the reader keeps it open. A blank line under a dropped key is held
 * until the next line says what it was: more of that key's value takes it with the value, anything else — a
 * comment, a key, the closing fence — proves it was a separator, and it is kept.
 *
 * @param lines the front-matter's lines, between the fences
 * @returns the rewritten lines, in their original order
 */
function rewrittenLines({
  lines,
  set,
  remove,
}: {
  lines: readonly string[];
  set: readonly { readonly key: string; readonly value: string }[];
  remove: readonly string[];
}): readonly string[] {
  const kept: string[] = [];
  let key = { block: false, dropping: false };
  let held: string[] = [];
  for (const line of lines) {
    if (isTopLevelKey({ line })) {
      const next = keyLine({ line, remove, set });
      kept.push(...held, ...next.written);
      held = [];
      key = next;
    } else if (isFrontMatterComment({ block: key.block, line })) {
      kept.push(...held, line);
      held = [];
    } else if (!key.dropping) {
      kept.push(line);
    } else {
      // A blank line waits on what follows; more of the dropped key's value goes, blank lines inside it included.
      held = line.trim().length === 0 ? [...held, line] : [];
    }
  }
  return [...kept, ...held];
}

/**
 * What one top-level key line becomes: the line itself, its replacement, or nothing — and whether the value lines
 * under it go too.
 *
 * `block` describes the key as WRITTEN, never its replacement, because the lines below it are still the original's.
 *
 * @param line a front-matter line that declares a top-level key
 * @returns the lines to write in its place, whether its value lines are dropped, and whether it announced a block
 */
function keyLine({
  line,
  set,
  remove,
}: {
  line: string;
  set: readonly { readonly key: string; readonly value: string }[];
  remove: readonly string[];
}): { written: readonly string[]; dropping: boolean; block: boolean } {
  const block = announcesBlock({ own: line.slice(line.indexOf(":") + 1).trim() });
  if (remove.some((key) => declares({ key, line }))) {
    return { block, dropping: true, written: [] };
  }
  const replacement = set.find((field) => declares({ key: field.key, line }));
  if (replacement === undefined) {
    return { block, dropping: false, written: [line] };
  }
  return { block, dropping: true, written: [`${replacement.key}: ${replacement.value}`] };
}

/**
 * The lines a front-matter refusal prints, one per reason — what each verb returned as its problem list
 * before the refusal was typed, so a plural refusal never reaches a reader as one joined sentence.
 *
 * @param error the refusal
 * @returns one line per reason, byte for byte
 */
export function frontMatterErrorLines({ error }: { error: FrontMatterError }): readonly string[] {
  return error.reasons;
}
