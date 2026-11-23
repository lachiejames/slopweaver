/**
 * RAW MARKUP in a plain-text run — detecting it, and converting it into the typed runs that render.
 *
 * ## The defect class
 *
 * A `text` run is LITERAL. Slack's `rich_text` does not parse anything inside one: a bare
 * `https://example.com` stays dead prose, and a `<@U0S…>` shows the reader a user id. Both were sighted
 * within a day of each other, on two different composer paths — one card typed raw mention
 * markup into a text run, and the as-me FORM lane typed URLs into text runs while `--body` (which posts a
 * plain string Slack itself parses) was fine the whole time. The vocabulary to say either properly already
 * existed: {@link LinkRun}, `MentionRun` and `BroadcastRun`.
 *
 * So this file is the CLASS fix's first half. It finds the markup, and it rewrites the run sequence so the
 * content survives as typed runs. The second half — REFUSING whatever a composer still leaves behind — is
 * `../slack/typedRunsOnly.ts`, at the wire.
 *
 * ## Why the patterns live in the platform-free layer
 *
 * `./types.ts` states that every text field here is PLAIN TEXT and that markup written into one is a
 * form-fill bug. That is a property of THIS vocabulary, not of Slack, and it is why the check belongs
 * beside the schema: GitHub, Linear and Notion all render a bare URL specially too, and each renderer
 * re-deriving "is there a link hiding in this string" is exactly the four-copies-four-bugs shape
 * `./runs.ts` already exists to prevent. The angle-bracket spellings are Slack's; they are recognised
 * here rather than converted here, and nothing in this file imports a platform.
 *
 * ## What is deliberately NOT converted
 *
 * - **A `code` run.** A URL inside a code span is meant to be read, not clicked, and linkifying it would
 *   corrupt the one span whose whole purpose is literalness. Conversion skips it and so does the refusal,
 *   which is why the two must agree on the rule and therefore share {@link convertibleRun}.
 * - **`<#C…>`.** There is no channel run in this vocabulary, so there is nothing honest to convert one INTO.
 *   It is reported as residue instead, and the caller refuses — loudly and with a path — rather than posting
 *   an id at a reader. `<!subteam^S…>` used to sit here beside it and no longer does: `GroupRun` is a
 *   real run now, so the subteam id converts through the same structure index an authored `group` run uses.
 */
import { runSequencesOf } from "./runs.js";
import type { DetailBlock, DripInlineRun, InlineRun, NoFoldInlineRun, TextSpan } from "./types.js";
import { vantaLinkIssuesOfRuns } from "./vantaLinks.js";

/** A URL scheme this file will convert. Anything else stays prose — a `foo://` is not a link a reader can follow. */
const CONVERTIBLE_SCHEMES: readonly string[] = ["http://", "https://", "mailto:"];

/**
 * Trailing characters stripped off a BARE URL before it becomes a link.
 *
 * `see https://example.com.` ends a sentence; the full stop is prose and swallowing it into the href
 * produces a link that 404s. Closing brackets are handled separately (see {@link trimBareUrl}) because
 * `https://en.wikipedia.org/wiki/Foo_(bar)` legitimately ends in one.
 */
const TRAILING_PROSE = new Set([".", ",", ";", ":", "!", "?", '"', "'"]);

/** The bracket pairs a bare URL may legitimately contain, used to decide whether a trailing closer is its own. */
const BRACKET_PAIRS: readonly (readonly [string, string])[] = [
  ["(", ")"],
  ["[", "]"],
  ["{", "}"],
];

/**
 * One piece of raw markup found in a text run.
 *
 * A discriminated union rather than one shape with optional fields: a `user` span always has an id and a
 * `broadcast` span never does, and under `exactOptionalPropertyTypes` the optional-field spelling would let
 * a consumer read a field that cannot be there.
 */
export type RawMarkupSpan =
  | { readonly kind: "url"; readonly raw: string; readonly start: number; readonly url: string; readonly label: string }
  | { readonly kind: "user"; readonly raw: string; readonly start: number; readonly slackId: string }
  | { readonly kind: "broadcast"; readonly raw: string; readonly start: number; readonly range: "here" | "channel" }
  | { readonly kind: "usergroup"; readonly raw: string; readonly start: number; readonly groupId: string }
  | { readonly kind: "channel"; readonly raw: string; readonly start: number };

/**
 * Angle markup first, then a bare URL — one alternation, so a single left-to-right pass can never produce
 * two overlapping spans and the bare-URL arm can never match inside `<…>`.
 *
 * A regex is the right tool and there is no library alternative: this is a text-pattern job on our own
 * authored prose, exactly as `../slack/dryRun.ts` already argues for its own two patterns. GLOBAL, and
 * consumed with `matchAll` so no `lastIndex` state leaks between runs.
 */
const RAW_MARKUP = /<([^<>]*)>|(?:https?:\/\/|mailto:)[^\s<>]+/g;

/** Whether a trailing closing bracket belongs to the URL (it has an unmatched opener) or to the prose around it. */
function closerIsBalanced({ url, closer }: { url: string; closer: string }): boolean {
  const pair = BRACKET_PAIRS.find(([, close]) => close === closer);
  if (pair === undefined) {
    return false;
  }
  const [open] = pair;
  const opens = url.split(open).length - 1;
  const closes = url.split(closer).length - 1;
  return opens >= closes;
}

/**
 * A bare URL with the prose punctuation that followed it given back.
 *
 * @param raw the matched run of non-space characters
 * @returns the URL alone
 */
function trimBareUrl({ raw }: { raw: string }): string {
  let url = raw;
  for (;;) {
    const last = url.slice(-1);
    if (last.length === 0) {
      return url;
    }
    if (TRAILING_PROSE.has(last)) {
      url = url.slice(0, -1);
      continue;
    }
    if (BRACKET_PAIRS.some(([, close]) => close === last) && !closerIsBalanced({ closer: last, url })) {
      url = url.slice(0, -1);
      continue;
    }
    return url;
  }
}

/** Whether a string is a URL this file is willing to hand to a `link` run — parseable, and on a scheme a reader can follow. */
function isConvertibleUrl({ url }: { url: string }): boolean {
  if (!CONVERTIBLE_SCHEMES.some((scheme) => url.toLowerCase().startsWith(scheme))) {
    return false;
  }
  return URL.canParse(url);
}

/** The `<…>` inner text, split on the optional `|label` Slack allows on every angle form. */
function splitAngle({ inner }: { inner: string }): { readonly body: string; readonly label: string | undefined } {
  const bar = inner.indexOf("|");
  return bar === -1 ? { body: inner, label: undefined } : { body: inner.slice(0, bar), label: inner.slice(bar + 1) };
}

/** Classify one `<…>` match, or reject it as ordinary prose that merely contains angle brackets. */
function angleSpan({ raw, start, inner }: { raw: string; start: number; inner: string }): RawMarkupSpan | undefined {
  const { body, label } = splitAngle({ inner });
  if (body.startsWith("@")) {
    return { kind: "user", raw, slackId: body.slice(1), start };
  }
  if (body.startsWith("#")) {
    return { kind: "channel", raw, start };
  }
  if (body === "!here" || body === "!channel") {
    return { kind: "broadcast", range: body === "!here" ? "here" : "channel", raw, start };
  }
  if (body.startsWith("!subteam^")) {
    return { groupId: body.slice("!subteam^".length), kind: "usergroup", raw, start };
  }
  if (isConvertibleUrl({ url: body })) {
    return { kind: "url", label: label === undefined || label.length === 0 ? body : label, raw, start, url: body };
  }
  return undefined;
}

/**
 * Every piece of raw markup in one string, in document order.
 *
 * @param text the literal text a reader would see if nothing converted it
 * @returns the spans found, left to right and never overlapping; empty when the text is honest prose
 */
export function scanRawMarkup({ text }: { text: string }): readonly RawMarkupSpan[] {
  const spans: RawMarkupSpan[] = [];
  for (const match of text.matchAll(RAW_MARKUP)) {
    const raw = match[0];
    const start = match.index;
    const inner = match[1];
    if (inner !== undefined) {
      const span = angleSpan({ inner, raw, start });
      if (span !== undefined) {
        spans.push(span);
      }
      continue;
    }
    const url = trimBareUrl({ raw });
    if (isConvertibleUrl({ url })) {
      spans.push({ kind: "url", label: url, raw: url, start, url });
    }
  }
  return spans;
}

/**
 * Whether a run's raw markup is this file's business at all.
 *
 * A `code` span is literal BY REQUEST, so neither the conversion nor the refusal touches it — and they
 * share this predicate rather than each spelling the rule out, because a conversion that skipped a run the
 * refusal then rejected would make a legal artifact unsendable with no way to fix it.
 *
 * @param run the run to consider
 * @returns true when the run is plain, non-code text whose markup should be typed instead
 */
export function convertibleRun(run: InlineRun): run is TextSpan {
  return run.type === "text" && run.code !== true;
}

/**
 * The typed run one convertible span becomes, or nothing when this vocabulary cannot express it.
 *
 * Typed as {@link DripInlineRun} — the union MINUS the citation chip — rather than {@link InlineRun},
 * because converting text can never produce a citation. That is what lets the as-me lane share this code
 * without a cast: the narrower return is assignable to both unions, whereas `InlineRun` would need one.
 */
function typedRunFor({ span }: { span: RawMarkupSpan }): DripInlineRun | undefined {
  switch (span.kind) {
    case "url":
      return { label: span.label, type: "link", url: span.url };
    case "user":
      // The Slack native id is an ADDRESSABLE mention key by design — see `../slack/mentionIndex.ts`'s
      // `slackIdentityKeys`. So this resolves through the same roster every authored mention does, and a
      // person the roster does not carry fails the send loudly instead of showing their id to a reader.
      return { person: span.slackId, type: "mention" };
    case "broadcast":
      return { range: span.range, type: "broadcast" };
    case "usergroup":
      // The `S…` subteam id is an ADDRESSABLE group key by design — see `../../silver/groupResolver.ts`'s
      // `lookupGroup`. So this resolves through the same structure index an authored `group` run does, and a
      // group that is disabled, empty or unknown fails the send loudly instead of showing its id to a reader.
      return { handle: span.groupId, type: "group" };
    case "channel":
      return undefined;
  }
}

/**
 * The raw-markup span kinds a lane is willing to CONVERT.
 *
 * A lane may only convert a kind it can EXPRESS. That sounds obvious and the alternative is the quiet
 * failure: the no-fold form has no `group` and no `broadcast` run, so converting a literal `<!here>` there
 * would manufacture a run the form forbids and hand it to the renderer past every check the form makes.
 * Leaving it unconverted is loud instead — it survives as residue, and `rawMarkupIssuesOfRuns` refuses the
 * send by name. Omitting a kind therefore makes a lane stricter, never more permissive.
 */
function onePersonTypedRunFor({ span }: { span: RawMarkupSpan }): NoFoldInlineRun | undefined {
  if (span.kind === "url") {
    return { label: span.label, type: "link", url: span.url };
  }
  if (span.kind === "user") {
    return { person: span.slackId, type: "mention" };
  }
  return undefined;
}

/**
 * One text run rewritten as the typed runs its markup deserves. Returns the run untouched when there is
 * nothing to do.
 *
 * Generic over WHICH typed run a span becomes, because a lane may only convert markup it can EXPRESS. That
 * sounds obvious and the alternative is the quiet failure: the no-fold form has no `group` and no
 * `broadcast` run, so converting a literal `<!here>` there would manufacture a run the form forbids and
 * hand it to the renderer past every check the form makes. {@link onePersonTypedRunFor} returns `undefined`
 * for those spans, which leaves them as raw text — loud, because `rawMarkupIssuesOfRuns` then refuses the
 * send by name at the same seam every other unconvertible span is refused at. A narrower mapping therefore
 * makes a lane stricter, never more permissive.
 *
 * @param run the text run to rewrite
 * @param typedFor which typed run a span becomes, or `undefined` to leave it as literal text
 * @returns the run's typed pieces in order, or `[run]` when it carries no convertible markup
 */
function typeRawMarkupInRun<Run extends DripInlineRun>({
  run,
  typedFor,
}: {
  run: TextSpan;
  typedFor: ({ span }: { span: RawMarkupSpan }) => Run | undefined;
}): readonly (Run | TextSpan)[] {
  const spans = scanRawMarkup({ text: run.text });
  if (spans.length === 0) {
    return [run];
  }
  const out: (Run | TextSpan)[] = [];
  let cursor = 0;
  const keepText = ({ end }: { end: number }): void => {
    const slice = run.text.slice(cursor, end);
    if (slice.length > 0) {
      out.push({ ...run, text: slice });
    }
  };
  for (const span of spans) {
    const typed = typedFor({ span });
    if (typed === undefined) {
      continue;
    }
    keepText({ end: span.start });
    out.push(typed);
    cursor = span.start + span.raw.length;
  }
  keepText({ end: run.text.length });
  // A run consisting of NOTHING but converted markup leaves no text behind, and a section with zero elements
  // is not a legal payload — so an empty result is impossible here only because `out` always gained the
  // typed run itself. Returned as-is; `[run]` above is the only no-op path.
  return out;
}

/**
 * A run sequence with every bare URL and every raw mention promoted to the run that renders it.
 *
 * Byte-identical to its input when the sequence carries no raw markup, which is what lets this sit in a
 * schema transform on every outbound path without moving any existing card by a byte.
 *
 * @param runs the composed run sequence
 * @returns the sequence with convertible markup replaced by typed runs, in the same order
 */
export function typeRawMarkupInRuns({ runs }: { runs: readonly InlineRun[] }): readonly InlineRun[] {
  if (!carriesRawMarkup({ runs })) {
    return runs;
  }
  return runs.flatMap<InlineRun>((run) =>
    convertibleRun(run) ? [...typeRawMarkupInRun({ run, typedFor: typedRunFor })] : [run],
  );
}

/** Whether a sequence has anything to convert at all — the early exit that keeps a clean artifact byte-identical. */
function carriesRawMarkup({ runs }: { runs: readonly InlineRun[] }): boolean {
  return runs.some((run) => convertibleRun(run) && scanRawMarkup({ text: run.text }).length > 0);
}

/**
 * {@link typeRawMarkupInRuns} for the AS-ME lane, whose runs exclude the citation chip.
 *
 * A three-line twin rather than a generic or a cast: `typeRawMarkupInRun` already returns the narrower
 * union, so the only thing this adds is the narrower INPUT type, and a `DripInlineRun[]` coming back out
 * of the `InlineRun` version would need an assertion at every call site to say what the code already
 * guarantees.
 *
 * @param runs the composed as-me run sequence
 * @returns the sequence with convertible markup replaced by typed runs, in the same order
 */
export function typeRawMarkupInDripRuns({ runs }: { runs: readonly DripInlineRun[] }): readonly DripInlineRun[] {
  if (!carriesRawMarkup({ runs })) {
    return runs;
  }
  return runs.flatMap<DripInlineRun>((run) =>
    convertibleRun(run) ? [...typeRawMarkupInRun({ run, typedFor: typedRunFor })] : [run],
  );
}

/**
 * {@link typeRawMarkupInRuns} for the NO-FOLD form, whose runs are text, links and person mentions only.
 *
 * The twin that matters, because it is not merely a narrower input type. It converts through
 * {@link onePersonTypedRunFor}, so a literal `<!here>` or `<!subteam^S…>` written into a no-fold message
 * is NOT promoted to a run this form cannot hold — it survives as raw text and is refused by
 * `rawMarkupIssuesOfRuns` at the same seam every other unconvertible span is refused at. The narrowing is
 * therefore enforced twice: once by the schema's run union, and once here, where the conversion that would
 * have slipped past it declines to happen.
 *
 * @param runs the composed no-fold run sequence
 * @returns the sequence with bare URLs and raw person mentions typed, and everything else left alone
 */
export function typeRawMarkupInNoFoldRuns({ runs }: { runs: readonly NoFoldInlineRun[] }): readonly NoFoldInlineRun[] {
  if (!carriesRawMarkup({ runs })) {
    return runs;
  }
  return runs.flatMap<NoFoldInlineRun>((run) =>
    convertibleRun(run) ? [...typeRawMarkupInRun({ run, typedFor: onePersonTypedRunFor })] : [run],
  );
}

/**
 * {@link typeRawMarkupInRuns} over a list of run sequences — an index, a bullet list, a table row.
 *
 * @param items the run sequences
 * @returns the sequences, each converted, in order
 */
export function typeRawMarkupInSequences({
  items,
}: {
  items: readonly (readonly InlineRun[])[];
}): readonly (readonly InlineRun[])[] {
  return items.map((runs) => typeRawMarkupInRuns({ runs }));
}

/**
 * {@link typeRawMarkupInRuns} over a whole detail sequence, sub-block by sub-block.
 *
 * Deliberately a `switch` over the block union rather than a walk through `./runs.ts`'s `runSequencesOf`:
 * that helper FLATTENS, which is right for reading and useless for rebuilding — a table's rows have to come
 * back as rows. A new block kind fails to compile here rather than silently going unconverted.
 *
 * @param detail the composed detail sub-blocks
 * @returns the sub-blocks with every run sequence converted
 */
export function typeRawMarkupInDetail({ detail }: { detail: readonly DetailBlock[] }): readonly DetailBlock[] {
  return detail.map((block) => typeBlockMarkup({ block }));
}

/** One sub-block, converted. A named function rather than an inline callback so the `switch` may be exhaustive. */
function typeBlockMarkup({ block }: { block: DetailBlock }): DetailBlock {
  switch (block.type) {
    case "paragraph":
      return { ...block, runs: typeRawMarkupInRuns({ runs: block.runs }) };
    case "bullets":
    case "list":
      return { ...block, items: typeRawMarkupInSequences({ items: block.items }) };
    case "table":
      return { ...block, rows: block.rows.map((row) => typeRawMarkupInSequences({ items: row })) };
  }
}

/**
 * The raw markup a run sequence STILL carries after conversion — always unconvertible by construction.
 *
 * @param runs the converted run sequence
 * @returns every surviving span, in order
 */
function rawMarkupResidue({ runs }: { runs: readonly InlineRun[] }): readonly RawMarkupSpan[] {
  return runs.flatMap((run) => (convertibleRun(run) ? scanRawMarkup({ text: run.text }) : []));
}

/**
 * Why a surviving span is being refused, in the author's vocabulary rather than the pattern's.
 *
 * @param span the residue span
 * @returns the sentence a refusal carries
 */
export function rawMarkupRefusal({ span }: { span: RawMarkupSpan }): string {
  const named = span.kind === "channel" ? "a channel reference" : "raw markup";
  return (
    `${JSON.stringify(span.raw)} is ${named} sitting in a plain TEXT run, where it renders LITERALLY — a ` +
    "reader sees the id, not the thing. This vocabulary has typed runs for a link, a person, a user group " +
    "and a broadcast, and nothing for a channel; say it in prose, or link it."
  );
}

/** One residue refusal, with the JSON path a form author needs to find it. */
export interface RawMarkupIssue {
  readonly path: readonly (string | number)[];
  readonly message: string;
}

/**
 * Every issue one run sequence carries AFTER conversion has had its turn.
 *
 * Two families, and the second is here rather than at each form because conversion is what creates it. A
 * bare URL pasted into a plain `text` run becomes a real `link` run in this file's own `.transform`, which
 * runs after `../artifact/runSchema.ts` has graded every authored `url` — so a form checking only its
 * fields would pass a link it then renders. Every form that refuses residue already calls through here, so
 * one seam covers the card, the answer, the drip and the no-fold DM rather than four call sites that can
 * drift apart. What `./vantaLinks.ts` refuses, and why, is in that module.
 *
 * @param runs the converted run sequence
 * @param path the JSON path of the sequence, for the issue
 * @returns one issue per surviving span, then one per refused link
 */
export function rawMarkupIssuesOfRuns({
  runs,
  path,
}: {
  runs: readonly InlineRun[];
  path: readonly (string | number)[];
}): readonly RawMarkupIssue[] {
  return [
    ...rawMarkupResidue({ runs }).map((span) => ({ message: rawMarkupRefusal({ span }), path })),
    ...vantaLinkIssuesOfRuns({ path, runs }),
  ];
}

/**
 * The issues for a PLAIN STRING field — a `tldr`, a `lead`, a table column header.
 *
 * These have nowhere to put a typed run, so every span is residue by construction: there is no conversion
 * to try first. A URL belongs in `primaryLink` (or in a run sequence that can hold a `link`), which is what
 * the refusal says.
 *
 * @param text the field's literal text
 * @param path the JSON path of the field, for the issue
 * @returns one issue per span found
 */
export function rawMarkupIssuesOfText({
  text,
  path,
}: {
  text: string;
  path: readonly (string | number)[];
}): readonly RawMarkupIssue[] {
  return scanRawMarkup({ text }).map((span) => ({
    message:
      `${JSON.stringify(span.raw)} sits in a plain-string field, which renders LITERALLY — this field ` +
      "holds no typed runs, so put the link in `primaryLink` or move the sentence into a run sequence " +
      "that can carry a `link`/`mention` run.",
    path,
  }));
}

/**
 * The residue issues across a whole detail sequence.
 *
 * @param detail the converted detail sub-blocks
 * @param path the JSON path of the detail array itself (`detail` on a card, `body` on an answer)
 * @returns one issue per surviving span, addressed to the sub-block it is in
 */
export function rawMarkupIssuesOfDetail({
  detail,
  path,
}: {
  detail: readonly DetailBlock[];
  path: readonly (string | number)[];
}): readonly RawMarkupIssue[] {
  return detail.flatMap((block, index) =>
    runSequencesOf({ block }).flatMap((runs) => rawMarkupIssuesOfRuns({ path: [...path, index], runs })),
  );
}

/**
 * The residue issues across a list of run sequences — an `index`, or a drip's messages.
 *
 * @param items the converted run sequences
 * @param path the JSON path of the list itself
 * @returns one issue per surviving span, addressed to the item it is in
 */
export function rawMarkupIssuesOfSequences({
  items,
  path,
}: {
  items: readonly (readonly InlineRun[])[];
  path: readonly (string | number)[];
}): readonly RawMarkupIssue[] {
  return items.flatMap((runs, index) => rawMarkupIssuesOfRuns({ path: [...path, index], runs }));
}
