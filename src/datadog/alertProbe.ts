/**
 * An ALERT PROBE SET — the declared, per-install half of a scheduled Datadog investigation, and the pure
 * derivation that turns what those probes counted into the digest form `slack post --as bot` already takes.
 *
 * ## Why the probes are configuration and the derivation is code
 *
 * This module is the slopweaver-side design of three daily postings that ran out of the private work
 * console — the Knock, growth-ops and integrity-audit alerts. Re-implemented here rather
 * than lifted: what came across is the SHAPE (a named log query per known failure signature, counted over
 * a window, rendered as one triage row carrying its own frozen console link), and what deliberately did
 * not is the queries themselves. A query names this organisation's services, its log wording and its
 * invariant keys; a query set shipped in the repository would put one install's estate in everyone's
 * source, which is the step the v2 audit called a hard gate. So the set arrives as `params` on a recipe
 * definition (`$SLOPWEAVER_HOME/live/recipe/definitions`) or as a `--probes` document, and this file
 * decides only what may be run and what the result means.
 *
 * ## The severity rule is arithmetic, never a judgement
 *
 * A probe declares the severity it carries WHEN IT FIRES, and which side of zero counts as firing. A probe
 * on the good side of that line is green, whatever it declared. That is the whole rule, and it is the
 * reason this file can be trusted with a card that posts unattended: there is no sentence to read, no
 * threshold to tune and no way for a quiet window to render red. `digest.ts` calls severity a FACT the
 * composer looked up, and this is where it is looked up.
 *
 * A probe that declares `green` stays green at any count — the benign-skip class the growth-ops posting
 * has always carried. That is not an exception to the rule; it is the rule applied to a probe whose firing
 * severity is green.
 *
 * ## What a probe may NOT do
 *
 * It cannot describe layout, choose a channel, name a person, or select anything but its own three shapes.
 * `logs-count` counts matching log events; `logs-facet-sum` totals one numeric attribute across them,
 * which is how an invariant check whose own job already computed a per-row violation count is read without
 * this file re-deciding what "firing" means; `metric-sum` totals a custom metric over a scope. Anything
 * else is a pull request against this file, which is the review the free-form query string is traded for.
 */
import { z } from "zod";

import { err, ok, type Result } from "../lib/result.js";
import type { DigestItem } from "../outbound/artifact/digestFields.js";
import { SEVERITIES, type Severity } from "../outbound/artifact/severity.js";
import { TABLE_MAX_ROWS } from "../outbound/assistant/contentLimits.js";

import { type AlertProbeError, AlertProbeErrors } from "./alertProbeErrors.js";

/**
 * The three measurements a probe may take, every one a read-only aggregate.
 *
 * `logs-count` and `logs-facet-sum` both read the logs index, so their citation IS the query they ran.
 * `metric-sum` reads a custom metric instead, and a metric query is not a console search of any domain —
 * so such a probe declares its own `citation`, naming the search a reader should land in. For a
 * span-derived metric that search is the span the metric counts, in the `traces` domain, which
 * re-derives the number rather than gesturing at it. The asymmetry is the honest one: the alternative is
 * a metric row carrying a link that resolves to nothing, which is the dead-citation failure
 * `citation.ts` exists to prevent.
 */
export const ALERT_PROBE_KINDS = ["logs-count", "logs-facet-sum", "metric-sum"] as const;

/** Which measurement one probe takes.
 *
 * @internal — inferred at every use site; named here so the union reads as one thing.
 */
export type AlertProbeKind = (typeof ALERT_PROBE_KINDS)[number];

/**
 * The digest item title's own cap, restated here so a probe set is refused at PARSE time rather than at
 * the moment it tries to post. `digestFields.ts` owns the number; `alertProbe.test.ts` pins that the two agree.
 */
const PROBE_TITLE_MAX = 80;

/** The digest item's `substance` cap, restated for the same reason and pinned by the same test. */
const PROBE_WHY_MAX = 600;

/**
 * Which way round a probe reads, because not every check alarms on a number going UP.
 *
 * `count-above-zero` is the failure-signature shape: a throw site fired, and zero is the good day.
 * `count-is-zero` is the HEARTBEAT shape: a job that runs on a cadence should leave a trail, and it is the
 * SILENCE that is the alarm. Both are arithmetic — neither reads a threshold or a sentence — and the
 * distinction has to be declared because no property of a query says which kind of check it is. Without
 * it a heartbeat renders green on the day its job stopped, which is the exact failure a heartbeat exists
 * to catch.
 */
export const ALERT_PROBE_ALARM_MODES = ["count-above-zero", "count-is-zero"] as const;

/** Which way round one probe reads.
 *
 * @internal — inferred at every use site; named here so the union reads as one thing.
 */
export type AlertProbeAlarmMode = (typeof ALERT_PROBE_ALARM_MODES)[number];

const alertProbeSchema = z
  .object({
    /**
     * Which way round this probe reads. Defaults to the failure-signature direction, which is what a
     * probe set author almost always means and what every check ported from the private posting was.
     */
    alarmWhen: z.enum(ALERT_PROBE_ALARM_MODES).default("count-above-zero"),
    /** The stable identifier for this check — one row on the card, one line in the report. */
    id: z.string().min(1).max(60),
    /** Which measurement to take. */
    kind: z.enum(ALERT_PROBE_KINDS),
    /**
     * The console search a `metric-sum` row cites, since a metric query is not a search of any domain.
     * Required by `metric-sum`, refused on the two logs kinds, whose own `query` IS their citation.
     */
    citation: z
      .object({
        /** Which console area the link opens — `traces` for a span-derived metric. */
        domain: z.enum(["logs", "traces", "rum"]),
        /** The facet query that search runs. */
        query: z.string().min(1),
      })
      .strict()
      .optional(),
    /**
     * What this probe measures: a logs query for the two logs kinds, a classic metrics query
     * (`sum:name{scope}.as_count()`) for `metric-sum`.
     */
    query: z.string().min(1),
    /** What this row's severity becomes when the probe counts anything at all. */
    severityWhenFiring: z.enum(SEVERITIES),
    /** The numeric attribute to total, `@`-prefixed. Required by `logs-facet-sum`, refused otherwise. */
    sumAttribute: z.string().min(1).optional(),
    /** What a reader sees as the row's name — a short noun phrase, never a sentence. */
    title: z.string().min(1).max(PROBE_TITLE_MAX),
    /** Why this check exists and what firing means, rendered as the item's below-fold paragraph. */
    why: z.string().min(1).max(PROBE_WHY_MAX),
  })
  .strict();

/** One declared check. */
export type AlertProbe = z.infer<typeof alertProbeSchema>;

const alertProbeSetSchema = z
  .object({
    probes: z.array(alertProbeSchema).min(1),
  })
  .strict();

/** A whole declared investigation: every check one posting takes. */
export type AlertProbeSet = z.infer<typeof alertProbeSetSchema>;

/**
 * Whether a probe's optional fields match the kind it selected.
 *
 * Split out so the shape rule is one expression rather than a branch inside the loop: `logs-facet-sum`
 * needs the attribute it sums, and `logs-count` carrying one would silently ignore it — an ignored field
 * is the failure mode `strictForm.ts` records, so it is refused here for the same reason.
 *
 * @param probe the parsed probe
 * @returns why the shape is wrong, or `undefined` when it is right
 */
function probeShapeProblem({ probe }: { probe: AlertProbe }): string | undefined {
  const sumAttribute = probe.sumAttribute;
  const hasSum = sumAttribute !== undefined;
  const hasCitation = probe.citation !== undefined;
  if (probe.kind === "logs-facet-sum" && !hasSum) {
    return "kind 'logs-facet-sum' totals one numeric attribute, so it needs sumAttribute (e.g. '@violations')";
  }
  if (probe.kind !== "logs-facet-sum" && hasSum) {
    return `kind '${probe.kind}' never reads a log attribute, so sumAttribute would be silently ignored`;
  }
  if (sumAttribute !== undefined && !sumAttribute.startsWith("@")) {
    return `sumAttribute must name a log attribute with its '@' prefix, got '${sumAttribute}'`;
  }
  if (probe.kind === "metric-sum" && !hasCitation) {
    return "kind 'metric-sum' runs a metric query, which is not a console search, so it needs a citation naming the search a reader should land in";
  }
  if (probe.kind !== "metric-sum" && hasCitation) {
    return `kind '${probe.kind}' cites the query it ran, so a declared citation would be silently ignored`;
  }
  return undefined;
}

/**
 * Where one Zod issue sits, as a word a reader can act on.
 *
 * A root-level issue has an EMPTY path, and substituting a word for it with `||` is exactly the
 * silent-fallback shape the owner refuses — so the absent case is named rather than defaulted.
 *
 * @param issue one issue from a failed parse
 * @returns the dotted field path, or `(root)` when the issue is about the document itself
 */
function zodIssuePath({ issue }: { readonly issue: { readonly path: readonly PropertyKey[] } }): string {
  const path = issue.path.join(".");
  if (path.length === 0) {
    return "(root)";
  }
  return path;
}

/**
 * Parse an already-decoded probe document into a runnable set, or say exactly why it is not one.
 *
 * Pure: it reads the value and nothing else.
 *
 * @param value the decoded JSON of a `--probes` document or a recipe row's `params.probes` wrapper
 * @returns the probe set, or the one reason it may not run
 */
export function parseAlertProbeSet({ value }: { readonly value: unknown }): Result<AlertProbeSet, AlertProbeError> {
  const parsed = alertProbeSetSchema.safeParse(value);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${zodIssuePath({ issue })}: ${issue.message}`);
    return err(AlertProbeErrors.setInvalid({ issues }));
  }
  if (parsed.data.probes.length > TABLE_MAX_ROWS) {
    return err(AlertProbeErrors.setTooLarge({ cap: TABLE_MAX_ROWS, declared: parsed.data.probes.length }));
  }
  const seen = new Set<string>();
  for (const probe of parsed.data.probes) {
    if (seen.has(probe.id)) {
      return err(AlertProbeErrors.idDuplicated({ probeId: probe.id }));
    }
    seen.add(probe.id);
    const problem = probeShapeProblem({ probe });
    if (problem !== undefined) {
      return err(AlertProbeErrors.shapeMismatch({ detail: problem, probeId: probe.id }));
    }
  }
  return ok(parsed.data);
}

/** What one probe actually measured, once the Datadog call has been made. */
export interface AlertProbeReading {
  readonly probe: AlertProbe;
  /** The count, or the summed attribute total — whichever the probe's kind took. */
  readonly value: number;
  /** The frozen console link this reading was computed from. */
  readonly citationUrl: string;
}

/**
 * Whether a probe's number can be a digest row's count: a whole number, zero or more, and no larger than the
 * form's own `Number.MAX_SAFE_INTEGER` bound (`../outbound/artifact/digestFields.ts`). Checked by the verb
 * BEFORE it emits, so a reading past the bound is a named refusal rather than a form the door loses.
 *
 * @param value the number the probe's aggregate returned
 * @returns true when a card row can carry it as its count
 */
export function isCardCount({ value }: { readonly value: number }): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

/**
 * Whether one reading is ALARMING — the whole of this module's judgement, and it is arithmetic.
 *
 * @param reading what the probe measured
 * @returns true when the number is on the side of zero the probe declared as its alarm
 */
export function readingIsAlarming({ reading }: { readonly reading: AlertProbeReading }): boolean {
  if (reading.probe.alarmWhen === "count-is-zero") {
    return reading.value === 0;
  }
  return reading.value > 0;
}

/**
 * The severity one reading carries.
 *
 * @param reading what the probe measured
 * @returns the probe's declared firing severity when it is alarming, green when it is not
 */
export function readingSeverity({ reading }: { readonly reading: AlertProbeReading }): Severity {
  if (readingIsAlarming({ reading })) {
    return reading.probe.severityWhenFiring;
  }
  return "green";
}

/** How severities sort on the card: worst first, which is the order a reader triages in. */
const SEVERITY_RANK: Readonly<Record<Severity, number>> = { green: 2, orange: 1, red: 0 };

/**
 * Turn one reading into one digest item.
 *
 * Three of the digest item's optional fields are deliberately ABSENT rather than invented, and each
 * absence is a different honest answer:
 *
 * - `state` and `trend` describe a finding's HISTORY, and this build never compares one finding with its
 *   own past — the card's trend is its TOTAL against the windows before it, which `digestAlerts.ts` derives from
 *   `alerts.trend`. A `state` of "detected this run", written by a function that has never seen another
 *   run, reads as history and carries none.
 * - `owner` is a ping. The private posting these three restore guessed one from the most recent committer
 *   to the check's own throw-site file, which needs an identity map keyed by commit email; this install's
 *   map keys people as `person:<slug>`, and `slack post --as bot` REFUSES a digest whose owner does not
 *   resolve. A guess that cannot resolve therefore does not degrade the card — it stops the card going
 *   out at the unattended hour, which is worse than carrying no ping.
 *
 * `substance` rides only on a row that is ALARMING, which is `digestFields.ts`'s own rule for the field —
 * "present on the item that needs a decision; absent on the three that do not". A row on the good side of
 * zero has said everything it has to say in its count, and a paragraph explaining what the other side
 * would have meant is the wall of text rule 7 exists to prevent: on a quiet day it would be the whole card.
 *
 * `impact` is the one enrichment that arrives from outside the reading: the blast radius the verb measured for
 * this probe, when {@link readingImpactIsMeasurable} let it try and the reads succeeded. It is copied only when
 * present, so an unmeasured item carries no key at all rather than an explicit `undefined`.
 *
 * @param reading what the probe measured
 * @param impact the probe's measured blast radius, or undefined when nothing measured one
 * @returns the digest item, ready to sit in a `digest` form's `items`
 */
export function readingToDigestItem({
  reading,
  impact,
}: {
  readonly reading: AlertProbeReading;
  readonly impact: DigestItem["impact"];
}): DigestItem {
  const base = {
    citationUrl: reading.citationUrl,
    count: reading.value,
    severity: readingSeverity({ reading }),
    title: reading.probe.title,
  };
  const item = impact === undefined ? base : { ...base, impact };
  if (!readingIsAlarming({ reading })) {
    return item;
  }
  return { ...item, substance: reading.probe.why };
}

/**
 * Whether the verb may measure this reading's blast radius — the probe's own query as a share of its service.
 *
 * Three conditions, each a reason rather than a budget:
 *
 * - **it is alarming.** A quiet probe ranks `P4` whether its share is known or not, so measuring it spends two
 *   reads to change nothing on the card.
 * - **it alarms on a count ABOVE zero.** A heartbeat alarms on silence: its count is zero, a share of zero bands
 *   `slim`, and `slim` would rank a red "the job stopped" at P3 — below an unmeasured red alert at P2. Its blast
 *   radius is not the events it matched, so it stays unmeasured, which is the honest band.
 * - **its query is a LOGS event search.** `metric-sum` reads a custom metric, which has no event population to
 *   be a share of — the same line the alert-summary lane draws at a metric-threshold monitor.
 *
 * @param reading what the probe measured
 * @returns true when the probe's query can be rerun as a grouped logs search and its share means something
 */
export function readingImpactIsMeasurable({ reading }: { readonly reading: AlertProbeReading }): boolean {
  const { probe } = reading;
  return (
    readingIsAlarming({ reading }) &&
    probe.alarmWhen === "count-above-zero" &&
    (probe.kind === "logs-count" || probe.kind === "logs-facet-sum")
  );
}

/**
 * Whether this probe's count belongs in the trend's totals — this window's and the baseline's alike.
 *
 * The card's current total is the sum of every item that is NOT green (`../outbound/artifact/digest.ts`), and
 * this is the probe-side statement of the same population, so the two sides of the ratio count the same thing:
 *
 * - a `count-above-zero` probe with a non-green firing severity is non-green exactly when its count is above
 *   zero, so its count lands in the current total whenever it could matter, and belongs in the baseline;
 * - a heartbeat (`count-is-zero`) is green while it counts and red only at zero, so it adds nothing to the
 *   current total on any day, and its busy baseline must not be added to the other side either;
 * - a green-declared probe is green at any count, so it is never in the current total and never in the baseline.
 *
 * @param probe the declared check
 * @returns true when this probe's count is summed on both sides of the trend
 */
export function probeCountsTowardTrend({ probe }: { readonly probe: AlertProbe }): boolean {
  return probe.alarmWhen === "count-above-zero" && probe.severityWhenFiring !== "green";
}

/**
 * Order the readings the way the card should carry them: worst severity first, then loudest, then by id.
 *
 * The id tiebreak is what makes the whole ordering total, so two runs over identical numbers produce
 * byte-identical cards — a card that reshuffles its own quiet rows looks like news when nothing changed.
 *
 * @param readings every reading the run took
 * @returns the same readings, ordered for display
 */
export function orderReadings({
  readings,
}: {
  readonly readings: readonly AlertProbeReading[];
}): readonly AlertProbeReading[] {
  return readings.toSorted((left, right) => {
    const bySeverity =
      SEVERITY_RANK[readingSeverity({ reading: left })] - SEVERITY_RANK[readingSeverity({ reading: right })];
    if (bySeverity !== 0) {
      return bySeverity;
    }
    if (left.value !== right.value) {
      return right.value - left.value;
    }
    return left.probe.id.localeCompare(right.probe.id);
  });
}
