/**
 * Blank every credential out of a window of a local file before it leaves this machine — pure, so what is
 * masked is a unit test rather than a claim.
 *
 * `./localPath.ts` refuses the places a credential is KEPT. This is the other half: a credential pasted into an
 * ordinary file (a note, a shell history, a config, a transcript) is masked where it stands, so the rest of the
 * file still reads. Two passes, because they fail in opposite directions:
 *
 * - **{@link redactWindow} masks**, with deliberately LOOSE shapes (`./credentialShapes.ts`): over-masking
 *   costs one string's fidelity, under-masking sends a secret to OpenAI.
 * - **{@link survivingSecrets} then runs the hygiene gate itself** (`../hygiene/scan.ts`) over the finished
 *   text and the caller returns NOTHING when it still finds one. The gate cannot be the masker — it reports one
 *   match per pattern per line — but it is the check that the masker kept up with it.
 *
 * ## Matched on the context, cut to the window
 *
 * Every pattern opens on a token's prefix, so a window that starts or ends INSIDE a token shows the rest of it
 * with no prefix to match — `--from` is the model's to choose, and a single line longer than the budget is cut
 * mid-token with no choice at all. So a match is found over a CONTEXT wider than the window, as a span, and
 * any span the window overlaps is masked, however little of it the window holds.
 *
 * ## Matched again with JSON's escapes undone
 *
 * A transcript quotes a config file as `\"password\": \"x\"`, where no pass sees a quote. So every pass runs
 * over the text as it stands, then over it with each level of JSON escaping undone, up to four — a tool result
 * inside a transcript row is escaped twice, a transcript quoting one three times — and each span found is mapped
 * back to the source (`./jsonEscapes.ts`). Each of those views is matched once more with its lines' numbers and
 * diff markers taken off, since a transcript stores a Read file numbered (`./linePrefixes.ts`).
 */
import { isSecretHit, scanContent } from "../hygiene/scan.js";
import { appendAll } from "../lib/arrays.js";

import { BLOCK_HEAD, TOKEN_PASSES, valuePasses } from "./credentialShapes.js";
import { unescapeJson } from "./jsonEscapes.js";
import { stripLinePrefixes } from "./linePrefixes.js";

/** One credential found in the context, by UTF-16 offset. */
interface Span {
  readonly start: number;
  readonly end: number;
  readonly label: string;
}

/** What one masking call matches with: the owner's private strings, and whether the file is source code. */
interface Matching {
  readonly denylist: readonly string[];
  readonly source: boolean;
}

/**
 * A private key's END line with no BEGIN before it: a continuation window that starts inside a key block.
 * Everything up to and including that line is key material.
 */
const KEY_TAIL = /-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/u;

/** A private key's BEGIN line, for deciding whether an END above is a tail. */
const KEY_HEAD = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/u;

/**
 * How many levels of JSON escaping are undone: a transcript row, a tool result quoted inside one, and a
 * transcript quoting a transcript — three levels leaked at two (r5 review) — with one spare.
 */
const ESCAPE_LEVELS = 4;

/** The most lines of one block scalar's body that are masked, which bounds the walk. */
const BLOCK_LINES = 200;

/** What masking one window came to. */
export interface RedactedText {
  /** The window with every match replaced by `[redacted:<label>]`. */
  readonly text: string;
  /** How many of each label were masked, in first-seen order; empty when nothing was. */
  readonly redactions: readonly { readonly label: string; readonly count: number }[];
}

/**
 * Mask every credential shape in a whole text.
 *
 * @param text the decoded text
 * @param denylist the owner's private list of secret strings, masked wherever they appear, case-insensitively
 * @param source whether the text is a source file's, which keeps a `key: value` line that reads as a type
 * @returns the masked text and a count per label
 */
export function redactCredentials({
  text,
  denylist,
  source,
}: {
  text: string;
  denylist: readonly string[];
  source: boolean;
}): RedactedText {
  return redactWindow({ context: text, denylist, end: text.length, source, start: 0 });
}

/**
 * Mask every credential in one window of a wider context, matching over the whole context so a credential the
 * window only partly holds is still found — and masked, however little of it is inside.
 *
 * @param context the window plus the text around it
 * @param start where the window opens in `context`, in UTF-16 units
 * @param end where the window closes in `context`, exclusive
 * @param denylist the owner's private list of secret strings, masked wherever they appear, case-insensitively
 * @param source whether the file is source code, which keeps a `key: value` line that reads as a type
 * @returns the window's masked text and a count per label
 */
export function redactWindow({
  context,
  start,
  end,
  denylist,
  source,
}: {
  context: string;
  start: number;
  end: number;
  denylist: readonly string[];
  source: boolean;
}): RedactedText {
  return windowRedactor({ context, denylist, source })({ end, start });
}

/**
 * {@link redactWindow} for many windows of ONE context, matching over the context once rather than once per
 * window — the page outline masks each heading's span this way, so a heading is masked exactly as a window over
 * the same bytes would be.
 *
 * @param context the whole text every window is a span of
 * @param denylist the owner's private list of secret strings, masked wherever they appear, case-insensitively
 * @param source whether the file is source code, which keeps a `key: value` line that reads as a type
 * @returns a function masking one window `[start, end)` of `context`, in UTF-16 units
 */
export function windowRedactor({
  context,
  denylist,
  source,
}: {
  context: string;
  denylist: readonly string[];
  source: boolean;
}): (window: { start: number; end: number }) => RedactedText {
  const spans = mergeSpans({ spans: escapedSpans({ matching: { denylist, source }, text: context }) });
  return ({ start, end }) => {
    const counts = new Map<string, number>();
    let text = "";
    let cursor = start;
    for (const span of spans) {
      if (span.end <= start || span.start >= end) {
        continue;
      }
      text += context.slice(cursor, Math.max(span.start, start));
      text += `[redacted:${span.label}]`;
      const seen = counts.get(span.label);
      counts.set(span.label, seen === undefined ? 1 : seen + 1);
      cursor = Math.min(span.end, end);
    }
    text += context.slice(cursor, end);
    return { redactions: [...counts].map(([label, count]) => ({ count, label })), text };
  };
}

/**
 * The hygiene gate's secret labels still present in a finished text — the fail-closed check behind the mask.
 *
 * @param text the masked text about to be returned
 * @param denylist the same private list the mask used
 * @returns every secret label the gate still finds, deduplicated; empty when the text is clean
 */
export function survivingSecrets({ text, denylist }: { text: string; denylist: readonly string[] }): readonly string[] {
  const hits = scanContent({ content: text, denylist, path: "window" }).filter((hit) =>
    isSecretHit({ label: hit.label }),
  );
  return [...new Set(hits.map((hit) => hit.label))];
}

/**
 * Every credential in a text as it stands and at each level of JSON escaping undone, each of those also with
 * its lines' number and diff prefixes taken off, in source offsets.
 */
function escapedSpans({ text, matching }: { text: string; matching: Matching }): readonly Span[] {
  const spans = [...viewSpans({ matching, text })];
  let level = text;
  let toSource: readonly number[] | undefined;
  for (let depth = 0; depth < ESCAPE_LEVELS; depth += 1) {
    const unescaped = unescapeJson({ text: level });
    if (unescaped === undefined) {
      break;
    }
    const origin = composeOrigin({ inner: unescaped.origin, outer: toSource });
    appendAll({ from: mapSpans({ origin, spans: viewSpans({ matching, text: unescaped.text }) }), into: spans });
    level = unescaped.text;
    toSource = origin;
  }
  return spans;
}

/** Every credential in one view, and in the same view with its line prefixes taken off, in the view's offsets. */
function viewSpans({ text, matching }: { text: string; matching: Matching }): readonly Span[] {
  const spans = [...credentialSpans({ matching, text })];
  const stripped = stripLinePrefixes({ text });
  if (stripped !== undefined) {
    appendAll({
      from: mapSpans({ origin: stripped.origin, spans: credentialSpans({ matching, text: stripped.text }) }),
      into: spans,
    });
  }
  return spans;
}

/** An origin map carried one view further back: `inner` into a view, `outer` from that view to the source. */
function composeOrigin({
  inner,
  outer,
}: {
  inner: readonly number[];
  outer: readonly number[] | undefined;
}): readonly number[] {
  if (outer === undefined) {
    return inner;
  }
  return inner.map((at) => outer[at]!);
}

/** Spans found in a derived view, moved to the offsets its origin map points at. */
function mapSpans({ spans, origin }: { spans: readonly Span[]; origin: readonly number[] }): readonly Span[] {
  return spans.map((span) => ({ end: origin[span.end]!, label: span.label, start: origin[span.start]! }));
}

/** Every credential in a text, unmerged: key tail, token passes, value passes, block scalars, the denylist. */
function credentialSpans({ text, matching }: { text: string; matching: Matching }): readonly Span[] {
  const spans: Span[] = [];
  const tail = keyTailEnd({ text });
  if (tail !== undefined) {
    spans.push({ end: tail, label: "private-key", start: 0 });
  }
  for (const pass of TOKEN_PASSES) {
    for (const match of text.matchAll(pass.re)) {
      spans.push({ end: match.index + match[0].length, label: pass.label, start: match.index });
    }
  }
  for (const pass of valuePasses({ source: matching.source })) {
    for (const match of text.matchAll(pass.re)) {
      const valueStart = match.index + match[1]!.length;
      spans.push({ end: valueStart + match[2]!.length, label: pass.label, start: valueStart });
    }
  }
  appendAll({ from: blockScalarSpans({ text }), into: spans });
  for (const word of matching.denylist) {
    if (word.trim().length === 0) {
      continue;
    }
    for (const match of text.matchAll(new RegExp(escapeRegExp({ text: word }), "giu"))) {
      spans.push({ end: match.index + match[0].length, label: "denylist", start: match.index });
    }
  }
  return spans;
}

/** Each secret-named block scalar's body: the lines below its key indented deeper than it, blank ones included. */
function blockScalarSpans({ text }: { text: string }): readonly Span[] {
  const spans: Span[] = [];
  for (const head of text.matchAll(BLOCK_HEAD)) {
    const bodyStart = head.index + head[0].length + 1;
    const end = blockBodyEnd({ bodyStart, indent: head[1]!.length, text });
    if (end > bodyStart) {
      spans.push({ end, label: "secret-block", start: bodyStart });
    }
  }
  return spans;
}

/** Where a block scalar's body ends: before the first non-blank line indented no deeper than its key. */
function blockBodyEnd({ text, bodyStart, indent }: { text: string; bodyStart: number; indent: number }): number {
  let cursor = bodyStart;
  let end = bodyStart;
  for (let line = 0; line < BLOCK_LINES && cursor < text.length; line += 1) {
    const newline = text.indexOf("\n", cursor);
    const stop = newline === -1 ? text.length : newline;
    const body = text.slice(cursor, stop);
    const outdented = body.trim().length > 0 && body.length - body.trimStart().length <= indent;
    if (outdented) {
      return end;
    }
    end = stop;
    cursor = stop + 1;
  }
  return end;
}

/** Overlapping spans as one, in order; the earliest-starting (then longest) span names the merged mask. */
function mergeSpans({ spans }: { spans: readonly Span[] }): readonly Span[] {
  const sorted = spans.toSorted((a, b) => a.start - b.start || b.end - a.end);
  const merged: Span[] = [];
  for (const span of sorted) {
    const last = merged.at(-1);
    if (last !== undefined && span.start < last.end) {
      merged[merged.length - 1] = { ...last, end: Math.max(last.end, span.end) };
      continue;
    }
    merged.push(span);
  }
  return merged;
}

/** Where a private key's END line with no BEGIN before it closes, or `undefined` when there is none. */
function keyTailEnd({ text }: { text: string }): number | undefined {
  const tail = KEY_TAIL.exec(text);
  if (tail === null) {
    return undefined;
  }
  const head = KEY_HEAD.exec(text);
  if (head !== null && head.index < tail.index) {
    return undefined;
  }
  return tail.index + tail[0].length;
}

/** A literal string as a pattern that matches exactly it. */
function escapeRegExp({ text }: { text: string }): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
