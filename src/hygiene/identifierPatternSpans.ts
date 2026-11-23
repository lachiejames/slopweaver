/**
 * The forbidden-identifier scanner's pattern-extracted modes — embedded uppercase tokens, team keys and provider
 * workspace locations. Pure. Each is a regular expression over the text whose capture is then checked, unlike the
 * substring and word modes `./identifierScan.ts` keeps, which hash every candidate window or run.
 */
import type { IdentifierSpan, ProviderLocationRule } from "./identifierScan.js";
import { markerIsRequired } from "./locationMarker.js";

const EMBEDDED_UPPER = /(?:\b|(?<=0))([A-Z]+)(?=\d|\b)/g;
const TEAM_KEY = /\b([A-Z]+)-([0-9]{1,5})\b/g;

/** The part of a compiled rule set the pattern modes read. */
export interface PatternRules {
  readonly digest: (args: { text: string }) => string;
  readonly embeddedUpper: ReadonlySet<string>;
  readonly teamKeys: ReadonlySet<string>;
  readonly exempt: ReadonlySet<string>;
  readonly locations: readonly {
    readonly allowed: ReadonlySet<string>;
    readonly marker: string;
    readonly re: RegExp;
  }[];
}

/**
 * Where a provider location's span sits: `group` is the label alone, the exact span a mask replaces; `match` is
 * the whole match, the offset `scan` has always reported a line for.
 */
type LocationAnchor = "group" | "match";

/**
 * Compile one location rule, reading each field exactly once, so the marker proved is the marker kept and the
 * proof is taken against the very pattern the scan runs.
 *
 * @param rule the location rule
 * @returns its allowed set, its marker ("" when unproven, which every text includes, so the pattern always
 *   runs) and a private copy of its pattern, carrying `d` so a match reports where its label group sits
 */
export function compileLocation(rule: ProviderLocationRule): PatternRules["locations"][number] {
  const { allowed, marker, re: shared } = rule;
  const re = new RegExp(shared.source, shared.flags.includes("d") ? shared.flags : `${shared.flags}d`);
  return { allowed: new Set(allowed), marker: markerIsRequired({ marker, re }) ? marker : "", re };
}

/**
 * The pattern-extracted spans: embedded uppercase tokens, team keys and non-allowed provider locations.
 *
 * @param anchor where a provider location's span starts: `match` keeps `scan`'s line report where it always was
 * @param compiled the rule set's matchers
 * @param content the scanned text
 * @returns the spans, grouped by mode
 */
export function patternSpans({
  anchor,
  compiled,
  content,
}: {
  anchor: "group" | "match";
  compiled: PatternRules;
  content: string;
}): IdentifierSpan[] {
  return [
    ...embeddedUpperSpans({ compiled, content }),
    ...teamKeySpans({ compiled, content }),
    ...locationSpans({ anchor, compiled, content }),
  ];
}

/**
 * The embedded-upper spans: an uppercase run inside an id whose digest is a forbidden token. Every other part
 * of the pattern is zero-width, so the whole match IS the token.
 *
 * @param compiled the rule set's matchers
 * @param content the scanned text
 * @returns the spans, in text order
 */
function embeddedUpperSpans({ compiled, content }: { compiled: PatternRules; content: string }): IdentifierSpan[] {
  return [...content.matchAll(EMBEDDED_UPPER)]
    .filter((match) => compiled.embeddedUpper.has(compiled.digest({ text: match[1]! })))
    .map((match): IdentifierSpan => ({
      kind: "forbidden-embedded-upper",
      length: match[1]!.length,
      offset: match.index,
    }));
}

/**
 * The team-key spans: a `KEY-123` whose key is forbidden and whose complete reference is not exempt. The span
 * is the whole reference, because a ticket number left behind still points into one organisation's tracker.
 *
 * @param compiled the rule set's matchers
 * @param content the scanned text
 * @returns the spans, in text order
 */
function teamKeySpans({ compiled, content }: { compiled: PatternRules; content: string }): IdentifierSpan[] {
  const { digest } = compiled;
  return [...content.matchAll(TEAM_KEY)]
    .filter(
      (match) => compiled.teamKeys.has(digest({ text: match[1]! })) && !compiled.exempt.has(digest({ text: match[0] })),
    )
    .map((match): IdentifierSpan => ({ kind: "forbidden-team-key", length: match[0].length, offset: match.index }));
}

/**
 * The provider-location spans: a workspace label no location rule allows, spanning the label group alone or,
 * anchored at the match, the whole match.
 *
 * @param anchor whether the span is the label group or the whole match
 * @param compiled the rule set's matchers
 * @param content the scanned text
 * @returns the spans, grouped by provider
 */
function locationSpans({
  anchor,
  compiled,
  content,
}: {
  anchor: LocationAnchor;
  compiled: PatternRules;
  content: string;
}): IdentifierSpan[] {
  // Each pattern's leading label class is tried at every offset, so on a text with no marker the regex costs
  // a full scan to prove nothing; one lowercase copy and a substring test prove it far faster.
  const lower = content.toLowerCase();
  return compiled.locations.flatMap(({ allowed, marker, re }) =>
    !lower.includes(marker)
      ? []
      : [...content.matchAll(re)]
          .filter((match) => !allowed.has(match[1]!.toLowerCase()))
          .map((match): IdentifierSpan => {
            if (anchor === "match") {
              return { kind: "forbidden-provider-location", length: match[0].length, offset: match.index };
            }
            // `compileLocation` adds the `d` flag, so every match carries its groups' indices.
            const [start, end] = match.indices![1]!;
            return { kind: "forbidden-provider-location", length: end - start, offset: start };
          }),
  );
}
