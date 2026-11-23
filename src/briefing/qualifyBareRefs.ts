/**
 * The form writer's half of the bare-reference rule: once a page has passed `briefing check`, every bare
 * `#<number>` its notes carry is written into the form as `owner/repo#<number>`, naming the repository the check
 * resolved it against — so a note the check accepted once can never be refused later, when the page around it
 * changes.
 *
 * The failure it closes: about sixty bare references in notes twenty ticks old were refused at once, because an
 * unrelated row on the page newly linked a second repository and nothing named one repository for them any more.
 * Qualifying some 320 references in a seat's `form.json` by hand is the cost, and that form is meant to be written
 * by the tool alone.
 *
 * ## The check decides, the writer only copies
 *
 * Each note is rendered with the page renderer's own `renderNote` and read by the check's own
 * `resolvedGithubRefsOf`, against the passing page's context — so the repository written down is the one the
 * check resolved from the same bytes, and the writer measures no position of its own. Measuring them
 * over the form's runs fails, since a run of repeated spaces moves the nearest link:
 * the page collapses whitespace and turns every tag into a space, so two coordinate systems can never be kept
 * equal by hand.
 *
 * IDENTITY comes from the same rendering. Every reference the writer finds is fenced with the check's own span
 * marks (`spanMarked`) before the note is rendered, and the check credits one only when its own reading starts
 * and ends exactly on that fence. Nothing coarser holds: matching by text and count
 * lets a skipped alert number trade places with a resolved reference, and matching runs by text and order lets a
 * bare reference inside an auto-linked URL trade places with one outside it. The marks must also be INERT — the marked
 * note, its marks taken out, renders byte for byte as the unmarked one — or the note is left alone. A reference
 * the check did not credit stays bare, so the check still names it rather than the writer guessing.
 *
 * The unit read is ONE NOTE, never the page around it: a note outlives its neighbours, which a later sweep
 * archives, so a bare reference the page skipped only because the NOTE BEFORE it ended in "alert" is read as bare
 * the moment that note is gone. That difference is the intended reading.
 *
 * The residue, stated: the writer FINDS candidates one run at a time, so a reference the check reads only across
 * two runs — `merged: ` then a strong `2687`, or `Landed #` then `2687` — is never fenced and stays bare, for a
 * later page to name. Finding across runs means modelling how the page joins them, the second coordinate system
 * the paragraph above rules out; the canon asks a composer to write each reference whole in one run instead.
 *
 * ## What it rewrites, and what it never touches
 *
 * The notes of `recent`, `earlierToday` and every `history` section — the narrative a sweep accumulates, the only
 * part of the form carried from one page to the next. Inside each note: the headline's `text` and `strong` runs,
 * and a composed fold's summary, paragraphs, list items and nested folds, each nested fold's summary included. A
 * `code`, `link` or `anchor` run, a draft, a paste block, an image and a QUOTED note's fold (the owner's own recorded
 * words, which the check never reads either) stay byte for byte, as does a reference already spelled
 * `owner/repo#<number>`.
 *
 * A fold's summary is the one piece with a cap of its own (`FOLD_SUMMARY_MAX`). MEASURED once: 42 bare references
 * were refused at once, most in summaries opening on a bare reference that fourteen passing ticks had carried while
 * this writer left every summary alone. A summary whose qualified form would run
 * past the cap stays bare whole, so the form stays valid and a later page that cannot resolve it names it.
 * Reproduce the class with `slopweaver briefing check <page.html>` over a page whose folds carry bare summaries
 * beside a link into a second repository.
 *
 * Pure: raw JSON in, raw JSON out, the input never mutated and only changed ancestors copied.
 */
import { z } from "zod";

import { isRecord } from "#lib/parsers.js";

import { renderNote } from "../outbound/briefing/render.js";
import { FOLD_SUMMARY_MAX, foldedNoteSchema, quotedNoteSchema } from "../outbound/briefing/vocabulary.js";
import { type BareRefContext, type BareRefSpan, type RepoRef, scanBareRefs } from "../outbound/linkify/bareRefs.js";
import { type ResolvedGithubRef, resolvedGithubRefsOf } from "./bareRef.js";
import { carriesScanMark, spanMarked, withoutSpanMarks } from "./placedBareRefs.js";

/** A note as the page renders it: the section schema's own two arms. */
const NOTE_SCHEMA = z.union([quotedNoteSchema, foldedNoteSchema]);

/** The run kinds rendered as prose, which the page check scans and this writer may rewrite. */
const PROSE_KINDS: ReadonlySet<unknown> = new Set(["text", "strong"]);

/** One prose run or fold summary the writer may rewrite, and how to put a rewritten one back. */
interface TextPiece {
  readonly text: string;
  /** The longest text the form's schema accepts here; undefined for a run, which carries no cap of its own. */
  readonly maxLength: number | undefined;
  readonly replace: (args: { text: string }) => void;
}

/**
 * Every prose run of one content array, each with a setter writing into the (copied) array.
 *
 * @param content the runs, as raw JSON copied for rewriting
 * @returns the rewritable runs, in order
 */
function piecesOfContent({ content }: { content: unknown }): readonly TextPiece[] {
  if (!Array.isArray(content)) {
    return [];
  }
  return content.flatMap((run: unknown, index): TextPiece[] => {
    if (!isRecord(run) || !PROSE_KINDS.has(run["kind"]) || typeof run["text"] !== "string") {
      return [];
    }
    return [
      {
        maxLength: undefined,
        replace: ({ text }) => {
          content[index] = { ...run, text };
        },
        text: run["text"],
      },
    ];
  });
}

/**
 * Every rewritable piece of a composed fold in render order: its summary, then its paragraphs, list items and
 * nested folds.
 *
 * @param fold the fold, as raw JSON copied for rewriting
 * @returns the rewritable pieces, in order
 */
function piecesOfFold({ fold }: { fold: unknown }): readonly TextPiece[] {
  if (!isRecord(fold) || !Array.isArray(fold["blocks"])) {
    return [];
  }
  const summary: readonly TextPiece[] =
    typeof fold["summary"] === "string"
      ? [
          {
            maxLength: FOLD_SUMMARY_MAX,
            replace: ({ text }) => {
              fold["summary"] = text;
            },
            text: fold["summary"],
          },
        ]
      : [];
  return [...summary, ...piecesOfBlocks({ blocks: fold["blocks"] })];
}

/**
 * Every rewritable piece of a fold's blocks, in render order.
 *
 * @param blocks the fold's blocks, as raw JSON copied for rewriting
 * @returns the rewritable pieces, in order
 */
function piecesOfBlocks({ blocks }: { blocks: readonly unknown[] }): readonly TextPiece[] {
  return blocks.flatMap((block: unknown): readonly TextPiece[] => {
    if (!isRecord(block)) {
      return [];
    }
    if (block["kind"] === "para") {
      return piecesOfContent({ content: block["content"] });
    }
    if (block["kind"] === "list" && Array.isArray(block["items"])) {
      return block["items"].flatMap((item: unknown) => piecesOfContent({ content: item }));
    }
    return block["kind"] === "fold" ? piecesOfFold({ fold: block["fold"] }) : [];
  });
}

/**
 * Every rewritable piece of one note, in render order: the headline's runs, then a composed fold's pieces. A
 * quoted note's fold holds the owner's own recorded words, which the page check strips whole and nobody rewrites.
 *
 * @param note the note, as raw JSON or parsed data, copied for rewriting
 * @returns the rewritable pieces, in order
 */
function piecesOfNote({ note }: { note: unknown }): readonly TextPiece[] {
  if (!isRecord(note)) {
    return [];
  }
  return [
    ...piecesOfContent({ content: note["headline"] }),
    ...(note["lane"] === "quoted" ? [] : piecesOfFold({ fold: note["detail"] })),
  ];
}

/** A deep copy of a note, so the caller's form is never mutated. */
function copied({ value }: { value: unknown }): unknown {
  if (Array.isArray(value)) {
    return value.map((item: unknown) => copied({ value: item }));
  }
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copied({ value: item })]));
  }
  return value;
}

/** The bare GitHub references in one prose run, as the writer finds them. */
function bareGithubSpans({ text, context }: { text: string; context: BareRefContext }): readonly BareRefSpan[] {
  return scanBareRefs({ context, text }).filter((span) => span.kind === "githubRef" && span.owner === undefined);
}

/** One bare reference the writer found: which prose run it sits in, and where. */
interface FoundRef {
  readonly piece: number;
  readonly span: BareRefSpan;
}

/**
 * The check's reading of the note with every found reference fenced, or undefined when the note carries a scan
 * mark of its own, does not parse as a note, or renders differently once fenced.
 *
 * The fences go into the note's PARSED data, which is rendered without a second parse: they are instrumentation
 * rather than form content, and re-validating them would let a summary near {@link FOLD_SUMMARY_MAX} refuse the
 * fenced note and leave every reference in it bare. The schema transforms no text, so the parsed pieces are the
 * raw note's pieces in the same order.
 *
 * @param note the original note, as raw JSON
 * @param found every reference the writer found, its index the id its fence carries
 * @returns the check's reading, or undefined
 */
function spanMarkedReading({
  note,
  found,
  context,
}: {
  note: unknown;
  found: readonly FoundRef[];
  context: BareRefContext;
}): readonly ResolvedGithubRef[] | undefined {
  // One note is a bounded record; a scan mark already in it would be read as one of the writer's own.
  const parsed = NOTE_SCHEMA.safeParse(note);
  if (carriesScanMark({ text: JSON.stringify(note) }) || !parsed.success) {
    return undefined;
  }
  const baseline = renderNote({ note: parsed.data });
  piecesOfNote({ note: parsed.data }).forEach((piece, index) => {
    let text = piece.text;
    for (const id of [...found.keys()].toReversed()) {
      const { piece: at, span } = found[id]!;
      if (at === index) {
        const fenced = spanMarked({ index: id, text: text.slice(span.start, span.end) });
        text = `${text.slice(0, span.start)}${fenced}${text.slice(span.end)}`;
      }
    }
    piece.replace({ text });
  });
  const html = renderNote({ note: parsed.data });
  // A mark the renderer did not pass through untouched (an auto-linker stopping at one, say) means the check
  // would be reading a page that never existed.
  if (withoutSpanMarks({ html }) !== baseline) {
    return undefined;
  }
  return resolvedGithubRefsOf({ fallback: context, html });
}

/**
 * The repository the check credited to each fenced reference, keyed by the fence id the writer gave it.
 *
 * @param resolved the check's reading of the fenced note
 * @returns fence id to repository, for every reference the check resolved to exactly one
 */
function creditedRepos({ resolved }: { resolved: readonly ResolvedGithubRef[] }): ReadonlyMap<number, RepoRef> {
  const repos = new Map<number, RepoRef>();
  for (const ref of resolved) {
    if (ref.writerSpan !== undefined && ref.repo !== undefined) {
      repos.set(ref.writerSpan, ref.repo);
    }
  }
  return repos;
}

/**
 * One piece's text with every credited reference in it written as `owner/repo#N`, rewritten from the last
 * reference back so every earlier one's offsets still hold.
 *
 * @param piece the piece being rewritten
 * @param index the piece's position in the note, which a found reference names
 * @param found every reference the writer found, its index the fence id
 * @param repos the repository the check credited to each fence id
 * @returns the rewritten text, the piece's own text when nothing in it was credited
 */
function qualifiedPieceText({
  piece,
  index,
  found,
  repos,
}: {
  piece: TextPiece;
  index: number;
  found: readonly FoundRef[];
  repos: ReadonlyMap<number, RepoRef>;
}): string {
  let text = piece.text;
  for (const id of [...found.keys()].toReversed()) {
    const { piece: at, span } = found[id]!;
    const repo = repos.get(id);
    if (at === index && repo !== undefined && span.kind === "githubRef") {
      text = `${text.slice(0, span.start)}${repo.owner}/${repo.repo}#${String(span.number)}${text.slice(span.end)}`;
    }
  }
  return text;
}

/**
 * One note with every bare GitHub reference the check resolved on its rendered page written as `owner/repo#N`.
 *
 * @param note the note, as raw JSON
 * @param context the passing page's own context, which a note linking no repository resolves against
 * @returns the note unchanged when nothing qualified, else a rewritten copy
 */
function qualifiedNote({ note, context }: { note: unknown; context: BareRefContext }): unknown {
  if (!isRecord(note)) {
    return note;
  }
  const copy = Object.fromEntries(Object.entries(note).map(([key, value]) => [key, copied({ value })]));
  const pieces = piecesOfNote({ note: copy });
  const found: readonly FoundRef[] = pieces.flatMap((piece, index) =>
    bareGithubSpans({ context, text: piece.text }).map((span) => ({ piece: index, span })),
  );
  const resolved = found.length === 0 ? undefined : spanMarkedReading({ context, found, note });
  if (resolved === undefined) {
    return note;
  }
  const repos = creditedRepos({ resolved });
  let changed = false;
  for (const [index, piece] of pieces.entries()) {
    const text = qualifiedPieceText({ found, index, piece, repos });
    // A summary its references would push past the schema's cap is left bare WHOLE, never half-qualified or
    // cut: the form must stay valid, and a later page that cannot resolve it names it rather than the writer.
    const fits = piece.maxLength === undefined || text.length <= piece.maxLength;
    if (text !== piece.text && fits) {
      piece.replace({ text });
      changed = true;
    }
  }
  return changed ? copy : note;
}

/** Every note of one section, qualified; the section itself when none changed. */
function qualifiedSection({ section, context }: { section: unknown; context: BareRefContext }): unknown {
  if (!isRecord(section) || !Array.isArray(section["notes"])) {
    return section;
  }
  const original: readonly unknown[] = section["notes"];
  const notes = original.map((note) => qualifiedNote({ context, note }));
  return notes.every((note, index) => note === original[index]) ? section : { ...section, notes };
}

/**
 * The form with every bare GitHub reference its narrative carries written as `owner/repo#N`, wherever `briefing
 * check`, reading that note rendered on a page with `context`, resolves it to exactly one repository.
 *
 * Call it only on a form whose rendered page has just PASSED `briefing check`, with that page's context: that is
 * what makes the repository written down the one the check accepted. Idempotent — a qualified reference is
 * never scanned as bare again.
 *
 * @param form the form, as raw JSON
 * @param context the passing page's own context (`./bareRef.ts`'s `bareRefContextOfPage`)
 * @returns the form, with only the notes that changed copied
 */
export function qualifyBareRefsInNarrative({
  form,
  context,
}: {
  form: Readonly<Record<string, unknown>>;
  context: BareRefContext;
}): Readonly<Record<string, unknown>> {
  const out: Record<string, unknown> = { ...form };
  if (Array.isArray(form["recent"])) {
    out["recent"] = form["recent"].map((note: unknown) => qualifiedNote({ context, note }));
  }
  if (form["earlierToday"] !== undefined) {
    out["earlierToday"] = qualifiedSection({ context, section: form["earlierToday"] });
  }
  if (Array.isArray(form["history"])) {
    out["history"] = form["history"].map((section: unknown) => qualifiedSection({ context, section }));
  }
  return out;
}
