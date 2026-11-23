/**
 * A parked as-me draft's words as plain text the console voice can rewrite, and that text back into a form.
 *
 * The voice edits the draft on the card the owner has open, live, body only. The
 * voice reads and writes TEXT, so the round trip has to keep everything a reader would notice:
 *
 * - a link is `<url|label>`, a person `<@key>`, a group `<!subteam^handle>`, a broadcast `<!here>` / `<!channel>` —
 *   Slack's own markup, which the form schema already types back into runs (`../artifact/typedRuns.ts`);
 * - `` `code` `` and `*bold*` survive as those two marks; a row carrying italic, bold code or a bold link is refused
 *   rather than edited, and so is a bold tag or link in the rewrite, since neither run keeps its bold;
 * - a one-card's lines are lines, a one-list's dot points start `- ` (a sub-point `  - `, indented under its
 *   headline), and a drip is its one message's line;
 *   spacing is normalised (each line trimmed, extra blank lines dropped), and everything else is kept or refused.
 *
 * A one-card that gains dot points becomes a one-list, and a one-list that loses them a one-card, because "make that
 * a list" is an edit the owner can ask for. A drip stays a drip. `opening` and `problem` ride across unchanged: they are the
 * recording session's declarations about the top of the message, and the form schema re-checks them against the new
 * words. Pure.
 */
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type RawMarkupSpan, scanRawMarkup } from "../artifact/typedRuns.js";
import type { DripInlineRun } from "../artifact/types.js";
import { type DraftRevisionError, DraftRevisionErrors } from "./draftRevisionErrors.js";

/** The as-me form kinds a revision rewrites: the three whose words are run sequences. */
const EDITABLE_KINDS = ["one-card", "one-list", "drip"] as const;

/** A dot point as the editable text writes it, and the two spellings it reads back. */
const BULLET = /^\s*[-•]\s+/u;

/** A headline dot point's marker as the editable text writes it. */
const POINT = "- ";

/** A sub-point's marker as the editable text writes it: indented under its headline, the way a person types one. */
const SUB_POINT = "  - ";

/** A dot point written indented, which reads back as a sub-point of the headline above it. */
const INDENTED_POINT = /^\s+[-•]\s+/u;

/** A dot point's marker with nothing after it, once the line is trimmed. */
const EMPTY_BULLET = /^[-•]$/u;

/** One `` `code` `` or `*bold*` mark: non-empty, never across a line, and `*` only hugging words. */
const MARK = /`([^`\n]+)`|\*(\S(?:[^*\n]*\S)?)\*/gu;

/** A Slack link, `<url|label>`. */
const LINK = /<(https?:\/\/[^|>\s]+)\|([^>]+)>/gu;

/** A character the editable text spends on a mark, so never a literal in its words. */
const MARK_CHARACTER = /[*`]/u;

/** What a link label cannot hold and still read back as the same `<url|label>`: a mark, or the markup's own edges. */
const LINK_LABEL_RESERVED = /[*`<>|]/u;

/** What a link URL cannot hold and still read back as the same `<url|label>`. */
const LINK_URL_RESERVED = /[<>|\s]/u;

/**
 * The editable text of a stored form, or why it has none.
 *
 * @param form the row's stored form JSON
 * @returns the text, or why the row is not one a voice edit rewrites
 */
export function draftEditableText({ form }: { form: string }): Result<string, DraftRevisionError> {
  const parsed = editableForm({ form });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const value = parsed.value;
  if (value["kind"] === "drip") {
    return ok(
      sequencesOf({ value: value["messages"], key: "runs" })
        .map((runs) => runsText({ runs }))
        .join("\n\n"),
    );
  }
  if (value["kind"] === "one-card") {
    const lines = sequencesOf({ value: value["lines"], key: "runs" }).map((runs) => runsText({ runs }));
    return plainLines({ lines }).map(() => lines.join("\n"));
  }
  const lead = runsText({ runs: runsOf({ value: value["lead"] }) });
  const depths: readonly unknown[] = Array.isArray(value["depths"]) ? value["depths"] : [];
  const bullets = sequencesOf({ value: value["bullets"], key: undefined }).map(
    (runs, index) => `${depths[index] === 1 ? SUB_POINT : POINT}${runsText({ runs })}`,
  );
  const trailing = sequencesOf({ value: value["trailing"], key: undefined }).map((runs) => runsText({ runs }));
  const plain = plainLines({ lines: [lead, ...trailing] });
  if (plain.isErr()) {
    return err(plain.error);
  }
  return ok([lead, ...bullets, ...trailing].join("\n"));
}

/**
 * The form a rewrite becomes: the stored form's kind (a one-card and a one-list trading places on dot points), its
 * `opening` and `problem` kept, and the text's runs in place of the words.
 *
 * @param form the row's stored form JSON
 * @param text the rewritten words, in {@link draftEditableText}'s shape
 * @returns the new form JSON, or why the text will not make one
 */
export function revisedFormJson({ form, text }: { form: string; text: string }): Result<string, DraftRevisionError> {
  const parsed = editableForm({ form });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const value = parsed.value;
  const declared = {
    ...(value["opening"] === undefined ? {} : { opening: value["opening"] }),
    ...(value["problem"] === undefined ? {} : { problem: value["problem"] }),
  };
  const raw = text.replaceAll("\r\n", "\n").split("\n");
  const lines = raw.map((line) => line.trim());
  const refusal = rewriteRefusal({ lines });
  if (refusal !== undefined) {
    return err(refusal);
  }
  if (value["kind"] === "drip") {
    return dripFormJson({ declared, lines });
  }
  const filled = lines.filter((line) => line !== "");
  const first = filled.findIndex((line) => BULLET.test(line));
  if (first === -1) {
    const cardLines = filled.map((line) => ({ runs: textRuns({ text: line }) }));
    return ok(JSON.stringify({ kind: "one-card", lines: cardLines, ...declared }));
  }
  // Read before trimming throws it away: an indented dot point is a sub-point, index for index with `filled`.
  const indented = raw.filter((line) => line.trim() !== "").map((line) => INDENTED_POINT.test(line));
  return listFormJson({ declared, filled, first, indented });
}

/** Why trimmed rewrite lines will not make a form of any kind, or nothing when they will. */
function rewriteRefusal({ lines }: { lines: readonly string[] }): DraftRevisionError | undefined {
  if (!lines.some((line) => line !== "")) {
    return DraftRevisionErrors.noWords();
  }
  // A bare `-` is a dot point with nothing in it, which trimming would turn into a literal dash line.
  if (lines.some((line) => EMPTY_BULLET.test(line))) {
    return DraftRevisionErrors.emptyPoint();
  }
  // A tag, broadcast or link is typed into a run that keeps no bold, and the register refuses a styled link, so a bold
  // one would lose its mark unseen or hide the row: refused, never dropped.
  const boldTag = lines.find((line) =>
    boldMarks({ text: line }).some((inner) => scanRawMarkup({ text: inner }).length > 0),
  );
  if (boldTag !== undefined) {
    return DraftRevisionErrors.boldMarkup({ line: boldTag });
  }
  // Typing a tag drops any `|label` on it, and a link's empty label becomes its URL, so either is refused.
  const dropped = lines.find((line) => scanRawMarkup({ text: line }).some((span) => labelDropped({ span })));
  if (dropped !== undefined) {
    return DraftRevisionErrors.labelDropped({ line: dropped });
  }
  const stray = lines.find((line) => textRuns({ text: line }).some((run) => ownUnkeptStyle({ node: { ...run } })));
  return stray === undefined ? undefined : DraftRevisionErrors.strayMark({ line: stray });
}

/** A drip from trimmed rewrite lines: one message, one line. */
function dripFormJson({
  declared,
  lines,
}: {
  declared: Record<string, unknown>;
  lines: readonly string[];
}): Result<string, DraftRevisionError> {
  // A drip message is one line, so two lines with no blank between are refused rather than joined.
  if (lines.some((line, index) => index > 0 && line !== "" && lines[index - 1] !== "")) {
    return err(DraftRevisionErrors.dripLineBreak());
  }
  const messages = lines.filter((line) => line !== "").map((line) => ({ runs: textRuns({ text: line }) }));
  // A parked draft is ONE message (`../../cli/commands/slack/draftRecordMessage.ts`), so a second is refused here,
  // where the voice reads why, rather than at admission.
  if (messages.length > 1) {
    return err(DraftRevisionErrors.dripTwoMessages());
  }
  return ok(JSON.stringify({ kind: "drip", messages, ...declared }));
}

/**
 * A one-list from lines carrying dot points: the lines before them its lead, the lines after them its trailing, and an
 * indented dot point a sub-point. `depths` is written only when a sub-point exists, so a flat list's form is unchanged.
 */
function listFormJson({
  declared,
  filled,
  first,
  indented,
}: {
  declared: Record<string, unknown>;
  filled: readonly string[];
  first: number;
  indented: readonly boolean[];
}): Result<string, DraftRevisionError> {
  let last = first;
  while (last + 1 < filled.length && BULLET.test(filled[last + 1]!)) {
    last += 1;
  }
  const after = filled.slice(last + 1);
  if (after.some((line) => BULLET.test(line))) {
    return err(DraftRevisionErrors.pointsSplit());
  }
  if (first === 0) {
    return err(DraftRevisionErrors.listNoLead());
  }
  if (first > 1) {
    return err(DraftRevisionErrors.listLeadLines());
  }
  const lead = textRuns({ text: filled[0]! });
  const bullets = filled.slice(first, last + 1).map((line) => textRuns({ text: line.replace(BULLET, "") }));
  const trailing = after.map((line) => textRuns({ text: line }));
  const depths = indented.slice(first, last + 1).map((sub) => (sub ? 1 : 0));
  const nested = depths.includes(1) ? { depths } : {};
  return ok(JSON.stringify({ bullets, kind: "one-list", lead, trailing, ...nested, ...declared }));
}

/**
 * One line of editable text as runs: each `` `code` `` and `*bold*` mark its own styled run, the rest plain text whose
 * Slack markup the form schema types into links and mentions. A mark is matched with every link masked, so it never
 * starts or ends inside one; a bold mark holding a link is refused before this runs.
 *
 * @param text one line, no newline in it
 * @returns the runs, never empty for a line with words
 */
export function textRuns({ text }: { text: string }): readonly DripInlineRun[] {
  const masked = maskedLinks({ text });
  const runs: DripInlineRun[] = [];
  let at = 0;
  for (const match of masked.matchAll(MARK)) {
    if (match.index > at) {
      runs.push({ text: text.slice(at, match.index), type: "text" });
    }
    const inner = text.slice(match.index + 1, match.index + match[0].length - 1);
    if (match[1] === undefined) {
      runs.push({ bold: true, text: inner, type: "text" });
    } else {
      runs.push({ code: true, text: inner, type: "text" });
    }
    at = match.index + match[0].length;
  }
  if (at < text.length) {
    runs.push({ text: text.slice(at), type: "text" });
  }
  return runs;
}

/** The line with every link's markup blanked, same length, so a mark can hold a link but never cut into one. */
function maskedLinks({ text }: { text: string }): string {
  return text.replace(LINK, (link) => "\u0000".repeat(link.length));
}

/** What each bold mark in one line holds, as written. */
function boldMarks({ text }: { text: string }): readonly string[] {
  return [...maskedLinks({ text }).matchAll(MARK)]
    .filter((match) => match[1] === undefined)
    .map((match) => text.slice(match.index + 1, match.index + match[0].length - 1));
}

/** Whether typing one span drops words the voice wrote: a tag's `|label`, or a link's empty one. */
function labelDropped({ span }: { span: RawMarkupSpan }): boolean {
  if (span.kind === "url") {
    return span.raw.endsWith("|>");
  }
  return span.raw.includes("|");
}

/** Refused when a line that is not a dot point would read back as one, turning the card into a list unseen. */
function plainLines({ lines }: { lines: readonly string[] }): Result<undefined, DraftRevisionError> {
  const pointed = lines.find((line) => BULLET.test(line));
  if (pointed !== undefined) {
    return err(DraftRevisionErrors.lineReadsAsPoint({ line: pointed }));
  }
  return ok(undefined);
}

/** The stored form as a record of an editable kind, or why a revision cannot rewrite it. */
function editableForm({ form }: { form: string }): Result<Record<string, unknown>, DraftRevisionError> {
  let value: unknown;
  try {
    value = JSON.parse(form);
  } catch {
    return err(DraftRevisionErrors.formNotJson());
  }
  if (!isRecord(value) || !EDITABLE_KINDS.some((kind) => kind === value["kind"])) {
    const kind = isRecord(value) ? String(value["kind"]) : "unknown";
    return err(DraftRevisionErrors.kindNotEditable({ kind }));
  }
  if (carriesUnkeptStyle({ node: value })) {
    return err(DraftRevisionErrors.styleNotKept());
  }
  return ok(value);
}

/**
 * Whether any run under a form node carries what the editable text cannot write unambiguously: italic or bold code,
 * which have no mark, or a literal `*` or `` ` `` where a mark would read it back as one.
 * Refusing the row is what keeps a revision from changing a style silently, in either direction.
 */
function carriesUnkeptStyle({ node }: { node: unknown }): boolean {
  if (Array.isArray(node)) {
    return node.some((child: unknown) => carriesUnkeptStyle({ node: child }));
  }
  if (!isRecord(node)) {
    return false;
  }
  return ownUnkeptStyle({ node }) || Object.values(node).some((child) => carriesUnkeptStyle({ node: child }));
}

/** Whether one run is a style or a literal the editable text cannot carry. */
function ownUnkeptStyle({ node }: { node: Record<string, unknown> }): boolean {
  if (node["type"] === "link") {
    // `<url|label>` ends at the first `>` and splits at the first `|`, so neither half may hold one, and a bold link
    // has no spelling the register keeps.
    const reserved = LINK_LABEL_RESERVED.test(String(node["label"])) || LINK_URL_RESERVED.test(String(node["url"]));
    return reserved || node["bold"] === true;
  }
  if (node["type"] !== "text") {
    return false;
  }
  const code = node["code"] === true;
  const text = String(node["text"]);
  const literal = code ? text.includes("`") : MARK_CHARACTER.test(text);
  // A newline inside a run would read back as a new line, or a new drip message.
  return node["italic"] === true || (code && node["bold"] === true) || literal || text.includes("\n");
}

/** Each entry's run list: the entry itself, or its `key` field. */
function sequencesOf({
  value,
  key,
}: {
  value: unknown;
  key: string | undefined;
}): readonly (readonly Record<string, unknown>[])[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry: unknown) => runsOf({ value: key === undefined || !isRecord(entry) ? entry : entry[key] }));
}

/** A run list's records. */
function runsOf({ value }: { value: unknown }): readonly Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((run) => isRecord(run)) : [];
}

/**
 * One run sequence as editable text. Consecutive bold runs share one `*…*` mark, its edge spaces outside it, so a bold
 * span split across runs reads back as the one mark the voice wrote.
 */
function runsText({ runs }: { runs: readonly Record<string, unknown>[] }): string {
  let out = "";
  let bold = "";
  for (const run of runs) {
    if (run["bold"] === true && run["code"] !== true) {
      bold += runText({ run });
      continue;
    }
    out += boldMark({ text: bold }) + runText({ run });
    bold = "";
  }
  return out + boldMark({ text: bold });
}

/** A bold span's text in one `*…*` mark, any leading or trailing space outside it. */
function boldMark({ text }: { text: string }): string {
  const words = text.trim();
  if (words === "") {
    return text;
  }
  const start = text.indexOf(words);
  return `${text.slice(0, start)}*${words}*${text.slice(start + words.length)}`;
}

/** One run as editable text, unmarked bold: Slack's own markup for anything a reader clicks or is pinged by. */
function runText({ run }: { run: Record<string, unknown> }): string {
  const type = run["type"];
  if (type === "link") {
    return `<${String(run["url"])}|${String(run["label"])}>`;
  }
  if (type === "mention") {
    return `<@${String(run["person"])}>`;
  }
  if (type === "group") {
    return `<!subteam^${String(run["handle"])}>`;
  }
  if (type === "broadcast") {
    return `<!${String(run["range"])}>`;
  }
  const text = String(run["text"]);
  if (run["code"] === true) {
    return `\`${text}\``;
  }
  return text;
}
