/**
 * Generic, provider-agnostic helpers for the integration-lane cassette pipeline: the leak-class + known-value
 * BACKSTOP scrub (applied after the allowlist redactor + to non-provider bodies like the `claude` SSE stream),
 * URL-path blanking, and the GraphQL request-body normaliser used for replay MATCHING. The primary,
 * safe-by-default redaction is the allowlist in `cassetteRedact.ts`; these are belt-and-braces + matching.
 * All pure + unit-tested — a leak that reaches a committed cassette is a defect here or a gap in the allowlist.
 */
import { isRecord } from "../lib/parsers.js";

/** A generic leak-class scrub rule: a global pattern + the constant placeholder it collapses to. */
interface ScrubRule {
  readonly re: RegExp;
  readonly with: string;
}

/**
 * Generic leak-class rules — a SUPERSET of `src/hygiene/scan.ts`'s `PATTERNS` (the public gate stays narrow
 * to avoid repo-wide false positives; a cassette carries REAL data, so this backstop is stricter). Global
 * flag ⇒ every occurrence replaced; constant placeholder ⇒ the output never re-derives the secret. IDs under
 * a provider's `idKeys` are already synthesised by the allowlist redactor; this rule still catches an id that
 * appears un-keyed (embedded in a kept value or a non-provider body). The digit lookahead keeps all-caps
 * English words (WARRANTIES) safe.
 */
const LEAK_RULES: readonly ScrubRule[] = [
  { re: /\/(?:Users|home)\/[A-Za-z0-9._-]+/g, with: "/<home>" },
  { re: /xox[bp]-[A-Za-z0-9-]{10,}/g, with: "[REDACTED-SLACK-TOKEN]" },
  { re: /gh[po]_[A-Za-z0-9]{20,}/g, with: "[REDACTED-GH-TOKEN]" },
  { re: /github_pat_[A-Za-z0-9_]{20,}/g, with: "[REDACTED-GH-PAT]" },
  { re: /\bsecret_[A-Za-z0-9]{16,}/g, with: "[REDACTED-NOTION-SECRET]" },
  { re: /\bsk-[A-Za-z0-9]{20,}/g, with: "[REDACTED-KEY]" },
  { re: /\b(?=[A-Z0-9]*[0-9])[A-Z][A-Z0-9]{7,}\b/g, with: "REDACTEDID" },
  { re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, with: "redacted@example.com" },
];

/**
 * Replace every generic leak-class occurrence in a text with its constant placeholder. Pure.
 *
 * @param text the text to scrub
 * @returns the text with all leak-class matches replaced
 */
export function scrubLeakClasses({ text }: { text: string }): string {
  let out = text;
  for (const rule of LEAK_RULES) {
    out = out.replace(rule.re, rule.with);
  }
  return out;
}

/**
 * Blank the PATH (+ query) of every URL in a text, keeping only `scheme://host`. Applied to non-provider
 * bodies (a provider body's URLs are handled with a host allowlist by the allowlist redactor). Pure.
 *
 * @param text the text to scrub
 * @returns the text with every URL path/query replaced by `/[REDACTED]`
 */
export function blankUrlPaths({ text }: { text: string }): string {
  return text.replace(/(https?:\/\/[^/\s"']+)\/[^\s"']*/g, "$1/[REDACTED]");
}

/**
 * Replace every occurrence of each known-sensitive literal (case-insensitive) with `[REDACTED]`. This is how
 * a pre-seeded org-specific value (a person/company/team/channel name, an internal domain) is stripped
 * wherever it appears — including inside an allowlisted kept value. Pure; avoids building a RegExp from
 * untrusted input.
 *
 * @param text the text to scrub
 * @param knownValues the known-sensitive literals (from `$SLOPWEAVER_HOME`, record-time only)
 * @returns the text with every known literal replaced
 */
export function scrubKnownValues({ text, knownValues }: { text: string; knownValues: readonly string[] }): string {
  let out = text;
  for (const needle of knownValues) {
    if (needle.length === 0) {
      continue;
    }
    const lowerNeedle = needle.toLowerCase();
    let result = "";
    let rest = out;
    for (;;) {
      const idx = rest.toLowerCase().indexOf(lowerNeedle);
      if (idx === -1) {
        result += rest;
        break;
      }
      result += `${rest.slice(0, idx)}[REDACTED]`;
      rest = rest.slice(idx + lowerNeedle.length);
    }
    out = result;
  }
  return out;
}

/**
 * The generic backstop over an arbitrary text (a URL, a non-provider/`claude` body): known-value scrub, then
 * leak classes, then URL-path blanking. Composed once so the Polly hook applies a consistent belt-and-braces
 * pass. Pure.
 *
 * @param text the text to scrub
 * @param knownValues the known-sensitive literals
 * @returns the fully backstop-scrubbed text
 */
export function scrubGeneric({ text, knownValues }: { text: string; knownValues: readonly string[] }): string {
  return blankUrlPaths({ text: scrubLeakClasses({ text: scrubKnownValues({ knownValues, text }) }) });
}

/**
 * A host whose requests all share one path (`/graphql`) so replay must disambiguate them by body.
 *
 * @param url the recorded request URL
 * @returns true when either provider's GraphQL address appears ANYWHERE in the string. A substring test on
 *   the whole URL, not a parsed endpoint check — the same shape as `providerForUrl` in
 *   `cassetteRedactConfig.ts`, and with the same consequence: a URL merely CONTAINING that address, in a path
 *   or a query parameter, answers true. Safe for the cassette request lines this is applied to, and the
 *   reason it matters at all is that every GraphQL request shares one path, so replay must disambiguate them
 *   by body rather than by URL
 */
export function isGraphqlUrl({ url }: { url: string }): boolean {
  return url.includes("api.linear.app/graphql") || url.includes("api.github.com/graphql");
}

/**
 * Normalise a GraphQL request body to the semantic core that identifies an operation — its `operationName`,
 * its query with fragment blocks stripped + whitespace collapsed (SDK upgrades churn fragment internals
 * without changing semantics), and its variables. Used BOTH as the Polly body-matcher (so `issues` vs
 * `projects` vs a `page 2` cursor each map to a distinct cassette entry) AND as the persisted form. A non-JSON
 * body is returned unchanged. Pure.
 *
 * @param body the raw request body string
 * @returns the normalised `{operationName, query, variables}` JSON, or the input unchanged if not JSON
 */
export function normalizeGraphqlBody({ body }: { body: string }): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return body;
  }
  if (!isRecord(parsed)) {
    return body;
  }
  const operationName = normalisedOperationName({ body: parsed });
  const query = typeof parsed["query"] === "string" ? parsed["query"] : undefined;
  return JSON.stringify({
    operationName,
    query: normalizeGraphqlQuery({ query }),
    variables: sortValue({ value: normalisedVariables({ body: parsed }) }),
  });
}

/** An anonymous operation sends no `operationName`, and the normalised form names that `null`. */
function normalisedOperationName({ body }: { body: Record<string, unknown> }): string | null {
  const { operationName } = body;
  if (typeof operationName !== "string") {
    return null;
  }
  return operationName;
}

/**
 * An operation declaring no arguments sends no `variables`; the normalised form writes that as `null`, so it
 * matches a client that sends an explicit `null` for the same operation.
 */
function normalisedVariables({ body }: { body: Record<string, unknown> }): unknown {
  const { variables } = body;
  if (variables === undefined) {
    return null;
  }
  return variables;
}

/** Strip fragment blocks (their internals churn across SDK bumps) + collapse whitespace. Pure. */
function normalizeGraphqlQuery({ query }: { query: string | undefined }): string | null {
  if (query === undefined) {
    return null;
  }
  const fragmentMatch = /\n\s*fragment\s/.exec(query);
  // A query with no fragment block is all operation, so it is kept whole.
  const operationOnly = (fragmentMatch === null ? query : query.slice(0, fragmentMatch.index)).trim();
  return operationOnly.replace(/\s+/g, " ");
}

/** Recursively sort object keys so variable ordering never affects the match/persist form. Pure. */
function sortValue({ value }: { value: unknown }): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortValue({ value: entry }));
  }
  if (isRecord(value)) {
    const record = value;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).toSorted()) {
      sorted[key] = sortValue({ value: record[key] });
    }
    return sorted;
  }
  return value;
}
