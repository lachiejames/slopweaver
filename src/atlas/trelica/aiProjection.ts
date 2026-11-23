/**
 * Turning the cost explorer's answers into `ai-usage` and `ai-alert` entities, through a closed projection.
 *
 * Pure, and on the `first-party-api` channel only: every row here was fetched by this atlas's own read rather
 * than watched in a walk, which is `docs/atlas-intent/07-browser-fallback.md` applied.
 *
 * ## The provider id is `<dimension>:<the explorer's own key>`
 *
 * The six reads share one entity kind, so the dimension is part of the key: an application's id is both an
 * `app` row and the owner of several `model` rows, and those must be different entities. A model is keyed by
 * its application as well as its name, because one model name is billed through more than one application.
 * A team is keyed by its whole path in the explorer's tree, so a member listed under two teams is two rows
 * rather than a collision that fails the merge.
 *
 * ## A row missing a figure is COUNTED, never zero-filled
 *
 * The metrics schema is strict, and a figure the explorer did not send is not a zero it reported. A row
 * missing one is left out and counted in `unprojected`, which `aiSync.ts` turns into a gap.
 */
import { isRecord } from "../../lib/parsers.js";
import { atlasChannelView, atlasEntityWithChannel, sortedById } from "../kit/channelProjection.js";

import { trelicaEntityId } from "./identity.js";
import {
  emptyTrelicaChannels,
  type TrelicaAiAlertDetail,
  type TrelicaAiUsageDetail,
  type TrelicaAiUsageDimension,
  type TrelicaAiUsageMetrics,
  type TrelicaAtlasEntity,
  trelicaAiUsageMetricsSchema,
} from "./model.js";
import type { TrelicaAiUsageResult } from "./usageWalk.js";

/** The key and label a model row with an empty model name is held under. */
const UNNAMED_MODEL = "(no model recorded)";

/** The ten figures every row carries, in the order the schema declares them. */
const METRIC_KEYS = [
  "cachedInputTokens",
  "cachedOutputTokens",
  "credits",
  "inputTokens",
  "linesOfCodeAdded",
  "linesOfCodeRemoved",
  "outputTokens",
  "requests",
  "spend",
  "totalTokens",
] as const satisfies readonly (keyof TrelicaAiUsageMetrics)[];

/** What one projection produced, and how many rows it could not. */
export interface TrelicaAiUsageProjection {
  readonly entities: readonly TrelicaAtlasEntity[];
  /** Rows the explorer returned that carried no key, no label or an incomplete set of figures. */
  readonly unprojected: number;
}

/** Who one row is about, read the way its own dimension spells it. */
export interface TrelicaAiRowIdentity {
  readonly key: string;
  /** `null` on a series row, which carries the key it is matched on and not always the name. */
  readonly label: string | null;
  readonly customerAppId: string | null;
  readonly customerAppName: string | null;
  readonly email: string | null;
}

/** Read a string field, treating an empty one as absent so `""` never reaches a `min(1)` schema. */
function textOf({ record, key }: { record: Record<string, unknown>; key: string }): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/** Read a finite number field, treating anything else as absent. */
function numberOf({ record, key }: { record: Record<string, unknown>; key: string }): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** A nested record field, or an empty record when the explorer sent none. */
function recordOf({ record, key }: { record: Record<string, unknown>; key: string }): Record<string, unknown> {
  const value = record[key];
  return isRecord(value) ? value : {};
}

/** The first of several candidate labels that is present. */
function firstText({ candidates }: { candidates: readonly (string | null)[] }): string | null {
  const found = candidates.find((candidate) => candidate !== null);
  if (found === undefined) {
    return null;
  }
  return found;
}

/** The dimensions whose rows carry their owning app, per `aiUsageBoundaries.ts`. */
const APP_DIMENSIONS: ReadonlySet<TrelicaAiUsageDimension> = new Set(["api-key", "app", "model"]);

/** The app an identity belongs to, read off the row itself. */
function appOf({
  row,
}: {
  row: Record<string, unknown>;
}): Pick<TrelicaAiRowIdentity, "customerAppId" | "customerAppName"> {
  return {
    customerAppId: textOf({ key: "customerAppId", record: row }),
    customerAppName: textOf({ key: "customerAppName", record: row }),
  };
}

/** One identity, or `null` when the row carries no key. */
function identityWith({
  key,
  label,
  rest,
}: {
  key: string | null;
  label: string | null;
  rest: Omit<TrelicaAiRowIdentity, "key" | "label">;
}): TrelicaAiRowIdentity | null {
  return key === null ? null : { ...rest, key, label };
}

/**
 * Who one row is about, for the dimension it was read under.
 *
 * @param dimension which read returned it
 * @param row one table or series row
 * @returns the key, label and owning application, or `null` when the row identifies nothing
 *
 * @internal
 */
export function trelicaAiRowIdentity({
  dimension,
  row,
}: {
  dimension: TrelicaAiUsageDimension;
  row: Record<string, unknown>;
}): TrelicaAiRowIdentity | null {
  // Only the app, model and api-key boundaries declare the owning app, so no other row is read for keys its
  // boundary never admitted.
  const app = APP_DIMENSIONS.has(dimension) ? appOf({ row }) : { customerAppId: null, customerAppName: null };
  const noEmail = { ...app, email: null };
  if (dimension === "app") {
    return identityWith({ key: app.customerAppId, label: app.customerAppName, rest: noEmail });
  }
  if (dimension === "cost-center") {
    // MEASURED: a cost-center row carries only its id, and the boundary refuses a name, so the id
    // is the label rather than a stand-in for one.
    const key = textOf({ key: "costCenterId", record: row });
    return identityWith({ key, label: key, rest: noEmail });
  }
  if (dimension === "model") {
    // MEASURED: a provider can report real spend against `model: ""`, its own bucket for spend it
    // recorded with no model, so an EMPTY name is a row to hold and only an ABSENT one is unprojected.
    const model = row["model"] === "" ? UNNAMED_MODEL : textOf({ key: "model", record: row });
    const key = model === null || app.customerAppId === null ? model : `${app.customerAppId}:${model}`;
    return identityWith({ key, label: model, rest: noEmail });
  }
  if (dimension === "api-key") {
    const apiKey = recordOf({ key: "apiKey", record: row });
    const key = textOf({ key: "customerAppApiKeyId", record: row });
    // The key's `externalId` is the vendor's own account key, which this atlas never holds, so a key with no
    // name is labelled by Trelica's id for it instead.
    const label = firstText({ candidates: [textOf({ key: "name", record: apiKey }), key] });
    const customerAppId = firstText({
      candidates: [app.customerAppId, textOf({ key: "customerAppId", record: apiKey })],
    });
    return identityWith({ key, label, rest: { ...noEmail, customerAppId } });
  }
  if (dimension === "person") {
    const person = recordOf({ key: "person", record: row });
    const rest = { ...app, email: textOf({ key: "email", record: person }) };
    return identityWith({
      key: textOf({ key: "personId", record: row }),
      label: textOf({ key: "name", record: person }),
      rest,
    });
  }
  return identityWith({
    key: textOf({ key: "memberId", record: row }),
    label: textOf({ key: "memberName", record: row }),
    rest: noEmail,
  });
}

/** Every figure, or `null` when any one of the ten is missing. */
function metricsOf({ row }: { row: Record<string, unknown> }): TrelicaAiUsageMetrics | null {
  const metrics = recordOf({ key: "metrics", record: row });
  // Only the ten named figures are offered to the strict schema, so a field the provider adds later is ignored.
  const read = Object.fromEntries(METRIC_KEYS.map((key) => [key, numberOf({ key, record: metrics })]));
  const parsed = trelicaAiUsageMetricsSchema.safeParse(read);
  return parsed.success ? parsed.data : null;
}

/** The per-period spend the explorer charted for one series row, keyed by the series row's own key. */
function seriesByKey({ result }: { result: TrelicaAiUsageResult }): ReadonlyMap<string, Record<string, number>> {
  const byKey = new Map<string, Record<string, number>>();
  for (const entry of result.series) {
    if (!isRecord(entry)) {
      continue;
    }
    const identity = trelicaAiRowIdentity({ dimension: result.dimension, row: entry });
    const spend = recordOf({ key: "spendByDate", record: entry });
    if (identity === null) {
      continue;
    }
    const periods = Object.entries(spend).flatMap(([period, value]) =>
      typeof value === "number" && Number.isFinite(value) ? [[period, value] as const] : [],
    );
    byKey.set(identity.key, Object.fromEntries(periods));
  }
  return byKey;
}

/** One table row, flattened with its place in a tree, before it is projected. */
interface PlacedRow {
  readonly row: Record<string, unknown>;
  /** The keys of every ancestor, root first — empty everywhere but the team tree. */
  readonly ancestors: readonly string[];
  readonly level: number | null;
}

/**
 * Flatten the team tree depth-first; every other dimension's table is already flat, and only a team row declares
 * `memberId` and `children`, so no other dimension's row is read for them.
 */
function placedRows({ result }: { result: TrelicaAiUsageResult }): readonly PlacedRow[] {
  if (result.dimension !== "team") {
    return result.rows.map((row) => ({ ancestors: [], level: null, row: isRecord(row) ? row : {} }));
  }
  const placed: PlacedRow[] = [];
  const visit = ({ rows, ancestors }: { rows: readonly unknown[]; ancestors: readonly string[] }): void => {
    for (const row of rows) {
      if (!isRecord(row)) {
        placed.push({ ancestors, level: null, row: {} });
        continue;
      }
      placed.push({ ancestors, level: ancestors.length, row });
      const key = textOf({ key: "memberId", record: row });
      const children = row["children"];
      if (key !== null && Array.isArray(children)) {
        visit({ ancestors: [...ancestors, key], rows: children });
      }
    }
  };
  visit({ ancestors: [], rows: result.rows });
  return placed;
}

/**
 * Project one cost-explorer read into `ai-usage` entities.
 *
 * @param result what the read returned
 * @param window the window it was read over, stored on every row so a figure is never read without its span
 * @param minimumSpend a row spending less than this is left out — the API-key table's floor; `null` keeps all
 * @param at this run's ISO timestamp
 * @returns one entity per identified row, sorted by id, and how many rows could not be projected
 */
export function projectTrelicaAiUsage({
  result,
  window,
  minimumSpend,
  at,
}: {
  result: TrelicaAiUsageResult;
  window: { startDate: string; endDate: string };
  minimumSpend: number | null;
  at: string;
}): TrelicaAiUsageProjection {
  const series = seriesByKey({ result });
  const byProviderId = new Map<string, TrelicaAtlasEntity>();
  let unprojected = 0;
  for (const { row, ancestors, level } of placedRows({ result })) {
    const identity = trelicaAiRowIdentity({ dimension: result.dimension, row });
    const metrics = metricsOf({ row });
    if (identity?.label == null || metrics === null) {
      unprojected += 1;
      continue;
    }
    if (minimumSpend !== null && metrics.spend < minimumSpend) {
      continue;
    }
    const label: string = identity.label;
    const providerId = `${result.dimension}:${[...ancestors, identity.key].join("/")}`;
    const detail: TrelicaAiUsageDetail = {
      customerAppId: identity.customerAppId,
      customerAppName: identity.customerAppName,
      dimension: result.dimension,
      email: identity.email,
      granularity: result.granularity,
      label,
      level,
      metrics,
      parentId: ancestors.length > 0 ? ancestors[ancestors.length - 1]! : null,
      spendByPeriod: absentPeriods({ periods: series.get(identity.key) }),
      windowEnd: window.endDate,
      windowStart: window.startDate,
    };
    byProviderId.set(providerId, firstPartyEntity({ at, detail, endpoint: result.path, kind: "ai-usage", providerId }));
  }
  return { entities: sortedById({ entities: [...byProviderId.values()] }), unprojected };
}

/** A series row's periods, or `null` for a row the explorer did not chart. */
function absentPeriods({ periods }: { periods: Record<string, number> | undefined }): Record<string, number> | null {
  if (periods === undefined) {
    return null;
  }
  return periods;
}

/** An entity with only its first-party channel filled. */
function firstPartyEntity({
  kind,
  providerId,
  detail,
  endpoint,
  at,
}: {
  kind: "ai-usage" | "ai-alert";
  providerId: string;
  detail: TrelicaAiUsageDetail | TrelicaAiAlertDetail;
  endpoint: string;
  at: string;
}): TrelicaAtlasEntity {
  return atlasEntityWithChannel({
    channel: "first-party-api",
    empty: emptyTrelicaChannels(),
    id: trelicaEntityId({ kind, providerId }),
    kind,
    providerId,
    // The explorer's page is served under the TENANT origin, whose label this repository may not carry — so
    // the link is left unattempted rather than assembled here, exactly as an application's own page is.
    view: atlasChannelView({
      artifacts: [],
      at,
      channel: "first-party-api",
      deepLink: null,
      deepLinkStatus: "unverified",
      detail,
      endpoint,
    }),
  });
}

/** One point of an alert's trend, or `null` when it is not one. */
function trendPoint({ entry }: { entry: unknown }): TrelicaAiAlertDetail["trend"][number] | null {
  if (!isRecord(entry)) {
    return null;
  }
  const date = textOf({ key: "date", record: entry });
  const spend = numberOf({ key: "spend", record: entry });
  return date === null || spend === null ? null : { date, spend };
}

/**
 * Project the alerts the cost explorer raised into `ai-alert` entities.
 *
 * @param records every alert record the history reads returned, spike and budget together
 * @param endpoint the path they were read from
 * @param at this run's ISO timestamp
 * @returns one entity per alert carrying an id, a type, a status and a date, sorted by id
 */
export function projectTrelicaAiAlerts({
  records,
  endpoint,
  at,
}: {
  records: readonly unknown[];
  endpoint: string;
  at: string;
}): readonly TrelicaAtlasEntity[] {
  const entities = records.flatMap((entry: unknown): readonly TrelicaAtlasEntity[] => {
    if (!isRecord(entry)) {
      return [];
    }
    const providerId = textOf({ key: "id", record: entry });
    const type = textOf({ key: "type", record: entry });
    const status = textOf({ key: "status", record: entry });
    const date = textOf({ key: "date", record: entry });
    if (providerId === null || type === null || status === null || date === null) {
      return [];
    }
    const trend = Array.isArray(entry["trend"]) ? entry["trend"] : [];
    const detail: TrelicaAiAlertDetail = {
      ...appOf({ row: entry }),
      baselineMedian: numberOf({ key: "baselineMedian", record: entry }),
      date,
      evalDaySpend: numberOf({ key: "evalDaySpend", record: entry }),
      status,
      subType: textOf({ key: "subType", record: entry }),
      trend: trend.flatMap((point: unknown) => {
        const read = trendPoint({ entry: point });
        return read === null ? [] : [read];
      }),
      type,
    };
    return [firstPartyEntity({ at, detail, endpoint, kind: "ai-alert", providerId })];
  });
  return sortedById({ entities });
}
