/**
 * Read the private-word proposals one Queue card names, off the owner's own store, for that card alone
 * (`../app/api/private-term-proposals/route.ts`). The CLI writes the store (`src/hygiene/privateTermsStore.ts`), and
 * this is the console's read-only half of it: the site cannot import `src/`, so the few checks it needs are restated
 * here, narrowly.
 *
 * What it returns per proposal is the row the owner is being asked about: its class, case, pattern, meaning and
 * where it is fine, plus the answer they already gave on the card (`src/hygiene/privateTermAnswers.ts`).
 *
 * ## The row shown is the row a confirm changes
 *
 * A confirm writes the proposal's new file whole, and only while the current file is still the exact bytes the
 * proposal was decided over. So this read takes the same current file (by the same digest) and proves the new file
 * is that file with exactly one row changed: an `add` adds only the named row, a `narrow` replaces one row with the
 * named one, and a `remove` takes out one row and adds nothing. A proposal whose new file changes anything else is
 * `not-one-row` and is not drawn, so a card can never show one word while the yes lands another.
 *
 * Either file format is compared. A four-cell file carries no ids, and the edit that first touches it gives every
 * row a fresh id, so a four-cell row is compared by its class, case, pattern and source, with its meaning and
 * where-fine read as blank, which is exactly what that migration writes.
 *
 * Three things it never does, each one a leak this route exists not to have:
 * - it never returns a row's `source` cell, which records where the word came from;
 * - it never returns or logs the text of anything that failed to parse: a failure is one of the closed
 *   reasons in `./privateTermProposal.ts`;
 * - it never follows a link: the home, every directory under it and every file is checked for one, and a file is
 *   opened with `O_NOFOLLOW`, so a link planted in the store cannot point this read at another file. The directories
 *   ABOVE the home are the owner's own filesystem and are not checked (on macOS the temp root itself sits under one).
 */
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { consoleHomePaths } from "./consoleHome";
import { directoriesBelow } from "./draftMediaServe";
import type {
  PrivateTermProposalAnswerWord,
  PrivateTermProposalItem,
  PrivateTermProposalUnavailable,
} from "./privateTermProposal";

/** The largest file this read opens. The terms file and a proposal are a few KiB; anything past this is not one. */
const MAX_FILE_BYTES = 1024 * 1024;

/** The seven-cell header every edit writes. */
const HEADER_V2 = "id\tclass\tflags\tpattern\tmeaning\tallowed-where\tsource";
/** The four-cell header, which carries no ids. */
const HEADER_V1 = "class\tflags\tpattern\tsource";

const CLASSES = new Set([
  "owner-name",
  "owner-handle",
  "owner-address",
  "person",
  "organisation",
  "place",
  "health",
  "money",
  "topic",
]);
const TERM_ID = /^pt-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;

/** A file's bytes, or why they were not read: absent, a link on the way, or anything else. */
type FileRead =
  | { readonly kind: "read"; readonly bytes: Buffer }
  | { readonly kind: "absent" }
  | { readonly kind: "linked" }
  | { readonly kind: "unreadable" };

/** The proposal fields this read relies on, checked. */
interface ProposalRecord {
  readonly action: "add" | "narrow" | "remove";
  readonly termId: string;
  readonly baseSha256: string | null;
  readonly text: string;
}

/** One data row in seven-cell form, with the key it is compared by. */
interface Row {
  readonly cells: readonly string[];
  readonly key: string;
}

/** What a shown item carries beyond its proposal and answer. */
type DrawnRow = Omit<Extract<PrivateTermProposalItem, { kind: "shown" }>, "kind" | "proposalId" | "action" | "answer">;

/** Whether a path exists and is a symbolic link. A path that does not exist is not one. */
function isLink({ path }: { path: string }): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

/** Read one file under the home without following a link anywhere on its way, capped at {@link MAX_FILE_BYTES}. */
function readNoFollow({ home, path }: { home: string; path: string }): FileRead {
  // The home itself is checked as well as every directory below it: `directoriesBelow` stops short of its top,
  // and O_NOFOLLOW guards only the last component, so a linked home would otherwise be followed.
  if ([home, ...directoriesBelow({ dir: dirname(path), top: home })].some((dir) => isLink({ path: dir }))) {
    return { kind: "linked" };
  }
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    if (code === "ENOENT") {
      return { kind: "absent" };
    }
    if (code === "ELOOP") {
      return { kind: "linked" };
    }
    return { kind: "unreadable" };
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) {
      return { kind: "unreadable" };
    }
    return { bytes: readFileSync(fd), kind: "read" };
  } catch {
    return { kind: "unreadable" };
  } finally {
    closeSync(fd);
  }
}

/** Whether a parsed value is a plain object, an array excluded. */
function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** JSON parsed to a plain object, or `undefined`. */
function objectOf({ text }: { text: string }): Readonly<Record<string, unknown>> | undefined {
  try {
    const value: unknown = JSON.parse(text);
    if (isPlainObject(value)) {
      return value;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/** The proposal's fields, checked against the id it was asked for, or `undefined` for any other shape. */
function proposalOf({ text, proposalId }: { text: string; proposalId: string }): ProposalRecord | undefined {
  const record = objectOf({ text });
  if (record === undefined || record["schemaVersion"] !== 1 || record["proposalId"] !== proposalId) {
    return undefined;
  }
  const { action, baseSha256, termId, text: newText } = record;
  const actionKnown = action === "add" || action === "narrow" || action === "remove";
  const baseKnown = baseSha256 === null || (typeof baseSha256 === "string" && SHA256.test(baseSha256));
  if (
    !actionKnown ||
    !baseKnown ||
    typeof termId !== "string" ||
    !TERM_ID.test(termId) ||
    typeof newText !== "string"
  ) {
    return undefined;
  }
  return { action, baseSha256, termId, text: newText };
}

/** The non-blank, non-comment lines of a terms file, header first. */
function linesOf({ text }: { text: string }): readonly string[] {
  return text.split(/\r?\n/u).filter((line) => line.trim().length > 0 && !line.startsWith("#"));
}

/**
 * A terms file's data rows in seven-cell form, or `undefined` for any other shape. A seven-cell row is keyed by its
 * whole line, ids included; a four-cell row, which has no id, by the six cells the migration would give it.
 */
function rowsOf({ text }: { text: string }): { readonly format: 1 | 2; readonly rows: readonly Row[] } | undefined {
  const [header, ...lines] = linesOf({ text });
  if (header === HEADER_V2) {
    const rows = lines.map((line) => ({ cells: line.split("\t"), key: line }));
    return rows.every((row) => row.cells.length === 7) ? { format: 2, rows } : undefined;
  }
  if (header === HEADER_V1) {
    const split = lines.map((line) => line.split("\t"));
    if (!split.every((cells) => cells.length === 4)) {
      return undefined;
    }
    const rows = split.map(([className, flags, pattern, source]) => {
      const cells = ["", className, flags, pattern, "", "", source];
      return { cells, key: cells.slice(1).join("\t") };
    });
    return { format: 1, rows };
  }
  return undefined;
}

/** A cell read as absent when blank, as the store's own parser reads it. */
function optional({ cell }: { cell: string }): string | null {
  if (cell.trim() === "") {
    return null;
  }
  return cell;
}

/** One seven-cell row drawn without its source, or `malformed` when its cells are not a row the store writes. */
function drawn({ cells, termId }: { cells: readonly string[]; termId: string }): DrawnRow | "malformed" {
  const [, className, flags, pattern, meaning, allowedWhere] = cells;
  if (!CLASSES.has(className) || (flags !== "i" && flags !== "-") || pattern.length === 0) {
    return "malformed";
  }
  return {
    allowedWhere: optional({ cell: allowedWhere }),
    caseInsensitive: flags === "i",
    className,
    meaning: optional({ cell: meaning }),
    pattern,
    termId,
  };
}

/**
 * The current rows a new file's other rows do not account for, or `undefined` when the new file holds a row the
 * current one does not. Compared as a multiset, so a duplicated row counts twice.
 */
function leftOver({
  current,
  others,
}: {
  current: readonly Row[];
  others: readonly string[];
}): readonly Row[] | undefined {
  const remaining = [...current];
  for (const key of others) {
    const at = remaining.findIndex((row) => row.key === key);
    if (at === -1) {
      return undefined;
    }
    remaining.splice(at, 1);
  }
  return remaining;
}

/** The current file's rows, read by the digest a confirm checks, or why they cannot be. */
function currentRows({
  home,
  baseSha256,
}: {
  home: string;
  baseSha256: string | null;
}): { readonly format: 1 | 2; readonly rows: readonly Row[] } | PrivateTermProposalUnavailable {
  const current = readNoFollow({ home, path: consoleHomePaths({ home }).privateTerms });
  if (current.kind === "linked" || current.kind === "unreadable") {
    return current.kind;
  }
  if (current.kind === "absent") {
    // A confirm over no file needs a proposal decided over none, and lands into an empty list.
    return baseSha256 === null ? { format: 2, rows: [] } : "current-changed";
  }
  if (createHash("sha256").update(current.bytes).digest("hex") !== baseSha256) {
    return "current-changed";
  }
  const rows = rowsOf({ text: current.bytes.toString("utf8") });
  if (rows === undefined) {
    return "malformed";
  }
  return rows;
}

/** The row one proposal changes, proven to be its only change, or why it is not drawn. */
function changedRow({
  home,
  proposal,
}: {
  home: string;
  proposal: ProposalRecord;
}): DrawnRow | PrivateTermProposalUnavailable {
  const current = currentRows({ baseSha256: proposal.baseSha256, home });
  if (typeof current === "string") {
    return current;
  }
  const next = rowsOf({ text: proposal.text });
  if (next?.format !== 2) {
    return "malformed";
  }
  const named = next.rows.filter((row) => row.cells[0] === proposal.termId);
  // How the new file's other rows read against the current file's keys: whole lines over a seven-cell file, the
  // six non-id cells over a four-cell one.
  const others = next.rows
    .filter((row) => row.cells[0] !== proposal.termId)
    .map((row) => (current.format === 2 ? row.key : row.cells.slice(1).join("\t")));
  const gone = leftOver({ current: current.rows, others });
  if (gone === undefined) {
    return "not-one-row";
  }
  if (proposal.action === "add") {
    const fresh = current.rows.every((row) => row.cells[0] !== proposal.termId);
    if (named.length !== 1 || gone.length !== 0 || !fresh) {
      return "not-one-row";
    }
    const [added] = named;
    return drawn({ cells: added.cells, termId: proposal.termId });
  }
  // A narrow or a remove takes out exactly one current row; over a seven-cell file it is the named one.
  if (gone.length !== 1) {
    return "not-one-row";
  }
  const [removed] = gone;
  if (current.format === 2 && removed.cells[0] !== proposal.termId) {
    return "not-one-row";
  }
  if (proposal.action === "narrow") {
    if (named.length !== 1) {
      return "not-one-row";
    }
    const [narrowed] = named;
    return drawn({ cells: narrowed.cells, termId: proposal.termId });
  }
  if (named.length !== 0) {
    return "not-one-row";
  }
  return drawn({ cells: removed.cells, termId: proposal.termId });
}

/** The owner's recorded answer to one proposal, or `null` for none, or for a file that does not read as one. */
function answerOf({ home, proposalId }: { home: string; proposalId: string }): PrivateTermProposalAnswerWord {
  const path = join(consoleHomePaths({ home }).privateTermProposals, `${proposalId}.answer`);
  const read = readNoFollow({ home, path });
  if (read.kind !== "read") {
    return null;
  }
  const record = objectOf({ text: read.bytes.toString("utf8") });
  if (record === undefined || record["schemaVersion"] !== 1 || record["proposalId"] !== proposalId) {
    return null;
  }
  const answer = record["answer"];
  if (answer === "yes" || answer === "no") {
    return answer;
  }
  return null;
}

/** One proposal as the card draws it. */
function itemFor({ home, proposalId }: { home: string; proposalId: string }): PrivateTermProposalItem {
  const unavailable = ({ reason }: { reason: PrivateTermProposalUnavailable }): PrivateTermProposalItem => ({
    kind: "unavailable",
    proposalId,
    reason,
  });
  const read = readNoFollow({
    home,
    path: join(consoleHomePaths({ home }).privateTermProposals, `${proposalId}.json`),
  });
  if (read.kind === "absent") {
    return unavailable({ reason: "not-waiting" });
  }
  if (read.kind === "linked" || read.kind === "unreadable") {
    return unavailable({ reason: read.kind });
  }
  const proposal = proposalOf({ proposalId, text: read.bytes.toString("utf8") });
  if (proposal === undefined) {
    return unavailable({ reason: "malformed" });
  }
  const row = changedRow({ home, proposal });
  if (typeof row === "string") {
    return unavailable({ reason: row });
  }
  return { ...row, action: proposal.action, answer: answerOf({ home, proposalId }), kind: "shown", proposalId };
}

/**
 * Read every asked proposal, in the asked order, one item each.
 *
 * @param home the state home; the route passes the console's own, a test a throwaway one
 * @param proposalIds ids already checked whole by `./privateTermProposalIds.ts`
 * @returns one item per id: the row it asks about, or the closed reason it is not drawn
 */
export function readPrivateTermProposals({
  home,
  proposalIds,
}: {
  home: string;
  proposalIds: readonly string[];
}): readonly PrivateTermProposalItem[] {
  return proposalIds.map((proposalId) => itemFor({ home, proposalId }));
}
