/**
 * The forbidden-identifier scanner — pure. Given the committed rule data (`./forbiddenIdentifiers.ts`) and
 * one file's text, it names every place a forbidden person, organisation or product token, a real provider id,
 * a team key or a non-synthetic provider workspace location appears, and it never prints or returns the
 * matched text. A hit's `path` is the caller's own, returned as given: a path is not content, so a name in a
 * path is neither scanned nor redacted here.
 *
 * ## Why the rules are hashes, and what that costs the matcher
 *
 * A list of the names a gate matches is itself a list of those names, so the hashed kinds are stored as the
 * SHA-256 hex of their UTF-8 bytes (ASCII-lowercased first for a case-insensitive rule) and matched by
 * hashing CANDIDATES out of the text. Every mode is therefore a candidate extractor plus a set lookup:
 *
 * - substring (`-ci`, `-cs`): every window of a rule's stored length inside each maximal `[A-Za-z0-9-]+`
 *   run. Exact rather than approximate, because a rule token is drawn from that alphabet and so can never
 *   straddle a character outside it.
 * - word (`-ci`, `-cs`): one to three maximal `\w+` runs joined by exactly one `-`, `.` or space, the span
 *   extended past its first run only when that run is a multi-run rule's head (`spanHeads`).
 * - embedded upper: an uppercase run that starts at a word boundary or after a `0` and ends at a digit or a
 *   boundary — a token spelled inside an id.
 * - exact id: a whole uppercase-alphanumeric `\w+` run.
 * - team key: `KEY-123`, unless the complete reference is itself on the exempt list.
 *
 * The embedded-upper, team-key and provider-location extractors are `./identifierPatternSpans.ts`'s.
 *
 * The provider locations are not hashed: they are generic patterns (`<label>.slack.com`, `linear.app/<ws>`, …)
 * that match EVERY label but the synthetic and provider-owned ones the rules allow, so they name nobody.
 *
 * Neither the verdict nor the report is this module's. `./scan.ts`'s `isRefusedHit` decides whether a kind
 * fails a gate, `./identifierReport.ts` folds and renders the hits, and `./identifierScanRun.ts` applies both
 * to the repository.
 */
import { hash } from "node:crypto";

import { compileLocation, type PatternRules, patternSpans } from "./identifierPatternSpans.js";

/** Every kind this scanner reports, in the fixed order a report lists them. */
export const IDENTIFIER_KINDS = [
  "forbidden-substring-ci",
  "forbidden-substring-cs",
  "forbidden-word-ci",
  "forbidden-word-cs",
  "forbidden-embedded-upper",
  "forbidden-exact-id",
  "forbidden-team-key",
  "forbidden-provider-location",
] as const;

/** One of {@link IDENTIFIER_KINDS}. */
export type IdentifierKind = (typeof IDENTIFIER_KINDS)[number];

/** A substring rule: the digest of the forbidden token and the length a candidate window must have. */
interface HashedSubstringRule {
  readonly hash: string;
  readonly length: number;
}

/** The hashed rule sets, one per matching mode. Every string is a lowercase 64-hex SHA-256 digest. */
interface HashedIdentifierRules {
  readonly embeddedUpper: readonly string[];
  readonly exactIds: readonly string[];
  /** Complete `KEY-123` references a team key may appear in without being a hit. */
  readonly exemptTicketReferences: readonly string[];
  readonly substringCi: readonly HashedSubstringRule[];
  readonly substringCs: readonly HashedSubstringRule[];
  /**
   * The lowercased first `\w+` run of every word rule spanning two or more runs. A span is extended past its
   * first run only when that run is one of these, which is what keeps the multi-run candidates from being
   * hashed at all in ordinary prose.
   */
  readonly spanHeads: readonly string[];
  readonly teamKeys: readonly string[];
  readonly wordCi: readonly string[];
  readonly wordCs: readonly string[];
}

/** One provider's workspace-location shape and the labels in it that are synthetic or the provider's own. */
export interface ProviderLocationRule {
  readonly provider: string;
  /** Global, case-insensitive; capture group 1 is the workspace label. */
  readonly re: RegExp;
  /**
   * A lowercase literal every match contains: a text without it never runs the pattern. Used only once
   * `./locationMarker.ts` proves it a required top-level literal of `re`; an unproven one is ignored.
   */
  readonly marker: string;
  /** Lowercase labels that are NOT a hit. */
  readonly allowed: readonly string[];
}

/** The whole committed rule data. */
export interface ForbiddenIdentifierRules {
  readonly hashed: HashedIdentifierRules;
  readonly providerLocations: readonly ProviderLocationRule[];
}

/** One forbidden identifier occurrence. Deliberately carries no excerpt: printing the match re-leaks it. */
export interface IdentifierHit {
  readonly path: string;
  readonly line: number;
  readonly kind: IdentifierKind;
}

/**
 * One forbidden identifier's exact place in a text — what a redactor masks. Like {@link IdentifierHit} it carries
 * no excerpt: a caller that holds the text can slice it, and one that does not never needed it.
 *
 * A provider location's span is its workspace LABEL alone, never the host around it, so a masked location still
 * says which provider it was.
 */
export interface IdentifierSpan {
  readonly kind: IdentifierKind;
  /** The UTF-16 offset the identifier starts at. */
  readonly offset: number;
  /** How many UTF-16 code units it covers. */
  readonly length: number;
}

/** A scanner bound to one rule set, holding its candidate caches for as long as the caller keeps it. */
export interface IdentifierScanner {
  readonly scan: (args: { content: string; path: string }) => readonly IdentifierHit[];
  /**
   * Every exact span, in no promised order and possibly overlapping: each substring window a rule matches, not
   * only the first per run as {@link IdentifierScanner.scan} reports.
   */
  readonly spans: (args: { content: string }) => readonly IdentifierSpan[];
}

const SUBSTRING_RUN = /[A-Za-z0-9-]+/g;
const WORD_RUN = /\w+/g;
const EXACT_ID_SHAPE = /^[A-Z0-9]+$/;
const SPAN_JOINERS = "-. ";
const MAX_SPAN_RUNS = 3;

/**
 * Pure: the lowercase hex SHA-256 of a string's UTF-8 bytes — the one canonical form every hashed rule uses.
 *
 * @param text the candidate, already lowercased for a case-insensitive rule
 * @returns the 64-character digest
 */
export function identifierDigest({ text }: { text: string }): string {
  return hash("sha256", text);
}

/** Substring rules carrying the kind they report and whether the candidate is lowercased first. */
interface SubstringProbe extends HashedSubstringRule {
  readonly kind: IdentifierKind;
  readonly fold: boolean;
}

/** One hit before its line is known: its kind and character offset. */
interface FoundHit {
  readonly kind: IdentifierKind;
  readonly offset: number;
}

/** One substring rule's match inside a run: the rule's kind and the window's start within that run. */
interface RunWindow {
  readonly kind: IdentifierKind;
  readonly start: number;
  readonly length: number;
}

/**
 * One rule set compiled for repeated scanning: its lookup sets and the caches its matchers share. The pattern
 * modes' part is `./identifierPatternSpans.ts`'s.
 */
interface CompiledIdentifierRules extends PatternRules {
  readonly spanHead: (args: { run: string }) => boolean;
  /** Every window of one run some substring rule matches, case-insensitive rules first, then by start. */
  readonly substringWindows: (args: { run: string }) => readonly RunWindow[];
  readonly wordKind: (args: { span: string; single: boolean }) => IdentifierKind | undefined;
}

/**
 * Bind a scanner to one rule set. The digest and substring-run caches live in the returned closure, so a
 * repository run that keeps one scanner hashes each distinct candidate once, and nothing is module-global.
 *
 * @param rules the committed (or, in a test, a synthetic) rule data
 * @returns the scanner
 */
export function identifierScanner({ rules }: { rules: ForbiddenIdentifierRules }): IdentifierScanner {
  const compiled = compileRules({ rules });
  return {
    scan: ({ content, path }) =>
      locateHits({
        content,
        found: [
          ...substringHits({ compiled, content }),
          ...wordSpans({ compiled, content }),
          ...patternSpans({ anchor: "match", compiled, content }),
        ],
        path,
      }),
    spans: ({ content }) => [
      ...substringSpans({ compiled, content }),
      ...wordSpans({ compiled, content }),
      ...patternSpans({ anchor: "group", compiled, content }),
    ],
  };
}

/**
 * Compile one rule set into lookup sets and the cached matchers every scan through it shares.
 *
 * @param rules the rule data to compile
 * @returns the compiled rules
 */
function compileRules({ rules }: { rules: ForbiddenIdentifierRules }): CompiledIdentifierRules {
  const { hashed } = rules;
  const wordCs = new Set(hashed.wordCs);
  const wordCi = new Set(hashed.wordCi);
  const exactIds = new Set(hashed.exactIds);
  const spanHeads = new Set(hashed.spanHeads);
  const probes: readonly SubstringProbe[] = [
    ...hashed.substringCi.map((rule) => ({ ...rule, fold: true, kind: "forbidden-substring-ci" as const })),
    ...hashed.substringCs.map((rule) => ({ ...rule, fold: false, kind: "forbidden-substring-cs" as const })),
  ];
  const digests = new Map<string, string>();
  const runWindows = new Map<string, readonly RunWindow[]>();

  const digest = ({ text }: { text: string }): string => {
    const seen = digests.get(text);
    if (seen !== undefined) {
      return seen;
    }
    const fresh = identifierDigest({ text });
    digests.set(text, fresh);
    return fresh;
  };

  return {
    digest,
    embeddedUpper: new Set(hashed.embeddedUpper),
    exempt: new Set(hashed.exemptTicketReferences),
    // A private copy of each global pattern: `matchAll` starts at the source's `lastIndex`, which a caller's
    // own `exec` on the shared committed object would otherwise carry into this scanner.
    locations: rules.providerLocations.map(compileLocation),
    substringWindows: ({ run }) => {
      const seen = runWindows.get(run);
      if (seen !== undefined) {
        return seen;
      }
      const found = probeRun({ probes, run });
      runWindows.set(run, found);
      return found;
    },
    // The lowercased run's digest is the one `wordKind` just took for the single-run span, so this is a cache hit.
    spanHead: ({ run }) => spanHeads.has(digest({ text: run.toLowerCase() })),
    teamKeys: new Set(hashed.teamKeys),
    wordKind: ({ span, single }) => {
      if (wordCs.has(digest({ text: span }))) {
        return "forbidden-word-cs";
      }
      if (wordCi.has(digest({ text: span.toLowerCase() }))) {
        return "forbidden-word-ci";
      }
      if (single && EXACT_ID_SHAPE.test(span) && exactIds.has(digest({ text: span }))) {
        return "forbidden-exact-id";
      }
      return undefined;
    },
  };
}

/**
 * The substring hits: one per maximal `[A-Za-z0-9-]+` run some substring rule matches inside.
 *
 * @param compiled the rule set's matchers
 * @param content the scanned text
 * @returns the hits, in text order
 */
function substringHits({ compiled, content }: { compiled: CompiledIdentifierRules; content: string }): FoundHit[] {
  const found: FoundHit[] = [];
  for (const match of content.matchAll(SUBSTRING_RUN)) {
    const first = compiled.substringWindows({ run: match[0] })[0];
    if (first !== undefined) {
      found.push({ kind: first.kind, offset: match.index });
    }
  }
  return found;
}

/**
 * Every substring window a rule matches, at its exact place in the text — what a redactor masks.
 *
 * @param compiled the rule set's matchers
 * @param content the scanned text
 * @returns the spans, in run order
 */
function substringSpans({
  compiled,
  content,
}: {
  compiled: CompiledIdentifierRules;
  content: string;
}): IdentifierSpan[] {
  return [...content.matchAll(SUBSTRING_RUN)].flatMap((match) =>
    compiled.substringWindows({ run: match[0] }).map((window): IdentifierSpan => ({
      kind: window.kind,
      length: window.length,
      offset: match.index + window.start,
    })),
  );
}

/**
 * The word and exact-id spans: from each `\w+` run, the first span of one to three joined runs that matches.
 *
 * @param compiled the rule set's matchers
 * @param content the scanned text
 * @returns the spans, in text order
 */
function wordSpans({ compiled, content }: { compiled: CompiledIdentifierRules; content: string }): IdentifierSpan[] {
  const found: IdentifierSpan[] = [];
  const runs = [...content.matchAll(WORD_RUN)];
  runs.forEach((first, index) => {
    let span = first[0];
    let end = first.index + span.length;
    for (let extra = 0; extra < MAX_SPAN_RUNS; extra++) {
      const kind = compiled.wordKind({ single: extra === 0, span });
      if (kind !== undefined) {
        found.push({ kind, length: span.length, offset: first.index });
        return;
      }
      const next = runs[index + extra + 1];
      if (next?.index !== end + 1 || !SPAN_JOINERS.includes(content.charAt(end))) {
        return;
      }
      if (extra === 0 && !compiled.spanHead({ run: first[0] })) {
        return;
      }
      end = next.index + next[0].length;
      span = content.slice(first.index, end);
    }
  });
  return found;
}

/**
 * Pure: every window of one run some substring rule satisfies.
 *
 * @param probes the substring rules, case-insensitive first
 * @param run one maximal `[A-Za-z0-9-]+` run
 * @returns each matching window's kind, start and length, in probe order then by start
 */
function probeRun({ probes, run }: { probes: readonly SubstringProbe[]; run: string }): readonly RunWindow[] {
  const lower = run.toLowerCase();
  const windows: RunWindow[] = [];
  for (const probe of probes) {
    const text = probe.fold ? lower : run;
    for (let start = 0; start + probe.length <= text.length; start++) {
      if (identifierDigest({ text: text.slice(start, start + probe.length) }) === probe.hash) {
        windows.push({ kind: probe.kind, length: probe.length, start });
      }
    }
  }
  return windows;
}

/**
 * Pure: turn character offsets into 1-based line numbers, building the line index only when there is a hit.
 *
 * @param content the scanned text
 * @param found every hit's kind and offset
 * @param path the file's identity for reporting
 * @returns the hits, in the order found
 */
function locateHits({
  content,
  found,
  path,
}: {
  content: string;
  found: readonly { readonly kind: IdentifierKind; readonly offset: number }[];
  path: string;
}): readonly IdentifierHit[] {
  if (found.length === 0) {
    return [];
  }
  const starts = [0];
  for (let at = content.indexOf("\n"); at !== -1; at = content.indexOf("\n", at + 1)) {
    starts.push(at + 1);
  }
  return found.map(({ kind, offset }) => ({ kind, line: lineAt({ offset, starts }), path }));
}

/**
 * Pure: the 1-based line holding an offset, by binary search over the line starts.
 *
 * @param offset a character offset into the text
 * @param starts every line's starting offset, ascending, beginning with 0
 * @returns the line number
 */
function lineAt({ offset, starts }: { offset: number; starts: readonly number[] }): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (starts[middle]! <= offset) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return low + 1;
}

/**
 * Pure: scan one text with a fresh scanner — for a single document such as a pull request's title and body,
 * where there is no run to share a cache across.
 *
 * @param content the text
 * @param path the identity to report it under
 * @param rules the rule data
 * @returns every hit
 */
export function scanForbiddenIdentifiers({
  content,
  path,
  rules,
}: {
  content: string;
  path: string;
  rules: ForbiddenIdentifierRules;
}): readonly IdentifierHit[] {
  return identifierScanner({ rules }).scan({ content, path });
}
