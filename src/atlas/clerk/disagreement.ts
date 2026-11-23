/**
 * Where the two surfaces disagree — the corroboration output, which is a thing the atlas SHOWS rather than
 * a build-time check it discards (`docs/atlas-intent/04-corroboration.md`).
 *
 * Pure: it takes the stored `operation` entities and returns the sets, so the whole judgement is testable
 * without a store.
 *
 * ## A browser-only operation is a LEAD, never a capability
 *
 * Seeing the dashboard call something establishes that Clerk HOLDS the data behind it. It says nothing
 * about whether a secret key may ask for it, and this module never implies otherwise — the owner's own
 * ruling is that an undocumented endpoint is usable where it works, which is a thing somebody finds out by
 * trying, not something a set difference proves.
 *
 * ## The whole `dashboard` API is browser-only BY CONSTRUCTION, and that is reported separately
 *
 * `dapi.clerk.com` appears in no pinned document, so every operation on it is undocumented — which would
 * swamp a single undocumented list and make the interesting half invisible. So the split is reported per
 * API: an undocumented call on `bapi` or `fapi` is a finding about a document that should have declared it,
 * while an undocumented call on `dashboard` is the expected shape of a private API and is interesting as an
 * inventory rather than as a surprise.
 *
 * ## Two known causes of APPARENT disagreement, stated so a reader does not chase them
 *
 * **Path-parameter spelling.** A declared `{user_id}` and an observed `user_2Zg…` reduce to different
 * placeholders — `{user_id}` against `{user}` — so a parameterised route can read as two rows. That is a
 * limit of shape-matching, not a finding about Clerk, and {@link isParameterShapeTwin} is what stops it
 * being reported as one.
 *
 * **Reach.** A declared operation the dashboard never calls appears as `declared only`, and on this atlas
 * that set is large by construction: one walk of forty pages exercises a fraction of a 502-operation
 * surface, and the Backend API is a server-to-server API the dashboard does not use at all. It says the
 * walk did not see it, never that it cannot be called.
 */
import { isRecord } from "../../lib/parsers.js";

import type { ClerkApi, ClerkAtlasEntity } from "./model.js";
import { isClerkApi } from "./surfaceNaming.js";

/**
 * How many rows a summary names before it stops, so a report stays readable.
 *
 * @internal
 */
export const CLERK_DISAGREEMENT_SAMPLE = 12;

/**
 * The three ways an `operation` row can sit across the two channels.
 *
 * @internal
 */
export interface ClerkDisagreement {
  /** Rows both channels saw: a document declares it and the dashboard was observed calling it. */
  readonly onBoth: readonly string[];
  /** Rows a pinned document declares that this walk never saw the dashboard call. */
  readonly declaredOnly: readonly string[];
  /** Rows the dashboard called that no pinned document declares, keyed by the API they went to. */
  readonly browserOnly: Readonly<Partial<Record<ClerkApi, readonly string[]>>>;
  /** Every browser-only row, flattened and sorted — the count a summary leads with. */
  readonly browserOnlyAll: readonly string[];
  /**
   * Rows both channels saw where the browser observed a response field no document declares.
   *
   * The sharpest disagreement this atlas can produce, because it is about the SAME operation rather than
   * about which operations exist: a field the client reads and the document does not mention is either an
   * undocumented field or a documented one that has moved.
   */
  readonly undeclaredFields: readonly ClerkFieldDisagreement[];
}

/**
 * One operation both channels saw, and the response field names only the browser did.
 *
 * @internal
 */
export interface ClerkFieldDisagreement {
  readonly providerId: string;
  readonly fields: readonly string[];
}

/**
 * Whether two provider ids differ only in how their path parameters are spelled.
 *
 * A declared path writes the vendor's own parameter name and an observed one writes this atlas's
 * placeholder, so `GET bapi:/v1/users/{user_id}` and `GET bapi:/v1/users/{user}` are one operation seen
 * twice. Both sides are normalised to a single `{}` before comparing, which is exactly as strong as it
 * should be: being wrong here merges two genuinely different routes only if they differ in nothing but a
 * parameter's name, which no HTTP API can express anyway.
 *
 * @param left one provider id
 * @param right the other
 * @returns whether the two name the same operation
 *
 * @internal
 */
export function isParameterShapeTwin({ left, right }: { left: string; right: string }): boolean {
  return blankParameterNames({ providerId: left }) === blankParameterNames({ providerId: right });
}

/**
 * One provider id with every path-parameter NAME blanked, so two spellings of one route compare equal.
 *
 * @param providerId the key to normalise
 * @returns the key with each `{…}` reduced to `{}`
 */
function blankParameterNames({ providerId }: { providerId: string }): string {
  return providerId.replaceAll(/\{[^}]*\}/g, "{}");
}

/** The response field names one channel's detail carries, or an empty list when it carries none. */
function fieldsOf({ detail }: { detail: unknown }): readonly string[] {
  if (!isRecord(detail)) {
    return [];
  }
  const found = detail["responseFields"];
  if (!Array.isArray(found)) {
    return [];
  }
  return found.filter((field): field is string => typeof field === "string");
}

/**
 * Which API one entity's provider id names.
 *
 * Read back off the key rather than off the detail, so a row whose detail schema a future version widens
 * still classifies. The key is `<METHOD> <api>:<wire path>` and the API is the token between the space and
 * the first colon.
 *
 * @param providerId the entity's provider id
 * @returns the API name as written in the key, or `""` when the key is not in that shape
 */
function apiOf({ providerId }: { providerId: string }): string {
  const afterSpace = providerId.slice(providerId.indexOf(" ") + 1);
  const colon = afterSpace.indexOf(":");
  return colon < 0 ? "" : afterSpace.slice(0, colon);
}

/**
 * Split the stored operation rows by which channels have looked at each.
 *
 * The parameter-shape reconciliation runs BEFORE the split rather than after it: a browser row whose only
 * twin is a declared row belongs in `onBoth`, and reporting it in both single-channel lists would be the
 * comparison manufacturing two findings out of none.
 *
 * @param entities every `operation` entity the store holds
 * @returns the sets, each sorted, holding provider ids
 */
export function splitClerkChannels({ entities }: { entities: readonly ClerkAtlasEntity[] }): ClerkDisagreement {
  const declaredShapes = new Set(
    entities
      .filter((entity) => entity.channels.compiled !== null)
      .map((entity) => blankParameterNames({ providerId: entity.providerId })),
  );
  const observedShapes = new Set(
    entities
      .filter((entity) => entity.channels.browser !== null)
      .map((entity) => blankParameterNames({ providerId: entity.providerId })),
  );
  const onBoth: string[] = [];
  const declaredOnly: string[] = [];
  const browserOnlyAll: string[] = [];
  const undeclaredFields: ClerkFieldDisagreement[] = [];
  for (const entity of entities) {
    const seenBy = sideOf({ declaredShapes, entity, observedShapes });
    if (seenBy === "both") {
      onBoth.push(entity.providerId);
      const missing = undeclaredFieldsOf({ entity });
      if (missing.length > 0) {
        undeclaredFields.push({ fields: missing, providerId: entity.providerId });
      }
      continue;
    }
    if (seenBy === "declared") {
      declaredOnly.push(entity.providerId);
      continue;
    }
    browserOnlyAll.push(entity.providerId);
  }
  return {
    browserOnly: byApi({ browserOnlyByApi: Map.groupBy(browserOnlyAll, (providerId) => apiOf({ providerId })) }),
    browserOnlyAll: browserOnlyAll.toSorted(),
    declaredOnly: declaredOnly.toSorted(),
    onBoth: onBoth.toSorted(),
    undeclaredFields: undeclaredFields.toSorted((left, right) => left.providerId.localeCompare(right.providerId)),
  };
}

/**
 * Which channels have looked at one row, with the parameter-shape reconciliation already applied.
 *
 * `both` covers two cases and that is the point: a row carrying both channels, and a single-channel row
 * whose parameter-shape twin the other channel saw. Reporting the second as a disagreement would be the
 * comparison manufacturing two findings out of none — `docs/atlas-intent/04-corroboration.md`'s transferable lesson.
 *
 * @param entity the stored row
 * @param declaredShapes every compiled row's normalised key
 * @param observedShapes every browser row's normalised key
 * @returns which side of the comparison this row falls on
 */
function sideOf({
  entity,
  declaredShapes,
  observedShapes,
}: {
  entity: ClerkAtlasEntity;
  declaredShapes: ReadonlySet<string>;
  observedShapes: ReadonlySet<string>;
}): "both" | "declared" | "browser" {
  const hasCompiled = entity.channels.compiled !== null;
  const shape = blankParameterNames({ providerId: entity.providerId });
  if (hasCompiled && entity.channels.browser !== null) {
    return "both";
  }
  if (hasCompiled) {
    return observedShapes.has(shape) ? "both" : "declared";
  }
  return declaredShapes.has(shape) ? "both" : "browser";
}

/** The response fields the browser observed on one row that its compiled channel does not declare. */
function undeclaredFieldsOf({ entity }: { entity: ClerkAtlasEntity }): readonly string[] {
  const declared = new Set(fieldsOf({ detail: entity.channels.compiled?.detail }));
  return fieldsOf({ detail: entity.channels.browser?.detail })
    .filter((field) => !declared.has(field))
    .toSorted();
}

/**
 * The browser-only rows keyed by API, dropping anything whose key is not in this atlas's own shape.
 *
 * A row landing under an unrecognised name is deliberately dropped rather than widening the union: the key
 * came out of a provider id this atlas wrote, so one that does not parse is a defect to find rather than a
 * sixth API to invent.
 */
function byApi({
  browserOnlyByApi,
}: {
  browserOnlyByApi: ReadonlyMap<string, readonly string[]>;
}): Readonly<Partial<Record<ClerkApi, readonly string[]>>> {
  const rows: Partial<Record<ClerkApi, readonly string[]>> = {};
  for (const [api, keys] of browserOnlyByApi) {
    if (isClerkApi(api)) {
      rows[api] = [...keys].toSorted();
    }
  }
  return rows;
}

/**
 * The lines a human report prints for one corroboration.
 *
 * @param split the sets
 * @returns the report lines, counts first and a bounded sample of the undocumented surface after
 */
export function summariseClerkDisagreement({ split }: { split: ClerkDisagreement }): readonly string[] {
  const total = split.onBoth.length + split.declaredOnly.length + split.browserOnlyAll.length;
  const lines = [
    `clerk surface corroboration — ${String(total)} operation row(s) held`,
    `  on both surfaces   ${String(split.onBoth.length)}`,
    `  declared only      ${String(split.declaredOnly.length)}  (a pinned document declares it; this walk never saw the dashboard call it)`,
    `  browser only       ${String(split.browserOnlyAll.length)}  (the dashboard calls it; no pinned document declares it)`,
  ];
  for (const [api, keys] of Object.entries(split.browserOnly)) {
    lines.push(`    ${api.padEnd(10)} ${String(keys.length)}`);
  }
  if (split.browserOnlyAll.length > 0) {
    const shown = split.browserOnlyAll.slice(0, CLERK_DISAGREEMENT_SAMPLE);
    lines.push(
      `  the undocumented surface, first ${String(shown.length)} of ${String(split.browserOnlyAll.length)}:`,
      ...shown.map((row) => `    ${row}`),
    );
  }
  if (split.undeclaredFields.length === 0) {
    return lines;
  }
  const shownFields = split.undeclaredFields.slice(0, CLERK_DISAGREEMENT_SAMPLE);
  return [
    ...lines,
    `  operations whose response carried a field no document declares — ${String(split.undeclaredFields.length)}:`,
    ...shownFields.map((row) => `    ${row.providerId}  ${row.fields.slice(0, 8).join(", ")}`),
  ];
}
