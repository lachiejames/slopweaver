/**
 * The strict boundary each cost-explorer read is admitted by — one per dimension, because each dimension's row
 * names a different identity.
 *
 * MEASURED against the live tenant, every key and its kind across every row the six reads answered (the
 * api-key table walked only as far as the spend floor, every other table whole). Every
 * page is `{granularity, rows: {items, resultsTruncated, total}, usageByDate}`, and every row's `metrics` carries
 * the same ten figures. Reproduce with a key census over `client.usage` against a throwaway `--home`.
 *
 * A key `aiProjection.ts` reads is declared with its type; every other measured key is declared unread, so the
 * method map's census view keeps its name and none of its value.
 */
import { z } from "zod";

import { trelicaAiUsageCallId } from "./aiUsage.js";
import { trelicaPageSchema, unreadTrelicaKeys } from "./boundaryShapes.js";
import type { TrelicaAiUsageDimension } from "./model.js";
import { defineTrelicaBoundary, type TrelicaBoundary } from "./trelicaBoundary.js";

/** The ten figures every row carries, each one read. */
const metricsSchema = z.strictObject({
  cachedInputTokens: z.number(),
  cachedOutputTokens: z.number(),
  credits: z.number(),
  inputTokens: z.number(),
  linesOfCodeAdded: z.number(),
  linesOfCodeRemoved: z.number(),
  outputTokens: z.number(),
  requests: z.number(),
  spend: z.number(),
  totalTokens: z.number(),
});

/** A series row's spend per period; a period the explorer charted nothing for is `null`. */
const spendByDateSchema = z.record(z.string(), z.number().nullable());

/** The keys a person record and a user stamp carry that no projection reads. */
const UNREAD_KEY_FIELDS = [
  "canTakeOwnership",
  "createdByUser",
  "createdDtm",
  "customerId",
  "externalId",
  "id",
  "isEditable",
  "isOwner",
  "lastModifiedByUser",
  "lastModifiedDtm",
] as const;

/** An API key as a row embeds it: its name labels the row, its `externalId` is the vendor's and never held. */
const apiKeySchema = z.strictObject({
  customerAppId: z.string().optional(),
  name: z.string(),
  ...unreadTrelicaKeys({ keys: UNREAD_KEY_FIELDS }),
});

/** A person as a row embeds them. MEASURED: a series row's person can carry no `email`. */
const personSchema = z.strictObject({
  email: z.string().optional(),
  name: z.string(),
  ...unreadTrelicaKeys({ keys: ["id", "personType"] }),
});

/** One team row: its children are rows one level down, and the tree is read to a fixed depth. */
function teamRow<C extends z.ZodType>({ child }: { child: C }) {
  return z.strictObject({
    children: z.array(child),
    memberId: z.string(),
    memberName: z.string(),
    metrics: metricsSchema,
    ...unreadTrelicaKeys({ keys: ["childCount", "level", "sortField", "teamMemberType"] }),
  });
}

/**
 * The team tree, three levels deep. MEASURED: every row was a root with no children, so the depth is the
 * vendor's own team nesting rather than an observed one, and a fourth level is refused by name, never dropped.
 */
const teamRowSchema = teamRow({ child: teamRow({ child: teamRow({ child: z.never() }) }) });

/** One dimension's table row and series row. */
const ROWS = {
  "api-key": {
    row: z.strictObject({
      apiKey: apiKeySchema,
      customerAppApiKeyId: z.string(),
      customerAppId: z.string(),
      customerAppName: z.string(),
      metrics: metricsSchema,
      ...unreadTrelicaKeys({ keys: ["sortField"] }),
    }),
    series: z.strictObject({
      apiKey: apiKeySchema,
      customerAppApiKeyId: z.string(),
      customerAppId: z.string(),
      customerAppName: z.string(),
      spendByDate: spendByDateSchema,
    }),
  },
  app: {
    row: z.strictObject({
      customerAppId: z.string(),
      customerAppName: z.string(),
      metrics: metricsSchema,
      ...unreadTrelicaKeys({ keys: ["customerAppLogoUrl", "products", "sortField"] }),
    }),
    series: z.strictObject({ customerAppId: z.string(), customerAppName: z.string(), spendByDate: spendByDateSchema }),
  },
  "cost-center": {
    row: z.strictObject({ costCenterId: z.string(), metrics: metricsSchema }),
    series: z.strictObject({ costCenterId: z.string(), spendByDate: spendByDateSchema }),
  },
  model: {
    row: z.strictObject({
      customerAppId: z.string(),
      customerAppName: z.string(),
      metrics: metricsSchema,
      model: z.string(),
      ...unreadTrelicaKeys({ keys: ["sortField"] }),
    }),
    series: z.strictObject({
      customerAppId: z.string(),
      customerAppName: z.string(),
      model: z.string(),
      spendByDate: spendByDateSchema,
      ...unreadTrelicaKeys({ keys: ["modelDisplayName"] }),
    }),
  },
  person: {
    row: z.strictObject({
      metrics: metricsSchema,
      person: personSchema,
      personId: z.string(),
      ...unreadTrelicaKeys({ keys: ["sortField"] }),
    }),
    series: z.strictObject({ person: personSchema, personId: z.string(), spendByDate: spendByDateSchema }),
  },
  team: {
    row: teamRowSchema,
    series: z.strictObject({
      memberId: z.string(),
      memberName: z.string(),
      spendByDate: spendByDateSchema,
      ...unreadTrelicaKeys({ keys: ["canDrilldown", "teamMemberType"] }),
    }),
  },
} as const satisfies Record<TrelicaAiUsageDimension, { row: z.ZodType; series: z.ZodType }>;

/** One cost-explorer page, whatever its dimension. */
export interface TrelicaAiUsagePage {
  readonly granularity: string;
  readonly rows: { readonly items: readonly unknown[]; readonly resultsTruncated: boolean; readonly total: number };
  readonly usageByDate: readonly unknown[];
}

/** One dimension's page boundary. */
function usageBoundary<R extends z.ZodType, S extends z.ZodType>({
  dimension,
  row,
  series,
}: {
  dimension: TrelicaAiUsageDimension;
  row: R;
  series: S;
}): TrelicaBoundary<TrelicaAiUsagePage> {
  // Bound to the dimension's call id, which `usageWalk.ts` checks against the read before it requests the path.
  return defineTrelicaBoundary({
    callId: trelicaAiUsageCallId({ dimension }),
    endpoint: `POST /AppsApi/AppAIUsage (${dimension})`,
    schema: z.strictObject({
      granularity: z.string(),
      rows: trelicaPageSchema({ item: row }),
      usageByDate: z.array(series),
    }),
  });
}

/**
 * Every cost-explorer read's boundary, keyed by dimension — a closed table, so a dimension with no boundary does
 * not compile.
 *
 * @internal
 */
export const TRELICA_AI_USAGE_BOUNDARIES: Readonly<
  Record<TrelicaAiUsageDimension, TrelicaBoundary<TrelicaAiUsagePage>>
> = Object.freeze({
  "api-key": usageBoundary({ dimension: "api-key", ...ROWS["api-key"] }),
  app: usageBoundary({ dimension: "app", ...ROWS.app }),
  "cost-center": usageBoundary({ dimension: "cost-center", ...ROWS["cost-center"] }),
  model: usageBoundary({ dimension: "model", ...ROWS.model }),
  person: usageBoundary({ dimension: "person", ...ROWS.person }),
  team: usageBoundary({ dimension: "team", ...ROWS.team }),
});
