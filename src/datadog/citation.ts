/**
 * Validating a Datadog link before it ships as evidence.
 *
 * ## Why a link needs checking at all when one builder makes them
 *
 * `ddLink.ts` builds every link in this package, so a link it produced is well-formed by construction. But
 * a link that reaches a claim has not always come from there: it is pasted out of a console, carried across
 * from an older tool, or assembled by an agent that had the pieces and improvised. **A citation that does
 * not resolve is worse than no citation** — it reads as proof, survives review because nobody clicks every
 * link, and the reader who does click sees an empty view and concludes the finding was wrong.
 *
 * That is the gap this module closes, and the reason it sits next to the builder rather than inside any one
 * verb: a link is evidence wherever it appears, so the check belongs with the link vocabulary.
 *
 * ## What a naive validator gets wrong
 *
 * The design here accumulates every violation, demands an absolute window, rejects a visibility-scoped deep
 * link, and rejects the spaces-in-wildcard case. Four traps a naive implementation falls into:
 *
 * 1. **Hard-coding the console host.** That is exactly the second-source-of-truth for "which org am I
 *    talking to" that `config.ts` refuses, and it makes the validator wrong on any other site. The expected
 *    host is a parameter, taken from `DatadogConfig.consoleHost`.
 * 2. **Demanding `live=false` AND `paused=true` on every link.** Those are different domains' freeze
 *    params: `logs` and `traces` freeze with `from_ts`/`to_ts`/`live=false`, and `rum` with
 *    `start`/`end`/`paused=true`. A validator built that way would reject a correctly frozen logs link.
 *    Both sides now read {@link DD_LINK_FREEZE}, which is the point — the `traces` row moved to the logs
 *    params once `ddLink.ts` MEASURED the APM ones clamping a 24-hour view to 15 minutes (its
 *    header carries the repro), and this paragraph went on saying `traces`/`rum` after that landed. Read the
 *    table, never this prose, when the two disagree.
 * 3. **Requiring an env gate on every citation.** This package's position is that an env filter is an
 *    explicit opt-in and never a default, because a meaningful share of a real estate's logs carry no `env`
 *    tag and an env-scoped query silently drops them. Requiring the gate unconditionally would make the
 *    validator demand the narrowing the rest of the package refuses. It is checked only when the caller
 *    says the claim was prod-scoped — conditional on having asked, the same shape as the group-by guard.
 * 4. **Requiring an `@`-prefixed attribute facet in every query.** Datadog's reserved facets are queried
 *    WITHOUT the `@` — `service:example-api status:error` is correct and `@service:example-api` silently
 *    matches nothing — so that rule rejects the right form and demands a wrong one. The genuine rule
 *    underneath is the no-free-text one, which survives on its own.
 *
 * ## The two query rules that do survive
 *
 * - **No quoted free-text term.** A phrase match is not a facet query; it drifts as log wording changes and
 *   it cannot be reproduced from an atlas. Conditional on having asked, like the env gate above it: a
 *   caller whose claim IS a phrase match — a declared alert probe watching a throw site's own log line —
 *   says so with `allowPhraseMatch`, and carries the drift cost as stated residue instead.
 * - **No spaces inside a wildcard.** A wildcard value containing whitespace can count in an API response
 *   and render **0 rows** in the console UI. That divergence is the console's own parsing, so a link
 *   carrying one is a citation that reliably shows nothing to whoever clicks it.
 */
import { err, ok, type Result } from "../lib/result.js";
import { type DatadogCitationError, DatadogCitationErrors } from "./citationErrors.js";
import { DD_LINK_FREEZE, DD_LINK_PATHS, type DdLinkDomain } from "./ddLink.js";
import { DEFAULT_PROD_ENVS, prodEnvFilter } from "./prodEnvFilter.js";

/**
 * A wildcard containing whitespace: `:*…space…*`.
 *
 * Anchored on the `:*` opening so it only matches a wildcard VALUE, and the inner classes exclude `*` so it
 * cannot span two separate wildcards and report a false positive on `@a:*x* @b:*y*`.
 *
 * The first run is `[^*\s]*` rather than a second `[^*]*`, so the two quantifiers either side of the
 * mandatory `\s` never overlap in what they can match — two adjacent `[^*]*` runs around the same literal
 * are the classic redos shape (ambiguous decomposition: many equivalent ways to split the string between
 * them), and this rewrite has exactly one.
 */
const SPACES_IN_WILDCARD = /:\*[^*\s]*\s[^*]*\*/;

/** A quoted phrase term — free text rather than a facet query. */
const QUOTED_PHRASE = /"[^"]*"/;

/** What a citation must satisfy to be usable as evidence, and what it is being cited for. */
export interface CitationExpectation {
  /**
   * Whether this claim's evidence IS a phrase match, so the no-free-text rule does not apply to it.
   *
   * Conditional on having asked, exactly as `requireProdEnv` is, and required rather than defaulted so
   * every caller states which kind of claim it is making. The rule below is right about the general case
   * and wrong about one real one: an alert probe watching a known failure signature cites the throw
   * site's own log line, because that string IS the signal — there is no facet carrying "this catch
   * fired". Such a link resolves perfectly; what it cannot do is be reproduced from an atlas when the
   * wording changes, and that cost belongs on the card as stated residue rather than on a validator that
   * would otherwise refuse the only citation the claim has.
   *
   * Set it `false` anywhere the query was assembled rather than declared — an improvised phrase match is
   * the case the rule was written for and nothing here softens it.
   */
  readonly allowPhraseMatch: boolean;
  /** The console host from the validated config. Never a literal — see the file header. */
  readonly consoleHost: string;
  /** Which console area the citation should open. Its path and freeze params follow from this. */
  readonly domain: DdLinkDomain;
  /** Whether the claim was prod-scoped, so the env gate is required. Conditional on having asked. */
  readonly requireProdEnv: boolean;
  /** How the citation is named in each violation, so validating several says which one failed. */
  readonly label: string;
  /** The env tag values a required prod-env gate must carry; defaults to {@link DEFAULT_PROD_ENVS}. */
  readonly prodEnvs?: readonly string[];
}

/**
 * Check a citation URL, accumulating every violation rather than stopping at the first.
 *
 * Accumulating is deliberate: a link with three problems should be fixed in one pass, and a validator that
 * reports them one at a time trains the reader to fix the symptom it happened to name.
 *
 * @param url the citation URL
 * @param expectation what this citation has to be
 * @returns the parsed URL on success, or every reason it is not usable as evidence
 */
export function validateCitation({
  url,
  expectation,
}: {
  url: string;
  expectation: CitationExpectation;
}): Result<URL, DatadogCitationError> {
  const { label } = expectation;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return err(DatadogCitationErrors.urlInvalid({ label, url }));
  }
  const violations = [
    ...checkTarget({ parsed, expectation }),
    ...checkQuery({ parsed, expectation }),
    ...checkWindow({ parsed, expectation }),
  ];
  if (violations.length > 0) {
    return err(DatadogCitationErrors.citationRefused({ label, violations }));
  }
  return ok(parsed);
}

/**
 * Check the citation points at the right org and a searchable view.
 *
 * The path check is what rejects a visibility-scoped deep link — a single-record deep link renders empty
 * for most viewers. The general rule — it must be the domain's own search path — covers that and every
 * sibling of it without a list of known-dead paths.
 */
function checkTarget({ parsed, expectation }: { parsed: URL; expectation: CitationExpectation }): readonly string[] {
  const { label, consoleHost, domain } = expectation;
  const violations: string[] = [];
  if (parsed.host !== consoleHost) {
    violations.push(
      `${label}: must point at ${consoleHost}, got ${parsed.host} — a link to another Datadog site opens an org that answers with silence rather than an error`,
    );
  }
  const expectedPath = DD_LINK_PATHS[domain];
  if (parsed.pathname !== expectedPath) {
    violations.push(
      `${label}: must be a ${expectedPath} search view, got ${parsed.pathname} — a deep link to a single record is visibility-scoped and renders empty for most viewers`,
    );
  }
  return violations;
}

/** Check the query is a reproducible facet query rather than free text. */
function checkQuery({ parsed, expectation }: { parsed: URL; expectation: CitationExpectation }): readonly string[] {
  const { label, requireProdEnv, allowPhraseMatch, prodEnvs = DEFAULT_PROD_ENVS } = expectation;
  const query = parsed.searchParams.get("query");
  if (query === null || query.trim() === "") {
    return [`${label}: carries no query, so it opens the whole domain rather than the claim's evidence`];
  }
  const violations: string[] = [];
  if (!allowPhraseMatch && QUOTED_PHRASE.test(query)) {
    violations.push(
      `${label}: query contains a quoted free-text term, which drifts as log wording changes and cannot be reproduced from the atlas`,
    );
  }
  if (SPACES_IN_WILDCARD.test(query)) {
    violations.push(
      `${label}: query uses a wildcard containing spaces, which counts in an API response and renders 0 rows in the console — so the citation shows nothing to whoever clicks it`,
    );
  }
  const expectedProdFilter = prodEnvFilter({ prodEnvs });
  if (requireProdEnv && !query.includes(expectedProdFilter)) {
    violations.push(
      `${label}: the claim is prod-scoped, so the query must carry ${expectedProdFilter} — a query filtered on only one prod env value silently drops traffic tagged with another`,
    );
  }
  return violations;
}

/**
 * Check the window is absolute and pinned, using the domain's own freeze params.
 *
 * An unpinned link opens live at "now", so the number in a claim and the view a reader gets on clicking it
 * silently diverge.
 */
function checkWindow({ parsed, expectation }: { parsed: URL; expectation: CitationExpectation }): readonly string[] {
  const { label, domain } = expectation;
  const spec = DD_LINK_FREEZE[domain];
  const violations: string[] = [];
  const from = epochParam({ parsed, name: spec.from });
  const to = epochParam({ parsed, name: spec.to });
  if (from === null || to === null) {
    violations.push(
      `${label}: must carry an absolute window as ${spec.from} and ${spec.to} in epoch milliseconds — a relative or absent window opens live at 'now', so the cited number and the view diverge`,
    );
  } else if (from >= to) {
    violations.push(
      `${label}: window is inverted — ${spec.from} ${String(from)} is not before ${spec.to} ${String(to)}`,
    );
  }
  const pin = parsed.searchParams.get(spec.pin);
  if (pin !== spec.pinValue) {
    violations.push(
      `${label}: must set ${spec.pin}=${spec.pinValue} to pin the ${domain} view; got ${quotedPin({ pin })}`,
    );
  }
  return violations;
}

/**
 * The pin parameter a refused citation actually carried, quoted back in its violation.
 *
 * A link copied from a console view that was never frozen, or assembled by hand, carries no pin parameter at
 * all, so `searchParams` has no value to quote and the violation names that absence rather than printing an
 * empty `got`.
 */
function quotedPin({ pin }: { pin: string | null }): string {
  if (pin === null) {
    return "(absent)";
  }
  return pin;
}

/**
 * Read a parameter as a positive epoch-millisecond integer.
 *
 * Exact-integer matching rather than `Number()`, for the reason `window.ts` gives: a coercion would take
 * the `8` out of `8x` and resolve a typo to 1970, which reads downstream as a legitimately empty window.
 *
 * @param parsed the parsed URL
 * @param name the parameter to read
 * @returns the epoch milliseconds, or `null` when absent or not a clean positive integer
 */
function epochParam({ parsed, name }: { parsed: URL; name: string }): number | null {
  const raw = parsed.searchParams.get(name);
  if (raw === null || !/^\d+$/.test(raw.trim())) {
    return null;
  }
  const value = Number.parseInt(raw.trim(), 10);
  return value > 0 ? value : null;
}
