/**
 * The pure half of the Datadog leg of `store probe | groups | hits | peek | open | around`.
 *
 * ## One vocabulary, one more source — and the one place the vocabularies genuinely differ
 *
 * A detective already knows six verbs. It should not learn six more to ask Datadog the same questions, so
 * `--source datadog` is a source those verbs accept rather than a second verb family. What it is NOT is a
 * pretence that the two backends are the same: the store's seven search SHAPES exist because Postgres
 * tokenises on punctuation, and Datadog's message index does not, so six of the seven collapse to one
 * there ({@link ../../../datadog/detective/ladder} carries the measurement). Datadog's ladder is four rungs
 * with different names.
 *
 * So `--shape` is the store's flag and `--rung` is Datadog's, and asking for one on the other's source is
 * REFUSED by name rather than silently mapped. A silent mapping is the thing that would make the shared
 * vocabulary a lie: a detective asking for `--shape slash` against Datadog would get a count it could not
 * account for, on a rung Datadog cannot express.
 *
 * ## Every Datadog line states its window
 *
 * The store is local, unthrottled and complete; Datadog is none of those and keeps fifteen days. A count
 * with no window on it is the confident zero the knowledge register's tier-1 row is about, so the window is
 * on the report rather than available from it.
 */

import { DATADOG_RUNGS, type DatadogRung, datadogRungSpec } from "../../../datadog/detective/ladder.js";
import type { DatadogRecord } from "../../../datadog/detective/record.js";
import {
  AROUND_MODES as DATADOG_AROUND_MODES,
  type DatadogAroundMode,
  type DatadogLadderReport,
} from "../../../datadog/detective/search.js";
import type { CensusBucket } from "../../../datadog/groupedAggregate.js";
import type { AbsoluteWindow } from "../../../datadog/window.js";
import { err, ok } from "../../../lib/result.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { parseFlags } from "../../parseFlags.js";
import { type Parsed, refusalLines, StoreCommandErrors } from "./errors.js";

/** The value of `--source` that routes a store verb to Datadog instead of the local store. *
 * @internal
 */
export const DATADOG_SOURCE = "datadog";

/** The window a Datadog leg uses when the caller names none. *
 * @internal
 */
export const DEFAULT_DATADOG_FROM = "7d";

/** The rung `hits` and `groups` page when the caller names none — the one that cuts. *
 * @internal
 */
export const DEFAULT_RUNG: DatadogRung = "all-fields";

/**
 * Whether an invocation's `--source` routes it to Datadog.
 *
 * @returns true when the verb should run against Datadog rather than the local store
 *
 * @internal
 */
export function isDatadogSource({ source }: { source: string | undefined }): boolean {
  return source === DATADOG_SOURCE;
}

/** The window and environment narrowing every Datadog leg takes. */
export interface DatadogScope {
  readonly from: string;
  readonly to: string;
  /** The environments to narrow to. EMPTY means every environment, which is the default — their A ruling. */
  readonly envs: readonly string[];
}

/**
 * Read the window and environment flags a Datadog leg adds to a store verb.
 *
 * `--env` is repeatable in spirit and comma-separated in fact, and its ABSENCE is the meaningful case: no
 * `--env` is every environment, including the events whose env tag is wrong and the events that carry none.
 * Seeing every event, not only production's, is why that is the default rather than production.
 *
 * @param values the already-parsed flags
 * @returns the scope
 */
export function datadogScope({ values }: { values: Readonly<Record<string, string | boolean>> }): DatadogScope {
  const raw = values["env"];
  return {
    envs:
      typeof raw === "string"
        ? raw
            .split(",")
            .map((env) => env.trim())
            .filter((env) => env.length > 0)
        : [],
    from: typeof values["from"] === "string" ? values["from"] : DEFAULT_DATADOG_FROM,
    to: typeof values["to"] === "string" ? values["to"] : "now",
  };
}

/**
 * Read the `--rung` flag against Datadog's closed vocabulary, refusing `--shape` by name.
 *
 * @param values the already-parsed flags
 * @returns the rung, or the refusal naming the four
 */
export function rungOf({ values }: { values: Readonly<Record<string, string | boolean>> }): Parsed<DatadogRung> {
  if (typeof values["shape"] === "string") {
    return err(StoreCommandErrors.datadogShapeRefused({ rungs: DATADOG_RUNGS }));
  }
  const raw = values["rung"];
  if (raw === undefined) {
    return ok(DEFAULT_RUNG);
  }
  const found = DATADOG_RUNGS.find((rung) => rung === raw);
  return found === undefined
    ? err(StoreCommandErrors.rungUnknown({ got: String(raw), known: DATADOG_RUNGS }))
    : ok(found);
}

/**
 * Read the `--mode` flag against Datadog's own correlation vocabulary.
 *
 * The store's modes are `thread` and `container`; Datadog's are the trace, the request, the session, the IP
 * and the service. The `ip` mode is the owner's own investigative move rather than a completion of the set.
 *
 * @param values the already-parsed flags
 * @returns the mode, or the refusal naming the five
 */
export function datadogAroundModeOf({
  values,
}: {
  values: Readonly<Record<string, string | boolean>>;
}): Parsed<DatadogAroundMode> {
  const { mode: raw = "trace" } = values;
  const found = DATADOG_AROUND_MODES.find((mode) => mode === raw);
  return found === undefined
    ? err(StoreCommandErrors.aroundModeUnknown({ got: String(raw), known: DATADOG_AROUND_MODES }))
    : ok(found);
}

/**
 * One line naming the window and environment scope every Datadog report ends with.
 *
 * @returns the line
 *
 * @internal
 */
export function scopeLine({ window, envs }: { window: AbsoluteWindow; envs: readonly string[] }): string {
  const scope = envs.length === 0 ? "every environment" : `env ${envs.join(", ")}`;
  return `over ${new Date(window.fromMs).toISOString()} .. ${new Date(window.toMs).toISOString()}, ${scope}`;
}

/**
 * The human report a Datadog ladder prints.
 *
 * @param report what the ladder found
 * @returns the lines
 */
export function datadogLadderLines({ report }: { report: DatadogLadderReport }): readonly string[] {
  return [
    `keyword ${report.term}   (${String(report.elapsedMs)} ms)`,
    `  ${"rung".padEnd(16)} ${"query".padEnd(28)} ${"lines".padStart(11)}`,
    ...report.rungs.map(
      (rung) =>
        `  ${rung.rung.padEnd(16)} ${datadogRungSpec({ rung: rung.rung }).wildcard.padEnd(28)} ${String(rung.lines).padStart(11)}`,
    ),
    ...collapseLine({ report }),
    "",
    scopeLine({ envs: report.envs, window: report.window }),
    "Datadog has no regex. Pull a bounded page with `store hits --source datadog` and match over it locally.",
  ];
}

/**
 * Where a Datadog ladder's count collapses — the rung worth reading first.
 *
 * The same idea as the store's own collapse, computed over four rungs rather than seven. It is reported only
 * when the drop is at least a factor of two, because on this index the message rungs routinely land within
 * ten lines of each other and calling a 1.0002x difference a collapse would be noise dressed as a finding.
 *
 * @param report what the ladder found
 * @returns the line, or nothing when no rung meaningfully cuts
 */
export function collapseLine({ report }: { report: DatadogLadderReport }): readonly string[] {
  const nonEmpty = report.rungs.filter((rung) => rung.lines > 0);
  const narrowest = nonEmpty[0];
  const widest = nonEmpty[nonEmpty.length - 1];
  if (narrowest === undefined || widest === undefined || narrowest.lines * 2 > widest.lines) {
    return [];
  }
  return [
    `  collapse: ${widest.rung} is ${(widest.lines / narrowest.lines).toFixed(1)}x ${narrowest.rung} — read ${narrowest.rung} first`,
  ];
}

/**
 * One event's status as a fixed-width column, with the absent case named.
 *
 * A Datadog event carries no status at all on the RUM and span surfaces, and a dash is what a reader of a
 * column expects there — said here once rather than coalesced at each of the three renderers.
 *
 * @param status what the record carried, absent on a surface that has none
 * @returns the column text
 */
function statusColumn({ status }: { status: string | null }): string {
  if (status === null) {
    return "-";
  }
  return status;
}

/**
 * One grouped bucket's facet value as a column, with the absent case named.
 *
 * An aggregate omits a facet the events did not carry, which is a real answer rather than a gap — a service
 * emitting untagged logs is exactly what the owner's every-environment ruling wants visible.
 *
 * @param by the bucket's facet values
 * @param facet which facet was grouped on
 * @returns the column text
 */
function facetColumn({ by, facet }: { by: Readonly<Record<string, string | null>>; facet: string }): string {
  const value = by[facet];
  if (value == null) {
    return "(none)";
  }
  return value;
}

/**
 * The human report a Datadog groups read prints.
 *
 * @param buckets what the aggregate returned
 * @param facet which facet it grouped by
 * @param window the window it was taken over
 * @param envs the environments it was narrowed to
 * @returns the lines
 */
export function datadogGroupLines({
  buckets,
  facet,
  window,
  envs,
}: {
  buckets: readonly CensusBucket[];
  facet: string;
  window: AbsoluteWindow;
  envs: readonly string[];
}): readonly string[] {
  return [
    ...buckets.map((bucket) => `${String(bucket.count).padStart(11)}  ${facetColumn({ by: bucket.by, facet })}`),
    `${String(buckets.length)} ${facet} group(s)`,
    scopeLine({ envs, window }),
  ];
}

/**
 * The human report a Datadog hits page prints — one line per event, newest first.
 *
 * @param records the page
 * @param window the window it was taken over
 * @param envs the environments it was narrowed to
 * @returns the lines
 */
export function datadogHitsLines({
  records,
  window,
  envs,
}: {
  records: readonly DatadogRecord[];
  window: AbsoluteWindow;
  envs: readonly string[];
}): readonly string[] {
  return [
    ...records.map((record) =>
      [
        `${record.occurredAtIso}  ${record.service}  ${statusColumn({ status: record.status })}  ${record.env}`,
        `  ${record.id}`,
        `  ${record.text.replaceAll("\n", " ").slice(0, 200)}`,
      ].join("\n"),
    ),
    "",
    `${String(records.length)} event(s)`,
    scopeLine({ envs, window }),
  ];
}

/**
 * The human report `peek` prints for a Datadog record — a window of its text centred on the match.
 *
 * @param records the records found in the local cache
 * @param missing the ids the cache did not hold
 * @param match the term to centre on, or nothing
 * @param chars how many characters of window
 * @returns the lines
 */
export function datadogPeekLines({
  records,
  missing,
  match,
  chars,
}: {
  records: readonly DatadogRecord[];
  missing: readonly string[];
  match: string | undefined;
  chars: number;
}): readonly string[] {
  return [
    ...records.flatMap((record) => [
      `${record.id}  ${record.occurredAtIso}  ${record.service}`,
      `  ${excerptAround({ chars, match, text: record.text })}`,
      "",
    ]),
    ...missingLines({ missing }),
  ];
}

/**
 * The report `open` prints for a Datadog record — the whole event, unmasked, plus its console address.
 *
 * Nothing here is redacted, by design: the bot sees what they see, and the redaction
 * happens at the Slack post rather than at the verb. The line saying so is printed with the record, so a
 * composer reading this output is told, at the point of reading, that what it is holding must not be pasted
 * into a message unredacted.
 *
 * @param records the records found in the local cache
 * @param missing the ids the cache did not hold
 * @returns the lines
 */
export function datadogOpenLines({
  records,
  missing,
}: {
  records: readonly DatadogRecord[];
  missing: readonly string[];
}): readonly string[] {
  return [
    ...records.flatMap((record) => [
      `${record.id}  ${record.occurredAtIso}  ${record.service}  ${record.env}  ${statusColumn({ status: record.status })}`,
      `  ${record.link}`,
      record.text,
      safeJsonStringify({ label: "datadog event attributes", space: 2, value: record.attributes }),
      "",
    ]),
    ...(records.length === 0
      ? []
      : [
          "This event is UNREDACTED — usr.*, session.ip and every other field are as Datadog holds them.",
          "Redact before anything reaches Slack; `slopweaver slack post` applies the PII pass on the way out.",
        ]),
    ...missingLines({ missing }),
  ];
}

/**
 * The lines naming ids the local cache did not hold.
 *
 * Named rather than silently absent, because Datadog has no get-by-id route — so "not in the cache" is a
 * permanent answer for that id unless the search that found it is re-run, and a reader has to know that
 * rather than assume the event was empty.
 *
 * @param missing the ids that were not found
 * @returns the lines
 */
export function missingLines({ missing }: { missing: readonly string[] }): readonly string[] {
  if (missing.length === 0) {
    return [];
  }
  return [
    `${String(missing.length)} id(s) are not in this install's Datadog hit cache: ${missing.join(" ")}`,
    "Datadog has no get-by-id route, so an id is readable only after a `store hits --source datadog` fetched it.",
  ];
}

/**
 * A window of one record's text centred on a match, or its head when there is no match.
 *
 * @param text the record's text
 * @param match the term to centre on, or nothing
 * @param chars how many characters of window
 * @returns the excerpt
 */
export function excerptAround({
  text,
  match,
  chars,
}: {
  text: string;
  match: string | undefined;
  chars: number;
}): string {
  const flat = text.replaceAll("\n", " ");
  if (match === undefined) {
    return flat.slice(0, chars);
  }
  const at = flat.toLowerCase().indexOf(match.toLowerCase());
  if (at < 0) {
    return flat.slice(0, chars);
  }
  const start = Math.max(0, at - Math.floor(chars / 2));
  return flat.slice(start, start + chars);
}

/**
 * The report `around` prints — the anchor marked, its neighbours in time order.
 *
 * @param anchor the record that was read around
 * @param neighbours what the correlation returned
 * @param mode which correlation was followed
 * @param window the window it was taken over
 * @returns the lines
 */
export function datadogAroundLines({
  anchor,
  neighbours,
  mode,
  window,
}: {
  anchor: DatadogRecord;
  neighbours: readonly DatadogRecord[];
  mode: DatadogAroundMode;
  window: AbsoluteWindow;
}): readonly string[] {
  return [
    `${String(neighbours.length)} event(s) around ${anchor.id} (${mode})`,
    "",
    ...neighbours.map((record) => {
      const marker = record.id === anchor.id ? "->" : "  ";
      return `${marker} ${record.occurredAtIso}  ${record.service}  ${statusColumn({ status: record.status })}\n     ${record.text.replaceAll("\n", " ").slice(0, 200)}`;
    }),
    "",
    scopeLine({ envs: [], window }),
  ];
}

/**
 * Whether an invocation routes to Datadog, decided from the RAW argv before any parser runs.
 *
 * Before, rather than after, because the two backends' flags genuinely differ — `--shape` is required on
 * `store hits` and meaningless on Datadog's; `--from` is meaningless on the store and required-in-effect on
 * Datadog's — so running the store's parser first would refuse a valid Datadog invocation with a message
 * about the wrong flag. Detecting the route first is what lets each backend own its own refusals.
 *
 * Two signals, because the two halves of the ladder are addressed differently: the counting verbs carry
 * `--source datadog`, while the record verbs carry a `dd:` id and no source at all — an id is where a
 * detective got to, and making it retype the source would be the ceremony the shared vocabulary avoids.
 *
 * @param rest the verb's own argv tail, unparsed
 * @returns true when the invocation is Datadog's
 */
export function routesToDatadog({ rest }: { rest: readonly string[] }): boolean {
  for (const [index, token] of rest.entries()) {
    if (token === "--source" && rest[index + 1] === DATADOG_SOURCE) {
      return true;
    }
    if (token === `--source=${DATADOG_SOURCE}`) {
      return true;
    }
    if (token === "--id" && rest[index + 1]?.startsWith("dd:") === true) {
      return true;
    }
    if (token.startsWith("--id=dd:")) {
      return true;
    }
  }
  return false;
}

/** What a Datadog `store probe` invocation asked for. */
export interface DatadogProbeArgs {
  readonly terms: readonly string[];
  readonly scope: DatadogScope;
  readonly json: boolean;
}

/** What a Datadog `store groups` invocation asked for. */
export interface DatadogGroupsArgs {
  readonly term: string;
  readonly rung: DatadogRung;
  readonly facet: string;
  readonly limit: number;
  readonly scope: DatadogScope;
  readonly json: boolean;
}

/** What a Datadog `store hits` invocation asked for. */
export interface DatadogHitsArgs {
  readonly term: string;
  readonly rung: DatadogRung;
  readonly limit: number;
  readonly regex: string | undefined;
  readonly scope: DatadogScope;
  readonly json: boolean;
}

/** What a Datadog `store around` invocation asked for. */
export interface DatadogAroundArgs {
  readonly id: string;
  readonly mode: DatadogAroundMode;
  readonly limit: number;
  readonly scope: DatadogScope;
  readonly json: boolean;
}

/** The facets a Datadog `groups` read may split by, and what each one answers. *
 * @internal
 */
export const DATADOG_GROUP_FACETS: readonly string[] = [
  "service",
  "status",
  "env",
  "source",
  "host",
  "@err.code",
  "@error.kind",
  "@operation_name",
];

/**
 * Read one flag as a positive integer.
 *
 * @param values every parsed flag
 * @param name which flag
 * @param fallback what it is when absent
 * @returns the number, or the refusal
 */
function positiveInt({
  values,
  name,
  fallback,
}: {
  values: Readonly<Record<string, string | boolean>>;
  name: string;
  fallback: number;
}): Parsed<number> {
  const raw = values[name];
  if (raw === undefined) {
    return ok(fallback);
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return err(StoreCommandErrors.positiveWholeNumberRequired({ flag: name, got: String(raw) }));
  }
  return ok(parsed);
}

/**
 * Parse a Datadog `store probe`.
 *
 * @param rest the verb's own argv tail
 * @returns what it asked for, or every reason it was refused
 */
export function parseDatadogProbeArgs({ rest }: { rest: readonly string[] }): Parsed<DatadogProbeArgs> {
  const flags = parseFlags({
    allowPositionals: true,
    args: rest,
    spec: { boolean: ["json"], string: ["source", "from", "to", "env", "regex"] },
  });
  if (flags.isErr()) {
    return err(StoreCommandErrors.flagsInvalid({ reasons: flags.error }));
  }
  const { values, positionals } = flags.value;
  if (typeof values["regex"] === "string") {
    return err(StoreCommandErrors.datadogRegexRefused());
  }
  if (positionals.length === 0) {
    return err(StoreCommandErrors.datadogSubjectMissing());
  }
  return ok({ json: values["json"] === true, scope: datadogScope({ values }), terms: positionals });
}

/**
 * Parse a Datadog `store groups`.
 *
 * @param rest the verb's own argv tail
 * @returns what it asked for, or every reason it was refused
 */
export function parseDatadogGroupsArgs({ rest }: { rest: readonly string[] }): Parsed<DatadogGroupsArgs> {
  const flags = parseFlags({
    args: rest,
    spec: { boolean: ["json"], string: ["source", "term", "rung", "shape", "facet", "limit", "from", "to", "env"] },
  });
  if (flags.isErr()) {
    return err(StoreCommandErrors.flagsInvalid({ reasons: flags.error }));
  }
  const { values } = flags.value;
  const term = values["term"];
  const rung = rungOf({ values });
  const limit = positiveInt({ fallback: 20, name: "limit", values });
  const facet = values["facet"];
  const refusals = [
    ...(typeof term === "string" && term.length > 0 ? [] : ["--term is required"]),
    ...refusalLines({ results: [rung, limit] }),
    ...(typeof facet === "string" && facet.length > 0
      ? []
      : [`--facet is required — Datadog's useful ones are ${DATADOG_GROUP_FACETS.join(", ")}`]),
  ];
  if (refusals.length > 0 || !rung.isOk() || !limit.isOk() || typeof facet !== "string" || typeof term !== "string") {
    return err(StoreCommandErrors.verbRefused({ reasons: refusals, verb: "store groups --source datadog" }));
  }
  return ok({
    facet,
    json: values["json"] === true,
    limit: limit.value,
    rung: rung.value,
    scope: datadogScope({ values }),
    term,
  });
}

/**
 * Parse a Datadog `store hits`.
 *
 * @param rest the verb's own argv tail
 * @returns what it asked for, or every reason it was refused
 */
export function parseDatadogHitsArgs({ rest }: { rest: readonly string[] }): Parsed<DatadogHitsArgs> {
  const flags = parseFlags({
    allowPositionals: true,
    args: rest,
    spec: { boolean: ["json"], string: ["source", "term", "rung", "shape", "limit", "regex", "from", "to", "env"] },
  });
  if (flags.isErr()) {
    return err(StoreCommandErrors.flagsInvalid({ reasons: flags.error }));
  }
  const { values } = flags.value;
  const term = values["term"];
  const rung = rungOf({ values });
  const limit = positiveInt({ fallback: 25, name: "limit", values });
  const refusals = [
    ...(typeof term === "string" && term.length > 0 ? [] : ["--term is required"]),
    ...refusalLines({ results: [rung, limit] }),
  ];
  if (refusals.length > 0 || !rung.isOk() || !limit.isOk() || typeof term !== "string") {
    return err(StoreCommandErrors.verbRefused({ reasons: refusals, verb: "store hits --source datadog" }));
  }
  return ok({
    json: values["json"] === true,
    limit: limit.value,
    regex: typeof values["regex"] === "string" ? values["regex"] : undefined,
    rung: rung.value,
    scope: datadogScope({ values }),
    term,
  });
}

/**
 * Parse a Datadog `store around`.
 *
 * @param rest the verb's own argv tail
 * @returns what it asked for, or every reason it was refused
 */
export function parseDatadogAroundArgs({ rest }: { rest: readonly string[] }): Parsed<DatadogAroundArgs> {
  const flags = parseFlags({
    args: rest,
    spec: { boolean: ["json"], string: ["id", "mode", "limit", "before", "after", "chars", "from", "to", "env"] },
  });
  if (flags.isErr()) {
    return err(StoreCommandErrors.flagsInvalid({ reasons: flags.error }));
  }
  const { values } = flags.value;
  const id = values["id"];
  const mode = datadogAroundModeOf({ values });
  const limit = positiveInt({ fallback: 50, name: "limit", values });
  const refusals = [
    ...(typeof id === "string" && id.length > 0 ? [] : ["--id is required — one Datadog event to read around"]),
    ...refusalLines({ results: [mode, limit] }),
  ];
  if (refusals.length > 0 || !mode.isOk() || !limit.isOk() || typeof id !== "string") {
    return err(StoreCommandErrors.verbRefused({ reasons: refusals, verb: "store around --source datadog" }));
  }
  return ok({
    id,
    json: values["json"] === true,
    limit: limit.value,
    mode: mode.value,
    scope: datadogScope({ values }),
  });
}
