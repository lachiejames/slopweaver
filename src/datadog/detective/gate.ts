/**
 * The census gate — whether a question's keywords hit anything Datadog can answer, decided LOCALLY. Pure.
 *
 * ## Why a gate at all, and what it is not
 *
 * It is not a rate-limit trick and it is not caution. It is the join the whole design turns on: the store
 * knows what was SAID and Datadog knows what HAPPENED, and a question is routed to the second only when the
 * census already names something the question is about. A question about a person, a decision or a
 * commercial term hits nothing here and never touches the network; a question naming a service, a log
 * pattern, a span operation, a monitor, an error code, a metric, a pipeline or a test suite hits, and one
 * detective opens on it.
 *
 * The lap-two question the owner asked of an earlier page — "is the partners sync still running" — is the
 * worked example, and it works because a service on that census was named in the shape of
 * `acme-nightly-job-sync-partners`: the keyword `partners` matches that service name as a substring, the
 * census says how much it wrote, and that is a lead.
 *
 * ## What the census widened
 *
 * The sampled catalogue this replaced could only match a service, an emitting site, an error code, a RUM
 * application, a metric NAMESPACE or a monitor. A census holds every shape of every product, so a keyword now
 * also matches a log pattern's own template, a span operation, a metric's full name, a pipeline, a test suite
 * and the members underneath a row — the resources, jobs and tables. That is what makes "why is
 * `POST /v1/sessions` slow" a Datadog question without anybody teaching the gate about sessions.
 *
 * ## Matching is case-insensitive containment, in both directions
 *
 * A keyword is a fragment of what a person typed and a census name is a slug an engineer chose, so neither
 * contains the other reliably: `partners` is inside `acme-nightly-job-sync-partners`, while `P2028` CONTAINS
 * nothing and is contained by nothing — it is the whole of an `@err.code` value. Testing containment both
 * ways covers the two cases with one rule, and the cost is a wider net on very short keywords, which
 * {@link MIN_KEYWORD_CHARS} is what bounds.
 *
 * ## Why the gate never reads a monitor's query as prose
 *
 * A monitor's query is matched as text, so the keyword `error` hits almost every monitor on the
 * organisation. That is deliberate and it is why a monitor hit is its own, WEAKER hit kind rather than being
 * folded in with a service hit: a detective reads the kind and knows that "37 monitors mention this" is a
 * different claim from "a service is called this".
 */

import type { CensusRow } from "../census/row.js";
import type { Catalogue } from "./catalogue.js";
import { serviceTotals } from "./catalogue.js";
import { facetValues } from "./facets.js";

/**
 * The shortest keyword the gate will match on.
 *
 * Three, matching `src/store/probe/shapes.ts`'s own trigram floor and for a related reason: below three
 * characters containment stops discriminating at all — `id`, `ui` and `db` are inside a large fraction of
 * every slug an engineer has ever written — so a two-character keyword would route every question to
 * Datadog and the gate would have no effect except its cost.
 */
export const MIN_KEYWORD_CHARS = 3;

/** What kind of thing in the census a keyword hit, weakest last. */
export const HIT_KINDS = [
  "service",
  "shape",
  "member",
  "error-code",
  "metric",
  "rum-application",
  "metric-namespace",
  "monitor",
] as const;

/** One hit kind's id. */
export type HitKind = (typeof HIT_KINDS)[number];

/** One thing in the census that a keyword matched. *
 * @internal
 */
export interface CatalogueHit {
  readonly keyword: string;
  readonly kind: HitKind;
  /** What was matched, verbatim — a service name, a pattern template, a span operation, a monitor title. */
  readonly matched: string;
  /** The service the match belongs to, when the match names one. */
  readonly service: string | null;
}

/** What the gate concluded for one question. */
export interface GateVerdict {
  /** Every hit, strongest kind first. */
  readonly hits: readonly CatalogueHit[];
  /** The services worth briefing a detective on, in descending order of how much they emit. */
  readonly services: readonly string[];
  /** Keywords the gate refused to match on, and why — never silently dropped. */
  readonly skipped: readonly string[];
}

/** Case-insensitive containment in either direction. */
function touches({ keyword, value }: { keyword: string; value: string }): boolean {
  const left = keyword.toLowerCase();
  const right = value.toLowerCase();
  return right.includes(left) || left.includes(right);
}

/**
 * Order hits by how much they narrow — a service name is worth more than a monitor that mentions the word.
 *
 * @returns the rank, lower is stronger
 */
function rankOf({ kind }: { kind: HitKind }): number {
  return HIT_KINDS.indexOf(kind);
}

/**
 * Whether one facet path holds error codes, which are matched as a hit kind of their own.
 *
 * @param path the flattened facet path
 * @returns true when its values are error codes
 */
function isErrorCodeFacet({ path }: { path: string }): boolean {
  return path.endsWith("err.code") || path.endsWith("error.kind");
}

/**
 * The hits one keyword produces against a census row — its label, its members, its error codes.
 *
 * A metric row is its own hit kind, because a metric NAME is a much stronger lead than a pattern that
 * happens to mention the same word: naming a metric is naming a query a detective can run immediately.
 *
 * @param keyword one keyword, already known to be long enough to discriminate
 * @param catalogue the built census
 * @returns every hit the rows produced
 */
function rowHits({ catalogue, keyword }: { catalogue: Catalogue; keyword: string }): readonly CatalogueHit[] {
  return catalogue.rows.flatMap((row) => oneRowHits({ keyword, row }));
}

/**
 * The hits one keyword produces against ONE row — its label, its members and its error codes.
 *
 * Split from {@link rowHits} because the three sources nested inside a loop over every row is the shape the
 * complexity gate refuses, and a reader of the nested version cannot hold which source a given hit came
 * from.
 *
 * @param keyword one keyword
 * @param row one census row
 * @returns the hits, in no particular order
 */
function oneRowHits({ keyword, row }: { keyword: string; row: CensusRow }): readonly CatalogueHit[] {
  const service = row.service === "(none)" ? null : row.service;
  const label = touches({ keyword, value: row.label })
    ? [
        {
          keyword,
          kind: row.product === "metrics" ? ("metric" as const) : ("shape" as const),
          matched: row.label,
          service,
        },
      ]
    : [];
  const members = row.members
    .filter((member) => touches({ keyword, value: member.name }))
    .map((member): CatalogueHit => ({ keyword, kind: "member", matched: member.name, service }));
  const codes = row.facets
    .filter((facet) => isErrorCodeFacet({ path: facet.path }))
    .flatMap((facet) => facetValues({ facet }))
    .filter((value) => touches({ keyword, value }))
    .map((value): CatalogueHit => ({ keyword, kind: "error-code", matched: value, service }));
  return [...label, ...members, ...codes];
}

/**
 * The hits one keyword produces against everything in the census that carries a name.
 *
 * One function per keyword rather than one loop over every source inside a loop over keywords: the nesting
 * is what made the original score 46 against a ceiling of 12, and a reader of a 46 cannot hold which of the
 * sources a given `push` belonged to.
 *
 * @param catalogue the built census
 * @param keyword one keyword, already known to be long enough to discriminate
 * @param byVolume the per-service totals, so a service hit carries the service it names
 * @returns every hit this keyword produced, in no particular order
 */
function hitsForKeyword({
  catalogue,
  keyword,
  byVolume,
}: {
  catalogue: Catalogue;
  keyword: string;
  byVolume: ReadonlyMap<string, number>;
}): readonly CatalogueHit[] {
  const map = catalogue.manifest.map;
  const lower = keyword.toLowerCase();
  return [
    ...[...byVolume.keys()]
      .filter((service) => touches({ keyword, value: service }))
      .map((service): CatalogueHit => ({ keyword, kind: "service", matched: service, service })),
    ...rowHits({ catalogue, keyword }),
    ...map.rumApplications
      .filter((app) => touches({ keyword, value: app.name }))
      .map((app): CatalogueHit => ({ keyword, kind: "rum-application", matched: app.name, service: null })),
    ...map.metricNamespaces
      .filter((namespace) => touches({ keyword, value: namespace.namespace }))
      .map((namespace): CatalogueHit => ({
        keyword,
        kind: "metric-namespace",
        matched: namespace.namespace,
        service: null,
      })),
    ...map.monitors
      .filter((monitor) => touches({ keyword, value: monitor.name }) || monitor.query.toLowerCase().includes(lower))
      .map((monitor): CatalogueHit => ({ keyword, kind: "monitor", matched: monitor.name, service: null })),
  ];
}

/**
 * Probe one question's keywords against the local census.
 *
 * Touches no network and opens no client: this is the half of the design that costs nothing, and a question
 * that fails it costs nothing at all.
 *
 * @param catalogue the built census, already read
 * @param keywords the question's keywords, exactly as a caller typed them
 * @returns every hit, the services to brief on, and the keywords that were too short to match
 */
export function probeCatalogue({
  catalogue,
  keywords,
}: {
  catalogue: Catalogue;
  keywords: readonly string[];
}): GateVerdict {
  const byVolume = serviceTotals({ catalogue });
  const short = keywords.filter((keyword) => keyword.trim().length < MIN_KEYWORD_CHARS);
  const usable = keywords.filter((keyword) => keyword.trim().length >= MIN_KEYWORD_CHARS);
  const hits = usable.flatMap((keyword) => hitsForKeyword({ byVolume, catalogue, keyword }));
  const skipped = short.map(
    (keyword) => `"${keyword}" is under ${String(MIN_KEYWORD_CHARS)} characters — too short to discriminate`,
  );
  const named = new Set(hits.map((hit) => hit.service).filter((service): service is string => service !== null));
  return {
    hits: dedupe({ hits }).toSorted((left, right) => rankOf({ kind: left.kind }) - rankOf({ kind: right.kind })),
    services: [...named].toSorted(
      (left, right) =>
        volumeOf({ byVolume, service: right }) - volumeOf({ byVolume, service: left }) || left.localeCompare(right),
    ),
    skipped,
  };
}

/**
 * How much one service emits, with an unmeasured service reading as zero rather than as absent.
 *
 * @param byVolume the per-service totals
 * @param service the service to size
 * @returns the events, or zero when the census has no volume for it
 */
function volumeOf({ byVolume, service }: { byVolume: ReadonlyMap<string, number>; service: string }): number {
  const seen = byVolume.get(service);
  if (seen === undefined) {
    return 0;
  }
  return seen;
}

/**
 * Collapse hits that say the same thing.
 *
 * One keyword matching one service across five rows is one hit, not five: the row count is an artefact of
 * how the census is stored and a detective reading "partners matched acme-nightly-job-sync-partners" five
 * times learns nothing on the second.
 *
 * @returns the hits, each distinct triple once
 */
function dedupe({ hits }: { hits: readonly CatalogueHit[] }): CatalogueHit[] {
  const seen = new Map<string, CatalogueHit>();
  for (const hit of hits) {
    seen.set(`${hit.keyword}|${hit.kind}|${hit.matched}`, hit);
  }
  return [...seen.values()];
}
