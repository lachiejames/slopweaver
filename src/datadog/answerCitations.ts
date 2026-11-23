/**
 * Checking the Datadog links an ANSWER cites, from the answer's own bytes — the half of `./citation.ts` that
 * needs no caller intent, so it can run on a path that has none.
 *
 * ## The measured failure this exists for
 *
 * Review verdicts classify CLAIMS, never citations: a reviewer re-derives every number through the API, and
 * nobody clicks the links. The verdicts sit under `$SLOPWEAVER_HOME/live/slack/reviews/<thread>/`. So a bad
 * claim is caught by adding review rounds and a bad citation is invariant to them — which is why the owner's
 * rule, that the ways the reviewers were catching be made structurally impossible, lands here rather than on
 * one more round.
 *
 * Two citation defects of that kind, both decidable from the URL with no network call:
 *
 * 1. **A metric-explorer citation with no `exp_scope`** beside a sibling citation that was scoped. An unscoped
 *    metric-explorer link is an every-instance average over every reporting instance in the org — non-production
 *    instances and replicas included — so an answer that reads a figure off it and rules a system out is
 *    resting on a number that system never produced. Finding it by review means re-running the metric;
 *    `searchParams.get("exp_scope")` answers it.
 * 2. **A `/apm/traces` citation frozen with `start`/`end`/`paused=true`** — the documented APM params.
 *    `./ddLink.ts`'s header holds the measurement: the console rewrites that address to
 *    `start=<end - 900000>` and opens the view on **15 minutes**, so a citation whose claim window is longer
 *    shows the reader a slice of it. Review never catches it, because catching it means clicking.
 *
 * ## Why this is not `validateCitation` called directly
 *
 * That function takes a `CitationExpectation` — the console host, which domain the link was MEANT to
 * open, whether the claim was prod-scoped, whether a phrase match was declared. A gate reading a composed
 * answer has none of those: it has a URL and nothing else. So the rules split by whether they need intent.
 *
 * **Applied here**, because the URL alone decides them: the host is a Datadog console, the path is a view this
 * table knows, the window is absolute and pinned with that view's own freeze params, and a metric view names
 * both a metric and something that differentiates it — an `exp_scope` or an `exp_group`.
 *
 * **Deliberately NOT applied here**, and the escape is stated rather than closed:
 *
 * - The **prod-env gate** is conditional on `requireProdEnv` in the original, because this package's position
 *   is that an env filter is an opt-in — a meaningful share of a real estate's logs carry no `env` tag and an
 *   env-scoped query silently drops them. Nothing in a URL says whether the claim it supports was prod-scoped.
 * - The **quoted free-text rule** is conditional on `allowPhraseMatch`, and a declared alert probe watching a
 *   throw site's own log line legitimately IS a phrase match. Applying it blind would refuse a correct
 *   citation, and `../admit/declinedAtlasGate.ts`'s header carries the governing principle: a gate that never
 *   false-refuses is the only kind that survives contact.
 * - A **path this table does not know** yields nothing at all. `/apm/services/<service>` is one such path
 *   — a real view with its own freeze behaviour nobody here has measured — and inventing a rule for it would
 *   be guessing in the direction that refuses good work.
 *
 * ## Two things it does not reach, stated rather than left to be discovered
 *
 * Both are UNDER-refusals — the direction that ships a bad citation rather than refusing a good one — and
 * neither is an oversight:
 *
 * - **Only `answer.citations` is judged.** A Datadog URL written into a `link` run in the body or the fold is
 *   invisible here. The citation array is what a reader clicks as evidence for a claim, and it is where both
 *   measured defects lived; widening to every URL in the form would start judging links offered as "here is
 *   the dashboard" rather than as proof of a number.
 * - **`ddog-gov.com` is outside the host test.** No install here talks to a Datadog GovCloud site, so the
 *   pattern would be an untested guess about an address space nothing has produced. Add the alternation, and a
 *   real citation to test it against, when one exists.
 *
 * ## Why the host test recognises the vendor and never the org
 *
 * `./config.ts` refuses a hard-coded console host, because a literal would be a second source of truth for
 * which org the tool talks to. This module does not pick an org: it asks whether a URL is a Datadog console
 * address at all, which is what decides whether the link is IN this check's criterion. A citation pointing at
 * the wrong Datadog SITE is `validateCitation`'s job, where the expected host arrives as data.
 *
 * Everything here is pure — a string in, a list of violations out.
 */
import { DD_CITED_VIEW_FREEZE, DD_CITED_VIEW_PATHS, type DdCitedView, type DdFreezeSpec } from "./ddLink.js";

/** Hosts that are a Datadog console. Recognising the vendor, never asserting which org — see the header. */
const DATADOG_CONSOLE_HOST = /(?:^|\.)datadoghq\.(?:com|eu)$/u;

/** The views this module judges. Order carries nothing — the path match below is exact, never a prefix. */
const CITED_VIEWS: readonly DdCitedView[] = ["logs", "traces", "rum", "metrics"];

/**
 * Which cited view a URL's path opens, or `undefined` when this module knows no rules for it.
 *
 * Exact-path matching rather than a prefix test. A prefix would claim `/apm/services/<service>` as the
 * traces view and judge it by traces' freeze params, which is exactly the guessing the header refuses.
 *
 * @param pathname the URL's path, already parsed
 * @returns the view, or `undefined` when the path is outside this module's criterion
 */
export function citedViewOfPath({ pathname }: { pathname: string }): DdCitedView | undefined {
  return CITED_VIEWS.find((view) => DD_CITED_VIEW_PATHS[view] === pathname);
}

/**
 * Read a parameter as a positive epoch-millisecond integer.
 *
 * Exact-integer matching rather than `Number()`, for the reason `./window.ts` gives: a coercion would take the
 * `8` out of `8x` and resolve a typo to 1970, which reads downstream as a legitimately empty window.
 *
 * @param parsed the parsed URL
 * @param name the parameter to read
 * @returns the epoch milliseconds, or `undefined` when absent or not a clean positive integer
 */
function epochParam({ parsed, name }: { parsed: URL; name: string }): number | undefined {
  const raw = parsed.searchParams.get(name);
  if (raw === null || !/^\d+$/u.test(raw.trim())) {
    return undefined;
  }
  const value = Number.parseInt(raw.trim(), 10);
  if (value <= 0) {
    return undefined;
  }
  return value;
}

/**
 * Every reason a cited view's window is not pinned to the window the claim was computed over.
 *
 * @param parsed the parsed citation URL
 * @param spec the view's own freeze params
 * @param view the view being judged, named in the message so a reader knows which table decided it
 * @returns the violations, empty when the view is frozen correctly
 */
function freezeViolations({
  parsed,
  spec,
  view,
}: {
  parsed: URL;
  spec: DdFreezeSpec;
  view: DdCitedView;
}): readonly string[] {
  const violations: string[] = [];
  const from = epochParam({ parsed, name: spec.from });
  const to = epochParam({ parsed, name: spec.to });
  if (from === undefined || to === undefined) {
    violations.push(
      `the ${view} view freezes with ${spec.from} and ${spec.to} in epoch milliseconds and this link carries neither, so it opens live at 'now' and the reader sees a different window from the one the claim was computed over`,
    );
  } else if (from >= to) {
    violations.push(`the window is inverted — ${spec.from} ${String(from)} is not before ${spec.to} ${String(to)}`);
  }
  const pin = parsed.searchParams.get(spec.pin);
  if (pin === null) {
    violations.push(`the ${view} view is pinned by ${spec.pin}=${spec.pinValue}, and this link carries (absent)`);
  } else if (pin !== spec.pinValue) {
    violations.push(`the ${view} view is pinned by ${spec.pin}=${spec.pinValue}, and this link carries ${pin}`);
  }
  return violations;
}

/** Whether a metric-explorer param carries a value rather than being absent or blank. */
function hasValue({ parsed, name }: { parsed: URL; name: string }): boolean {
  const raw = parsed.searchParams.get(name);
  if (raw === null) {
    return false;
  }
  return raw.trim() !== "";
}

/**
 * Every reason a metric-explorer citation does not show a reader the thing its claim is about.
 *
 * Without a scope the explorer renders ONE line: the metric blended across every reporting instance in the
 * org. A claim about one named system then rests on a number that system never produced — the first defect in
 * this file's header, where the blend takes in non-production instances and replicas.
 *
 * **`exp_group` discharges it as surely as `exp_scope`**, and getting that wrong is the one false refusal this
 * check was MEASURED producing. A sweep over every citation this install's reviewed answers had shipped
 * surfaced an unscoped database metric and `datadog.estimated_usage.apm.ingested_bytes` summed with
 * `exp_group=service`. The second is not the defect —
 * it is an estate-wide usage claim, and a group-by renders one series per service rather than one blended
 * line, so the named system's own line is exactly what a reader sees. The criterion is about what the READER
 * is shown, so a breakdown satisfies it and only an undifferentiated average does not.
 *
 * @param parsed the parsed citation URL
 * @returns the violations, empty when the link names a metric and either scopes or breaks it down
 */
function metricViolations({ parsed }: { parsed: URL }): readonly string[] {
  const violations: string[] = [];
  if (!hasValue({ parsed, name: "exp_metric" })) {
    violations.push("a metric explorer link names its metric in exp_metric, and this one names none");
  }
  const differentiated = hasValue({ parsed, name: "exp_scope" }) || hasValue({ parsed, name: "exp_group" });
  if (!differentiated) {
    violations.push(
      "a metric explorer link with neither exp_scope nor exp_group renders the metric blended across every reporting instance in the org, so a claim about one named system rests on a number that system never produced",
    );
  }
  return violations;
}

/**
 * Every reason this URL is not usable as Datadog evidence, judged from the URL alone.
 *
 * Accumulating rather than stopping at the first, for `./citation.ts`'s reason: a link with three problems
 * should be fixed in one pass, and a validator reporting them one at a time trains the reader to fix the
 * symptom it happened to name.
 *
 * @param url the citation URL exactly as the answer carries it
 * @returns the violations; empty both when the link is sound and when it is outside this module's criterion,
 *   which the caller cannot distinguish and does not need to
 */
export function datadogCitationIssues({ url }: { url: string }): readonly string[] {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return [];
  }
  if (!DATADOG_CONSOLE_HOST.test(parsed.host)) {
    return [];
  }
  const view = citedViewOfPath({ pathname: parsed.pathname });
  if (view === undefined) {
    return [];
  }
  const freeze = freezeViolations({ parsed, spec: DD_CITED_VIEW_FREEZE[view], view });
  if (view !== "metrics") {
    return freeze;
  }
  return [...freeze, ...metricViolations({ parsed })];
}
