/**
 * BARE REFERENCES in the artifact run vocabulary — resolving `#N`/`SUP-N` into `link` runs, and
 * reporting whatever `../linkify/bareRefs.ts` could not resolve.
 *
 * Same convert-then-refuse-residue shape as `./typedRuns.ts`, and deliberately a SEPARATE file rather than
 * an addition to it: that module's whole class is stateless (a URL is a URL, a mention id is a mention id),
 * while resolving a bare reference needs a `BareRefContext` — which repo(s) the turn is about, which Linear
 * workspace it writes into. Mixing a context-free conversion and a context-bearing one in one function would
 * force every caller of the stateless one to also supply a context it does not have.
 *
 * Runs in sequence with `./typedRuns.ts`, always AFTER it: a bare `https://github.com/o/r/issues/N` is
 * already a `link` run (and therefore untouched here) by the time this runs, so the two conversions cannot
 * fight over the same text.
 *
 * ## A Linear ticket in a CODE run is the one code span this file reads
 *
 * A ticket id belongs in a hyperlink, never in code formatting, or the reader has to find the ticket by hand. A
 * parked draft carried one as a code run. `./typedRuns.ts`'s `convertibleRun` skips every code run, and this file shared
 * it, so the key was neither linked nor refused. A code run whose whole text is ONE known Linear key is therefore
 * replaced by the link outright, and a known key sitting among other code (`deploy --ticket GGGG-1742`) is refused
 * by name rather than split, because restyling part of an authored command changes it. Candidacy is still the
 * resolver's: a prefix that is not a known team key (`UTC-5`, `ISO-8601`) stays code, which is the stated residue
 * — an unknown team's key in code cannot be told from any other hyphenated token.
 */
import {
  type BareRefContext,
  type BareRefIssue,
  type BareRefSpan,
  bareRefIssuesOfPlainText,
  bareRefRefusalMessage,
  type LinearKeySpan,
  linkifySlackMrkdwn,
  resolveBareRef,
  scanBareRefs,
} from "../linkify/bareRefs.js";
import { asMeSequences, mapAsMeSequences, runSequencesOf } from "./runs.js";
import { convertibleRun } from "./typedRuns.js";
import type {
  AsMeArtifact,
  DetailBlock,
  DripInlineRun,
  InlineRun,
  LinkRun,
  NoFoldArtifact,
  NoFoldInlineRun,
  TextSpan,
  UpdateArtifact,
} from "./types.js";

/**
 * One text run, rewritten as the typed runs its bare references deserve. Untouched when it carries none.
 *
 * The return type is the NARROW `TextSpan | LinkRun`, which is what this function has always produced — a
 * bare reference becomes a link and everything around it stays text; there is no path here that emits a
 * mention, a group, a broadcast or a citation. It used to be declared as the wider `DripInlineRun[]`, and
 * the cost of that was paid at every caller: each one needed its own twin to get its own union back, and a
 * form whose vocabulary is narrower than the drip's could not be served at all without an assertion. Saying
 * what it really returns serves all three unions at once.
 */
function linkifyRun({ run, context }: { run: TextSpan; context: BareRefContext }): readonly (TextSpan | LinkRun)[] {
  const spans = scanBareRefs({ context, text: run.text });
  if (spans.length === 0) {
    return [run];
  }
  const out: (TextSpan | LinkRun)[] = [];
  let cursor = 0;
  const keepText = ({ end }: { end: number }): void => {
    const slice = run.text.slice(cursor, end);
    if (slice.length > 0) {
      out.push({ ...run, text: slice });
    }
  };
  for (const span of spans) {
    const resolved = resolveBareRef({ context, span });
    if (resolved === undefined) {
      // Left as literal text — {@link bareRefResidueOfRuns} finds it again and the door refuses on it.
      continue;
    }
    keepText({ end: span.start });
    out.push({ label: resolved.label, type: "link", url: resolved.url });
    cursor = span.end;
  }
  keepText({ end: run.text.length });
  // At least one span always resolved to a link run, OR the trailing `keepText` above always contributes —
  // a run reaching this function is non-empty (it matched at least one span), so `out` cannot come back
  // empty. Mirrors the same invariant `./typedRuns.ts`'s `typeRawMarkupInRun` states for its own conversion.
  return out;
}

/**
 * Whether a run is a code-formatted text run — the one shape {@link convertibleRun} skips that may hide a ticket.
 *
 * @param run the run to consider
 * @returns true for a `text` run carrying `code: true`
 */
function codeRun(run: InlineRun): run is TextSpan {
  return run.type === "text" && run.code === true;
}

/** Every KNOWN Linear key inside one code run — the resolver's own candidacy, so `UTC-5` is never one. */
function linearKeysInCode({ run, context }: { run: TextSpan; context: BareRefContext }): readonly LinearKeySpan[] {
  return scanBareRefs({ context, text: run.text }).filter((span): span is LinearKeySpan => span.kind === "linearKey");
}

/**
 * One code run, replaced by the link it should have been when its whole text is one known Linear key that
 * resolves. Anything else comes back untouched: a key among other code is {@link codeTicketResidue}'s to refuse.
 */
function linkifyCodeRun({ run, context }: { run: TextSpan; context: BareRefContext }): readonly (TextSpan | LinkRun)[] {
  const [only, ...rest] = linearKeysInCode({ context, run });
  if (only === undefined || rest.length > 0 || only.raw !== run.text.trim()) {
    return [run];
  }
  const resolved = resolveBareRef({ context, span: only });
  return resolved === undefined ? [run] : [{ label: resolved.label, type: "link", url: resolved.url }];
}

/** One text run, linkified by whichever rule its formatting puts it under; any other run is left alone. */
function linkifyTextRun({ run, context }: { run: TextSpan; context: BareRefContext }): readonly (TextSpan | LinkRun)[] {
  return run.code === true ? linkifyCodeRun({ context, run }) : linkifyRun({ context, run });
}

/**
 * A run sequence with every resolvable bare reference promoted to a `link` run.
 *
 * Byte-identical to its input when the sequence carries no bare reference, which is what lets this sit
 * unconditionally in every outbound path without moving an untouched card by a byte.
 *
 * @param runs the composed run sequence
 * @param context what the caller knows about the destination
 * @returns the sequence with resolvable bare references replaced by `link` runs, in the same order
 */
export function linkifyRuns({
  runs,
  context,
}: {
  runs: readonly InlineRun[];
  context: BareRefContext;
}): readonly InlineRun[] {
  return runs.flatMap<InlineRun>((run) => (run.type === "text" ? [...linkifyTextRun({ context, run })] : [run]));
}

/**
 * {@link linkifyRuns} for the AS-ME lane, whose runs exclude the citation chip.
 *
 * @param runs the composed as-me run sequence
 * @param context what the caller knows about the destination
 * @returns the sequence with resolvable bare references replaced by `link` runs, in the same order
 */
function linkifyDripRuns({
  runs,
  context,
}: {
  runs: readonly DripInlineRun[];
  context: BareRefContext;
}): readonly DripInlineRun[] {
  return runs.flatMap<DripInlineRun>((run) => (run.type === "text" ? [...linkifyTextRun({ context, run })] : [run]));
}

/**
 * {@link linkifyRuns} for the NO-FOLD form, whose runs are text, links and person mentions only.
 *
 * A twin rather than a generic or a cast, the same call `./typedRuns.ts` makes and for the same reason:
 * `linkifyRun` only ever emits a `link` or the text around it, so all this adds is the narrower input and
 * output type — and a `NoFoldInlineRun[]` coming back out of the `InlineRun` version would need an
 * assertion at every call site to say what the code already guarantees.
 *
 * @param runs the composed no-fold run sequence
 * @param context what the caller knows about the destination
 * @returns the sequence with resolvable bare references replaced by `link` runs, in the same order
 */
function linkifyNoFoldRuns({
  runs,
  context,
}: {
  runs: readonly NoFoldInlineRun[];
  context: BareRefContext;
}): readonly NoFoldInlineRun[] {
  return runs.flatMap<NoFoldInlineRun>((run) => (run.type === "text" ? [...linkifyTextRun({ context, run })] : [run]));
}

/**
 * A validated NO-FOLD message, with every resolvable bare reference promoted to a real link.
 *
 * Every sequence is linkified and every sequence is then checked, with no above/below split — because this
 * form has no below-fold region at all. That is the whole difference from {@link linkifyCard}, where the
 * two halves are checked by two different rule sets.
 *
 * @param artifact the validated no-fold artifact
 * @param context what this send's bare references can resolve against
 * @returns the linkified artifact, plus one message per bare reference still unresolved
 */
export function linkifyNoFold({ artifact, context }: { artifact: NoFoldArtifact; context: BareRefContext }): {
  readonly artifact: NoFoldArtifact;
  readonly issues: readonly string[];
} {
  const lead = linkifyNoFoldRuns({ context, runs: artifact.lead });
  const bullets = artifact.bullets.map((runs) => linkifyNoFoldRuns({ context, runs }));
  const trailing = artifact.trailing.map((runs) => linkifyNoFoldRuns({ context, runs }));
  const issues = [
    ...bareRefIssuesOfRuns({ context, path: ["lead"], runs: lead }),
    ...bareRefIssuesOfSequences({ context, items: bullets, path: ["bullets"] }),
    ...bareRefIssuesOfSequences({ context, items: trailing, path: ["trailing"] }),
  ].map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  return { artifact: { ...artifact, bullets, lead, trailing }, issues };
}

/**
 * {@link linkifyRuns} over a list of run sequences — an index, a bullet list, a table row.
 *
 * @param items the run sequences
 * @param context what the caller knows about the destination
 * @returns the sequences, each linkified, in order
 */
export function linkifySequences({
  items,
  context,
}: {
  items: readonly (readonly InlineRun[])[];
  context: BareRefContext;
}): readonly (readonly InlineRun[])[] {
  return items.map((runs) => linkifyRuns({ context, runs }));
}

/** One sub-block, linkified. A named function rather than an inline callback so the `switch` may be exhaustive. */
function linkifyBlock({ block, context }: { block: DetailBlock; context: BareRefContext }): DetailBlock {
  switch (block.type) {
    case "paragraph":
      return { ...block, runs: linkifyRuns({ context, runs: block.runs }) };
    case "bullets":
    case "list":
      return { ...block, items: linkifySequences({ context, items: block.items }) };
    case "table":
      return { ...block, rows: block.rows.map((row) => linkifySequences({ context, items: row })) };
  }
}

/**
 * {@link linkifyRuns} over a whole detail sequence, sub-block by sub-block.
 *
 * @param detail the composed detail sub-blocks
 * @param context what the caller knows about the destination
 * @returns the sub-blocks with every run sequence linkified
 */
export function linkifyDetail({
  detail,
  context,
}: {
  detail: readonly DetailBlock[];
  context: BareRefContext;
}): readonly DetailBlock[] {
  return detail.map((block) => linkifyBlock({ block, context }));
}

/** The bare references a run sequence STILL carries after linkifying — always unresolvable by construction. */
function bareRefResidueOfRuns({
  runs,
  context,
}: {
  runs: readonly InlineRun[];
  context: BareRefContext;
}): readonly BareRefSpan[] {
  return runs.flatMap((run) =>
    convertibleRun(run)
      ? scanBareRefs({ context, text: run.text }).filter((span) => resolveBareRef({ context, span }) === undefined)
      : [],
  );
}

/**
 * The known Linear keys still inside a code run after linkifying — a key among other code, or one whose run
 * could not resolve. A code run that was ONLY a resolvable key is a link by now, so it is never here.
 */
function codeTicketResidue({
  runs,
  context,
}: {
  runs: readonly InlineRun[];
  context: BareRefContext;
}): readonly LinearKeySpan[] {
  return runs.flatMap((run) => (codeRun(run) ? linearKeysInCode({ context, run }) : []));
}

/** Why a ticket in code formatting is refused, and the two ways out. */
function codeTicketRefusal({ span }: { span: LinearKeySpan }): string {
  return (
    `${JSON.stringify(span.raw)} is a Linear ticket inside code formatting — a ticket id in an outbound message ` +
    "is a hyperlink over its own text, never code, so the reader can reach it " +
    "without finding it by hand. Give the ticket a run of its own without `code`, or a `link` " +
    "run to its Linear URL, and keep code formatting for the rest."
  );
}

/**
 * The residue issues for one run sequence, after linkifying has already had its turn.
 *
 * @param runs the linkified run sequence
 * @param context what the caller knows about the destination
 * @param path the JSON path of the sequence, for the issue
 * @returns one issue per surviving bare reference, then one per ticket left inside code formatting
 */
export function bareRefIssuesOfRuns({
  runs,
  context,
  path,
}: {
  runs: readonly InlineRun[];
  context: BareRefContext;
  path: readonly (string | number)[];
}): readonly BareRefIssue[] {
  return [
    ...bareRefResidueOfRuns({ context, runs }).map((span) => ({
      message: bareRefRefusalMessage({ context, span }),
      path,
    })),
    ...codeTicketResidue({ context, runs }).map((span) => ({ message: codeTicketRefusal({ span }), path })),
  ];
}

/**
 * The residue issues across a whole detail sequence.
 *
 * @param detail the linkified detail sub-blocks
 * @param context what the caller knows about the destination
 * @param path the JSON path of the detail array itself (`detail` on a card, `body` on an answer)
 * @returns one issue per surviving bare reference, addressed to the sub-block it is in
 */
export function bareRefIssuesOfDetail({
  detail,
  context,
  path,
}: {
  detail: readonly DetailBlock[];
  context: BareRefContext;
  path: readonly (string | number)[];
}): readonly BareRefIssue[] {
  return detail.flatMap((block, index) =>
    runSequencesOf({ block }).flatMap((runs) => bareRefIssuesOfRuns({ context, path: [...path, index], runs })),
  );
}

/**
 * The residue issues across a list of run sequences — an `index`, or a drip's messages.
 *
 * @param items the linkified run sequences
 * @param context what the caller knows about the destination
 * @param path the JSON path of the list itself
 * @returns one issue per surviving bare reference, addressed to the item it is in
 */
export function bareRefIssuesOfSequences({
  items,
  context,
  path,
}: {
  items: readonly (readonly InlineRun[])[];
  context: BareRefContext;
  path: readonly (string | number)[];
}): readonly BareRefIssue[] {
  return items.flatMap((runs, index) => bareRefIssuesOfRuns({ context, path: [...path, index], runs }));
}

/**
 * A validated as-me send, with every resolvable bare reference promoted to a real link — shared by `slack
 * post|reply --as me` and `slack edit --as me`, since both validate through the same {@link AsMeArtifact}
 * union.
 *
 * The `plain` escape hatch (`../../outbound/artifact/types.ts`'s `PlainArtifact`) rewrites Slack's OWN
 * `<url|label>` mrkdwn rather than `[label](url)`, because that string is exactly what Slack itself parses —
 * see `../linkify/bareRefs.ts`'s `linkifySlackMrkdwn`.
 *
 * @param artifact the validated drip, one-card, one-list or plain send
 * @param context what this send's bare references can resolve against
 * @returns the linkified artifact, plus one message per bare reference still unresolved
 */
export function linkifyDripArtifact({ artifact, context }: { artifact: AsMeArtifact; context: BareRefContext }): {
  readonly artifact: AsMeArtifact;
  readonly issues: readonly string[];
} {
  if (artifact.kind === "plain") {
    const linkified = linkifySlackMrkdwn({ context, text: artifact.text });
    return {
      artifact: { ...artifact, text: linkified.text },
      issues: linkified.unresolved.map((span) => bareRefRefusalMessage({ context: linkified.context, span })),
    };
  }
  const linkified = mapAsMeSequences({ artifact, map: (runs) => linkifyDripRuns({ context, runs }) });
  return { artifact: linkified, issues: runIssues({ artifact: linkified, context }) };
}

/** One flattened issue line per unresolved bare reference, path-prefixed by whichever field it came from. */
function runIssues({ artifact, context }: { artifact: AsMeArtifact; context: BareRefContext }): readonly string[] {
  return asMeSequences({ artifact }).flatMap((sequence) =>
    bareRefIssuesOfRuns({ context, path: [sequence.field, sequence.index], runs: sequence.runs }).map(
      (issue) => `${issue.path.join(".")}: ${issue.message}`,
    ),
  );
}

/**
 * A validated bot card (or the assistant's own answer, which shares this vocabulary), with every resolvable
 * bare reference promoted to a real link across `tldr`/`detail`/`index` in one call (and a bare one in a plain
 * `intro` line refused, since it has no run to become) — shared by every CLI
 * write path that carries this shape (`slack post|reply --as bot`, `slack edit`/`progress finish`).
 *
 * @param artifact the validated card
 * @param context what this write's bare references can resolve against
 * @returns the linkified card, plus one `path: message` line per bare reference still unresolved
 */
export function linkifyCard({ artifact, context }: { artifact: UpdateArtifact; context: BareRefContext }): {
  readonly artifact: UpdateArtifact;
  readonly issues: readonly string[];
} {
  const detail = linkifyDetail({ context, detail: artifact.detail });
  const index = linkifySequences({ context, items: artifact.index });
  const { intro = [] } = artifact;
  const issues = [
    ...intro.flatMap((text, line) => bareRefIssuesOfPlainText({ context, path: ["intro", line], text })),
    ...bareRefIssuesOfPlainText({ context, path: ["tldr"], text: artifact.tldr }),
    ...bareRefIssuesOfDetail({ context, detail, path: ["detail"] }),
    ...bareRefIssuesOfSequences({ context, items: index, path: ["index"] }),
  ].map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  return { artifact: { ...artifact, detail, index }, issues };
}
