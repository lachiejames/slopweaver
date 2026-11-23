/**
 * The pure half of `slopweaver handover quote`: which rows it reads, what each one needs, and the text it writes.
 *
 * **Every row an anchor puts in scope, not only the open ones.** A queue card for an autonomy act inherits the
 * source of the row its act names, and an act is work already DONE, so the row it names is often a settled one.
 * A backfill scoped to open rows left exactly those cards refused.
 *
 * **Every group is re-read, not only the missing ones.** The words are a cache of a record that can grow — a call
 * segment replaced by a later snapshot, a card landing that grew (`../../../handover/hisWords.ts`) — so a stored
 * record that no longer equals a fresh read is rewritten, an unread one is retried, and a group left behind when
 * the anchor moved off the owner's words is dropped.
 */
import { err, ok, type Result } from "#lib/result.js";

import { frontMatterLines, type HandoverDoc, parseHandoverDoc } from "../../../handover/doc.js";
import { isTopLevelKey } from "../../../handover/docNested.js";
import { addFrontMatterFields, editFrontMatterFields } from "../../../handover/frontmatter.js";
import { type FrontMatterError, FrontMatterErrors } from "../../../handover/frontmatterErrors.js";
import {
  bothSpellingsOf,
  type HisWords,
  type HisWordsRecord,
  hisWordsFields,
  OWNER_WORDS_KEYS,
  ownerWordsSchemeOf,
  sameHisWords,
} from "../../../handover/hisWords.js";
import type { HisWordsError } from "../../../handover/hisWordsErrors.js";
import { recordOfRead } from "../../../handover/hisWordsRecord.js";

/**
 * What one row needs. `current`, `still-unread` and `malformed` write nothing; every other arm writes its `record`,
 * or for `drop` removes the group.
 */
export type QuoteVerdict =
  | { readonly kind: "current" }
  | { readonly kind: "still-unread" | "malformed"; readonly why: string }
  | { readonly kind: "add" | "refresh" | "unread"; readonly record: HisWordsRecord }
  | { readonly kind: "repair"; readonly record: HisWordsRecord; readonly why: string }
  | { readonly kind: "drop"; readonly why: string };

/**
 * The rows a run reads: every one that anchors on the owner's words or carries a group — a row whose front matter does not
 * parse included, so the run names it as `malformed` rather than passing over it in silence.
 * A row declaring `anchor:` twice reads as a defective group (`hisWordsGroupOf`), so it is in scope too.
 *
 * @param docs the board scan
 * @returns the rows in scope, in board order
 */
export function quoteScope({ docs }: { docs: readonly HandoverDoc[] }): readonly HandoverDoc[] {
  return docs.filter(
    (doc) =>
      ownerWordsSchemeOf({ anchor: doc.anchor }) !== undefined ||
      doc.hisWords.kind !== "absent" ||
      doc.hisWordsSteers.length > 0,
  );
}

/** A row whose anchor names none of the owner's words: nothing to do when it stores none, else its stale group goes. */
function unanchoredVerdict({ doc }: { doc: HandoverDoc }): QuoteVerdict {
  if (doc.hisWords.kind === "absent") {
    return { kind: "current" };
  }
  let why = "the row has no anchor";
  if (doc.anchor !== undefined) {
    why = `its anchor ${doc.anchor} does not name the owner's words`;
  }
  return { kind: "drop", why };
}

/** A row that already stores what its record says now: current, or still unread with the reason. */
function unchangedVerdict({ record }: { record: HisWordsRecord }): QuoteVerdict {
  if (record.kind === "unread") {
    return { kind: "still-unread", why: record.why };
  }
  return { kind: "current" };
}

/**
 * What a row needs, given what its anchor's record says now.
 *
 * @param doc the row
 * @param read the record's words — `undefined` when the anchor does not name the owner's words, so nothing was read
 * @returns the verdict
 */
export function quoteVerdict({
  doc,
  read,
}: {
  doc: HandoverDoc;
  read: Result<HisWords, HisWordsError> | undefined;
}): QuoteVerdict {
  if (doc.problems.length > 0) {
    return { kind: "malformed", why: doc.problems.join("; ") };
  }
  const group = doc.hisWords;
  if (read === undefined || doc.anchor === undefined) {
    return unanchoredVerdict({ doc });
  }
  const record = recordOfRead({ anchor: doc.anchor, read });
  if (group.kind === "defect") {
    return { kind: "repair", record, why: group.why };
  }
  if (group.kind !== "absent" && sameHisWords({ read: record, stored: group })) {
    return unchangedVerdict({ record });
  }
  if (record.kind === "unread") {
    return { kind: "unread", record };
  }
  return { kind: group.kind === "absent" ? "add" : "refresh", record };
}

/**
 * A row's bytes as the text a rewrite may start from — refused when they are not valid UTF-8, because decoding one
 * replaces each invalid byte with U+FFFD and writing the text back would change bytes outside the group. A leading byte-order mark is kept as a character, so it is written back too.
 *
 * @param bytes the row exactly as it sits on disk
 * @returns the text, or the damage a rewrite would do
 */
export function rowText({ bytes }: { bytes: Uint8Array }): Result<string, FrontMatterError> {
  try {
    return ok(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes));
  } catch {
    return err(
      FrontMatterErrors.editWouldDamage({
        damage: ["the row is not valid UTF-8, and rewriting its quote would change the bytes that are not"],
      }),
    );
  }
}

/**
 * What rewriting the group would change OUTSIDE its own keys, so the write is refused rather than made. The front-matter editor normalises every CRLF in the file, and removing a key also removes the value
 * lines below it — which the board's reader already folds into that key, but which a hand edit may have meant as
 * something else. This verb never writes a CRLF or any line under a group key, comment or not, so a row carrying
 * one was edited by hand, and is refused whole and left for a hand to repair rather than judged line by line.
 *
 * @param text the row's text as read
 * @param keys the group's keys — the row's own, or one further steer's (`./quoteSteer.ts`)
 * @returns one sentence per line the rewrite would touch beyond the group, empty when it touches none
 */
export function damageBeyondTheGroup({ text, keys }: { text: string; keys: readonly string[] }): readonly string[] {
  if (text.includes("\r")) {
    return ["the row carries CR line endings, and rewriting its quote would change every line of it"];
  }
  const lines = frontMatterLines({ text });
  const groupKey = new RegExp(`^(?:${keys.join("|")})\\s*:`, "u");
  return lines.flatMap((line, at) => {
    const next = lines[at + 1];
    if (!groupKey.test(line) || next === undefined || isTopLevelKey({ line: next })) {
      return [];
    }
    return [
      `the line after "${line.split(":")[0]!}" is not a key of its own, so the quote was edited by hand and is left for a hand to repair`,
    ];
  });
}

/**
 * The row's text with its group replaced: every declaration of the group's keys removed — a duplicate included,
 * which a key-by-key rewrite would keep — and one canonical record added back when there is one to write.
 *
 * @param text the row's text as read
 * @param path the row's path, for the problems a refusal names
 * @param record what to store, or `undefined` to leave no group
 * @returns the new text, or why the front matter refused the edit
 */
export function textWithHisWords({
  text,
  path,
  record,
}: {
  text: string;
  path: string;
  record: HisWordsRecord | undefined;
}): Result<string, FrontMatterError> {
  const damage = damageBeyondTheGroup({ keys: bothSpellingsOf({ keys: OWNER_WORDS_KEYS }), text });
  if (damage.length > 0) {
    return err(FrontMatterErrors.editWouldDamage({ damage }));
  }
  const cleared = editFrontMatterFields({
    path,
    remove: [...bothSpellingsOf({ keys: OWNER_WORDS_KEYS })],
    set: [],
    text,
  });
  if (cleared.isErr()) {
    return err(cleared.error);
  }
  if (record === undefined) {
    return ok(cleared.value);
  }
  const written = addFrontMatterFields({ fields: hisWordsFields({ record }), path, text: cleared.value });
  if (written.isErr() || readsBack({ path, record, text: written.value })) {
    return written;
  }
  return err(
    FrontMatterErrors.editWouldDamage({
      damage: ["the quote as written would not read back as the same record, so every later run would rewrite it"],
    }),
  );
}

/**
 * Whether a written group reads back through the board's own parser as the record written — false for an anchor
 * the row's bare `anchor:` and the quoted group spell differently, such as one with trailing whitespace the bare
 * reader trims, or a NUL the flat reader must decode as part of the whole escape set.
 */
function readsBack({ text, path, record }: { text: string; path: string; record: HisWordsRecord }): boolean {
  const back = parseHandoverDoc({ path, text }).hisWords;
  return back.kind !== "absent" && back.kind !== "defect" && sameHisWords({ read: back, stored: record });
}

/** How each writing verdict reads, as a verb phrase. */
const WRITE_VERBS = {
  add: "quote",
  drop: "drop the quote",
  refresh: "refresh the quote",
  repair: "repair the quote",
  unread: "record why the owner's words would not read",
} as const;

/**
 * The line a verdict prints, past or future tense by whether the run writes.
 *
 * @param verdict the row's verdict
 * @param applied the run writes, so a write reads as done rather than proposed
 * @returns the phrase after the slug
 */
export function quoteVerdictPhrase({ verdict, applied }: { verdict: QuoteVerdict; applied: boolean }): string {
  if (verdict.kind === "current") {
    return "current";
  }
  if (verdict.kind === "still-unread") {
    return `the owner's words still do not read — ${verdict.why}`;
  }
  if (verdict.kind === "malformed") {
    return `nothing written — the board reads a problem in its front matter, so the quote cannot be written safely: ${verdict.why}`;
  }
  let why = "";
  if (verdict.kind === "repair" || verdict.kind === "drop") {
    why = ` (${verdict.why})`;
  } else if (verdict.kind === "unread" && verdict.record.kind === "unread") {
    why = ` — ${verdict.record.why}`;
  }
  const verb = WRITE_VERBS[verdict.kind];
  return applied ? `${verb}: done${why}` : `would ${verb}${why}`;
}

/**
 * The board files a run could not read that fall inside its scope: every one on a whole-board run, and on a run
 * narrowed to slugs, the file each of those slugs would be. A file the scan could not read produces no verdict at
 * all, so without this it would drop out of the run silently.
 *
 * @param unreadable the file names the board scan could not read
 * @param slugs the slugs the run was narrowed to, empty for the whole board
 * @returns the unreadable file names in scope
 */
export function unreadableInScope({
  slugs,
  unreadable,
}: {
  slugs: readonly string[];
  unreadable: readonly string[];
}): readonly string[] {
  if (slugs.length === 0) {
    return unreadable;
  }
  return unreadable.filter((name) => slugs.some((slug) => name === `${slug}.md`));
}

/** The verdicts a `--check` run passes on: nothing left to write. */
const SETTLED_VERDICTS: ReadonlySet<QuoteVerdict["kind"]> = new Set(["current", "still-unread"]);

/**
 * Whether a run failed to finish: a write or mirror failed, a row in scope could not be quoted at all, a board
 * file in scope would not read, or — under `--check` — a row still needs a write or its record would not read at all.
 * An unreadable record is not a settled absence: one torn store line can hide every quote in that store, so the
 * release check refuses it rather than counting it `still-unread`.
 *
 * @param outcomes each row's verdict and whether its write failed
 * @param unreadable the unreadable board files in scope
 * @param check the run is the release check, so any row still needing a write fails it
 * @returns true when the run must exit non-zero
 */
export function quoteRunIncomplete({
  check,
  outcomes,
  unreadable,
}: {
  check: boolean;
  outcomes: readonly {
    readonly verdict: QuoteVerdict["kind"];
    readonly writeFailed: boolean;
    readonly recordUnreadable: boolean;
  }[];
  unreadable: readonly string[];
}): boolean {
  if (unreadable.length > 0) {
    return true;
  }
  if (outcomes.some((outcome) => outcome.writeFailed || outcome.verdict === "malformed")) {
    return true;
  }
  return check && outcomes.some((outcome) => outcome.recordUnreadable || !SETTLED_VERDICTS.has(outcome.verdict));
}
