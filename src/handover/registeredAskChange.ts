/**
 * The three edits a refresh pass makes to a REGISTERED ask that never opened a run — re-date its still-real check,
 * restate its question, or withdraw it — as pure text transformations of the row's own file.
 *
 * ## The gap this closes
 *
 * MEASURED: three verification seats refreshing the Queue found `handover reconfirm`,
 * `handover correct` and `handover withdraw` all refused every `kind: ask` row `handover register` had written
 * with "no run is open — start it first". Those verbs append to a run journal, and a journal with no `started`
 * derives nothing from what is appended to it — while starting a run takes the card off the owner's Queue, because
 * `./registeredAsk.ts` draws an ask only while no run ever opened. So no verb could re-date, re-word or retire
 * the very cards a refresh pass exists to keep current.
 *
 * A registered ask's card is drawn from its FRONT MATTER — `summary:` is the question, `stillReal:` and
 * `stillRealIso:` the check and when it was last true — so that is where these edits go, the way `handover
 * recheck` writes a finding's. No journal is created: a journal line is the shape for a run that exists.
 *
 * ## Exactly the rows the Queue draws
 *
 * {@link registeredAskForChange} is `registeredAskOf` composed over the row's own derived state and journal, and
 * adds no condition of its own. A looser test (`kind: ask` and never started) would rewrite rows the Queue does
 * not draw — a paused one, a settled one, one the owner has since ruled on — where "still real" is not the card's claim.
 *
 * ## Why a withdrawal is `cancelled`, never a settlement
 *
 * `cancelled` is the existing "this will not be pursued" terminal, and the board places it CLOSED — NOT SHIPPED.
 * `settlement: declined` would read as the OWNER's decision (`./derivedRowState.ts`), and its verb wants the owner's witness: a
 * question whose premise dissolved without the owner is withdrawn, never answered in their name.
 *
 * Pure: text and a parsed doc in, text or a typed refusal out. No filesystem, no clock.
 */

import { err, ok, type Result } from "#lib/result.js";

import { stillRealProblems } from "./askShape.js";
import { runDisposition } from "./boardTypes.js";
import { ASK_HEADING } from "./briefPaths.js";
import { derivedRowState } from "./derivedRowState.js";
import { frontMatterFence, type HandoverDoc, parseHandoverDoc } from "./doc.js";
import { declares, editFrontMatterFields, linesOwnedByNoKey, problemsLeft } from "./frontmatter.js";
import type { RunEvent } from "./ledger.js";
import { type RegisteredAsk, registeredAskOf } from "./registeredAsk.js";
import { type RegisteredAskChangeError, RegisteredAskChangeErrors } from "./registeredAskChangeErrors.js";
import { summaryScalar } from "./summaryCap.js";

/** One edit to a registered ask, carrying everything it writes — the instant is the VERB's clock, never a caller's. */
export type RegisteredAskChange =
  | { readonly kind: "reconfirm"; readonly atIso: string; readonly stillReal: string }
  | {
      readonly kind: "correct";
      readonly atIso: string;
      readonly question: string;
      readonly why: string;
      readonly stillReal: string | undefined;
    }
  | { readonly kind: "withdraw"; readonly why: string };

/** The bullet the register's body prints the still-real check on, so a reconfirm keeps the file saying one thing. */
const STILL_REAL_BULLET = "- **Still real** — ";
const STAKES_HEADING = "## The stakes";
const RISK_BULLET = "- **Risk** — ";
const BLAST_RADIUS_BULLET = "- **Blast radius** — ";

/**
 * The registered ask a row is, when it is one these edits may touch — `registeredAskOf` over the row's own state.
 *
 * @param doc the row as it reads now
 * @param events the row's journal events, empty when it has none
 * @param unreadableLines journal lines this checkout could not decode, which make the run's state unknowable
 * @param rewritesStillReal the edit replaces the row's still-real line, so that line's own cap breaks are what it
 * repairs rather than a reason to refuse it
 * @returns the ask, or `undefined` for every row the Queue does not draw as a registered ask
 */
export function registeredAskForChange({
  doc,
  events,
  unreadableLines,
  rewritesStillReal,
}: {
  doc: HandoverDoc;
  events: readonly RunEvent[];
  unreadableLines: readonly number[];
  rewritesStillReal: boolean;
}): RegisteredAsk | undefined {
  // A malformed row keeps the run path and its refusal: the board names it malformed, never a card to edit — bar
  // the one defect the edit itself replaces.
  const repairing = repairedProblems({ rewritesStillReal, stillReal: doc.stillReal });
  if (problemsLeft({ problems: doc.problems, repairing }).length > 0) {
    return undefined;
  }
  const run = runDisposition({ events, unreadableLines });
  return registeredAskOf({ derived: derivedRowState({ doc, events }), doc, run });
}

/**
 * Whether a change replaces the row's still-real line — a reconfirm always does, a correction when it restates one.
 *
 * @param change the edit about to be written
 * @returns true when the still-real line is one the change writes
 */
export function changeRewritesStillReal({ change }: { change: RegisteredAskChange }): boolean {
  return change.kind === "reconfirm" || (change.kind === "correct" && change.stillReal !== undefined);
}

/**
 * The problems an edit repairs on the row it rewrites. MEASURED: a hand-edited 32-word `stillReal:` read
 * CONTRADICTION and blocked every push, and `handover reconfirm` — the verb that replaces that line — refused the row
 * as malformed. So an edit that rewrites the line excuses exactly the lines `stillRealProblems` builds for it, and
 * every other problem still refuses; the writer then parses the edited row and refuses one still malformed.
 */
function repairedProblems({
  rewritesStillReal,
  stillReal,
}: {
  rewritesStillReal: boolean;
  stillReal: string | undefined;
}): readonly string[] {
  if (!rewritesStillReal || stillReal === undefined) {
    return [];
  }
  return stillRealProblems({ stillReal });
}

/**
 * The row's file after one change, or why it was refused with nothing to write.
 *
 * @param change the edit and everything it writes
 * @param path the row's path, which the front-matter writer names its refusals by
 * @param previousQuestion the question the row carries now, which a correction finds in the body to replace
 * @param text the row's current bytes
 * @returns the new bytes, or the typed refusal
 */
export function registeredAskChangeText({
  change,
  path,
  previousQuestion,
  text,
}: {
  change: RegisteredAskChange;
  path: string;
  previousQuestion: string;
  text: string;
}): Result<string, RegisteredAskChangeError> {
  // Both writers below read the file LF-normalised, so a CRLF row is put back as CRLF rather than every one of its
  // lines rewritten; a row mixing the two has no single ending to restore, and is refused rather than normalised.
  const crlf = text.includes("\r\n");
  if (crlf && /(?:^|[^\r])\n/u.test(text)) {
    return err(RegisteredAskChangeErrors.mixedLineEndings());
  }
  const fence = frontMatterFence({ text });
  if (fence === undefined) {
    return err(RegisteredAskChangeErrors.noFrontMatter());
  }
  const fields = fieldsOf({ change });
  const named = fields.map((field) => field.key);
  const before = frontMatterLines({ closeIndex: fence.closeIndex, normalised: fence.normalised });
  // A comment on a line the edit replaces goes with the line, so it is refused rather than dropped.
  const commentedKey = named.find((key) => before.some((line) => inlineCommentOn({ key, line })));
  if (commentedKey !== undefined) {
    return err(RegisteredAskChangeErrors.inlineComment({ key: commentedKey }));
  }
  const previousStillReal = parseHandoverDoc({ path, text }).stillReal;
  const body = bodyAfter({ change, previousQuestion, previousStillReal, text });
  if (body.isErr()) {
    return err(body.error);
  }
  const repairing = repairedProblems({
    rewritesStillReal: changeRewritesStillReal({ change }),
    stillReal: previousStillReal,
  });
  const edited = editFrontMatterFields({ path, remove: [], repairing, set: fields, text: body.value });
  if (edited.isErr()) {
    return err(RegisteredAskChangeErrors.frontMatter({ cause: edited.error }));
  }
  if (!keepsUnnamedLines({ before, editedText: edited.value, named })) {
    return err(RegisteredAskChangeErrors.frontMatterCollateral());
  }
  // The row as the board will read it: an edit that leaves it malformed — its own still-real line past the cap —
  // would put back the CONTRADICTION it may have been run to clear, so it is refused with nothing to write.
  const editedProblems = parseHandoverDoc({ path, text: edited.value }).problems;
  if (editedProblems.length > 0) {
    return err(RegisteredAskChangeErrors.leavesMalformed({ problems: editedProblems }));
  }
  if (!crlf) {
    return ok(edited.value);
  }
  return ok(edited.value.replace(/\r?\n/gu, "\r\n"));
}

/**
 * This verb's own invariant, held independently of the writer's read-back: every front-matter line the edit does not
 * name — a comment, a blank line, another key — survives verbatim and in order.
 */
function keepsUnnamedLines({
  before,
  editedText,
  named,
}: {
  before: readonly string[];
  editedText: string;
  named: readonly string[];
}): boolean {
  const editedFence = frontMatterFence({ text: editedText });
  const after =
    editedFence === undefined
      ? []
      : frontMatterLines({ closeIndex: editedFence.closeIndex, normalised: editedFence.normalised });
  const kept = linesOwnedByNoKey({ keys: named, lines: before }).join("\n");
  return linesOwnedByNoKey({ keys: named, lines: after }).join("\n") === kept;
}

/** The lines between a front-matter block's fences. */
function frontMatterLines({ normalised, closeIndex }: { normalised: string; closeIndex: number }): readonly string[] {
  return normalised.slice(4, closeIndex).split("\n");
}

/**
 * Whether a line declares the key and carries a comment after its value. A JSON-quoted value is clean exactly when it
 * parses whole, the way `handover register` writes one; a bare value is clean when no ` #` follows it.
 */
function inlineCommentOn({ key, line }: { key: string; line: string }): boolean {
  if (!declares({ key, line })) {
    return false;
  }
  const value = line.slice(line.indexOf(":") + 1).trim();
  if (!value.startsWith('"')) {
    return value.startsWith("#") || /\s#/u.test(value);
  }
  try {
    JSON.parse(value);
    return false;
  } catch {
    return true;
  }
}

/** The front-matter keys one change writes, every string JSON-quoted exactly as `handover register` writes them. */
function fieldsOf({
  change,
}: {
  change: RegisteredAskChange;
}): readonly { readonly key: string; readonly value: string }[] {
  if (change.kind === "withdraw") {
    return [
      { key: "status", value: "cancelled" },
      { key: "statusSummary", value: JSON.stringify(`Withdrawn, not the owner's answer: ${change.why}`) },
    ];
  }
  if (change.kind === "reconfirm") {
    return stillRealFields({ atIso: change.atIso, stillReal: change.stillReal });
  }
  return [
    { key: "summary", value: summaryScalar({ summary: change.question }) },
    { key: "statusSummary", value: JSON.stringify(`Question corrected: ${change.why}`) },
    ...(change.stillReal === undefined ? [] : stillRealFields({ atIso: change.atIso, stillReal: change.stillReal })),
  ];
}

/** The two keys a re-run check writes, the line and the instant together. */
function stillRealFields({
  stillReal,
  atIso,
}: {
  stillReal: string;
  atIso: string;
}): readonly { readonly key: string; readonly value: string }[] {
  return [
    { key: "stillReal", value: JSON.stringify(stillReal) },
    { key: "stillRealIso", value: atIso },
  ];
}

/**
 * The file with its BODY brought into line with the change, the front matter untouched.
 *
 * The register writes the question twice below the fence — as the H1 and as the paragraph under `## What the owner
 * asked for` (`ASK_HEADING`) — and `briefText` reads that section as the brief a seat executes, so a correction that moved only
 * `summary:` would leave a stale brief behind a corrected card. The H1 must match exactly once, or there is no
 * telling which line is the question; the brief line is restated only where the register put it.
 */
function bodyAfter({
  change,
  previousQuestion,
  previousStillReal,
  text,
}: {
  change: RegisteredAskChange;
  previousQuestion: string;
  previousStillReal: string | undefined;
  text: string;
}): Result<string, RegisteredAskChangeError> {
  if (change.kind === "withdraw") {
    return ok(text);
  }
  const fence = frontMatterFence({ text });
  if (fence === undefined) {
    return err(RegisteredAskChangeErrors.noFrontMatter());
  }
  const { normalised, closeIndex } = fence;
  const head = normalised.slice(0, closeIndex);
  const lines = normalised.slice(closeIndex).split("\n");
  const stillReal = change.stillReal;
  const restated =
    stillReal === undefined ? lines : restateStillReal({ lines, previous: previousStillReal, stillReal });
  if (change.kind === "reconfirm") {
    return ok(`${head}${restated.join("\n")}`);
  }
  const heading = `# ${previousQuestion}`;
  const fenced = fencedLines({ lines: restated });
  const headings = restated.filter((line, index) => line === heading && !fenced[index]).length;
  if (headings !== 1) {
    return err(RegisteredAskChangeErrors.headingNotUnique({ count: headings, heading }));
  }
  // The register writes the H1 as the body's first line; one anywhere else (quoted in a code fence, say) is not it.
  // `restated` opens on the closing `---` fence, so the body starts after it.
  const fenceAt = restated.indexOf("---");
  const headingAt = restated.findIndex((line, index) => line === heading && !fenced[index]);
  if (headingAt !== restated.findIndex((line, index) => index > fenceAt && line.trim().length > 0)) {
    return err(RegisteredAskChangeErrors.headingMisplaced({ heading }));
  }
  const briefAt = briefLineAt({ from: headingAt, lines: restated });
  const corrected = restated.map((line, index) => {
    if (index === headingAt) {
      return `# ${change.question}`;
    }
    if (index === briefAt && line === previousQuestion) {
      return change.question;
    }
    return line;
  });
  return ok(`${head}${corrected.join("\n")}`);
}

/**
 * Where the register printed the brief: the first non-blank line under the one owner's-request heading
 * (`./briefPaths.ts`'s `ASK_HEADING`) after the H1, outside any code fence — the paragraph `briefText` reads. `-1` when
 * there is no such heading, more than one, or the line sits in a fence, so no other line that happens to read the same
 * is touched.
 */
function briefLineAt({ from, lines }: { from: number; lines: readonly string[] }): number {
  const fenced = fencedLines({ lines });
  const sections = lines.flatMap((line, index) =>
    index > from && !fenced[index] && line === ASK_HEADING ? [index] : [],
  );
  if (sections.length !== 1) {
    return -1;
  }
  const sectionAt = sections[0]!;
  const briefAt = lines.findIndex((line, index) => index > sectionAt && line.trim().length > 0);
  // A line opening `## ` ends the section `briefText` reads rather than belonging to it, so it is never the brief.
  const endsSection = lines[briefAt]?.startsWith("## ") === true;
  return fenced[briefAt] === true || endsSection ? -1 : briefAt;
}

/**
 * Which lines sit in a fenced code block, its opening and closing lines included — a heading or bullet quoted there
 * is an example, never the line the register wrote. CommonMark's rule: a fence opens on three or more backticks or
 * tildes, and only a line of the SAME character, at least as many and nothing after them, closes it; an unclosed
 * fence runs to the end.
 */
function fencedLines({ lines }: { lines: readonly string[] }): readonly boolean[] {
  let opener: string | undefined;
  return lines.map((line) => {
    if (opener === undefined) {
      // A backtick opener's info string may not hold a backtick, or the line is inline code, not a fence.
      opener = /^ {0,3}(`{3,}(?=[^`]*$)|~{3,})/u.exec(line)?.[1];
      return opener !== undefined;
    }
    const closer = /^ {0,3}(`{3,}|~{3,})[ \t]*$/u.exec(line)?.[1];
    if (closer !== undefined && closer[0] === opener[0] && closer.length >= opener.length) {
      opener = undefined;
    }
    return true;
  });
}

/**
 * Whether a line carries more of the list item above it — anything but a blank line or the end of the file, which is
 * all `askRowText` ever writes there. Indented and lazy continuations both count, so such an item is not the
 * register's.
 */
function continuesListItem({ line }: { line: string | undefined }): boolean {
  return line !== undefined && line.trim().length > 0;
}

/**
 * The body's still-real bullet restated — the third line of the Risk, Blast radius, Still real list directly under
 * the single `## The stakes` heading outside a code fence, exactly where and as the register wrote it (one line, no
 * continuation under it), printing the row's CURRENT check whole — or the body unchanged when that shape is not there
 * or the row carries no check. A line reading the same anywhere else (quoted in a code fence, in another list) is not
 * it.
 */
function restateStillReal({
  lines,
  previous,
  stillReal,
}: {
  lines: readonly string[];
  previous: string | undefined;
  stillReal: string;
}): readonly string[] {
  const fenced = fencedLines({ lines });
  const stakes = lines.flatMap((line, index) => (line === STAKES_HEADING && !fenced[index] ? [index] : []));
  if (previous === undefined || stakes.length !== 1) {
    return lines;
  }
  // The register writes exactly three bullets there — Risk, Blast radius, Still real — so only that shape is its.
  const listAt = lines.findIndex((line, index) => index > stakes[0]! && line.trim().length > 0);
  const registered =
    listAt !== -1 &&
    lines[listAt]!.startsWith(RISK_BULLET) &&
    lines[listAt + 1]?.startsWith(BLAST_RADIUS_BULLET) === true &&
    // Trailing whitespace is invisible in an editor, so a hand-edited bullet carrying some is still the register's.
    lines[listAt + 2]?.trimEnd() === `${STILL_REAL_BULLET}${previous}`.trimEnd() &&
    !continuesListItem({ line: lines[listAt + 3] });
  if (!registered) {
    return lines;
  }
  return lines.map((line, index) => (index === listAt + 2 ? `${STILL_REAL_BULLET}${stillReal}` : line));
}
