/**
 * Compiling the Chronicle v1 method inventory from pinned proto text and the service config, and
 * measuring its census. Pure: the generator in `tools/` reads the bytes and writes the table, and this
 * module decides every row.
 *
 * ## Which services become rows, and why the others are still read
 *
 * A row is a method the published v1 surface serves: an rpc of a service `chronicle_v1.yaml` lists under
 * `apis:`, or a method the config binds itself in `http.rules` (the `google.longrunning.Operations` mixin).
 * The same googleapis directory also carries protos for services the config does NOT list —
 * `BigQueryExportService`, `DashboardChartService` and `DashboardQueryService` on this pin. Their rpcs
 * declare bindings and even have authentication rules, but the service config is what decides what
 * `chronicle.googleapis.com` publishes under v1, so counting them would inflate the GET denominator with
 * methods the API does not list. They are parsed, counted and named in
 * {@link GoogleSecopsInventory.unpublished} instead, which the lock pins, so a service moving INTO `apis:`
 * fails the census and becomes a reviewed change rather than a silent one.
 *
 * ## What it refuses
 *
 * A published service no proto declares, a config binding that collides with a proto binding, an
 * authentication rule that matches no method at all, a method no authentication rule matches, and a
 * custom GET nobody judged. Each is a typed error rather than a row with a guessed field; the checks between
 * config and protos are `consistency.ts`. A reviewed
 * custom-GET verdict that names no method is checked against the pinned inventory by the generator and the
 * unit lane instead, because it is a fact about THAT inventory and a fixture would trip it.
 */
import { err, ok, type Result } from "#lib/result.js";

import { countByDisposition } from "../kit/compiledSync.js";

import { type AuthRule, scopesForSelector } from "./authRules.js";
import { checkGoogleSecopsConsistency } from "./consistency.js";
import { googleSecopsDispositionFor } from "./dispositions.js";
import {
  type GoogleSecopsCensusMismatchError,
  type GoogleSecopsInventoryError,
  GoogleSecopsInventoryErrors,
} from "./errors.js";
import { type ProtoRpc, parseChronicleProtoFile } from "./protoParse.js";
import { parseChronicleServiceConfig } from "./serviceConfig.js";
import type {
  GoogleSecopsDisposition,
  GoogleSecopsExclusionReason,
  GoogleSecopsHttpMethod,
  GoogleSecopsSurfaceRow,
} from "./surfaceRow.js";
import { compareGoogleSecopsIds } from "./tableIntegrity.js";

/** The googleapis directory every pinned proto sits in, as an import path names it. */
const PINNED_DIRECTORY = "google/cloud/chronicle/v1/";

/** The read-only Chronicle scope — branch A of the owner's scope pick. */
export const CHRONICLE_READONLY_SCOPE = "https://www.googleapis.com/auth/chronicle.readonly";

/** The write-capable all-of-GCP scope — branch B of the owner's scope pick. */
export const CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";

/**
 * Which grant can reach a method.
 *
 * - `chronicle-readonly` — the config grants it `chronicle.readonly`, so branch A reaches it.
 * - `cloud-platform-only` — not `chronicle.readonly`, but `cloud-platform`: only branch B reaches it.
 * - `other` — neither. No v1 method is this today; the census pins that at zero.
 */
export type GoogleSecopsScopeClass = "chronicle-readonly" | "cloud-platform-only" | "other";

/**
 * Classify a method's declared scopes by which of the two candidate grants reaches it.
 *
 * @param scopes the scopes the service config grants the method
 * @returns the narrowest of the two grants that reaches it, or `other`
 */
export function googleSecopsScopeClass({ scopes }: { scopes: readonly string[] }): GoogleSecopsScopeClass {
  // Whole-element equality: a scope that merely CONTAINS one of these URLs is a different scope.
  if (scopes.some((scope) => scope === CHRONICLE_READONLY_SCOPE)) {
    return "chronicle-readonly";
  }
  if (scopes.some((scope) => scope === CLOUD_PLATFORM_SCOPE)) {
    return "cloud-platform-only";
  }
  return "other";
}

/** One pinned proto's text, keyed by the file name the lock pins it under. */
export interface GoogleSecopsProtoText {
  readonly document: string;
  readonly text: string;
}

/** A service a pinned proto declares that the config does not publish. */
export interface GoogleSecopsUnpublishedService {
  readonly service: string;
  /** How many rpcs it declares. */
  readonly rpcs: number;
}

/** What compiling the pinned sources produced. */
export interface GoogleSecopsInventory {
  /** Every published method, sorted by id. */
  readonly rows: readonly GoogleSecopsSurfaceRow[];
  /** Every declared-but-unpublished service, sorted by name. */
  readonly unpublished: readonly GoogleSecopsUnpublishedService[];
  /** How many methods each pinned document declares, published or not — the parse half of the census. */
  readonly declaredByDocument: Readonly<Record<string, number>>;
}

/**
 * Build one row from a published method.
 *
 * @param rpc the method and its binding
 * @param authRules every authentication rule
 * @returns the row, or why its scopes or disposition cannot be decided
 */
function rowOf({
  rpc,
  authRules,
}: {
  rpc: ProtoRpc;
  authRules: readonly AuthRule[];
}): Result<GoogleSecopsSurfaceRow, GoogleSecopsInventoryError> {
  const scopes = scopesForSelector({ rules: authRules, selector: rpc.id });
  if (scopes.isErr()) {
    return err(scopes.error);
  }
  const verdict = googleSecopsDispositionFor({ httpMethod: rpc.httpMethod, id: rpc.id, rpc: rpc.rpc });
  if (verdict.isErr()) {
    return err(verdict.error);
  }
  return ok({
    disposition: verdict.value.disposition,
    dispositionBecause: verdict.value.dispositionBecause,
    document: rpc.document,
    exclusionReason: verdict.value.exclusionReason,
    httpMethod: rpc.httpMethod,
    id: rpc.id,
    pathTemplate: rpc.pathTemplate,
    rpc: rpc.rpc,
    scopes: scopes.value,
    service: rpc.service,
  });
}

/**
 * Parse every pinned proto, refusing an import of an unpinned file in the pinned directory.
 *
 * @param protos every pinned proto's text
 * @returns every method declared, in pin order, and how many each file declares, or the first refusal
 */
function parsePinnedProtos({
  protos,
}: {
  protos: readonly GoogleSecopsProtoText[];
}): Result<
  { readonly declared: readonly ProtoRpc[]; readonly declaredByDocument: Record<string, number> },
  GoogleSecopsInventoryError
> {
  const declared: ProtoRpc[] = [];
  const declaredByDocument: Record<string, number> = {};
  const pinned = new Set(protos.map((proto) => `${PINNED_DIRECTORY}${proto.document}`));
  for (const proto of protos) {
    const parsed = parseChronicleProtoFile({ document: proto.document, text: proto.text });
    if (parsed.isErr()) {
      return err(parsed.error);
    }
    // An unpinned file in the pinned directory shares its package, so it could declare `google` and redirect
    // `(google.api.http)` without any refusal ever reading it.
    const unpinned = parsed.value.imports.find((path) => path.startsWith(PINNED_DIRECTORY) && !pinned.has(path));
    if (unpinned !== undefined) {
      const detail = `imports ${unpinned}, which is not one of the pinned files`;
      return err(GoogleSecopsInventoryErrors.protoUnparseable({ detail, document: proto.document }));
    }
    declared.push(...parsed.value.rpcs);
    declaredByDocument[proto.document] = parsed.value.rpcs.length;
  }
  return ok({ declared, declaredByDocument });
}

/**
 * Compile the inventory from pinned proto text and the service config.
 *
 * @param protos every pinned proto's text
 * @param serviceConfig the pinned `chronicle_v1.yaml` text
 * @param serviceConfigDocument the file name the config is pinned under
 * @returns the rows, the unpublished services and the per-document declared counts, or the first refusal
 */
export function compileGoogleSecopsInventory({
  protos,
  serviceConfig,
  serviceConfigDocument,
}: {
  protos: readonly GoogleSecopsProtoText[];
  serviceConfig: string;
  serviceConfigDocument: string;
}): Result<GoogleSecopsInventory, GoogleSecopsInventoryError> {
  const config = parseChronicleServiceConfig({ text: serviceConfig });
  if (config.isErr()) {
    return err(config.error);
  }
  const parsedProtos = parsePinnedProtos({ protos });
  if (parsedProtos.isErr()) {
    return err(parsedProtos.error);
  }
  const { declared } = parsedProtos.value;
  const declaredByDocument = {
    ...parsedProtos.value.declaredByDocument,
    [serviceConfigDocument]: config.value.httpRules.length,
  };
  const consistent = checkGoogleSecopsConsistency({
    apis: config.value.apis,
    authRules: config.value.authRules,
    declared,
    httpRules: config.value.httpRules,
  });
  if (consistent.isErr()) {
    return err(consistent.error);
  }
  const published = new Set(config.value.apis);
  const unpublishedCounts = new Map<string, number>();
  const rows: GoogleSecopsSurfaceRow[] = [];
  for (const rpc of [...declared, ...config.value.httpRules]) {
    if (!published.has(rpc.service)) {
      increment({ counts: unpublishedCounts, key: rpc.service });
      continue;
    }
    const row = rowOf({ authRules: config.value.authRules, rpc });
    if (row.isErr()) {
      return err(row.error);
    }
    rows.push(row.value);
  }
  return ok({
    declaredByDocument,
    rows: rows.toSorted((left, right) => compareGoogleSecopsIds({ left: left.id, right: right.id })),
    unpublished: [...unpublishedCounts.entries()]
      .map(([service, rpcs]) => ({ rpcs, service }))
      .toSorted((left, right) => compareGoogleSecopsIds({ left: left.service, right: right.service })),
  });
}

/**
 * Every count the lock pins about the rows, so a row changing side moves a number even when the total
 * does not.
 */
export interface GoogleSecopsInventoryCensus {
  readonly methods: number;
  readonly distinctIds: number;
  /** Rows per document — published methods only. */
  readonly rowsByDocument: Readonly<Record<string, number>>;
  readonly byHttpMethod: Readonly<Record<GoogleSecopsHttpMethod, number>>;
  readonly byDisposition: Readonly<Record<GoogleSecopsDisposition, number>>;
  readonly byExclusionReason: Readonly<Record<GoogleSecopsExclusionReason, number>>;
  /** Entity rows per scope class — how many reads each of the owner's two scope branches reaches. */
  readonly entitiesByScopeClass: Readonly<Record<GoogleSecopsScopeClass, number>>;
}

/**
 * Measure the census of a set of rows.
 *
 * @param rows the inventory, compiled or committed
 * @returns every count the lock pins
 */
export function googleSecopsInventoryCensus({
  rows,
}: {
  rows: readonly GoogleSecopsSurfaceRow[];
}): GoogleSecopsInventoryCensus {
  const rowsByDocument = new Map<string, number>();
  for (const row of rows) {
    increment({ counts: rowsByDocument, key: row.document });
  }
  const excluded = rows.filter((row) => row.exclusionReason !== null);
  return {
    byDisposition: countByDisposition({
      dispositionOf: (row) => row.disposition,
      empty: { entity: 0, excluded: 0, "probe-only": 0 },
      rows,
    }),
    byExclusionReason: countByDisposition({
      dispositionOf: (row) => row.exclusionReason!,
      empty: { mutating: 0, query: 0 },
      rows: excluded,
    }),
    byHttpMethod: countByDisposition({
      dispositionOf: (row) => row.httpMethod,
      empty: { DELETE: 0, GET: 0, PATCH: 0, POST: 0, PUT: 0 },
      rows,
    }),
    distinctIds: new Set(rows.map((row) => row.id)).size,
    entitiesByScopeClass: countByDisposition({
      dispositionOf: (row) => googleSecopsScopeClass({ scopes: row.scopes }),
      empty: { "chronicle-readonly": 0, "cloud-platform-only": 0, other: 0 },
      rows: rows.filter((row) => row.disposition === "entity"),
    }),
    methods: rows.length,
    rowsByDocument: Object.fromEntries(rowsByDocument),
  };
}

/**
 * Add one to a key's count, starting it at one when it is new.
 *
 * @param counts the running counts, mutated
 * @param key the key to count
 */
function increment({ counts, key }: { counts: Map<string, number>; key: string }): void {
  const held = counts.get(key);
  counts.set(key, held === undefined ? 1 : held + 1);
}

/**
 * A census field rendered so two equal values compare equal whatever order their keys were written in.
 *
 * @param value a count or a flat record of counts
 * @returns the value as JSON, a record's keys sorted
 */
function canonical({ value }: { value: number | Readonly<Record<string, number>> }): string {
  if (typeof value === "number") {
    return String(value);
  }
  return JSON.stringify(Object.entries(value).toSorted(([left], [right]) => (left < right ? -1 : 1)));
}

/**
 * Every way a measured census disagrees with the pinned one.
 *
 * @param census what this run measured
 * @param pinned what the lock pins
 * @returns ok, or `CENSUS_MISMATCH` naming every disagreement
 */
export function googleSecopsCensusMatches({
  census,
  pinned,
}: {
  census: GoogleSecopsInventoryCensus;
  pinned: GoogleSecopsInventoryCensus;
}): Result<void, GoogleSecopsCensusMismatchError> {
  const problems: string[] = [];
  const compare = ({
    label,
    got,
    want,
  }: {
    label: string;
    got: number | Readonly<Record<string, number>>;
    want: number | Readonly<Record<string, number>>;
  }): void => {
    const gotText = canonical({ value: got });
    const wantText = canonical({ value: want });
    if (gotText !== wantText) {
      problems.push(`${label}: read ${gotText}, pinned ${wantText}`);
    }
  };
  compare({ got: census.methods, label: "methods", want: pinned.methods });
  compare({ got: census.distinctIds, label: "distinct ids", want: pinned.distinctIds });
  compare({ got: census.rowsByDocument, label: "rows by document", want: pinned.rowsByDocument });
  compare({ got: census.byHttpMethod, label: "by HTTP method", want: pinned.byHttpMethod });
  compare({ got: census.byDisposition, label: "by disposition", want: pinned.byDisposition });
  compare({ got: census.byExclusionReason, label: "by exclusion reason", want: pinned.byExclusionReason });
  compare({ got: census.entitiesByScopeClass, label: "entities by scope class", want: pinned.entitiesByScopeClass });
  if (problems.length === 0) {
    return ok(undefined);
  }
  return err(GoogleSecopsInventoryErrors.censusMismatch({ problems }));
}
